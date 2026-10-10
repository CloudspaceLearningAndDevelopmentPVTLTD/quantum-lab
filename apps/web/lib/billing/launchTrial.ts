/**
 * launchTrial.ts — "everything is free for the first N days after you sign up".
 *
 * A launch-period policy, switched on by either of two variables:
 *
 *     NEXT_PUBLIC_LAUNCH_TRIAL_DAYS=90     per-account: N days from signup
 *     NEXT_PUBLIC_LAUNCH_TRIAL_UNTIL=2026-12-17   absolute: free until a date
 *
 * While either is set, a signed-in account is treated as Pro (status
 * `trialing`). Nothing is written to the subscriptions table, no Stripe object
 * exists, and a real paid plan or org seat always wins — so turning the policy
 * off later is one env change, and accounts that bought something during the
 * trial are untouched.
 *
 * ── WHY THERE ARE TWO, AND WHEN TO USE WHICH ────────────────────────────────
 *
 * DAYS alone is a ROLLING window and cannot express "everything is free for
 * the next three months". Under it, somebody who registers on the last day of
 * the promotion gets a further 90 days, so a three-month promise quietly
 * becomes a six-month one, and there is no date on which it ends. That is fine
 * for an ongoing "new accounts get a free trial" offer and wrong for a launch
 * window with an end.
 *
 * UNTIL is the absolute form: every signed-in account is Pro until that
 * instant, whenever they registered, and on that instant the promotion is over
 * for everybody at once. This is what "free for the next 3 months" means.
 *
 * Set BOTH and the trial ends at whichever comes FIRST. That combination is
 * the conservative one and is usually what you want: a per-account cap so a
 * single account cannot sit on Pro indefinitely, plus a hard stop so the
 * promotion has a date.
 *
 * WHAT IS NOT FREE, and must not become free by accident: the QUOTAS. A trial
 * account is Pro, which means Pro's allowance — 50 hardware jobs a month, not
 * unlimited. Real QPU time is bought with real money and the promotion is
 * about not charging for ACCESS, not about removing the bound on spend. This
 * module grants `planId`, and `hardwareAllowance()` in lib/billing/usage.ts
 * reads the limit off that plan exactly as it does for a paying customer.
 *
 * It is a NEXT_PUBLIC_ variable on purpose: the pricing page (a client
 * component) needs the same number the server enforces, and one variable
 * cannot drift from itself. The server reads it through `launchTrialDays()`
 * below; nothing secret is in it.
 *
 * Everything in this module is pure and takes the clock as an argument, the
 * same rule lib/review/scheduler.ts follows, so the tests mean something.
 */

import { FREE_ENTITLEMENT, type Entitlement, type PlanId } from '@/lib/plans'

const DAY_MS = 24 * 60 * 60 * 1000

/** The plan a launch-trial account is treated as. */
export const LAUNCH_TRIAL_PLAN: PlanId = 'pro'

/**
 * Days of launch trial configured, or 0 when the per-account window is off.
 * Non-numeric, negative or absurd values are treated as off rather than as a
 * surprise.
 */
export function launchTrialDays(raw: string | undefined = process.env.NEXT_PUBLIC_LAUNCH_TRIAL_DAYS): number {
  if (!raw) return 0
  const n = Number.parseInt(raw.trim(), 10)
  if (!Number.isFinite(n) || n <= 0 || n > 3650) return 0
  return n
}

/**
 * The instant the promotion ends for everybody, or null when no absolute end
 * is configured.
 *
 * Accepts a plain date (`2026-12-17`, read as UTC midnight) or a full ISO
 * instant. An unparseable value is treated as "not configured" rather than as
 * a date in 1970 — the latter would silently switch the promotion OFF for
 * every user because of a typo, which is the expensive direction of that
 * mistake. A value already in the past is returned as-is: that is a promotion
 * that has ended, which is a real and correct state.
 *
 * @param raw The configured value.
 * @returns The end instant, or null.
 */
export function launchTrialUntil(
  raw: string | undefined = process.env.NEXT_PUBLIC_LAUNCH_TRIAL_UNTIL,
): Date | null {
  const text = (raw ?? '').trim()
  if (!text) return null
  const parsed = new Date(text.length === 10 ? `${text}T00:00:00.000Z` : text)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/** True when either form of the policy is configured. */
export function launchTrialActive(
  days: number = launchTrialDays(),
  until: Date | null = launchTrialUntil(),
): boolean {
  return days > 0 || until !== null
}

/** ISO instant the trial ends for an account created at `createdAt`. */
export function launchTrialEndsAt(createdAt: Date, days: number): string {
  return new Date(createdAt.getTime() + days * DAY_MS).toISOString()
}

const PLAN_RANK: Record<PlanId, number> = { free: 0, pro: 1, team: 2, edu: 3 }

/**
 * Apply the launch-trial policy to an already-resolved entitlement.
 *
 * Returns the input untouched when the policy is off, when the promotion has
 * ended, or when the account already holds something at least as strong as the
 * trial plan in good standing. Otherwise returns a Pro/trialing entitlement,
 * keeping the usage counter — the promotion grants ACCESS, never allowance.
 *
 * THE END INSTANT IS THE EARLIER OF THE TWO WINDOWS. `days` bounds one
 * account's time on Pro; `until` bounds the promotion itself. Taking the
 * earlier is what makes "free for the next three months" true for somebody who
 * registers in the last week of it — under the per-account window alone they
 * would keep Pro for months after the promotion was supposed to be over.
 *
 * `createdAt === null` means the account's age could not be determined (no
 * service-role key to ask the auth admin API). The per-account window is then
 * unenforceable, so it is skipped and the absolute one still applies — a
 * launch promise broken by a missing config value is worse than a trial whose
 * per-account half cannot be measured. With neither measurable, the trial is
 * granted with no `currentPeriodEnd`, which is how a caller tells the cases
 * apart.
 *
 * @param entitlement The entitlement resolved from subscriptions and org seats.
 * @param createdAt When the account was created, or null if unknown.
 * @param days The per-account window in days; 0 disables that half.
 * @param now The clock, injected so the tests mean something.
 * @param until The absolute end of the promotion, or null.
 * @returns The entitlement, possibly upgraded to a Pro trial.
 */
export function applyLaunchTrial(
  entitlement: Entitlement,
  createdAt: Date | null,
  days: number,
  now: Date,
  until: Date | null = null,
): Entitlement {
  if (days <= 0 && until === null) return entitlement

  // The promotion is over for everybody. Checked before anything else, so an
  // expired promotion costs one comparison rather than an admin lookup.
  if (until !== null && now.getTime() >= until.getTime()) return entitlement

  const good =
    entitlement.status === 'active' ||
    entitlement.status === 'trialing' ||
    entitlement.status === 'past_due'
  if (good && PLAN_RANK[entitlement.planId] >= PLAN_RANK[LAUNCH_TRIAL_PLAN]) return entitlement

  // Candidate end instants, in ms. A window that is off or unmeasurable
  // contributes nothing rather than contributing Infinity, so that "no window
  // at all" stays distinguishable from "a window that never ends".
  const ends: number[] = []
  if (days > 0 && createdAt !== null) ends.push(createdAt.getTime() + days * DAY_MS)
  if (until !== null) ends.push(until.getTime())

  // The per-account window has already run out. Note this cannot be reached
  // when `until` alone is configured, because then `ends` holds only `until`
  // and the check above already returned.
  if (ends.length > 0 && Math.min(...ends) <= now.getTime()) return entitlement

  const trial: Entitlement = {
    ...FREE_ENTITLEMENT,
    hardwareJobsUsed: entitlement.hardwareJobsUsed,
    planId: LAUNCH_TRIAL_PLAN,
    status: 'trialing',
    launchTrial: true,
  }
  if (ends.length > 0) trial.currentPeriodEnd = new Date(Math.min(...ends)).toISOString()
  return trial
}
