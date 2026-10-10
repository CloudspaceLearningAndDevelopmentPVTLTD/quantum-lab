import { describe, expect, it } from 'vitest'
import { FREE_ENTITLEMENT, effectivePlan, hasFeature, type Entitlement } from '@/lib/plans'
import {
  applyLaunchTrial,
  launchTrialActive,
  launchTrialDays,
  launchTrialEndsAt,
  launchTrialUntil,
} from './launchTrial'

// The launch-period policy: every account younger than N days is Pro. Pure
// functions with the clock passed in, so every boundary here is exact.

const T0 = new Date('2026-09-01T00:00:00.000Z')
const day = (n: number) => new Date(T0.getTime() + n * 24 * 60 * 60 * 1000)

describe('launchTrialDays', () => {
  it('is off when unset, blank, non-numeric, zero, negative or absurd', () => {
    for (const raw of [undefined, '', '  ', 'thirty', '0', '-5', '99999']) {
      expect(launchTrialDays(raw)).toBe(0)
    }
  })

  it('parses a plain day count, tolerating whitespace', () => {
    expect(launchTrialDays('30')).toBe(30)
    expect(launchTrialDays(' 14 ')).toBe(14)
  })
})

describe('applyLaunchTrial', () => {
  it('does nothing when the policy is off', () => {
    expect(applyLaunchTrial(FREE_ENTITLEMENT, T0, 0, day(1))).toBe(FREE_ENTITLEMENT)
  })

  it('grants Pro/trialing to a fresh account, ending exactly N days after creation', () => {
    const e = applyLaunchTrial(FREE_ENTITLEMENT, T0, 30, day(1))
    expect(e.planId).toBe('pro')
    expect(e.status).toBe('trialing')
    expect(e.launchTrial).toBe(true)
    expect(e.currentPeriodEnd).toBe(launchTrialEndsAt(T0, 30))
    expect(e.currentPeriodEnd).toBe('2026-10-01T00:00:00.000Z')
    expect(effectivePlan(e).id).toBe('pro')
    expect(hasFeature(e, 'hardware.real')).toBe(true)
  })

  it('is inclusive of the last instant before expiry and exclusive at it', () => {
    const justBefore = new Date(day(30).getTime() - 1)
    expect(applyLaunchTrial(FREE_ENTITLEMENT, T0, 30, justBefore).planId).toBe('pro')
    expect(applyLaunchTrial(FREE_ENTITLEMENT, T0, 30, day(30))).toBe(FREE_ENTITLEMENT)
    expect(applyLaunchTrial(FREE_ENTITLEMENT, T0, 30, day(400))).toBe(FREE_ENTITLEMENT)
  })

  it('keeps the usage counter from the resolved entitlement', () => {
    const used: Entitlement = { ...FREE_ENTITLEMENT, hardwareJobsUsed: 7 }
    expect(applyLaunchTrial(used, T0, 30, day(1)).hardwareJobsUsed).toBe(7)
  })

  it('never downgrades a real paid plan or org seat in good standing', () => {
    const team: Entitlement = {
      planId: 'team',
      status: 'active',
      viaOrgId: 'org-1',
      hardwareJobsUsed: 0,
    }
    expect(applyLaunchTrial(team, T0, 30, day(1))).toBe(team)
    const pro: Entitlement = {
      planId: 'pro',
      status: 'past_due',
      currentPeriodEnd: '2026-09-15T00:00:00.000Z',
      hardwareJobsUsed: 2,
    }
    expect(applyLaunchTrial(pro, T0, 30, day(1))).toBe(pro)
  })

  it('does override a canceled or incomplete paid row — those resolve to free anyway', () => {
    const canceled: Entitlement = { planId: 'pro', status: 'canceled', hardwareJobsUsed: 0 }
    const e = applyLaunchTrial(canceled, T0, 30, day(1))
    expect(e.planId).toBe('pro')
    expect(e.status).toBe('trialing')
    expect(e.launchTrial).toBe(true)
  })

  it('grants an open-ended trial when the account age is unknowable, and says so', () => {
    const e = applyLaunchTrial(FREE_ENTITLEMENT, null, 30, day(1))
    expect(e.planId).toBe('pro')
    expect(e.status).toBe('trialing')
    expect(e.launchTrial).toBe(true)
    expect(e.currentPeriodEnd).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// The absolute window — "everything is free for the next three months"
//
// The per-account window alone cannot express that. Under it, somebody who
// registers on the last day of the promotion gets a further N days, so a
// three-month promise quietly becomes a six-month one and there is no date on
// which it ends.
// ---------------------------------------------------------------------------

describe('launchTrialUntil', () => {
  it('reads a plain date as UTC midnight', () => {
    expect(launchTrialUntil('2026-12-17')?.toISOString()).toBe('2026-12-17T00:00:00.000Z')
  })

  it('reads a full ISO instant', () => {
    expect(launchTrialUntil('2026-12-17T09:30:00.000Z')?.toISOString()).toBe(
      '2026-12-17T09:30:00.000Z'
    )
  })

  it('treats an unparseable value as not configured, not as 1970', () => {
    // A date in 1970 would silently switch the promotion OFF for every user
    // because of a typo. That is the expensive direction of the mistake, so
    // the fallback is "no absolute end" rather than "already ended".
    for (const junk of ['soon', '17-12-2026', 'yes', '']) {
      expect(launchTrialUntil(junk)).toBeNull()
    }
  })
})

describe('applyLaunchTrial with an absolute end', () => {
  const free = { planId: 'free', status: 'active', hardwareJobsUsed: 3 } as const
  const until = new Date('2026-12-17T00:00:00.000Z')

  it('grants the trial regardless of when the account was created', () => {
    // This is the difference from the per-account window: an account created
    // two years ago is still covered by a promotion that is running now.
    const ancient = new Date('2024-01-01T00:00:00.000Z')
    const result = applyLaunchTrial({ ...free }, ancient, 0, new Date('2026-10-01T00:00:00.000Z'), until)

    expect(result.planId).toBe('pro')
    expect(result.status).toBe('trialing')
    expect(result.launchTrial).toBe(true)
  })

  it('grants the trial with no account age available at all', () => {
    // The absolute window needs no admin lookup, so a missing service-role key
    // must not be able to switch the promotion off.
    const result = applyLaunchTrial({ ...free }, null, 0, new Date('2026-10-01T00:00:00.000Z'), until)

    expect(result.planId).toBe('pro')
    expect(result.currentPeriodEnd).toBe(until.toISOString())
  })

  it('stops for everybody at the instant it ends', () => {
    const result = applyLaunchTrial({ ...free }, null, 0, until, until)

    expect(result.planId).toBe('free')
    expect(result.launchTrial).toBeUndefined()
  })

  it('never inflates the hardware allowance', () => {
    // THE THING THAT MUST NOT BREAK. The promotion is about not charging for
    // ACCESS. QPU time is bought with real money, so a trial account is Pro
    // and gets Pro's 50 jobs a month — not unlimited.
    const result = applyLaunchTrial({ ...free }, null, 0, new Date('2026-10-01T00:00:00.000Z'), until)

    expect(result.planId).toBe('pro')
    expect(result.hardwareJobsUsed).toBe(3)
  })

  it('takes the EARLIER of the two windows', () => {
    // A new account under a promotion that ends first gets the promotion's
    // end, not its own later one — otherwise the promotion outlives its date.
    const createdAt = new Date('2026-12-10T00:00:00.000Z')
    const result = applyLaunchTrial(
      { ...free },
      createdAt,
      90, // would run to 2027-03-10 on its own
      new Date('2026-12-11T00:00:00.000Z'),
      until, // 2026-12-17
    )

    expect(result.currentPeriodEnd).toBe(until.toISOString())
  })

  it('takes the per-account end when that one is earlier', () => {
    const createdAt = new Date('2026-09-01T00:00:00.000Z')
    const result = applyLaunchTrial(
      { ...free },
      createdAt,
      7, // runs out 2026-09-08
      new Date('2026-09-02T00:00:00.000Z'),
      until, // much later
    )

    expect(result.currentPeriodEnd).toBe('2026-09-08T00:00:00.000Z')
  })

  it('refuses once the per-account window has run out, even inside the promotion', () => {
    const createdAt = new Date('2026-09-01T00:00:00.000Z')
    const result = applyLaunchTrial(
      { ...free },
      createdAt,
      7,
      new Date('2026-09-20T00:00:00.000Z'), // past the 7 days, inside the promotion
      until,
    )

    expect(result.planId).toBe('free')
  })

  it('still lets a real paid plan win', () => {
    const paid = { planId: 'team', status: 'active', hardwareJobsUsed: 0 } as const
    const result = applyLaunchTrial({ ...paid }, null, 0, new Date('2026-10-01T00:00:00.000Z'), until)

    expect(result.planId).toBe('team')
    expect(result.launchTrial).toBeUndefined()
  })

  it('does nothing when neither window is configured', () => {
    const result = applyLaunchTrial({ ...free }, null, 0, new Date('2026-10-01T00:00:00.000Z'), null)

    expect(result.planId).toBe('free')
  })
})

describe('launchTrialActive', () => {
  it('is true when either window is set, false when neither is', () => {
    expect(launchTrialActive(90, null)).toBe(true)
    expect(launchTrialActive(0, new Date('2026-12-17'))).toBe(true)
    expect(launchTrialActive(0, null)).toBe(false)
  })
})
