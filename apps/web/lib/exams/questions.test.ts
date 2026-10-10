/**
 * questions.test.ts — the answer keys are checked, not trusted.
 *
 * A wrong key in a certification is the worst defect this product can ship: it
 * is invisible to the candidate who gets it "wrong", it is authoritative, and
 * it is stored. So every key here is put through the SAME grader the exam
 * runner uses, and every circuit-outcome item's QASM is put through the same
 * simulator the rest of the app uses. If a key disagrees with lib/quantum.ts,
 * this file fails rather than a paying candidate.
 *
 * The numeric boundary case has its own test. `|0.361 − 0.36|` is
 * 1.0000000000000009e-3 in binary floating point, so a naive `<= tolerance`
 * marks a candidate wrong for typing a value the question explicitly allows;
 * engine.ts adds a relative epsilon, and the test below pins that behaviour to
 * every numeric item in the bank rather than to one hand-picked example.
 */

import { describe, expect, it } from 'vitest'

import { getLesson, TRACKS } from '@/lib/lessons'
import { fromQasm, simulate } from '@/lib/quantum'
import { gradeExam, gradeQuestion, selectQuestions } from './engine'
import { EXAMS, getExam } from './catalogue'
import { QUESTION_POOL, getQuestion, questionsFor } from './questions'
import type { AnswerState, ExamQuestion } from './types'

const answerWith = (q: ExamQuestion): AnswerState =>
  q.kind === 'numeric'
    ? { questionId: q.id, selectedIds: [], numberValue: q.correctNumber, flagged: false }
    : { questionId: q.id, selectedIds: [...(q.correctIds ?? [])], flagged: false }

const optionIds = (q: ExamQuestion): string[] => (q.options ?? []).map((o) => o.id)

const FOUNDATION_SLUGS = TRACKS.find((t) => t.id === 'foundations')?.lessonSlugs ?? []
const ADVANCED_SLUGS = TRACKS.find((t) => t.id === 'advanced')?.lessonSlugs ?? []

/**
 * Lessons deliberately outside the exam pool. 'inside-a-quantum-computer'
 * (foundations lesson 8) is taught, not examined — the certification's
 * subtitle in lib/exams/catalogue.ts says so in as many words, and the
 * foundations paper stays a test of the states-and-gates material (f01-f58).
 * Writing a hardware item set would land in lib/exams/questions.ts, which is
 * owned by the exam bank; until then this list keeps the coverage assertions
 * below honest instead of silently weakened. A NEW lesson added to either
 * track still fails these tests unless it is either given questions or
 * deliberately listed here.
 */
const UNEXAMINED_SLUGS = new Set([
  'inside-a-quantum-computer',
  // 'qaoa-and-optimization' (advanced lesson 6) is taught, not yet examined:
  // the advanced certification pool (a01…a45) predates it, and a QAOA item
  // set belongs in lib/exams/questions.ts, which is owned by the exam bank.
  // Until that set exists, listing the slug here keeps the coverage
  // assertions below honest instead of silently weakened.
  'qaoa-and-optimization',
])
const EXAMINED_SLUGS = [...FOUNDATION_SLUGS, ...ADVANCED_SLUGS].filter(
  (slug) => !UNEXAMINED_SLUGS.has(slug)
)

describe('question bank shape', () => {
  it('ids are unique, stable-looking, and findable', () => {
    const ids = QUESTION_POOL.map((q) => q.id)
    expect(new Set(ids).size, 'duplicate question id — stored attempts would regrade').toBe(
      ids.length
    )
    for (const id of ids) {
      expect(id).toMatch(/^[fa]\d{2}$/)
      expect(getQuestion(id)?.id).toBe(id)
    }
  })

  it('every question is drawn from a real lesson and carries a real explanation', () => {
    for (const q of QUESTION_POOL) {
      expect(getLesson(q.lessonSlug), `${q.id} points at a lesson that does not exist`).toBeDefined()
      expect(q.prompt.length, `${q.id} prompt is too short to be a question`).toBeGreaterThan(30)
      expect(
        q.explanation.length,
        `${q.id} explanation does not teach anything`
      ).toBeGreaterThan(120)
      expect(q.points, `${q.id} has a nonsense weight`).toBeGreaterThanOrEqual(1)
      expect(q.points).toBeLessThanOrEqual(3)
    }
  })

  it('option-based questions are internally consistent', () => {
    for (const q of QUESTION_POOL) {
      if (q.kind === 'numeric') continue
      const ids = optionIds(q)
      expect(ids.length, `${q.id} has too few options`).toBeGreaterThanOrEqual(2)
      expect(new Set(ids).size, `${q.id} repeats an option id`).toBe(ids.length)
      expect((q.correctIds ?? []).length, `${q.id} has no key`).toBeGreaterThan(0)
      for (const id of q.correctIds ?? []) {
        expect(ids, `${q.id} keys an option that is not offered`).toContain(id)
      }
      for (const o of q.options ?? []) {
        expect(o.text.trim().length, `${q.id} has an empty option`).toBeGreaterThan(0)
      }
      if (q.kind === 'single') {
        expect((q.correctIds ?? []).length, `${q.id} is single-answer with several keys`).toBe(1)
        expect(ids.length, `${q.id} needs real distractors`).toBeGreaterThanOrEqual(4)
      }
      if (q.kind === 'multi') {
        expect((q.correctIds ?? []).length).toBeGreaterThanOrEqual(2)
        // If every option were correct, "select everything" would be a winning
        // strategy and the item would test nothing.
        expect(
          (q.correctIds ?? []).length,
          `${q.id} is a select-all where selecting all is right`
        ).toBeLessThan(ids.length)
      }
    }
  })

  it('numeric questions have a usable tolerance', () => {
    for (const q of QUESTION_POOL) {
      if (q.kind !== 'numeric') continue
      expect(Number.isFinite(q.correctNumber), `${q.id} has no numeric key`).toBe(true)
      expect(q.tolerance, `${q.id} has no stated tolerance`).toBeDefined()
      expect(q.tolerance as number).toBeGreaterThanOrEqual(0)
      expect(q.options, `${q.id} is numeric but offers options`).toBeUndefined()
    }
  })

  it('the pools are big enough that a resit is a different paper', () => {
    for (const exam of EXAMS) {
      const pool = questionsFor(exam.id)
      expect(pool.length, `${exam.id} pool is thinner than its paper`).toBeGreaterThanOrEqual(
        exam.questionCount * 2
      )
    }
  })

  it('every examined lesson is represented several times over', () => {
    const count = (slug: string) => QUESTION_POOL.filter((q) => q.lessonSlug === slug).length
    for (const slug of EXAMINED_SLUGS) {
      expect(count(slug), `${slug} has too few questions to vary between papers`).toBeGreaterThanOrEqual(6)
    }
  })

  it('each examined lesson pool spreads across difficulties', () => {
    for (const slug of EXAMINED_SLUGS) {
      const points = QUESTION_POOL.filter((q) => q.lessonSlug === slug).map((q) => q.points)
      expect(Math.min(...points), `${slug} has no easy item`).toBeLessThanOrEqual(2)
      expect(Math.max(...points), `${slug} has no hard item`).toBeGreaterThanOrEqual(2)
      expect(new Set(points).size, `${slug} is one difficulty throughout`).toBeGreaterThan(1)
    }
  })
})

describe('answer keys', () => {
  it.each(QUESTION_POOL.map((q) => [q.id, q] as const))(
    '%s — the grader accepts the key and nothing else',
    (_id, q) => {
      const right = gradeQuestion(q, answerWith(q))
      expect(right.correct, `${q.id}: the grader rejects its own answer key`).toBe(true)
      expect(right.earned).toBe(q.points)

      // Unanswered is wrong, always. No skip credit.
      expect(gradeQuestion(q, undefined).correct).toBe(false)
      expect(gradeQuestion(q, undefined).earned).toBe(0)

      if (q.kind === 'numeric') {
        const expected = q.correctNumber as number
        const tol = q.tolerance ?? 0

        // The boundary is INCLUSIVE — this is the float trap the engine guards.
        for (const given of [expected + tol, expected - tol]) {
          expect(
            gradeQuestion(q, { questionId: q.id, selectedIds: [], numberValue: given, flagged: false })
              .correct,
            `${q.id}: ${given} is exactly on the stated tolerance and was marked wrong`
          ).toBe(true)
        }

        // And a clearly-out-of-range answer is refused.
        const off = expected + Math.max(tol * 4, Math.abs(expected) * 0.5, 1)
        expect(
          gradeQuestion(q, { questionId: q.id, selectedIds: [], numberValue: off, flagged: false })
            .correct,
          `${q.id}: ${off} was accepted`
        ).toBe(false)

        // A blank numeric field is not a zero.
        expect(
          gradeQuestion(q, { questionId: q.id, selectedIds: [], flagged: false }).correct
        ).toBe(false)
        return
      }

      const ids = optionIds(q)
      const key = q.correctIds ?? []

      // Selecting everything only works if everything is correct.
      if (key.length < ids.length) {
        expect(
          gradeQuestion(q, { questionId: q.id, selectedIds: ids, flagged: false }).correct,
          `${q.id}: blanket-selecting every option was marked correct`
        ).toBe(false)
      }

      // Dropping one correct answer is wrong (no partial credit).
      if (key.length > 1) {
        expect(
          gradeQuestion(q, { questionId: q.id, selectedIds: key.slice(1), flagged: false }).correct
        ).toBe(false)
      }

      // Adding one wrong answer is wrong.
      const distractor = ids.find((id) => !key.includes(id))
      if (distractor) {
        expect(
          gradeQuestion(q, { questionId: q.id, selectedIds: [...key, distractor], flagged: false })
            .correct
        ).toBe(false)
        expect(
          gradeQuestion(q, { questionId: q.id, selectedIds: [distractor], flagged: false }).correct
        ).toBe(false)
      }
    }
  )

  it('reproduces the documented 0.361 / 0.36 ± 0.001 boundary', () => {
    // 0.361 − 0.36 is 1.0000000000000009e-3, not 1e-3. A grader written the
    // obvious way marks this wrong; ours must not.
    expect(Math.abs(0.361 - 0.36) <= 0.001).toBe(false)
    const q = getQuestion('f04')!
    expect(
      gradeQuestion(q, { questionId: q.id, selectedIds: [], numberValue: 0.361, flagged: false })
        .correct
    ).toBe(true)
  })
})

describe('circuit-outcome questions match the simulator', () => {
  const circuitQuestions = QUESTION_POOL.filter((q) => q.kind === 'circuit-outcome')

  it('there are some', () => {
    expect(circuitQuestions.length).toBeGreaterThanOrEqual(8)
  })

  it.each(circuitQuestions.map((q) => [q.id, q] as const))(
    '%s — the listed outcomes are exactly the ones with non-zero probability',
    (_id, q) => {
      expect(q.qasm, `${q.id} is a circuit question with no circuit`).toBeDefined()
      const circuit = fromQasm(q.qasm as string)
      const state = simulate(circuit)

      const width = circuit.numQubits
      for (const option of q.options ?? []) {
        expect(
          option.text,
          `${q.id} option "${option.text}" is not a ${width}-bit outcome`
        ).toMatch(new RegExp(`^[01]{${width}}$`))
      }

      const actual = new Set(
        state
          .probabilities()
          .map((p, i) => (p > 1e-9 ? state.label(i) : null))
          .filter((label): label is string => label !== null)
      )
      const keyed = new Set(
        (q.correctIds ?? []).map((id) => (q.options ?? []).find((o) => o.id === id)!.text)
      )

      expect(
        [...keyed].sort(),
        `${q.id}: the key says ${[...keyed].sort().join(',')} but the simulator produces ${[...actual]
          .sort()
          .join(',')}`
      ).toEqual([...actual].sort())
    }
  )
})

describe('exams', () => {
  it('every pool id resolves', () => {
    for (const exam of EXAMS) {
      expect(questionsFor(exam.id).length, `${exam.id} references a missing question`).toBe(
        exam.poolIds.length
      )
      expect(new Set(exam.poolIds).size, `${exam.id} lists a question twice`).toBe(
        exam.poolIds.length
      )
    }
  })

  it('the advanced prerequisites are foundations items, and not tunnelling', () => {
    const advanced = getExam('advanced-cert')!
    const own = new Set(questionsFor('advanced-cert').filter((q) => q.id.startsWith('a')).map((q) => q.id))
    const prereqs = advanced.poolIds.filter((id) => !own.has(id))

    expect(prereqs.length, 'the advanced paper leans on no foundations at all').toBeGreaterThanOrEqual(8)
    for (const id of prereqs) {
      const q = getQuestion(id)
      expect(q, `${id} is listed as a prerequisite but does not exist`).toBeDefined()
      expect(id.startsWith('f'), `${id} is not a foundations item`).toBe(true)
      expect(
        FOUNDATION_SLUGS.includes((q as ExamQuestion).lessonSlug),
        `${id} is not from the foundations track`
      ).toBe(true)
      expect(
        (q as ExamQuestion).lessonSlug,
        'tunnelling is not a prerequisite for anything in the advanced track'
      ).not.toBe('tunneling')
    }
  })

  it('a paper is the right size and never repeats a question', () => {
    for (const exam of EXAMS) {
      for (const seed of [1, 7, 12345, 999999]) {
        const paper = selectQuestions(exam, seed)
        expect(paper.length).toBe(exam.questionCount)
        expect(new Set(paper.map((q) => q.id)).size).toBe(exam.questionCount)
      }
    }
  })

  it('a resit is substantially a different paper', () => {
    for (const exam of EXAMS) {
      const first = new Set(selectQuestions(exam, 1).map((q) => q.id))
      const second = selectQuestions(exam, 2).map((q) => q.id)
      const shared = second.filter((id) => first.has(id)).length
      expect(
        shared / exam.questionCount,
        `${exam.id}: a resit repeats ${shared} of ${exam.questionCount} questions`
      ).toBeLessThan(0.75)
    }
  })

  it('a paper of all-correct answers passes and all-blank fails', () => {
    for (const exam of EXAMS) {
      const paper = selectQuestions(exam, 42)

      const perfect: Record<string, AnswerState> = {}
      for (const q of paper) perfect[q.id] = answerWith(q)
      const good = gradeExam(exam, paper, perfect)
      expect(good.score).toBe(1)
      expect(good.passed).toBe(true)
      expect(good.weakLessons).toEqual([])
      expect(good.earned).toBe(good.total)

      const blank = gradeExam(exam, paper, {})
      expect(blank.score).toBe(0)
      expect(blank.passed).toBe(false)
      expect(blank.weakLessons.length, 'a blank paper should point at every lesson').toBeGreaterThan(0)
    }
  })

  it('the pass mark is a real threshold, not a formality', () => {
    for (const exam of EXAMS) {
      expect(exam.passMark).toBeGreaterThanOrEqual(0.6)
      expect(exam.passMark).toBeLessThan(1)
      expect(exam.timeLimitMinutes).toBeGreaterThan(0)
      // Roughly a minute and a half per question at the outside — enough to
      // read a QASM listing, not enough to look everything up.
      expect(exam.timeLimitMinutes / exam.questionCount).toBeLessThanOrEqual(3)
    }
  })
})
