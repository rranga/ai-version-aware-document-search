import { diffTexts, splitParagraphs } from '../lib/diff'
import { ApiError, type Api, type UploadOptions } from './client'
import { DEMO_SEEDS } from './demoData'
import type {
  DiffResult,
  DocumentDetail,
  DocumentOut,
  Health,
  IngestResult,
  Scope,
  SearchHit,
  SearchRequest,
  StreamHandlers,
  VersionOut,
} from './types'

/**
 * In-browser stand-in for the backend, used when no backend URL is set
 * (e.g. the public GitHub Pages site). Keyword search only, no LLM; data
 * lives in memory and resets on reload.
 */

interface DemoChunk {
  text: string
  heading: string | null
}
interface DemoVersion extends VersionOut {
  text: string
  chunks: DemoChunk[]
}
interface DemoDoc {
  id: number
  title: string
  source_type: 'file' | 'url'
  source_ref: string
  created_at: string
  updated_at: string
  versions: DemoVersion[]
}

const STOPWORDS = new Set(
  'a an and are as at be by do does for from how in is it of on or the to was what when where which who why with this that about can i me my'.split(
    ' ',
  ),
)

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((t) => t.length > 1 && !STOPWORDS.has(t))
}

const stem = (t: string) => t.slice(0, Math.max(4, t.length - 2))

function chunkText(text: string): DemoChunk[] {
  const chunks: DemoChunk[] = []
  let heading: string | null = null
  for (const para of splitParagraphs(text)) {
    const m = para.match(/^#{1,6}\s+(.*)$/)
    if (m) {
      heading = m[1]
      continue
    }
    chunks.push({ text: para, heading })
  }
  return chunks
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export class DemoApi implements Api {
  readonly mode = 'demo' as const
  private docs: DemoDoc[] = []
  private nextDocId = 1
  private nextVersionId = 1

  constructor() {
    for (const seed of DEMO_SEEDS) {
      let doc: DemoDoc | undefined
      for (const v of seed.versions) {
        doc = this.addVersion(doc, seed.title, seed.source_name, v.text, v.label, v.date, 'file')
      }
    }
  }

  private addVersion(
    doc: DemoDoc | undefined,
    title: string,
    sourceName: string,
    text: string,
    label: string | null,
    date: string,
    sourceType: 'file' | 'url',
  ): DemoDoc {
    if (!doc) {
      doc = {
        id: this.nextDocId++,
        title,
        source_type: sourceType,
        source_ref: sourceName,
        created_at: date,
        updated_at: date,
        versions: [],
      }
      this.docs.push(doc)
    }
    const seen = new Set(doc.versions.flatMap((v) => v.chunks.map((c) => c.text)))
    const chunks = chunkText(text)
    doc.versions.push({
      id: this.nextVersionId++,
      number: doc.versions.length + 1,
      label: label || null,
      source_name: sourceName,
      mime: 'text/markdown',
      size_bytes: new TextEncoder().encode(text).length,
      chunk_count: chunks.length,
      new_chunk_count: chunks.filter((c) => !seen.has(c.text)).length,
      created_at: date,
      text,
      chunks,
    })
    doc.updated_at = date
    return doc
  }

  private doc(id: number): DemoDoc {
    const d = this.docs.find((x) => x.id === id)
    if (!d) throw new ApiError(`Document ${id} not found`, 404)
    return d
  }

  private version(d: DemoDoc, n: number): DemoVersion {
    const v = d.versions.find((x) => x.number === n)
    if (!v) throw new ApiError(`Version v${n} of document ${d.id} not found`, 404)
    return v
  }

  private out(d: DemoDoc): DocumentOut {
    const { versions, ...rest } = d
    return { ...rest, version_count: versions.length, latest_version: versions[versions.length - 1].number }
  }

  private vout(v: DemoVersion): VersionOut {
    const { text: _t, chunks: _c, ...rest } = v
    return rest
  }

  private needsBackend(what: string): never {
    throw new ApiError(`${what} needs the backend. Set a backend URL in Settings.`, 501)
  }

  async checkKey() {
    return true
  }

  async health(): Promise<Health> {
    const versions = this.docs.reduce((n, d) => n + d.versions.length, 0)
    const chunks = new Set(this.docs.flatMap((d) => d.versions.flatMap((v) => v.chunks.map((c) => c.text)))).size
    return {
      status: 'ok',
      version: 'demo',
      embedding_model: 'keyword (demo)',
      llm: { provider: 'none', default_model: '', reachable: false, models: [] },
      stats: { documents: this.docs.length, versions, chunks, vectors: 0 },
      limits: { max_upload_mb: 2 },
    }
  }

  async listDocuments() {
    return [...this.docs].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).map((d) => this.out(d))
  }

  async getDocument(id: number): Promise<DocumentDetail> {
    const d = this.doc(id)
    return { ...this.out(d), versions: [...d.versions].reverse().map((v) => this.vout(v)) }
  }

  async upload(file: File, opts: UploadOptions = {}): Promise<IngestResult> {
    if (!/\.(txt|md|markdown)$/i.test(file.name)) {
      this.needsBackend('Reading PDF, DOCX and HTML files')
    }
    if (file.size > 2 * 1024 * 1024) throw new ApiError('Demo mode accepts files up to 2 MB.', 413)
    const text = (await file.text()).trim()
    if (!text) throw new ApiError('The file is empty.', 422)
    let doc = opts.documentId ? this.doc(opts.documentId) : this.docs.find((d) => d.source_ref === file.name)
    const latest = doc?.versions[doc.versions.length - 1]
    if (doc && latest && latest.text === text) {
      return { status: 'unchanged', document: this.out(doc), version: this.vout(latest), new_chunks: 0, reused_chunks: latest.chunk_count }
    }
    const status = doc ? 'new_version' : 'created'
    const title = opts.title || file.name.replace(/\.[^.]+$/, '')
    doc = this.addVersion(doc, title, file.name, text, opts.label ?? null, new Date().toISOString(), 'file')
    if (opts.title) doc.title = opts.title
    const v = doc.versions[doc.versions.length - 1]
    return {
      status,
      document: this.out(doc),
      version: this.vout(v),
      new_chunks: v.new_chunk_count,
      reused_chunks: v.chunk_count - v.new_chunk_count,
    }
  }

  async addUrl(): Promise<IngestResult> {
    this.needsBackend('Adding documents from a link')
  }
  async refresh(): Promise<IngestResult> {
    this.needsBackend('Refreshing a link')
  }

  async versionText(id: number, number: number) {
    const v = this.version(this.doc(id), number)
    return { version: this.vout(v), text: v.text }
  }

  async setVersionLabel(id: number, number: number, label: string | null) {
    const v = this.version(this.doc(id), number)
    v.label = label?.trim() || null
    return this.vout(v)
  }

  async renameDocument(id: number, title: string) {
    this.doc(id).title = title
    return this.getDocument(id)
  }

  async deleteVersion(id: number, number: number) {
    const d = this.doc(id)
    d.versions = d.versions.filter((v) => v.number !== number)
    if (!d.versions.length) this.docs = this.docs.filter((x) => x.id !== id)
  }

  async deleteDocument(id: number) {
    this.docs = this.docs.filter((x) => x.id !== id)
  }

  async diff(id: number, from: number, to: number): Promise<DiffResult> {
    const d = this.doc(id)
    const a = this.version(d, from)
    const b = this.version(d, to)
    const sa = new Set(a.chunks.map((c) => c.text))
    const sb = new Set(b.chunks.map((c) => c.text))
    const { blocks, stats } = diffTexts(a.text, b.text)
    return {
      document: this.out(d),
      old: this.vout(a),
      new: this.vout(b),
      stats,
      chunk_stats: {
        shared: [...sa].filter((t) => sb.has(t)).length,
        only_old: [...sa].filter((t) => !sb.has(t)).length,
        only_new: [...sb].filter((t) => !sa.has(t)).length,
      },
      blocks,
    }
  }

  private scopedVersions(scope: Scope): { doc: DemoDoc; version: DemoVersion }[] {
    const docs = scope.document_ids?.length ? this.docs.filter((d) => scope.document_ids!.includes(d.id)) : this.docs
    return docs.flatMap((doc) => {
      const latest = doc.versions[doc.versions.length - 1].number
      return doc.versions
        .filter((v) => {
          switch (scope.mode) {
            case 'latest':
              return v.number === latest
            case 'version':
              return v.number === scope.version
            case 'range':
              return v.number >= (scope.version_from ?? 0) && v.number <= (scope.version_to ?? Infinity)
            default:
              return true
          }
        })
        .map((version) => ({ doc, version }))
    })
  }

  async search(req: SearchRequest) {
    const terms = [...new Set(tokenize(req.query))].map(stem)
    const k = req.k ?? 6
    const grouped = new Map<string, SearchHit & { raw: number }>()
    let chunkId = 0
    for (const { doc, version } of this.scopedVersions(req.scope)) {
      for (const chunk of version.chunks) {
        chunkId++
        const words = tokenize(chunk.text + ' ' + (chunk.heading ?? '')).map(stem)
        const hits = terms.filter((t) => words.includes(t)).length
        if (!hits) continue
        const raw = hits / terms.length + hits / (words.length + 10)
        const key = `${doc.id}\u0000${chunk.text}`
        const entry = grouped.get(key) ?? {
          chunk_id: chunkId,
          text: chunk.text,
          score: 0,
          raw,
          vector_score: null,
          keyword_match: true,
          document: { id: doc.id, title: doc.title },
          versions: [],
        }
        entry.versions.push({ number: version.number, label: version.label, page: null, heading: chunk.heading })
        grouped.set(key, entry)
      }
    }
    const ranked = [...grouped.values()].sort((a, b) => b.raw - a.raw).slice(0, k)
    const max = ranked[0]?.raw ?? 1
    const hits: SearchHit[] = ranked.map(({ raw, ...h }) => ({
      ...h,
      score: Math.round((raw / max) * 1e4) / 1e4,
      versions: h.versions.sort((a, b) => b.number - a.number),
    }))
    await sleep(150)
    return { query: req.query, hits }
  }

  async ask(req: SearchRequest, handlers: StreamHandlers) {
    const { hits } = await this.search(req)
    handlers.onSources?.(hits)
    const message = hits.length
      ? 'This is **demo mode**: no backend is connected, so answers are not generated. ' +
        'The most relevant passages for your question are listed below. ' +
        'Add a backend URL in **Settings** to get answers with citations from a local Ollama model.'
      : "I couldn't find anything relevant in the selected documents and versions."
    for (const word of message.split(/(?<= )/)) {
      handlers.onToken(word)
      await sleep(12)
    }
  }

  async diffSummary(): Promise<void> {
    this.needsBackend('AI change summaries')
  }
}
