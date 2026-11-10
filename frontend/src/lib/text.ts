import type { HitVersion, VersionOut } from '../api/types'

export function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export function versionName(v: Pick<VersionOut, 'number' | 'label'>): string {
  return v.label ? `v${v.number} · ${v.label}` : `v${v.number}`
}

/** "v3", "v1–v3" for a consecutive run, otherwise "v1, v3". */
export function versionSpan(versions: HitVersion[]): string {
  const nums = [...new Set(versions.map((v) => v.number))].sort((a, b) => a - b)
  if (nums.length === 1) return `v${nums[0]}`
  const consecutive = nums.every((n, i) => i === 0 || n === nums[i - 1] + 1)
  return consecutive ? `v${nums[0]}–v${nums[nums.length - 1]}` : nums.map((n) => `v${n}`).join(', ')
}

const STOP = new Set('the and for with what when where which who why how does this that about from are was is'.split(' '))

export function queryTerms(query: string): string[] {
  return [...new Set((query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((t) => t.length > 2 && !STOP.has(t)))]
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Strip markdown heading markers for display. */
export function stripHeading(p: string): { heading: boolean; text: string } {
  const m = p.match(/^#{1,6}\s+(.*)$/s)
  return m ? { heading: true, text: m[1] } : { heading: false, text: p }
}
