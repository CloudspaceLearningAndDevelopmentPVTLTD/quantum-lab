/**
 * POST /api/billing/reconcile — pull the truth back from Stripe.
 *
 * A subscription can change without a webhook ever reaching us: the endpoint
 * was down, the signing secret was rotated without a redeploy, the change was
 * made by hand in the Stripe dashboard, or the event carried no `metadata
 * .userId` and could not be attributed. `lib/billing/reconcile.ts` has the full
 * list and the schedule this route is meant to run on. Symptom, always the
 * same: "I upgraded and it still says Free", or an account that keeps a paid
 * plan it cancelled a month ago.
 *
 * ── Who may call it ─────────────────────────────────────────────────────────
 *
 * Two callers, and the difference matters:
 *
 *  · A SIGNED-IN USER, for themselves only. Identity comes from a Supabase-
 *    verified token, exactly as in `/api/billing/portal`; `userId` in the body
 *    is checked against it and never trusted on its own. This route reads
 *    Stripe and writes an entitlement row, so "reconcile <someone else's uuid>"
 *    would be a way to make the server do work on any account it can name.
 *  · AN OPERATOR OR A CRON JOB, for anyone, by presenting
 *    `BILLING_RECONCILE_SECRET` in `x-reconcile-secret`. That is how the
 *    nightly sweep in docs/BILLING.md §8 runs. When the variable is unset the
 *    header is ignored entirely — an empty secret must never authorise
 *    anything, which is the mistake that makes "compare to the env var" a
 *    vulnerability rather than a check.
 *
 * Rate limited hard on both paths: each call is a live Stripe API request, and
 * Stripe rate-limits the account, not the caller. A user hammering this button
 * must not be able to make checkout start failing for everybody else.
 */

import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { reconcileEntitlement } from '@/lib/billing/reconcile'
import { isStripeConfigured } from '@/lib/billing/stripe'
import { isSupabaseConfigured } from '@/lib/supabase'
import { verifiedCallerId } from '@/lib/security/auth'
import { callerKey, rateLimit, retryAfterHeaders } from '@/lib/rateLimit'
import { isRecord, safeJson, uuid } from '@/lib/security/validate'
import { apiError, badRequest } from '@/lib/apiError'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const OPERATOR_SECRET = (process.env.BILLING_RECONCILE_SECRET ?? '').trim()

/**
 * Constant-time compare. A `===` here leaks the secret one byte at a time to
 * anyone who can measure a few thousand requests, and this secret grants
 * "rewrite any account's plan from Stripe".
 */
function presentsOperatorSecret(req: Request): boolean {
  if (OPERATOR_SECRET.length === 0) return false
  const offered = (req.headers.get('x-reconcile-secret') ?? '').trim()
  if (offered.length !== OPERATOR_SECRET.length) return false
  return timingSafeEqual(Buffer.from(offered), Buffer.from(OPERATOR_SECRET))
}

export async function POST(req: Request): Promise<Response> {
  if (!isStripeConfigured) {
    return NextResponse.json({
      configured: false,
      message:
        'Billing is not set up in this environment — set STRIPE_SECRET_KEY. There is nothing to reconcile against.',
    })
  }
  if (!isSupabaseConfigured) {
    return NextResponse.json({
      configured: false,
      message: 'No database is configured, so there is no entitlement row to reconcile.',
    })
  }

  // Keyed on the IP and applied before the token is verified, so an
  // unauthenticated flood costs no Supabase round trip. Tighter than the portal
  // (10/min) because every allowed call reaches Stripe.
  const limit = await rateLimit(callerKey(req.headers, 'billing-reconcile'), {
    limit: 5,
    windowMs: 60_000,
  })
  if (!limit.allowed) return apiError('rate_limited', { headers: retryAfterHeaders(limit) })

  const parsed = safeJson(await req.text(), 4_096)
  if (!parsed.ok) return badRequest(parsed.error)
  if (!isRecord(parsed.value)) return badRequest('Expected a JSON object.')
  const checked = uuid(parsed.value.userId, 'userId')
  if (!checked.ok) return badRequest(checked.error)
  const userId = checked.value

  if (!presentsOperatorSecret(req)) {
    const caller = await verifiedCallerId(req)
    if (caller === null) {
      return apiError('unauthorized', { message: 'Sign in to refresh your subscription.' })
    }
    if (caller !== userId) {
      return apiError('forbidden', { message: 'You can only reconcile your own subscription.' })
    }
  }

  const outcome = await reconcileEntitlement(userId)

  switch (outcome.status) {
    case 'reconciled':
      return NextResponse.json({
        reconciled: true,
        planId: outcome.planId,
        changed: outcome.changed,
      })
    case 'unknown_customer':
      // 200, not 404: "you have never subscribed" is a correct, final answer to
      // "make my plan match Stripe", and the account page renders it as such.
      return NextResponse.json({
        reconciled: false,
        reason: 'no_stripe_customer',
        message: 'This account has no Stripe customer yet, so there is nothing to reconcile.',
      })
    case 'unconfigured':
      return NextResponse.json({ configured: false })
    default:
      // The reason names Stripe/Postgres internals — logged, never returned.
      console.error(`[billing/reconcile] ${userId}: ${outcome.reason}`)
      return apiError('upstream_error', {
        message: 'Stripe could not be reached. Your plan is unchanged; try again shortly.',
      })
  }
}
