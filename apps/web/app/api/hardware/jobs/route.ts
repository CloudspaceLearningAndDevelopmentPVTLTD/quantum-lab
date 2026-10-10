/**
 * GET /api/hardware/jobs — this account's hardware job history.
 *
 * ── Why this route exists ───────────────────────────────────────────────────
 *
 * Until it did, the hardware job list lived in `localStorage` under
 * `quantum-lab.hw-jobs`, capped at 20 entries, holding an id and a backend
 * name and nothing else. The consequences were all the same consequence: the
 * history was per-browser, so signing in on a second machine showed an empty
 * page; clearing site data destroyed the record of every run; and the counts —
 * the actual result of spending real money on a real QPU — were never stored
 * anywhere at all, because they were fetched from the vendor on each poll,
 * rendered, and dropped.
 *
 * `hardware_usage` was always the right home for this; it already held one row
 * per submitted job for quota purposes, already had the ownership columns, and
 * already had RLS denying every other account. It was missing the result
 * columns, which the billing migration now adds, and a route to read them,
 * which is this file.
 *
 * ── This is NOT the vendor ──────────────────────────────────────────────────
 *
 * Every row here is what WE observed, not what the vendor holds. A job nobody
 * ever polled has a null status however long ago it finished, because the poll
 * is the only thing that ever writes one. That is a real limitation and the
 * `status: null` in the response is how a caller is told about it, rather than
 * a cheerful "queued" that would be a guess.
 *
 * ── The gate chain ──────────────────────────────────────────────────────────
 *
 *   limitOrNull(ip) → requireCaller → limitOrNull(account) → listHardwareJobs
 *
 * No entitlement check and no quota check, for the same reason the job-status
 * route has neither: reading your own history costs nothing at any vendor, and
 * a Pro user who lapses to Free must still be able to see the results of jobs
 * they paid for. What it is NOT is public — every row is somebody's
 * experimental data, so the user id comes from a Supabase-verified token and
 * from nowhere else, and it is part of the WHERE clause rather than a filter
 * applied afterwards.
 */

import { NextResponse } from 'next/server'
import { limitOrNull, quotaUnavailable, requireCaller, READ_LIMIT } from '@/lib/hardware/proxy'
import { listHardwareJobs, QuotaUnavailableError } from '@/lib/billing/usage'
import { int } from '@/lib/security/validate'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * How many rows one request may ask for.
 *
 * Bounded because the row now carries a `counts` object and optionally a
 * circuit source, so an unbounded `limit` is an unbounded response body built
 * out of a single query parameter.
 */
const MAX_LIMIT = 200

/** The default page size: enough to fill the history panel without paging. */
const DEFAULT_LIMIT = 50

export async function GET(req: Request): Promise<Response> {
  const limited = await limitOrNull(req, 'hw-jobs', READ_LIMIT)
  if (limited) return limited

  const caller = await requireCaller(req, 'hardware:read')
  if (!caller.ok) return caller.response

  const perAccount = await limitOrNull(req, 'hw-jobs-acct', READ_LIMIT, caller.id)
  if (perAccount) return perAccount

  const url = new URL(req.url)

  let limit = DEFAULT_LIMIT
  const rawLimit = url.searchParams.get('limit')
  if (rawLimit !== null) {
    const checked = int(Number(rawLimit), 1, MAX_LIMIT, 'limit')
    if (!checked.ok) return NextResponse.json({ detail: checked.error }, { status: 400 })
    limit = checked.value
  }

  // Off by default: the circuit source is by far the largest column and the
  // list view does not render it. A caller that wants a reproducible export
  // asks for it explicitly and accepts the bigger body.
  const includeQasm = url.searchParams.get('include_qasm') === '1'

  try {
    const jobs = await listHardwareJobs(caller.id, limit, includeQasm)
    return NextResponse.json(
      { jobs },
      {
        headers: {
          // Somebody's experimental results. No shared cache may hold this,
          // and a browser must not serve it back after a sign-out.
          'cache-control': 'private, no-store',
        },
      }
    )
  } catch (err) {
    if (err instanceof QuotaUnavailableError) {
      return quotaUnavailable(
        err,
        'api/hardware/jobs',
        'Your hardware job history is temporarily unavailable. The jobs themselves are unaffected — they live on the provider.'
      )
    }
    throw err
  }
}
