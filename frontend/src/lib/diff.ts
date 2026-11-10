import type { DiffBlock, DiffStats, WordOp } from '../api/types'

/** Mirrors backend/app/diff.py so demo mode shows the same kind of diff. */
export const MODIFIED_THRESHOLD = 0.4

export function splitParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
}

type Opcode = ['equal' | 'delete' | 'insert' | 'replace', number, number, number, number]

/** LCS-based opcodes in the style of Python's difflib.SequenceMatcher. */
export function opcodes<T>(a: T[], b: T[]): { codes: Opcode[]; matches: number } {
  const n = a.length
  const m = b.length
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const codes: Opcode[] = []
  let i = 0
  let j = 0
  const push = (tag: Opcode[0], i1: number, i2: number, j1: number, j2: number) => {
    const last = codes[codes.length - 1]
    if (last && last[0] === tag) {
      last[2] = i2
      last[4] = j2
    } else if (last && tag !== 'equal' && last[0] !== 'equal') {
      last[0] = 'replace'
      last[2] = i2
      last[4] = j2
    } else codes.push([tag, i1, i2, j1, j2])
  }
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      push('equal', i, i + 1, j, j + 1)
      i++
      j++
    } else if (j < m && (i >= n || dp[i][j + 1] >= dp[i + 1][j])) {
      push('insert', i, i, j, j + 1)
      j++
    } else {
      push('delete', i, i + 1, j, j)
      i++
    }
  }
  return { codes, matches: dp[0][0] }
}

export function wordSegments(oldText: string, newText: string): { segments: WordOp[]; ratio: number } {
  const a = oldText.match(/\S+\s*/g) ?? []
  const b = newText.match(/\S+\s*/g) ?? []
  const { codes, matches } = opcodes(a, b)
  const segments: WordOp[] = []
  for (const [tag, i1, i2, j1, j2] of codes) {
    if (tag === 'equal') segments.push({ op: 'equal', text: a.slice(i1, i2).join('') })
    else {
      if (i2 > i1) segments.push({ op: 'delete', text: a.slice(i1, i2).join('') })
      if (j2 > j1) segments.push({ op: 'insert', text: b.slice(j1, j2).join('') })
    }
  }
  const total = a.length + b.length
  return { segments, ratio: total ? (2 * matches) / total : 1 }
}

export function diffTexts(oldText: string, newText: string): { blocks: DiffBlock[]; stats: DiffStats } {
  const a = splitParagraphs(oldText)
  const b = splitParagraphs(newText)
  const blocks: DiffBlock[] = []
  const stats: DiffStats = { added: 0, removed: 0, modified: 0, unchanged: 0 }
  const added = (p: string) => (blocks.push({ type: 'added', new: p }), stats.added++)
  const removed = (p: string) => (blocks.push({ type: 'removed', old: p }), stats.removed++)

  for (const [tag, i1, i2, j1, j2] of opcodes(a, b).codes) {
    if (tag === 'equal') {
      blocks.push({ type: 'equal', paragraphs: a.slice(i1, i2) })
      stats.unchanged += i2 - i1
    } else if (tag === 'delete') a.slice(i1, i2).forEach(removed)
    else if (tag === 'insert') b.slice(j1, j2).forEach(added)
    else {
      const olds = a.slice(i1, i2)
      const news = b.slice(j1, j2)
      for (let k = 0; k < Math.max(olds.length, news.length); k++) {
        const o = olds[k]
        const nw = news[k]
        if (o !== undefined && nw !== undefined) {
          const { segments, ratio } = wordSegments(o, nw)
          if (ratio >= MODIFIED_THRESHOLD) {
            blocks.push({ type: 'modified', old: o, new: nw, similarity: Math.round(ratio * 1000) / 1000, segments })
            stats.modified++
            continue
          }
        }
        if (o !== undefined) removed(o)
        if (nw !== undefined) added(nw)
      }
    }
  }
  return { blocks, stats }
}
