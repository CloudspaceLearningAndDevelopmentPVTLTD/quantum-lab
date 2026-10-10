/**
 * The 7-day course emails — the promises the launch draft's wiring notes
 * make binding:
 *
 *   1. every link resolves to a real route (the visualization catalogue is
 *      the source of truth, and the module itself throws at load if not);
 *   2. one-click unsubscribe is the HEADER of every message, not only the
 *      footer;
 *   3. plain text discipline: no images, no tracking pixels, both parts.
 */

import { describe, expect, it } from 'vitest'

import {
  COURSE_EMAILS,
  assertCourseLinksResolve,
  courseDayEmail,
  knownCourseRoutes,
} from '@/lib/email/templates'
import { VISUALIZATIONS } from '@/lib/visualizations'
import { COURSE_LENGTH_DAYS } from '@/lib/email/courseSchedule'

const BASE = 'https://app.test'
const UNSUB = 'https://app.test/api/email/unsubscribe/course?token=abc123'

describe('course links', () => {
  it('every link in every day resolves to a real route', () => {
    const routes = knownCourseRoutes()
    for (const spec of COURSE_EMAILS) {
      expect(routes.has(spec.linkPath), `day ${spec.day}: ${spec.linkPath}`).toBe(true)
      if (spec.extra) {
        expect(routes.has(spec.extra.path), `day ${spec.day}: ${spec.extra.path}`).toBe(true)
      }
    }
    // knownCourseRoutes derives from the catalogue, not a copy of it.
    for (const viz of VISUALIZATIONS) expect(routes.has(viz.href)).toBe(true)
  })

  it('the module-load validator throws on a link to nowhere', () => {
    expect(() =>
      assertCourseLinksResolve([
        { ...COURSE_EMAILS[0], linkPath: '/visualizations/does-not-exist' },
      ])
    ).toThrow(/does-not-exist/)
    expect(() => assertCourseLinksResolve()).not.toThrow()
  })

  it('rendered links are the base URL plus the verified path, nothing else', () => {
    for (const spec of COURSE_EMAILS) {
      const { text } = courseDayEmail({ day: spec.day, baseUrl: BASE, unsubscribeUrl: UNSUB })
      expect(text).toContain(`${BASE}${spec.linkPath}`)
      // Every URL in the text part is either the unsubscribe link or a link
      // whose path was verified against the route list.
      const urls = text.match(/https?:\/\/\S+/g) ?? []
      const routes = knownCourseRoutes()
      for (const url of urls) {
        if (url.startsWith(UNSUB)) continue
        expect(routes.has(new URL(url).pathname), url).toBe(true)
      }
    }
  })
})

describe('course content', () => {
  it('covers exactly the seven days, once each', () => {
    expect(COURSE_EMAILS.map((spec) => spec.day)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(COURSE_LENGTH_DAYS).toBe(7)
  })

  it('subjects are the launch draft, verbatim', () => {
    expect(COURSE_EMAILS.map((spec) => spec.subject)).toEqual([
      'You can run the double-slit experiment in about ten seconds',
      'The most common explanation of a qubit is wrong',
      "Why yesterday's statistics couldn't tell two states apart",
      'What entanglement is, and what it definitely is not',
      "This is why your phone's storage works",
      "Grover's algorithm, and why quantum speedups are narrower than advertised",
      'The honest state of quantum computing',
    ])
  })

  it('unsubscribe is the header: first line of text, before all content in HTML', () => {
    for (const spec of COURSE_EMAILS) {
      const { html, text } = courseDayEmail({
        day: spec.day,
        baseUrl: BASE,
        unsubscribeUrl: UNSUB,
      })
      expect(text.split('\n')[0]).toBe(`Unsubscribe (one click): ${UNSUB}`)
      // Before the headline's <h1> and everything after it. (The headline
      // string itself also appears in <title>, which is not visible content.)
      const firstUnsub = html.indexOf(UNSUB)
      expect(firstUnsub).toBeGreaterThan(-1)
      expect(html.indexOf('<h1')).toBeGreaterThan(-1)
      expect(firstUnsub).toBeLessThan(html.indexOf('<h1'))
    }
  })

  it('no images and no tracking pixels, in either part', () => {
    for (const spec of COURSE_EMAILS) {
      const { html } = courseDayEmail({ day: spec.day, baseUrl: BASE, unsubscribeUrl: UNSUB })
      expect(html).not.toMatch(/<img/i)
      // Every href is one of ours or the unsubscribe URL — no third-party
      // beacons hiding as links to remote assets.
      for (const [, href] of html.matchAll(/href="([^"]+)"/g)) {
        expect(href.startsWith(BASE) || href.startsWith(UNSUB), href).toBe(true)
      }
    }
  })

  it('throws for a day that does not exist rather than sending something empty', () => {
    expect(() => courseDayEmail({ day: 8, baseUrl: BASE, unsubscribeUrl: UNSUB })).toThrow(/day 8/)
  })
})
