# Stripe test mode in 15 minutes — a paste-along

This is the shortest path from "no Stripe account" to "the 4242 card buys Pro
and the `subscriptions` table says so". It is deliberately test-mode only and
deliberately linear: do the steps in order, pasting as you go. The *why* behind
each moving part lives in `docs/BILLING.md`; this file is only the *how*.

Nothing here charges real money. Test mode has its own keys, its own price ids
and its own data, fully isolated from live mode.

At any point, `node scripts/stripe-smoke.mjs` tells you which of these steps
you have actually completed (see §7).

---

## 1. Account and test keys (~2 min)

1. Sign up at <https://dashboard.stripe.com/register>. You do **not** need to
   activate the account (no business details, no bank) — a fresh account is
   already fully functional in test mode.
2. Make sure the **Test mode** toggle (top right of the dashboard) is ON.
   Everything below happens in test mode; a `price_…` id created in live mode
   is invisible to a test key and vice versa.
3. **Developers → API keys**. Copy the **Secret key** — it starts with
   `sk_test_`.

Start `apps/web/.env.local` (create it next to `apps/web/package.json`; it is
gitignored):

```bash
STRIPE_SECRET_KEY=sk_test_PASTE_YOURS_HERE
```

Do not fill `STRIPE_WEBHOOK_SECRET` yet — that value comes from `stripe listen`
in §4, **not** from the API keys page. Pasting an `sk_…` there makes every
webhook fail signature verification while nothing looks broken.

## 2. The two products, four prices (~4 min)

`apps/web/lib/plans.ts` is the contract: two paid plans, each with a monthly
and a yearly recurring price, all in USD.

| Plan | Price | Amount | Interval | Env var to paste the `price_…` id into |
| --- | --- | --- | --- | --- |
| Pro | monthly | **$19.00** (1900¢) | month | `STRIPE_PRICE_PRO_MONTHLY` |
| Pro | yearly | **$190.00** (19000¢) | year | `STRIPE_PRICE_PRO_YEARLY` |
| Team | monthly | **$99.00** (9900¢) | month | `STRIPE_PRICE_TEAM_MONTHLY` |
| Team | yearly | **$990.00** (99000¢) | year | `STRIPE_PRICE_TEAM_YEARLY` |

(The env var names come from each plan's `stripePriceEnv` in `plans.ts`;
`lib/billing/stripe.ts` reads them in both directions — checkout looks up
plan → price, the webhook maps price → plan. The Free and University plans
have no prices on purpose: Free has no checkout, University is contact-sales.)

In the dashboard, **Product catalogue → Add product**, twice:

1. Product **Quantum Lab Pro** — add a recurring price of **$19.00 / month**.
   Save, then on the product page **Add another price**: **$190.00 / year**.
2. Product **Quantum Lab Team** — **$99.00 / month**, then **$990.00 / year**.

Open each of the four prices and copy its **API ID** (`price_…`) — it is shown
on the price detail page and in the price row's overflow menu. Add to
`.env.local`:

```bash
STRIPE_PRICE_PRO_MONTHLY=price_PASTE
STRIPE_PRICE_PRO_YEARLY=price_PASTE
STRIPE_PRICE_TEAM_MONTHLY=price_PASTE
STRIPE_PRICE_TEAM_YEARLY=price_PASTE
```

**All four are required, not just the one you plan to click.** The webhook
resolves a subscription's plan by matching its price id against these vars; an
unset var matches nothing and the subscriber lands on `free` — after paying.
The startup validator treats a secret key without all four as a hard failure
for exactly this reason.

Amounts must match to the cent and intervals must match exactly — the smoke
script in §7 checks all of it against the live API.

### Prefer the CLI? Same result, no clicking

After §3's `stripe login`:

```bash
stripe products create --name "Quantum Lab Pro"
# → note the prod_… id, then:
stripe prices create --product prod_XXX --currency usd --unit-amount 1900  -d "recurring[interval]=month"
stripe prices create --product prod_XXX --currency usd --unit-amount 19000 -d "recurring[interval]=year"

stripe products create --name "Quantum Lab Team"
stripe prices create --product prod_YYY --currency usd --unit-amount 9900  -d "recurring[interval]=month"
stripe prices create --product prod_YYY --currency usd --unit-amount 99000 -d "recurring[interval]=year"
```

Each `stripe prices create` prints the `price_…` id to paste into `.env.local`.

## 3. Stripe CLI (~2 min)

Install per <https://docs.stripe.com/stripe-cli> (`brew install stripe/stripe-cli/stripe`
on macOS; downloads for everything else), then:

```bash
stripe login          # opens the browser, pairs the CLI with your account
```

## 4. Forward webhooks to your dev server (~2 min)

In its **own terminal**, and leave it running for the whole session:

```bash
stripe listen --forward-to localhost:3000/api/billing/webhook
```

On startup it prints:

```
> Ready! Your webhook signing secret is whsec_abc123…
```

Copy that `whsec_…` value into `.env.local`:

```bash
STRIPE_WEBHOOK_SECRET=whsec_PASTE
```

Two gotchas that cost people an afternoon:

- The secret **changes every time you restart `stripe listen`**. Restart it,
  re-copy the secret, restart the dev server.
- `.env.local` is read at boot. Any time you edit it, restart `npm run dev`.

You do *not* need a dashboard webhook endpoint for local dev — `stripe listen`
replaces it. (Production wants one: see `docs/BILLING.md` §4.)

Prerequisites the webhook writes through: the Supabase pair, the
`SUPABASE_SERVICE_ROLE_KEY`, and `supabase/schema-billing.sql` applied —
`supabase/README.md` covers those. Without them the webhook still answers 200
but has nowhere to persist the subscription.

## 5. Buy Pro with the 4242 card (~3 min)

1. Terminal A: `npm run dev`. Terminal B: `stripe listen` from §4, still
   running.
2. Sign in to the app, open <http://localhost:3000/pricing>, click **Upgrade**
   on **Pro**. You land on a Stripe-hosted checkout page.
3. Pay with the magic test card:

   | Field | Value |
   | --- | --- |
   | Card number | `4242 4242 4242 4242` |
   | Expiry | any future date, e.g. `12/34` |
   | CVC | any 3 digits |
   | Name / postcode | anything |

   (`4000 0000 0000 9995` to see a decline, `4000 0025 0000 3155` to see 3D
   Secure — both useful later, not needed now.)
4. You are redirected to `/account?checkout=success`, and terminal B shows the
   delivery:

   ```
   checkout.session.completed  → POST http://localhost:3000/api/billing/webhook [200]
   ```

   A `[400]` there means the signing secret is wrong or stale — redo §4.

## 6. What "it worked" looks like in the `subscriptions` table

Supabase → **Table editor → `subscriptions`** (or
`select * from public.subscriptions;` in the SQL editor). The webhook upserted
one row for your user:

| Column | Expected value |
| --- | --- |
| `user_id` | your auth user's uuid |
| `plan_id` | `pro` — derived from the **price id**, via `STRIPE_PRICE_PRO_MONTHLY`. If this says `free`, a price env var is unset or has the wrong id. |
| `status` | `active` |
| `stripe_customer_id` | `cus_…` |
| `stripe_subscription_id` | `sub_…` |
| `current_period_end` | ~one month from now |
| `cancel_at_period_end` | `false` |
| `last_event_id` / `last_event_at` | the `evt_…` that wrote the row, stamped with Stripe's clock — the ordering guard from `docs/BILLING.md` §4 |

And the row in `public.stripe_events` with that same `evt_…` id is the
idempotency ledger entry — replaying the event (see below) answers
`{ received: true, duplicate: true }` and changes nothing.

Cross-check from the app side:

```bash
curl 'http://localhost:3000/api/billing/entitlement?userId=<that uuid>'
# expect planId "pro", status "active", the Pro limits
```

## 7. `stripe trigger` — exercising every event the route handles

`apps/web/app/api/billing/webhook/route.ts` handles exactly five event types.
One CLI command per type, each fired at your running `stripe listen`:

```bash
stripe trigger checkout.session.completed
stripe trigger customer.subscription.created
stripe trigger customer.subscription.updated
stripe trigger customer.subscription.deleted
stripe trigger invoice.payment_failed
```

What each does to `public.subscriptions` when it carries a user id:

| Trigger | Route effect |
| --- | --- |
| `checkout.session.completed` | Upserts the row: customer, subscription, plan (from the price id), status, period end. |
| `customer.subscription.created` | Same, from the subscription object. |
| `customer.subscription.updated` | Refreshes plan/status/period-end (upgrades, downgrades, cancel-at-period-end). |
| `customer.subscription.deleted` | Sets `status = 'canceled'`. |
| `invoice.payment_failed` | Re-reads the subscription live, sets `status = 'past_due'`. |

**Honest caveat:** a bare `stripe trigger` builds its objects from the CLI's
canned fixtures, which carry **no `metadata.userId` / `client_reference_id`**
and a fixture-created price your env vars do not name. The route verifies the
signature, then acknowledges with 200 and logs
`subscription event without metadata.userId` — correct behaviour, but no row
changes. So bare triggers prove the *plumbing* (signature verification,
delivery, 200s in the `stripe listen` output); the §5 checkout proves the
*writes*. To make a trigger attributable, inject your ids into the fixture:

```bash
# a checkout completion attributed to your user
stripe trigger checkout.session.completed \
  --add checkout_session:client_reference_id=<your-user-uuid>

# a subscription event attributed to your user, on your real Pro price
stripe trigger customer.subscription.created \
  --add customer_subscription:metadata.userId=<your-user-uuid> \
  --add customer_subscription:items[0][price]=$STRIPE_PRICE_PRO_MONTHLY
```

(`--add <fixture>:<path>=<value>` overrides a field in the named fixture;
`stripe trigger --help` lists the fixture names. If your CLI version names the
subscription fixture differently, `stripe fixtures` triggers of recent CLIs
print the fixture file being used.)

An event type outside these five (`stripe trigger payment_intent.succeeded`,
say) is logged as unhandled and acknowledged with 200 — Stripe retries non-2xx,
so an event we ignore must still be accepted.

## 8. Verify the whole setup in one command

```bash
node --env-file=apps/web/.env.local scripts/stripe-smoke.mjs
```

It prints a pass/fail checklist: key present and valid, actually a **test**-mode
key, all four prices exist with the right amount/currency/interval, webhook
secret present, dashboard webhook endpoint (informational — local dev uses
`stripe listen` instead). It never prints the key. Run it first whenever
checkout "does nothing" or a webhook 400s — it distinguishes every §1–§4
mistake in one shot.
