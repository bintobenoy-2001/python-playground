// User-provided AI tutor configuration. Stored only in the browser (localStorage)
// and sent with each /api/tutor request. The key never persists on the server.

export type TutorProvider = 'server' | 'openai' | 'anthropic' | 'openrouter' | 'nvidia' | 'custom'

export type TutorConfig = {
  provider: TutorProvider
  apiKey: string
  model: string
  baseUrl: string // only used when provider === 'custom'
}

const STORAGE_KEY = 'mimo.tutorConfig.v1'

export const DEFAULT_TUTOR_CONFIG: TutorConfig = {
  provider: 'server',
  apiKey: '',
  model: '',
  baseUrl: '',
}

// Per-provider metadata used to render the settings UI and provide good defaults.
export const PROVIDER_META: Record<Exclude<TutorProvider, 'server'>, {
  label: string
  modelPlaceholder: string
  keyPlaceholder: string
  keyUrl?: string
  keyUrlLabel?: string
}> = {
  openai: {
    label: 'OpenAI',
    modelPlaceholder: 'gpt-4o-mini',
    keyPlaceholder: 'sk-...',
    keyUrl: 'https://platform.openai.com/api-keys',
    keyUrlLabel: 'Get an OpenAI key',
  },
  anthropic: {
    label: 'Anthropic (Claude)',
    modelPlaceholder: 'claude-3-5-haiku-latest',
    keyPlaceholder: 'sk-ant-...',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    keyUrlLabel: 'Get an Anthropic key',
  },
  openrouter: {
    label: 'OpenRouter',
    modelPlaceholder: 'openai/gpt-4o-mini',
    keyPlaceholder: 'sk-or-...',
    keyUrl: 'https://openrouter.ai/keys',
    keyUrlLabel: 'Get an OpenRouter key',
  },
  nvidia: {
    label: 'NVIDIA NIM',
    modelPlaceholder: 'minimaxai/minimax-m3.1-flash',
    keyPlaceholder: 'nvapi-...',
    keyUrl: 'https://build.nvidia.com/settings/api-keys',
    keyUrlLabel: 'Get an NVIDIA key',
  },
  custom: {
    label: 'Custom (OpenAI-compatible)',
    modelPlaceholder: 'model-name',
    keyPlaceholder: 'your-api-key',
  },
}

export function loadTutorConfig(): TutorConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_TUTOR_CONFIG }
    const parsed = JSON.parse(raw)
    return { ...DEFAULT_TUTOR_CONFIG, ...parsed }
  } catch {
    return { ...DEFAULT_TUTOR_CONFIG }
  }
}

export function saveTutorConfig(config: TutorConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
  } catch {
    // Ignore storage failures (private mode, quota); config simply won't persist.
  }
}

// Shape sent to the backend. Returns null when using the server default (no overrides).
export function tutorRequestFields(config: TutorConfig): {
  provider?: string; apiKey?: string; model?: string; baseUrl?: string
} {
  if (config.provider === 'server' || !config.apiKey.trim()) return {}
  return {
    provider: config.provider,
    apiKey: config.apiKey.trim(),
    model: config.model.trim() || undefined,
    baseUrl: config.provider === 'custom' ? config.baseUrl.trim() || undefined : undefined,
  }
}
