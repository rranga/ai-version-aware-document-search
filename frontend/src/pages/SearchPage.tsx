import { ArrowRight, BookOpenText, Library, Search, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import type { AnswerCheck, Scope, ScopeMode, SearchHit } from '../api/types'
import { AnswerView } from '../components/AnswerView'
import { ModelPicker } from '../components/ModelPicker'
import { ScopeBar } from '../components/ScopeBar'
import { SourceCard } from '../components/SourceCard'
import { Button, EmptyState, ErrorNote, Spinner } from '../components/ui'
import { useApp, useAsync } from '../lib/settings'

const num = (v: string | null) => (v && /^\d+$/.test(v) ? Number(v) : null)

function scopeFromParams(p: URLSearchParams): Scope {
  const doc = num(p.get('doc'))
  let mode = (p.get('mode') as ScopeMode) || 'latest'
  if (!['latest', 'all', 'version', 'range'].includes(mode)) mode = 'latest'
  if ((mode === 'version' || mode === 'range') && !doc) mode = 'latest'
  return {
    document_ids: doc ? [doc] : null,
    mode,
    version: num(p.get('v')),
    version_from: num(p.get('from')),
    version_to: num(p.get('to')),
  }
}

function scopeToParams(scope: Scope, p: URLSearchParams) {
  for (const k of ['doc', 'mode', 'v', 'from', 'to']) p.delete(k)
  if (scope.document_ids?.length === 1) p.set('doc', String(scope.document_ids[0]))
  if (scope.mode !== 'latest') p.set('mode', scope.mode)
  if (scope.mode === 'version' && scope.version) p.set('v', String(scope.version))
  if (scope.mode === 'range') {
    if (scope.version_from) p.set('from', String(scope.version_from))
    if (scope.version_to) p.set('to', String(scope.version_to))
  }
}

const DEMO_QUESTIONS = [
  'What is the hotel limit in London?',
  'How long do I have to submit expense claims?',
  'Is business class allowed?',
  'How long is the battery covered by the warranty?',
]

interface RunState {
  hits: SearchHit[] | null
  answer: string
  streaming: boolean
  loading: boolean
  error: string | null
  check: AnswerCheck | null
  model: string | null
  blocked: string[] | null
}

const IDLE: RunState = { hits: null, answer: '', streaming: false, loading: false, error: null, check: null, model: null, blocked: null }

export function SearchPage() {
  const { api, effectiveModel, health } = useApp()
  const [params, setParams] = useSearchParams()
  const docs = useAsync(() => api.listDocuments(), [api])
  const q = params.get('q') ?? ''
  const askMode = params.get('ask') !== '0'
  const scope = useMemo(() => scopeFromParams(params), [params])
  const [draft, setDraft] = useState(q)
  const [run, setRun] = useState<RunState>(IDLE)
  const [activeSource, setActiveSource] = useState<number | null>(null)

  useEffect(() => setDraft(q), [q])

  const runKey = params.toString()
  useEffect(() => {
    if (!q.trim()) {
      setRun(IDLE)
      return
    }
    const ctrl = new AbortController()
    const live = () => !ctrl.signal.aborted
    setActiveSource(null)
    if (askMode) {
      setRun({ ...IDLE, streaming: true, loading: true })
      api
        .ask(
          { query: q, scope, model: effectiveModel },
          {
            onSources: (hits) => live() && setRun((r) => ({ ...r, hits, loading: false })),
            onToken: (t) => live() && setRun((r) => ({ ...r, answer: r.answer + t })),
            onError: (error) => live() && setRun((r) => ({ ...r, error })),
            onCheck: (check) => live() && setRun((r) => ({ ...r, check })),
            onModel: (model) => live() && setRun((r) => ({ ...r, model })),
            onBlocked: (b) => live() && setRun((r) => ({ ...r, blocked: b.labels })),
          },
          ctrl.signal,
        )
        .catch((e: Error) => live() && setRun((r) => ({ ...r, error: e.message })))
        .finally(() => live() && setRun((r) => ({ ...r, streaming: false, loading: false })))
    } else {
      setRun({ ...IDLE, loading: true })
      api
        .search({ query: q, scope, k: 10 })
        .then((res) => live() && setRun({ ...IDLE, hits: res.hits }))
        .catch((e: Error) => live() && setRun({ ...IDLE, error: e.message }))
    }
    return () => ctrl.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // Switching model re-asks the current question with the new model
  }, [runKey, api, askMode ? effectiveModel : null])

  const update = (mutate: (p: URLSearchParams) => void) => {
    const next = new URLSearchParams(params)
    mutate(next)
    setParams(next)
  }

  const submit = (e?: FormEvent, text = draft) => {
    e?.preventDefault()
    if (!text.trim()) return
    update((p) => p.set('q', text.trim()))
  }

  const cite = (n: number) => {
    setActiveSource(n)
    document.getElementById(`src-${n}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  const documents = docs.data ?? []
  const noDocs = !docs.loading && !docs.error && documents.length === 0
  const llmDown = api.mode === 'live' && health.status === 'ok' && !health.data.llm.reachable

  return (
    <div className="space-y-6">
      <div className={q ? '' : 'pt-4 sm:pt-12'}>
        {!q && (
          <div className="mb-8 text-center">
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Search every version of your documents</h1>
            <p className="mx-auto mt-3 max-w-xl text-muted">
              Ask a question or search for a phrase. Choose the latest version, a specific version, or compare how the answer changed over time.
            </p>
          </div>
        )}

        <form onSubmit={submit} className="rounded-2xl border border-line bg-surface p-2 shadow-sm focus-within:ring-2 focus-within:ring-accent/30">
          <div className="flex items-center gap-2">
            <Search className="ml-2 size-5 shrink-0 text-muted" />
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={askMode ? 'Ask a question about your documents…' : 'Search for words or phrases…'}
              aria-label="Query"
              className="h-11 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted/70"
            />
            <Button type="submit" variant="primary" disabled={!draft.trim()} aria-label="Run">
              <ArrowRight className="size-4" />
              <span className="hidden sm:inline">{askMode ? 'Ask' : 'Search'}</span>
            </Button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-line px-1 pt-2">
            <div className="flex w-full min-w-0 items-center gap-1.5 sm:w-auto">
              <div className="flex shrink-0 rounded-lg bg-surface-2 p-0.5" role="radiogroup" aria-label="Mode">
                {[
                  { ask: true, label: 'Ask AI', extra: '', icon: Sparkles },
                  { ask: false, label: 'Search', extra: ' only', icon: BookOpenText },
                ].map(({ ask, label, extra, icon: Icon }) => (
                  <button
                    key={label}
                    type="button"
                    role="radio"
                    aria-checked={askMode === ask}
                    onClick={() => update((p) => (ask ? p.delete('ask') : p.set('ask', '0')))}
                    className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium whitespace-nowrap ${
                      askMode === ask ? 'bg-surface text-fg shadow-sm' : 'text-muted hover:text-fg'
                    }`}
                  >
                    <Icon className="hidden size-3.5 sm:block" />
                    {label}
                    {extra && <span className="hidden sm:inline">{extra}</span>}
                  </button>
                ))}
              </div>
              {askMode && <ModelPicker className="flex-1 sm:max-w-56 sm:flex-none" />}
            </div>
            <div className="contents">
              <ScopeBar documents={documents} scope={scope} onChange={(s) => update((p) => scopeToParams(s, p))} />
            </div>
          </div>
        </form>
      </div>

      {docs.error && <ErrorNote>{docs.error}</ErrorNote>}
      {noDocs && (
        <EmptyState icon={<Library className="size-8" />} title="No documents yet">
          Add files or links in the{' '}
          <Link to="/library" className="font-medium text-accent hover:underline">
            Library
          </Link>{' '}
          to start searching.
        </EmptyState>
      )}

      {!q && !noDocs && api.mode === 'demo' && (
        <div className="flex flex-wrap justify-center gap-2">
          {DEMO_QUESTIONS.map((text) => (
            <button
              key={text}
              onClick={() => {
                setDraft(text)
                submit(undefined, text)
              }}
              className="rounded-full border border-line bg-surface px-3 py-1.5 text-sm text-muted hover:border-accent hover:text-fg"
            >
              {text}
            </button>
          ))}
        </div>
      )}

      {q && askMode && llmDown && (
        <ErrorNote>
          The backend is connected but Ollama isn’t reachable, so only search results can be shown. Start Ollama or check{' '}
          <Link to="/settings" className="underline">
            Settings
          </Link>
          .
        </ErrorNote>
      )}

      {q && askMode && (run.streaming || run.answer || run.error) && (
        <AnswerView
          answer={run.answer}
          streaming={run.streaming}
          error={run.error}
          onCite={cite}
          sourceCount={run.hits?.length}
          check={run.check}
          model={run.model}
          blocked={run.blocked}
        />
      )}
      {q && !askMode && run.error && <ErrorNote>{run.error}</ErrorNote>}

      {q && run.loading && !run.hits && <Spinner label="Searching…" />}

      {run.hits && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-muted">
            {run.hits.length ? `${run.hits.length} source passage${run.hits.length === 1 ? '' : 's'}` : 'No matching passages'}
          </h2>
          {run.hits.map((hit, i) => (
            <SourceCard
              key={`${hit.chunk_id}-${hit.document.id}`}
              hit={hit}
              index={i + 1}
              query={q}
              showVersionSpread={scope.mode === 'all' || scope.mode === 'range'}
              active={activeSource === i + 1}
              suspicious={!!run.check?.suspicious_sources?.includes(i + 1)}
            />
          ))}
        </section>
      )}
    </div>
  )
}
