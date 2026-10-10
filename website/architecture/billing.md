# Billing & entitlements

Billing answers one question for every request that spends something: *what may this caller do right now?* The answer is computed on the server from a verified identity, and client-side gating is a courtesy that improves the interface, never a control. That rule is ADR-0005 and it is the reason the billing code is shaped the way it is.

## Plans

`lib/plans.ts` is a pure module with no Stripe, Supabase or browser dependencies, so the same definitions run on the client (to decide what to show) and on the server (to decide what to allow).

| Plan | Price | Simulator | Saved circuits | Hardware jobs / month | Live tutor | Seats |
| --- | --- | --- | --- | --- | --- | --- |
| Free | — | 16 qubits | 10 | 0 | offline tier | 1 |
| Pro | $19 / month, $190 / year | 16 qubits | unlimited | 50 | yes | 1 |
| Team | $99 / month, $990 / year | 16 qubits | unlimited | 500 per seat | yes | 10 |
| University | arranged | 16 qubits | unlimited | 5,000 | yes | unlimited |

Twenty feature identifiers (`hardware.real`, `tutor.live`, `course.advanced`, `certification`, `team.admin`, …) are granted per plan. The full 16-qubit simulator, every visualization, the Foundations course, QASM export and the offline tutor are on every plan including Free; the simulator runs in the visitor's browser and costs nothing to serve.

A test asserts that every plan's marketing highlights agree with its enforced limits, and another that University's hand-arranged items (SSO configured with the customer's IT department, a syllabus-specific lesson track) appear only on the contact-sales plan. Plan copy cannot drift from plan code.

## Resolving an entitlement

`lib/billing/entitlements.ts` (server-only) produces an `Entitlement` for a verified user id:

1. Read the personal subscription row (`plan_id`, `status`).
2. Read any organisation seat (`org_members.plan_id`, `status`).
3. Take the stronger of the two.
4. Apply the launch trial if configured: `NEXT_PUBLIC_LAUNCH_TRIAL_DAYS` (rolling, per account) or `NEXT_PUBLIC_LAUNCH_TRIAL_UNTIL` (absolute date) treats signed-in accounts as Pro with status `trialing`. Nothing is written to the database; a real paid plan always wins.
5. Any lookup failure degrades to Free.

A subscription confers its plan only in good standing: `active`, `trialing` or `past_due` (dunning should not lock someone out mid-lesson); `canceled` and `incomplete` fall back to Free. Routes call `requireFeature(userId, feature)` and get a 402 `featureLockedResponse` on refusal. The `/api/billing/entitlement` endpoint exists so the interface can render the right state, and its documentation says in capitals that it is a courtesy, not a gate.

## Stripe

Stripe is optional. `isStripeConfigured` is true only when `STRIPE_SECRET_KEY` is set; without it, checkout returns `{ configured: false }` with a plain-language message and the pricing page says so.

- **Checkout** creates a Checkout Session for a verified user and carries the user id in session metadata. Inside the store apps it refuses with 403 (see [Mobile apps](../platform/mobile.md)).
- **Webhook** is the **only writer** of `subscriptions`. It verifies the signature against the raw body (400 on failure), logs every event id in `stripe_events` for idempotency, returns 500 on a database failure so Stripe retries, and 200 for a verified event it cannot use. Writes carry `event.created`, and the SQL function `apply_stripe_subscription` discards any write older than the stored one, so out-of-order delivery cannot downgrade a customer.
- **Reconcile** pulls truth from Stripe on demand: automatically when a subscription's period end is more than a day in the past, by a user for themselves, or by an operator with a secret for the nightly sweep.
- **Customer portal** lets a verified user manage their own subscription.

`scripts/stripe-smoke.mjs` asks Stripe directly whether the configured price ids, webhook secret and key are valid, one pass/fail line per claim, so a misconfigured deployment is caught before a customer finds it.

## Metering hardware jobs

Quota is the one place where a race would cost real money, so it **fails closed**. `lib/billing/usage.ts` reserves a job through the SQL function `reserve_hardware_job` (later wrapped by `reserve_hardware_job_within_budget`), which counts this period's rows and inserts the new one under a per-user advisory lock. The browser cannot insert into `hardware_usage` at all. If the store is unreachable, `QuotaUnavailableError` becomes a 503 rather than a free job. The usage window is the subscription's monthly anchor, with a UTC calendar month as the fallback.

Spend budgets (`spend_budgets`) add a second ceiling expressed in jobs and shots rather than dollars, because no invoice feed exists to meter against. A warning fires once per period at a configurable percentage and a hard stop is optional. A one-time engagement bonus of 25 hardware jobs is granted through `hardware_bonus`.

## Organisations

Team and University plans own seats. Only those plans can create an organisation, and creation requires the caller's own active subscription at the same plan, so a Free account cannot self-grant seats. Roles are owner, admin and member; the last owner cannot be removed or demoted; seat caps are re-checked server-side on every invite; suspended seats free capacity. Invites hold a seat as `invited`, use random hashed tokens, and are accepted only by the matching verified email. Instructors see a learner's progress only when the learner has written a consent row for that organisation; an instructor cannot consent on a learner's behalf.
