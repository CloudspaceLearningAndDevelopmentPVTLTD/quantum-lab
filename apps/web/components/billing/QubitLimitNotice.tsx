'use client'

/**
 * QubitLimitNotice — one slim line under the qubit selector that says, plainly,
 * how many qubits this plan allows and what the next plan up would give.
 *
 * It renders nothing once the user is already at the ceiling, so a Team user
 * never sees an upsell for something they already bought. Callers pass the
 * ceiling while the entitlement is still loading, which also keeps this quiet
 * during that first frame rather than flashing a downgrade at a paying user.
 */

import Link from 'next/link'
import { launchTrialDays } from '@/lib/billing/launchTrial'
import { PLANS, PLAN_BY_ID, type Plan, type PlanId } from '@/lib/plans'

export interface QubitLimitNoticeProps {
  /** Qubits the current plan allows. */
  allowed: number
  /** The highest qubit count any plan allows. */
  ceiling: number
  planId: PlanId
}

/** The cheapest self-serve plan that allows more qubits than `allowed`. */
function nextPlanAbove(allowed: number): Plan | undefined {
  return PLANS.find((p) => !p.contactSales && p.limits.maxQubits > allowed)
}

export default function QubitLimitNotice({ allowed, ceiling, planId }: QubitLimitNoticeProps) {
  if (allowed >= ceiling) return null

  const next = nextPlanAbove(allowed)
  if (!next) return null

  const current = PLAN_BY_ID[planId]

  return (
    <p className="flex flex-wrap items-center gap-x-1.5 text-[11px] text-q-amber-text">
      <span aria-hidden="true">🔒</span>
      <span>
        {allowed} qubits on {current.name} — {next.name} unlocks {next.limits.maxQubits}
      </span>
      <Link href="/pricing" className="focus-ring rounded font-semibold underline underline-offset-2">
        {launchTrialDays() > 0 && planId === 'free' ? 'Free with an account' : 'Upgrade'}
      </Link>
    </p>
  )
}

export { QubitLimitNotice }
