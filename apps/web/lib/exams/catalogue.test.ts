/**
 * catalogue.test.ts — the split between the catalogue and the bank holds.
 *
 * `lib/exams/catalogue.ts` had to stop importing `questions.ts` (that import is
 * what put the answers in the browser), which means the pool id lists are now
 * written out by hand in one file and the questions they name live in another.
 * Two lists that must agree and cannot see each other is exactly the shape of a
 * defect that ships quietly: a question added to the bank and not to the pool
 * is simply never asked, and nothing anywhere goes red.
 *
 * So this file is the seam. It runs on the server, where both halves are
 * visible, and fails if they drift in either direction.
 */

import { describe, expect, it } from 'vitest'

import { TRACKS } from '@/lib/lessons'
import { EXAMS, FOUNDATIONS_LESSON_COUNT, examPoolSize, getExam } from './catalogue'
import { QUESTION_POOL, questionsFor } from './questions'

describe('the catalogue and the bank agree', () => {
  it('names only questions that exist', () => {
    const known = new Set(QUESTION_POOL.map((q) => q.id))
    for (const exam of EXAMS) {
      for (const id of exam.poolIds) {
        expect(known.has(id), `${exam.id} draws on ${id}, which is not in the bank`).toBe(true)
      }
    }
  })

  it('leaves no question out of the exam it was written for', () => {
    const foundations = getExam('foundations-cert')
    const advanced = getExam('advanced-cert')
    const inFoundations = new Set(foundations?.poolIds ?? [])
    const inAdvanced = new Set(advanced?.poolIds ?? [])

    for (const q of QUESTION_POOL) {
      if (q.id.startsWith('f')) {
        expect(
          inFoundations.has(q.id),
          `${q.id} is in the bank but no foundations paper can draw it`
        ).toBe(true)
      } else if (q.id.startsWith('a')) {
        expect(
          inAdvanced.has(q.id),
          `${q.id} is in the bank but no advanced paper can draw it`
        ).toBe(true)
      } else {
        throw new Error(`${q.id} follows neither the f… nor the a… id convention`)
      }
    }
  })

  it('reports a pool size the browser can trust without the bank', () => {
    // /certify prints this number and does not have the questions. If the two
    // ever disagree the page is quoting a ratio that is not true.
    for (const exam of EXAMS) {
      expect(examPoolSize(exam.id)).toBe(questionsFor(exam.id).length)
    }
  })

  it('draws every paper from a pool several times its size', () => {
    for (const exam of EXAMS) {
      expect(
        examPoolSize(exam.id) / exam.questionCount,
        `${exam.id} barely has a second paper in it`
      ).toBeGreaterThan(2.5)
    }
  })

  it('states the foundations lesson count the track actually has', () => {
    // The subtitle says "across the N foundations lessons" and the catalogue
    // can no longer read `TRACKS` without dragging the lesson bodies into every
    // bundle that imports it. So the number is hard-coded there and checked here.
    const track = TRACKS.find((t) => t.id === 'foundations')
    expect(track?.lessonSlugs.length).toBe(FOUNDATIONS_LESSON_COUNT)
  })
})
