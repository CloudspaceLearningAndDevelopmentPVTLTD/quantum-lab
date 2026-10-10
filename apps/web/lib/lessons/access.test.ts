/**
 * access.test.ts — the advanced-track paywall, from both sides.
 *
 * Two things are being pinned down here, and they are different in kind:
 *
 *   1. THE SERVER RENDERS A PREVIEW, ALWAYS. `previewBlocks(lesson, false)` is
 *      what `app/learn/[slug]/page.tsx` calls for every document request, so
 *      what it returns for an advanced lesson is literally what `curl` gets.
 *      The assertions therefore check the withheld PROSE, not a block count — a
 *      regression that leaks the text while keeping the arithmetic right is the
 *      one worth catching.
 *   2. THE PAID TAIL IS RELEASED ONLY TO A VERIFIED, ENTITLED CALLER. The route
 *      handler is exercised against a stubbed Supabase, through the real
 *      `getEntitlement` and the real `assertFeature`, so the test fails if the
 *      route stops asking, asks with the wrong feature, or trusts a `userId` it
 *      was handed rather than the one the token proves.
 *
 * And the invariant the product is built on: the foundations track is free to
 * everyone, always, with no account — asserted here for both halves.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'

import { TRACKS } from '@/lib/lessons'
import { allFullLessons, getFullLesson } from '@/lib/lessons/server'
import type { Lesson, LessonBlock } from '@/lib/lessons/types'
import {
  FREE_PREVIEW_BLOCKS,
  PAYWALLED_SECTION_CLASS,
  featureForLesson,
  isLessonFree,
  previewBlocks,
  trackForLesson,
} from '@/lib/lessons/access'

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures drawn from the real catalogue — never a hand-written lesson, so a
// change to the course data shows up here rather than being papered over.
// ─────────────────────────────────────────────────────────────────────────────

const FOUNDATIONS_SLUG = TRACKS[0].lessonSlugs[0]
const ADVANCED_SLUG = TRACKS[1].lessonSlugs[0]

// Bodies come from the server module — the only place they exist now. A test
// that could still get blocks out of `@/lib/lessons` would mean the split had
// been undone.
const foundationsLesson = getFullLesson(FOUNDATIONS_SLUG) as Lesson
const advancedLesson = getFullLesson(ADVANCED_SLUG) as Lesson

/** Every word a block renders, flattened, so "is this text on the page?" is one call. */
function textOf(blocks: LessonBlock[]): string {
  return blocks
    .map((block) => {
      switch (block.kind) {
        case 'prose':
          return [block.title ?? '', ...block.paragraphs].join(' ')
        case 'callout':
          return `${block.title} ${block.body}`
        case 'code':
          return `${block.code} ${block.caption ?? ''}`
        case 'embed':
          return `${block.title} ${block.blurb}`
        case 'keypoints':
          return block.points.join(' ')
        case 'quiz':
          return block.questions
            .map((q) => `${q.prompt} ${q.explanation} ${q.options.map((o) => o.text).join(' ')}`)
            .join(' ')
        case 'inline-check':
          return `${block.question} ${block.explanation} ${block.options.map((o) => o.text).join(' ')}`
      }
    })
    .join('\n')
}

describe('which lessons are paid', () => {
  it('puts exactly the advanced track behind course.advanced', () => {
    for (const slug of TRACKS[0].lessonSlugs) {
      expect(trackForLesson(slug), slug).toBe('foundations')
      expect(isLessonFree(slug), slug).toBe(true)
      expect(featureForLesson(slug), slug).toBe('course.foundations')
    }
    for (const slug of TRACKS[1].lessonSlugs) {
      expect(trackForLesson(slug), slug).toBe('advanced')
      expect(isLessonFree(slug), slug).toBe(false)
      expect(featureForLesson(slug), slug).toBe('course.advanced')
    }
  })

  it('treats an unknown slug as free rather than locking a payer out', () => {
    expect(isLessonFree('not-a-lesson')).toBe(true)
  })
})

describe('what the server renders — the anonymous document request', () => {
  it('withholds the body of an advanced lesson, not just some of its blocks', () => {
    // `false` is exactly what app/learn/[slug]/page.tsx passes.
    const preview = previewBlocks(advancedLesson, false)

    expect(preview.visible).toHaveLength(FREE_PREVIEW_BLOCKS)
    expect(preview.hidden).toBe(advancedLesson.blocks.length - FREE_PREVIEW_BLOCKS)

    const served = textOf(preview.visible)
    const withheld = advancedLesson.blocks.slice(FREE_PREVIEW_BLOCKS)

    for (const block of withheld) {
      const sample = textOf([block]).trim().slice(0, 120)
      expect(sample.length, 'a withheld block with no text is a bad fixture').toBeGreaterThan(20)
      expect(served).not.toContain(sample)
    }
  })

  it('still gives an advanced preview worth reading', () => {
    // Not a marketing teaser: the preview has to carry real prose, or the
    // paywall is a bait-and-switch. Every advanced lesson, not just the first.
    for (const slug of TRACKS[1].lessonSlugs) {
      const lesson = getFullLesson(slug) as Lesson
      const preview = previewBlocks(lesson, false)
      expect(textOf(preview.visible).length, slug).toBeGreaterThan(1500)
      expect(preview.hidden, slug).toBeGreaterThan(0)
    }
  })

  it('serves every foundations lesson in full even when nothing is allowed', () => {
    for (const slug of TRACKS[0].lessonSlugs) {
      const lesson = getFullLesson(slug) as Lesson
      const preview = previewBlocks(lesson, false)
      expect(preview.visible, slug).toEqual(lesson.blocks)
      expect(preview.hidden, slug).toBe(0)
    }
  })

  it('serves an advanced lesson in full once the caller is allowed', () => {
    const preview = previewBlocks(advancedLesson, true)
    expect(preview.visible).toEqual(advancedLesson.blocks)
    expect(preview.hidden).toBe(0)
  })

  it('keeps a preview short enough to be a preview', () => {
    // Guards the other direction: FREE_PREVIEW_BLOCKS creeping up until the
    // "paid" lesson is effectively free would pass every test above.
    for (const lesson of allFullLessons()) {
      if (isLessonFree(lesson.slug)) continue
      expect(previewBlocks(lesson, false).visible.length, lesson.slug).toBeLessThan(
        lesson.blocks.length / 2,
      )
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// The route handler — the half that cannot be bypassed
// ─────────────────────────────────────────────────────────────────────────────

/** The user id the stubbed token verifier will vouch for on the next request. */
let verifiedId: string | null = null
/** plan_id returned by the stubbed subscriptions table, keyed by user id. */
const subscriptions = new Map<string, { plan_id: string; status: string }>()

vi.mock('@/lib/security/auth', () => ({
  // Identity comes from here and nowhere else. Note the route never reads a
  // userId from the URL, so there is nothing for a test to forge either.
  verifiedCallerId: async () => verifiedId,
}))

/**
 * A Supabase stub thin enough to read: every query in `getEntitlement` is
 * `.from(table).select(...)` followed by `.eq()`/`.gte()` and then either
 * `.maybeSingle()` or an await. One chainable thenable covers all three.
 */
vi.mock('@/lib/supabase', () => {
  const chain = (table: string, userId: { value: string | null }) => {
    const result = () => {
      if (table === 'subscriptions') {
        const row = userId.value ? subscriptions.get(userId.value) : undefined
        return { data: row ? { user_id: userId.value, ...row } : null, error: null }
      }
      if (table === 'org_members') return { data: [], error: null }
      return { count: 0, error: null }
    }
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: (_column: string, value: string) => {
        userId.value = value
        return builder
      },
      gte: () => builder,
      maybeSingle: async () => result(),
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve),
    }
    return builder
  }

  return {
    isSupabaseConfigured: true,
    getSupabase: () => ({
      from: (table: string) => chain(table, { value: null }),
    }),
  }
})

describe('GET /learn/[slug]/content', () => {
  beforeEach(() => {
    verifiedId = null
    subscriptions.clear()
  })

  const call = async (slug: string) => {
    const { GET } = await import('@/app/learn/[slug]/content/route')
    // Distinct client keys per test so the shared rate limiter, which is
    // process-global, cannot make one test fail because of another.
    const response = await GET(
      new Request(`https://example.test/learn/${slug}/content`, {
        headers: { 'x-forwarded-for': `10.0.0.${Math.floor(Math.random() * 250) + 1}` },
      }),
      { params: Promise.resolve({ slug }) },
    )
    const body: unknown = await response.json().catch(() => null)
    return { status: response.status, body: body as Record<string, unknown> | null }
  }

  it('refuses the advanced tail to an anonymous caller', async () => {
    const { status, body } = await call(ADVANCED_SLUG)

    expect(status).toBe(402)
    expect(body?.blocks).toBeUndefined()
    // The refusal must not leak the thing it is refusing.
    const withheld = textOf(advancedLesson.blocks.slice(FREE_PREVIEW_BLOCKS)).slice(0, 100)
    expect(JSON.stringify(body)).not.toContain(withheld)
    expect(body?.upgradeUrl).toBe('/pricing')
  })

  it('refuses the advanced tail to a signed-in caller on the free plan', async () => {
    verifiedId = 'free-user'
    const { status, body } = await call(ADVANCED_SLUG)
    expect(status).toBe(402)
    expect(body?.blocks).toBeUndefined()
  })

  it('refuses it to a lapsed Pro subscription', async () => {
    verifiedId = 'lapsed-user'
    subscriptions.set('lapsed-user', { plan_id: 'pro', status: 'canceled' })
    const { status } = await call(ADVANCED_SLUG)
    expect(status).toBe(402)
  })

  it('serves the whole advanced lesson to a Pro caller', async () => {
    verifiedId = 'pro-user'
    subscriptions.set('pro-user', { plan_id: 'pro', status: 'active' })

    const { status, body } = await call(ADVANCED_SLUG)

    expect(status).toBe(200)
    expect(body?.blocks).toEqual(advancedLesson.blocks)

    // Spelled out as prose as well as by deep equality: the paragraph the
    // paywall was withholding is now on the wire.
    const withheldProse = advancedLesson.blocks
      .slice(FREE_PREVIEW_BLOCKS)
      .find((block): block is Extract<LessonBlock, { kind: 'prose' }> => block.kind === 'prose')
    expect(withheldProse, 'no withheld prose block to check').toBeTruthy()
    expect(JSON.stringify(body)).toContain(
      JSON.stringify(withheldProse!.paragraphs[0]).slice(1, -1),
    )
  })

  it('serves a foundations lesson to a caller with no account at all', async () => {
    const { status, body } = await call(FOUNDATIONS_SLUG)
    expect(status).toBe(200)
    expect(body?.blocks).toEqual(foundationsLesson.blocks)
    expect(body?.locked).toBe(false)
  })

  it('404s an unknown slug rather than inventing a lesson', async () => {
    const { status } = await call('no-such-lesson')
    expect(status).toBe(404)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Structured data must describe the page that is actually served
// ─────────────────────────────────────────────────────────────────────────────

describe('paywall markup and JSON-LD agree', () => {
  it('marks advanced lessons as paid, with a selector that names a real element', async () => {
    const { lessonSchema } = await import('@/components/seo/schema')
    const node = lessonSchema(advancedLesson) as Record<string, unknown>

    expect(node.isAccessibleForFree).toBe(false)
    expect(node.hasPart).toEqual({
      '@type': 'WebPageElement',
      isAccessibleForFree: false,
      cssSelector: `.${PAYWALLED_SECTION_CLASS}`,
    })
  })

  it('leaves foundations lessons declared free and unpaywalled', async () => {
    const { lessonSchema } = await import('@/components/seo/schema')
    const node = lessonSchema(foundationsLesson) as Record<string, unknown>

    expect(node.isAccessibleForFree).toBe(true)
    expect(node.hasPart).toBeUndefined()
  })

  // Course-level nodes (one per track, not per lesson). The advanced track is
  // gated per-lesson but is not itself sold standalone — no price, no `Offer`,
  // only inclusion in the $19/mo plan — so `courseSchema` must say "not free"
  // without also claiming a price that does not exist.
  it('marks the advanced Course not-free and offers-less: gated, but not for sale on its own', async () => {
    const { courseSchema } = await import('@/components/seo/schema')
    const node = courseSchema(TRACKS[1]) as Record<string, unknown>

    expect(node.isAccessibleForFree).toBe(false)
    expect(node.offers).toBeUndefined()
  })

  it('marks the foundations Course free with a real $0 offer', async () => {
    const { courseSchema } = await import('@/components/seo/schema')
    const node = courseSchema(TRACKS[0]) as Record<string, unknown>

    expect(node.isAccessibleForFree).toBe(true)
    expect(node.offers).toMatchObject({ '@type': 'Offer', price: 0, category: 'Free' })
  })
})
