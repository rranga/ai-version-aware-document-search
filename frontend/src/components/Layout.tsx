import { GitCompareArrows, Library, Menu, Search, Settings, X } from 'lucide-react'
import { useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useApp } from '../lib/settings'

const NAV = [
  { to: '/', label: 'Search', icon: Search },
  { to: '/library', label: 'Library', icon: Library },
  { to: '/compare', label: 'Compare', icon: GitCompareArrows },
  { to: '/settings', label: 'Settings', icon: Settings },
]

function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <svg viewBox="0 0 32 32" className="size-8 shrink-0" aria-hidden>
        <rect width="32" height="32" rx="8" className="fill-accent" />
        <path d="M9 8h9l5 5v11a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" fill="none" stroke="var(--accent-fg)" strokeWidth="2" />
        <circle cx="15" cy="17" r="3.2" fill="none" stroke="var(--accent-fg)" strokeWidth="2" />
        <path d="M17.5 19.5l2.5 2.5" stroke="var(--accent-fg)" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <div className="min-w-0 leading-tight">
        <div className="font-semibold tracking-tight">AI Version-Aware Document Search</div>
        <div className="text-[11px] text-muted">Search · compare · ask</div>
      </div>
    </div>
  )
}

export function ConnectionPill() {
  const { api, health } = useApp()
  let dot = 'bg-muted'
  let text = 'Connecting…'
  if (api.mode === 'demo') {
    dot = 'bg-amber-500'
    text = 'Demo mode'
  } else if (health.status === 'error') {
    dot = 'bg-red-500'
    text = 'Backend offline'
  } else if (health.status === 'ok') {
    dot = health.data.llm.reachable ? 'bg-emerald-500' : 'bg-amber-500'
    text = health.data.llm.reachable ? 'Connected' : 'Connected · LLM offline'
  }
  return (
    <NavLink to="/settings" className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-muted hover:bg-surface-2 hover:text-fg">
      <span className={`size-2 rounded-full ${dot}`} />
      {text}
    </NavLink>
  )
}

function NavItems({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-0.5">
      {NAV.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          onClick={onNavigate}
          className={({ isActive }) =>
            `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              isActive ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-surface-2 hover:text-fg'
            }`
          }
        >
          <Icon className="size-4" />
          {label}
        </NavLink>
      ))}
    </nav>
  )
}

export function Layout() {
  const [open, setOpen] = useState(false)
  const { api } = useApp()
  const location = useLocation()
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[240px_1fr]">
      <aside className="sticky top-0 hidden h-dvh flex-col justify-between border-r border-line bg-surface px-3 py-5 lg:flex">
        <div className="space-y-8">
          <div className="px-2">
            <Logo />
          </div>
          <NavItems />
        </div>
        <ConnectionPill />
      </aside>

      <header className="sticky top-0 z-40 flex items-center justify-between border-b border-line bg-surface/90 px-4 py-3 backdrop-blur lg:hidden">
        <Logo />
        <button className="rounded-lg p-2 hover:bg-surface-2" onClick={() => setOpen(!open)} aria-label="Menu">
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </header>
      {open && (
        <div className="fixed inset-x-0 top-[61px] z-30 border-b border-line bg-surface p-3 shadow-lg lg:hidden">
          <NavItems onNavigate={() => setOpen(false)} />
          <div className="mt-2 border-t border-line pt-2">
            <ConnectionPill />
          </div>
        </div>
      )}

      <main className="min-w-0">
        {api.mode === 'demo' && location.pathname !== '/settings' && (
          <div className="border-b border-mod-line bg-mod px-4 py-2 text-center text-xs text-mod-fg">
            Demo mode — sample documents, keyword search and no AI answers. Changes aren’t saved.{' '}
            <NavLink to="/settings" className="font-semibold underline underline-offset-2">
              Connect a backend
            </NavLink>
          </div>
        )}
        <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 lg:py-10">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
