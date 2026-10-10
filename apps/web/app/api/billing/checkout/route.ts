/**
 * POST /api/billing/checkout
 *
 * Creates a Stripe Checkout Session for a self-serve plan.
 *
 * With no Stripe configured this returns 200 { configured: false, message }
 * rather than an error, so the pricing page can show a calm "billing is not
 * set up in this environment" state instead of a red toast.
 */

import { NextResponse } from 'next/server'
import { NATIVE_SHELL_UA_TOKEN } from '@/lib/app-shell'
import { APP_URL, getStripe, isStripeConfigured, priceIdFor } from '@/lib/billing/stripe'
import { PLAN_BY_ID, type BillingPeriod, type PlanId } from '@/lib/plans'
import { isSupabaseConfigured } from '@/lib/supabase'
import { SIGN_IN_REQUIRED, verifiedCallerId } from '@/lib/security/auth'
import { callerKey, rateLimit, retryAfterHeaders } from '@/lib/rateLimit'
import { email as validEmail, isRecord, safeJson, uuid } from '@/lib/security/validate'
import { apiError, badRequest, failure } from '@/lib/apiError'

export const runtime = 'nodejs'

interface CheckoutBody {
  planId?: string
  period?: string
  userId?: string
  email?: string
}

const PERIODS: BillingPeriod[] = ['monthly', 'yearly']

function isPlanId(value: unknown): value is PlanId {
  return (
    value === 'free' || value === 'pro' || value === 'team' || value === 'edu'
  )
}

function isPeriod(value: unknown): value is BillingPeriod {
  return typeof value === 'string' && (PERIODS as string[]).includes(value)
}

export async function POST(req: Request): Promise<Response> {
  // Never from inside the App Store app: Apple refuses apps that sell digital
  // subscriptions through an outside checkout (guideline 3.1.1). The UI hides
  // every way here (lib/app-shell.ts); this is the backstop. The Android app is
  // real Chrome and cannot be told apart by user agent, so it relies on the UI.
  if ((req.headers.get('user-agent') ?? '').includes(NATIVE_SHELL_UA_TOKEN)) {
    return NextResponse.json(
      { error: 'Subscriptions are not available in the app.' },
      { status: 403 },
    )
  }
  if (!isStripeConfigured) {
    return NextResponse.json({
      configured: false,
      message:
        'Billing is not set up in this environment — set STRIPE_SECRET_KEY (and the STRIPE_PRICE_* ids) to enable checkout. See docs/BILLING.md.',
    })
  }

  // SECURITY FIX (audit finding RATE-1): every accepted request creates a real
  // Stripe Checkout Session. Shared-store limiter — see lib/rateLimit.ts, which
  // counts in Redis when one is configured and warns loudly when it cannot.
  // The message is fixed and reveals nothing about any other caller's bucket.
  const limit = await rateLimit(callerKey(req.headers, 'checkout'), {
    limit: 10,
    windowMs: 60_000,
  })
  if (!limit.allowed) {
    return apiError('rate_limited', {
      message: 'Too many checkout attempts. Wait a moment and try again.',
      headers: retryAfterHeaders(limit),
    })
  }

  // SECURITY FIX (audit finding VAL-1): bounded body, then a byte-capped parse.
  const parsed = safeJson(await req.text(), 4_096)
  if (!parsed.ok) return badRequest(parsed.error)
  if (!isRecord(parsed.value)) return badRequest('Expected a JSON object.')
  const raw = parsed.value

  // SECURITY FIX (audit finding VAL-1): `userId` and `email` were previously
  // copied unchecked into Stripe session metadata and `customer_email`. An
  // unbounded or malformed value there is a data-integrity problem in the
  // webhook (which reads metadata.userId back) and a way to attach arbitrary
  // text to a Stripe customer record.
  let userId: string | undefined
  if (raw.userId !== undefined && raw.userId !== null && raw.userId !== '') {
    const checked = uuid(raw.userId, 'userId')
    if (!checked.ok) return badRequest(checked.error)
    userId = checked.value
  }
  let email: string | undefined
  if (raw.email !== undefined && raw.email !== null && raw.email !== '') {
    const checked = validEmail(raw.email)
    if (!checked.ok) return badRequest(checked.error)
    email = checked.value
  }

  // SECURITY FIX (audit findings BILL-1 / VAL-1, same principle): `userId` is
  // stamped into `client_reference_id` and session metadata, and the Stripe
  // webhook reads it back to decide WHOSE subscription row to write. So it is
  // identity, and identity may not come from a request body. When Supabase is
  // configured and a userId is supplied it must be the caller's own, proved by
  // a verified access token.
  //
  // And with accounts configured, a checkout REQUIRES a signed-in caller. An
  // anonymous checkout carried no user id, so the webhook could not attribute
  // it and dropped it: the customer was charged and stayed on Free. With no
  // Supabase at all there is no account to attach a plan to anyway, and the
  // zero-config path is unchanged.
  if (isSupabaseConfigured) {
    const caller = await verifiedCallerId(req)
    if (caller === null) return signInRequired()
    if (userId && caller !== userId) {
      return apiError('forbidden', {
        message: 'You can only start a checkout for your own account.',
      })
    }
    userId = caller
  }

  const body: CheckoutBody = {
    planId: typeof raw.planId === 'string' ? raw.planId : undefined,
    period: typeof raw.period === 'string' ? raw.period : undefined,
    userId,
    email,
  }
  const { planId, period } = body

  if (!isPlanId(planId)) {
    return badRequest('Unknown planId.')
  }
  if (!isPeriod(period)) {
    return badRequest("period must be 'monthly' or 'yearly'.")
  }

  const plan = PLAN_BY_ID[planId]
  if (plan.id === 'free') {
    return badRequest('The Free plan does not require checkout.')
  }
  if (plan.contactSales) {
    return badRequest(`${plan.name} is sold through our team — please contact sales.`)
  }

  const price = priceIdFor(plan.id, period)
  if (!price) {
    const envName = plan.stripePriceEnv[period]
    return NextResponse.json({
      configured: false,
      message: `No Stripe price is configured for ${plan.name} (${period}) — set ${envName || 'the plan price env var'} to the price id from your Stripe dashboard. See docs/BILLING.md.`,
    })
  }

  const stripe = getStripe()
  if (!stripe) {
    return NextResponse.json({
      configured: false,
      message: 'Stripe could not be initialised — check STRIPE_SECRET_KEY.',
    })
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price, quantity: 1 }],
      success_url: `${APP_URL}/account?checkout=success`,
      cancel_url: `${APP_URL}/pricing?checkout=cancelled`,
      allow_promotion_codes: true,
      ...(userId ? { client_reference_id: userId } : {}),
      ...(email ? { customer_email: email } : {}),
      metadata: {
        planId: plan.id,
        period,
        userId: userId ?? '',
      },
      // The SUBSCRIPTION carries the user id too: every later lifecycle event
      // (plan change, cancellation, past-due) arrives as a subscription object,
      // and the webhook attributes it by this metadata.
      ...(userId ? { subscription_data: { metadata: { planId: plan.id, userId } } } : {}),
    })

    return NextResponse.json({ url: session.url })
  } catch (err) {
    // SECURITY FIX (audit finding LEAK-1): the comment said "never leak a Stripe
    // stack trace" but the code returned `err.message` verbatim, which can name
    // the account, the API version, a request id, or a misconfigured price env
    // var. The detail now stays server-side.
    //
    // AND IT USED TO GO OUT AS HTTP 200. `NextResponse.json({ error })` with no
    // second argument is a 200, so PricingTable's `res.ok` check passed and the
    // browser fell through to reading `body.url` — undefined — and did nothing
    // visible. A failed Stripe call is a 502: Stripe answered, badly.
    console.error('[billing/checkout]', err)
    return failure('upstream_error', err, { route: 'billing/checkout' }, {
      message: 'Could not start checkout right now.',
    })
  }
}

/**
 * 401 in the canonical shape.
 *
 * `signInRequiredResponse()` in lib/security/auth.ts returns `{ error }` with no
 * `code`, and that file belongs to another workstream — so this wraps it rather
 * than editing it, reusing SIGN_IN_REQUIRED so the sentence stays identical
 * across every route that refuses an anonymous caller. Delete this when
 * lib/security/auth.ts adopts lib/apiError.ts.
 */
function signInRequired(): Response {
  return apiError('unauthorized', { message: SIGN_IN_REQUIRED })
}
