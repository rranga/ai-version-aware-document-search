import { FileText, GitCompareArrows, Library, Link2, Plus, RefreshCw, Search, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { DocumentOut } from '../api/types'
import { UploadPanel } from '../components/UploadPanel'
import { Badge, Button, Card, EmptyState, ErrorNote, PageHeader, Spinner } from '../components/ui'
import { useApp, useAsync } from '../lib/settings'
import { formatDate } from '../lib/text'

function DocumentRow({ doc }: { doc: DocumentOut }) {
  const { api, bump } = useApp()
  const [busy, setBusy] = useState<'refresh' | 'delete' | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const refresh = async () => {
    setBusy('refresh')
    setNote(null)
    try {
      const r = await api.refresh(doc.id)
      setNote(r.status === 'unchanged' ? 'No changes since the last version.' : `Captured v${r.version.number}.`)
      if (r.status !== 'unchanged') bump()
    } catch (e) {
      setNote((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const remove = async () => {
    if (!confirm(`Delete “${doc.title}” and all ${doc.version_count} version(s)? This cannot be undone.`)) return
    setBusy('delete')
    try {
      await api.deleteDocument(doc.id)
      bump()
    } catch (e) {
      setNote((e as Error).message)
      setBusy(null)
    }
  }

  const Icon = doc.source_type === 'url' ? Link2 : FileText
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
          <Icon className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <Link to={`/documents/${doc.id}`} className="block truncate font-semibold hover:text-accent">
            {doc.title}
          </Link>
          <div className="mt-0.5 truncate text-xs text-muted" title={doc.source_ref}>
            {doc.source_ref}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
            <Badge tone="accent">v{doc.latest_version}</Badge>
            <span>
              {doc.version_count} version{doc.version_count === 1 ? '' : 's'}
            </span>
            <span aria-hidden>·</span>
            <span>Updated {formatDate(doc.updated_at)}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
          <Link to={`/?doc=${doc.id}`}>
            <Button size="sm" variant="ghost" title="Search this document">
              <Search className="size-4" />
              <span className="sr-only sm:not-sr-only">Search</span>
            </Button>
          </Link>
          {doc.version_count > 1 && (
            <Link to={`/compare?doc=${doc.id}&from=${doc.latest_version - 1}&to=${doc.latest_version}`}>
              <Button size="sm" variant="ghost" title="Compare the last two versions">
                <GitCompareArrows className="size-4" />
                <span className="sr-only sm:not-sr-only">Compare</span>
              </Button>
            </Link>
          )}
          {doc.source_type === 'url' && (
            <Button size="sm" variant="ghost" onClick={refresh} busy={busy === 'refresh'} title="Fetch the link again">
              {busy !== 'refresh' && <RefreshCw className="size-4" />}
              <span className="sr-only sm:not-sr-only">Refresh</span>
            </Button>
          )}
          <Button size="sm" variant="danger" onClick={remove} busy={busy === 'delete'} aria-label="Delete document">
            {busy !== 'delete' && <Trash2 className="size-4" />}
          </Button>
        </div>
      </div>
      {note && <p className="mt-3 rounded-lg bg-surface-2 px-3 py-1.5 text-xs text-muted">{note}</p>}
    </Card>
  )
}

export function LibraryPage() {
  const { api } = useApp()
  const docs = useAsync(() => api.listDocuments(), [api])
  const [adding, setAdding] = useState(false)
  const documents = docs.data ?? []
  const showUpload = adding || (!docs.loading && documents.length === 0)

  return (
    <div>
      <PageHeader
        title="Library"
        description="Every upload of the same file — or every refresh of the same link — is kept as a new version."
        actions={
          !showUpload && (
            <Button variant="primary" onClick={() => setAdding(true)}>
              <Plus className="size-4" /> Add documents
            </Button>
          )
        }
      />

      {showUpload && (
        <Card className="mb-6 p-5">
          <UploadPanel documents={documents} />
          {adding && (
            <div className="mt-4 text-right">
              <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>
                Close
              </Button>
            </div>
          )}
        </Card>
      )}

      {docs.loading && !docs.data && <Spinner />}
      {docs.error && <ErrorNote>{docs.error}</ErrorNote>}
      {!docs.loading && !docs.error && documents.length === 0 && (
        <EmptyState icon={<Library className="size-8" />} title="Your library is empty">
          Upload a PDF, Word, text, Markdown or HTML file, or add a link. Upload the same file again later to record a new version.
        </EmptyState>
      )}
      <div className="space-y-3">
        {documents.map((d) => (
          <DocumentRow key={d.id} doc={d} />
        ))}
      </div>
    </div>
  )
}
