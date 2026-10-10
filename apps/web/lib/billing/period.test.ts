/**
 * period.test.ts — the quota window.
 *
 * These are the tests for the decision recorded at the top of period.ts: a
 * metered "month" is the subscription's monthly anniversary, not the calendar
 * month. The first test is the one that pays for the module — it is the
 * double-allowance the calendar month hands out, written as an assertion.
 */

import { describe, expect, it } from 'vitest'
import { startOfUtcMonth, usagePeriodEnd, usagePeriodStart } from './period'

const at = (iso: string): Date => new Date(iso)

describe('usagePeriodStart', () => {
  it('does not reset a mid-month subscriber on the 1st (the double allowance)', () => {
    // Subscribed 20 January; it is now 2 February. Under a calendar month this
    // customer's allowance reset yesterday, 13 days into the month they paid
    // for, so they get up to 100 jobs for one month's money.
    const anchor = '2025-01-20T09:30:00.000Z'
    expect(startOfUtcMonth(at('2025-02-02T00:00:00Z'))).toBe('2025-02-01T00:00:00.000Z')
    expect(usagePeriodStart(anchor, at('2025-02-02T00:00:00Z'))).toBe(
      '2025-01-20T09:30:00.000Z'
    )
  })

  it('rolls on the anniversary, to the minute', () => {
    const anchor = '2025-01-20T09:30:00.000Z'
    expect(usagePeriodStart(anchor, at('2025-02-20T09:29:59Z'))).toBe(
      '2025-01-20T09:30:00.000Z'
    )
    expect(usagePeriodStart(anchor, at('2025-02-20T09:30:00Z'))).toBe(
      '2025-02-20T09:30:00.000Z'
    )
  })

  it('is unaffected by a stale current_period_end', () => {
    // The renewal webhook was missed a year ago, so the row still says 2024.
    // The anchor day has not moved, so the window is still right — which is the
    // whole reason the derivation reads the anchor and not the period.
    const stale = '2024-03-15T00:00:00.000Z'
    const fresh = '2026-03-15T00:00:00.000Z'
    const now = at('2025-07-20T12:00:00Z')
    expect(usagePeriodStart(stale, now)).toBe(usagePeriodStart(fresh, now))
    expect(usagePeriodStart(stale, now)).toBe('2025-07-15T00:00:00.000Z')
  })

  it('gives an annual subscriber a MONTHLY allowance', () => {
    // The naive derivation — subtract one billing interval from
    // current_period_end — would return a window twelve months wide here, and
    // an annual Pro customer would get 50 hardware jobs a year against a
    // pricing page that says 50 a month.
    const yearly = '2026-03-15T00:00:00.000Z'
    const start = usagePeriodStart(yearly, at('2025-07-20T12:00:00Z'))
    expect(start).toBe('2025-07-15T00:00:00.000Z')
    const days =
      (Date.parse(usagePeriodEnd(yearly, at('2025-07-20T12:00:00Z'))) - Date.parse(start)) /
      86_400_000
    expect(days).toBeLessThan(32)
  })

  it('clamps an anchor day that a month does not have', () => {
    const anchor = '2025-01-31T00:00:00.000Z'
    // February has no 31st. Stripe clamps its own billing anchor the same way,
    // so the windows tile with no gap and no overlap.
    expect(usagePeriodStart(anchor, at('2025-02-28T12:00:00Z'))).toBe(
      '2025-02-28T00:00:00.000Z'
    )
    expect(usagePeriodStart(anchor, at('2025-02-27T12:00:00Z'))).toBe(
      '2025-01-31T00:00:00.000Z'
    )
    // Leap year: the 29th exists.
    expect(usagePeriodStart(anchor, at('2024-02-29T12:00:00Z'))).toBe(
      '2024-02-29T00:00:00.000Z'
    )
  })

  it('crosses a year boundary backwards', () => {
    expect(usagePeriodStart('2025-06-20T00:00:00.000Z', at('2025-01-05T00:00:00Z'))).toBe(
      '2024-12-20T00:00:00.000Z'
    )
  })

  it('falls back to the calendar month with no anchor', () => {
    const now = at('2025-02-14T08:00:00Z')
    expect(usagePeriodStart(null, now)).toBe('2025-02-01T00:00:00.000Z')
    expect(usagePeriodStart(undefined, now)).toBe('2025-02-01T00:00:00.000Z')
    // A row corrupted into something unparseable must not throw on the path
    // that authorises spending — it degrades to the older, wider rule.
    expect(usagePeriodStart('not a date', now)).toBe('2025-02-01T00:00:00.000Z')
  })
})

describe('usagePeriodEnd', () => {
  it('is exactly one anchored month after the start, with no gap', () => {
    const anchor = '2025-01-20T09:30:00.000Z'
    const now = at('2025-02-25T00:00:00Z')
    const start = usagePeriodStart(anchor, now)
    const end = usagePeriodEnd(anchor, now)
    expect(start).toBe('2025-02-20T09:30:00.000Z')
    expect(end).toBe('2025-03-20T09:30:00.000Z')
    // The next window opens exactly where this one closes: no row can be
    // counted twice, and none can fall between two windows.
    expect(usagePeriodStart(anchor, new Date(end))).toBe(end)
  })

  it('is the first of next month for a calendar-month account', () => {
    expect(usagePeriodEnd(null, at('2025-12-14T08:00:00Z'))).toBe('2026-01-01T00:00:00.000Z')
  })
})
