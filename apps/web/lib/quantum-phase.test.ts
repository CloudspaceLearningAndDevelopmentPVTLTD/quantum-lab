import { describe, it, expect } from 'vitest'
import { StateVector, simulate, type Circuit } from './quantum'
import { allQubitPhaseInfo, qubitPhaseInfo } from './quantum-phase'

// ────────────────────────────────────────────────────────────
// The three states every phase-disk implementation must get right:
// Bell (mixed reduced states), |+⟩ (pure, phase 0), T|+⟩ (phase π/4).
// ────────────────────────────────────────────────────────────

const bell: Circuit = {
  numQubits: 2,
  ops: [
    { name: 'H', qubits: [0] },
    { name: 'CX', qubits: [0, 1] },
  ],
}

describe('qubitPhaseInfo', () => {
  it('Bell state: both qubits are maximally mixed — purity 0.5, p1 0.5', () => {
    const sv = simulate(bell)
    for (const q of [0, 1]) {
      const info = qubitPhaseInfo(sv, q)
      expect(info.p1).toBeCloseTo(0.5, 12)
      expect(info.purity).toBeCloseTo(0.5, 12)
      // Coherence vanishes, so the needle rests at 0 by convention.
      expect(info.phase).toBeCloseTo(0, 12)
    }
  })

  it('|+⟩: p1 = 0.5, phase 0, purity 1', () => {
    const sv = new StateVector(1).applySingle('H', 0)
    const info = qubitPhaseInfo(sv, 0)
    expect(info.p1).toBeCloseTo(0.5, 12)
    expect(info.phase).toBeCloseTo(0, 12)
    expect(info.purity).toBeCloseTo(1, 12)
  })

  it('T|+⟩: phase is +π/4 (the |1⟩ component leads, not lags)', () => {
    const sv = new StateVector(1).applySingle('H', 0).applySingle('T', 0)
    const info = qubitPhaseInfo(sv, 0)
    expect(info.p1).toBeCloseTo(0.5, 12)
    expect(info.phase).toBeCloseTo(Math.PI / 4, 12)
    expect(info.purity).toBeCloseTo(1, 12)
  })

  it('basis states: |0⟩ has p1 0, |1⟩ has p1 1, both pure with phase 0', () => {
    const zero = qubitPhaseInfo(new StateVector(1), 0)
    expect(zero.p1).toBeCloseTo(0, 12)
    expect(zero.purity).toBeCloseTo(1, 12)
    expect(zero.phase).toBe(0)

    const one = qubitPhaseInfo(new StateVector(1).applySingle('X', 0), 0)
    expect(one.p1).toBeCloseTo(1, 12)
    expect(one.purity).toBeCloseTo(1, 12)
    expect(one.phase).toBe(0)
  })

  it('spectator qubits are untouched: T|+⟩ on qubit 1 of a 3-qubit register', () => {
    const sv = new StateVector(3).applySingle('H', 1).applySingle('T', 1)
    const infos = allQubitPhaseInfo(sv)
    expect(infos).toHaveLength(3)
    expect(infos[1].phase).toBeCloseTo(Math.PI / 4, 12)
    expect(infos[1].p1).toBeCloseTo(0.5, 12)
    for (const q of [0, 2]) {
      expect(infos[q].p1).toBeCloseTo(0, 12)
      expect(infos[q].purity).toBeCloseTo(1, 12)
    }
  })

  it('agrees with blochVector: purity = (1 + |r|²) / 2', () => {
    const sv = simulate({
      numQubits: 2,
      ops: [
        { name: 'RY', qubits: [0], theta: Math.PI / 3 },
        { name: 'CX', qubits: [0, 1] },
        { name: 'T', qubits: [0] },
      ],
    })
    for (const q of [0, 1]) {
      const { x, y, z } = sv.blochVector(q)
      const r2 = x * x + y * y + z * z
      const info = qubitPhaseInfo(sv, q)
      expect(info.purity).toBeCloseTo((1 + r2) / 2, 12)
      expect(info.p1).toBeCloseTo((1 - z) / 2, 12)
    }
  })

  it('rejects out-of-range qubit indices instead of returning NaN', () => {
    const sv = new StateVector(2)
    expect(() => qubitPhaseInfo(sv, 2)).toThrow(/out of range/)
    expect(() => qubitPhaseInfo(sv, -1)).toThrow(/out of range/)
    expect(() => qubitPhaseInfo(sv, 0.5)).toThrow(/out of range/)
  })
})
