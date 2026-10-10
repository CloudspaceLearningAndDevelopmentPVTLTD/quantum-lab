import { describe, expect, it } from 'vitest'
import { BLOCH_GATES, KET_ONE, KET_ZERO, applyGate, probabilityOfOne, type Vec3 } from './blochGates'

// The home-page qubit claims "every move is the real rotation". These are the
// checks a physicist would do first; if any fails, the hero is lying.

const close = (a: Vec3, b: Vec3) => {
  for (let i = 0; i < 3; i++) expect(a[i]).toBeCloseTo(b[i], 10)
}

describe('single-qubit gates on the Bloch sphere', () => {
  it('H takes |0⟩ to |+⟩ (the +x point of the equator) and back', () => {
    const plus = applyGate(KET_ZERO, BLOCH_GATES.H)
    close(plus, [1, 0, 0])
    close(applyGate(plus, BLOCH_GATES.H), KET_ZERO)
    expect(probabilityOfOne(plus)).toBeCloseTo(0.5, 10)
  })

  it('X is the quantum NOT: |0⟩ ↔ |1⟩', () => {
    close(applyGate(KET_ZERO, BLOCH_GATES.X), KET_ONE)
    close(applyGate(KET_ONE, BLOCH_GATES.X), KET_ZERO)
    expect(probabilityOfOne(applyGate(KET_ZERO, BLOCH_GATES.X))).toBeCloseTo(1, 10)
  })

  it('Z never changes the measurement odds, only the phase', () => {
    const plus = applyGate(KET_ZERO, BLOCH_GATES.H)
    const minus = applyGate(plus, BLOCH_GATES.Z)
    close(minus, [-1, 0, 0])
    expect(probabilityOfOne(minus)).toBeCloseTo(probabilityOfOne(plus), 10)
    close(applyGate(KET_ZERO, BLOCH_GATES.Z), KET_ZERO)
  })

  it('S·S = Z, and S takes |+⟩ to |+i⟩', () => {
    const plus = applyGate(KET_ZERO, BLOCH_GATES.H)
    const plusI = applyGate(plus, BLOCH_GATES.S)
    close(plusI, [0, 1, 0])
    close(applyGate(plusI, BLOCH_GATES.S), applyGate(plus, BLOCH_GATES.Z))
  })

  it('every gate preserves the length of the state vector', () => {
    let v: Vec3 = KET_ZERO
    for (const g of [BLOCH_GATES.H, BLOCH_GATES.S, BLOCH_GATES.X, BLOCH_GATES.Y, BLOCH_GATES.Z, BLOCH_GATES.H]) {
      v = applyGate(v, g)
      expect(Math.hypot(...v)).toBeCloseTo(1, 10)
    }
  })

  it('H X H = Z (a classic identity), on an arbitrary state', () => {
    const v: Vec3 = [0.36, 0.48, 0.8]
    const lhs = applyGate(applyGate(applyGate(v, BLOCH_GATES.H), BLOCH_GATES.X), BLOCH_GATES.H)
    close(lhs, applyGate(v, BLOCH_GATES.Z))
  })
})
