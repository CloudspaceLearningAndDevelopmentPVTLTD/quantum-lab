/**
 * platform/routeGuard.ts — the opening every /api/platform route repeats.
 * SERVER ONLY. Rate limit, then verified caller, then allow-list.
 */

import { apiError } from '@/lib/apiError'
import { callerKey, rateLimit, retryAfterHeaders } from '@/lib/rateLimit'
import { requirePlatformAdmin } from './admin'
import type { VerifiedCaller } from '@/lib/security/auth'

export async function guardPlatformAdmin(
  req: Request,
  bucket: string,
  perMinute = 30,
): Promise<{ ok: true; caller: VerifiedCaller } | { ok: false; response: Response }> {
  const limit = await rateLimit(callerKey(req.headers, bucket), { limit: perMinute, windowMs: 60_000 })
  if (!limit.allowed) return { ok: false, response: apiError('rate_limited', { headers: retryAfterHeaders(limit) }) }
  const check = await requirePlatformAdmin(req)
  if (check.ok) return { ok: true, caller: check.caller }
  if (check.reason === 'unconfigured') {
    return {
      ok: false,
      response: apiError('not_configured', {
        message: 'No platform admins are configured. Set PLATFORM_ADMIN_EMAILS on the web app and redeploy.',
      }),
    }
  }
  if (check.reason === 'unauthenticated') return { ok: false, response: apiError('unauthorized') }
  // Same sentence for "not an admin" and any other refusal: no oracle.
  return { ok: false, response: apiError('forbidden') }
}
