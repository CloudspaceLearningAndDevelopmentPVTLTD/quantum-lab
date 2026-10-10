import { describe, expect, it } from 'vitest'
import { circuitDepth, idealExpectation } from '@/lib/quantum/noise'
import { PRESETS, PRESET_BY_ID, gateCount } from './noiseCircuits'

/** Ideal values written from the physics of each circuit, not read back. */
describe('noise workbench presets', () => {
  it('Bell parity is +1 at odd depth and the state is |00⟩ at even depth', () => {
    const bell = PRESET_BY_ID.bell
    expect(idealExpectation(bell.build(1), { type: 'pauliZ', qubits: [0, 1] })).toBeCloseTo(1, 12)
    expect(idealExpectation(bell.build(1), { type: 'projector', index: 3 })).toBeCloseTo(0.5, 12)
    expect(idealExpectation(bell.build(2), { type: 'projector', index: 0 })).toBeCloseTo(1, 12)
    expect(idealExpectation(bell.build(3), { type: 'pauliZ', qubits: [0, 1] })).toBeCloseTo(1, 12)
  })

  it('GHZ pair parities are 1, the triple parity averages to 0, P(000) = ½', () => {
    const c = PRESET_BY_ID.ghz.build(1)
    expect(idealExpectation(c, { type: 'pauliZ', qubits: [0, 1] })).toBeCloseTo(1, 12)
    expect(idealExpectation(c, { type: 'pauliZ', qubits: [1, 2] })).toBeCloseTo(1, 12)
    expect(idealExpectation(c, { type: 'pauliZ', qubits: [0, 1, 2] })).toBeCloseTo(0, 12)
    expect(idealExpectation(c, { type: 'projector', index: 0 })).toBeCloseTo(0.5, 12)
    expect(idealExpectation(c, { type: 'pauliZ', qubits: [0] })).toBeCloseTo(0, 12)
  })

  it('X chain: ⟨Z⟩ = (−1)^depth', () => {
    for (const d of [1, 2, 7, 10]) {
      expect(idealExpectation(PRESET_BY_ID.xchain.build(d), { type: 'pauliZ', qubits: [0] })).toBeCloseTo((-1) ** d, 12)
    }
  })

  it('RY ladder at depth 1: ⟨Z₂⟩ = cos θ before the CX chain, and the chain flips by parity of the others', () => {
    // After RY(θ) on all three, then CX(0,1), CX(1,2): qubit 2 is flipped when
    // qubit 1 ⊕ qubit 0 = 1, so ⟨Z₂⟩ = cosθ · ⟨Z₀Z₁⟩_pre = cosθ · cos²θ.
    const theta = Math.PI / 7
    const c = PRESET_BY_ID.ladder.build(1)
    expect(idealExpectation(c, { type: 'pauliZ', qubits: [2] })).toBeCloseTo(Math.cos(theta) ** 3, 12)
  })

  it('two-qubit Grover finds |11⟩ with certainty', () => {
    expect(idealExpectation(PRESET_BY_ID.grover2.build(1), { type: 'projector', index: 3 })).toBeCloseTo(1, 12)
  })

  it('the idle probe schedules depth idle steps after the X', () => {
    const c = PRESET_BY_ID.idle.build(8)
    expect(circuitDepth(c)).toBe(9)
    expect(gateCount(c)).toBe(1)
    expect(idealExpectation(c, { type: 'projector', index: 1 })).toBe(1)
  })

  it('every preset builds a valid circuit across its depth range with a default inside it', () => {
    for (const p of PRESETS) {
      expect(p.defaultDepth).toBeGreaterThanOrEqual(p.minDepth)
      expect(p.defaultDepth).toBeLessThanOrEqual(p.maxDepth)
      for (const obs of p.observables) {
        for (const d of [p.minDepth, p.defaultDepth, p.maxDepth]) {
          const v = idealExpectation(p.build(d), obs.obs)
          expect(Number.isFinite(v)).toBe(true)
          expect(v).toBeGreaterThanOrEqual(-1 - 1e-12)
          expect(v).toBeLessThanOrEqual(1 + 1e-12)
        }
      }
    }
  })
})
