/**
 * GET /api/email/unsubscribe/course?token=… — the one-click opt-out link
 * carried by every 7-day course email.
 *
 * Why a second unsubscribe route exists: the original
 * (/api/email/unsubscribe) verifies the SIGNUP token, whose plaintext lives
 * only in the confirm email — the store holds its hash and nothing else, so
 * the dispatcher has no way to put that token behind a link in a course
 * mail. Course mails instead carry `course_unsubscribe_token`, minted at
 * first send and stored plaintext (the trade is documented in
 * supabase/schema-email.sql: unsubscribe-only power, and stable across
 * secret rotations so a link in a months-old email still works). Both
 * routes end at the same place — unsubscribed_at stamped on the same row —
 * so an opt-out through either silences everything.
 *
 * One deliberate difference from the original route: an UNRECOGNISED token
 * gets an honest "this link is not recognised" page, not the opt-out
 * confirmation. The original shows the same page for unknown tokens as an
 * anti-oracle measure on links that predate any send; here every genuine
 * link corresponds to a live row, so "you're out" on a token we cannot match
 * would risk telling a real subscriber they are out when nothing was
 * written — the one lie the email feature exists to never tell. Tokens are
 * 256-bit random, so the differing response teaches a guesser nothing.
 */

import { NextResponse } from 'next/server'
import { getServiceSupabase } from '@/lib/billing/entitlements'
import { reportError } from '@/lib/observability/report'
import {
  SUBSCRIPTIONS_TABLE,
  isSubscriptionToken,
} from '@/lib/email/subscriptions'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Same plain, style-free page shape as the sibling unsubscribe route. */
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

function notRecognised(): NextResponse {
  return page(
    'This link is not recognised',
    'This unsubscribe link does not match any subscription, so nothing was changed. ' +
      'Use the unsubscribe link at the top of your most recent course email; ' +
      'if that also lands here, the subscription it belonged to no longer exists ' +
      'and nothing more will be sent to it.',
    404
  )
}

function unavailable(): NextResponse {
  return page(
    'Temporarily unavailable',
    'We could not record your opt-out just now. Nothing was saved — ' +
      'please try the link again in a few minutes.',
    503
  )
}

// A function, not a shared constant: a Response body is a one-shot stream.
function confirmed(): NextResponse {
  return page(
    'You are unsubscribed',
    'No further course email will be sent to this address. ' +
      'Signing up again requires a fresh confirmation from your inbox.'
  )
}

export async function GET(request: Request): Promise<NextResponse> {
  const token = new URL(request.url).searchParams.get('token')
  if (!isSubscriptionToken(token)) return notRecognised()

  // Course mails are only ever sent from a deployment with the durable store
  // (the dispatch route hard-refuses the memory fallback), so with no
  // service-role client there is no row this link could belong to.
  const supabase = getServiceSupabase()
  if (!supabase) return notRecognised()

  const lookup = await supabase
    .from(SUBSCRIPTIONS_TABLE)
    .select('id,unsubscribed_at')
    .eq('course_unsubscribe_token', token)
    .maybeSingle()
  if (lookup.error) {
    reportError(lookup.error, { scope: 'email.unsubscribe.course', what: 'lookup' })
    return unavailable()
  }
  const row = lookup.data as { id: string; unsubscribed_at: string | null } | null
  if (!row) return notRecognised()
  if (row.unsubscribed_at) return confirmed()

  const write = await supabase
    .from(SUBSCRIPTIONS_TABLE)
    .update({ unsubscribed_at: new Date().toISOString() })
    .eq('id', row.id)
    .is('unsubscribed_at', null)
  if (write.error) {
    // An unwritten opt-out must never be confirmed as written.
    reportError(write.error, { scope: 'email.unsubscribe.course', what: 'write' })
    return unavailable()
  }
  return confirmed()
}
