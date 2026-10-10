/**
 * platform/settings.ts — read and write the admin-editable LLM configuration.
 *
 * SERVER ONLY (reads env, holds the service-role client, does crypto).
 *
 * Layers, lowest first:
 *   1. process.env — GEMINI_API_KEY, GROQ_API_KEY, ANTHROPIC_API_KEY,
 *      AZURE_API_KEY/BASE/VERSION, TUTOR_MODEL, FORCE_LLM_PROVIDER. What
 *      deploy.sh wires. A deployment with no database still works from these.
 *   2. platform_settings.llm — what an admin saved at /admin/platform. Keys
 *      are stored sealed (secretBox.ts). A stored key beats an env key; a
 *      provider switched off in settings is off even if env has a key; order,
 *      forced provider, tiers and note come from settings when present.
 *
 * `effectiveLlmSettings()` is what the tutor route calls on every request; it
 * is cached for SETTINGS_TTL_MS so the database is not on the hot path, and
 * `invalidateLlmSettings()` drops the cache the moment an admin saves (one
 * instance — other replicas pick the change up within the TTL).
 */

import { getServiceSupabase, isServiceRoleConfigured } from '@/lib/billing/entitlements'
import { reportError } from '@/lib/observability/report'
import {
  applyLlmPatch,
  emptyLlmSettings,
  isProviderId,
  keyHint,
  normalizeOrder,
  normalizeTierPolicy,
  PROVIDER_IDS,
  TIER_IDS,
  type LlmSettings,
  type LlmSettingsPatch,
  type ProviderId,
  type RedactedLlmSettings,
} from './llmConfig'
import { isSealed, open, seal, secretBoxAvailable } from './secretBox'

export const SETTINGS_KEY_LLM = 'llm'
const SETTINGS_TTL_MS = 30_000

// ────────────────────────────────────────────────────────────
// Layer 1: env
// ────────────────────────────────────────────────────────────

export function envLlmSettings(env: NodeJS.ProcessEnv = process.env): LlmSettings {
  const s = emptyLlmSettings()
  const tutorModel = (env.TUTOR_MODEL ?? '').trim()
  s.providers.gemini.apiKey = (env.GEMINI_API_KEY ?? '').trim()
  s.providers.groq.apiKey = (env.GROQ_API_KEY ?? '').trim()
  s.providers.anthropic.apiKey = (env.ANTHROPIC_API_KEY ?? '').trim()
  s.providers.azure.apiKey = (env.AZURE_API_KEY ?? '').trim()
  s.providers.azure.baseUrl = (env.AZURE_API_BASE ?? '').trim()
  s.providers.azure.apiVersion = (env.AZURE_API_VERSION ?? '').trim()
  // TUTOR_MODEL historically applied to whichever provider won. Keep that
  // meaning for the env layer only: it is the model for every provider that
  // has no explicit one in settings, and for Azure it is the deployment name.
  if (tutorModel) for (const id of PROVIDER_IDS) s.providers[id].model = tutorModel
  const forced = (env.FORCE_LLM_PROVIDER ?? '').trim().toLowerCase()
  s.forceProvider = isProviderId(forced) ? forced : null
  return s
}

// ────────────────────────────────────────────────────────────
// Layer 2: stored row
// ────────────────────────────────────────────────────────────

/** The stored JSON: same shape as LlmSettings but apiKey holds ciphertext. */
interface StoredLlm {
  providers?: Partial<Record<ProviderId, Partial<Record<string, unknown>>>>
  order?: unknown
  forceProvider?: unknown
  tiers?: Partial<Record<string, unknown>>
  note?: unknown
}

export interface StoredLlmRow {
  value: StoredLlm
  version: number
  updatedAt: string | null
  updatedBy: string | null
}

/**
 * Overlay a stored row on the env layer. Exported for tests; `open` is
 * injectable so the merge can be tested without key material.
 */
export function mergeLlmSettings(
  base: LlmSettings,
  stored: StoredLlm | null,
  unseal: (sealed: string) => string | null = open,
): { settings: LlmSettings; keySource: Record<ProviderId, 'settings' | 'env' | 'none'>; unreadable: ProviderId[] } {
  const settings: LlmSettings = {
    providers: { ...base.providers },
    order: [...base.order],
    forceProvider: base.forceProvider,
    tiers: { ...base.tiers },
    note: base.note,
  }
  const keySource = {} as Record<ProviderId, 'settings' | 'env' | 'none'>
  const unreadable: ProviderId[] = []
  for (const id of PROVIDER_IDS) keySource[id] = base.providers[id].apiKey ? 'env' : 'none'
  if (!stored || typeof stored !== 'object') return { settings, keySource, unreadable }

  if (stored.providers && typeof stored.providers === 'object') {
    for (const id of PROVIDER_IDS) {
      const p = stored.providers[id]
      if (!p || typeof p !== 'object') continue
      const cur = { ...settings.providers[id] }
      if (typeof p.model === 'string' && p.model.trim()) cur.model = p.model.trim()
      if (typeof p.baseUrl === 'string' && p.baseUrl.trim()) cur.baseUrl = p.baseUrl.trim()
      if (typeof p.apiVersion === 'string' && p.apiVersion.trim()) cur.apiVersion = p.apiVersion.trim()
      if (typeof p.enabled === 'boolean') cur.enabled = p.enabled
      if (isSealed(p.apiKey)) {
        const plain = unseal(p.apiKey)
        if (plain) {
          cur.apiKey = plain
          keySource[id] = 'settings'
        } else {
          // Encryption key rotated or row tampered: do NOT silently fall back
          // to env (the admin thinks the stored key is in use). Surface it.
          unreadable.push(id)
        }
      }
      settings.providers[id] = cur
    }
  }
  if (Array.isArray(stored.order)) settings.order = normalizeOrder(stored.order)
  if (stored.forceProvider === null) settings.forceProvider = null
  else if (isProviderId(stored.forceProvider)) settings.forceProvider = stored.forceProvider
  if (stored.tiers && typeof stored.tiers === 'object') {
    for (const tier of TIER_IDS) {
      if (tier in stored.tiers) settings.tiers[tier] = normalizeTierPolicy(settings.tiers[tier], stored.tiers[tier])
    }
  }
  if (typeof stored.note === 'string') settings.note = stored.note.slice(0, 500)
  return { settings, keySource, unreadable }
}

export const isPlatformSettingsConfigured: boolean = isServiceRoleConfigured

async function readStoredLlm(): Promise<StoredLlmRow | null> {
  const supabase = getServiceSupabase()
  if (!supabase) return null
  try {
    const { data, error } = await supabase
      .from('platform_settings')
      .select('value, version, updated_at, updated_by')
      .eq('key', SETTINGS_KEY_LLM)
      .maybeSingle()
    if (error || !data) return null
    const row = data as { value: unknown; version: number; updated_at: string | null; updated_by: string | null }
    return {
      value: (row.value && typeof row.value === 'object' ? row.value : {}) as StoredLlm,
      version: typeof row.version === 'number' ? row.version : 1,
      updatedAt: row.updated_at ?? null,
      updatedBy: row.updated_by ?? null,
    }
  } catch (err) {
    reportError(err, { route: 'platform/settings', stage: 'read' })
    return null
  }
}

// ────────────────────────────────────────────────────────────
// Cache + public API
// ────────────────────────────────────────────────────────────

export interface EffectiveLlm {
  settings: LlmSettings
  keySource: Record<ProviderId, 'settings' | 'env' | 'none'>
  unreadable: ProviderId[]
  /** null when nothing has been saved yet (pure env). */
  stored: { version: number; updatedAt: string | null; updatedBy: string | null } | null
}

let cache: { at: number; value: EffectiveLlm } | null = null
let inflight: Promise<EffectiveLlm> | null = null

export function invalidateLlmSettings(): void {
  cache = null
  inflight = null
}

export async function effectiveLlmSettings(now: number = Date.now()): Promise<EffectiveLlm> {
  if (cache && now - cache.at < SETTINGS_TTL_MS) return cache.value
  if (inflight) return inflight
  inflight = (async () => {
    const base = envLlmSettings()
    const row = isPlatformSettingsConfigured ? await readStoredLlm() : null
    const merged = mergeLlmSettings(base, row?.value ?? null)
    const value: EffectiveLlm = {
      ...merged,
      stored: row ? { version: row.version, updatedAt: row.updatedAt, updatedBy: row.updatedBy } : null,
    }
    cache = { at: Date.now(), value }
    inflight = null
    return value
  })()
  return inflight
}

export function redact(eff: EffectiveLlm): RedactedLlmSettings {
  const providers = {} as RedactedLlmSettings['providers']
  for (const id of PROVIDER_IDS) {
    const { apiKey, ...rest } = eff.settings.providers[id]
    providers[id] = {
      ...rest,
      apiKeySet: Boolean(apiKey),
      apiKeyHint: keyHint(apiKey),
      keySource: eff.keySource[id],
    }
  }
  return { ...eff.settings, providers }
}

export type SaveResult =
  | { ok: true; version: number }
  | { ok: false; code: 'not_configured' | 'no_secret_box' | 'conflict' | 'error'; message: string }

/**
 * Persist an admin's patch. `expectedVersion` is the version the UI loaded;
 * a mismatch means another admin saved in between and the caller must reload.
 */
export async function saveLlmSettings(
  patch: LlmSettingsPatch,
  by: string,
  expectedVersion: number | null,
): Promise<SaveResult> {
  const supabase = getServiceSupabase()
  if (!supabase) {
    return { ok: false, code: 'not_configured', message: 'Runtime settings need SUPABASE_SERVICE_ROLE_KEY on the web app.' }
  }
  const wantsKey = Object.values(patch.providers ?? {}).some(
    (p) => p && typeof p.apiKey === 'string' && p.apiKey.trim().length > 0,
  )
  if (wantsKey && !secretBoxAvailable()) {
    return { ok: false, code: 'no_secret_box', message: 'Set SETTINGS_ENCRYPTION_KEY before storing API keys.' }
  }

  const row = await readStoredLlm()
  if (expectedVersion !== null && row && row.version !== expectedVersion) {
    return { ok: false, code: 'conflict', message: 'Someone else saved newer settings. Reload and try again.' }
  }

  // Build the next stored value: start from what is stored (NOT the env
  // layer, so a save never copies env keys into the database), apply the
  // patch, then seal any plaintext key.
  const storedPlain = mergeLlmSettings(emptyLlmSettings(), row?.value ?? null).settings
  const next = applyLlmPatch(storedPlain, patch)
  const stored: StoredLlm = {
    providers: {},
    order: next.order,
    forceProvider: next.forceProvider,
    tiers: next.tiers,
    note: next.note,
  }
  for (const id of PROVIDER_IDS) {
    const p = next.providers[id]
    const prev = row?.value.providers?.[id]
    const patched = patch.providers?.[id]
    let apiKey: string | undefined
    if (patched && typeof patched.apiKey === 'string' && patched.apiKey.trim()) {
      // New key or explicit clear (applyLlmPatch turned CLEAR_KEY into '').
      apiKey = p.apiKey ? seal(p.apiKey) : undefined
    } else if (prev && isSealed(prev.apiKey)) {
      apiKey = prev.apiKey // untouched: keep the ciphertext as is
    }
    stored.providers![id] = {
      ...(apiKey ? { apiKey } : {}),
      model: p.model,
      baseUrl: p.baseUrl,
      apiVersion: p.apiVersion,
      enabled: p.enabled,
    }
  }

  const version = (row?.version ?? 0) + 1
  try {
    const { error } = await supabase.from('platform_settings').upsert(
      {
        key: SETTINGS_KEY_LLM,
        value: stored,
        version,
        updated_at: new Date().toISOString(),
        updated_by: by.slice(0, 254),
      },
      { onConflict: 'key' },
    )
    if (error) return { ok: false, code: 'error', message: error.message }
  } catch (err) {
    reportError(err, { route: 'platform/settings', stage: 'write' })
    return { ok: false, code: 'error', message: 'Could not write platform_settings.' }
  }
  invalidateLlmSettings()
  return { ok: true, version }
}
