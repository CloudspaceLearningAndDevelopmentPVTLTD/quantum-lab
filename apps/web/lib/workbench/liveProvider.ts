/**
 * lib/workbench/liveProvider.ts — the real ProviderAdapter.
 *
 * Wraps the AI SDK's generateText over whatever provider lib/llm/resolve.ts
 * picks for the caller's tier: the same admin-configured keys, order and
 * per-tier policy the tutor follows. This is the ONLY module in
 * lib/workbench that can reach the network, and nothing in it is imported by
 * a test — the loop is tested with scripted adapters (see generate.test.ts).
 *
 * Server-only: it needs provider keys. Route handlers and the MCP registry
 * import it; the page never does.
 */

import { generateText } from 'ai'
import { buildLanguageModel } from '@/lib/llm/model'
import { resolveForTier, type Resolution } from '@/lib/llm/resolve'
import { effectiveLlmSettings } from '@/lib/platform/settings'
import type { TierId } from '@/lib/platform/llmConfig'
import type { CompletionRequest, ProviderAdapter } from './generate'

/** One model call may not run longer than this. The loop is bounded per round, not just overall. */
export const LIVE_CALL_TIMEOUT_MS = 30_000

/** Build an adapter over an already-resolved live provider. */
export function adapterFor(resolution: Extract<Resolution, { kind: 'live' }>): ProviderAdapter {
  const model = buildLanguageModel(resolution.provider)
  return {
    label: resolution.provider.label,
    async complete(request: CompletionRequest, signal?: AbortSignal): Promise<string> {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), LIVE_CALL_TIMEOUT_MS)
      const onAbort = () => controller.abort()
      signal?.addEventListener('abort', onAbort, { once: true })
      try {
        const result = await generateText({
          model,
          system: request.system,
          prompt: request.user,
          maxOutputTokens: request.maxTokens,
          abortSignal: controller.signal,
        })
        return result.text
      } finally {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
      }
    },
  }
}

export interface LiveProviderLookup {
  adapter: ProviderAdapter | null
  resolution: Resolution
}

/**
 * The adapter for a tier, or null with the resolution that says why not
 * (tier switched off, offline policy, no provider configured). Callers turn
 * the null into an honest "no model is configured" rather than a fake run.
 */
export async function liveProviderForTier(tier: TierId): Promise<LiveProviderLookup> {
  const { settings } = await effectiveLlmSettings()
  const resolution = resolveForTier(settings, tier)
  if (resolution.kind !== 'live') return { adapter: null, resolution }
  return { adapter: adapterFor(resolution), resolution }
}
