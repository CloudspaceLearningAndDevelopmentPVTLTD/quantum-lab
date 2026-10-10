/**
 * llm/resolve.ts — "which model does THIS caller get?", as a pure function.
 *
 * Inputs: the effective LlmSettings (env + admin overlay, see
 * lib/platform/settings.ts) and the caller's tier. Output: a fully specified
 * provider call (id, key, model, Azure endpoint) or a reason there is none.
 * No env, no network, no SDK — app/api/agent/route.ts turns the result into
 * an AI-SDK model, and services/agent gets the same choice as a LiteLLM
 * override, so both runtimes follow one decision.
 *
 * Order of precedence:
 *   1. tier.access decides whether a model is called at all.
 *   2. settings.forceProvider pins everyone (admin's "route around a rate-
 *      limited key today" switch) — if that provider is ready.
 *   3. tier.provider pins this tier ("free users on Groq, paid on Claude").
 *   4. settings.order, first ready provider wins (cheapest-first by default).
 * A pinned provider that is not ready falls through to the next rule rather
 * than taking the tutor offline over a config mistake — same principle the
 * old FORCE_LLM_PROVIDER env var followed.
 */

import {
  LITELLM_PREFIX,
  PROVIDER_LABEL,
  providerModel,
  providerReady,
  type LlmSettings,
  type ProviderId,
  type TierId,
  type TierPolicy,
} from '@/lib/platform/llmConfig'
import type { Entitlement } from '@/lib/plans'

export interface ResolvedProvider {
  id: ProviderId
  label: string
  apiKey: string
  /** Model id, or the deployment name for Azure. */
  model: string
  /** `gemini/gemini-2.5-flash` etc. — what services/agent (LiteLLM) wants. */
  litellmModel: string
  baseUrl: string
  apiVersion: string
}

export type Resolution =
  | { kind: 'live'; provider: ResolvedProvider; policy: TierPolicy }
  | { kind: 'offline'; policy: TierPolicy; reason: 'policy' | 'no_provider' }
  | { kind: 'off'; policy: TierPolicy }

function toResolved(id: ProviderId, settings: LlmSettings): ResolvedProvider {
  const cfg = settings.providers[id]
  const model = providerModel(id, cfg)
  return {
    id,
    label: PROVIDER_LABEL[id],
    apiKey: cfg.apiKey,
    model,
    litellmModel: `${LITELLM_PREFIX[id]}${model}`,
    baseUrl: cfg.baseUrl,
    apiVersion: cfg.apiVersion,
  }
}

/** First provider that is actually callable, following the precedence above. */
export function pickProvider(settings: LlmSettings, tier: TierId): ResolvedProvider | null {
  const ready = (id: ProviderId | 'auto' | null | undefined): id is ProviderId =>
    Boolean(id) && id !== 'auto' && providerReady(id as ProviderId, settings.providers[id as ProviderId])
  if (ready(settings.forceProvider)) return toResolved(settings.forceProvider as ProviderId, settings)
  const pinned = settings.tiers[tier].provider
  if (ready(pinned)) return toResolved(pinned as ProviderId, settings)
  for (const id of settings.order) if (ready(id)) return toResolved(id, settings)
  return null
}

export function resolveForTier(settings: LlmSettings, tier: TierId): Resolution {
  const policy = settings.tiers[tier]
  if (policy.access === 'off') return { kind: 'off', policy }
  if (policy.access === 'offline') return { kind: 'offline', policy, reason: 'policy' }
  const provider = pickProvider(settings, tier)
  if (!provider) return { kind: 'offline', policy, reason: 'no_provider' }
  return { kind: 'live', provider, policy }
}

/** Any provider ready for anyone? (The status probe's "direct" flag.) */
export function anyProviderReady(settings: LlmSettings): boolean {
  return settings.order.some((id) => providerReady(id, settings.providers[id]))
}

/**
 * Map a caller to a tier. Signed out → anonymous. Signed in → by entitlement:
 * a paid plan (or org seat) is `paid`, the launch trial is `trial`, otherwise
 * `free`. The entitlement must come from the server's own lookup, never from
 * the request.
 */
export function tierOf(userId: string | null, entitlement: Entitlement | null): TierId {
  if (!userId) return 'anonymous'
  if (!entitlement) return 'free'
  if (entitlement.launchTrial) return 'trial'
  if (entitlement.planId !== 'free') {
    const s = entitlement.status
    if (s === 'active' || s === 'trialing' || s === 'past_due') return 'paid'
  }
  return 'free'
}
