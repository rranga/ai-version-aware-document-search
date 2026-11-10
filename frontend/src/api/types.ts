export interface VersionOut {
  id: number
  number: number
  label: string | null
  source_name: string
  mime: string
  size_bytes: number
  chunk_count: number
  new_chunk_count: number
  created_at: string
}

export interface DocumentOut {
  id: number
  title: string
  source_type: 'file' | 'url'
  source_ref: string
  created_at: string
  updated_at: string
  version_count: number
  latest_version: number
}

export interface DocumentDetail extends DocumentOut {
  versions: VersionOut[]
}

export interface IngestResult {
  status: 'created' | 'new_version' | 'unchanged'
  document: DocumentOut
  version: VersionOut
  new_chunks: number
  reused_chunks: number
}

export type ScopeMode = 'latest' | 'all' | 'version' | 'range'

export interface Scope {
  document_ids?: number[] | null
  mode: ScopeMode
  version?: number | null
  version_from?: number | null
  version_to?: number | null
}

export interface SearchRequest {
  query: string
  scope: Scope
  k?: number
  model?: string | null
}

export interface HitVersion {
  number: number
  label: string | null
  page: number | null
  heading: string | null
}

export interface SearchHit {
  chunk_id: number
  text: string
  score: number
  vector_score: number | null
  keyword_match: boolean
  document: { id: number; title: string }
  versions: HitVersion[]
}

export interface SearchResponse {
  query: string
  hits: SearchHit[]
}

export type WordOp = { op: 'equal' | 'insert' | 'delete'; text: string }

export type DiffBlock =
  | { type: 'equal'; paragraphs: string[] }
  | { type: 'added'; new: string }
  | { type: 'removed'; old: string }
  | { type: 'modified'; old: string; new: string; similarity: number; segments: WordOp[] }

export interface DiffStats {
  added: number
  removed: number
  modified: number
  unchanged: number
}

export interface DiffResult {
  document: DocumentOut
  old: VersionOut
  new: VersionOut
  stats: DiffStats
  chunk_stats: { shared: number; only_old: number; only_new: number }
  blocks: DiffBlock[]
}

export interface ModelInfo {
  name: string
  family?: string | null
  parameter_size?: string | null
  quantization?: string | null
  size_bytes?: number | null
}

export interface Health {
  status: string
  version: string
  embedding_model: string
  llm: {
    provider: string
    default_model: string
    reachable: boolean
    models: string[]
    /** Size/family per model, for the model picker (absent on older backends). */
    model_details?: ModelInfo[]
    error?: string
  }
  guardrails?: { moderation: string | null; redact_pii: boolean }
  stats: { documents: number; versions: number; chunks: number; vectors: number }
  limits: { max_upload_mb: number; max_storage_mb?: number }
  /** Whether the backend requires an API key for changes / for everything. */
  auth?: { write: boolean; read: boolean }
}

/** Server-side check of an answer's [n] citations against the sources it was given. */
export interface AnswerCheck {
  cited: number[]
  invalid: number[]
  uncited: boolean
  source_count: number
  /** Sources containing text that tries to instruct the model (possible prompt injection). */
  suspicious_sources?: number[]
}

export interface StreamHandlers {
  onSources?: (hits: SearchHit[]) => void
  onCheck?: (check: AnswerCheck) => void
  /** The model that is actually answering. */
  onModel?: (model: string) => void
  /** The question was refused by the safety check. */
  onBlocked?: (info: { categories: string[]; labels: string[] }) => void
  onToken: (token: string) => void
  onError?: (message: string) => void
}
