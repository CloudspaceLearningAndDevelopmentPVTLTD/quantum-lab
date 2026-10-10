/**
 * GET /api/hardware/devices — server-side proxy for the same path on
 * `services/api`.
 *
 * See lib/hardware/proxy.ts for why the browser no longer calls the Python
 * service directly. This route takes no input at all, so there is nothing to
 * validate beyond refusing to be hammered.
 *
 * ── Gate chain: IP rate limit only. Deliberately. ───────────────────────────
 *
 * NO identity, NO entitlement, NO quota, and here is the reasoning so the next
 * reader does not have to re-derive it:
 *
 *  · It spends nothing at a vendor. Listing backends is free on IBM and on
 *    Braket; there is no per-call charge and no shot count.
 *  · It returns no user data. The response is a catalogue of public devices
 *    plus a queue depth — the same information both providers publish.
 *  · The device list is what the hardware page renders BEFORE anyone decides to
 *    upgrade. Requiring a session here would mean a signed-out visitor sees an
 *    empty page instead of "here is what you could run on", and would add a
 *    Supabase round trip to the first paint of the page.
 *
 * What it does cost is a live call from `services/api` to the providers, which
 * is why READ_LIMIT stays. If a provider ever starts metering catalogue reads,
 * this route needs `requireCaller` — it is the only line that would change.
 */

import { forward, limitOrNull, READ_LIMIT } from '@/lib/hardware/proxy'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request): Promise<Response> {
  const limited = await limitOrNull(req, 'hw-devices', READ_LIMIT)
  if (limited) return limited
  return forward('/api/hardware/devices')
}
