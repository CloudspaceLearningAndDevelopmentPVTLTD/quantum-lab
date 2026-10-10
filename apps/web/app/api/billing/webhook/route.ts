/**
 * POST /api/billing/webhook — Stripe's view of the truth.
 *
 * This is the ONLY writer of public.subscriptions. RLS denies users write
 * access to their own subscription row precisely so that nobody can grant
 * themselves Pro; the row can only change because Stripe said so, through the
 * service-role key used here.
 *
 * Retry semantics: Stripe retries any non-2xx. So a *database* failure returns
 * 500 (please retry), while a verified-but-unusable event returns 200 (retrying
 * will not help).
 *
 * ── What was already right, and what was not ────────────────────────────────
 *
 * ALREADY RIGHT, and do not undo either of them:
 *  · The signature IS verified, against the RAW body. `req.text()` is read
 *    before anything parses it, exactly as `constructEvent` requires, and a
 *    failure answers 400 with no detail. Nothing below this line runs for an
 *    event Stripe did not sign.
 *  · The user id comes from the event (`metadata.userId` /
 *    `client_reference_id`), never from a query string, and an event that
 *    cannot be attributed is acknowledged rather than guessed at.
 *
 * WRONG, and fixed here:
 *  · NO IDEMPOTENCY. Stripe redelivers — after any 5xx, after a timeout, and
 *    whenever an operator replays from the dashboard. Every delivery was
 *    processed again from scratch.
 *  · NO ORDERING. Deliveries are not ordered, and each handler wrote
 *    last-arrival-wins. The concrete failure: an upgrade created at 12:00:00
 *    times out, the customer's downgrade created at 12:00:10 is delivered and
 *    applied at 12:00:12, then Stripe retries the upgrade at 12:00:30 and it
 *    overwrites the downgrade. The account keeps a plan it no longer pays for
 *    until something else touches the row. With the events the other way round
 *    the same mechanism CANCELS a paying customer, which is the version that
 *    generates a support ticket rather than a loss.
 *  · `invoice.payment_failed` re-read the subscription live from Stripe and
 *    then forced `past_due` regardless of what that read said, so a stale
 *    retry could mark a recovered account delinquent.
 *
 * Both fixes live in Postgres, because both need a read and a write to be one
 * decision: `public.stripe_events` is the idempotency ledger and
 * `public.apply_stripe_subscription` refuses a write whose `event.created` is
 * older than the last one applied to that account. See
 * supabase/schema-billing.sql.
 */

import { NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { getStripe, isStripeConfigured, planIdForPriceId } from '@/lib/billing/stripe'
import {
  alreadyProcessed,
  applySubscription,
  firstPriceId,
  idOf,
  isoFromUnix,
  markProcessed,
  PersistError,
  stateFromStripe,
  toStatus,
  userIdFromStoredSubscription,
  userIdFromSubscription,
  type EventStamp,
} from '@/lib/billing/subscription'
import type { PlanId, SubscriptionStatus } from '@/lib/plans'

export const runtime = 'nodejs'

const WEBHOOK_SECRET = (process.env.STRIPE_WEBHOOK_SECRET ?? '').trim()

async function handleSubscriptionEvent(
  sub: Stripe.Subscription,
  stamp: EventStamp,
  forcedStatus?: SubscriptionStatus
): Promise<void> {
  const userId = userIdFromSubscription(sub) || (await userIdFromStoredSubscription(sub))
  if (!userId) {
    // Verified, but we cannot attribute it to an account. Retrying will not help.
    console.warn('[billing/webhook] subscription event without metadata.userId', sub.id)
    return
  }
  await applySubscription(stateFromStripe(sub, userId, forcedStatus), stamp)
}

export async function POST(req: Request): Promise<Response> {
  const stripe = getStripe()
  if (!isStripeConfigured || !stripe) {
    return NextResponse.json({
      configured: false,
      message: 'Billing is not set up in this environment — set STRIPE_SECRET_KEY.',
    })
  }
  if (!WEBHOOK_SECRET) {
    return NextResponse.json({
      configured: false,
      message:
        'STRIPE_WEBHOOK_SECRET is not set, so webhook signatures cannot be verified. See docs/BILLING.md.',
    })
  }

  // Stripe signs the RAW request body. It MUST be read as text and passed to
  // constructEvent untouched — parsing it first (req.json()) re-serialises the
  // bytes and the signature check will fail.
  const rawBody = await req.text()
  const signature = req.headers.get('stripe-signature') ?? ''

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, WEBHOOK_SECRET)
  } catch {
    // Deliberately no detail beyond the fact of it: signature failures are
    // attacker-facing, and the only reader is Stripe, which acts on the status.
    // Now JSON in the canonical shape so the webhook log greps like every other
    // route; the sentence carries no more information than the old plain text.
    return NextResponse.json(
      { error: 'Invalid signature.', code: 'bad_request' },
      { status: 400 }
    )
  }

  // IDEMPOTENCY. Checked after the signature (an unsigned body must never cost
  // a database round trip) and before any work. A redelivery of an event we
  // finished is a no-op with a 200, which is what stops Stripe retrying.
  if (await alreadyProcessed(event.id)) {
    console.info('[billing/webhook] duplicate delivery ignored', event.id, event.type)
    return NextResponse.json({ received: true, duplicate: true })
  }

  // Stripe's own clock, not ours. This is the ordering key every write below
  // carries; see the header for the interleaving it defends against.
  const stamp: EventStamp = { id: event.id, at: new Date(event.created * 1000).toISOString() }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        const userId = (
          session.client_reference_id ??
          session.metadata?.userId ??
          ''
        ).trim()
        if (!userId) {
          console.warn('[billing/webhook] checkout.session.completed without a user id')
          break
        }
        const subscriptionId = idOf(session.subscription)
        if (subscriptionId) {
          // Fetch the subscription so plan, period end and status come from
          // Stripe rather than being inferred from the session.
          const sub = await stripe.subscriptions.retrieve(subscriptionId)
          const priceId = firstPriceId(sub)
          const planId =
            (priceId ? planIdForPriceId(priceId) : null) ??
            ((session.metadata?.planId as PlanId | undefined) ?? 'free')
          await applySubscription(
            {
              userId,
              stripeCustomerId: idOf(session.customer) ?? idOf(sub.customer),
              stripeSubscriptionId: sub.id,
              planId,
              status: toStatus(sub.status),
              currentPeriodEnd: isoFromUnix(sub.current_period_end),
              cancelAtPeriodEnd: sub.cancel_at_period_end === true,
            },
            stamp
          )
        } else {
          await applySubscription(
            {
              userId,
              stripeCustomerId: idOf(session.customer),
              stripeSubscriptionId: null,
              planId: (session.metadata?.planId as PlanId | undefined) ?? 'free',
              status: 'active',
              currentPeriodEnd: null,
              cancelAtPeriodEnd: false,
            },
            stamp
          )
        }
        break
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        await handleSubscriptionEvent(event.data.object as Stripe.Subscription, stamp)
        break
      }

      case 'customer.subscription.deleted': {
        await handleSubscriptionEvent(event.data.object as Stripe.Subscription, stamp, 'canceled')
        break
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice
        const subscriptionId = idOf(invoice.subscription)
        if (!subscriptionId) {
          console.warn('[billing/webhook] invoice.payment_failed without a subscription')
          break
        }
        // The subscription is re-read LIVE, so `sub.status` is current. Forcing
        // past_due on top of it is still right at the moment the invoice fails
        // — Stripe can take a beat to move the subscription — but the ordering
        // stamp is what stops a late retry of this event from marking an
        // account delinquent after it has already recovered.
        const sub = await stripe.subscriptions.retrieve(subscriptionId)
        await handleSubscriptionEvent(sub, stamp, 'past_due')
        break
      }

      default:
        // Stripe retries non-2xx responses, so an event type we do not care
        // about must still be acknowledged.
        console.info('[billing/webhook] unhandled event type', event.type)
        break
    }

    // Recorded only now, after the work succeeded. See `markProcessed`.
    await markProcessed(event.id, event.type, stamp.at)
    return NextResponse.json({ received: true })
  } catch (err) {
    if (err instanceof PersistError) {
      // A database failure is transient: ask Stripe to retry.
      console.error('[billing/webhook] persist failed', err.message)
      // Stripe reads the STATUS and retries any non-2xx; the body is for a
      // human reading the webhook log in the dashboard. Same shape as every
      // other route so that log is greppable by code.
      return NextResponse.json(
        { error: 'Could not persist the subscription.', code: 'internal' },
        { status: 500 }
      )
    }
    // A verified but malformed/unusable event: retrying will not help.
    console.error('[billing/webhook] unusable event', err)
    return NextResponse.json({ received: true, handled: false })
  }
}
