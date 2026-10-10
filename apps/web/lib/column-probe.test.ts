/**
 * column-probe.test.ts — the inline probe's column → state lookup.
 *
 * The physics itself (ρ11 per qubit) is pinned in quantum-phase.test.ts; what
 * can go wrong HERE is the off-by-one between grid columns and step frames,
 * and the clamp for the trailing empty columns the grid always draws. Both
 * are asserted against the Bell circuit, whose per-step marginals are known
 * exactly.
 */

import { describe, expect, it } from 'vitest'
import { simulateSteps, type Circuit } from './quantum'
import { columnProbeReadout, describeColumnProbe, formatProbePct } from './column-probe'

const BELL: Circuit = {
  numQubits: 2,
  ops: [
    { name: 'H', qubits: [0] },
    { name: 'CX', qubits: [0, 1] },
  ],
}

describe('columnProbeReadout', () => {
  it('reads the state AFTER the probed column (frames[col + 1])', () => {
    const frames = simulateSteps(BELL)
    // After column 0 (the H): q0 is 50/50, q1 untouched.
    const afterH = columnProbeReadout(frames, 0)
    expect(afterH).not.toBeNull()
    expect(afterH!.frameIndex).toBe(1)
    expect(afterH!.pastEnd).toBe(false)
    expect(afterH!.p1s[0]).toBeCloseTo(0.5, 12)
    expect(afterH!.p1s[1]).toBeCloseTo(0, 12)
    // After column 1 (the CX): entangled, both 50/50.
    const afterCX = columnProbeReadout(frames, 1)
    expect(afterCX!.frameIndex).toBe(2)
    expect(afterCX!.p1s[0]).toBeCloseTo(0.5, 12)
    expect(afterCX!.p1s[1]).toBeCloseTo(0.5, 12)
  })

  it('clamps trailing empty columns to the final state and flags pastEnd', () => {
    const frames = simulateSteps(BELL)
    // The grid draws TRAILING_COLS empty columns; probing one of them must
    // read the final state, not walk off the frames array.
    const past = columnProbeReadout(frames, 5)
    expect(past!.frameIndex).toBe(frames.length - 1)
    expect(past!.pastEnd).toBe(true)
    expect(past!.p1s[0]).toBeCloseTo(0.5, 12)
    expect(past!.p1s[1]).toBeCloseTo(0.5, 12)
  })

  it('probes an empty circuit as the |0…0⟩ state', () => {
    const frames = simulateSteps({ numQubits: 3, ops: [] })
    const readout = columnProbeReadout(frames, 0)
    expect(readout!.pastEnd).toBe(true)
    expect(readout!.p1s).toEqual([0, 0, 0])
  })

  it('guards the impossible-but-cheap cases: no frames, negative column', () => {
    expect(columnProbeReadout([], 0)).toBeNull()
    const frames = simulateSteps(BELL)
    // A negative column (a hover race during a re-render) clamps to 0.
    expect(columnProbeReadout(frames, -1)!.frameIndex).toBe(1)
  })
})

describe('describeColumnProbe / formatProbePct', () => {
  it('rounds to whole percent — no float noise in a screen reader', () => {
    expect(formatProbePct(0.4999951)).toBe('50%')
    expect(formatProbePct(0)).toBe('0%')
    expect(formatProbePct(1.0000001)).toBe('100%')
  })

  it('speaks position first, then one clause per qubit', () => {
    const frames = simulateSteps(BELL)
    const spoken = describeColumnProbe(columnProbeReadout(frames, 0)!)
    expect(spoken).toBe('After column 1: chance of reading 1 — qubit 0 50%, qubit 1 0%.')
    const past = describeColumnProbe(columnProbeReadout(frames, 9)!)
    expect(past).toMatch(/^After the last gate/)
  })
})
