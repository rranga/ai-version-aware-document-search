import { FileText, Hash } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { SearchHit } from '../api/types'
import { escapeRegExp, queryTerms, versionSpan } from '../lib/text'
import { Badge } from './ui'

export function Highlight({ text, query }: { text: string; query: string }) {
  const parts = useMemo(() => {
    const terms = queryTerms(query)
    if (!terms.length) return [text]
    const re = new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'gi')
    return text.split(re)
  }, [text, query])
  return (
    <>
      {parts.map((p, i) => (i % 2 === 1 ? <mark key={i}>{p}</mark> : <span key={i}>{p}</span>))}
    </>
  )
}

export function SourceCard({
  hit,
  index,
  query,
  showVersionSpread,
  active,
  suspicious,
}: {
  hit: SearchHit
  index: number
  query: string
  showVersionSpread: boolean
  active?: boolean
  /** Passage contains text addressed to an AI (possible prompt injection). */
  suspicious?: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const first = hit.versions[0]
  // The section heading is shown in the header; don't repeat it as the first line.
  let body = hit.text
  if (first.heading && body.startsWith(first.heading)) body = body.slice(first.heading.length).trimStart() || hit.text
  body = body.replace(/\n\s*\n/g, '\n')
  const long = body.length > 420
  const text = expanded || !long ? body : body.slice(0, 400).replace(/\s+\S*$/, '') + '…'
  const latestOnly = showVersionSpread && hit.versions.length === 1

  return (
    <article
      id={`src-${index}`}
      className={`scroll-mt-24 rounded-xl border bg-surface p-4 transition-shadow ${active ? 'border-accent ring-2 ring-accent/30' : 'border-line'}`}
    >
      <header className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span className="flex size-6 items-center justify-center rounded-md bg-accent-soft text-xs font-semibold text-accent">{index}</span>
        <Link to={`/documents/${hit.document.id}`} className="flex min-w-0 items-center gap-1.5 font-medium hover:text-accent">
          <FileText className="size-3.5 shrink-0 text-muted" />
          <span className="truncate">{hit.document.title}</span>
        </Link>
        <Badge tone="accent" title={hit.versions.map((v) => (v.label ? `v${v.number} (${v.label})` : `v${v.number}`)).join(', ')}>
          {versionSpan(hit.versions)}
          {hit.versions.length === 1 && first.label ? ` · ${first.label}` : ''}
        </Badge>
        {latestOnly && <Badge tone="mod">only in this version</Badge>}
        {suspicious && (
          <Badge tone="del" title="This passage contains text that tries to give instructions to AI assistants. It was treated as document content only.">
            contains AI instructions
          </Badge>
        )}
        {first.page != null && <Badge>p. {first.page}</Badge>}
        {first.heading && (
          <span className="flex min-w-0 items-center gap-1 text-xs text-muted">
            <Hash className="size-3" />
            <span className="truncate">{first.heading}</span>
          </span>
        )}
        <span className="ml-auto text-xs text-muted tabular-nums" title="Relevance (hybrid semantic + keyword rank)">
          {Math.round(hit.score * 100)}%
        </span>
      </header>
      <p className="text-[15px] leading-relaxed whitespace-pre-line">
        <Highlight text={text} query={query} />
      </p>
      {long && (
        <button className="mt-2 text-xs font-medium text-accent hover:underline" onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Show less' : 'Show full passage'}
        </button>
      )}
    </article>
  )
}
