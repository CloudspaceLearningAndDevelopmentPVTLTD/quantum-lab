/**
 * quantum.qasm-extended.test.ts — every wave-2 gate survives toQasm → fromQasm
 * with its op list AND its physics intact.
 *
 * Wave 1 found a classical-control export that no parser accepted; the lesson
 * is that "the QASM looks right" is not a test. So every gate here is checked
 * three ways: the op list deep-equals after the trip, the statevector is
 * identical, and the text uses the OpenQASM 3 construct it claims to (a
 * `gate` definition that another tool can run, a `ctrl(n) @` modifier, a
 * stdgates name).
 */

import { describe, it, expect } from 'vitest'
import {
  fromQasm,
  simulate,
  toQasm,
  type Circuit,
  type Complex,
  type GateOp,
} from './quantum'
import { parseComplexEntry, MATRIX_PRESETS } from './quantum/gates-extended'

const c = (re: number, im = 0): Complex => ({ re, im })

function expectRoundTrip(circuit: Circuit): Circuit {
  const qasm = toQasm(circuit)
  const back = fromQasm(qasm)
  expect(back.numQubits).toBe(circuit.numQubits)
  expect(back.ops).toEqual(circuit.ops)
  const before = simulate(circuit).amplitudes()
  const after = simulate(back).amplitudes()
  expect(after).toEqual(before)
  return back
}

const H: Complex[] = [c(Math.SQRT1_2), c(Math.SQRT1_2), c(Math.SQRT1_2), c(-Math.SQRT1_2)]
const iswap = MATRIX_PRESETS.find((p) => p.id === 'iswap')!.entries.map((e) => parseComplexEntry(e)!)

describe('QASM round trip — extended gate set', () => {
  it('√X and √X† use the stdgates name and a definition for sxdg, emitted once', () => {
    const circuit: Circuit = {
      numQubits: 2,
      ops: [
        { name: 'SX', qubits: [0] },
        { name: 'SXDG', qubits: [1] },
        { name: 'SXDG', qubits: [0] },
        { name: 'SX', qubits: [1] },
      ],
    }
    const qasm = toQasm(circuit)
    expect(qasm).toContain('sx q[0];')
    expect(qasm).toContain('sxdg q[1];')
    expect(qasm.match(/^gate sxdg /gm)).toHaveLength(1)
    // The definition comes before its first use.
    expect(qasm.indexOf('gate sxdg')).toBeLessThan(qasm.indexOf('sxdg q[1]'))
    expectRoundTrip(circuit)
  })

  it('CSWAP is the stdgates cswap', () => {
    const circuit: Circuit = {
      numQubits: 3,
      ops: [{ name: 'H', qubits: [0] }, { name: 'X', qubits: [1] }, { name: 'CSWAP', qubits: [0, 1, 2] }],
    }
    expect(toQasm(circuit)).toContain('cswap q[0], q[1], q[2];')
    expectRoundTrip(circuit)
  })

  it('MCX is written with the ctrl(n) @ modifier and read back with any control count', () => {
    const circuit: Circuit = {
      numQubits: 5,
      ops: [
        ...[0, 1, 2, 3].map((q): GateOp => ({ name: 'H', qubits: [q] })),
        { name: 'MCX', qubits: [0, 1, 2, 3, 4] },
        { name: 'MCX', qubits: [4, 1] },
        { name: 'MCX', qubits: [2, 0, 3] },
      ],
    }
    const qasm = toQasm(circuit)
    expect(qasm).toContain('ctrl(4) @ x q[0], q[1], q[2], q[3], q[4];')
    expect(qasm).toContain('ctrl(1) @ x q[4], q[1];')
    expectRoundTrip(circuit)
    // The bare form other tools write for one control.
    const bare = fromQasm('qubit[2] q;\nctrl @ x q[1], q[0];')
    expect(bare.ops).toEqual([{ name: 'MCX', qubits: [1, 0] }])
    // A modifier whose count disagrees with its operands is dropped, not guessed.
    expect(fromQasm('qubit[3] q;\nctrl(2) @ x q[0], q[1];').ops).toEqual([])
    expect(fromQasm('qubit[3] q;\nctrl(2) @ x q[0], q[0], q[1];').ops).toEqual([])
  })

  it('barriers survive the trip, full-register or partial', () => {
    const circuit: Circuit = {
      numQubits: 2,
      ops: [{ name: 'H', qubits: [0] }, { name: 'BARRIER', qubits: [] }, { name: 'CX', qubits: [0, 1] }],
    }
    expect(toQasm(circuit)).toContain('barrier q;')
    expectRoundTrip(circuit)
    expect(fromQasm('qubit[2] q;\nh q[0];\nbarrier q[0], q[1];\ncx q[0], q[1];').ops.map((o) => o.name))
      .toEqual(['H', 'BARRIER', 'CX'])
  })

  it('a 2×2 custom matrix is a gate definition in stdgates plus an exact annotation', () => {
    const circuit: Circuit = {
      numQubits: 1,
      ops: [{ name: 'UNITARY', qubits: [0], matrix: H, label: 'Hme' }],
    }
    const qasm = toQasm(circuit)
    expect(qasm).toMatch(/^gate qb16_u0 a \{ .*U\(.*\) a; \}$/m)
    expect(qasm).toContain('qb16_u0 q[0]; // qubit16 {"label":"Hme"')
    expectRoundTrip(circuit)
  })

  it('a 4×4 custom matrix is defined from ctrl @ U, p, cp and gphase, and round-trips bit-exactly', () => {
    const circuit: Circuit = {
      numQubits: 3,
      ops: [
        { name: 'H', qubits: [2] },
        { name: 'UNITARY', qubits: [2, 0], matrix: iswap, label: 'iSWAP' },
        // The same matrix twice shares one definition.
        { name: 'UNITARY', qubits: [1, 2], matrix: iswap, label: 'iSWAP' },
      ],
    }
    const qasm = toQasm(circuit)
    expect(qasm.match(/^gate qb16_u\d+ /gm)).toHaveLength(1)
    expect(qasm).toMatch(/^gate qb16_u0 a, b \{ .*ctrl @ U\(/m)
    expect(qasm).toContain('qb16_u0 q[2], q[0];')
    expect(qasm).toContain('qb16_u0 q[1], q[2];')
    expectRoundTrip(circuit)
  })

  it('a custom matrix without its annotation is dropped rather than guessed, and a non-unitary one is refused', () => {
    const noAnn = fromQasm('qubit[1] q;\ngate qb16_u0 a { U(pi/2, 0, pi) a; }\nqb16_u0 q[0];')
    expect(noAnn.ops).toEqual([])
    const shear = fromQasm('qubit[1] q;\nqb16_u0 q[0]; // qubit16 {"label":"S","matrix":[[1,0],[1,0],[0,0],[1,0]]}')
    expect(shear.ops).toEqual([])
    const wrongArity = fromQasm('qubit[2] q;\nqb16_u0 q[0], q[1]; // qubit16 {"label":"H","matrix":[[0.7071067811865476,0],[0.7071067811865476,0],[0.7071067811865476,0],[-0.7071067811865476,0]]}')
    expect(wrongArity.ops).toEqual([])
    expect(() => fromQasm('qubit[1] q;\nqb16_u0 q[0]; // qubit16 {not json')).not.toThrow()
    // Exporting a non-unitary matrix throws — the file must never claim a gate that is not one.
    expect(() => toQasm({ numQubits: 1, ops: [{ name: 'UNITARY', qubits: [0], matrix: [c(1), c(1), c(0), c(1)] }] }))
      .toThrow(/not unitary/)
  })

  it('+k mod N and ×k mod N become named gate definitions whose bodies are multi-controlled-X ladders', () => {
    const circuit: Circuit = {
      numQubits: 5,
      ops: [
        { name: 'X', qubits: [0] },
        { name: 'ADDK', qubits: [0, 1, 2, 3], k: 7, modulus: 15 },
        { name: 'MULK', qubits: [0, 1, 2, 3], k: 7, modulus: 15 },
        { name: 'H', qubits: [4] },
        { name: 'MULK', qubits: [4, 0, 1, 2, 3], k: 4, modulus: 15, controls: 1 },
        // The same block again reuses the definition.
        { name: 'ADDK', qubits: [0, 1, 2, 3], k: 7, modulus: 15 },
      ],
    }
    const qasm = toQasm(circuit)
    expect(qasm.match(/^gate qb16_add_7_mod_15_w4 r0, r1, r2, r3 \{/gm)).toHaveLength(1)
    expect(qasm).toMatch(/^gate qb16_mul_7_mod_15_w4 r0, r1, r2, r3 \{ .*ctrl\(3\) @ x/m)
    expect(qasm).toContain('qb16_add_7_mod_15_w4 q[0], q[1], q[2], q[3];')
    expect(qasm).toContain('ctrl(1) @ qb16_mul_4_mod_15_w4 q[4], q[0], q[1], q[2], q[3];')
    expectRoundTrip(circuit)
  })

  it('a negative k is exported canonically and reads back as its residue', () => {
    const circuit: Circuit = { numQubits: 3, ops: [{ name: 'ADDK', qubits: [0, 1, 2], k: -1, modulus: 5 }] }
    const qasm = toQasm(circuit)
    expect(qasm).toContain('qb16_add_4_mod_5_w3')
    const back = fromQasm(qasm)
    expect(back.ops).toEqual([{ name: 'ADDK', qubits: [0, 1, 2], k: 4, modulus: 5 }])
    expect(simulate(back).amplitudes()).toEqual(simulate(circuit).amplitudes())
  })

  it('QFT and inverse QFT, plain and controlled, on a scrambled register', () => {
    const circuit: Circuit = {
      numQubits: 4,
      ops: [
        { name: 'X', qubits: [1] },
        { name: 'H', qubits: [3] },
        { name: 'QFT', qubits: [2, 0, 1] },
        { name: 'IQFT', qubits: [3, 2, 0, 1], controls: 1 },
      ],
    }
    const qasm = toQasm(circuit)
    expect(qasm).toMatch(/^gate qb16_qft_w3 r0, r1, r2 \{ h r2; cp\(pi\/2\) r1, r2; cp\(pi\/4\) r0, r2; h r1; cp\(pi\/2\) r0, r1; h r0; swap r0, r2; \}$/m)
    expect(qasm).toContain('qb16_qft_w3 q[2], q[0], q[1];')
    expect(qasm).toContain('ctrl(1) @ qb16_iqft_w3 q[3], q[2], q[0], q[1];')
    expectRoundTrip(circuit)
  })

  it('a block whose operand count disagrees with its definition width is dropped', () => {
    expect(fromQasm('qubit[4] q;\nqb16_add_7_mod_15_w4 q[0], q[1], q[2];').ops).toEqual([])
    expect(fromQasm('qubit[4] q;\nqb16_qft_w2 q[0], q[0];').ops).toEqual([])
    expect(fromQasm('qubit[4] q;\nctrl(1) @ qb16_qft_w2 q[0], q[1];').ops).toEqual([])
  })

  it('classical control wraps every new gate the same way it wraps a CX', () => {
    const circuit: Circuit = {
      numQubits: 4,
      ops: [
        { name: 'H', qubits: [0] },
        { name: 'MEASURE', qubits: [0], clbit: 0 },
        { name: 'SX', qubits: [1], condition: { bit: 0, value: 1 } },
        { name: 'MCX', qubits: [1, 2, 3], condition: { bit: 0, value: 0 } },
        { name: 'ADDK', qubits: [1, 2, 3], k: 3, modulus: 8, condition: { bit: 0, value: 1 } },
        { name: 'UNITARY', qubits: [2], matrix: H, label: 'H', condition: { bit: 0, value: 1 } },
        { name: 'CSWAP', qubits: [1, 2, 3], condition: { bit: 0, value: 0 } },
      ],
    }
    const qasm = toQasm(circuit)
    expect(qasm).toContain('if (c[0] == true) { sx q[1]; }')
    expect(qasm).toContain('if (c[0] == false) { ctrl(2) @ x q[1], q[2], q[3]; }')
    expect(qasm).toContain('if (c[0] == true) { qb16_add_3_mod_8_w3 q[1], q[2], q[3]; }')
    expect(qasm).toMatch(/if \(c\[0\] == true\) \{ qb16_u0 q\[2\]; \} \/\/ qubit16 \{/)
    expect(qasm).toContain('if (c[0] == false) { cswap q[1], q[2], q[3]; }')
    const back = fromQasm(qasm)
    expect(back.ops).toEqual(circuit.ops)
  })

  it("Shor's order finding (N = 15, a = 7) round-trips and still peaks at 0, 2, 4, 6", () => {
    const work = [3, 4, 5, 6]
    const circuit: Circuit = {
      numQubits: 7,
      ops: [
        { name: 'X', qubits: [3] },
        { name: 'H', qubits: [0] }, { name: 'H', qubits: [1] }, { name: 'H', qubits: [2] },
        { name: 'BARRIER', qubits: [] },
        { name: 'MULK', qubits: [0, ...work], k: 7, modulus: 15, controls: 1 },
        { name: 'MULK', qubits: [1, ...work], k: 4, modulus: 15, controls: 1 },
        { name: 'MULK', qubits: [2, ...work], k: 1, modulus: 15, controls: 1 },
        { name: 'BARRIER', qubits: [] },
        { name: 'IQFT', qubits: [0, 1, 2] },
      ],
    }
    const back = expectRoundTrip(circuit)
    const sv = simulate(back)
    const marginal = new Array<number>(8).fill(0)
    for (let i = 0; i < sv.dim; i++) marginal[i & 7] += sv.probability(i)
    ;[0, 2, 4, 6].forEach((y) => expect(marginal[y]).toBeCloseTo(0.25, 10))
  })

  it('never throws on hostile input involving the new syntax', () => {
    for (const src of [
      'ctrl( @ x q[0], q[1];',
      'ctrl(99) @ x q[0];',
      'qb16_add_7_mod_15_w4 q[0];',
      'qb16_add_a_mod_b_wc q[0];',
      'qb16_u0 q[0]; // qubit16 {"matrix":"nope"}',
      'qb16_u0 q[0]; // qubit16 {"matrix":[[1]]}',
      'qb16_u0 q[0]; // qubit16 {"matrix":[[1,0],[0,0],[0,0],["1",0]]}',
      'gate qb16_qft_w2 r0, r1 {',
      'ctrl(1) @ qb16_qft_w2 q[0], q[1], q[2];',
      'qb16_mul_6_mod_15_w4 q[0], q[1], q[2], q[3];',
    ]) {
      expect(() => fromQasm(`qubit[4] q;\n${src}`)).not.toThrow()
    }
  })

  it('the ×6 mod 15 call that names a non-permutation is rejected at simulate time, not silently identity', () => {
    const back = fromQasm('qubit[4] q;\nqb16_mul_6_mod_15_w4 q[0], q[1], q[2], q[3];')
    expect(back.ops).toHaveLength(1)
    expect(() => simulate(back)).toThrow(/not reversible/)
  })
})
