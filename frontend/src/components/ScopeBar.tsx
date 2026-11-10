import { FileText, Layers } from 'lucide-react'
import type { DocumentOut, Scope, ScopeMode } from '../api/types'
import { Dropdown, type DropdownOption } from './Dropdown'
import { inputClass } from './ui'

const MODES: { value: ScopeMode; label: string; description: string; needsDoc?: boolean }[] = [
  { value: 'latest', label: 'Latest version', description: 'The newest version of each document' },
  { value: 'all', label: 'All versions', description: 'Every version — see where passages changed' },
  { value: 'version', label: 'Specific version', description: 'One exact version of a document', needsDoc: true },
  { value: 'range', label: 'Version range', description: 'From one version to another', needsDoc: true },
]

// Sized to its content ("v12"); not inputClass, whose w-full would stretch it
const compactSelect =
  'h-9 shrink-0 rounded-lg border border-line bg-surface pr-7 pl-2.5 text-sm text-fg focus:border-accent focus:ring-2 focus:ring-accent/40 focus:outline-none'

export function ScopeBar({
  documents,
  scope,
  onChange,
}: {
  documents: DocumentOut[]
  scope: Scope
  onChange: (s: Scope) => void
}) {
  const docId = scope.document_ids?.length === 1 ? scope.document_ids[0] : null
  const doc = documents.find((d) => d.id === docId)
  const versions = doc ? Array.from({ length: doc.latest_version }, (_, i) => doc.latest_version - i) : []

  const setDoc = (value: string) => {
    const id = value ? Number(value) : null
    const target = documents.find((d) => d.id === id)
    const needsDoc = scope.mode === 'version' || scope.mode === 'range'
    onChange({
      document_ids: id ? [id] : null,
      mode: needsDoc && !id ? 'latest' : scope.mode,
      version: target ? target.latest_version : null,
      version_from: target ? Math.max(1, target.latest_version - 1) : null,
      version_to: target ? target.latest_version : null,
    })
  }

  const setMode = (mode: ScopeMode) => {
    onChange({
      ...scope,
      mode,
      version: scope.version ?? doc?.latest_version ?? null,
      version_from: scope.version_from ?? (doc ? Math.max(1, doc.latest_version - 1) : null),
      version_to: scope.version_to ?? doc?.latest_version ?? null,
    })
  }

  const options: DropdownOption<ScopeMode>[] = MODES.map((m) => ({
    value: m.value,
    label: m.label,
    description: m.description,
    disabled: m.needsDoc && !doc,
    hint: m.needsDoc && !doc ? 'Pick a single document first' : undefined,
  }))
  const current = MODES.find((m) => m.value === scope.mode) ?? MODES[0]

  const vSelect = (value: number | null | undefined, set: (n: number) => void, label: string) => (
    <select aria-label={label} className={compactSelect} value={value ?? ''} onChange={(e) => set(Number(e.target.value))}>
      {versions.map((n) => (
        <option key={n} value={n}>
          v{n}
        </option>
      ))}
    </select>
  )

  return (
    // `contents`: the controls join the parent row and wrap one by one
    <div className="contents">
      <div className="relative min-w-0 flex-1 basis-44 sm:max-w-64">
        <FileText className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted" />
        <select
          aria-label="Document"
          className={`${inputClass} h-9 truncate pl-8`}
          value={docId ?? ''}
          onChange={(e) => setDoc(e.target.value)}
        >
          <option value="">All documents</option>
          {documents.map((d) => (
            <option key={d.id} value={d.id}>
              {d.title}
            </option>
          ))}
        </select>
      </div>

      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <Dropdown
          className="shrink-0"
          title="Which versions to search"
          heading="Versions"
          icon={<Layers className="size-3.5 shrink-0 text-accent" />}
          label={current.label}
          options={options}
          value={scope.mode}
          onChange={setMode}
          footer={doc ? undefined : 'Choose a single document to search one version or a range.'}
        />
        {doc && scope.mode === 'version' && vSelect(scope.version, (n) => onChange({ ...scope, version: n }), 'Version')}
        {doc && scope.mode === 'range' && (
          <span className="flex shrink-0 items-center gap-1.5 text-sm text-muted">
            {vSelect(scope.version_from, (n) => onChange({ ...scope, version_from: n }), 'From version')}
            to
            {vSelect(scope.version_to, (n) => onChange({ ...scope, version_to: n }), 'To version')}
          </span>
        )}
      </div>
    </div>
  )
}
