import { ArrowLeft, Check, Eye, FileUp, GitCompareArrows, Link2, Pencil, RefreshCw, Search, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { DocumentDetail, VersionOut } from '../api/types'
import { UploadPanel } from '../components/UploadPanel'
import { Badge, Button, Card, ErrorNote, Modal, Spinner, inputClass } from '../components/ui'
import { useApp, useAsync } from '../lib/settings'
import { formatBytes, formatDate, stripHeading, versionName } from '../lib/text'

function ChunkBar({ v }: { v: VersionOut }) {
  const reused = v.chunk_count - v.new_chunk_count
  const pct = v.chunk_count ? (v.new_chunk_count / v.chunk_count) * 100 : 0
  return (
    <div className="w-full max-w-56" title={`${v.new_chunk_count} new passages embedded, ${reused} reused from earlier versions`}>
      <div className="flex h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div className="bg-accent" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1 text-[11px] text-muted">
        {v.number === 1 ? `${v.chunk_count} passages` : `${v.new_chunk_count} new · ${reused} unchanged passages`}
      </div>
    </div>
  )
}

function VersionRow({ doc, v, latest, onView }: { doc: DocumentDetail; v: VersionOut; latest: boolean; onView: () => void }) {
  const { api, bump } = useApp()
  const [editing, setEditing] = useState(false)
  const [label, setLabel] = useState(v.label ?? '')
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    try {
      await api.setVersionLabel(doc.id, v.number, label.trim() || null)
      setEditing(false)
      bump()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const remove = async () => {
    const last = doc.version_count === 1
    if (!confirm(last ? `v${v.number} is the only version — this deletes the whole document. Continue?` : `Delete v${v.number}? Later versions keep their numbers.`)) return
    try {
      await api.deleteVersion(doc.id, v.number)
      bump()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <li className="relative pl-10">
      <span
        className={`absolute top-4 left-0 flex size-7 items-center justify-center rounded-full text-[11px] font-bold ring-4 ring-bg ${
          latest ? 'bg-accent text-accent-fg' : 'bg-surface-2 text-muted'
        }`}
      >
        v{v.number}
      </span>
      <Card className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              {editing ? (
                <form
                  className="flex items-center gap-1"
                  onSubmit={(e) => {
                    e.preventDefault()
                    void save()
                  }}
                >
                  <input autoFocus className={`${inputClass} h-8 w-44`} value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} placeholder="Label" />
                  <Button size="sm" variant="ghost" type="submit" aria-label="Save label">
                    <Check className="size-4" />
                  </Button>
                  <Button size="sm" variant="ghost" type="button" onClick={() => setEditing(false)} aria-label="Cancel">
                    <X className="size-4" />
                  </Button>
                </form>
              ) : (
                <>
                  <span className="font-semibold">{v.label || <span className="text-muted">No label</span>}</span>
                  <button className="text-muted hover:text-fg" onClick={() => setEditing(true)} aria-label="Edit label">
                    <Pencil className="size-3.5" />
                  </button>
                </>
              )}
              {latest && <Badge tone="accent">Latest</Badge>}
            </div>
            <div className="text-xs text-muted">
              {formatDate(v.created_at)} · {v.source_name} · {formatBytes(v.size_bytes)}
            </div>
            <ChunkBar v={v} />
          </div>
          <div className="flex flex-wrap gap-1">
            <Button size="sm" variant="ghost" onClick={onView}>
              <Eye className="size-4" /> View
            </Button>
            <Link to={`/?doc=${doc.id}&mode=version&v=${v.number}`}>
              <Button size="sm" variant="ghost">
                <Search className="size-4" /> Search
              </Button>
            </Link>
            {v.number > 1 && (
              <Link to={`/compare?doc=${doc.id}&from=${v.number - 1}&to=${v.number}`}>
                <Button size="sm" variant="ghost" title={`Compare v${v.number - 1} → v${v.number}`}>
                  <GitCompareArrows className="size-4" /> Changes
                </Button>
              </Link>
            )}
            <Button size="sm" variant="danger" onClick={remove} aria-label={`Delete v${v.number}`}>
              <Trash2 className="size-4" />
            </Button>
          </div>
        </div>
        {error && <p className="mt-2 text-xs text-del-fg">{error}</p>}
      </Card>
    </li>
  )
}

export function DocumentPage() {
  const { id } = useParams()
  const docId = Number(id)
  const { api, bump } = useApp()
  const navigate = useNavigate()
  const doc = useAsync(() => api.getDocument(docId), [api, docId])
  const [viewing, setViewing] = useState<VersionOut | null>(null)
  const text = useAsync(() => (viewing ? api.versionText(docId, viewing.number) : Promise.resolve(null)), [api, docId, viewing?.number])
  const [uploading, setUploading] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [title, setTitle] = useState('')
  const [note, setNote] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  if (doc.loading && !doc.data) return <Spinner />
  if (doc.error || !doc.data) {
    return (
      <div className="space-y-4">
        <Link to="/library" className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
          <ArrowLeft className="size-4" /> Library
        </Link>
        <ErrorNote>{doc.error ?? 'Document not found'}</ErrorNote>
      </div>
    )
  }
  const d = doc.data

  const refresh = async () => {
    setRefreshing(true)
    setNote(null)
    try {
      const r = await api.refresh(d.id)
      setNote(r.status === 'unchanged' ? 'The link has not changed since the latest version.' : `Captured v${r.version.number}: ${r.new_chunks} new passages.`)
      bump()
    } catch (e) {
      setNote((e as Error).message)
    } finally {
      setRefreshing(false)
    }
  }

  const rename = async () => {
    if (!title.trim()) return
    await api.renameDocument(d.id, title.trim())
    setRenaming(false)
    bump()
  }

  const removeDoc = async () => {
    if (!confirm(`Delete “${d.title}” and all its versions?`)) return
    await api.deleteDocument(d.id)
    bump()
    navigate('/library')
  }

  return (
    <div>
      <Link to="/library" className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" /> Library
      </Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          {renaming ? (
            <form
              className="flex items-center gap-1"
              onSubmit={(e) => {
                e.preventDefault()
                void rename()
              }}
            >
              <input autoFocus className={`${inputClass} text-lg font-semibold`} value={title} onChange={(e) => setTitle(e.target.value)} />
              <Button size="sm" variant="ghost" type="submit" aria-label="Save title">
                <Check className="size-4" />
              </Button>
              <Button size="sm" variant="ghost" type="button" onClick={() => setRenaming(false)} aria-label="Cancel">
                <X className="size-4" />
              </Button>
            </form>
          ) : (
            <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
              <span className="truncate">{d.title}</span>
              <button
                className="text-muted hover:text-fg"
                onClick={() => {
                  setTitle(d.title)
                  setRenaming(true)
                }}
                aria-label="Rename"
              >
                <Pencil className="size-4" />
              </button>
            </h1>
          )}
          <div className="mt-1 flex items-center gap-1.5 text-sm text-muted">
            {d.source_type === 'url' ? <Link2 className="size-3.5" /> : <FileUp className="size-3.5" />}
            {d.source_type === 'url' ? (
              <a href={d.source_ref} target="_blank" rel="noreferrer" className="truncate hover:text-accent hover:underline">
                {d.source_ref}
              </a>
            ) : (
              <span className="truncate">{d.source_ref}</span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to={`/?doc=${d.id}&mode=all`}>
            <Button>
              <Search className="size-4" /> Search all versions
            </Button>
          </Link>
          {d.source_type === 'url' && (
            <Button onClick={refresh} busy={refreshing}>
              {!refreshing && <RefreshCw className="size-4" />} Refresh link
            </Button>
          )}
          <Button variant="primary" onClick={() => setUploading(!uploading)}>
            <FileUp className="size-4" /> New version
          </Button>
          <Button variant="danger" onClick={removeDoc} aria-label="Delete document">
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>

      {note && <p className="mb-4 rounded-lg bg-surface-2 px-3 py-2 text-sm text-muted">{note}</p>}

      {uploading && (
        <Card className="mb-6 p-5">
          <UploadPanel documents={[d]} fixedDocument={d} onDone={() => undefined} />
        </Card>
      )}

      <h2 className="mb-3 text-sm font-semibold text-muted">Version history</h2>
      <ol className="relative space-y-3 before:absolute before:top-4 before:bottom-4 before:left-[13px] before:w-0.5 before:bg-line">
        {d.versions.map((v, i) => (
          <VersionRow key={v.id} doc={d} v={v} latest={i === 0} onView={() => setViewing(v)} />
        ))}
      </ol>

      {viewing && (
        <Modal
          title={
            <span>
              {d.title} <Badge tone="accent">{versionName(viewing)}</Badge>
            </span>
          }
          onClose={() => setViewing(null)}
        >
          {text.loading && <Spinner />}
          {text.error && <ErrorNote>{text.error}</ErrorNote>}
          {text.data && (
            <div className="space-y-3 text-[15px] leading-relaxed">
              {text.data.text.split(/\n\s*\n/).map((p, i) => {
                const { heading, text: body } = stripHeading(p)
                return (
                  <p key={i} className={heading ? 'pt-2 font-semibold' : ''}>
                    {body}
                  </p>
                )
              })}
            </div>
          )}
        </Modal>
      )}
    </div>
  )
}
