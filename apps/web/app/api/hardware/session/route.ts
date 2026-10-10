/**
 * POST /api/hardware/session — open an IBM Runtime session.
 *
 * ── What a session is, and why it needs the same gate as /submit ────────────
 *
 * A session is a RESERVATION: IBM holds the device for this account and runs
 * the session's jobs consecutively instead of returning each one to the shared
 * queue. That is what makes an iterative workload — VQE, QAOA, any
 * optimiser-in-the-loop — practical on real hardware. Without one, a
 * 200-iteration optimisation queues 200 times from the back.
 *
 * It also BILLS FOR THE WHOLE WINDOW IT IS OPEN, whether or not jobs are
 * running. That is why this route carries the full spend gate — sign-in, the
 * `hardware:submit` scope, the plan check — even though it enqueues nothing.
 * A route that reserves a QPU is a route that spends money, and gating it more
 * loosely than `/submit` would leave the cheaper-looking door unlocked.
 *
 * ── What it does NOT do ─────────────────────────────────────────────────────
 *
 * It does not reserve a job of the monthly allowance. The allowance counts
 * JOBS, a session is not a job, and charging one for opening a session would
 * mean a user paid twice for their first iteration. The bound on session spend
 * is `max_time_seconds`, which the upstream caps at eight hours, plus the rate
 * limit below.
 */

import { NextResponse } from 'next/server'
import {
  badRequest,
  forward,
  forwardedJson,
  limitOrNull,
  requireCaller,
  SUBMIT_LIMIT,
} from '@/lib/hardware/proxy'
import { recordRuntimeSession } from '@/lib/hardware/sessionStore'
import { requireFeature } from '@/lib/billing/entitlements'
import { FeatureLockedError } from '@/lib/plans'
import { featureLocked } from '@/lib/hardware/proxy'
import { int, str } from '@/lib/security/validate'
import { readJsonObject } from '@/lib/hardware/proxy'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Tighter than submissions.
 *
 * Opening sessions in a loop is not a workflow — a session is meant to be
 * opened once around a loop, not once per iteration — and each open one holds
 * a device.
 */
const SESSION_LIMIT = { limit: 3, windowMs: 60_000 }

/** Mirrors `MAX_SESSION_SECONDS` upstream. Eight hours. */
const MAX_SESSION_SECONDS = 28_800

export async function POST(req: Request): Promise<Response> {
  const limited = await limitOrNull(req, 'hw-session', SUBMIT_LIMIT)
  if (limited) return limited

  // The submit scope, not the read scope: this reserves a device.
  const caller = await requireCaller(req, 'hardware:submit')
  if (!caller.ok) return caller.response

  const perAccount = await limitOrNull(req, 'hw-session-acct', SESSION_LIMIT, caller.id)
  if (perAccount) return perAccount

  const body = await readJsonObject(req)
  if (!body.ok) return body.response

  const backend = str(body.value.backend, 128, 'backend')
  if (!backend.ok) return badRequest(backend.error)

  let maxTime = 3600
  if (body.value.max_time_seconds !== undefined && body.value.max_time_seconds !== null) {
    const checked = int(body.value.max_time_seconds, 60, MAX_SESSION_SECONDS, 'max_time_seconds')
    if (!checked.ok) return badRequest(checked.error)
    maxTime = checked.value
  }

  try {
    await requireFeature(caller.id, 'hardware.real')
  } catch (err) {
    if (err instanceof FeatureLockedError) return featureLocked(err.message)
    // An unexplained failure on the path that authorises spending is not a
    // reason to spend. Same direction as /submit.
    console.error('[api/hardware/session] entitlement gate threw:', err)
    return NextResponse.json(
      { error: 'Sessions are unavailable right now.', detail: 'Try again shortly.' },
      { status: 503 }
    )
  }

  const response = await forward('/api/hardware/session', {
    backend: backend.value,
    max_time_seconds: maxTime,
  })

  // Record who opened it, so DELETE can refuse somebody else's session.
  //
  // AFTER the upstream returns, and only on success. `forwardedJson` reads a
  // clone, so the body still reaches the caller, and it answers null on a
  // non-2xx — which is required: a row written for a session that was never
  // opened is an ownership claim on an id that may later be issued to somebody
  // else.
  //
  // Not awaited for correctness, awaited for ordering: `recordRuntimeSession`
  // never throws and returns false on failure. A session that opened but could
  // not be recorded is still a usable session — the close path treats an
  // unrecorded id as closable rather than refusing, because refusing to close
  // one leaves a device reserved and billing.
  const opened = await forwardedJson(response)
  const sessionId = typeof opened?.session_id === 'string' ? opened.session_id : null
  if (sessionId) {
    await recordRuntimeSession(caller.id, sessionId, backend.value, maxTime)
  }
  return response
}
