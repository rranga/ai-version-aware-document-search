import { Check, ChevronDown } from 'lucide-react'
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

export interface DropdownOption<T> {
  value: T
  label: string
  description?: string
  badge?: string
  icon?: ReactNode
  disabled?: boolean
  /** Shown as a tooltip, e.g. why the option is disabled. */
  hint?: string
}

/** Compact pill button that opens a menu of options (ChatGPT-style). Keeps
 *  itself on screen: the menu opens towards whichever side has room. */
export function Dropdown<T>({
  label,
  icon,
  title,
  heading,
  options,
  value,
  onChange,
  footer,
  disabled,
  className = '',
}: {
  /** Text on the button (usually the selected option). */
  label: ReactNode
  icon?: ReactNode
  /** Accessible name and tooltip for the button. */
  title: string
  heading?: string
  options: DropdownOption<T>[]
  value: T
  onChange: (value: T) => void
  footer?: ReactNode
  disabled?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [focus, setFocus] = useState(0)
  const [alignRight, setAlignRight] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const items = useRef<(HTMLButtonElement | null)[]>([])
  const menuId = useId()

  const selected = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  )
  const enabled = options.map((o, i) => (o.disabled ? -1 : i)).filter((i) => i >= 0)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent | TouchEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('touchstart', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('touchstart', close)
    }
  }, [open])

  // Open towards the side with room so the menu never runs off a phone screen.
  useLayoutEffect(() => {
    if (!open || !root.current || !menu.current) return
    const button = root.current.getBoundingClientRect()
    const width = menu.current.offsetWidth
    setAlignRight(button.left + width > window.innerWidth - 8 && button.right - width >= 8)
  }, [open])

  useEffect(() => {
    if (open) items.current[focus]?.focus()
  }, [open, focus])

  const openAt = (i: number) => {
    setFocus(enabled.includes(i) ? i : (enabled[0] ?? 0))
    setOpen(true)
  }
  const move = (delta: number) => {
    if (!enabled.length) return
    const pos = enabled.indexOf(focus)
    setFocus(enabled[(pos + delta + enabled.length) % enabled.length])
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && open) {
      e.stopPropagation()
      setOpen(false)
      root.current?.querySelector<HTMLButtonElement>('button')?.focus()
      return
    }
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        openAt(selected)
      }
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      move(1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      move(-1)
    } else if (e.key === 'Home') {
      e.preventDefault()
      setFocus(enabled[0] ?? 0)
    } else if (e.key === 'End') {
      e.preventDefault()
      setFocus(enabled[enabled.length - 1] ?? 0)
    } else if (e.key === 'Tab') {
      setOpen(false)
    }
  }

  return (
    <div ref={root} className={`relative min-w-0 ${className}`} onKeyDown={onKey}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={title}
        title={title}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openAt(selected))}
        className="flex h-9 w-full max-w-full min-w-0 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-semibold text-fg hover:bg-surface-2 disabled:opacity-50 aria-expanded:bg-surface-2"
      >
        {icon}
        <span className="min-w-0 truncate">{label}</span>
        <ChevronDown className={`ml-auto size-3.5 shrink-0 text-muted ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          ref={menu}
          id={menuId}
          role="menu"
          aria-label={title}
          className={`absolute top-full z-50 mt-1.5 w-72 max-w-[calc(100vw-1rem)] overflow-hidden rounded-xl border border-line bg-surface p-1 shadow-lg ${
            alignRight ? 'right-0' : 'left-0'
          }`}
        >
          {heading && <div className="px-2.5 pt-1.5 pb-1 text-[11px] font-semibold tracking-wide text-muted uppercase">{heading}</div>}
          {options.map((o, i) => (
            <button
              key={o.label}
              ref={(el) => {
                items.current[i] = el
              }}
              type="button"
              role="menuitemradio"
              aria-checked={i === selected}
              aria-disabled={o.disabled || undefined}
              tabIndex={i === focus ? 0 : -1}
              title={o.hint}
              onClick={() => {
                if (o.disabled) return
                onChange(o.value)
                setOpen(false)
              }}
              className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left outline-none hover:bg-surface-2 focus-visible:bg-surface-2 aria-disabled:cursor-not-allowed aria-disabled:opacity-45 aria-disabled:hover:bg-transparent"
            >
              {o.icon && <span className="mt-0.5 shrink-0 text-muted">{o.icon}</span>}
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  <span className="truncate">{o.label}</span>
                  {o.badge && <span className="shrink-0 rounded bg-surface-2 px-1 text-[10px] font-semibold text-muted">{o.badge}</span>}
                </span>
                {o.description && <span className="block text-xs text-muted">{o.description}</span>}
              </span>
              {i === selected && <Check className="mt-0.5 size-4 shrink-0 text-accent" />}
            </button>
          ))}
          {footer && <div className="px-2.5 py-2 text-xs text-muted">{footer}</div>}
        </div>
      )}
    </div>
  )
}
