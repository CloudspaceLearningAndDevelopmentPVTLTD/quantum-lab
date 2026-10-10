/**
 * engine.test.ts — the properties the competition's fairness rests on.
 *
 * Determinism is not a nicety here: two server instances (or the same instance
 * across a redeploy) must derive the identical puzzle for one ISO week, or the
 * leaderboard mixes scores from different games. And the recount check is the
 * anti-cheat: a claimed gate count must never be believed over the server's own
 * count of the parsed circuit.
 */

import { describe, expect, it } from 'vitest'
import { toQasm, type Circuit } from '@/lib/quantum'
import { grade } from '@/lib/challenges/grade'
import {
  competitionReference,
  currentCompetition,
  isoWeekKey,
  isoWeekWindow,
  validateEntry,
} from './engine'

// A Wednesday, mid-week, and a Sunday/Monday pair straddling the rollover.
const WED = new Date('2026-08-26T15:30:00Z')
const SUN_LATE = new Date('2026-08-30T23:59:59Z')
const MON_EARLY = new Date('2026-08-31T00:00:00Z')

describe('ISO week derivation', () => {
  it('gives every instant of one ISO week the same key', () => {
    expect(isoWeekKey(WED)).toBe(isoWeekKey(SUN_LATE))
    expect(isoWeekKey(WED)).toBe('2026-W35')
  })

  it('rolls to a new key at Monday 00:00 UTC exactly', () => {
    expect(isoWeekKey(SUN_LATE)).not.toBe(isoWeekKey(MON_EARLY))
    expect(isoWeekKey(MON_EARLY)).toBe('2026-W36')
  })

  it('handles the ISO year boundary (Jan 1 can belong to the old year’s last week)', () => {
    // 2027-01-01 is a Friday; ISO says it sits in 2026-W53.
    expect(isoWeekKey(new Date('2027-01-01T12:00:00Z'))).toBe('2026-W53')
  })

  it('windows run Monday 00:00 UTC to the next Monday', () => {
    const { startsAt, endsAt } = isoWeekWindow(WED)
    expect(startsAt.toISOString()).toBe('2026-08-24T00:00:00.000Z')
    expect(endsAt.toISOString()).toBe('2026-08-31T00:00:00.000Z')
    expect(endsAt.getTime() - startsAt.getTime()).toBe(7 * 86_400_000)
  })
})

describe('currentCompetition', () => {
  it('is deterministic: the same ISO week yields the identical puzzle', () => {
    const a = currentCompetition(WED)
    const b = currentCompetition(SUN_LATE)
    expect(a.id).toBe(b.id)
    expect(a.par).toBe(b.par)
    expect(a.challenge.targetProbabilities).toEqual(b.challenge.targetProbabilities)
    expect(a.endsAt).toBe(b.endsAt)
  })

  it('changes when the week does', () => {
    const a = currentCompetition(SUN_LATE)
    const b = currentCompetition(MON_EARLY)
    expect(a.id).not.toBe(b.id)
    // The targets could theoretically collide; the id never can.
    expect(a.startsAt).not.toBe(b.startsAt)
  })

  it('never leaks the answer: no hints, no reference solution on the challenge', () => {
    const comp = currentCompetition(WED)
    expect(comp.challenge.hints).toEqual([])
    expect('referenceSolution' in comp.challenge).toBe(false)
  })

  it('is honest about par: the reference solution solves it at exactly par', () => {
    const comp = currentCompetition(WED)
    const reference = competitionReference(comp.weekKey)
    const result = grade(comp.challenge, reference.referenceSolution)
    expect(result.passed).toBe(true)
    expect(result.gateCount).toBe(comp.par)
  })
})

describe('validateEntry', () => {
  const comp = currentCompetition(WED)
  const reference = competitionReference(comp.weekKey)
  const solutionQasm = toQasm(reference.referenceSolution)

  it('accepts a correct circuit and returns the server’s own gate count', () => {
    const verdict = validateEntry(comp, solutionQasm)
    expect(verdict.ok).toBe(true)
    if (verdict.ok) expect(verdict.gates).toBe(comp.par)
  })

  it('rejects a mis-stated gate count instead of correcting it', () => {
    // A cheater claims fewer gates than the circuit has. The server recounts
    // from the parsed QASM and refuses the entry outright.
    const verdict = validateEntry(comp, solutionQasm, comp.par - 1)
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.reason).toMatch(/server counts/)
  })

  it('accepts a claim that matches the recount', () => {
    const verdict = validateEntry(comp, solutionQasm, comp.par)
    expect(verdict.ok).toBe(true)
  })

  it('counts padding: a padded-but-correct circuit scores its real length', () => {
    // X·X on one wire is the identity, so the state still passes — but the two
    // wasted gates are counted, which is the whole sport.
    const padded: Circuit = {
      numQubits: reference.referenceSolution.numQubits,
      ops: [
        ...reference.referenceSolution.ops,
        { name: 'X', qubits: [0] },
        { name: 'X', qubits: [0] },
      ],
    }
    const verdict = validateEntry(comp, toQasm(padded))
    expect(verdict.ok).toBe(true)
    if (verdict.ok) expect(verdict.gates).toBe(comp.par + 2)
  })

  it('rejects a circuit that misses the target', () => {
    const wrong: Circuit = {
      numQubits: comp.challenge.numQubits,
      ops: [{ name: 'X', qubits: [0] }],
    }
    const verdict = validateEntry(comp, toQasm(wrong))
    // An X-only circuit hitting a generated 3-gate target would be an
    // astonishing coincidence; the generator's non-degeneracy checks forbid the
    // empty circuit and every single-gate prefix of the reference from passing.
    expect(verdict.ok).toBe(false)
  })

  it('rejects unparseable and empty QASM', () => {
    expect(validateEntry(comp, 'this is not qasm').ok).toBe(false)
    expect(validateEntry(comp, '').ok).toBe(false)
  })

  it('rejects the wrong register width by name', () => {
    const verdict = validateEntry(comp, toQasm({ numQubits: 2, ops: [{ name: 'H', qubits: [0] }] }))
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.reason).toMatch(/qubits/)
  })
})
