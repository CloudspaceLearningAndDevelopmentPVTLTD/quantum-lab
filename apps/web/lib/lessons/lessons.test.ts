/**
 * Invariants over the course data and the concept graph.
 *
 * There was no test over `lib/lessons/**` or `lib/coach/graph.ts` before this
 * file, and every failure these cases catch is a silent one: a lesson that
 * exists but is unreachable, an embed pointing at a route nobody built, a
 * prerequisite the coach enforces that the lesson itself does not declare. None
 * of those break the type-check and none of them throw at runtime — they just
 * quietly teach the wrong thing or send a learner to a 404.
 *
 * Route existence is checked against a hardcoded list rather than the
 * filesystem on purpose: the assertion is "this href is a route we shipped",
 * and a filesystem walk would happily pass an href to a route that exists but
 * is broken. Add a visualization, add it here.
 */
import { describe, expect, it } from 'vitest'
import { CONCEPT_GRAPH, graphInconsistencies, nodeFor } from '@/lib/coach/graph'
import { LESSONS, TRACKS, allSlugs, getLesson } from './index'
import { allFullLessons, getFullLesson } from './server'

/**
 * Bodies come from `./server`, metadata from `./index`. Reading them through
 * two different modules here is the point: the split is only real if the tests
 * have to go and get the body deliberately, exactly as the lesson page does.
 */
const FULL_LESSONS = allFullLessons()

/** Routes an `embed` block is allowed to point at. */
const EMBEDDABLE_ROUTES = new Set([
  '/hardware',
  '/simulator',
  '/visualizations/bloch-sphere',
  '/visualizations/decoherence',
  '/visualizations/double-slit',
  '/visualizations/entanglement',
  '/visualizations/grover',
  '/visualizations/qec-duel',
  '/visualizations/qft',
  '/visualizations/quantum-key-distribution',
  '/visualizations/shor',
  '/visualizations/superposition',
  '/visualizations/surface-code',
  '/visualizations/tunneling',
  '/visualizations/vqe',
  '/workbench/qml-check',
])

describe('course data', () => {
  it('puts every lesson in exactly one track', () => {
    const trackSlugs = TRACKS.flatMap((track) => track.lessonSlugs)
    expect([...trackSlugs].sort()).toEqual([...new Set(trackSlugs)].sort())
    expect([...trackSlugs].sort()).toEqual(LESSONS.map((l) => l.slug).sort())
  })

  it('resolves every slug in every track to a lesson', () => {
    for (const slug of allSlugs()) {
      expect(getLesson(slug), `no lesson for track slug ${slug}`).toBeDefined()
    }
  })

  it('names only real lessons as prerequisites, and never itself', () => {
    for (const lesson of LESSONS) {
      for (const prereq of lesson.prerequisites) {
        expect(getLesson(prereq), `${lesson.slug} requires unknown ${prereq}`).toBeDefined()
        expect(prereq).not.toBe(lesson.slug)
      }
    }
  })

  it('orders each track so prerequisites are taught before dependants', () => {
    const order = allSlugs()
    for (const lesson of LESSONS) {
      for (const prereq of lesson.prerequisites) {
        expect(
          order.indexOf(prereq),
          `${prereq} is taught after ${lesson.slug}, which requires it`,
        ).toBeLessThan(order.indexOf(lesson.slug))
      }
    }
  })

  it('has a body for every lesson and a lesson for every body', () => {
    expect(FULL_LESSONS.map((l) => l.slug)).toEqual(LESSONS.map((l) => l.slug))
    for (const meta of LESSONS) {
      const full = getFullLesson(meta.slug)
      expect(full, `no body for ${meta.slug}`).toBeDefined()
      expect(full!.blocks.length, `${meta.slug} has an empty body`).toBeGreaterThan(0)
    }
  })

  /**
   * The metadata outline is what `lib/coach/recommend.ts` and
   * `components/admin/CohortProgress.tsx` count quiz questions from, and they
   * never see the body. If the two drift, a learner's quiz score is divided by
   * the wrong denominator and the coach recommends the wrong lesson — silently,
   * with no type error and no crash. This is the test that catches that.
   */
  it('keeps each metadata outline in step with the real body', () => {
    for (const meta of LESSONS) {
      const full = getFullLesson(meta.slug)!
      expect(meta.blocks.map((b) => b.kind), `${meta.slug} outline kinds`).toEqual(
        full.blocks.map((b) => b.kind),
      )
      meta.blocks.forEach((outline, i) => {
        const block = full.blocks[i]
        if (outline.kind !== 'quiz' || block.kind !== 'quiz') return
        expect(
          outline.questions.map((q) => q.id),
          `${meta.slug} block ${i} question ids`,
        ).toEqual(block.questions.map((q) => q.id))
      })
    }
  })

  it('points every embed at a route that exists', () => {
    for (const lesson of FULL_LESSONS) {
      for (const block of lesson.blocks) {
        if (block.kind !== 'embed') continue
        expect(EMBEDDABLE_ROUTES.has(block.href), `${lesson.slug} embeds ${block.href}`).toBe(
          true,
        )
      }
    }
  })

  it('gives every lesson a quiz whose questions have a real correct option', () => {
    for (const lesson of FULL_LESSONS) {
      const quizzes = lesson.blocks.filter((b) => b.kind === 'quiz')
      expect(quizzes.length, `${lesson.slug} has no quiz`).toBeGreaterThan(0)
      for (const quiz of quizzes) {
        if (quiz.kind !== 'quiz') continue
        for (const question of quiz.questions) {
          const ids = question.options.map((o) => o.id)
          expect(new Set(ids).size, `${lesson.slug}/${question.id} repeats an option id`).toBe(
            ids.length,
          )
          expect(
            ids,
            `${lesson.slug}/${question.id} marks a correct option that is not offered`,
          ).toContain(question.correctId)
          expect(question.explanation.length).toBeGreaterThan(0)
        }
      }
    }
  })
})

describe('concept graph', () => {
  it('has no dangling or one-directional edges', () => {
    expect(graphInconsistencies()).toEqual([])
  })

  it('has one node per lesson and one lesson per node', () => {
    expect(CONCEPT_GRAPH.map((n) => n.lessonSlug).sort()).toEqual(
      LESSONS.map((l) => l.slug).sort(),
    )
    for (const node of CONCEPT_GRAPH) {
      // The recommender looks nodes up by lesson slug, so the two ids must agree.
      expect(node.id).toBe(node.lessonSlug)
    }
  })

  it('agrees with each lesson about what that lesson requires', () => {
    for (const lesson of LESSONS) {
      const node = nodeFor(lesson.slug)
      expect(node, `no graph node for ${lesson.slug}`).toBeDefined()
      expect([...(node?.requires ?? [])].sort(), `graph disagrees on ${lesson.slug}`).toEqual(
        [...lesson.prerequisites].sort(),
      )
    }
  })
})
