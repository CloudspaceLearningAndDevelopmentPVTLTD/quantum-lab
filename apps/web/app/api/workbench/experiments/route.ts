/**
 * GET /api/workbench/experiments — the experiment list the /workbench/experiments
 * page reads.
 *
 * Read-only, anonymous, rate-limited. It exposes exactly what the MCP tool
 * `list_experiments` exposes, from the same store (lib/workbench/experimentStore.ts),
 * so the page and the agent see one list. Records carry no secrets by contract
 * (create_experiment says so) and the deployment-wide visibility is stated on the
 * page; there is deliberately no write here — writes go through MCP, where the
 * tool descriptions and validation live.
 */

import { NextResponse } from 'next/server'
import { apiError } from '@/lib/apiError'
import { callerKey, rateLimit, retryAfterHeaders, type RateLimitRule } from '@/lib/rateLimit'
import { getExperimentStore } from '@/lib/workbench/experimentStore'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const LIST_LIMIT: RateLimitRule = { limit: 60, windowMs: 60_000 }

export async function GET(req: Request): Promise<Response> {
  const limited = await rateLimit(callerKey(req.headers, 'wb-exp'), LIST_LIMIT)
  if (!limited.allowed) return apiError('rate_limited', { headers: retryAfterHeaders(limited) })

  const store = getExperimentStore()
  try {
    const experiments = await store.list(100)
    return NextResponse.json({ storage: store.kind, experiments })
  } catch (cause) {
    return NextResponse.json(
      { error: cause instanceof Error ? cause.message : 'Could not list experiments.' },
      { status: 503 },
    )
  }
}
