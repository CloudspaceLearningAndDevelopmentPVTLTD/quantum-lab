import { describe, it, expect } from 'vitest'
import { simulate, type Circuit } from '../quantum'
import {
  parsePauliSum,
  pauliSumExpectation,
  statevectorCsv,
  statevectorJson,
  MAX_TERMS,
} from './pauli'

const bell: Circuit = { numQubits: 2, ops: [{ name: 'H', qubits: [0] }, { name: 'CX', qubits: [0, 1] }] }

function ev(circuit: Circuit, text: string): number {
  const parsed = parsePauliSum(text, circuit.numQubits)
  if (!parsed.ok) throw new Error(parsed.error)
  return pauliSumExpectation(simulate(circuit), parsed.terms).value
}

describe('pauliSumExpectation — analytic values', () => {
  it('Bell state: ⟨ZZ⟩ = ⟨XX⟩ = 1, ⟨YY⟩ = −1, single-qubit Paulis vanish', () => {
    expect(ev(bell, 'Z0 Z1')).toBeCloseTo(1, 12)
    expect(ev(bell, 'X0 X1')).toBeCloseTo(1, 12)
    expect(ev(bell, 'Y0 Y1')).toBeCloseTo(-1, 12)
    for (const p of ['X0', 'Y0', 'Z0', 'X1', 'Y1', 'Z1']) expect(ev(bell, p)).toBeCloseTo(0, 12)
  })

  it('|+i⟩ = S·H|0⟩ has ⟨Y⟩ = 1 (the Y sign convention)', () => {
    const c: Circuit = { numQubits: 1, ops: [{ name: 'H', qubits: [0] }, { name: 'S', qubits: [0] }] }
    expect(ev(c, 'Y0')).toBeCloseTo(1, 12)
    expect(ev(c, 'X0')).toBeCloseTo(0, 12)
  })

  it('|1⟩ on qubit 2 only: full-width labels read rightmost = qubit 0, like Qiskit', () => {
    const c: Circuit = { numQubits: 3, ops: [{ name: 'X', qubits: [2] }] }
    expect(ev(c, 'ZII')).toBeCloseTo(-1, 12) // Z on qubit 2
    expect(ev(c, 'IIZ')).toBeCloseTo(1, 12) // Z on qubit 0
    expect(ev(c, 'Z2')).toBeCloseTo(-1, 12)
  })

  it('coefficients, signs, identity and scientific notation combine linearly', () => {
    // ⟨2.5 − 0.5·Z0Z1 + 1e-1·X0X1 − Y0Y1⟩ on Bell = 2.5 − 0.5 + 0.1 + 1
    expect(ev(bell, '2.5 - 0.5*Z0 Z1 + 1e-1 X0X1 - Y0Y1')).toBeCloseTo(3.1, 12)
    expect(ev(bell, '-ZZ')).toBeCloseTo(-1, 12)
  })

  it('agrees with RY rotations: ⟨Z⟩ = cos θ, ⟨X⟩ = sin θ', () => {
    for (const theta of [0.3, 1.234, -2.9]) {
      const c: Circuit = { numQubits: 1, ops: [{ name: 'RY', qubits: [0], theta }] }
      expect(ev(c, 'Z0')).toBeCloseTo(Math.cos(theta), 12)
      expect(ev(c, 'X0')).toBeCloseTo(Math.sin(theta), 12)
    }
  })

  it('works at the 16-qubit ceiling: GHZ has ⟨Z_i Z_j⟩ = 1 and ⟨X^⊗16⟩ = 1', () => {
    const ops: Circuit['ops'] = [{ name: 'H', qubits: [0] }]
    for (let q = 1; q < 16; q++) ops.push({ name: 'CX', qubits: [0, q] })
    const ghz: Circuit = { numQubits: 16, ops }
    expect(ev(ghz, 'Z0 Z15')).toBeCloseTo(1, 12)
    expect(ev(ghz, 'X'.repeat(16))).toBeCloseTo(1, 12)
    expect(ev(ghz, 'Z7')).toBeCloseTo(0, 12)
  })
})

describe('parsePauliSum — refusals a researcher can act on', () => {
  it.each([
    ['', 'Enter an observable'],
    ['Z5', 'Qubit 5 does not exist'],
    ['Z0 Z0', 'appears twice'],
    ['ZZZ', 'has 3 letters'],
    ['Q0', 'Could not read'],
  ])('%j → %s', (text, message) => {
    const r = parsePauliSum(text, 2)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain(message)
  })

  it('caps the number of terms', () => {
    const r = parsePauliSum(Array.from({ length: MAX_TERMS + 1 }, () => 'Z0').join(' + '), 1)
    expect(r.ok).toBe(false)
  })
})

describe('statevector downloads', () => {
  it('CSV lists every basis state with Qiskit-order bitstrings and full-precision numbers', () => {
    const csv = statevectorCsv(simulate(bell)).trim().split('\n')
    expect(csv[0]).toContain('qubit 0 is the least significant bit')
    expect(csv[1]).toBe('index,bitstring,re,im,probability')
    expect(csv).toHaveLength(2 + 4)
    const [i3, label3, re3, , p3] = csv[5].split(',')
    expect([i3, label3]).toEqual(['3', '11'])
    expect(Number(re3)).toBeCloseTo(Math.SQRT1_2, 15)
    expect(Number(p3)).toBeCloseTo(0.5, 15)
  })

  it('JSON round-trips the amplitudes exactly and carries the QASM', () => {
    const state = simulate(bell)
    const parsed = JSON.parse(statevectorJson(state, 'OPENQASM 3.0;'))
    expect(parsed.format).toBe('qubit16-statevector/v1')
    expect(parsed.numQubits).toBe(2)
    expect(parsed.qasm).toBe('OPENQASM 3.0;')
    expect(parsed.amplitudes).toEqual(state.amplitudes().map((a) => [a.re, a.im]))
  })
})
