/**
 * evolveClient.ts — the browser side of /api/workbench/evolve.
 *
 * Turns one ready provider into a `ProviderAdapter` the loop in
 * lib/workbench/evolve.ts can call. This is the ONLY place the page touches
 * the network; the loop, the parser and the fitness functions never do. Kept
 * out of evolve.ts so that module stays importable from the API route and
 * from node tests without a `fetch` in sight.
 */

import { authFetch } from '@/lib/authFetch'
import { isApiErrorBody } from '@/lib/apiError'
import type { ProposalContext, ProviderAdapter } from './evolve'

export interface RemoteProviderInfo {
  id: string
  label: string
}

export interface ProviderStatus {
  tier: string
  providers: RemoteProviderInfo[]
  /** Why the list is empty, when it is: the tier is off, or offline by policy. */
  reason: 'tier_off' | 'offline' | null
}

/** Ask the server which providers this caller may use. Never throws. */
export async function fetchProviderStatus(signal?: AbortSignal): Promise<ProviderStatus> {
  try {
    const res = await authFetch('/api/workbench/evolve', { method: 'GET', signal })
    if (!res.ok) return { tier: 'unknown', providers: [], reason: 'offline' }
    const body: unknown = await res.json()
    if (typeof body !== 'object' || body === null) return { tier: 'unknown', providers: [], reason: 'offline' }
    const b = body as Record<string, unknown>
    const providers = Array.isArray(b.providers)
      ? b.providers.filter(
          (p): p is RemoteProviderInfo =>
            typeof p === 'object' && p !== null && typeof (p as RemoteProviderInfo).id === 'string' && typeof (p as RemoteProviderInfo).label === 'string',
        )
      : []
    const reason = b.reason === 'tier_off' || b.reason === 'offline' ? b.reason : null
    return { tier: typeof b.tier === 'string' ? b.tier : 'unknown', providers, reason }
  } catch {
    return { tier: 'unknown', providers: [], reason: 'offline' }
  }
}

/**
 * A provider adapter that asks one named model through the API route. The
 * route rebuilds the prompt from the problem and the elites' DSL text, so
 * only ids and program text cross the wire.
 */
export function remoteProvider(info: RemoteProviderInfo, signal?: AbortSignal): ProviderAdapter {
  return {
    name: info.label,
    async propose(ctx: ProposalContext): Promise<string[]> {
      const res = await authFetch('/api/workbench/evolve', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal,
        body: JSON.stringify({
          problemId: ctx.problem.id,
          generation: ctx.generation,
          elites: ctx.elites.map((e) => e.text),
          provider: info.id,
        }),
      })
      const body: unknown = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(isApiErrorBody(body) ? body.error : `HTTP ${res.status}`)
      }
      const programs = (body as { programs?: unknown } | null)?.programs
      return Array.isArray(programs) ? programs.filter((p): p is string => typeof p === 'string') : []
    },
  }
}
