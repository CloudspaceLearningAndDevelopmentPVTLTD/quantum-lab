/**
 * GET /api/billing/hardware-bonus — the caller's active engagement bonus.
 *
 * Read-only COURTESY endpoint for the quota display: it reports whether a
 * one-time "+25 hardware jobs" grant (docs/BILLING.md §11) is active in the
 * caller's current usage window, so the account page can widen the meter and
 * say why. It is NOT a gate and nothing may be granted on the strength of it —
 * the authoritative bonus-aware limit check happens inside
 * `public.reserve_hardware_job`, under the per-user lock, on every submission.
 *
 * It lives on its own rather than inside /api/billing/entitlement because the
 * bonus is not part of the `Entitlement` shape that `hasFeature`/`limitsFor`
 * consume — it is a property of the usage window, not of the plan — and
 * widening that type would invite plan logic to depend on it.
 *
 * Always 200 with `{ bonus: null }` for the unauthenticated, the unconfigured
 * and the ungranted: those three cases render identically (no bonus line), and
 * distinguishing them here would only leak configuration state.
 */

import { NextResponse } from 'next/server'
import { getEntitlement } from '@/lib/billing/entitlements'
import { usagePeriodStart } from '@/lib/billing/period'
import { activeHardwareBonus, HARDWARE_BONUS_JOBS, HARDWARE_BONUS_THRESHOLD } from '@/lib/billing/usage'
import { verifiedCallerId } from '@/lib/security/auth'
import { check, clientKey, retryHeaders } from '@/lib/security/ratelimit'
import { apiError } from '@/lib/apiError'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request): Promise<Response> {
  // Same budget as the entitlement route: a miss costs Supabase round trips.
  const limit = check(clientKey(req.headers, 'hardware-bonus'), 60, 60_000)
  if (!limit.allowed) {
    return apiError('rate_limited', { headers: retryHeaders(limit) })
  }

  const none = {
    bonus: null,
    // The mechanic's parameters, so the UI never hard-codes "50" or "25".
    threshold: HARDWARE_BONUS_THRESHOLD,
    bonusJobs: HARDWARE_BONUS_JOBS,
  }

  try {
    const caller = await verifiedCallerId(req)
    if (!caller) return NextResponse.json(none)

    // The bonus is scoped to the same usage window the quota meter shows, so
    // the window derivation must match the one the meter's count uses.
    const entitlement = await getEntitlement(caller)
    const bonus = await activeHardwareBonus(
      caller,
      usagePeriodStart(entitlement.currentPeriodEnd)
    )
    return NextResponse.json({ ...none, bonus })
  } catch {
    // Display-only endpoint: degrade to "no bonus", never to an error page.
    return NextResponse.json(none)
  }
}
