'use client'

/**
 * UpgradeGate — the one place a paywall is drawn.
 *
 * Two rules make this feel fair rather than adversarial:
 *   1. While the entitlement is still loading we render the children, not the
 *      lock. Flashing a paywall at someone who already pays is the worst
 *      possible first frame.
 *   2. In 'overlay' mode the locked thing stays visible behind a blur, so the
 *      user can see what they would be getting instead of a closed door.
 *
 * This is a courtesy gate. The server enforces the real one via assertFeature.
 */

import Link from 'next/link'
import { useEffect, useId, useRef, type ReactNode } from 'react'
import { announce } from '@/lib/a11y/announce'
import { useEntitlement } from '@/components/billing/useEntitlement'
import { VISUALIZATIONS } from '@/components/ui/Hero'
import {
  PLAN_BY_ID,
  hasFeature,
  requiredPlanFor,
  type FeatureId,
  type Plan,
  type PlanId,
} from '@/lib/plans'
import { AlreadySubscribedPrompt } from '@/components/auth/SignInLink'

export interface UpgradeGateProps {
  feature: FeatureId
  children: ReactNode
  mode?: 'block' | 'overlay'
  title?: string
  description?: string
}

export function UpgradeGate({
  feature,
  children,
  mode = 'block',
  title,
  description,
}: UpgradeGateProps) {
  const { entitlement, loading } = useEntitlement()
  const allowed = hasFeature(entitlement, feature)
  const locked = !loading && !allowed

  const requiredId = requiredPlanFor(feature)
  const requiredPlan = PLAN_BY_ID[requiredId]
  const heading = title ?? `A ${requiredPlan.name} feature`
  const body =
    description ??
    `${featureLabel(feature)} is part of the ${requiredPlan.name} plan. Everything you have now stays exactly as it is.`

  /*
   * A11Y (WCAG 4.1.3). Rule 1 above means a locked user is shown the real
   * content for one frame and then has it swapped for the lock — the
   * entitlement resolves over the network. A sighted user watches that happen.
   * Without this, a screen-reader user reading the page simply finds the
   * content gone mid-sentence with no cause given. Announce the reason once,
   * when the gate actually closes.
   */
  const announced = useRef(false)
  useEffect(() => {
    if (!locked) {
      announced.current = false
      return
    }
    if (announced.current) return
    announced.current = true
    announce(`${heading}. ${body}`)
  }, [locked, heading, body])

  if (loading) {
    return <div aria-busy="true">{children}</div>
  }

  if (allowed) {
    return <>{children}</>
  }

  if (mode === 'overlay') {
    return (
      <div className="relative">
        {/*
          `aria-hidden` alone was a defect, not a fix: the blurred content stays
          in the tab order, so a keyboard user tabbed through controls that
          report nothing at all to assistive tech (aria-hidden on focusable
          content is explicitly disallowed) and cannot be clicked either.
          MEASURED on /hardware against the shipped build: 9 focusable elements
          inside the aria-hidden subtree, including the shots control and the
          Submit button — and more once the device catalogue loads.
          `inert` removes focus, pointer events and the a11y tree in one.
        */}
        <Inert className="select-none opacity-40 blur-[1px]">{children}</Inert>
        <div className="absolute inset-0 grid place-items-center p-4">
          <UpgradeCard
            planId={requiredId}
            plan={requiredPlan}
            heading={heading}
            body={body}
            className="max-w-sm shadow-2xl"
          />
        </div>
      </div>
    )
  }

  return <UpgradeCard planId={requiredId} plan={requiredPlan} heading={heading} body={body} />
}

/**
 * A wrapper that is genuinely inert.
 *
 * React 18 does not know the `inert` attribute (it landed as a real prop in 19),
 * and `inert=""` written by hand is dropped as an unknown boolean. Setting the
 * IDL attribute from a ref is the only form that works on this React version;
 * it is supported by Chrome 102+, Safari 15.5+ and Firefox 112+. The
 * `aria-hidden`/`pointer-events-none` pair is kept as the fallback for older
 * engines, where it is still better than nothing — but on its own it leaves the
 * subtree focusable, which is the bug this exists to fix.
 */
function Inert({ children, className }: { children: ReactNode; className: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const node = ref.current
    if (!node) return
    node.inert = true
    return () => {
      node.inert = false
    }
  }, [])
  return (
    <div ref={ref} aria-hidden="true" className={`pointer-events-none ${className}`}>
      {children}
    </div>
  )
}

function UpgradeCard({
  planId,
  plan,
  heading,
  body,
  className = '',
}: {
  planId: PlanId
  plan: Plan
  heading: string
  body: string
  className?: string
}) {
  // A11Y (WCAG 1.3.1/2.4.1): the lock replaces content the user was reading, so
  // it has to be findable in the landmark/region list rather than being an
  // anonymous <div> where the feature used to be.
  const headingId = useId()

  return (
    <div className={`card p-5 ${className}`} role="region" aria-labelledby={headingId}>
      <div
        className="grid h-[38px] w-[38px] place-items-center rounded-xl text-base"
        style={{ backgroundColor: 'rgb(var(--q-violet-rgb) / 0.15)' }}
        aria-hidden="true"
      >
        🔒
      </div>

      <h3 id={headingId} className="mt-3.5 text-base font-bold text-ink">
        {heading}
      </h3>
      <p className="mt-1.5 text-[13px] text-ink-secondary">{body}</p>

      <ul className="mt-3.5 space-y-1.5">
        {plan.highlights.slice(0, 4).map((highlight) => (
          <li key={highlight} className="flex gap-2 text-[13px] text-ink-secondary">
            <span aria-hidden="true" className="mt-[1px] text-q-teal-text">
              ✓
            </span>
            <span>{highlight}</span>
          </li>
        ))}
      </ul>

      <Link href="/pricing" className="btn-primary focus-ring mt-4">
        See {plan.name} plans
      </Link>
      <AlreadySubscribedPrompt className="mt-2 text-[12px] text-ink-secondary" />
      <p className="mt-2 text-[11px] text-ink-muted">
        {planId === 'free'
          ? 'Included with every account.'
          : `The whole Foundations course and all ${VISUALIZATIONS.length} visualizations stay free.`}
      </p>
    </div>
  )
}

/** Human-readable name for a feature id, used in the default gate copy. */
const FEATURE_LABELS: Partial<Record<FeatureId, string>> = {
  'simulator.qubits.12': 'Simulating 12 qubits',
  'simulator.qubits.16': 'Simulating 16 qubits',
  'circuits.unlimited': 'Unlimited saved circuits',
  'hardware.vendor': 'Vendor hardware backends',
  'hardware.real': 'Running on real quantum hardware',
  'tutor.live': 'The live AI tutor',
  'course.advanced': 'The advanced course track',
  certification: 'Certification',
  'export.notebook': 'Notebook export',
  'team.seats': 'Team seats',
  'team.admin': 'The admin console',
  'analytics.usage': 'Usage analytics',
}

function featureLabel(feature: FeatureId): string {
  return FEATURE_LABELS[feature] ?? 'This'
}

/** Boolean form of the gate, for callers that need to disable a control. */
export function useFeature(feature: FeatureId): { allowed: boolean; loading: boolean } {
  const { entitlement, loading } = useEntitlement()
  return { allowed: hasFeature(entitlement, feature), loading }
}

export default UpgradeGate
