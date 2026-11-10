import type {
  DiffResult,
  DocumentDetail,
  DocumentOut,
  Health,
  IngestResult,
  SearchRequest,
  SearchResponse,
  StreamHandlers,
  VersionOut,
} from './types'

export interface UploadOptions {
  title?: string
  documentId?: number | null
  label?: string
}

export interface Api {
  readonly mode: 'live' | 'demo'
  health(): Promise<Health>
  /** True if the configured API key is accepted for changes. */
  checkKey(): Promise<boolean>
  listDocuments(): Promise<DocumentOut[]>
  getDocument(id: number): Promise<DocumentDetail>
  upload(file: File, opts?: UploadOptions): Promise<IngestResult>
  addUrl(url: string, opts?: UploadOptions): Promise<IngestResult>
  refresh(id: number, label?: string): Promise<IngestResult>
  versionText(id: number, number: number): Promise<{ version: VersionOut; text: string }>
  setVersionLabel(id: number, number: number, label: string | null): Promise<VersionOut>
  renameDocument(id: number, title: string): Promise<DocumentDetail>
  deleteVersion(id: number, number: number): Promise<void>
  deleteDocument(id: number): Promise<void>
  diff(id: number, from: number, to: number): Promise<DiffResult>
  search(req: SearchRequest): Promise<SearchResponse>
  ask(req: SearchRequest, handlers: StreamHandlers, signal?: AbortSignal): Promise<void>
  diffSummary(
    id: number,
    from: number,
    to: number,
    model: string | null,
    handlers: StreamHandlers,
    signal?: AbortSignal,
  ): Promise<void>
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

function detailMessage(body: unknown, status: number): string {
  if (body && typeof body === 'object' && 'detail' in body) {
    const detail = (body as { detail: unknown }).detail
    if (typeof detail === 'string') return detail
    if (Array.isArray(detail)) {
      return detail
        .map((d) => (d && typeof d === 'object' && 'msg' in d ? String((d as { msg: unknown }).msg) : String(d)))
        .join('; ')
    }
  }
  return `Request failed (HTTP ${status})`
}

/** Parse a text/event-stream response body into handler callbacks. */
export async function consumeEventStream(resp: Response, handlers: StreamHandlers): Promise<void> {
  if (!resp.body) throw new ApiError('Empty response stream', resp.status)
  const reader = resp.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const dispatch = (block: string) => {
    let event = 'message'
    const data: string[] = []
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) data.push(line.slice(5).trimStart())
    }
    if (!data.length) return
    const payload = JSON.parse(data.join('\n'))
    if (event === 'sources') handlers.onSources?.(payload)
    else if (event === 'token') handlers.onToken(payload)
    else if (event === 'error') handlers.onError?.(payload)
    else if (event === 'check') handlers.onCheck?.(payload)
    else if (event === 'model') handlers.onModel?.(payload)
    else if (event === 'blocked') handlers.onBlocked?.(payload)
  }
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')
    let idx
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      dispatch(buffer.slice(0, idx))
      buffer = buffer.slice(idx + 2)
    }
  }
  if (buffer.trim()) dispatch(buffer)
}

export class HttpApi implements Api {
  readonly mode = 'live' as const
  private readonly base: string
  private readonly apiKey: string

  constructor(baseUrl: string, apiKey = '') {
    this.base = baseUrl.replace(/\/+$/, '')
    this.apiKey = apiKey.trim()
  }

  private headers(extra?: HeadersInit): Headers {
    const h = new Headers(extra)
    if (this.apiKey) h.set('X-API-Key', this.apiKey)
    return h
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    let resp: Response
    try {
      resp = await fetch(`${this.base}${path}`, { ...init, headers: this.headers(init.headers) })
    } catch {
      throw new ApiError(`Cannot reach the backend at ${this.base}. Is it running, and does it allow this origin (CORS)?`, 0)
    }
    if (!resp.ok) {
      const body = await resp.json().catch(() => null)
      throw new ApiError(detailMessage(body, resp.status), resp.status)
    }
    if (resp.status === 204) return undefined as T
    return resp.json() as Promise<T>
  }

  private json<T>(path: string, method: string, body: unknown): Promise<T> {
    return this.request<T>(path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  private async stream(path: string, body: unknown, handlers: StreamHandlers, signal?: AbortSignal) {
    let resp: Response
    try {
      resp = await fetch(`${this.base}${path}`, {
        method: 'POST',
        headers: this.headers({ 'Content-Type': 'application/json' }),
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
      })
    } catch (e) {
      if ((e as Error).name === 'AbortError') return
      throw new ApiError(`Cannot reach the backend at ${this.base}.`, 0)
    }
    if (!resp.ok) {
      const json = await resp.json().catch(() => null)
      throw new ApiError(detailMessage(json, resp.status), resp.status)
    }
    await consumeEventStream(resp, handlers)
  }

  health() {
    return this.request<Health>('/api/health')
  }
  async checkKey() {
    try {
      await this.request<void>('/api/auth/check')
      return true
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return false
      throw e
    }
  }
  listDocuments() {
    return this.request<DocumentOut[]>('/api/documents')
  }
  getDocument(id: number) {
    return this.request<DocumentDetail>(`/api/documents/${id}`)
  }
  upload(file: File, opts: UploadOptions = {}) {
    const form = new FormData()
    form.append('file', file)
    if (opts.title) form.append('title', opts.title)
    if (opts.documentId) form.append('document_id', String(opts.documentId))
    if (opts.label) form.append('label', opts.label)
    return this.request<IngestResult>('/api/documents', { method: 'POST', body: form })
  }
  addUrl(url: string, opts: UploadOptions = {}) {
    return this.json<IngestResult>('/api/documents/url', 'POST', {
      url,
      title: opts.title || null,
      document_id: opts.documentId || null,
      label: opts.label || null,
    })
  }
  refresh(id: number, label?: string) {
    const q = label ? `?label=${encodeURIComponent(label)}` : ''
    return this.request<IngestResult>(`/api/documents/${id}/refresh${q}`, { method: 'POST' })
  }
  versionText(id: number, number: number) {
    return this.request<{ version: VersionOut; text: string }>(`/api/documents/${id}/versions/${number}`)
  }
  setVersionLabel(id: number, number: number, label: string | null) {
    return this.json<VersionOut>(`/api/documents/${id}/versions/${number}`, 'PATCH', { label })
  }
  renameDocument(id: number, title: string) {
    return this.json<DocumentDetail>(`/api/documents/${id}`, 'PATCH', { title })
  }
  deleteVersion(id: number, number: number) {
    return this.request<void>(`/api/documents/${id}/versions/${number}`, { method: 'DELETE' })
  }
  deleteDocument(id: number) {
    return this.request<void>(`/api/documents/${id}`, { method: 'DELETE' })
  }
  diff(id: number, from: number, to: number) {
    return this.request<DiffResult>(`/api/documents/${id}/diff?from=${from}&to=${to}`)
  }
  search(req: SearchRequest) {
    return this.json<SearchResponse>('/api/search', 'POST', req)
  }
  ask(req: SearchRequest, handlers: StreamHandlers, signal?: AbortSignal) {
    return this.stream('/api/ask', req, handlers, signal)
  }
  diffSummary(id: number, from: number, to: number, model: string | null, handlers: StreamHandlers, signal?: AbortSignal) {
    const m = model ? `&model=${encodeURIComponent(model)}` : ''
    return this.stream(`/api/documents/${id}/diff/summary?from=${from}&to=${to}${m}`, undefined, handlers, signal)
  }
}
