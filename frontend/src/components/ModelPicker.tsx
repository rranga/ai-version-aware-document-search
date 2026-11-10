import { Cpu, Sparkles } from 'lucide-react'
import type { ModelInfo } from '../api/types'
import { useApp } from '../lib/settings'
import { formatBytes } from '../lib/text'
import { Dropdown, type DropdownOption } from './Dropdown'

function describe(m: ModelInfo | undefined): string {
  if (!m) return ''
  return [m.parameter_size, m.family, m.quantization, m.size_bytes ? formatBytes(m.size_bytes) : null].filter(Boolean).join(' · ')
}

/** ChatGPT-style model switcher: shows the active model, opens a menu of the
 *  models the backend offers, and remembers the choice in this browser. */
export function ModelPicker({ className }: { className?: string }) {
  const { api, health, models, defaultModel, effectiveModel, setModel } = useApp()
  if (api.mode !== 'live') return null

  const offline = health.status === 'ok' && !health.data.llm.reachable
  const defaultInfo = models.find((m) => m.name === defaultModel)
  const options: DropdownOption<string | null>[] = defaultModel
    ? [
        {
          value: null,
          label: defaultModel,
          badge: 'DEFAULT',
          icon: <Cpu className="size-4" />,
          description: describe(defaultInfo) || 'Not installed yet on the backend',
        },
        ...models
          .filter((m) => m.name !== defaultModel)
          .map((m) => ({ value: m.name as string | null, label: m.name, icon: <Cpu className="size-4" />, description: describe(m) })),
      ]
    : []

  return (
    <Dropdown
      className={className}
      title={offline ? 'AI model (Ollama isn’t reachable on the backend)' : 'AI model'}
      heading="Model"
      icon={<Sparkles className="size-3.5 shrink-0 text-accent" />}
      label={
        <>
          {effectiveModel ?? defaultModel ?? 'Model'}
          {offline && <span className="ml-1.5 inline-block size-1.5 rounded-full bg-amber-500 align-middle" aria-label="offline" />}
        </>
      }
      options={options}
      value={effectiveModel === defaultModel ? null : effectiveModel}
      onChange={(v) => setModel(v)}
      disabled={!defaultModel}
      footer={
        offline
          ? 'Ollama isn’t reachable, so installed models can’t be listed.'
          : options.length <= 1
            ? 'Only one model is installed. Run “ollama pull <model>” on the backend to add more.'
            : undefined
      }
    />
  )
}
