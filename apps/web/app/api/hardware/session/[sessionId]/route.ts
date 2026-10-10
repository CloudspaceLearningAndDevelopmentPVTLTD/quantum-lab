/**
 * DELETE /api/hardware/session/{sessionId} — close a runtime session.
 *
 * Closing STOPS THE METER, so this route is gated on identity but not on the
 * plan: a user whose subscription lapsed between opening a session and closing
 * it must still be able to close it. Refusing here would hold a device open and
 * keep billing for it as a consequence of a billing problem, which is the
 * wrong direction in every sense.
 *
 * Closing does not cancel jobs already submitted into the session — they drain.
 * Somebody closing a session to stop the meter must not lose their last
 * iteration.
 *
 * ── The ownership check, and why it does not refuse very much ───────────────
 *
 * Sessions ARE recorded now (`public.runtime_sessions`, written by the POST
 * route), so this can ask "whose session is this?". It refuses exactly one
 * answer — a session recorded as belonging to somebody else — and allows the
 * other three:
 *
 *   owner        recorded as this caller's. Allow.
 *   unrecorded   no row. Allow: sessions opened before the table existed, or
 *                whose row could not be written, are still real sessions
 *                holding a real device.
 *   unverified   the store could not answer. Allow, and log.
 *
 * ALLOWING ON AN OUTAGE IS DELIBERATE AND IS THE OPPOSITE OF WHAT THIS
 * CODEBASE DOES EVERYWHERE ELSE. `lib/billing/usage.ts` fails closed because
 * an unknown answer must not authorise SPENDING. Here the asymmetry runs the
 * other way: refusing to close a session does not prevent a cost, it causes
 * one — the device stays reserved and billing until the eight-hour cap expires.
 * The worst case for allowing is that somebody who already holds a
 * high-entropy session id ends a reservation early. The worst case for
 * refusing is a bill for hours of idle QPU reservation caused by a database
 * blip.
 *
 * A refusal answers 404 with the same body as a malformed id, never 403: a 403
 * would confirm to a stranger that the id they hold is real and belongs to
 * somebody.
 */

import { forward, limitOrNull, requireCaller, SUBMIT_LIMIT } from '@/lib/hardware/proxy'
import { authorizeSessionClose, markRuntimeSessionClosed } from '@/lib/hardware/sessionStore'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Session ids are opaque vendor strings; this is a shape bound, not a parse. */
const SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/

export async function DELETE(
  req: Request,
  props: { params: Promise<{ sessionId: string }> }
): Promise<Response> {
  const limited = await limitOrNull(req, 'hw-session-close', SUBMIT_LIMIT)
  if (limited) return limited

  // The read scope is enough: closing spends nothing and stopping a meter
  // should not require the credential that started it.
  const caller = await requireCaller(req, 'hardware:read')
  if (!caller.ok) return caller.response

  const { sessionId } = await props.params
  if (!SESSION_ID.test(sessionId ?? '')) {
    return NextResponse.json({ detail: 'Not a session id.' }, { status: 400 })
  }

  const decision = await authorizeSessionClose(caller.id, sessionId)
  if (!decision.allow) {
    // Same body as a malformed id. See the header: a distinct 403 would be an
    // oracle for which session ids are real.
    return NextResponse.json({ detail: 'Not a session id.' }, { status: 404 })
  }
  if (decision.basis !== 'owner') {
    // Not an error — see the header for why these are allowed — but it is the
    // only trace that a close happened without verified ownership, so it is
    // worth having when somebody asks who ended a session.
    console.warn(
      `[api/hardware/session] closing ${sessionId} without verified ownership ` +
        `(${decision.basis}): ${decision.why}`
    )
  }

  const response = await forward(
    `/api/hardware/session/${encodeURIComponent(sessionId)}`,
    undefined,
    'DELETE'
  )
  // Only on success. A row marked closed for a session the vendor still holds
  // open would make the next close look like a stranger's.
  if (response.ok) await markRuntimeSessionClosed(sessionId)
  return response
}
