/**
 * DELETE /api/hardware/runs/{publicId} — withdraw a published run.
 *
 * The ONLY update `supabase/schema-runs.sql` permits: its trigger rejects every
 * other column change, so a permalink's content cannot be edited after the
 * fact. A citation that can change is not a citation.
 *
 * Withdrawing is not deleting. The row stays, `withdrawn_at` is stamped, and
 * the public view stops serving it — so a link in a paper resolves to "this
 * run was withdrawn" rather than to a 404 that reads like the platform lost it,
 * and the record of what was published survives for anyone who needs to audit
 * it.
 *
 * `owner_id` is in the WHERE clause, so learning a public id is not enough to
 * withdraw somebody else's run. A row that is not the caller's answers the
 * same 404 as one that does not exist.
 */

import { NextResponse } from 'next/server'
import { limitOrNull, requireCaller, SUBMIT_LIMIT } from '@/lib/hardware/proxy'
import { getServiceSupabase, isServiceRoleConfigured } from '@/lib/billing/entitlements'
import { PUBLIC_ID_LENGTH } from '@/lib/hardware/permalink'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Public ids are lowercase hex of a fixed length, from `publicRunId`. */
const PUBLIC_ID = new RegExp(`^[0-9a-f]{${PUBLIC_ID_LENGTH}}$`)

export async function DELETE(
  req: Request,
  props: { params: Promise<{ publicId: string }> }
): Promise<Response> {
  const limited = await limitOrNull(req, 'hw-withdraw', SUBMIT_LIMIT)
  if (limited) return limited

  const caller = await requireCaller(req, 'hardware:read')
  if (!caller.ok) return caller.response

  const { publicId } = await props.params
  if (!PUBLIC_ID.test(publicId ?? '')) {
    return NextResponse.json({ detail: 'Not a run id.' }, { status: 400 })
  }

  if (!isServiceRoleConfigured) {
    return NextResponse.json(
      { detail: 'Publishing is unavailable: this deployment has no service-role key.' },
      { status: 503 }
    )
  }
  const supabase = getServiceSupabase()
  if (!supabase) {
    return NextResponse.json({ detail: 'Publishing is unavailable right now.' }, { status: 503 })
  }

  const { data, error } = await supabase
    .from('published_runs')
    .update({ withdrawn_at: new Date().toISOString() })
    .eq('public_id', publicId)
    .eq('owner_id', caller.id)
    // Already-withdrawn rows are excluded so a second withdraw does not move
    // the timestamp. The published record should say when it was withdrawn,
    // once.
    .is('withdrawn_at', null)
    .select('public_id')

  if (error) {
    console.error(`[api/hardware/runs/${publicId}] withdraw failed: ${error.message}`)
    return NextResponse.json({ detail: 'The run could not be withdrawn.' }, { status: 503 })
  }
  if (!Array.isArray(data) || data.length === 0) {
    // Not yours, never existed, or already withdrawn — all the same answer.
    return NextResponse.json({ detail: 'No such run.' }, { status: 404 })
  }

  return NextResponse.json(
    { publicId, withdrawn: true },
    { headers: { 'cache-control': 'no-store' } }
  )
}
