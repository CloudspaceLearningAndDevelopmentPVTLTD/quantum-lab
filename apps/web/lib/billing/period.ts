/**
 * period.ts — what "this month" means for a metered allowance.
 *
 * PURE module: no Supabase, no Stripe, no environment. Imported by
 * `lib/billing/usage.ts` (the enforcing count), `lib/billing/entitlements.ts`
 * (the badge count) and the tests. It lives on its own so those two cannot
 * drift: a quota enforced over one window and displayed over another produces
 * "it says I have 8 left but it refuses me", which is the worst kind of billing
 * bug because the customer is right.
 *
 * ── THE DECISION, AND WHAT IT COSTS ────────────────────────────────────────
 *
 * Two candidate windows, and they genuinely differ:
 *
 *   (a) CALENDAR MONTH (UTC). What this code used to do, everywhere, via
 *       `startOfUtcMonth()`. Simple, identical for every account, trivially
 *       explainable. It over-grants: a customer who subscribes on 20 January
 *       gets the tail of January's 50 jobs and a fresh 50 on 1 February —
 *       up to 100 hardware jobs inside the first billing period they paid one
 *       month for. On Pro that is 50 jobs of IBM time the operator hands out
 *       for nothing, every time somebody subscribes late in a month, which is
 *       most of the time.
 *
 *   (b) THE SUBSCRIPTION'S OWN MONTHLY ANCHOR. The window runs from the most
 *       recent monthly anniversary of the subscription's billing anchor. A
 *       customer who subscribes on 20 January gets 50 jobs for 20 Jan–20 Feb
 *       and 50 for 20 Feb–20 Mar. Exactly what they paid for, no more.
 *
 * WE PICK (b), with (a) as the fallback for anyone who has no anchor. The
 * workstream is "the money path must be correct", and (a)'s error is in the
 * expensive direction and is not rare — it fires for the majority of new
 * subscribers. Do not "simplify" this back to a calendar month without
 * re-deciding that trade; the double allowance is the whole reason it is here.
 *
 * ── WHY THE ANCHOR IS A DAY-OF-MONTH AND NOT `current_period_start` ────────
 *
 * The obvious implementation — subtract one billing interval from
 * `current_period_end` — is WRONG FOR ANNUAL PLANS. A yearly Pro subscription
 * has `current_period_end` twelve months out, so that arithmetic yields a
 * twelve-month window holding a fifty-job allowance: an annual customer would
 * get 50 jobs a YEAR while the pricing page promises 50 a month. Every plan
 * meters per month regardless of how often the card is charged
 * (`limits.hardwareJobsPerMonth` in lib/plans.ts), so the window has to be a
 * month whatever the interval is.
 *
 * So we take only the ANCHOR — the UTC day-of-month and time-of-day of
 * `current_period_end` — and step it monthly. Two consequences worth knowing:
 *
 *  · It is ROBUST TO A STALE ROW. The anchor day of a subscription does not
 *    change when it renews, so a `current_period_end` that a missed webhook
 *    left a month (or a year) in the past still yields the correct window.
 *    That matters because §3 of this workstream exists precisely because
 *    webhooks get missed. A derivation that needed a fresh period_end would
 *    silently cut customers off early during exactly the outage it should
 *    survive.
 *  · MONTH LENGTHS ARE CLAMPED. Anchor day 31 resolves to 28/29 February and
 *    to the 30th in April, the same clamp Stripe applies to its own billing
 *    anchor, so the windows tile with no gap and no overlap.
 *
 * ── WHO GETS THE CALENDAR-MONTH FALLBACK, AND WHY THAT IS SAFE ─────────────
 *
 * A missing anchor means one of: a Free account (allowance 0 — the window is
 * irrelevant, every submission is refused on the feature check first), an
 * org-seat holder (`getEntitlement` deliberately clears `currentPeriodEnd`
 * when a seat outranks a personal subscription, because the seat's period is
 * the ORG's and this user's row knows nothing about it), or a subscription
 * whose row predates this column. For the first the window cannot matter; for
 * the other two the calendar month is the same answer the system gave before
 * this change, so nobody's allowance moves under them without a plan change.
 */

/** First instant of the current calendar month, in UTC, as an ISO string. */
export function startOfUtcMonth(now: Date = new Date()): string {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0)
  ).toISOString()
}

/** Days in a UTC month. `Date.UTC(y, m + 1, 0)` is the last day of month `m`. */
function daysInUtcMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
}

/**
 * The instant in (year, monthIndex) that carries the anchor's day-of-month and
 * time-of-day, with the day clamped to the length of that month.
 */
function anchorIn(year: number, monthIndex: number, anchor: Date): number {
  const day = Math.min(anchor.getUTCDate(), daysInUtcMonth(year, monthIndex))
  return Date.UTC(
    year,
    monthIndex,
    day,
    anchor.getUTCHours(),
    anchor.getUTCMinutes(),
    anchor.getUTCSeconds(),
    anchor.getUTCMilliseconds()
  )
}

/**
 * The start of the usage window that `now` falls inside, as an ISO string.
 *
 * @param currentPeriodEnd `subscriptions.current_period_end` — any ISO string
 *        Stripe has ever reported for this subscription. Only its day-of-month
 *        and time-of-day are read, so a stale value is still correct (see the
 *        module header). Null/undefined/unparseable ⇒ calendar month.
 * @param now Injectable for tests. Defaults to the current instant.
 *
 * The returned window is half-open: `[start, start + 1 month)`. Counting rows
 * with `created_at >= start` is therefore exactly one month's usage, and no row
 * is counted twice across a boundary.
 */
export function usagePeriodStart(
  currentPeriodEnd: string | null | undefined,
  now: Date = new Date()
): string {
  if (!currentPeriodEnd) return startOfUtcMonth(now)
  const anchor = new Date(currentPeriodEnd)
  if (Number.isNaN(anchor.getTime())) return startOfUtcMonth(now)

  const year = now.getUTCFullYear()
  const month = now.getUTCMonth()

  // The anniversary inside the current calendar month. If it has not happened
  // yet, the window we are in opened in the previous calendar month.
  let start = anchorIn(year, month, anchor)
  if (start > now.getTime()) start = anchorIn(year, month - 1, anchor)

  return new Date(start).toISOString()
}

/**
 * The end of the window `usagePeriodStart` returned — i.e. when the allowance
 * next resets. Rendered on the account page ("50 of 50 used, resets 20 Feb"),
 * because "you are out until some unspecified future date" is a support ticket.
 */
export function usagePeriodEnd(
  currentPeriodEnd: string | null | undefined,
  now: Date = new Date()
): string {
  const start = new Date(usagePeriodStart(currentPeriodEnd, now))
  if (!currentPeriodEnd || Number.isNaN(new Date(currentPeriodEnd).getTime())) {
    // Calendar-month fallback: the first of next month.
    return new Date(
      Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1, 0, 0, 0, 0)
    ).toISOString()
  }
  const anchor = new Date(currentPeriodEnd)
  return new Date(
    anchorIn(start.getUTCFullYear(), start.getUTCMonth() + 1, anchor)
  ).toISOString()
}
