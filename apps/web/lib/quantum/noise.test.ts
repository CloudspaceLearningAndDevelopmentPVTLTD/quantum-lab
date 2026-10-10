import { describe, expect, it } from 'vitest'
import { StateVector, mulberry32, simulate, type Circuit } from '../quantum'
import {
  NOISELESS,
  amplitudeDampingKraus,
  applyAmplitudeDampingJump,
  applyDephasingJump,
  applyKrausTrajectory,
  applyReadoutError,
  circuitDepth,
  dephasingKraus,
  expectation,
  idealExpectation,
  krausBranchProbabilities,
  runNoisy,
  runTrajectory,
  scheduleLayers,
  validateNoiseModel,
  withIdleSteps,
  type NoiseModel,
} from './noise'

/**
 * Every expected number here is written down from the channel definitions —
 * the depolarising Kraus decomposition, the amplitude-damping exponential,
 * the readout confusion matrix — not read back from the engine.
 */

const model = (over: Partial<NoiseModel>): NoiseModel => ({ ...NOISELESS, readout: { ...NOISELESS.readout }, ...over })

/** Standard error of a binomial proportion, for tolerances. */
const binomialSe = (p: number, n: number) => Math.sqrt((p * (1 - p)) / n)

describe('zero noise reproduces the ideal engine', () => {
  const bell: Circuit = { numQubits: 2, ops: [{ name: 'H', qubits: [0] }, { name: 'CX', qubits: [0, 1] }] }
  const ghzRot: Circuit = {
    numQubits: 3,
    ops: [
      { name: 'H', qubits: [0] },
      { name: 'CX', qubits: [0, 1] },
      { name: 'CX', qubits: [1, 2] },
      { name: 'RY', qubits: [2], theta: 0.7 },
      { name: 'T', qubits: [0] },
      { name: 'CZ', qubits: [0, 2] },
    ],
  }

  it('one trajectory with NOISELESS equals simulate() bit for bit', () => {
    for (const c of [bell, ghzRot]) {
      const { state, events } = runTrajectory(c, NOISELESS, mulberry32(3))
      const ideal = simulate(c)
      expect(events).toBe(0)
      expect(Array.from(state.data)).toEqual(Array.from(ideal.data))
    }
  })

  it('runNoisy with NOISELESS has fidelity 1 and samples the ideal distribution', () => {
    const shots = 20000
    const r = runNoisy(ghzRot, NOISELESS, shots, 11)
    expect(r.fidelity).toBe(1)
    expect(r.meanEvents).toBe(0)
    const ideal = simulate(ghzRot).probabilities()
    let total = 0
    for (let i = 0; i < ideal.length; i++) {
      total += r.counts[i]
      expect(Math.abs(r.distribution[i] - ideal[i])).toBeLessThan(4 * binomialSe(Math.max(ideal[i], 0.01), shots) + 1e-3)
    }
    expect(total).toBe(shots)
  })

  it('ideal ZZ parity of a Bell pair is +1 and of |01⟩ is −1', () => {
    expect(idealExpectation(bell, { type: 'pauliZ', qubits: [0, 1] })).toBeCloseTo(1, 12)
    const flipped: Circuit = { numQubits: 2, ops: [{ name: 'X', qubits: [0] }] }
    expect(idealExpectation(flipped, { type: 'pauliZ', qubits: [0, 1] })).toBeCloseTo(-1, 12)
    expect(idealExpectation(flipped, { type: 'pauliZ', qubits: [1] })).toBeCloseTo(1, 12)
    expect(idealExpectation(flipped, { type: 'projector', index: 1 })).toBeCloseTo(1, 12)
  })
})

describe('depolarising after a single X gate', () => {
  /**
   * After X the qubit is |1⟩. With probability p one of X, Y, Z is applied
   * uniformly; X and Y flip the bit, Z does not. So P(1) = 1 − p + p/3 = 1 − 2p/3.
   */
  it.each([0.05, 0.2, 0.45])('P(1) = 1 − 2p/3 for p = %s', (p) => {
    const c: Circuit = { numQubits: 1, ops: [{ name: 'X', qubits: [0] }] }
    const shots = 40000
    const r = runNoisy(c, model({ depolarising1: p }), shots, 5)
    const expected = 1 - (2 * p) / 3
    expect(Math.abs(r.distribution[1] - expected)).toBeLessThan(4 * binomialSe(expected, shots))
    // Fidelity with |1⟩ is the same number: the state is |1⟩ unless X or Y fired.
    expect(Math.abs(r.fidelity - expected)).toBeLessThan(4 * binomialSe(expected, shots))
    // And the event rate is p.
    expect(Math.abs(r.meanEvents - p)).toBeLessThan(4 * binomialSe(p, shots))
  })

  it('two-qubit depolarising after CX on |00⟩: P(00) = 1 − 12p/15', () => {
    // Of the 15 non-identity two-qubit Paulis, only ZI, IZ and ZZ leave |00⟩
    // as |00⟩ (up to phase): 12 of 15 change the bitstring.
    const c: Circuit = { numQubits: 2, ops: [{ name: 'CX', qubits: [0, 1] }] }
    const p = 0.3
    const shots = 40000
    const r = runNoisy(c, model({ depolarising2: p }), shots, 8)
    const expected = 1 - (12 * p) / 15
    expect(Math.abs(r.distribution[0] - expected)).toBeLessThan(4 * binomialSe(expected, shots))
  })
})

describe('amplitude damping (T1)', () => {
  it('per-step jump probability from |1⟩ is exactly 1 − e^{−1/T1}', () => {
    const t1 = 12
    const sv = new StateVector(1).applySingle('X', 0)
    const probs = krausBranchProbabilities(sv, 0, amplitudeDampingKraus(1 - Math.exp(-1 / t1)))
    expect(probs[1]).toBeCloseTo(1 - Math.exp(-1 / t1), 12)
    expect(probs[0] + probs[1]).toBeCloseTo(1, 12)
  })

  it('a |0⟩ never jumps', () => {
    const sv = new StateVector(1)
    const probs = krausBranchProbabilities(sv, 0, amplitudeDampingKraus(0.5))
    expect(probs[1]).toBe(0)
  })

  it.each([1, 5, 15])('P(1) after %s idle steps is e^{−t/T1}', (t) => {
    const t1 = 10
    const c = withIdleSteps({ numQubits: 1, ops: [{ name: 'X', qubits: [0] }] }, t)
    expect(circuitDepth(c)).toBe(t + 1)
    const shots = 30000
    const r = runNoisy(c, model({ t1 }), shots, 21)
    const expected = Math.exp(-t / t1)
    expect(Math.abs(r.distribution[1] - expected)).toBeLessThan(4 * binomialSe(expected, shots))
  })

  it('a qubit inside a gate does not idle, so a chain of X gates never decays', () => {
    const c: Circuit = { numQubits: 1, ops: Array.from({ length: 9 }, () => ({ name: 'X' as const, qubits: [0] })) }
    const r = runNoisy(c, model({ t1: 2 }), 500, 1)
    expect(r.distribution[1]).toBe(1)
    expect(r.meanEvents).toBe(0)
  })
})

describe('in-place jumps agree with the Kraus path', () => {
  /** A generic entangled 2-qubit state to act on. */
  const prepared = () =>
    new StateVector(2).applySingle('H', 0).applyControlled('X', [0], 1).applySingle('RY', 1, 0.9).applySingle('T', 0)

  it.each([0, 1])('amplitude damping on qubit %s, both branches', (q) => {
    const gamma = 0.3
    const kraus = amplitudeDampingKraus(gamma)
    for (const branch of [0, 1]) {
      // Force the branch. The jump fires when u < pJump; the Kraus path walks
      // the cumulative branch probabilities, so branch 1 is u near 1.
      const a = prepared()
      const b = prepared()
      const jumped = applyAmplitudeDampingJump(a, q, gamma, () => (branch === 1 ? 0 : 0.999999))
      const chosen = applyKrausTrajectory(b, q, kraus, () => (branch === 1 ? 0.999999 : 0))
      expect(jumped).toBe(branch === 1)
      expect(chosen).toBe(branch)
      for (let i = 0; i < a.data.length; i++) expect(a.data[i]).toBeCloseTo(b.data[i], 12)
    }
  })

  it('dephasing jump is a Z; no jump is the identity', () => {
    const a = prepared()
    const z = prepared().applySingle('Z', 1)
    expect(applyDephasingJump(a, 1, 0.4, () => 0.1)).toBe(true)
    for (let i = 0; i < a.data.length; i++) expect(a.data[i]).toBeCloseTo(z.data[i], 12)
    const c = prepared()
    expect(applyDephasingJump(c, 1, 0.4, () => 0.9)).toBe(false)
    expect(Array.from(c.data)).toEqual(Array.from(prepared().data))
  })
})

describe('dephasing (T2)', () => {
  it('phase-flip Kraus set is complete', () => {
    const sv = new StateVector(1).applySingle('H', 0)
    const probs = krausBranchProbabilities(sv, 0, dephasingKraus(0.3))
    expect(probs[0]).toBeCloseTo(0.7, 12)
    expect(probs[1]).toBeCloseTo(0.3, 12)
  })

  it.each([2, 6])('⟨X⟩ of |+⟩ after %s idle steps is e^{−t/T2} when T1 = ∞', (t) => {
    // Measure X by rotating with H at the end; the H is a gate, not an idle step.
    const t2 = 8
    const c: Circuit = {
      numQubits: 1,
      ops: [{ name: 'H', qubits: [0] }, ...withIdleSteps({ numQubits: 1, ops: [] }, t).ops, { name: 'H', qubits: [0] }],
    }
    const shots = 30000
    const r = runNoisy(c, model({ t2 }), shots, 31)
    const ex = expectation(r.distribution, { type: 'pauliZ', qubits: [0] })
    const expected = Math.exp(-t / t2)
    // ⟨Z⟩ after H = ⟨X⟩ before it; var of ±1 is 1 − ⟨X⟩².
    expect(Math.abs(ex - expected)).toBeLessThan(4 * Math.sqrt((1 - expected ** 2) / shots) + 1e-3)
  })

  it('T2 is clamped to 2·T1 and unphysical rates throw', () => {
    expect(validateNoiseModel(model({ t1: 5, t2: 50 })).t2).toBe(10)
    expect(() => validateNoiseModel(model({ depolarising1: 1.2 }))).toThrow()
    expect(() => validateNoiseModel(model({ t1: 0 }))).toThrow()
  })
})

describe('readout confusion', () => {
  it('flips bits with the stated probabilities', () => {
    const rng = mulberry32(4)
    const n = 40000
    let ones = 0, zeros = 0
    for (let i = 0; i < n; i++) {
      // qubit 0 true 1, qubit 1 true 0
      const out = applyReadoutError(0b01, 2, { p1given0: 0.1, p0given1: 0.25 }, rng)
      if ((out & 1) === 0) zeros += 1
      if (out & 2) ones += 1
    }
    expect(Math.abs(zeros / n - 0.25)).toBeLessThan(4 * binomialSe(0.25, n))
    expect(Math.abs(ones / n - 0.1)).toBeLessThan(4 * binomialSe(0.1, n))
  })

  it('applies the 2×2 confusion matrix to an ideal |1⟩', () => {
    const c: Circuit = { numQubits: 1, ops: [{ name: 'X', qubits: [0] }] }
    const shots = 40000
    const r = runNoisy(c, model({ readout: { p1given0: 0.02, p0given1: 0.08 } }), shots, 9)
    expect(Math.abs(r.distribution[1] - 0.92)).toBeLessThan(4 * binomialSe(0.92, shots))
    // Readout is not a property of the state.
    expect(r.fidelity).toBe(1)
  })
})

describe('scheduling', () => {
  it('ASAP layers, idle qubits, explicit idle barriers', () => {
    const c: Circuit = {
      numQubits: 3,
      ops: [
        { name: 'H', qubits: [0] },
        { name: 'H', qubits: [1] },
        { name: 'CX', qubits: [0, 1] },
        { name: 'X', qubits: [2] },
        { name: 'BARRIER', qubits: [] },
        { name: 'MEASURE', qubits: [0] },
      ],
    }
    const layers = scheduleLayers(c)
    expect(layers.map((l) => l.ops.map((o) => o.name))).toEqual([['H', 'H', 'X'], ['CX'], ['BARRIER']])
    expect(layers.map((l) => l.idle)).toEqual([[], [2], [0, 1, 2]])
  })
})
