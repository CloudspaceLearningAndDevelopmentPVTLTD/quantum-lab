'use client'

/**
 * useEntitlement — "what can this person do right now", with no backend required.
 *
 * The default deployment has neither Stripe nor Supabase configured. That is not
 * an error state: it simply means everyone is on the Free plan, which is a
 * complete product. So this hook never surfaces a failure — a missing route, a
 * 404, a dead network, a malformed body all resolve to FREE_ENTITLEMENT.
 */

import { useCallback, useEffect, useState } from 'react'
import { useSession } from '@/components/auth/useSession'
import { authFetch } from '@/lib/authFetch'
import {
  FREE_ENTITLEMENT,
  effectivePlan,
  type Entitlement,
  type Plan,
  type PlanId,
  type SubscriptionStatus,
} from '@/lib/plans'

export interface UseEntitlementResult {
  entitlement: Entitlement
  plan: Plan
  loading: boolean
  refresh: () => void
}

const PLAN_IDS: PlanId[] = ['free', 'pro', 'team', 'edu']
const STATUSES: SubscriptionStatus[] = [
  'none',
  'trialing',
  'active',
  'past_due',
  'canceled',
  'incomplete',
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Merge an untrusted JSON body onto the free entitlement, field by field.
 * Anything unrecognised is dropped rather than trusted.
 */
function mergeEntitlement(body: unknown): Entitlement {
  if (!isRecord(body)) return FREE_ENTITLEMENT

  const source = isRecord(body.entitlement) ? body.entitlement : body
  const merged: Entitlement = { ...FREE_ENTITLEMENT }

  const planId = source.planId
  if (typeof planId === 'string' && (PLAN_IDS as string[]).includes(planId)) {
    merged.planId = planId as PlanId
  }

  const status = source.status
  if (typeof status === 'string' && (STATUSES as string[]).includes(status)) {
    merged.status = status as SubscriptionStatus
  }

  if (typeof source.currentPeriodEnd === 'string') {
    merged.currentPeriodEnd = source.currentPeriodEnd
  }
  if (typeof source.cancelAtPeriodEnd === 'boolean') {
    merged.cancelAtPeriodEnd = source.cancelAtPeriodEnd
  }
  if (typeof source.viaOrgId === 'string') {
    merged.viaOrgId = source.viaOrgId
  }
  if (source.launchTrial === true) {
    merged.launchTrial = true
  }
  if (typeof source.hardwareJobsUsed === 'number' && Number.isFinite(source.hardwareJobsUsed)) {
    merged.hardwareJobsUsed = Math.max(0, Math.floor(source.hardwareJobsUsed))
  }

  return merged
}

export function useEntitlement(): UseEntitlementResult {
  const { user, loading: sessionLoading } = useSession()
  const [entitlement, setEntitlement] = useState<Entitlement>(FREE_ENTITLEMENT)
  const [loading, setLoading] = useState(true)
  const [nonce, setNonce] = useState(0)

  const userId = user?.id ?? null

  useEffect(() => {
    // SSR guard — there is nothing to fetch, and no window to fetch from.
    if (typeof window === 'undefined') return

    if (sessionLoading) {
      setLoading(true)
      return
    }

    if (!userId) {
      setEntitlement(FREE_ENTITLEMENT)
      setLoading(false)
      return
    }

    const controller = new AbortController()
    let active = true
    setLoading(true)

    const run = async () => {
      try {
        // SECURITY (docs/SECURITY.md checklist item 2): the route derives the
        // caller from this token and answers the free tier to anyone who cannot
        // prove the id is theirs. Without the header a signed-in Pro user saw
        // the Free badge.
        const response = await authFetch(
          `/api/billing/entitlement?userId=${encodeURIComponent(userId)}`,
          { signal: controller.signal, headers: { accept: 'application/json' } }
        )
        if (!active) return
        if (!response.ok) {
          // The route may not exist yet, or may have nothing to say. Free is the
          // correct answer either way.
          setEntitlement(FREE_ENTITLEMENT)
          setLoading(false)
          return
        }
        const body: unknown = await response.json()
        if (!active) return
        setEntitlement(mergeEntitlement(body))
        setLoading(false)
      } catch {
        if (!active) return
        setEntitlement(FREE_ENTITLEMENT)
        setLoading(false)
      }
    }

    void run()

    return () => {
      active = false
      controller.abort()
    }
  }, [userId, sessionLoading, nonce])

  const refresh = useCallback(() => {
    setNonce((n) => n + 1)
  }, [])

  return { entitlement, plan: effectivePlan(entitlement), loading, refresh }
}

export default useEntitlement
