/**
 * harness.test.ts — pins the pure core of the agent benchmark.
 *
 * These tests are what lets docs/BENCHMARK.md make claims: the extraction
 * rules and the aggregate math are stated there in prose, and here as
 * executable fact. If a change here is needed, PROMPT_VERSION probably needs
 * a bump too — see the harness header.
 */

import { describe, expect, it } from 'vitest'

import {
  ATTEMPTS_PER_CHALLENGE,
  aggregate,
  buildPrompt,
  extractQasm,
  plannedGenerated,
  type BenchChallengeResult,
} from './harness'

const QASM = 'OPENQASM 3.0;\ninclude "stdgates.inc";\nqubit[1] q;\nx q[0];'

describe('extractQasm', () => {
  it('pulls the body of a ```qasm fence', () => {
    const reply = 'Here is my answer:\n```qasm\n' + QASM + '\n```\nDone.'
    expect(extractQasm(reply)).toBe(QASM)
  })

  it('accepts an unlabelled fence whose body contains OPENQASM', () => {
    const reply = '```\n' + QASM + '\n```'
    expect(extractQasm(reply)).toBe(QASM)
  })

  it('prefers the LAST fence containing OPENQASM (models quote the start first)', () => {
    const starting = 'OPENQASM 3.0;\nqubit[1] q;\nh q[0];'
    const reply =
      'The starting circuit was:\n```qasm\n' + starting + '\n```\n' +
      'My fix:\n```qasm\n' + QASM + '\n```'
    expect(extractQasm(reply)).toBe(QASM)
  })

  it('ignores non-QASM fences and falls back to a qasm-labelled one', () => {
    const reply = '```qasm\nqubit[1] q;\nx q[0];\n```\n```python\nprint("hi")\n```'
    expect(extractQasm(reply)).toBe('qubit[1] q;\nx q[0];')
  })

  it('extracts bare QASM, dropping trailing prose after the last statement', () => {
    const reply = 'Sure!\n' + QASM + '\nThis flips the qubit to |1>.'
    expect(extractQasm(reply)).toBe(QASM)
  })

  it('returns null when the reply has nothing QASM-shaped — a fail, not a guess', () => {
    expect(extractQasm('I am not sure how to solve this one.')).toBeNull()
    expect(extractQasm('')).toBeNull()
    // OPENQASM mentioned but no statement ever terminated.
    expect(extractQasm('OPENQASM circuits are neat')).toBeNull()
  })
})

describe('aggregate', () => {
  const result = (
    kind: string,
    passed: boolean,
    passedOnAttempt: number | null,
  ): BenchChallengeResult => ({
    id: `x-${kind}-${Math.random()}`,
    source: 'catalogue',
    kind,
    level: 'Beginner',
    passed,
    passedOnAttempt,
    attempts: [],
  })

  it('computes overall, first-try, and per-kind rates', () => {
    const agg = aggregate([
      result('target-state', true, 1),
      result('target-state', true, 2),
      result('target-state', false, null),
      result('oracle', false, null),
    ])
    expect(agg.total).toBe(4)
    expect(agg.passed).toBe(2)
    expect(agg.passRate).toBe(0.5)
    // Only the attempt-1 pass counts, over ALL challenges.
    expect(agg.firstTryPassRate).toBe(0.25)
    expect(agg.byKind['target-state']).toEqual({ total: 3, passed: 2, passRate: 0.6667 })
    expect(agg.byKind['oracle']).toEqual({ total: 1, passed: 0, passRate: 0 })
  })

  it('is exact on an empty set — zero rates, never NaN', () => {
    const agg = aggregate([])
    expect(agg).toEqual({ total: 0, passed: 0, passRate: 0, firstTryPassRate: 0, byKind: {} })
  })
})

describe('buildPrompt', () => {
  const presentation = {
    id: 'flip-it',
    title: 'Flip it',
    brief: 'Get the qubit to |1>.',
    kind: 'target-state',
    level: 'Beginner',
    numQubits: 1,
    maxGates: 1,
    tolerance: null,
    targetProbabilities: [0, 1],
    startingCircuitQasm: null,
  }

  it('includes the challenge, the conventions, and the target', () => {
    const prompt = buildPrompt(presentation)
    expect(prompt).toContain('Flip it')
    expect(prompt).toContain('MSB-first')
    expect(prompt).toContain('[0, 1]')
    expect(prompt).toContain('Par: 1 gates')
    expect(prompt).not.toContain('FAILED')
  })

  it('adds grader feedback and the first hint only on a retry', () => {
    const prompt = buildPrompt(presentation, {
      summary: 'Off target on |1>.',
      failedChecks: ['Output distribution: |1> is at 0%, target 100%.'],
      hint: 'Think of the classical NOT gate.',
    })
    expect(prompt).toContain('FAILED')
    expect(prompt).toContain('Off target on |1>.')
    expect(prompt).toContain('Hint: Think of the classical NOT gate.')
  })

  it('marks the gate limit as enforced only for gate-golf', () => {
    const golf = buildPrompt({ ...presentation, kind: 'gate-golf', maxGates: 2 })
    expect(golf).toContain('at most 2 gates (enforced)')
  })
})

describe('plannedGenerated', () => {
  it('is deterministic, rotates kinds fastest, ramps difficulty, avoids seed 0', () => {
    const plan = plannedGenerated(9)
    expect(plan).toEqual(plannedGenerated(9))
    expect(plan).toHaveLength(9)
    expect(plan[0]).toEqual({ kind: 'target-state', difficulty: 1, seed: 1000 })
    expect(plan[3]).toEqual({ kind: 'target-state', difficulty: 2, seed: 1003 })
    expect(plan[8]).toEqual({ kind: 'fix-the-bug', difficulty: 3, seed: 1008 })
    expect(plan.every((s) => s.seed >= 1000)).toBe(true)
  })

  it('handles zero and negative N', () => {
    expect(plannedGenerated(0)).toEqual([])
    expect(plannedGenerated(-3)).toEqual([])
  })
})

it('the attempt bound is the documented one', () => {
  expect(ATTEMPTS_PER_CHALLENGE).toBe(2)
})
