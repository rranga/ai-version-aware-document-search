import { afterEach, describe, expect, it, vi } from 'vitest'
import { HttpApi, consumeEventStream } from './client'
import type { AnswerCheck, SearchHit } from './types'

const sse = (...events: [string, unknown][]) =>
  new Response(events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join(''))

describe('consumeEventStream', () => {
  it('dispatches sources, tokens, the citation check, and errors', async () => {
    const check: AnswerCheck = { cited: [1], invalid: [4], uncited: false, source_count: 2 }
    const got = { sources: [] as SearchHit[], text: '', check: null as AnswerCheck | null, error: '' }
    await consumeEventStream(
      sse(['sources', []], ['token', 'Hello '], ['token', '[1]'], ['check', check], ['error', 'boom'], ['done', {}]),
      {
        onSources: (s) => (got.sources = s),
        onToken: (t) => (got.text += t),
        onCheck: (c) => (got.check = c),
        onError: (e) => (got.error = e),
      },
    )
    expect(got).toEqual({ sources: [], text: 'Hello [1]', check, error: 'boom' })
  })
})

describe('HttpApi', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('sends the API key header on JSON and streaming requests', async () => {
    const seen: Headers[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        seen.push(new Headers(init.headers))
        return _url.endsWith('/api/ask') ? sse(['done', {}]) : Response.json([])
      }),
    )
    const api = new HttpApi('http://x/', ' k3y ')
    await api.listDocuments()
    await api.ask({ query: 'q', scope: { mode: 'latest' } }, { onToken: () => {} })
    expect(seen.map((h) => h.get('X-API-Key'))).toEqual(['k3y', 'k3y'])
    expect(seen[1].get('Content-Type')).toBe('application/json')
  })

  it('omits the header without a key and reports a rejected key', async () => {
    const seen: Headers[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        seen.push(new Headers(init.headers))
        return Response.json({ detail: 'This backend requires an API key for changes.' }, { status: 401 })
      }),
    )
    const api = new HttpApi('http://x')
    expect(await api.checkKey()).toBe(false)
    expect(seen[0].has('X-API-Key')).toBe(false)
    await expect(api.deleteDocument(1)).rejects.toThrow('requires an API key')
  })
})

describe('consumeEventStream model + safety events', () => {
  it('reports the answering model and a blocked question', async () => {
    const got: { model?: string; blocked?: string[] } = {}
    await consumeEventStream(
      sse(['sources', []], ['model', 'qwen2.5:7b'], ['blocked', { categories: ['S9'], labels: ['indiscriminate weapons'] }], ['token', 'No.'], ['done', {}]),
      { onToken: () => {}, onModel: (m) => (got.model = m), onBlocked: (b) => (got.blocked = b.labels) },
    )
    expect(got).toEqual({ model: 'qwen2.5:7b', blocked: ['indiscriminate weapons'] })
  })
})
