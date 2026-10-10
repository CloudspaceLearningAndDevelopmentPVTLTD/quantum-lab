/**
 * verify-equivalence.test.ts — compareCircuits() against hand-computed cases.
 *
 * A new file (not verify.test.ts) to avoid merge risk with other work
 * landing on that file in the same phase. Expected fidelities are worked
 * out by hand, never read back from the code under test.
 */

import { describe, expect, it } from 'vitest'
import type { Circuit } from '@/lib/quantum'
import { compareCircuits } from './verify'

describe('compareCircuits', () => {
  it('two H gates in a row is the identity: equivalent to an empty circuit, fidelity ~1', () => {
    const hh: Circuit = { numQubits: 1, ops: [{ name: 'H', qubits: [0] }, { name: 'H', qubits: [0] }] }
    const empty: Circuit = { numQubits: 1, ops: [] }
    const r = compareCircuits(hh, empty)
    expect(r.equivalent).toBe(true)
    expect(r.fidelity).toBeCloseTo(1, 9)
    expect(r.note).toBeUndefined()
  })

  it('H, H, X is equivalent to plain X (H*H = I)', () => {
    const hhx: Circuit = {
      numQubits: 1,
      ops: [{ name: 'H', qubits: [0] }, { name: 'H', qubits: [0] }, { name: 'X', qubits: [0] }],
    }
    const x: Circuit = { numQubits: 1, ops: [{ name: 'X', qubits: [0] }] }
    const r = compareCircuits(hhx, x)
    expect(r.equivalent).toBe(true)
    expect(r.fidelity).toBeCloseTo(1, 9)
    expect(r.note).toBeUndefined()
  })

  it('X vs Z are genuinely different: fidelity is exactly 0', () => {
    // X†Z = XZ (X is Hermitian) = [[0,1],[1,0]]·[[1,0],[0,-1]] = [[0,-1],[1,0]].
    // Trace = 0, so |Tr(X†Z)|²/d² = 0.
    const x: Circuit = { numQubits: 1, ops: [{ name: 'X', qubits: [0] }] }
    const z: Circuit = { numQubits: 1, ops: [{ name: 'Z', qubits: [0] }] }
    const r = compareCircuits(x, z)
    expect(r.fidelity).toBeCloseTo(0, 9)
    expect(r.equivalent).toBe(false)
    expect(r.note).toBeUndefined()
  })

  it('refuses mismatched qubit counts without crashing', () => {
    const one: Circuit = { numQubits: 1, ops: [{ name: 'X', qubits: [0] }] }
    const two: Circuit = { numQubits: 2, ops: [{ name: 'X', qubits: [0] }] }
    const r = compareCircuits(one, two)
    expect(r.equivalent).toBe(false)
    expect(r.fidelity).toBe(0)
    expect(r.note).toBe('circuits act on a different number of qubits')
  })

  it('refuses a circuit containing RESET rather than crashing, naming which side failed', () => {
    const withReset: Circuit = { numQubits: 1, ops: [{ name: 'RESET', qubits: [0] }] }
    const plain: Circuit = { numQubits: 1, ops: [{ name: 'X', qubits: [0] }] }

    const rA = compareCircuits(withReset, plain)
    expect(rA.equivalent).toBe(false)
    expect(rA.fidelity).toBe(0)
    expect(rA.note).toMatch(/^circuit A is not a bare unitary/)

    const rB = compareCircuits(plain, withReset)
    expect(rB.equivalent).toBe(false)
    expect(rB.fidelity).toBe(0)
    expect(rB.note).toMatch(/^circuit B is not a bare unitary/)
  })

  it('rejects circuits wider than the qubit cap instead of hanging on the computation', () => {
    const wide: Circuit = { numQubits: 11, ops: [] }
    const alsoWide: Circuit = { numQubits: 11, ops: [] }
    const r = compareCircuits(wide, alsoWide)
    expect(r.equivalent).toBe(false)
    expect(r.fidelity).toBe(0)
    expect(r.note).toMatch(/capped at 10 qubits/)
  })
})
