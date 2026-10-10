/**
 * The schedule arithmetic behind the 7-day course dispatcher.
 *
 * These tests are the specification of "due": if one of them has to change,
 * subscribers' inboxes change — say why in the commit.
 */

import { describe, expect, it } from 'vitest'

import {
  COURSE_LENGTH_DAYS,
  dueCourseDay,
  highestDueDay,
  isCourseComplete,
  normaliseSentDays,
} from '@/lib/email/courseSchedule'

const CONFIRMED = '2026-08-01T07:00:00.000Z'

/** `now` at an offset of whole hours from the confirmation instant. */
function hoursAfterConfirm(hours: number): Date {
  return new Date(Date.parse(CONFIRMED) + hours * 60 * 60 * 1000)
}

function sub(sentDays: number[], unsubscribedAt: string | null = null) {
  return { confirmedAt: CONFIRMED, unsubscribedAt, sentDays }
}

describe('highestDueDay', () => {
  it('is 0 before confirmation, and for junk timestamps (fail closed)', () => {
    expect(highestDueDay(null, new Date())).toBe(0)
    expect(highestDueDay('not a date', new Date())).toBe(0)
    // A confirmation "in the future" (clock skew) must not make days due.
    expect(highestDueDay(CONFIRMED, hoursAfterConfirm(-1))).toBe(0)
  })

  it('day 1 is due at the confirmation instant; day N after N−1 whole days', () => {
    expect(highestDueDay(CONFIRMED, hoursAfterConfirm(0))).toBe(1)
    expect(highestDueDay(CONFIRMED, hoursAfterConfirm(23))).toBe(1)
    expect(highestDueDay(CONFIRMED, hoursAfterConfirm(24))).toBe(2)
    expect(highestDueDay(CONFIRMED, hoursAfterConfirm(6 * 24))).toBe(7)
  })

  it('never exceeds the course length, however long ago the confirm was', () => {
    expect(highestDueDay(CONFIRMED, hoursAfterConfirm(365 * 24))).toBe(COURSE_LENGTH_DAYS)
  })
})

describe('dueCourseDay', () => {
  it('offers the lowest unsent due day, in order', () => {
    expect(dueCourseDay(sub([]), hoursAfterConfirm(0))).toBe(1)
    expect(dueCourseDay(sub([1]), hoursAfterConfirm(24))).toBe(2)
    // Day 3 due by the calendar, but day 2 unsent: day 2 goes first.
    expect(dueCourseDay(sub([1]), hoursAfterConfirm(3 * 24))).toBe(2)
  })

  it('is idempotent: a sent day is never offered again', () => {
    expect(dueCourseDay(sub([1]), hoursAfterConfirm(1))).toBe(null)
    // Re-running dispatch immediately after sending changes nothing.
    const now = hoursAfterConfirm(2 * 24)
    const first = dueCourseDay(sub([1, 2]), now)
    expect(first).toBe(3)
    expect(dueCourseDay(sub([1, 2, 3]), now)).toBe(null)
  })

  it('drains a backlog one day per run, never a burst', () => {
    // Confirmed a week ago, nothing sent: seven days are due by the calendar
    // but each run yields exactly one — the next unsent day.
    const now = hoursAfterConfirm(10 * 24)
    const sent: number[] = []
    for (let run = 0; run < COURSE_LENGTH_DAYS; run += 1) {
      const day = dueCourseDay(sub([...sent]), now)
      expect(day).toBe(run + 1)
      sent.push(day as number)
    }
    expect(dueCourseDay(sub(sent), now)).toBe(null)
  })

  it('never offers anything to an unsubscribed or unconfirmed row', () => {
    expect(dueCourseDay(sub([], '2026-08-02T00:00:00.000Z'), hoursAfterConfirm(48))).toBe(null)
    expect(
      dueCourseDay({ confirmedAt: null, unsubscribedAt: null, sentDays: [] }, new Date())
    ).toBe(null)
  })

  it('is null once the course is complete', () => {
    expect(dueCourseDay(sub([1, 2, 3, 4, 5, 6, 7]), hoursAfterConfirm(400 * 24))).toBe(null)
    expect(isCourseComplete([7, 3, 1, 2, 6, 5, 4])).toBe(true)
    expect(isCourseComplete([1, 2, 3])).toBe(false)
  })
})

describe('normaliseSentDays', () => {
  it('drops junk instead of crashing the batch on one bad row', () => {
    expect(normaliseSentDays(null)).toEqual([])
    expect(normaliseSentDays('1,2')).toEqual([])
    expect(normaliseSentDays([3, 1, 1, 0, 8, 2.5, 'x', 2])).toEqual([1, 2, 3])
  })
})
