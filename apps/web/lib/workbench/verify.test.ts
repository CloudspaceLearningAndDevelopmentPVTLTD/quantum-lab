/**
 * verify.test.ts — the verifier against hand-computed cases.
 *
 * Every expected number here is worked out by hand (or is a textbook fact),
 * never read back from the code under test: a Bell state is exactly 50/50
 * on 00 and 11, an X-only circuit puts 100% on one basis state, a Y and an
 * X differ by a global phase of i, and three CX gates are a SWAP.
 */

import { describe, expect, it } from 'vitest'
import type { Circuit } from '@/lib/quantum'
import {
  circuitDepth,
  circuitUnitary,
  formatDiagnostics,
  processFidelity,
  validateSpec,
  verify,
  type CircuitSpec,
} from './verify'
import { presetById } from './specs'

const bellSpec = presetById('bell')!.spec
const BELL: Circuit = { numQubits: 2, ops: [{ name: 'H', qubits: [0] }, { name: 'CX', qubits: [0, 1] }] }
const X_ONLY: Circuit = { numQubits: 2, ops: [{ name: 'X', qubits: [0] }] }

describe('verify — distribution specs', () => {
  it('passes a Bell circuit against the Bell spec with score 1', () => {
    const r = verify(BELL, bellSpec)
    expect(r.pass).toBe(true)
    expect(r.score).toBeCloseTo(1, 12)
    expect(r.stateDeviations).toEqual([])
    expect(r.metrics).toEqual({ numQubits: 2, gateCount: 2, twoQubitGates: 1, depth: 2 })
    expect(r.summary).toMatch(/^Pass/)
  })

  it('fails an X-only circuit against the Bell spec and names the states that are off', () => {
    const r = verify(X_ONLY, bellSpec)
    expect(r.pass).toBe(false)
    // X on q0 gives |01⟩ (label MSB-first) with certainty.
    // Deviations: 00 short by 0.5, 11 short by 0.5, 01 over by 1.
    const byLabel = Object.fromEntries(r.stateDeviations.map((d) => [d.label, d]))
    expect(byLabel['01'].delta).toBeCloseTo(1, 12)
    expect(byLabel['00'].delta).toBeCloseTo(-0.5, 12)
    expect(byLabel['11'].delta).toBeCloseTo(-0.5, 12)
    expect(byLabel['10']).toBeUndefined()
    // Sorted worst first.
    expect(r.stateDeviations[0].label).toBe('01')
    // Total variation distance is (1 + 0.5 + 0.5)/2 = 1.
    expect(r.score).toBeCloseTo(0, 12)
    const err = r.diagnostics.find((d) => d.code === 'distribution_off')
    expect(err?.message).toContain('|01⟩ target 0.0% got 100.0%')
    expect(err?.message).toContain('|00⟩ target 50.0% got 0.0%')
    expect(formatDiagnostics(r)).toContain('[error]')
  })

  it('accepts a circuit inside tolerance and rejects one outside it', () => {
    // RY(θ) on one qubit: P(1) = sin²(θ/2). Target 0.5 with tolerance 0.02.
    const spec: CircuitSpec = {
      numQubits: 1,
      target: { kind: 'distribution', probabilities: { '0': 0.5, '1': 0.5 }, tolerance: 0.02 },
    }
    // sin²(θ/2) = 0.51 → θ = 2·asin(√0.51)
    const near: Circuit = { numQubits: 1, ops: [{ name: 'RY', qubits: [0], theta: 2 * Math.asin(Math.sqrt(0.51)) }] }
    const far: Circuit = { numQubits: 1, ops: [{ name: 'RY', qubits: [0], theta: 2 * Math.asin(Math.sqrt(0.55)) }] }
    expect(verify(near, spec).pass).toBe(true)
    const r = verify(far, spec)
    expect(r.pass).toBe(false)
    // Both states are off by 0.05 in opposite directions.
    const one = r.stateDeviations.find((d) => d.label === '1')
    const zero = r.stateDeviations.find((d) => d.label === '0')
    expect(one?.delta).toBeCloseTo(0.05, 9)
    expect(zero?.delta).toBeCloseTo(-0.05, 9)
    expect(r.score).toBeCloseTo(0.95, 9)
  })

  it('uses the exact mixture for circuits with recorded measurements', () => {
    // Measure q0 of a Bell pair into c0 — the histogram is still 50/50 on 00/11.
    const measured: Circuit = {
      numQubits: 2,
      ops: [...BELL.ops, { name: 'MEASURE', qubits: [0], clbit: 0 }],
    }
    expect(verify(measured, bellSpec).pass).toBe(true)
  })

  it('rejects the wrong register width with a diagnostic, not a throw', () => {
    const r = verify({ numQubits: 3, ops: [{ name: 'H', qubits: [0] }] }, bellSpec)
    expect(r.pass).toBe(false)
    expect(r.diagnostics.some((d) => d.code === 'too_many_qubits')).toBe(true)
  })

  it('turns a simulator error into a diagnostic', () => {
    const r = verify({ numQubits: 2, ops: [{ name: 'CX', qubits: [0, 0] }] }, bellSpec)
    expect(r.pass).toBe(false)
    expect(r.diagnostics[0].code).toBe('simulation_failed')
    expect(r.diagnostics[0].message).toMatch(/same qubit twice/)
  })
})

describe('verify — constraints', () => {
  it('fails right physics with a disallowed gate and says which', () => {
    const ghz = presetById('ghz')!.spec // allowed: H, CX; maxGates 5
    const withCz: Circuit = {
      numQubits: 3,
      ops: [
        { name: 'H', qubits: [0] },
        { name: 'CX', qubits: [0, 1] },
        // CZ + H·H around it is a CX — right physics, wrong gate set.
        { name: 'H', qubits: [2] },
        { name: 'CZ', qubits: [1, 2] },
        { name: 'H', qubits: [2] },
      ],
    }
    const r = verify(withCz, ghz)
    expect(r.score).toBeCloseTo(1, 12)
    expect(r.pass).toBe(false)
    const d = r.diagnostics.find((x) => x.code === 'gate_not_allowed')
    expect(d?.message).toContain('CZ×1')
    expect(r.summary).toMatch(/right physics/)
  })

  it('enforces depth and gate count', () => {
    const uniform = presetById('uniform')!.spec // maxDepth 1
    const parallel: Circuit = { numQubits: 3, ops: [0, 1, 2].map((q) => ({ name: 'H' as const, qubits: [q] })) }
    expect(verify(parallel, uniform).pass).toBe(true)
    // Same physics, but H·H·H on one wire is depth 3 — and identity, so wrong physics too.
    // Use Z between: H, then Z on q0 twice (identity), then still depth 3 on q0.
    const deep: Circuit = {
      numQubits: 3,
      ops: [
        { name: 'H', qubits: [0] },
        { name: 'Z', qubits: [0] },
        { name: 'Z', qubits: [0] },
        { name: 'H', qubits: [1] },
        { name: 'H', qubits: [2] },
      ],
    }
    expect(circuitDepth(deep)).toBe(3)
    const r = verify(deep, uniform)
    expect(r.score).toBeCloseTo(1, 12)
    expect(r.pass).toBe(false)
    expect(r.diagnostics.some((d) => d.code === 'depth_exceeded')).toBe(true)

    const bell5: Circuit = { numQubits: 2, ops: [...BELL.ops, ...Array(3).fill({ name: 'Z', qubits: [1] })] }
    const g = verify(bell5, bellSpec) // maxGates 4
    expect(g.diagnostics.some((d) => d.code === 'gate_count_exceeded')).toBe(true)
  })
})

describe('verify — statevector specs (global phase ignored)', () => {
  it('X and Y both prepare |1⟩ up to the global phase i', () => {
    const spec: CircuitSpec = { numQubits: 1, target: { kind: 'statevector', amplitudes: [0, 1] } }
    expect(verify({ numQubits: 1, ops: [{ name: 'X', qubits: [0] }] }, spec).fidelity).toBeCloseTo(1, 12)
    const y = verify({ numQubits: 1, ops: [{ name: 'Y', qubits: [0] }] }, spec)
    expect(y.pass).toBe(true)
    expect(y.fidelity).toBeCloseTo(1, 12)
    expect(y.amplitudeDeviations).toEqual([])
  })

  it('distinguishes |−⟩ from |+⟩ by relative phase and says so', () => {
    const spec = presetById('plus-minus')!.spec // |−⟩ on q1, |+⟩ on q0
    const right: Circuit = {
      numQubits: 2,
      ops: [{ name: 'H', qubits: [0] }, { name: 'X', qubits: [1] }, { name: 'H', qubits: [1] }],
    }
    expect(verify(right, spec).pass).toBe(true)
    const wrong: Circuit = { numQubits: 2, ops: [{ name: 'H', qubits: [0] }, { name: 'H', qubits: [1] }] }
    const r = verify(wrong, spec)
    expect(r.pass).toBe(false)
    // |⟨−|+⟩|² = 0 → fidelity 0.
    expect(r.fidelity).toBeCloseTo(0, 12)
    expect(r.stateDeviations).toEqual([]) // probabilities are identical
    expect(r.amplitudeDeviations.length).toBeGreaterThan(0)
    expect(r.diagnostics.find((d) => d.code === 'fidelity_low')?.message).toMatch(/RELATIVE phases/)
  })

  it('computes |⟨t|ψ⟩|² for a partial overlap', () => {
    // Target |0⟩, circuit RY(θ) → cos²(θ/2). θ = π/3 → 0.75.
    const spec: CircuitSpec = { numQubits: 1, target: { kind: 'statevector', amplitudes: [1, 0], minFidelity: 0.9 } }
    const r = verify({ numQubits: 1, ops: [{ name: 'RY', qubits: [0], theta: Math.PI / 3 }] }, spec)
    expect(r.fidelity).toBeCloseTo(0.75, 12)
    expect(r.pass).toBe(false)
  })

  it('refuses a circuit with classical control for a state spec', () => {
    const spec: CircuitSpec = { numQubits: 1, target: { kind: 'statevector', amplitudes: [0, 1] } }
    const r = verify({ numQubits: 1, ops: [{ name: 'X', qubits: [0] }, { name: 'MEASURE', qubits: [0], clbit: 0 }] }, spec)
    expect(r.pass).toBe(false)
    expect(r.diagnostics[0].code).toBe('not_unitary')
  })
})

describe('verify — unitary specs (global phase ignored)', () => {
  const swapSpec = presetById('swap-from-cx')!.spec

  it('three CX gates are a SWAP; the SWAP gate itself violates the gate constraint', () => {
    const cx3: Circuit = {
      numQubits: 2,
      ops: [{ name: 'CX', qubits: [0, 1] }, { name: 'CX', qubits: [1, 0] }, { name: 'CX', qubits: [0, 1] }],
    }
    const r = verify(cx3, swapSpec)
    expect(r.pass).toBe(true)
    expect(r.fidelity).toBeCloseTo(1, 12)
    const s = verify({ numQubits: 2, ops: [{ name: 'SWAP', qubits: [0, 1] }] }, swapSpec)
    expect(s.fidelity).toBeCloseTo(1, 12)
    expect(s.pass).toBe(false)
    expect(s.diagnostics.some((d) => d.code === 'gate_not_allowed')).toBe(true)
  })

  it('two CX gates are not a SWAP, and the diagnostics name the failing inputs', () => {
    const cx2: Circuit = { numQubits: 2, ops: [{ name: 'CX', qubits: [0, 1] }, { name: 'CX', qubits: [1, 0] }] }
    const r = verify(cx2, swapSpec)
    expect(r.pass).toBe(false)
    // CX(0,1)·CX(1,0): |00⟩→|00⟩, |01⟩(q0=1)→ CX01 → |11⟩ → CX10 → |10⟩ ✓ swap,
    // |10⟩(q1=1) → CX01 no-op → CX10 → |11⟩ ✗ (swap wants |01⟩), |11⟩ → |10⟩ → |01⟩ ✗.
    // Tr(V†U) = 2 (two matching columns) → fidelity 4/16 = 0.25.
    expect(r.fidelity).toBeCloseTo(0.25, 12)
    const msg = r.diagnostics.find((d) => d.code === 'fidelity_low')?.message ?? ''
    expect(msg).toContain('|10⟩')
    expect(msg).toContain('|11⟩')
    expect(msg).not.toMatch(/\|01⟩, \|/) // |01⟩ column is right
  })

  it('a global phase on the whole unitary does not cost fidelity', () => {
    // Z·X = -X·Z... simpler: RZ(2π) = -I. Target: identity. Circuit: RZ(2π).
    const spec: CircuitSpec = { numQubits: 1, target: { kind: 'unitary', matrix: [[1, 0], [0, 1]] } }
    const r = verify({ numQubits: 1, ops: [{ name: 'RZ', qubits: [0], theta: 2 * Math.PI }] }, spec)
    expect(r.fidelity).toBeCloseTo(1, 12)
    expect(r.pass).toBe(true)
    // …while RZ(π) = diag(-i, i) is a Z up to phase, not identity: |Tr(Z)|²/4 = 0.
    const z = verify({ numQubits: 1, ops: [{ name: 'RZ', qubits: [0], theta: Math.PI }] }, spec)
    expect(z.fidelity).toBeCloseTo(0, 12)
  })

  it('circuitUnitary reproduces the CX matrix in the LSB-first convention', () => {
    const u = circuitUnitary({ numQubits: 2, ops: [{ name: 'CX', qubits: [0, 1] }] })
    // control q0 (bit 0), target q1 (bit 1): swaps indices 1 (01) and 3 (11).
    const re = u.map((row) => row.map((z) => Math.round(z.re)))
    expect(re).toEqual([
      [1, 0, 0, 0],
      [0, 0, 0, 1],
      [0, 0, 1, 0],
      [0, 1, 0, 0],
    ])
    expect(processFidelity(u, u)).toBeCloseTo(1, 12)
  })
})

describe('validateSpec', () => {
  it('accepts every preset', () => {
    for (const id of ['bell', 'ghz', 'uniform', 'swap-from-cx', 'plus-minus', 'custom']) {
      const v = validateSpec(JSON.parse(JSON.stringify(presetById(id)!.spec)))
      expect(v.ok, id).toBe(true)
    }
  })

  it('reports every problem at once', () => {
    const v = validateSpec({
      numQubits: 2,
      target: { kind: 'distribution', probabilities: { '000': 0.5, '11': 0.6 } },
      constraints: { allowedGates: ['H', 'FOO'], maxDepth: 0 },
    })
    expect(v.ok).toBe(false)
    if (v.ok) return
    expect(v.errors.join('\n')).toMatch(/"000" is not a 2-character/)
    expect(v.errors.join('\n')).toMatch(/FOO/)
    expect(v.errors.join('\n')).toMatch(/maxDepth/)
  })

  it('rejects a non-unitary matrix and a distribution that does not sum to 1', () => {
    const m = validateSpec({ numQubits: 1, target: { kind: 'unitary', matrix: [[1, 1], [0, 1]] } })
    expect(m.ok).toBe(false)
    if (!m.ok) expect(m.errors[0]).toMatch(/not unitary/)
    const d = validateSpec({ numQubits: 1, target: { kind: 'distribution', probabilities: { '0': 0.5, '1': 0.3 } } })
    expect(d.ok).toBe(false)
    if (!d.ok) expect(d.errors[0]).toMatch(/sum to 0.8000/)
  })
})
