/**
 * /api/email/unsubscribe — the one-click opt-out. Prerequisite 2 of
 * docs/ONBOARDING.md's "Email: nothing is sent, on purpose".
 *
 * GET ?token=… verifies the token against the stored SHA-256 hash, stamps
 * unsubscribed_at, and shows a plain confirmation page. Design constraints,
 * each of which is a promise to the person clicking:
 *
 *   • GET, no auth, no confirmation step, no "are you sure?". The click comes
 *     from a mail client, possibly years after signup, possibly on a device
 *     with no session. Any friction here is a dark pattern.
 *   • ALWAYS 200 with the same "you are unsubscribed" page — for a fresh
 *     opt-out, a repeat click, and an unknown token alike. Idempotent by
 *     construction, and an attacker replaying guessed tokens learns nothing
 *     (the token space is unsearchable anyway — 256 bits, hashed at rest).
 *   • The ONE failure that is not smoothed over: a configured-but-unreachable
 *     store. Showing "you are unsubscribed" over an opt-out that was NOT
 *     persisted is the worst lie this feature could tell, so that case says
 *     plainly that nothing was saved and asks for another click. An
 *     unsubscribe page that does nothing is worse than none, because it is
 *     a promise (ONBOARDING.md's words).
 *
 * No rate limit: the operation is idempotent, costs one indexed lookup, and
 * throttling an unsubscribe is the one place where "try again later" is
 * never an acceptable answer to give.
 */

import { NextResponse } from 'next/server'
import {
  SubscriptionStoreUnavailableError,
  unsubscribeByToken,
} from '@/lib/email/subscriptions'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Same plain-HTML shell as the confirm page: readable in any mail client's browser. */
function page(title: string, body: string, status = 200): NextResponse {
  const html = [
    '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>${title} — Qubit16</title></head>`,
    '<body style="font-family:system-ui,sans-serif;max-width:36rem;margin:4rem auto;padding:0 1rem;line-height:1.6;">',
    `<h1 style="font-size:1.4rem;">${title}</h1><p>${body}</p>`,
    '</body></html>',
  ].join('')
  return new NextResponse(html, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  })
}

export async function GET(request: Request): Promise<NextResponse> {
  const token = new URL(request.url).searchParams.get('token')
  try {
    // All three outcomes ('unsubscribed', 'already-unsubscribed', 'unknown')
    // get the identical page: in every case, no mail will be sent to whatever
    // address the clicker was worried about. The distinct return values exist
    // so lib/email/subscriptions.test.ts can assert the write really happened.
    await unsubscribeByToken(token)
    return page(
      'You are unsubscribed',
      'This address will not receive the Qubit16 email course. ' +
        'That is recorded and final — signing up again is the only way back in, ' +
        'and it would require confirming from the inbox again.'
    )
  } catch (err) {
    if (err instanceof SubscriptionStoreUnavailableError) {
      return page(
        'Not yet — please try once more',
        'We could not record your unsubscribe just now, and we will not pretend ' +
          'otherwise. Nothing was saved. Please click the link again in a few ' +
          'minutes; it will keep working.',
        503
      )
    }
    throw err
  }
}
