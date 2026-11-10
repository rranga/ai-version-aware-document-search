import { ArrowLeftRight, GitCompareArrows, Sparkles } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AnswerView } from '../components/AnswerView'
import { DiffView } from '../components/DiffView'
import { ModelPicker } from '../components/ModelPicker'
import { Badge, Button, Card, EmptyState, ErrorNote, Field, PageHeader, Spinner, inputClass } from '../components/ui'
import { useApp, useAsync } from '../lib/settings'
import { formatDate, versionName } from '../lib/text'

const num = (v: string | null) => (v && /^\d+$/.test(v) ? Number(v) : null)

export function ComparePage() {
  const { api, effectiveModel } = useApp()
  const [params, setParams] = useSearchParams()
  const docs = useAsync(() => api.listDocuments(), [api])
  const multi = (docs.data ?? []).filter((d) => d.version_count > 1)

  const docId = num(params.get('doc')) ?? multi[0]?.id ?? null
  const detail = useAsync(() => (docId ? api.getDocument(docId) : Promise.resolve(null)), [api, docId])
  const versions = detail.data?.versions ?? []
  const latest = versions[0]?.number ?? 1
  const from = num(params.get('from')) ?? Math.max(1, latest - 1)
  const to = num(params.get('to')) ?? latest

  const ready = !!docId && !!detail.data && from !== to
  const diff = useAsync(() => (ready ? api.diff(docId!, from, to) : Promise.resolve(null)), [api, docId, from, to, ready])

  const [showUnchanged, setShowUnchanged] = useState(false)
  const [summary, setSummary] = useState({ text: '', streaming: false, error: null as string | null, shown: false, model: null as string | null })
  const abort = useRef<AbortController | null>(null)

  useEffect(() => {
    abort.current?.abort()
    setSummary({ text: '', streaming: false, error: null, shown: false, model: null })
  }, [docId, from, to])

  const set = (patch: Record<string, number | null>) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) {
      if (v == null) next.delete(k)
      else next.set(k, String(v))
    }
    setParams(next)
  }

  const summarize = () => {
    if (!docId) return
    abort.current?.abort()
    const ctrl = new AbortController()
    abort.current = ctrl
    setSummary({ text: '', streaming: true, error: null, shown: true, model: null })
    api
      .diffSummary(docId, from, to, effectiveModel, {
        onToken: (t) => !ctrl.signal.aborted && setSummary((s) => ({ ...s, text: s.text + t })),
        onError: (error) => setSummary((s) => ({ ...s, error })),
        onModel: (m) => !ctrl.signal.aborted && setSummary((s) => ({ ...s, model: m })),
      }, ctrl.signal)
      .catch((e: Error) => setSummary((s) => ({ ...s, error: e.message })))
      .finally(() => !ctrl.signal.aborted && setSummary((s) => ({ ...s, streaming: false })))
  }

  const vSelect = (value: number, key: 'from' | 'to', label: string) => (
    <Field label={label}>
      <select className={inputClass} value={value} onChange={(e) => set({ [key]: Number(e.target.value) })}>
        {versions.map((v) => (
          <option key={v.number} value={v.number}>
            {versionName(v)} — {formatDate(v.created_at)}
          </option>
        ))}
      </select>
    </Field>
  )

  return (
    <div>
      <PageHeader title="Compare versions" description="See exactly what changed between two versions of a document." />

      {docs.loading && !docs.data && <Spinner />}
      {docs.error && <ErrorNote>{docs.error}</ErrorNote>}
      {docs.data && multi.length === 0 && (
        <EmptyState icon={<GitCompareArrows className="size-8" />} title="Nothing to compare yet">
          Upload a second version of a document (same file name, or choose “New version of…”) to compare versions.
        </EmptyState>
      )}

      {multi.length > 0 && (
        <Card className="mb-6 p-4">
          <div className="grid items-end gap-3 sm:grid-cols-[1.4fr_1fr_auto_1fr]">
            <Field label="Document">
              <select className={inputClass} value={docId ?? ''} onChange={(e) => set({ doc: Number(e.target.value), from: null, to: null })}>
                {multi.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.title}
                  </option>
                ))}
              </select>
            </Field>
            {versions.length > 0 && vSelect(from, 'from', 'Older')}
            <Button variant="ghost" className="justify-self-center" onClick={() => set({ from: to, to: from })} aria-label="Swap versions">
              <ArrowLeftRight className="size-4" />
            </Button>
            {versions.length > 0 && vSelect(to, 'to', 'Newer')}
          </div>
        </Card>
      )}

      {from === to && detail.data && <p className="text-sm text-muted">Pick two different versions.</p>}
      {diff.loading && ready && !diff.data && <Spinner label="Comparing…" />}
      {diff.error && <ErrorNote>{diff.error}</ErrorNote>}

      {diff.data && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {diff.data.stats.added > 0 && <Badge tone="add">+{diff.data.stats.added} added</Badge>}
            {diff.data.stats.removed > 0 && <Badge tone="del">−{diff.data.stats.removed} removed</Badge>}
            {diff.data.stats.modified > 0 && <Badge tone="mod">~{diff.data.stats.modified} changed</Badge>}
            <Badge>{diff.data.stats.unchanged} unchanged</Badge>
            <span className="text-xs text-muted">
              · {diff.data.chunk_stats.shared} indexed passages shared, {diff.data.chunk_stats.only_new} new in v{diff.data.new.number}
            </span>
            <div className="ml-auto flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-1.5 text-sm text-muted">
                <input type="checkbox" className="accent-[var(--accent)]" checked={showUnchanged} onChange={(e) => setShowUnchanged(e.target.checked)} />
                Show unchanged
              </label>
              <ModelPicker className="max-w-56" />
              <Button
                size="sm"
                variant="primary"
                onClick={summarize}
                busy={summary.streaming}
                disabled={api.mode === 'demo'}
                title={api.mode === 'demo' ? 'AI summaries need the backend' : undefined}
              >
                {!summary.streaming && <Sparkles className="size-4" />} Summarize changes
              </Button>
            </div>
          </div>

          {summary.shown && <AnswerView title={`What changed: v${from} → v${to}`} answer={summary.text} streaming={summary.streaming} error={summary.error} model={summary.model} />}

          {diff.data.stats.added + diff.data.stats.removed + diff.data.stats.modified === 0 ? (
            <p className="rounded-lg bg-surface-2 px-4 py-3 text-sm text-muted">These versions have identical text.</p>
          ) : (
            <Card className="p-4 sm:p-5">
              <DiffView key={`${docId}-${from}-${to}`} blocks={diff.data.blocks} showUnchanged={showUnchanged} />
            </Card>
          )}
        </div>
      )}
    </div>
  )
}
