import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { HttpApi, type Api } from '../api/client'
import { DemoApi } from '../api/demo'
import type { Health, ModelInfo } from '../api/types'

export type Theme = 'system' | 'light' | 'dark'

interface Stored {
  apiUrl: string
  /** Sent as X-API-Key. Kept in this browser only. */
  apiKey?: string
  model: string | null
}

export const DEFAULT_API_URL: string =
  (import.meta.env.VITE_API_URL as string | undefined) ?? (import.meta.env.DEV ? 'http://localhost:8000' : '')

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value))
  } catch {
    /* storage unavailable (private mode) — settings just won't persist */
  }
}

type HealthState = { status: 'loading' } | { status: 'ok'; data: Health } | { status: 'error'; error: string }

interface AppContext {
  api: Api
  apiUrl: string
  setApiUrl: (url: string) => void
  apiKey: string
  setApiKey: (key: string) => void
  /** The user's saved choice (may no longer exist on the backend). */
  model: string | null
  setModel: (m: string | null) => void
  /** Models the backend offers. Empty in demo mode or when Ollama is down. */
  models: ModelInfo[]
  /** The server's default model, if known. */
  defaultModel: string | null
  /** The model to send: the saved choice if still offered, else null (server default). */
  effectiveModel: string | null
  theme: Theme
  setTheme: (t: Theme) => void
  health: HealthState
  refreshHealth: () => void
  /** Bumped after any mutation so lists reload. */
  revision: number
  bump: () => void
}

const Ctx = createContext<AppContext | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [stored, setStored] = useState<Stored>(() => read('at.settings', { apiUrl: DEFAULT_API_URL, model: null }))
  const [theme, setThemeState] = useState<Theme>(() => {
    try {
      const t = localStorage.getItem('at.theme')
      return t === 'light' || t === 'dark' ? t : 'system'
    } catch {
      return 'system'
    }
  })
  const [health, setHealth] = useState<HealthState>({ status: 'loading' })
  const [revision, setRevision] = useState(0)

  const api = useMemo<Api>(
    () => (stored.apiUrl.trim() ? new HttpApi(stored.apiUrl.trim(), stored.apiKey ?? '') : new DemoApi()),
    [stored.apiUrl, stored.apiKey],
  )

  const update = useCallback((patch: Partial<Stored>) => {
    setStored((prev) => {
      const next = { ...prev, ...patch }
      write('at.settings', next)
      return next
    })
  }, [])

  const refreshHealth = useCallback(() => {
    setHealth({ status: 'loading' })
    api
      .health()
      .then((data) => setHealth({ status: 'ok', data }))
      .catch((e: Error) => setHealth({ status: 'error', error: e.message }))
  }, [api])

  useEffect(refreshHealth, [refreshHealth, revision])

  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && media.matches)
      document.documentElement.classList.toggle('dark', dark)
    }
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [theme])

  const models = useMemo<ModelInfo[]>(() => {
    if (api.mode !== 'live' || health.status !== 'ok') return []
    const llm = health.data.llm
    return llm.model_details ?? llm.models.map((name) => ({ name }))
  }, [api.mode, health])
  const defaultModel = health.status === 'ok' && api.mode === 'live' ? health.data.llm.default_model : null
  const effectiveModel =
    stored.model && (stored.model === defaultModel || models.some((m) => m.name === stored.model)) ? stored.model : null

  const value: AppContext = {
    api,
    apiUrl: stored.apiUrl,
    setApiUrl: (apiUrl) => update({ apiUrl }),
    apiKey: stored.apiKey ?? '',
    setApiKey: (apiKey) => update({ apiKey: apiKey.trim() }),
    model: stored.model,
    setModel: (model) => update({ model }),
    models,
    defaultModel,
    effectiveModel,
    theme,
    setTheme: (t) => {
      write('at.theme', t)
      setThemeState(t)
    },
    health,
    refreshHealth,
    revision,
    bump: () => setRevision((r) => r + 1),
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useApp(): AppContext {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useApp must be used inside AppProvider')
  return ctx
}

/** Load async data, re-running when deps or the app revision change. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const { revision } = useApp()
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true })
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let live = true
    setState((s) => ({ ...s, loading: true, error: undefined }))
    fn()
      .then((data) => live && setState({ data, loading: false }))
      .catch((e: Error) => live && setState({ error: e.message, loading: false }))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, revision, tick])
  return { ...state, reload: () => setTick((t) => t + 1) }
}
