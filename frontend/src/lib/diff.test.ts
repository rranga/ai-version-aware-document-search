import { describe, expect, it } from 'vitest'
import { DemoApi } from '../api/demo'
import { diffTexts, wordSegments } from './diff'

describe('diffTexts', () => {
  it('detects modified, added and removed paragraphs', () => {
    const { stats, blocks } = diffTexts('A stays.\n\nRefund within 30 days.\n\nOld note.', 'A stays.\n\nRefund within 14 days.\n\nBrand new section about shipping costs.')
    expect(stats.unchanged).toBe(1)
    expect(stats.modified).toBe(1)
    expect(stats.added + stats.removed).toBe(2)
    const mod = blocks.find((b) => b.type === 'modified')
    expect(mod && mod.type === 'modified' && mod.segments.some((s) => s.op === 'insert' && s.text.includes('14'))).toBe(true)
  })

  it('reports identical texts as unchanged', () => {
    expect(diffTexts('x\n\ny', 'x\n\ny').stats).toEqual({ added: 0, removed: 0, modified: 0, unchanged: 2 })
  })

  it('computes a similarity ratio', () => {
    expect(wordSegments('a b c d', 'a b c d').ratio).toBe(1)
    expect(wordSegments('a b', 'c d').ratio).toBe(0)
  })
})

describe('DemoApi', () => {
  it('scopes search to a specific version', async () => {
    const api = new DemoApi()
    const [travel] = (await api.listDocuments()).filter((d) => d.title.startsWith('Travel'))
    const v1 = await api.search({ query: 'expense claims submitted days', scope: { document_ids: [travel.id], mode: 'version', version: 1 } })
    expect(v1.hits[0].text).toContain('60 days')
    const latest = await api.search({ query: 'expense claims submitted days', scope: { document_ids: [travel.id], mode: 'latest' } })
    expect(latest.hits[0].text).toContain('30 days')
  })

  it('groups identical passages across versions', async () => {
    const api = new DemoApi()
    const [travel] = (await api.listDocuments()).filter((d) => d.title.startsWith('Travel'))
    const all = await api.search({ query: 'per diem meals allowance', scope: { document_ids: [travel.id], mode: 'all' } })
    const v2v3 = all.hits.find((h) => h.text.includes('45 EUR'))
    expect(v2v3?.versions.map((v) => v.number)).toEqual([3, 2])
  })
})
