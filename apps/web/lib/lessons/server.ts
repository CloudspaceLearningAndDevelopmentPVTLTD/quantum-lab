/**
 * lib/lessons/server.ts — the ONLY way to get a lesson's body.
 *
 * `lib/lessons/index.ts` is metadata and is imported by the global client graph
 * (layout → SiteNav → CommandPalette → lib/search/corpus). This module is the
 * other half: it imports `./bodies/*`, which hold 152,364 bytes of lesson text,
 * 68,707 of it the paid advanced track. Two files in the app import it, both of
 * them server-side:
 *
 *   · app/learn/[slug]/page.tsx        — a Server Component, renders the preview
 *   · app/learn/[slug]/content/route.ts — the entitlement-checked route handler
 *
 * WHAT ENFORCES THAT, HONESTLY STATED:
 *
 *   1. `lib/lessons/bundle.test.ts` builds the import graph of apps/web from
 *      every module marked 'use client', follows value (non-type) imports, and
 *      fails if any body module — or this one — is reachable. That is a real
 *      check of the actual property we care about, and it runs in `vitest run`.
 *   2. `import 'server-only'` below. It exports a `react-server` condition that
 *      resolves to an empty module on the server and to a module that throws
 *      when bundled for the client, which turns a client import into a BUILD
 *      error rather than a runtime one.
 *   3. The `typeof window` throw below. It fires at import time in a browser,
 *      so a client import that slipped past both of the above still dies
 *      loudly on the first page load rather than quietly shipping the course.
 *
 * The runtime guard below is a backstop, not the design. The design is that
 * nothing on the client imports this file, and the design is what is tested.
 */

import 'server-only'
import { LESSONS } from './index'
import { ADVANCED_BODIES } from './bodies/advanced'
import { FOUNDATION_BODIES } from './bodies/foundations'
import type { Lesson, LessonBlock, LessonBody } from './types'

if (typeof window !== 'undefined') {
  // Reaching here means a client component imported a lesson body module. The
  // paid course is now in a .js chunk; do not "fix" this by deleting the throw.
  throw new Error(
    'lib/lessons/server.ts was imported in the browser. Lesson bodies are ' +
      'server-only — import lib/lessons (metadata) from client components.',
  )
}

const BODY_BY_SLUG: ReadonlyMap<string, LessonBlock[]> = new Map(
  ([] as LessonBody[])
    .concat(FOUNDATION_BODIES, ADVANCED_BODIES)
    .map((body) => [body.slug, body.blocks]),
)

/** The blocks of one lesson, or undefined for an unknown slug. */
export function getLessonBody(slug: string): LessonBlock[] | undefined {
  return BODY_BY_SLUG.get(slug)
}

/**
 * Metadata + body. Returns undefined when the slug is unknown, and — this is
 * the case worth naming — also when metadata exists but its body does not, so a
 * half-added lesson 404s instead of rendering a title with nothing under it.
 * `lessons.test.ts` asserts the two halves match for every lesson, so that
 * branch should be unreachable in a green tree.
 */
export function getFullLesson(slug: string): Lesson | undefined {
  const meta = LESSONS.find((lesson) => lesson.slug === slug)
  if (!meta) return undefined
  const blocks = BODY_BY_SLUG.get(slug)
  if (!blocks) return undefined
  return {
    slug: meta.slug,
    title: meta.title,
    subtitle: meta.subtitle,
    level: meta.level,
    minutes: meta.minutes,
    prerequisites: meta.prerequisites,
    objectives: meta.objectives,
    blocks,
  }
}

/** Every lesson with its body, in teaching order. Used by tests and tooling. */
export function allFullLessons(): Lesson[] {
  return LESSONS.map((meta) => getFullLesson(meta.slug)).filter(
    (lesson): lesson is Lesson => lesson !== undefined,
  )
}
