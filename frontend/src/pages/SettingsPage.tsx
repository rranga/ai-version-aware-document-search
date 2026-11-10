import { CheckCircle2, KeyRound, Laptop, Moon, Server, Sun, XCircle } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { ModelPicker } from '../components/ModelPicker'
import { Button, Card, ErrorNote, PageHeader, Spinner, inputClass } from '../components/ui'
import { DEFAULT_API_URL, useApp, type Theme } from '../lib/settings'

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap justify-between gap-2 border-b border-line py-2 text-sm last:border-0">
      <span className="text-muted">{label}</span>
      <span className="min-w-0 text-right font-medium break-all">{children}</span>
    </div>
  )
}

function ApiKeyCard() {
  const { api, apiKey, setApiKey, health } = useApp()
  const [draft, setDraft] = useState(apiKey)
  const [status, setStatus] = useState<'idle' | 'checking' | 'ok' | 'bad' | string>('idle')
  useEffect(() => setDraft(apiKey), [apiKey])

  const auth = health.status === 'ok' ? health.data.auth : undefined
  const required = !!auth?.write

  // Verify whatever key the current API client is using (re-runs after saving).
  useEffect(() => {
    if (!required) return
    let live = true
    setStatus('checking')
    api
      .checkKey()
      .then((ok) => live && setStatus(ok ? 'ok' : 'bad'))
      .catch((e: Error) => live && setStatus(e.message))
    return () => {
      live = false
    }
  }, [api, required])

  const save = (e: FormEvent) => {
    e.preventDefault()
    setApiKey(draft)
  }

  return (
    <Card className="p-5">
      <h2 className="mb-1 flex items-center gap-2 font-semibold">
        <KeyRound className="size-4" /> API key
      </h2>
      <p className="mb-4 text-sm text-muted">
        {required
          ? auth?.read
            ? 'This backend requires a key for everything, including search.'
            : 'This backend requires a key to add, change or delete documents. Searching and asking work without one.'
          : 'This backend doesn’t require a key, so anyone who can reach it can change documents. Set AT_API_KEY on the server to protect it.'}
      </p>
      {required && (
        <>
          <form onSubmit={save} className="flex flex-col gap-2 sm:flex-row">
            <input
              type="password"
              autoComplete="off"
              className={inputClass}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Paste the backend’s API key"
              aria-label="API key"
            />
            <Button type="submit" variant="primary">
              Save key
            </Button>
          </form>
          <div className="mt-2 text-sm">
            {status === 'checking' && <Spinner label="Checking key…" />}
            {status === 'ok' && (
              <span className="inline-flex items-center gap-1 text-add-fg">
                <CheckCircle2 className="size-4" /> Key accepted — you can make changes.
              </span>
            )}
            {status === 'bad' && (
              <span className="inline-flex items-center gap-1 text-del-fg">
                <XCircle className="size-4" /> {apiKey ? 'Key rejected.' : 'No key saved — the library is read-only.'}
              </span>
            )}
            {status !== 'idle' && status !== 'checking' && status !== 'ok' && status !== 'bad' && <ErrorNote>{status}</ErrorNote>}
          </div>
          <p className="mt-2 text-xs text-muted">Stored only in this browser and sent as the X-API-Key header.</p>
        </>
      )}
    </Card>
  )
}

export function SettingsPage() {
  const { api, apiUrl, setApiUrl, health, refreshHealth, theme, setTheme } = useApp()
  const [draft, setDraft] = useState(apiUrl)
  useEffect(() => setDraft(apiUrl), [apiUrl])

  const save = (e: FormEvent) => {
    e.preventDefault()
    setApiUrl(draft.trim())
  }

  const themes: { value: Theme; label: string; icon: typeof Sun }[] = [
    { value: 'system', label: 'System', icon: Laptop },
    { value: 'light', label: 'Light', icon: Sun },
    { value: 'dark', label: 'Dark', icon: Moon },
  ]

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="Connect the search backend and choose the model used for answers." />

      <Card className="p-5">
        <h2 className="mb-1 flex items-center gap-2 font-semibold">
          <Server className="size-4" /> Backend
        </h2>
        <p className="mb-4 text-sm text-muted">
          The FastAPI service that stores versions, runs FAISS search and talks to Ollama. Leave empty to use the in-browser demo.
        </p>
        <form onSubmit={save} className="flex flex-col gap-2 sm:flex-row">
          <input
            className={inputClass}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="https://your-space.hf.space  or  http://localhost:8000"
            aria-label="Backend URL"
          />
          <Button type="submit" variant="primary">
            Save &amp; connect
          </Button>
        </form>
        <div className="mt-2 flex flex-wrap gap-2 text-xs">
          <button className="text-accent hover:underline" onClick={() => setApiUrl('http://localhost:8000')}>
            Use local backend
          </button>
          {DEFAULT_API_URL && DEFAULT_API_URL !== 'http://localhost:8000' && (
            <button className="text-accent hover:underline" onClick={() => setApiUrl(DEFAULT_API_URL)}>
              Use hosted backend
            </button>
          )}
          <button className="text-accent hover:underline" onClick={() => setApiUrl('')}>
            Switch to demo mode
          </button>
        </div>

        <div className="mt-5">
          {health.status === 'loading' && <Spinner label="Checking connection…" />}
          {health.status === 'error' && (
            <ErrorNote>
              {health.error}{' '}
              <button className="font-semibold underline" onClick={refreshHealth}>
                Retry
              </button>
            </ErrorNote>
          )}
          {health.status === 'ok' && (
            <div>
              <Row label="Mode">{api.mode === 'demo' ? 'Demo (in-browser, not saved)' : `Live · API ${health.data.version}`}</Row>
              <Row label="Embedding model">{health.data.embedding_model}</Row>
              <Row label="Indexed">
                {health.data.stats.documents} documents · {health.data.stats.versions} versions · {health.data.stats.chunks} unique passages
              </Row>
              {api.mode === 'live' && (
                <Row label="Ollama">
                  {health.data.llm.reachable ? (
                    <span className="inline-flex items-center gap-1 text-add-fg">
                      <CheckCircle2 className="size-4" /> Reachable
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-del-fg">
                      <XCircle className="size-4" /> Not reachable
                    </span>
                  )}
                </Row>
              )}
              {api.mode === 'live' && (
                <>
                  <Row label="API key">{health.data.auth?.write ? (health.data.auth.read ? 'Required for everything' : 'Required for changes') : 'Not required'}</Row>
                  <Row label="Safety check">{health.data.guardrails?.moderation ?? 'Off'}</Row>
                  <Row label="Personal data masking">{health.data.guardrails?.redact_pii ? 'On' : 'Off'}</Row>
                </>
              )}
            </div>
          )}
        </div>
      </Card>

      {api.mode === 'live' && health.status === 'ok' && <ApiKeyCard />}

      {api.mode === 'live' && health.status === 'ok' && (
        <Card className="p-5">
          <h2 className="mb-1 font-semibold">Answer model</h2>
          <p className="mb-3 text-sm text-muted">
            {health.data.llm.models.length
              ? 'Models installed on the backend’s Ollama. You can also switch from the model menu next to the search box; the choice is remembered in this browser.'
              : `No models found. Run “ollama pull ${health.data.llm.default_model}” on the backend machine.`}
          </p>
          <div className="inline-block rounded-lg border border-line">
            <ModelPicker />
          </div>
        </Card>
      )}

      <Card className="p-5">
        <h2 className="mb-4 font-semibold">Appearance</h2>
        <div className="inline-flex rounded-lg border border-line p-0.5" role="radiogroup" aria-label="Theme">
          {themes.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              role="radio"
              aria-checked={theme === value}
              onClick={() => setTheme(value)}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium ${
                theme === value ? 'bg-accent text-accent-fg' : 'text-muted hover:text-fg'
              }`}
            >
              <Icon className="size-4" />
              {label}
            </button>
          ))}
        </div>
      </Card>

      <Card className="p-5 text-sm text-muted">
        <h2 className="mb-2 font-semibold text-fg">Running the backend locally</h2>
        <pre className="overflow-x-auto rounded-lg bg-surface-2 p-3 text-xs text-fg">
          {`cd backend
python -m venv .venv && .venv\\Scripts\\activate   # macOS/Linux: source .venv/bin/activate
pip install -r requirements-ml.txt
ollama pull llama3.2
uvicorn app.main:app --reload --port 8000`}
        </pre>
        <p className="mt-2">
          A hosted page can only reach your local backend if that origin is listed in <code>AT_CORS_ORIGINS</code> (GitHub Pages is
          allowed by default).
        </p>
      </Card>
    </div>
  )
}
