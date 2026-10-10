/**
 * access.ts — which lessons are free, and how much of a paid lesson you see
 * before being asked to pay.
 *
 * Pure and dependency-light on purpose: it imports the track data and the
 * feature ids and nothing else, so both the server (to actually refuse) and the
 * client (to render a paywall card) can use the same answers. As with
 * `lib/plans.ts`, the client-side check is a courtesy — a route that serves
 * paid lesson content must resolve the entitlement itself.
 *
 * THE GATE IS NOW LIVE, in two halves, because this app has no server-readable
 * session (Supabase persists the session in browser storage and identity
 * travels as an `Authorization: Bearer` header on fetches — see
 * `lib/security/auth.ts` and `lib/authFetch.ts`). A React Server Component
 * therefore cannot know who is asking, so it is not allowed to decide:
 *
 *   1. `app/learn/[slug]/page.tsx` renders `previewBlocks(lesson, false)` for
 *      EVERY document request. The withheld blocks are never serialised into
 *      the HTML, so `curl` — and Googlebot, and a signed-in Pro user's first
 *      paint — all get exactly the same preview. No cloaking, and nothing to
 *      bypass by disabling JavaScript.
 *   2. `app/learn/[slug]/content/route.ts` serves the withheld tail to a caller
 *      the SERVER has verified, via `verifiedCaller` + `requireFeature` — the
 *      same mechanism the billing and org routes use. `LessonShell` asks for it
 *      after mount and swaps the paywall out on a 200.
 *
 * The client-side half is presentation only: it can reveal nothing the route
 * handler did not already agree to send.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE COURSE TEXT IS NO LONGER IN THE CLIENT BUNDLE.
 *
 * This header used to carry a long note that everything above was true of the
 * HTML and of the API, and false of the JavaScript: `lib/lessons/index.ts`
 * defined `LESSONS` with `blocks` inline, that module is reachable from
 * app/layout.tsx via SiteNav → CommandPalette → lib/search/corpus.ts, and a
 * bundler cannot drop a property of a reachable object literal. All four
 * advanced lessons therefore shipped in the shared client chunk of every page.
 *
 * That is fixed. Metadata and body are separate modules: `lib/lessons/index.ts`
 * (metadata plus a text-free structural outline) is what client code imports,
 * and `lib/lessons/bodies/*` is reachable only through `lib/lessons/server.ts`.
 * `lib/lessons/bundle.test.ts` walks the import graph from every 'use client'
 * module and fails if a body module is reachable from any of them; it is the
 * check that keeps this true, and it is not a comment.
 *
 * What is NOT claimed: nothing here stops a subscriber from copying the text
 * out of a page they legitimately loaded, and the free foundations track is
 * still served in full to everyone including crawlers, by design.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { ADVANCED_TRACK } from './index'
import type { Lesson, LessonBlock } from './types'
import type { FeatureId } from '@/lib/plans'

export type LessonTrackId = 'foundations' | 'advanced'

const ADVANCED_SLUGS: ReadonlySet<string> = new Set(ADVANCED_TRACK.lessonSlugs)

/**
 * Which track a lesson belongs to. Unknown slugs fall back to 'foundations',
 * which is the safe direction: a typo shows free content rather than locking a
 * learner out of something they paid for.
 */
export function trackForLesson(slug: string): LessonTrackId {
  return ADVANCED_SLUGS.has(slug) ? 'advanced' : 'foundations'
}

/** The plan feature a lesson sits behind. */
export function featureForLesson(slug: string): FeatureId {
  return trackForLesson(slug) === 'advanced' ? 'course.advanced' : 'course.foundations'
}

/** Foundations lessons are free in full; advanced lessons are previewed. */
export function isLessonFree(slug: string): boolean {
  return trackForLesson(slug) === 'foundations'
}

/**
 * How many blocks of a paid lesson render before the paywall.
 *
 * Three is a deliberate "give away the hook" choice rather than a technical
 * limit. Every advanced lesson opens with prose that sets up the problem and
 * makes the reader want the answer; cutting after the third block means they
 * leave holding a genuine question rather than a marketing sentence. A teaser
 * that teaches nothing converts worse than one that teaches something.
 */
export const FREE_PREVIEW_BLOCKS = 3

export interface PreviewResult {
  visible: LessonBlock[]
  /** Number of blocks withheld behind the paywall; 0 when fully visible. */
  hidden: number
}

/**
 * The class name on the element that holds the paid tail of a lesson — the
 * paywall card when locked, the withheld blocks once unlocked.
 *
 * Exported rather than written twice because `components/seo/schema.ts` names
 * it in `hasPart.cssSelector` (Google's paywalled-content markup) and
 * `LessonShell` puts it on the DOM node. A selector in the structured data that
 * matches nothing on the page is the exact "claims something the page is not"
 * failure that markup is checked for.
 */
export const PAYWALLED_SECTION_CLASS = 'paywalled-content'

/**
 * Split a lesson's blocks into what to render and what to withhold.
 * `allowed` should come from an entitlement check, not from the browser.
 */
export function previewBlocks(lesson: Lesson, allowed: boolean): PreviewResult {
  if (allowed || isLessonFree(lesson.slug)) {
    return { visible: lesson.blocks, hidden: 0 }
  }
  const visible = lesson.blocks.slice(0, FREE_PREVIEW_BLOCKS)
  return { visible, hidden: Math.max(0, lesson.blocks.length - visible.length) }
}
