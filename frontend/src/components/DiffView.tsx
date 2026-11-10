import { ChevronsUpDown, Minus, PenLine, Plus } from 'lucide-react'
import { useState } from 'react'
import type { DiffBlock } from '../api/types'
import { stripHeading } from '../lib/text'

function Para({ text, className = '' }: { text: string; className?: string }) {
  const { heading, text: body } = stripHeading(text)
  return <p className={`${heading ? 'font-semibold' : ''} whitespace-pre-line ${className}`}>{body}</p>
}

const tag = 'inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide'

export function DiffView({ blocks, showUnchanged }: { blocks: DiffBlock[]; showUnchanged: boolean }) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const toggle = (i: number) =>
    setExpanded((s) => {
      const next = new Set(s)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })

  return (
    <div className="space-y-2 text-[15px] leading-relaxed">
      {blocks.map((b, i) => {
        switch (b.type) {
          case 'equal': {
            if (showUnchanged || expanded.has(i)) {
              return (
                <div key={i} className="space-y-2 border-l-2 border-transparent pl-4 text-muted">
                  {b.paragraphs.map((p, j) => (
                    <Para key={j} text={p} />
                  ))}
                </div>
              )
            }
            return (
              <button
                key={i}
                onClick={() => toggle(i)}
                className="flex w-full items-center gap-2 rounded-lg border border-dashed border-line px-4 py-1.5 text-xs text-muted hover:bg-surface-2"
              >
                <ChevronsUpDown className="size-3.5" />
                {b.paragraphs.length} unchanged paragraph{b.paragraphs.length === 1 ? '' : 's'}
              </button>
            )
          }
          case 'added':
            return (
              <div key={i} className="rounded-r-lg border-l-4 border-add-line bg-add px-4 py-2">
                <span className={`${tag} text-add-fg`}>
                  <Plus className="size-3" /> Added
                </span>
                <Para text={b.new} />
              </div>
            )
          case 'removed':
            return (
              <div key={i} className="rounded-r-lg border-l-4 border-del-line bg-del px-4 py-2">
                <span className={`${tag} text-del-fg`}>
                  <Minus className="size-3" /> Removed
                </span>
                <Para text={b.old} className="text-del-fg/90 line-through decoration-del-fg/40" />
              </div>
            )
          case 'modified':
            return (
              <div key={i} className="rounded-r-lg border-l-4 border-mod-line bg-surface px-4 py-2 ring-1 ring-line">
                <span className={`${tag} text-mod-fg`}>
                  <PenLine className="size-3" /> Changed
                </span>
                <p className="whitespace-pre-line">
                  {b.segments.map((s, j) =>
                    s.op === 'equal' ? (
                      <span key={j}>{s.text.replace(/^#{1,6}\s+/, '')}</span>
                    ) : s.op === 'delete' ? (
                      <del key={j} className="rounded bg-del px-0.5 text-del-fg decoration-del-fg/60">
                        {s.text}
                      </del>
                    ) : (
                      <ins key={j} className="rounded bg-add px-0.5 text-add-fg no-underline">
                        {s.text}
                      </ins>
                    ),
                  )}
                </p>
              </div>
            )
        }
      })}
    </div>
  )
}
