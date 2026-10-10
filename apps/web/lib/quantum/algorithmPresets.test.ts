/**
 * algorithmPresets.test.ts — every preset in ALGORITHM_PRESETS checked
 * against a hand-derived closed-form result, never just "it runs".
 *
 * Deutsch-Jozsa / Bernstein-Vazirani / Simon are checked with outcomeBranches()
 * against the literal measured bit string (not "some deterministic outcome").
 * Phase estimation is an exact worked example (θ/2π a 2-bit dyadic fraction)
 * with a perfectly sharp expected answer. HHL — see its own describe block —
 * is checked against a target amplitude vector worked out by hand. VQE and
 * QAOA are templates, so their tests check well-formedness and, for QAOA, an
 * independently-verified gate identity plus a measurable effect on the
 * output distribution.
 */

import { describe, it, expect } from 'vitest'
import {
  c,
  StateVector,
  simulate,
  outcomeBranches,
  outcomeProbabilities,
  type Circuit,
  type Complex,
} from '../quantum'
import { stateFidelity, circuitUnitary } from '../workbench/verify'
import {
  ALGORITHM_PRESETS,
  BERNSTEIN_VAZIRANI_SECRET,
  SIMON_SECRET,
  QPE_THETA,
  HHL_TIME,
  HHL_C,
  QAOA_EDGES,
  _internal,
} from './algorithmPresets'

const near = (a: number, b: number, digits = 9) => expect(a).toBeCloseTo(b, digits)

function presetCircuit(id: string): Circuit {
  const preset = ALGORITHM_PRESETS.find((p) => p.id === id)
  if (!preset) throw new Error(`no such preset: ${id}`)
  return preset.circuit
}

// ────────────────────────────────────────────────────────────
// 1. Deutsch-Jozsa
// ────────────────────────────────────────────────────────────

describe('Deutsch-Jozsa', () => {
  it('constant oracle: the 3 input qubits read |000> with probability 1', () => {
    const circuit = presetCircuit('deutsch-jozsa-constant')
    const branches = outcomeBranches(circuit)
    expect(branches).toHaveLength(1)
    near(branches[0].probability, 1)
    expect(branches[0].clbits).toEqual([0, 0, 0])

    // Redundant check via the input-qubit marginal on the full statevector.
    const probs = outcomeProbabilities(circuit)
    let p000 = 0
    for (let i = 0; i < probs.length; i++) if ((i & 0b111) === 0) p000 += probs[i]
    near(p000, 1)
  })

  it('balanced oracle (parity): the input register never reads |000>, exactly 0 probability', () => {
    const circuit = presetCircuit('deutsch-jozsa-balanced')
    const branches = outcomeBranches(circuit)
    expect(branches).toHaveLength(1)
    near(branches[0].probability, 1)
    // The balanced oracle here is CX from every input to the ancilla — the
    // same construction as Bernstein-Vazirani with s = 111 — so the
    // deterministic readout is exactly 111, not merely "not 000".
    expect(branches[0].clbits).toEqual([1, 1, 1])

    const probs = outcomeProbabilities(circuit)
    let p000 = 0
    for (let i = 0; i < probs.length; i++) if ((i & 0b111) === 0) p000 += probs[i]
    near(p000, 0)
  })
})

// ────────────────────────────────────────────────────────────
// 2. Bernstein-Vazirani
// ────────────────────────────────────────────────────────────

describe('Bernstein-Vazirani', () => {
  it('recovers the literal hidden string s=101 in one query, probability 1', () => {
    const circuit = presetCircuit('bernstein-vazirani')
    const branches = outcomeBranches(circuit)
    expect(branches).toHaveLength(1)
    near(branches[0].probability, 1)
    expect(branches[0].clbits).toEqual([...BERNSTEIN_VAZIRANI_SECRET])
    expect(branches[0].clbits).toEqual([1, 0, 1])
  })
})

// ────────────────────────────────────────────────────────────
// 3. Simon's algorithm
// ────────────────────────────────────────────────────────────

describe("Simon's algorithm", () => {
  it('oracle alone reproduces the hand-derived truth table on all 4 computational-basis inputs', () => {
    // f(00)=00, f(01)=01, f(10)=01, f(11)=00 — verified by hand in the spec:
    // f(x) = x0 XOR x1 on output qubit q2 only (q3 stays 0).
    const table: Record<string, [number, number]> = {
      '00': [0, 0],
      '01': [1, 0],
      '10': [1, 0],
      '11': [0, 0],
    }
    for (const [key, [o2, o3]] of Object.entries(table)) {
      const x0 = Number(key[0]), x1 = Number(key[1])
      const sv = new StateVector(4)
      if (x0 === 1) sv.applySingle('X', 0)
      if (x1 === 1) sv.applySingle('X', 1)
      for (const op of _internal.simonOracleOps()) sv.apply(op)
      expect(sv.qubitProbability(2)).toBeCloseTo(o2, 9)
      expect(sv.qubitProbability(3)).toBeCloseTo(o3, 9)
    }
    // 2-to-1 promise for s=11: 00 XOR 11 = 11 (f(00)=f(11)=00), 01 XOR 11 = 10
    // (f(01)=f(10)=01) — exactly the pairing the truth table above shows.
    expect(0 ^ 0b11).toBe(0b11)
    expect(0b01 ^ 0b11).toBe(0b10)
  })

  it('every measured y is orthogonal to the secret s=11 (y.s = 0 mod 2), checked on EVERY branch', () => {
    const circuit = presetCircuit('simon')
    const branches = outcomeBranches(circuit)
    expect(branches.length).toBeGreaterThan(0)
    const [s0, s1] = SIMON_SECRET
    for (const b of branches) {
      const [y0, y1] = b.clbits
      const dot = ((y0 & s0) ^ (y1 & s1)) as 0 | 1
      expect(dot).toBe(0)
    }
    // For s=11 the only y satisfying y.s=0 are 00 and 11, each probability 1/2.
    expect(branches).toHaveLength(2)
    const byKey = new Map(branches.map((b) => [b.clbits.join(''), b.probability]))
    near(byKey.get('00') ?? 0, 0.5)
    near(byKey.get('11') ?? 0, 0.5)
    expect(byKey.has('10') || byKey.has('01')).toBe(false)
  })
})

// ────────────────────────────────────────────────────────────
// 4. Quantum phase estimation
// ────────────────────────────────────────────────────────────

describe('Quantum phase estimation (exact 2-bit example)', () => {
  it('theta/2*pi = 3/4 exactly, a 2-bit dyadic fraction', () => {
    near(QPE_THETA / (2 * Math.PI), 0.75, 12)
  })

  it('the 2-qubit ancilla register reads the exact integer 3 with probability 1', () => {
    const circuit = presetCircuit('phase-estimation')
    const branches = outcomeBranches(circuit)
    expect(branches).toHaveLength(1)
    near(branches[0].probability, 1)
    const k = branches[0].clbits[0] + 2 * branches[0].clbits[1] // q0 = LSB, q1 = MSB
    expect(k).toBe(3)

    // Redundant check on the full statevector's ancilla marginal.
    const probs = outcomeProbabilities(circuit)
    let p3 = 0
    for (let i = 0; i < probs.length; i++) if ((i & 0b11) === 0b11) p3 += probs[i]
    near(p3, 1)
  })
})

// ────────────────────────────────────────────────────────────
// 5. HHL — the exact worked example (A = diag(1,3), b = |+>, t = pi/2)
// ────────────────────────────────────────────────────────────
//
// Hand derivation (walked through step by step, so a numeric failure here
// points at a specific step rather than "somewhere"):
//
//   Initial: (1/2)(|0>+|1>)_q0 (|0>+|1>)_q1 * (1/sqrt(2))(|0>+|1>)_q2 * |0>_q3
//   After H,H and the two controlled diagonal evolutions (phase kickback,
//   eigenvalue lambda_b in {1, 3} for q2 basis state b in {0, 1}):
//     (1/(2*sqrt(2))) * sum_{a0,a1,b} e^{i*lambda_b*t*(a0 + 2*a1)} |a0>|a1>|b>|0>
//   which is exactly a QPE state with phase phi_b = lambda_b*t/(2*pi):
//   phi_0 = 1*(pi/2)/(2*pi) = 1/4 -> k_0 = 1 (dyadic exact);
//   phi_1 = 3*(pi/2)/(2*pi) = 3/4 -> k_1 = 3 (dyadic exact).
//   After IQFT: (1/sqrt(2)) |k=1>|b=0>|0> + (1/sqrt(2)) |k=3>|b=1>|0>
//             = (1/sqrt(2)) |1,0>|0>|0> + (1/sqrt(2)) |1,1>|1>|0>   (q0=LSB, q1=MSB)
//   Controlled RY(2*asin(C/1)=pi) fires on the k=1 term only (q0=1,q1=0-anti):
//     RY(pi)|0> = |1>, so that term becomes (1/sqrt(2)) |1,0>|0>|1>
//   Controlled RY(2*asin(C/3)) fires on the k=3 term only (q0=1,q1=1):
//     RY(2asin(1/3))|0> = cos(asin(1/3))|0> + sin(asin(1/3))|1>
//                       = (2*sqrt(2)/3)|0> + (1/3)|1>
//     so that term becomes (1/sqrt(2))(2*sqrt(2)/3)|1,1>|1>|0> + (1/sqrt(2))(1/3)|1,1>|1>|1>
//   The uncompute is the exact inverse isometry (same lambda_b-dependent
//   phase, same registers, run backwards), so it returns q0,q1 to |00>
//   REGARDLESS of q3's entanglement — the argument the code comment on
//   buildHHL/HHL_SHIPPED spells out: V|00>|b> = |k_b>|b>, so V^-1|k_b>|b> =
//   |00>|b> for every b independently, and the rotation on q3 never touched
//   q0/q1. So after uncompute:
//     (1/sqrt(2)) |0,0>|0>|1>  +  (1/sqrt(2))(2*sqrt(2)/3) |0,0>|1>|0>  +  (1/sqrt(2))(1/3) |0,0>|1>|1>
//   Postselect q3=1 keeps the 1st and 3rd terms:
//     amplitude(q2=0) = 1/sqrt(2),  amplitude(q2=1) = (1/sqrt(2))(1/3) = 1/(3*sqrt(2))
//   norm^2 = 1/2 + 1/18 = 9/18 + 1/18 = 10/18 = 5/9  ->  norm = sqrt(5)/3
//   normalized: q2=0 -> (1/sqrt(2))/(sqrt(5)/3) = 3/sqrt(10)
//               q2=1 -> (1/(3*sqrt(2)))/(sqrt(5)/3) = 1/sqrt(10)
//   which is EXACTLY x = A^-1 b normalized = (3|0> + |1>)/sqrt(10). No
//   approximation anywhere in this derivation — every angle and phase above
//   is exact — so a fidelity below ~1 on the numeric run means the code does
//   not match this derivation, not that the derivation needs a looser bound.

describe('HHL (A = diag(1,3), b = |+>, t = pi/2)', () => {
  it('classical target: A^-1 b normalized is exactly [3/sqrt(10), 1/sqrt(10)]', () => {
    // A^-1 b = diag(1, 1/3) * (1,1)/sqrt(2) = (1, 1/3)/sqrt(2), un-normalized
    // norm = sqrt(1 + 1/9)/sqrt(2) = (sqrt(10)/3)/sqrt(2). Normalizing (1,
    // 1/3) directly: norm = sqrt(10)/3, so (1,1/3)/(sqrt(10)/3) = (3,1)/sqrt(10).
    const target = [3 / Math.sqrt(10), 1 / Math.sqrt(10)]
    near(target[0] * target[0] + target[1] * target[1], 1)
    near(target[0] / target[1], 3)
  })

  it('the eigenphases are exact 2-bit dyadic fractions: 1/4 (eigenvalue 1) and 3/4 (eigenvalue 3)', () => {
    near((1 * HHL_TIME) / (2 * Math.PI), 0.25, 12)
    near((3 * HHL_TIME) / (2 * Math.PI), 0.75, 12)
    near(HHL_C, 1)
  })

  it('the QPE register uncomputes to exactly |00> across every surviving branch, then q2 matches the target to fidelity >= 0.999999', () => {
    const circuit = _internal.buildHHL()
    const branches = outcomeBranches(circuit)
    // POSTSELECT (the only branching op here) keeps exactly one branch.
    expect(branches).toHaveLength(1)
    near(branches[0].probability, 1)
    const state = branches[0].state

    // Internal consistency check FIRST, per the spec: the QPE register must
    // have uncomputed to |00> with probability 1, independent of q2/q3.
    near(state.qubitProbability(0), 0, 9)
    near(state.qubitProbability(1), 0, 9)

    // q3 was postselected to 1: the state exists only in the q0=0,q1=0,q3=1
    // subspace. Read q2's two amplitudes directly out of that subspace.
    const amp0 = state.amplitude(0b1000) // q0=0,q1=0,q2=0,q3=1
    const amp1 = state.amplitude(0b1100) // q0=0,q1=0,q2=1,q3=1
    const actual: Complex[] = [amp0, amp1]
    const target: Complex[] = [c(3 / Math.sqrt(10)), c(1 / Math.sqrt(10))]

    const fidelity = stateFidelity(target, actual)
    expect(fidelity).toBeGreaterThanOrEqual(0.999999)
  })
})

// ────────────────────────────────────────────────────────────
// 6. VQE hardware-efficient ansatz
// ────────────────────────────────────────────────────────────

describe('VQE hardware-efficient ansatz', () => {
  it('the resulting state is normalized and genuinely entangled (entropy > 0.01)', () => {
    const circuit = presetCircuit('vqe-ansatz')
    const state = simulate(circuit)
    const totalP = state.probabilities().reduce((s, p) => s + p, 0)
    near(totalP, 1)
    expect(state.entanglementEntropy(0)).toBeGreaterThan(0.01)
  })
})

// ────────────────────────────────────────────────────────────
// 7. QAOA MaxCut ansatz on a 4-cycle
// ────────────────────────────────────────────────────────────

function maxCutCost(bitstring: number): number {
  let cost = 0
  for (const [i, j] of QAOA_EDGES) {
    const bi = (bitstring >> i) & 1
    const bj = (bitstring >> j) & 1
    if (bi !== bj) cost++
  }
  return cost
}

describe('QAOA MaxCut ansatz (4-cycle)', () => {
  it('PREREQUISITE: CX-RZ(2*gamma)-CX on 2 qubits is exactly e^{-i*gamma*Z(x)Z}, diag(e^-ig, e^ig, e^ig, e^-ig)', () => {
    const gamma = 0.37 // an arbitrary test angle, independent of QAOA_GAMMA
    const circuit: Circuit = { numQubits: 2, ops: _internal.costEdgeOps(0, 1, gamma) }
    const u = circuitUnitary(circuit)
    const expected: Complex[][] = [
      [c(Math.cos(-gamma), Math.sin(-gamma)), c(0), c(0), c(0)],
      [c(0), c(Math.cos(gamma), Math.sin(gamma)), c(0), c(0)],
      [c(0), c(0), c(Math.cos(gamma), Math.sin(gamma)), c(0)],
      [c(0), c(0), c(0), c(Math.cos(-gamma), Math.sin(-gamma))],
    ]
    for (let r = 0; r < 4; r++) {
      for (let col = 0; col < 4; col++) {
        expect(u[r][col].re).toBeCloseTo(expected[r][col].re, 9)
        expect(u[r][col].im).toBeCloseTo(expected[r][col].im, 9)
      }
    }
  })

  it('the final state is normalized', () => {
    const circuit = presetCircuit('qaoa-maxcut-4cycle')
    const state = simulate(circuit)
    near(state.probabilities().reduce((s, p) => s + p, 0), 1)
  })

  it('gamma=pi/8, beta=pi/6 measurably shift the MaxCut cost expectation away from the uniform baseline', () => {
    const circuit = presetCircuit('qaoa-maxcut-4cycle')
    const probs = outcomeProbabilities(circuit)
    let weightedCost = 0
    for (let i = 0; i < probs.length; i++) weightedCost += probs[i] * maxCutCost(i)

    let uniformCost = 0
    for (let i = 0; i < 16; i++) uniformCost += maxCutCost(i)
    uniformCost /= 16

    expect(Math.abs(weightedCost - uniformCost)).toBeGreaterThan(1e-6)
  })
})

// ────────────────────────────────────────────────────────────
// Sanity: every shipped preset is well-formed
// ────────────────────────────────────────────────────────────

describe('ALGORITHM_PRESETS', () => {
  it('every preset simulates without throwing and its ids are unique', () => {
    const ids = new Set<string>()
    for (const preset of ALGORITHM_PRESETS) {
      expect(ids.has(preset.id)).toBe(false)
      ids.add(preset.id)
      expect(() => outcomeBranches(preset.circuit)).not.toThrow()
    }
  })
})
