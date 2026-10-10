/**
 * access.test.ts — what the certification catalogue claims about itself.
 *
 * Small on purpose, and no longer small because the module is decorative.
 * `featureForExam` is now the input to a real gate: `lib/exams/service.ts`
 * feeds it to `assertFeature` before it will draw a paper, so an anonymous or
 * free-tier call to /api/exams/advanced-cert/attempt is refused with a 402 and
 * no questions. That refusal is tested end to end in `attemptRoutes.test.ts`.
 *
 * What THIS file pins down is the pair of promises the pricing page and
 * /certify both make in writing: the foundations certification is free, and the
 * advanced one is the paid tier's — behind the same plan as the advanced track
 * it examines. Get this wrong and the gate above enforces the wrong thing
 * perfectly.
 */

import { describe, expect, it } from 'vitest'

import { EXAMS, getExam } from '@/lib/exams/catalogue'
import { featureForExam, isExamFree } from '@/lib/exams/access'
import { PLANS, hasFeature, requiredPlanFor, type Entitlement } from '@/lib/plans'

const free: Entitlement = { planId: 'free', status: 'none', hardwareJobsUsed: 0 }
const pro: Entitlement = { planId: 'pro', status: 'active', hardwareJobsUsed: 0 }

describe('exam entitlements', () => {
  it('keeps the foundations certification free to everyone', () => {
    const exam = getExam('foundations-cert')
    expect(exam, 'the foundations certification is missing').toBeTruthy()
    expect(isExamFree(exam!)).toBe(true)
    expect(featureForExam(exam!)).toBeNull()
  })

  it('puts the advanced certification behind the plan that sells it', () => {
    const exam = getExam('advanced-cert')
    expect(exam, 'the advanced certification is missing').toBeTruthy()

    const feature = featureForExam(exam!)
    expect(feature).toBe('certification')
    expect(isExamFree(exam!)).toBe(false)

    expect(hasFeature(free, feature!)).toBe(false)
    expect(hasFeature(pro, feature!)).toBe(true)
    expect(requiredPlanFor(feature!)).toBe('pro')
  })

  it('never gates an exam on a feature no plan grants', () => {
    // A `requiresFeature` nobody can satisfy would lock an exam permanently
    // while still advertising it — the certification version of selling
    // something that does not exist.
    for (const exam of EXAMS) {
      const feature = featureForExam(exam)
      if (feature === null) continue
      expect(
        PLANS.some((plan) => plan.features.includes(feature)),
        `${exam.id} requires ${feature}, which no plan includes`,
      ).toBe(true)
    }
  })
})
