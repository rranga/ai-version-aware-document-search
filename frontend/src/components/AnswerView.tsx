import { ShieldAlert, Sparkles } from 'lucide-react'
import Markdown, { defaultUrlTransform } from 'react-markdown'
import type { AnswerCheck } from '../api/types'
import { ErrorNote } from './ui'

/** Streams an LLM answer; "[n]" citations become buttons that jump to source n. */
export function AnswerView({
  answer,
  streaming,
  error,
  onCite,
  title = 'Answer',
  sourceCount,
  check,
  model,
  blocked,
}: {
  answer: string
  streaming: boolean
  error?: string | null
  onCite?: (n: number) => void
  title?: string
  /** Number of sources the answer was given; citations outside 1..n are flagged. */
  sourceCount?: number
  /** Backend verdict on the answer's citations, sent after streaming. */
  check?: AnswerCheck | null
  /** Model that produced the answer, shown in the header. */
  model?: string | null
  /** Safety-check categories when the question was refused. */
  blocked?: string[] | null
}) {
  const md = answer
    // "[1, 2]" -> "[1][2]" so each becomes its own citation button
    .replace(/\[(\d{1,3}(?:\s*,\s*\d{1,3})+)\]/g, (_, list: string) => list.split(/\s*,\s*/).map((n) => `[${n}]`).join(''))
    .replace(/\[(\d{1,3})\](?!\()/g, (_, n) => `[${n}](cite:${n})`)
  const exists = (n: number) => sourceCount === undefined || (n >= 1 && n <= sourceCount)
  return (
    <section className="rounded-xl border border-line bg-surface p-5" aria-live="polite">
      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-accent">
        <Sparkles className="size-4" />
        {title}
        {model && (
          <span className="ml-auto truncate rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] font-medium text-muted" title="Model that wrote this answer">
            {model}
          </span>
        )}
      </h2>
      {blocked && (
        <div className="mb-3 flex gap-2 rounded-lg border border-del-fg/30 bg-del px-3 py-2 text-sm text-del-fg" role="note">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" />
          <span>Blocked by the safety check{blocked.length ? `: ${blocked.join(', ')}` : ''}.</span>
        </div>
      )}
      {answer ? (
        <div className={`prose-answer text-[15px] leading-relaxed ${streaming ? 'caret' : ''}`}>
          <Markdown
            urlTransform={(url) => (url.startsWith('cite:') ? url : defaultUrlTransform(url))}
            components={{
              a: ({ href, children }) => {
                if (href?.startsWith('cite:')) {
                  const n = Number(href.slice(5))
                  if (!exists(n)) {
                    return (
                      <span
                        className="mx-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded border border-dashed border-del-fg/50 px-1 align-middle text-[11px] font-semibold text-del-fg line-through"
                        title="This source doesn’t exist — the model cited it by mistake"
                      >
                        {n}
                      </span>
                    )
                  }
                  return (
                    <button
                      type="button"
                      onClick={() => onCite?.(n)}
                      className="mx-0.5 inline-flex h-5 min-w-5 -translate-y-px items-center justify-center rounded bg-accent-soft px-1 align-middle text-[11px] font-semibold text-accent hover:bg-accent hover:text-accent-fg"
                      aria-label={`Go to source ${n}`}
                    >
                      {n}
                    </button>
                  )
                }
                return (
                  <a href={href} target="_blank" rel="noreferrer" className="text-accent underline">
                    {children}
                  </a>
                )
              },
            }}
          >
            {md}
          </Markdown>
        </div>
      ) : streaming ? (
        <div className="space-y-2" aria-label="Generating">
          <div className="h-3 w-11/12 animate-pulse rounded bg-surface-2" />
          <div className="h-3 w-4/5 animate-pulse rounded bg-surface-2" />
          <div className="h-3 w-2/3 animate-pulse rounded bg-surface-2" />
        </div>
      ) : null}
      {!streaming && !!check?.suspicious_sources?.length && (
        <div className="mt-3 flex gap-2 rounded-lg border border-del-fg/30 bg-del px-3 py-2 text-sm text-del-fg" role="note">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" />
          <span>
            {check.suspicious_sources.length === 1 ? 'Source ' : 'Sources '}
            {check.suspicious_sources.map((n) => `[${n}]`).join(', ')}{' '}
            {check.suspicious_sources.length === 1 ? 'contains' : 'contain'} text that tries to give instructions to AI assistants. It
            was treated as document content only, but check the answer against the sources.
          </span>
        </div>
      )}
      {!streaming && check && (check.invalid.length > 0 || check.uncited) && (
        <div className="mt-3 flex gap-2 rounded-lg border border-mod-line bg-mod px-3 py-2 text-sm text-mod-fg" role="note">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" />
          <span>
            {check.invalid.length > 0
              ? `This answer cites ${check.invalid.length === 1 ? 'a source' : 'sources'} that don’t exist (${check.invalid
                  .map((n) => `[${n}]`)
                  .join(', ')}). Treat those statements with caution and check the passages below.`
              : 'This answer doesn’t cite any source. Check it against the passages below before relying on it.'}
          </span>
        </div>
      )}
      {error && (
        <div className="mt-3">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
    </section>
  )
}
