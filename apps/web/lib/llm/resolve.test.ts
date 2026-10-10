import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { anyProviderReady, pickProvider, resolveForTier, tierOf } from './resolve'
import { applyLlmPatch, CLEAR_KEY, emptyLlmSettings, normalizeOrder, type LlmSettings } from '@/lib/platform/llmConfig'
import { envLlmSettings, mergeLlmSettings } from '@/lib/platform/settings'
import { isSealed, open, seal, secretBoxAvailable } from '@/lib/platform/secretBox'
import { isPlatformAdminEmail, platformAdminEmails } from '@/lib/platform/admin'

function withKeys(keys: Partial<Record<'gemini' | 'groq' | 'anthropic' | 'azure', string>>): LlmSettings {
  const s = emptyLlmSettings()
  for (const [id, key] of Object.entries(keys)) s.providers[id as keyof typeof s.providers].apiKey = key
  if (keys.azure) {
    s.providers.azure.baseUrl = 'https://x.openai.azure.com'
    s.providers.azure.model = 'gpt-4o-mini'
  }
  return s
}

describe('pickProvider — precedence', () => {
  it('follows cheapest-first order by default', () => {
    const s = withKeys({ groq: 'g', anthropic: 'a' })
    expect(pickProvider(s, 'free')?.id).toBe('groq')
  })

  it('respects a reordered list', () => {
    const s = withKeys({ groq: 'g', anthropic: 'a' })
    s.order = normalizeOrder(['anthropic', 'groq'])
    expect(pickProvider(s, 'free')?.id).toBe('anthropic')
  })

  it('forceProvider beats everything when ready, falls through when not', () => {
    const s = withKeys({ gemini: 'k', anthropic: 'a' })
    s.forceProvider = 'anthropic'
    expect(pickProvider(s, 'paid')?.id).toBe('anthropic')
    s.forceProvider = 'groq' // no key
    expect(pickProvider(s, 'paid')?.id).toBe('gemini')
  })

  it('a tier pin beats the order, force beats the pin', () => {
    const s = withKeys({ gemini: 'k', groq: 'g', anthropic: 'a' })
    s.tiers.paid.provider = 'anthropic'
    expect(pickProvider(s, 'paid')?.id).toBe('anthropic')
    expect(pickProvider(s, 'free')?.id).toBe('gemini')
    s.forceProvider = 'groq'
    expect(pickProvider(s, 'paid')?.id).toBe('groq')
  })

  it('a disabled provider is skipped even with a key', () => {
    const s = withKeys({ gemini: 'k', groq: 'g' })
    s.providers.gemini.enabled = false
    expect(pickProvider(s, 'free')?.id).toBe('groq')
    expect(anyProviderReady(s)).toBe(true)
  })

  it('azure needs key + base + deployment', () => {
    const s = withKeys({ azure: 'z' })
    expect(pickProvider(s, 'free')?.id).toBe('azure')
    expect(pickProvider(s, 'free')?.litellmModel).toBe('azure/gpt-4o-mini')
    s.providers.azure.model = ''
    expect(pickProvider(s, 'free')).toBeNull()
    expect(anyProviderReady(s)).toBe(false)
  })

  it('fills the default model per provider and the LiteLLM prefix', () => {
    const p = pickProvider(withKeys({ gemini: 'k' }), 'free')
    expect(p?.model).toBe('gemini-2.5-flash')
    expect(p?.litellmModel).toBe('gemini/gemini-2.5-flash')
  })
})

describe('resolveForTier', () => {
  it('off / offline / live by policy', () => {
    const s = withKeys({ gemini: 'k' })
    s.tiers.anonymous.access = 'off'
    s.tiers.free.access = 'offline'
    expect(resolveForTier(s, 'anonymous').kind).toBe('off')
    expect(resolveForTier(s, 'free')).toMatchObject({ kind: 'offline', reason: 'policy' })
    expect(resolveForTier(s, 'paid').kind).toBe('live')
  })

  it('live with no provider degrades to offline with a reason', () => {
    expect(resolveForTier(emptyLlmSettings(), 'paid')).toMatchObject({ kind: 'offline', reason: 'no_provider' })
  })
})

describe('tierOf', () => {
  it('maps callers to tiers from a server-resolved entitlement', () => {
    expect(tierOf(null, null)).toBe('anonymous')
    expect(tierOf('u', null)).toBe('free')
    expect(tierOf('u', { planId: 'free', status: 'none', hardwareJobsUsed: 0 })).toBe('free')
    expect(tierOf('u', { planId: 'pro', status: 'trialing', hardwareJobsUsed: 0, launchTrial: true })).toBe('trial')
    expect(tierOf('u', { planId: 'pro', status: 'active', hardwareJobsUsed: 0 })).toBe('paid')
    expect(tierOf('u', { planId: 'pro', status: 'canceled', hardwareJobsUsed: 0 })).toBe('free')
  })
})

describe('env + stored merge', () => {
  it('reads the env layer the deploy script writes', () => {
    const s = envLlmSettings({ GEMINI_API_KEY: 'g', TUTOR_MODEL: 'm', FORCE_LLM_PROVIDER: 'Gemini' } as unknown as NodeJS.ProcessEnv)
    expect(s.providers.gemini.apiKey).toBe('g')
    expect(s.providers.gemini.model).toBe('m')
    expect(s.forceProvider).toBe('gemini')
    expect(envLlmSettings({} as unknown as NodeJS.ProcessEnv).forceProvider).toBeNull()
  })

  it('a stored key overrides env, a disabled flag wins, unreadable keys are reported', () => {
    const base = envLlmSettings({ GEMINI_API_KEY: 'env-key', GROQ_API_KEY: 'groq-env' } as unknown as NodeJS.ProcessEnv)
    const unseal = (s: string) => (s === 'v1.a.b.c' ? 'stored-key' : null)
    const { settings, keySource, unreadable } = mergeLlmSettings(
      base,
      {
        providers: { gemini: { apiKey: 'v1.a.b.c', model: 'gemini-2.5-pro' }, groq: { enabled: false, apiKey: 'v1.x.y.z' } },
        order: ['groq', 'gemini'],
        tiers: { free: { access: 'offline', messagesPerDay: 5 } },
        forceProvider: 'nope',
      },
      unseal,
    )
    expect(settings.providers.gemini.apiKey).toBe('stored-key')
    expect(settings.providers.gemini.model).toBe('gemini-2.5-pro')
    expect(keySource.gemini).toBe('settings')
    expect(settings.providers.groq.enabled).toBe(false)
    expect(settings.providers.groq.apiKey).toBe('groq-env')
    expect(unreadable).toEqual(['groq'])
    expect(settings.order).toEqual(['groq', 'gemini', 'anthropic', 'azure'])
    expect(settings.tiers.free).toMatchObject({ access: 'offline', messagesPerDay: 5 })
    expect(settings.forceProvider).toBeNull()
    expect(pickProvider(settings, 'paid')?.id).toBe('gemini')
  })
})

describe('applyLlmPatch', () => {
  it('bounds strings, ignores junk, honours CLEAR_KEY', () => {
    const base = emptyLlmSettings()
    base.providers.groq.apiKey = 'old'
    const next = applyLlmPatch(base, {
      providers: {
        gemini: { apiKey: '  new  ', model: 'x'.repeat(500) },
        groq: { apiKey: CLEAR_KEY },
        anthropic: { apiKey: '' },
      },
      tiers: { anonymous: { messagesPerDay: -3, access: 'weird' as never }, paid: { messagesPerDay: null } },
      order: ['azure', 'bogus' as never],
      note: 'n'.repeat(600),
    })
    expect(next.providers.gemini.apiKey).toBe('new')
    expect(next.providers.gemini.model).toHaveLength(120)
    expect(next.providers.groq.apiKey).toBe('')
    expect(next.providers.anthropic.apiKey).toBe('')
    expect(next.tiers.anonymous.messagesPerDay).toBe(0)
    expect(next.tiers.anonymous.access).toBe('live')
    expect(next.tiers.paid.messagesPerDay).toBeNull()
    expect(next.order).toEqual(['azure', 'gemini', 'groq', 'anthropic'])
    expect(next.note).toHaveLength(500)
  })
})

describe('secretBox', () => {
  const saved = { ...process.env }
  beforeEach(() => {
    delete process.env.SETTINGS_ENCRYPTION_KEY
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
  })
  afterEach(() => {
    process.env = { ...saved }
  })

  it('is unavailable with no key material', () => {
    expect(secretBoxAvailable()).toBe(false)
    expect(() => seal('x')).toThrow()
    expect(open('v1.a.b.c')).toBeNull()
  })

  it('round-trips and detects tampering', () => {
    process.env.SETTINGS_ENCRYPTION_KEY = 'a'.repeat(64)
    const sealed = seal('sk-secret')
    expect(isSealed(sealed)).toBe(true)
    expect(open(sealed)).toBe('sk-secret')
    const parts = sealed.split('.')
    parts[2] = parts[2].slice(0, -2) + 'AA'
    expect(open(parts.join('.'))).toBeNull()
    process.env.SETTINGS_ENCRYPTION_KEY = 'a different key'
    expect(open(sealed)).toBeNull()
  })

  it('derives a key from the service-role key when none is set', () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role'
    expect(secretBoxAvailable()).toBe(true)
    expect(open(seal('k'))).toBe('k')
  })
})

describe('platform admins', () => {
  it('parses the allow-list case-insensitively', () => {
    const env = { PLATFORM_ADMIN_EMAILS: ' Owner@Example.com, ops@example.com ,junk' } as unknown as NodeJS.ProcessEnv
    expect(platformAdminEmails(env)).toEqual(['owner@example.com', 'ops@example.com'])
    expect(isPlatformAdminEmail('OWNER@example.com', env)).toBe(true)
    expect(isPlatformAdminEmail('someone@example.com', env)).toBe(false)
    expect(isPlatformAdminEmail('', env)).toBe(false)
  })
})
