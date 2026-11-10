import { CheckCircle2, CircleDashed, FileUp, Link2, XCircle } from 'lucide-react'
import { useRef, useState, type DragEvent, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import type { DocumentOut, IngestResult } from '../api/types'
import { useApp } from '../lib/settings'
import { Button, Field, inputClass } from './ui'

type Outcome = { name: string; result?: IngestResult; error?: string }

const ACCEPT = '.pdf,.docx,.txt,.md,.markdown,.html,.htm'

function describe(r: IngestResult) {
  const chunks = `${r.new_chunks} new passage${r.new_chunks === 1 ? '' : 's'} indexed, ${r.reused_chunks} reused`
  if (r.status === 'created') return `Added as a new document (v1) · ${chunks}`
  if (r.status === 'new_version') return `Saved as v${r.version.number} · ${chunks}`
  return `No changes — identical to v${r.version.number}, nothing re-indexed`
}

export function UploadPanel({
  documents,
  fixedDocument,
  onDone,
}: {
  documents: DocumentOut[]
  fixedDocument?: DocumentOut
  onDone?: () => void
}) {
  const { api, bump } = useApp()
  const [tab, setTab] = useState<'file' | 'url'>('file')
  const [target, setTarget] = useState<string>(fixedDocument ? String(fixedDocument.id) : '')
  const [label, setLabel] = useState('')
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [outcomes, setOutcomes] = useState<Outcome[]>([])
  const fileInput = useRef<HTMLInputElement>(null)

  const documentId = target ? Number(target) : null

  const uploadFiles = async (files: File[]) => {
    if (!files.length) return
    setBusy(true)
    const results: Outcome[] = files.map((f) => ({ name: f.name }))
    setOutcomes([...results])
    for (let i = 0; i < files.length; i++) {
      try {
        results[i] = { name: files[i].name, result: await api.upload(files[i], { documentId, label: label || undefined }) }
      } catch (e) {
        results[i] = { name: files[i].name, error: (e as Error).message }
      }
      setOutcomes([...results])
    }
    setBusy(false)
    setLabel('')
    bump()
    onDone?.()
  }

  const submitUrl = async (e: FormEvent) => {
    e.preventDefault()
    if (!url.trim()) return
    setBusy(true)
    setOutcomes([{ name: url }])
    try {
      const result = await api.addUrl(url.trim(), { documentId, label: label || undefined, title: title || undefined })
      setOutcomes([{ name: result.document.title, result }])
      setUrl('')
      setTitle('')
      setLabel('')
      bump()
      onDone?.()
    } catch (err) {
      setOutcomes([{ name: url, error: (err as Error).message }])
    } finally {
      setBusy(false)
    }
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    void uploadFiles(Array.from(e.dataTransfer.files))
  }

  const tabBtn = (value: 'file' | 'url', text: string, Icon: typeof FileUp) => (
    <button
      type="button"
      onClick={() => setTab(value)}
      className={`flex items-center gap-2 border-b-2 px-1 pb-2 text-sm font-medium ${
        tab === value ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg'
      }`}
    >
      <Icon className="size-4" />
      {text}
    </button>
  )

  return (
    <div className="space-y-4">
      <div className="flex gap-5 border-b border-line">
        {tabBtn('file', 'Upload files', FileUp)}
        {tabBtn('url', 'From a link', Link2)}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Save as"
          hint={fixedDocument ? undefined : 'Auto: a file with the same name (or the same link) becomes the next version.'}
        >
          <select className={inputClass} value={target} disabled={!!fixedDocument} onChange={(e) => setTarget(e.target.value)}>
            {!fixedDocument && <option value="">Auto — match by name or link</option>}
            {(fixedDocument ? [fixedDocument] : documents).map((d) => (
              <option key={d.id} value={d.id}>
                New version of “{d.title}” (v{d.latest_version + 1})
              </option>
            ))}
          </select>
        </Field>
        <Field label="Version label (optional)" hint="e.g. 2025-Q3, Draft, Signed">
          <input className={inputClass} value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} placeholder="Label" />
        </Field>
      </div>

      {tab === 'file' ? (
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => fileInput.current?.click()}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && fileInput.current?.click()}
          role="button"
          tabIndex={0}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors ${
            dragging ? 'border-accent bg-accent-soft' : 'border-line hover:border-accent/60 hover:bg-surface-2'
          }`}
        >
          <FileUp className="mb-2 size-7 text-accent" />
          <p className="text-sm font-medium">Drop files here or click to browse</p>
          <p className="mt-1 text-xs text-muted">
            {api.mode === 'demo' ? 'Demo mode: .txt and .md only' : 'PDF, Word (.docx), text, Markdown or HTML'}
          </p>
          <input
            ref={fileInput}
            type="file"
            multiple
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => {
              void uploadFiles(Array.from(e.target.files ?? []))
              e.target.value = ''
            }}
          />
        </div>
      ) : (
        <form onSubmit={submitUrl} className="space-y-3">
          <Field label="Link to a document or web page" hint="PDF, DOCX, HTML pages… Use Refresh later to capture a new version when the page changes.">
            <input className={inputClass} type="url" required value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/policy.pdf" />
          </Field>
          {!documentId && (
            <Field label="Title (optional)">
              <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Defaults to the page title or file name" />
            </Field>
          )}
          <Button type="submit" variant="primary" busy={busy}>
            <Link2 className="size-4" /> Add link
          </Button>
        </form>
      )}

      {outcomes.length > 0 && (
        <ul className="space-y-1.5" aria-live="polite">
          {outcomes.map((o, i) => (
            <li key={i} className="flex items-start gap-2 rounded-lg bg-surface-2 px-3 py-2 text-sm">
              {o.error ? (
                <XCircle className="mt-0.5 size-4 shrink-0 text-del-fg" />
              ) : o.result ? (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-add-fg" />
              ) : (
                <CircleDashed className="mt-0.5 size-4 shrink-0 animate-spin text-muted" />
              )}
              <div className="min-w-0">
                <div className="truncate font-medium">
                  {o.result ? (
                    <Link to={`/documents/${o.result.document.id}`} className="hover:text-accent">
                      {o.result.document.title}
                    </Link>
                  ) : (
                    o.name
                  )}
                </div>
                <div className={`text-xs ${o.error ? 'text-del-fg' : 'text-muted'}`}>
                  {o.error ?? (o.result ? describe(o.result) : 'Reading and indexing…')}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
