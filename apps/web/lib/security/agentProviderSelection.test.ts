import { afterEach, describe, expect, it } from 'vitest'

// Env-var-driven provider selection, isolated from the rest of route.ts's
// request handling (rate limiting, agent proxying, etc — covered elsewhere,
// e.g. lib/security/agentClamps.test.ts). Azure is the newest of the four
// providers, wired in alongside the Founders Hub milestone-3 infrastructure
// — see the internal Azure-credits notes — and the only one needing three env vars
// together, not one, to count as usable.

const PROVIDER_KEYS = [
  'GEMINI_API_KEY',
  'GROQ_API_KEY',
  'ANTHROPIC_API_KEY',
  'AZURE_API_KEY',
  'AZURE_API_BASE',
  'AZURE_API_VERSION',
  'TUTOR_MODEL',
  'FORCE_LLM_PROVIDER',
] as const

function clearProviderEnv() {
  for (const key of PROVIDER_KEYS) delete process.env[key]
}

afterEach(() => {
  clearProviderEnv()
})

describe('hasDirectProviderKey', () => {
  it('is false with no provider configured', async () => {
    clearProviderEnv()
    const { hasDirectProviderKey } = await import('@/app/api/agent/route')
    expect(hasDirectProviderKey()).toBe(false)
  })

  it('is true with only a Gemini key', async () => {
    clearProviderEnv()
    process.env.GEMINI_API_KEY = 'test-gemini-key'
    const { hasDirectProviderKey } = await import('@/app/api/agent/route')
    expect(hasDirectProviderKey()).toBe(true)
  })

  it('is false with an Azure key but no base URL or deployment', async () => {
    clearProviderEnv()
    process.env.AZURE_API_KEY = 'test-azure-key'
    const { hasDirectProviderKey } = await import('@/app/api/agent/route')
    expect(hasDirectProviderKey()).toBe(false)
  })

  it('is false with an Azure key and base but no deployment (TUTOR_MODEL)', async () => {
    clearProviderEnv()
    process.env.AZURE_API_KEY = 'test-azure-key'
    process.env.AZURE_API_BASE = 'https://quantum-lab-aoai.openai.azure.com/'
    const { hasDirectProviderKey } = await import('@/app/api/agent/route')
    expect(hasDirectProviderKey()).toBe(false)
  })

  it('is true once Azure key, base, and deployment name are all set', async () => {
    clearProviderEnv()
    process.env.AZURE_API_KEY = 'test-azure-key'
    process.env.AZURE_API_BASE = 'https://quantum-lab-aoai.openai.azure.com/'
    process.env.TUTOR_MODEL = 'gpt-4o-mini'
    const { hasDirectProviderKey } = await import('@/app/api/agent/route')
    expect(hasDirectProviderKey()).toBe(true)
  })
})

describe('selectDirectProvider', () => {
  it('returns null with nothing configured', async () => {
    clearProviderEnv()
    const { selectDirectProvider } = await import('@/app/api/agent/route')
    expect(selectDirectProvider()).toBeNull()
  })

  it('prefers Gemini over every other configured provider (cheapest-first)', async () => {
    clearProviderEnv()
    process.env.GEMINI_API_KEY = 'test-gemini-key'
    process.env.GROQ_API_KEY = 'test-groq-key'
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key'
    process.env.AZURE_API_KEY = 'test-azure-key'
    process.env.AZURE_API_BASE = 'https://quantum-lab-aoai.openai.azure.com/'
    process.env.TUTOR_MODEL = 'gpt-4o-mini'
    const { selectDirectProvider } = await import('@/app/api/agent/route')
    expect(selectDirectProvider()?.label).toBe('Gemini')
  })

  it('falls back to Azure OpenAI last, once fully configured', async () => {
    clearProviderEnv()
    process.env.AZURE_API_KEY = 'test-azure-key'
    process.env.AZURE_API_BASE = 'https://quantum-lab-aoai.openai.azure.com/'
    process.env.AZURE_API_VERSION = '2024-10-21'
    process.env.TUTOR_MODEL = 'gpt-4o-mini'
    const { selectDirectProvider } = await import('@/app/api/agent/route')
    const provider = selectDirectProvider()
    expect(provider?.label).toBe('Azure OpenAI')
    expect(provider?.model).toBeTruthy()
  })

  it('does not select Azure with only a key and base set (no deployment)', async () => {
    clearProviderEnv()
    process.env.AZURE_API_KEY = 'test-azure-key'
    process.env.AZURE_API_BASE = 'https://quantum-lab-aoai.openai.azure.com/'
    const { selectDirectProvider } = await import('@/app/api/agent/route')
    expect(selectDirectProvider()).toBeNull()
  })
})

describe('selectDirectProvider — FORCE_LLM_PROVIDER admin override', () => {
  it('forces Azure even though Gemini would otherwise win cheapest-first', async () => {
    clearProviderEnv()
    process.env.GEMINI_API_KEY = 'test-gemini-key'
    process.env.AZURE_API_KEY = 'test-azure-key'
    process.env.AZURE_API_BASE = 'https://quantum-lab-aoai.openai.azure.com/'
    process.env.AZURE_API_VERSION = '2024-10-21'
    process.env.TUTOR_MODEL = 'gpt-4o-mini'
    process.env.FORCE_LLM_PROVIDER = 'azure'
    const { selectDirectProvider } = await import('@/app/api/agent/route')
    expect(selectDirectProvider()?.label).toBe('Azure OpenAI')
  })

  it('is case-insensitive and trims whitespace', async () => {
    clearProviderEnv()
    process.env.GEMINI_API_KEY = 'test-gemini-key'
    process.env.GROQ_API_KEY = 'test-groq-key'
    process.env.FORCE_LLM_PROVIDER = '  Groq  '
    const { selectDirectProvider } = await import('@/app/api/agent/route')
    expect(selectDirectProvider()?.label).toBe('Groq')
  })

  it('falls back to cheapest-first when the forced provider has no key configured', async () => {
    clearProviderEnv()
    process.env.GEMINI_API_KEY = 'test-gemini-key'
    process.env.FORCE_LLM_PROVIDER = 'azure'
    const { selectDirectProvider } = await import('@/app/api/agent/route')
    expect(selectDirectProvider()?.label).toBe('Gemini')
  })

  it('falls back to cheapest-first on an unrecognized value', async () => {
    clearProviderEnv()
    process.env.GEMINI_API_KEY = 'test-gemini-key'
    process.env.FORCE_LLM_PROVIDER = 'openai'
    const { selectDirectProvider } = await import('@/app/api/agent/route')
    expect(selectDirectProvider()?.label).toBe('Gemini')
  })

  it('returns null when the forced provider has no key and nothing else is configured', async () => {
    clearProviderEnv()
    process.env.FORCE_LLM_PROVIDER = 'anthropic'
    const { selectDirectProvider } = await import('@/app/api/agent/route')
    expect(selectDirectProvider()).toBeNull()
  })
})
