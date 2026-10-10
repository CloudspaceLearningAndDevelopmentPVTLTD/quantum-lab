/**
 * Tests for the question-first 'inline-check' block: the state machine and
 * gating rule in ./inlineCheck.ts, and the data invariants over every
 * inline-check block any lesson body actually ships.
 *
 * The component (components/lesson/InlineCheck.tsx) is deliberately a thin
 * view over these functions because this vitest run is a plain Node
 * environment with no DOM (see vitest.config.ts) — so "pick → feedback →
 * reveal" and "skip reveals without answering" are exercised HERE, on the
 * exact transitions the component calls, which is the same split
 * lib/deeperExplain.ts uses for its component.
 */
import { describe, expect, it } from 'vitest'
import type { InlineCheckBlock, LessonBlock } from './types'
import {
  INITIAL_CHECK_STATE,
  framingLabel,
  gateBlocks,
  isCorrectPick,
  pickOption,
  skipCheck,
} from './inlineCheck'
import { allFullLessons } from './server'

const CHECK: InlineCheckBlock = {
  kind: 'inline-check',
  id: 'c1',
  question: 'You measure |+⟩ and get 0. What does a second measurement give?',
  options: [
    { id: 'a', text: '50/50 again' },
    { id: 'b', text: '0 with certainty' },
  ],
  correctId: 'b',
  explanation: 'Collapse: after the outcome 0 the state is exactly |0⟩.',
}

describe('inline-check state machine', () => {
  it('starts unanswered, unrevealed, unskipped', () => {
    expect(INITIAL_CHECK_STATE).toEqual({ pickedId: null, revealed: false, skipped: false })
    expect(isCorrectPick(CHECK, INITIAL_CHECK_STATE)).toBeNull()
  })

  it('pick locks the answer, reveals the content, and grades it', () => {
    const right = pickOption(INITIAL_CHECK_STATE, 'b')
    expect(right).toEqual({ pickedId: 'b', revealed: true, skipped: false })
    expect(isCorrectPick(CHECK, right)).toBe(true)

    const wrong = pickOption(INITIAL_CHECK_STATE, 'a')
    expect(wrong.revealed).toBe(true) // a wrong pick still reveals — no forced gating
    expect(isCorrectPick(CHECK, wrong)).toBe(false)
  })

  it('the first pick wins: a second pick is an identity no-op', () => {
    const picked = pickOption(INITIAL_CHECK_STATE, 'a')
    // `===` matters — the component uses reference equality to skip re-renders
    // and to fire onReveal exactly once.
    expect(pickOption(picked, 'b')).toBe(picked)
  })

  it('skip ("show me anyway") reveals without answering', () => {
    const skipped = skipCheck(INITIAL_CHECK_STATE)
    expect(skipped).toEqual({ pickedId: null, revealed: true, skipped: true })
    expect(isCorrectPick(CHECK, skipped)).toBeNull()
  })

  it('skip after reveal is a no-op; pick after skip still grades', () => {
    const picked = pickOption(INITIAL_CHECK_STATE, 'b')
    expect(skipCheck(picked)).toBe(picked)

    const skipped = skipCheck(INITIAL_CHECK_STATE)
    expect(skipCheck(skipped)).toBe(skipped)
    // The question stays answerable after a skip, so commitment is still possible.
    const lateCommit = pickOption(skipped, 'b')
    expect(isCorrectPick(CHECK, lateCommit)).toBe(true)
    expect(lateCommit.revealed).toBe(true)
  })

  it('framing defaults to Predict and honours an explicit recall', () => {
    expect(framingLabel(CHECK)).toBe('Predict')
    expect(framingLabel({ ...CHECK, framing: 'recall' })).toBe('Recall')
  })
})

describe('gateBlocks', () => {
  const prose = (title: string): LessonBlock => ({ kind: 'prose', title, paragraphs: ['p'] })
  const check = (id: string): LessonBlock => ({ ...CHECK, id })
  const blocks: LessonBlock[] = [check('c1'), prose('one'), check('c2'), prose('two')]

  it('renders up to and including the first unrevealed check', () => {
    expect(gateBlocks(blocks, new Set())).toEqual([check('c1')])
    expect(gateBlocks(blocks, new Set(['c1']))).toEqual([check('c1'), prose('one'), check('c2')])
  })

  it('renders everything once every check is revealed', () => {
    expect(gateBlocks(blocks, new Set(['c1', 'c2']))).toEqual(blocks)
  })

  it('is the identity on a lesson with no inline-checks', () => {
    const plain: LessonBlock[] = [prose('a'), prose('b')]
    expect(gateBlocks(plain, new Set())).toEqual(plain)
  })
})

describe('inline-check blocks in the shipped lesson bodies', () => {
  const lessons = allFullLessons()

  it('are well-formed wherever they appear', () => {
    for (const lesson of lessons) {
      const seen = new Set<string>()
      for (const block of lesson.blocks) {
        if (block.kind !== 'inline-check') continue
        expect(seen.has(block.id), `${lesson.slug}/${block.id} repeats a check id`).toBe(false)
        seen.add(block.id)
        const optionIds = block.options.map((o) => o.id)
        expect(new Set(optionIds).size, `${lesson.slug}/${block.id} repeats an option id`).toBe(
          optionIds.length,
        )
        expect(optionIds.length, `${lesson.slug}/${block.id} needs 2+ options`).toBeGreaterThan(1)
        expect(
          optionIds,
          `${lesson.slug}/${block.id} marks a correct option that is not offered`,
        ).toContain(block.correctId)
        expect(block.question.length).toBeGreaterThan(0)
        expect(block.explanation.length).toBeGreaterThan(0)
      }
    }
  })

  it('always precede something — a question the lesson never answers is a bug', () => {
    for (const lesson of lessons) {
      lesson.blocks.forEach((block, i) => {
        if (block.kind !== 'inline-check') return
        expect(
          i,
          `${lesson.slug}/${block.id} is the last block: it gates nothing`,
        ).toBeLessThan(lesson.blocks.length - 1)
      })
    }
  })

  it('exist in the converted flagship lesson, question-first', () => {
    const flagship = lessons.find((l) => l.slug === 'superposition-and-measurement')
    expect(flagship).toBeDefined()
    const checks = flagship!.blocks.filter((b) => b.kind === 'inline-check')
    expect(checks.length).toBeGreaterThanOrEqual(2)
    // The very first screen of the flagship is a question, not prose.
    expect(flagship!.blocks[0].kind).toBe('inline-check')
  })
})
