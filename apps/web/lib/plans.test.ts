/**
 * plans.test.ts — the pricing page may not promise what the entitlement layer
 * cannot grant.
 *
 * These tests are less about the arithmetic of `hasFeature` (which is a one-line
 * `includes`) and more about the invariant that keeps marketing copy honest:
 * every ✓ bullet on a plan card must correspond to something a buyer receives
 * the moment checkout completes, and anything a human has to arrange by hand
 * must live in `arrangedHighlights`, on a contact-sales plan, where the reader
 * is told so.
 *
 * The four capabilities that motivated this file — SSO, LMS grade passback, a
 * priority hardware queue and an org-shared circuit library — are asserted
 * absent from `FeatureId` on purpose. Adding an id for any of them without also
 * building and gating the thing would move the lie rather than fix it.
 */

import { describe, expect, it } from 'vitest'
import {
  FREE_ENTITLEMENT,
  FeatureLockedError,
  PLANS,
  PLAN_BY_ID,
  assertFeature,
  canRunHardware,
  effectivePlan,
  hasFeature,
  requiredPlanFor,
  type Entitlement,
  type FeatureId,
  type PlanId,
  maxQubitsFor,
} from './plans'

function entitlement(planId: PlanId, over: Partial<Entitlement> = {}): Entitlement {
  return { planId, status: 'active', hardwareJobsUsed: 0, ...over }
}

const ALL_FEATURES: FeatureId[] = Array.from(new Set(PLANS.flatMap((p) => p.features)))

// ────────────────────────────────────────────────────────────
// The unpromising: ids that must NOT exist
// ────────────────────────────────────────────────────────────

describe('unbuilt capabilities have no FeatureId', () => {
  // A FeatureId is a promise `assertFeature` can keep. None of these has any
  // implementation anywhere in the repo, so none may be granted: no SSO code
  // path (Supabase Auth SSO is project configuration, not app code), no LTI
  // endpoint, no queue we control, no org-scoped circuit table. If you are here
  // because you just built one of them, add the id AND the server gate in the
  // same change — a granted-but-unenforced id is the bug this file exists for.
  const forbidden = ['sso', 'lms', 'lti', 'passback', 'priority', 'library', 'custom.track']

  it('no plan grants a feature named after one', () => {
    for (const feature of ALL_FEATURES) {
      for (const word of forbidden) {
        expect(feature.toLowerCase()).not.toContain(word)
      }
    }
  })

  it('the University plan grants exactly the Team feature set', () => {
    // edu differs from team in LIMITS (seats, hardware allowance), not in
    // capabilities. If that stops being true, the copy has to change too.
    expect([...PLAN_BY_ID.edu.features].sort()).toEqual([...PLAN_BY_ID.team.features].sort())
  })
})

// ────────────────────────────────────────────────────────────
// Copy ↔ entitlement invariants
// ────────────────────────────────────────────────────────────

describe('plan highlights', () => {
  it('never claim a capability the entitlement layer cannot grant', () => {
    const banned = [
      /\bsso\b/i,
      /single sign-on/i,
      /grade ?passback/i,
      /\blms\b/i,
      /priority .*queue/i,
      /shared circuit library/i,
      /custom lesson track/i,
    ]
    for (const plan of PLANS) {
      for (const line of plan.highlights) {
        for (const pattern of banned) {
          expect(
            pattern.test(line),
            `${plan.id} highlight "${line}" promises something with no FeatureId`
          ).toBe(false)
        }
      }
    }
  })

  it('only a contact-sales plan may list arranged-by-hand capabilities', () => {
    for (const plan of PLANS) {
      if (plan.arrangedHighlights && plan.arrangedHighlights.length > 0) {
        expect(plan.contactSales, `${plan.id} is self-serve`).toBe(true)
      }
    }
  })

  it('are non-empty and free of duplicates on every plan', () => {
    for (const plan of PLANS) {
      const all = [...plan.highlights, ...(plan.arrangedHighlights ?? [])]
      expect(plan.highlights.length).toBeGreaterThan(0)
      expect(new Set(all).size).toBe(all.length)
    }
  })
})

describe('numeric claims match limits', () => {
  it('Team advertises the hardware allowance it actually has', () => {
    const team = PLAN_BY_ID.team
    const line = team.highlights.find((h) => h.includes('hardware jobs'))
    expect(line).toBeDefined()
    expect(line).toContain(team.limits.hardwareJobsPerMonth.toLocaleString('en-US'))
  })

  it('University advertises the hardware allowance it actually has', () => {
    const edu = PLAN_BY_ID.edu
    const line = edu.highlights.find((h) => h.includes('hardware jobs'))
    expect(line).toBeDefined()
    expect(line).toContain(edu.limits.hardwareJobsPerMonth.toLocaleString('en-US'))
  })

  it('every plan simulates the full 16 qubits', () => {
    for (const plan of PLANS) {
      expect(plan.limits.maxQubits, plan.id).toBe(16)
      expect(maxQubitsFor(entitlement(plan.id)), plan.id).toBe(16)
    }
    expect(maxQubitsFor(FREE_ENTITLEMENT)).toBe(16)
  })

  it('every plan that advertises a qubit ceiling states its own', () => {
    for (const plan of PLANS) {
      const line = plan.highlights.find((h) => /\d+ qubits/.test(h))
      if (!line) continue
      const stated = Number(/(\d+) qubits/.exec(line)?.[1])
      expect(stated, `${plan.id} highlight "${line}"`).toBe(plan.limits.maxQubits)
    }
  })
})

// ────────────────────────────────────────────────────────────
// The features that DO exist: granted where they should be, refused elsewhere
// ────────────────────────────────────────────────────────────

describe('feature grants', () => {
  const cases: { feature: FeatureId; granted: PlanId[]; refused: PlanId[] }[] = [
    { feature: 'circuits.share', granted: ['free', 'pro', 'team', 'edu'], refused: [] },
    { feature: 'hardware.real', granted: ['pro', 'team', 'edu'], refused: ['free'] },
    { feature: 'tutor.live', granted: ['pro', 'team', 'edu'], refused: ['free'] },
    { feature: 'team.admin', granted: ['team', 'edu'], refused: ['free', 'pro'] },
    { feature: 'analytics.usage', granted: ['team', 'edu'], refused: ['free', 'pro'] },
    // The full 16-qubit simulator is free on every plan: it runs in the browser.
    { feature: 'simulator.qubits.16', granted: ['free', 'pro', 'team', 'edu'], refused: [] },
  ]

  for (const { feature, granted, refused } of cases) {
    it(`${feature} is granted on ${granted.join(', ') || 'nothing'}`, () => {
      for (const planId of granted) {
        expect(hasFeature(entitlement(planId), feature)).toBe(true)
        expect(() => assertFeature(entitlement(planId), feature)).not.toThrow()
      }
    })

    it(`${feature} is refused on ${refused.join(', ') || 'nothing'}`, () => {
      for (const planId of refused) {
        expect(hasFeature(entitlement(planId), feature)).toBe(false)
        // Server-side refusal, not just a hidden button: this is the throw the
        // route handler turns into a 402.
        expect(() => assertFeature(entitlement(planId), feature)).toThrow(FeatureLockedError)
      }
    })
  }

  it('reports the cheapest plan that includes a feature', () => {
    expect(requiredPlanFor('hardware.real')).toBe('pro')
    expect(requiredPlanFor('team.admin')).toBe('team')
    expect(requiredPlanFor('circuits.share')).toBe('free')
  })

  it('carries the required plan on the thrown error', () => {
    let caught: unknown
    try {
      assertFeature(FREE_ENTITLEMENT, 'team.admin')
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(FeatureLockedError)
    expect((caught as FeatureLockedError).feature).toBe('team.admin')
    expect((caught as FeatureLockedError).requiredPlan).toBe('team')
  })
})

describe('a lapsed subscription grants nothing paid', () => {
  for (const status of ['canceled', 'incomplete', 'none'] as const) {
    it(`${status} falls back to Free and is refused server-side`, () => {
      const lapsed = entitlement('edu', { status })
      expect(effectivePlan(lapsed).id).toBe('free')
      expect(() => assertFeature(lapsed, 'team.admin')).toThrow(FeatureLockedError)
      expect(() => assertFeature(lapsed, 'hardware.real')).toThrow(FeatureLockedError)
      // Free capabilities survive: a lapsed subscriber still gets the course.
      expect(() => assertFeature(lapsed, 'course.foundations')).not.toThrow()
    })
  }

  it('past_due keeps access — dunning must not interrupt a lesson', () => {
    const dunning = entitlement('pro', { status: 'past_due' })
    expect(hasFeature(dunning, 'course.advanced')).toBe(true)
  })
})

describe('hardware allowance', () => {
  it('is refused outright on Free', () => {
    expect(canRunHardware(FREE_ENTITLEMENT).allowed).toBe(false)
  })

  it('is refused once the monthly allowance is spent', () => {
    const spent = entitlement('team', {
      hardwareJobsUsed: PLAN_BY_ID.team.limits.hardwareJobsPerMonth,
    })
    const verdict = canRunHardware(spent)
    expect(verdict.allowed).toBe(false)
    expect(verdict.reason).toContain(String(PLAN_BY_ID.team.limits.hardwareJobsPerMonth))
  })

  it('is allowed with allowance remaining', () => {
    expect(canRunHardware(entitlement('pro', { hardwareJobsUsed: 49 })).allowed).toBe(true)
  })
})
