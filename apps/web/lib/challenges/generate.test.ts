/**
 * generate.test.ts — the generator's invariants, checked by brute force.
 *
 * The generator's whole pitch is "verified solvable by execution before it is
 * returned". This suite does not trust that claim — it re-runs the
 * verification from the outside on a large batch of seeds, using the same
 * grader a learner faces, and separately proves the properties the generator's
 * internal checks could silently stop enforcing: determinism (same seed, same
 * challenge), purity (no unseeded randomness — Math.random THROWS during
 * generation here), and the one-structural-diff contract of the mutation
 * table.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  GENERATED_KINDS,
  generateChallenge,
  nextSeed,
  type Difficulty,
  type GeneratedKind,
} from './generate'
import { grade, gateCount } from './grade'
import { simulate, type Circuit } from '@/lib/quantum'

const DIFFICULTIES: Difficulty[] = [1, 2, 3]

/** Every (kind, difficulty, seed) triple the batch tests run over: 3 × 3 × 12 = 108 generations. */
const BATCH: [GeneratedKind, Difficulty, number][] = []
for (const kind of GENERATED_KINDS) {
  for (const difficulty of DIFFICULTIES) {
    for (let seed = 1; seed <= 12; seed++) {
      BATCH.push([kind, difficulty, seed * 7919 + difficulty]) // spread the seeds out a little
    }
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('generateChallenge', () => {
  it(`${BATCH.length} seeded generations across all kinds self-verify against the real grader`, () => {
    for (const [kind, difficulty, seed] of BATCH) {
      const ch = generateChallenge(kind, difficulty, seed)
      const label = `${kind} d${difficulty} seed ${seed}`

      // The advertised solution really passes, at full score.
      const verdict = grade(ch, ch.referenceSolution)
      expect(verdict.passed, `${label}: reference solution fails — ${verdict.summary}`).toBe(true)
      expect(verdict.score, `${label}: reference solution does not score 1`).toBe(1)

      // Not degenerate: an untouched editor must not already be a solve.
      const empty: Circuit = { numQubits: ch.numQubits, ops: [] }
      expect(grade(ch, empty).passed, `${label}: an empty circuit passes`).toBe(false)

      // Par is honest — it IS the reference solution's gate count.
      expect(ch.maxGates, `${label}: par disagrees with the solution`).toBe(
        gateCount(ch.referenceSolution)
      )

      // The target is what the solution actually produces, not a copy that
      // could drift: simulate independently and compare.
      const probabilities = simulate(ch.referenceSolution).probabilities()
      expect(ch.targetProbabilities, `${label}: target is not the solution's output`).toEqual(
        probabilities
      )

      // Every angle the learner might need is on the workbench's π/16 lattice.
      for (const op of ch.referenceSolution.ops) {
        if (op.theta === undefined) continue
        const steps = op.theta / (Math.PI / 16)
        expect(
          Math.abs(steps - Math.round(steps)),
          `${label}: ${op.name}(${op.theta}) is off the θ slider lattice`
        ).toBeLessThan(1e-9)
      }
    }
  })

  it('the same seed reproduces the same challenge, bit for bit', () => {
    for (const [kind, difficulty, seed] of BATCH.filter((_, i) => i % 5 === 0)) {
      const a = generateChallenge(kind, difficulty, seed)
      const b = generateChallenge(kind, difficulty, seed)
      expect(b).toEqual(a)
    }
  })

  it('different seeds actually vary — the generator is not returning one canned puzzle', () => {
    const ids = new Set<string>()
    const targets = new Set<string>()
    for (let seed = 0; seed < 20; seed++) {
      const ch = generateChallenge('target-state', 2, seed)
      ids.add(ch.id)
      targets.add(JSON.stringify(ch.targetProbabilities))
    }
    expect(ids.size).toBe(20) // ids embed the seed
    // Distinct seeds may collide on a distribution occasionally; most must not.
    expect(targets.size).toBeGreaterThan(10)
  })

  it('is pure: no unseeded randomness — Math.random throws for the whole run', () => {
    vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('generateChallenge reached Math.random — it must stay seeded')
    })
    const ch = generateChallenge('fix-the-bug', 3, 42)
    expect(grade(ch, ch.referenceSolution).passed).toBe(true)
  })

  it('nextSeed is deterministic and moves', () => {
    expect(nextSeed(42)).toBe(nextSeed(42))
    expect(nextSeed(42)).not.toBe(42)
    const a = generateChallenge('target-state', 1, nextSeed(42))
    const b = generateChallenge('target-state', 1, nextSeed(42))
    expect(b).toEqual(a)
  })

  it('rejects inputs it cannot honour instead of guessing', () => {
    expect(() => generateChallenge('target-state', 4 as Difficulty, 1)).toThrow(/difficulty/)
    expect(() =>
      generateChallenge('oracle' as unknown as (typeof GENERATED_KINDS)[number], 1, 1)
    ).toThrow(/kind/)
    expect(() => generateChallenge('target-state', 1, Number.NaN)).toThrow(/seed/)
  })

  describe('fix-the-bug mutations', () => {
    const bugs = BATCH.filter(([kind]) => kind === 'fix-the-bug').map(([kind, d, s]) =>
      generateChallenge(kind, d, s)
    )

    it('injects exactly one structural diff: same length, one op changed, none added or removed', () => {
      for (const ch of bugs) {
        const broken = ch.startingCircuit
        expect(broken, `${ch.id}: fix-the-bug has no starting circuit`).toBeDefined()
        const correct = ch.referenceSolution.ops
        const ops = broken!.ops
        expect(ops.length, `${ch.id}: mutation changed the op count`).toBe(correct.length)

        const diffs = correct
          .map((op, i) => (JSON.stringify(op) === JSON.stringify(ops[i]) ? -1 : i))
          .filter((i) => i >= 0)
        expect(diffs, `${ch.id}: expected exactly one differing op`).toHaveLength(1)
        expect(ch.mutation, `${ch.id}: mutation metadata missing`).toBeDefined()
        expect(diffs[0], `${ch.id}: mutation metadata points at the wrong op`).toBe(
          ch.mutation!.index
        )
      }
    })

    it('the broken circuit fails the grader and the correct one passes it', () => {
      for (const ch of bugs) {
        expect(grade(ch, ch.startingCircuit!).passed, `${ch.id}: broken circuit already passes`).toBe(
          false
        )
        expect(grade(ch, ch.referenceSolution).passed, `${ch.id}: correct circuit fails`).toBe(true)
      }
    })
  })
})
