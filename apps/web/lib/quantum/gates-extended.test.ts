/**
 * gates-extended.test.ts — every new gate against its DEFINITION, never
 * against the engine's own output.
 *
 * The reference values are: literal matrices typed from the textbook, classical
 * arithmetic for the blocks, the DFT matrix for the QFT, the known Shor
 * (N = 15, a = 7, period 4) spectrum, and a tiny OpenQASM gate-body interpreter
 * written from the spec's matrix definitions so the exported `gate` bodies are
 * verified as text, not assumed.
 */

import { describe, it, expect } from 'vitest'
import {
  StateVector,
  gateMatrix,
  mulberry32,
  simulate,
  type Complex,
  type GateOp,
} from '../quantum'
import {
  applyCswap,
  applyMatrixOnRegister,
  applyPermutationOnRegister,
  applyQft,
  dftMatrix,
  formatComplexEntry,
  gcd,
  isPermutation,
  isUnitary,
  modularAddPermutation,
  modularMulPermutation,
  oneQubitToQasmBody,
  parseComplexEntry,
  permutationMatrix,
  permutationToQasmBody,
  qftToQasmBody,
  synthesisMatrix,
  synthesizeTwoQubit,
  sxMatrix,
  sxdgMatrix,
  twoQubitToQasmBody,
  u3Matrix,
  u3Parameters,
  unitarityError,
  EXTENDED_PRESETS,
  MATRIX_PRESETS,
} from './gates-extended'

// ────────────────────────────────────────────────────────────
// Helpers (independent of the module under test)
// ────────────────────────────────────────────────────────────

const c = (re: number, im = 0): Complex => ({ re, im })
const mul = (a: Complex, b: Complex): Complex => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re })
const add = (a: Complex, b: Complex): Complex => ({ re: a.re + b.re, im: a.im + b.im })

function matMul(a: readonly Complex[], b: readonly Complex[], d: number): Complex[] {
  const out: Complex[] = []
  for (let i = 0; i < d; i++) for (let j = 0; j < d; j++) {
    let acc = c(0)
    for (let k = 0; k < d; k++) acc = add(acc, mul(a[i * d + k], b[k * d + j]))
    out.push(acc)
  }
  return out
}

function expectMatrixClose(actual: readonly Complex[], expected: readonly Complex[], digits = 10): void {
  expect(actual.length).toBe(expected.length)
  actual.forEach((z, i) => {
    expect(z.re).toBeCloseTo(expected[i].re, digits)
    expect(z.im).toBeCloseTo(expected[i].im, digits)
  })
}

function expectStateClose(actual: StateVector, expected: readonly Complex[], digits = 10): void {
  expect(actual.dim).toBe(expected.length)
  for (let i = 0; i < actual.dim; i++) {
    const z = actual.amplitude(i)
    expect(z.re).toBeCloseTo(expected[i].re, digits)
    expect(z.im).toBeCloseTo(expected[i].im, digits)
  }
}

/** A normalised random complex vector. */
function randomState(n: number, rng: () => number): StateVector {
  const sv = new StateVector(n)
  for (let i = 0; i < sv.data.length; i++) sv.data[i] = rng() * 2 - 1
  return sv.normalize()
}

/** A Haar-ish random d×d unitary by Gram–Schmidt on random complex columns. */
function randomUnitary(d: number, rng: () => number): Complex[] {
  const cols: Complex[][] = []
  for (let j = 0; j < d; j++) {
    let v = Array.from({ length: d }, () => c(rng() * 2 - 1, rng() * 2 - 1))
    for (const u of cols) {
      // v -= <u, v> u
      let dot = c(0)
      for (let i = 0; i < d; i++) dot = add(dot, mul({ re: u[i].re, im: -u[i].im }, v[i]))
      v = v.map((z, i) => ({ re: z.re - (dot.re * u[i].re - dot.im * u[i].im), im: z.im - (dot.re * u[i].im + dot.im * u[i].re) }))
    }
    const norm = Math.sqrt(v.reduce((s, z) => s + z.re * z.re + z.im * z.im, 0))
    cols.push(v.map((z) => c(z.re / norm, z.im / norm)))
  }
  const out: Complex[] = []
  for (let i = 0; i < d; i++) for (let j = 0; j < d; j++) out.push(cols[j][i])
  return out
}

/**
 * A minimal OpenQASM 3 gate-body interpreter, from the spec's definitions:
 *   U(θ,φ,λ) = [[cos θ/2, −e^{iλ} sin θ/2], [e^{iφ} sin θ/2, e^{i(φ+λ)} cos θ/2]]
 *   p(λ) = diag(1, e^{iλ}),  cp(λ) = phase e^{iλ} on |11⟩,  gphase(γ) = e^{iγ}·I
 *   x, h, cx, swap as usual;  ctrl(n) @ G applies G when every control is 1.
 * Operands are the body's formal names (a, b, r0, r1, …) mapped to qubits.
 * Returns the full 2^n × 2^n matrix the statements implement, column by column.
 */
function interpretBody(lines: string[], operandQubit: Record<string, number>, n: number): Complex[] {
  const dim = 1 << n
  const columns: Complex[][] = []
  for (let basis = 0; basis < dim; basis++) {
    const re = new Float64Array(dim), im = new Float64Array(dim)
    re[basis] = 1
    for (const raw of lines) {
      const stmt = raw.trim().replace(/;$/, '')
      if (!stmt) continue
      const mod = stmt.match(/^ctrl(?:\((\d+)\))?\s*@\s*(.+)$/)
      const controls = mod ? (mod[1] ? parseInt(mod[1], 10) : 1) : 0
      const core = mod ? mod[2] : stmt
      const m = core.match(/^(\w+)(?:\(([^)]*)\))?\s*(.*)$/)
      if (!m) throw new Error(`cannot parse: ${raw}`)
      const name = m[1]
      const args = m[2] ? m[2].split(',').map((s) => evalNum(s.trim())) : []
      const operands = m[3] ? m[3].split(',').map((s) => operandQubit[s.trim()]) : []
      if (operands.some((q) => q === undefined)) throw new Error(`unknown operand in: ${raw}`)
      const ctl = operands.slice(0, controls)
      const tgt = operands.slice(controls)
      const ctlMask = ctl.reduce((acc, q) => acc | (1 << q), 0)
      const apply2 = (mat: Complex[], t: number) => {
        const bit = 1 << t
        for (let i = 0; i < dim; i++) {
          if (i & bit) continue
          if ((i & ctlMask) !== ctlMask) continue
          const j = i | bit
          const a = c(re[i], im[i]), b = c(re[j], im[j])
          const na = add(mul(mat[0], a), mul(mat[1], b))
          const nb = add(mul(mat[2], a), mul(mat[3], b))
          re[i] = na.re; im[i] = na.im; re[j] = nb.re; im[j] = nb.im
        }
      }
      const phaseWhere = (mask: number, theta: number) => {
        const full = mask | ctlMask
        for (let i = 0; i < dim; i++) {
          if ((i & full) !== full) continue
          const z = mul(c(re[i], im[i]), c(Math.cos(theta), Math.sin(theta)))
          re[i] = z.re; im[i] = z.im
        }
      }
      switch (name) {
        case 'U': apply2(u3Matrix(args[0], args[1], args[2]), tgt[0]); break
        case 'x': apply2([c(0), c(1), c(1), c(0)], tgt[0]); break
        case 'h': apply2([c(Math.SQRT1_2), c(Math.SQRT1_2), c(Math.SQRT1_2), c(-Math.SQRT1_2)], tgt[0]); break
        case 'p': phaseWhere(1 << tgt[0], args[0]); break
        case 'cp': phaseWhere((1 << tgt[0]) | (1 << tgt[1]), args[0]); break
        case 'gphase': phaseWhere(0, args[0]); break
        case 'cx': {
          const cm = ctlMask | (1 << tgt[0])
          const bit = 1 << tgt[1]
          for (let i = 0; i < dim; i++) {
            if ((i & cm) !== cm || i & bit) continue
            const j = i | bit
            ;[re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]
          }
          break
        }
        case 'swap': {
          const abit = 1 << tgt[0], bbit = 1 << tgt[1]
          for (let i = 0; i < dim; i++) {
            if ((i & ctlMask) !== ctlMask) continue
            if (((i & abit) !== 0) === ((i & bbit) !== 0)) continue
            const j = i ^ abit ^ bbit
            if (j <= i) continue
            ;[re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]
          }
          break
        }
        default: throw new Error(`interpreter does not know ${name}`)
      }
    }
    columns.push(Array.from({ length: dim }, (_, i) => c(re[i], im[i])))
  }
  const out: Complex[] = []
  for (let r = 0; r < dim; r++) for (let col = 0; col < dim; col++) out.push(columns[col][r])
  return out
}

/** Evaluate `pi/4`, `-3*pi/8`, `0.123` — the forms formatAngle and String() emit. */
function evalNum(s: string): number {
  const t = s.replace(/\s+/g, '')
  const m = t.match(/^(-?)(\d+(?:\.\d+)?(?:e-?\d+)?)?(\*?pi)?(?:\/(\d+))?$/)
  if (!m) return parseFloat(t)
  let v = m[2] ? parseFloat(m[2]) : 1
  if (m[3]) v *= Math.PI
  if (m[4]) v /= parseInt(m[4], 10)
  return m[1] ? -v : v
}

/** The full matrix of a GateOp on n qubits, column by column through apply(). */
function opMatrix(op: GateOp, n: number): Complex[] {
  const dim = 1 << n
  const cols: Complex[][] = []
  for (let basis = 0; basis < dim; basis++) {
    const sv = new StateVector(n)
    sv.data.fill(0)
    sv.data[2 * basis] = 1
    sv.apply(op)
    cols.push(sv.amplitudes())
  }
  const out: Complex[] = []
  for (let r = 0; r < dim; r++) for (let col = 0; col < dim; col++) out.push(cols[col][r])
  return out
}

const X: Complex[] = [c(0), c(1), c(1), c(0)]
const H: Complex[] = [c(Math.SQRT1_2), c(Math.SQRT1_2), c(Math.SQRT1_2), c(-Math.SQRT1_2)]
const S: Complex[] = [c(1), c(0), c(0), c(0, 1)]
const I2: Complex[] = [c(1), c(0), c(0), c(1)]

// ────────────────────────────────────────────────────────────
// √X
// ────────────────────────────────────────────────────────────

describe('√X and √X†', () => {
  it('√X is ½[[1+i, 1−i], [1−i, 1+i]] and the engine applies that matrix', () => {
    expectMatrixClose(sxMatrix(), [c(0.5, 0.5), c(0.5, -0.5), c(0.5, -0.5), c(0.5, 0.5)])
    expectMatrixClose(gateMatrix('SX'), sxMatrix())
    expectMatrixClose(opMatrix({ name: 'SX', qubits: [0] }, 1), sxMatrix())
  })

  it('√X · √X = X', () => {
    expectMatrixClose(matMul(sxMatrix(), sxMatrix(), 2), X)
    const sv = new StateVector(1)
    sv.apply({ name: 'SX', qubits: [0] }).apply({ name: 'SX', qubits: [0] })
    expectStateClose(sv, [c(0), c(1)])
  })

  it('√X† is the conjugate transpose, and √X · √X† = I', () => {
    const [a, b, cc, d] = sxMatrix()
    const dag = [c(a.re, -a.im), c(cc.re, -cc.im), c(b.re, -b.im), c(d.re, -d.im)]
    expectMatrixClose(sxdgMatrix(), dag)
    expectMatrixClose(matMul(sxMatrix(), sxdgMatrix(), 2), I2)
    expectMatrixClose(opMatrix({ name: 'SXDG', qubits: [0] }, 1), sxdgMatrix())
  })

  it('√X = H·S·H exactly, which is what the exported sxdg definition relies on', () => {
    expectMatrixClose(matMul(matMul(H, S, 2), H, 2), sxMatrix())
    const sdg = [c(1), c(0), c(0), c(0, -1)]
    expectMatrixClose(matMul(matMul(H, sdg, 2), H, 2), sxdgMatrix())
  })

  it('√X on |0⟩ lands on the equator: P(1) = ½ and the Bloch vector points along −y', () => {
    const sv = new StateVector(1).apply({ name: 'SX', qubits: [0] })
    expect(sv.qubitProbability(0)).toBeCloseTo(0.5, 12)
    const { x, y, z } = sv.blochVector(0)
    expect(x).toBeCloseTo(0, 12)
    expect(y).toBeCloseTo(-1, 12)
    expect(z).toBeCloseTo(0, 12)
  })
})

// ────────────────────────────────────────────────────────────
// Fredkin
// ────────────────────────────────────────────────────────────

describe('CSWAP (Fredkin)', () => {
  it('on |1, a, b⟩ swaps a and b; on |0, a, b⟩ leaves them alone', () => {
    for (const control of [0, 1]) for (const a of [0, 1]) for (const b of [0, 1]) {
      // qubit 0 = control, qubit 1 = a, qubit 2 = b
      const sv = new StateVector(3)
      sv.data.fill(0)
      const idx = control | (a << 1) | (b << 2)
      sv.data[2 * idx] = 1
      sv.apply({ name: 'CSWAP', qubits: [0, 1, 2] })
      const expected = control ? control | (b << 1) | (a << 2) : idx
      expect(sv.probability(expected)).toBeCloseTo(1, 12)
    }
  })

  it('equals the textbook 8×8 permutation on a random state, for non-adjacent operands too', () => {
    const rng = mulberry32(3)
    // control = qubit 2, swap qubits 0 and 3 in a 4-qubit state
    const sv = randomState(4, rng)
    const expected = sv.clone()
    const perm: number[] = []
    for (let x = 0; x < 8; x++) {
      // register order [2, 0, 3]: bit0 = control, bit1 = a, bit2 = b
      const ctl = x & 1, a = (x >> 1) & 1, b = (x >> 2) & 1
      perm.push(ctl ? ctl | (b << 1) | (a << 2) : x)
    }
    applyMatrixOnRegister(expected.data, 4, [2, 0, 3], permutationMatrix(perm))
    applyCswap(sv.data, 4, 2, 0, 3)
    expectStateClose(sv, expected.amplitudes())
    expect(isPermutation(perm)).toBe(true)
  })

  it('is its own inverse and rejects a control that is also a swapped wire', () => {
    const rng = mulberry32(5)
    const sv = randomState(3, rng)
    const before = sv.amplitudes()
    sv.apply({ name: 'CSWAP', qubits: [1, 0, 2] }).apply({ name: 'CSWAP', qubits: [1, 0, 2] })
    expectStateClose(sv, before)
    expect(() => new StateVector(3).apply({ name: 'CSWAP', qubits: [0, 0, 1] })).toThrow()
    expect(() => new StateVector(3).apply({ name: 'CSWAP', qubits: [0, 1] })).toThrow(/3 qubit/)
  })
})

// ────────────────────────────────────────────────────────────
// Multi-controlled X
// ────────────────────────────────────────────────────────────

describe('MCX', () => {
  it('flips the target only when every control is 1 — all 32 basis states, 4 controls', () => {
    const controls = [0, 1, 3, 4], target = 2
    for (let x = 0; x < 32; x++) {
      const sv = new StateVector(5)
      sv.data.fill(0)
      sv.data[2 * x] = 1
      sv.apply({ name: 'MCX', qubits: [...controls, target] })
      const allOn = controls.every((q) => (x >> q) & 1)
      const expected = allOn ? x ^ (1 << target) : x
      expect(sv.probability(expected)).toBeCloseTo(1, 12)
    }
  })

  it('with one control is CX and with two is CCX, on a random state', () => {
    const rng = mulberry32(11)
    const a = randomState(3, rng)
    const b = a.clone()
    a.apply({ name: 'MCX', qubits: [2, 0] })
    b.apply({ name: 'CX', qubits: [2, 0] })
    expectStateClose(a, b.amplitudes())
    a.apply({ name: 'MCX', qubits: [0, 1, 2] })
    b.apply({ name: 'CCX', qubits: [0, 1, 2] })
    expectStateClose(a, b.amplitudes())
  })

  it('rejects a lone target, a repeated control, and a control that is the target', () => {
    expect(() => new StateVector(3).apply({ name: 'MCX', qubits: [0] })).toThrow(/at least 2/)
    expect(() => new StateVector(3).apply({ name: 'MCX', qubits: [0, 0, 1] })).toThrow(/twice/)
    expect(() => new StateVector(3).apply({ name: 'MCX', qubits: [0, 1, 1] })).toThrow(/also be the target/)
  })
})

// ────────────────────────────────────────────────────────────
// Custom matrix
// ────────────────────────────────────────────────────────────

describe('custom matrix gate', () => {
  it('unitarityError is 0 for H, the identity and a random unitary, and large for a shear', () => {
    expect(unitarityError(H)).toBeLessThan(1e-12)
    expect(unitarityError(I2)).toBe(0)
    expect(unitarityError(randomUnitary(4, mulberry32(2)))).toBeLessThan(1e-12)
    // [[1, 1], [0, 1]]: U†U = [[1, 1], [1, 2]] → max deviation 1.
    expect(unitarityError([c(1), c(1), c(0), c(1)])).toBeCloseTo(1, 12)
    // 2·I: U†U = 4I → deviation 3.
    expect(unitarityError([c(2), c(0), c(0), c(2)])).toBeCloseTo(3, 12)
    expect(isUnitary([c(NaN), c(0), c(0), c(1)])).toBe(false)
    expect(isUnitary([c(1), c(0), c(0)])).toBe(false) // not square
  })

  it('apply() refuses a non-unitary matrix rather than producing a non-state', () => {
    const shear: Complex[] = [c(1), c(1), c(0), c(1)]
    expect(() => new StateVector(1).apply({ name: 'UNITARY', qubits: [0], matrix: shear })).toThrow(/not unitary/)
    expect(() => new StateVector(2).apply({ name: 'UNITARY', qubits: [0, 1], matrix: H })).toThrow(/needs 1 qubit/)
    expect(() => new StateVector(2).apply({ name: 'UNITARY', qubits: [0], matrix: [c(1), c(0), c(0)] })).toThrow(/2×2 or 4×4/)
    expect(() => new StateVector(2).apply({ name: 'UNITARY', qubits: [0] })).toThrow(/needs a matrix/)
  })

  it('a 2×2 H typed as a matrix is the same gate as H', () => {
    const a = new StateVector(2).apply({ name: 'UNITARY', qubits: [1], matrix: H })
    const b = new StateVector(2).apply({ name: 'H', qubits: [1] })
    expectStateClose(a, b.amplitudes())
  })

  it('a 4×4 is applied with qubits[0] as the least significant index bit', () => {
    // iSWAP: |01⟩ ↔ i|10⟩ where the ket is |q_b q_a⟩ and index = a + 2b.
    const iswap = MATRIX_PRESETS.find((p) => p.id === 'iswap')!.entries.map((e) => parseComplexEntry(e)!)
    // Prepare qubit a = 2 in |1⟩, qubit b = 0 in |0⟩ inside a 3-qubit state.
    const sv = new StateVector(3).apply({ name: 'X', qubits: [2] })
    sv.apply({ name: 'UNITARY', qubits: [2, 0], matrix: iswap })
    // Result: qubit 2 → 0, qubit 0 → 1, amplitude i.
    const z = sv.amplitude(0b001)
    expect(z.re).toBeCloseTo(0, 12)
    expect(z.im).toBeCloseTo(1, 12)
    expect(sv.probability(0b001)).toBeCloseTo(1, 12)
  })

  it('a random 4×4 unitary matches a direct matrix–vector product', () => {
    const rng = mulberry32(21)
    const u = randomUnitary(4, rng)
    const sv = randomState(2, rng)
    const expected = Array.from({ length: 4 }, (_, r) => {
      let acc = c(0)
      for (let col = 0; col < 4; col++) acc = add(acc, mul(u[r * 4 + col], sv.amplitude(col)))
      return acc
    })
    sv.apply({ name: 'UNITARY', qubits: [0, 1], matrix: u })
    expectStateClose(sv, expected)
  })

  it('every editor preset parses to a unitary of the size it claims', () => {
    for (const p of MATRIX_PRESETS) {
      const m = p.entries.map((e) => parseComplexEntry(e))
      expect(m.every((z) => z !== null)).toBe(true)
      expect(m.length).toBe(p.qubits === 1 ? 4 : 16)
      expect(unitarityError(m as Complex[])).toBeLessThan(1e-12)
    }
    const sx = MATRIX_PRESETS.find((p) => p.id === 'sx')!.entries.map((e) => parseComplexEntry(e)!)
    expectMatrixClose(sx, sxMatrix())
  })
})

describe('parseComplexEntry', () => {
  it('reads the forms a learner types', () => {
    expect(parseComplexEntry('1')).toEqual(c(1))
    expect(parseComplexEntry('-0.5')).toEqual(c(-0.5))
    expect(parseComplexEntry('i')).toEqual(c(0, 1))
    expect(parseComplexEntry('-i')).toEqual(c(0, -1))
    expect(parseComplexEntry('0.5i')).toEqual(c(0, 0.5))
    expect(parseComplexEntry('1 + 2i')).toEqual(c(1, 2))
    expect(parseComplexEntry('1-2i')).toEqual(c(1, -2))
    expect(parseComplexEntry('1/sqrt2')!.re).toBeCloseTo(Math.SQRT1_2, 15)
    expect(parseComplexEntry('1/√2')!.re).toBeCloseTo(Math.SQRT1_2, 15)
    expect(parseComplexEntry('(1+i)/2')).toEqual(c(0.5, 0.5))
    expect(parseComplexEntry('1/2 - 1/2i')).toEqual(c(0.5, -0.5))
    expect(parseComplexEntry('pi/4')!.re).toBeCloseTo(Math.PI / 4, 15)
  })

  it('returns null for anything else, never throwing', () => {
    for (const bad of ['', 'x', '1//2', '/2', '+', '1+', 'i2', '1/0', '2^i', '(1+i']) {
      expect(parseComplexEntry(bad)).toBeNull()
    }
  })

  it('formatComplexEntry round-trips through the parser', () => {
    for (const z of [c(1), c(-0.5, 0.25), c(0, 1), c(0, -1), c(0.7071, -0.7071), c(0)]) {
      const back = parseComplexEntry(formatComplexEntry(z))
      expect(back).not.toBeNull()
      expect(back!.re).toBeCloseTo(z.re, 4)
      expect(back!.im).toBeCloseTo(z.im, 4)
    }
  })
})

// ────────────────────────────────────────────────────────────
// Arithmetic blocks
// ────────────────────────────────────────────────────────────

describe('+k mod N', () => {
  it('matches integer arithmetic on every basis state of a 4-qubit register, N = 15, k = 7', () => {
    for (let x = 0; x < 16; x++) {
      const sv = new StateVector(4)
      sv.data.fill(0)
      sv.data[2 * x] = 1
      sv.apply({ name: 'ADDK', qubits: [0, 1, 2, 3], k: 7, modulus: 15 })
      const expected = x < 15 ? (x + 7) % 15 : x
      expect(sv.probability(expected)).toBeCloseTo(1, 12)
    }
  })

  it('honours the register order (qubits[0] is the least significant bit) when the register is scrambled', () => {
    // Register [3, 1, 0] in a 4-qubit state: value = q3 + 2·q1 + 4·q0.
    for (let v = 0; v < 8; v++) {
      const q3 = v & 1, q1 = (v >> 1) & 1, q0 = (v >> 2) & 1
      const idx = (q3 << 3) | (q1 << 1) | q0 | (1 << 2) // spectator qubit 2 set
      const sv = new StateVector(4)
      sv.data.fill(0)
      sv.data[2 * idx] = 1
      sv.apply({ name: 'ADDK', qubits: [3, 1, 0], k: 3, modulus: 8 })
      const nv = (v + 3) % 8
      const expected = ((nv & 1) << 3) | (((nv >> 1) & 1) << 1) | ((nv >> 2) & 1) | (1 << 2)
      expect(sv.probability(expected)).toBeCloseTo(1, 12)
    }
  })

  it('negative k subtracts, k ≡ 0 is the identity, and the permutation is a bijection', () => {
    expect(modularAddPermutation(-1, 15, 4)).toEqual([14, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 15])
    expect(modularAddPermutation(15, 15, 4)).toEqual(Array.from({ length: 16 }, (_, i) => i))
    expect(isPermutation(modularAddPermutation(5, 13, 4))).toBe(true)
  })

  it('leaves the uniform superposition over 0..N−1 invariant', () => {
    const sv = new StateVector(4)
    sv.data.fill(0)
    for (let x = 0; x < 15; x++) sv.data[2 * x] = 1 / Math.sqrt(15)
    const before = sv.probabilities()
    sv.apply({ name: 'ADDK', qubits: [0, 1, 2, 3], k: 4, modulus: 15 })
    sv.probabilities().forEach((p, i) => expect(p).toBeCloseTo(before[i], 12))
  })

  it('with a control, acts only where the control is 1', () => {
    // qubit 4 = control; register [0, 1, 2, 3]
    const rng = mulberry32(8)
    const sv = randomState(5, rng)
    const expected = sv.clone()
    const perm = modularAddPermutation(7, 15, 4)
    applyPermutationOnRegister(expected.data, 5, [0, 1, 2, 3], perm, [4])
    sv.apply({ name: 'ADDK', qubits: [4, 0, 1, 2, 3], k: 7, modulus: 15, controls: 1 })
    expectStateClose(sv, expected.amplitudes())
    // Control off: those amplitudes are untouched; control on: they moved.
    for (let i = 0; i < 16; i++) {
      expect(sv.amplitude(i).re).toBeCloseTo(expected.amplitude(i).re, 12)
    }
    const moved = new StateVector(5)
    moved.data.fill(0)
    moved.data[2 * (16 | 3)] = 1 // control on, x = 3
    moved.apply({ name: 'ADDK', qubits: [4, 0, 1, 2, 3], k: 7, modulus: 15, controls: 1 })
    expect(moved.probability(16 | 10)).toBeCloseTo(1, 12)
    const still = new StateVector(5)
    still.data.fill(0)
    still.data[2 * 3] = 1 // control off, x = 3
    still.apply({ name: 'ADDK', qubits: [4, 0, 1, 2, 3], k: 7, modulus: 15, controls: 1 })
    expect(still.probability(3)).toBeCloseTo(1, 12)
  })

  it('rejects a modulus that does not fit, a non-integer k, and a missing modulus', () => {
    expect(() => modularAddPermutation(1, 17, 4)).toThrow(/does not fit/)
    expect(() => modularAddPermutation(1.5, 15, 4)).toThrow(/integer/)
    expect(() => new StateVector(4).apply({ name: 'ADDK', qubits: [0, 1, 2, 3], k: 1 })).toThrow(/modulus/)
  })
})

describe('×k mod N', () => {
  it('×7 mod 15 sends |1⟩ → |7⟩ → |4⟩ → |13⟩ → |1⟩ (order of 7 is 4)', () => {
    const sv = new StateVector(4).apply({ name: 'X', qubits: [0] })
    const op: GateOp = { name: 'MULK', qubits: [0, 1, 2, 3], k: 7, modulus: 15 }
    for (const expected of [7, 4, 13, 1]) {
      sv.apply(op)
      expect(sv.probability(expected)).toBeCloseTo(1, 12)
    }
  })

  it('matches (k·x) mod N on every basis state and passes x ≥ N through', () => {
    const perm = modularMulPermutation(11, 13, 4)
    for (let x = 0; x < 16; x++) expect(perm[x]).toBe(x < 13 ? (11 * x) % 13 : x)
    expect(isPermutation(perm)).toBe(true)
    for (let x = 0; x < 16; x++) {
      const sv = new StateVector(4)
      sv.data.fill(0)
      sv.data[2 * x] = 1
      sv.apply({ name: 'MULK', qubits: [0, 1, 2, 3], k: 11, modulus: 13 })
      expect(sv.probability(perm[x])).toBeCloseTo(1, 12)
    }
  })

  it('refuses k that shares a factor with N — that map is not a permutation', () => {
    expect(gcd(6, 15)).toBe(3)
    expect(() => modularMulPermutation(6, 15, 4)).toThrow(/not reversible/)
    expect(() => new StateVector(4).apply({ name: 'MULK', qubits: [0, 1, 2, 3], k: 5, modulus: 15 })).toThrow(/gcd/)
    expect(() => modularMulPermutation(0, 15, 4)).toThrow()
  })
})

// ────────────────────────────────────────────────────────────
// QFT
// ────────────────────────────────────────────────────────────

describe('QFT', () => {
  it('equals the DFT matrix on random states for 1 to 4 qubits', () => {
    const rng = mulberry32(31)
    for (let m = 1; m <= 4; m++) {
      const sv = randomState(m, rng)
      const expected = sv.clone()
      applyMatrixOnRegister(expected.data, m, Array.from({ length: m }, (_, i) => i), dftMatrix(m))
      applyQft(sv.data, m, Array.from({ length: m }, (_, i) => i))
      expectStateClose(sv, expected.amplitudes())
    }
  })

  it('works on a scrambled, non-contiguous register embedded in a larger state', () => {
    const rng = mulberry32(32)
    const register = [3, 0, 4]
    const sv = randomState(5, rng)
    const expected = sv.clone()
    applyMatrixOnRegister(expected.data, 5, register, dftMatrix(3))
    sv.apply({ name: 'QFT', qubits: register })
    expectStateClose(sv, expected.amplitudes())
  })

  it('inverse QFT is the adjoint: IQFT ∘ QFT = identity, and IQFT matches the inverse DFT', () => {
    const rng = mulberry32(33)
    const sv = randomState(4, rng)
    const before = sv.amplitudes()
    sv.apply({ name: 'QFT', qubits: [0, 1, 2, 3] }).apply({ name: 'IQFT', qubits: [0, 1, 2, 3] })
    expectStateClose(sv, before)
    const a = randomState(3, rng)
    const b = a.clone()
    applyMatrixOnRegister(b.data, 3, [0, 1, 2], dftMatrix(3, true))
    a.apply({ name: 'IQFT', qubits: [0, 1, 2] })
    expectStateClose(a, b.amplitudes())
  })

  it('a period-4 comb over 8 values transforms to peaks at 0, 2, 4, 6 — the Shor mechanism', () => {
    const sv = new StateVector(3)
    sv.data.fill(0)
    sv.data[0] = Math.SQRT1_2
    sv.data[2 * 4] = Math.SQRT1_2
    sv.apply({ name: 'QFT', qubits: [0, 1, 2] })
    const p = sv.probabilities()
    ;[0, 2, 4, 6].forEach((y) => expect(p[y]).toBeCloseTo(0.25, 12))
    ;[1, 3, 5, 7].forEach((y) => expect(p[y]).toBeCloseTo(0, 12))
  })

  it('controlled QFT leaves the control-off half alone', () => {
    const rng = mulberry32(34)
    const sv = randomState(4, rng)
    const expected = sv.clone()
    applyMatrixOnRegister(expected.data, 4, [0, 1, 2], dftMatrix(3), [3])
    sv.apply({ name: 'QFT', qubits: [3, 0, 1, 2], controls: 1 })
    expectStateClose(sv, expected.amplitudes())
    for (let i = 0; i < 8; i++) expect(sv.amplitude(i)).toEqual(expected.amplitude(i))
  })
})

// ────────────────────────────────────────────────────────────
// Shor, end to end, from the palette's own blocks
// ────────────────────────────────────────────────────────────

describe("Shor's order finding, N = 15, a = 7, built from the blocks", () => {
  it('measures the counting register at 0, 2, 4, 6 with probability ¼ each', () => {
    // Counting register q0..q2 (3 qubits, Q = 8); work register q3..q6 (4 qubits).
    // 7^1 = 7, 7^2 = 49 ≡ 4, 7^4 ≡ 1 (mod 15) — period 4 divides 8 exactly, so
    // the inverse QFT lands on multiples of Q/r = 2 with no leakage.
    const counting = [0, 1, 2]
    const work = [3, 4, 5, 6]
    const ops: GateOp[] = [
      { name: 'X', qubits: [3] }, // work register starts at |1⟩
      ...counting.map((q): GateOp => ({ name: 'H', qubits: [q] })),
      { name: 'MULK', qubits: [0, ...work], k: 7, modulus: 15, controls: 1 },
      { name: 'MULK', qubits: [1, ...work], k: 4, modulus: 15, controls: 1 },
      { name: 'MULK', qubits: [2, ...work], k: 1, modulus: 15, controls: 1 },
      { name: 'IQFT', qubits: counting },
    ]
    const sv = simulate({ numQubits: 7, ops })
    const marginal = new Array<number>(8).fill(0)
    for (let i = 0; i < sv.dim; i++) marginal[i & 7] += sv.probability(i)
    ;[0, 2, 4, 6].forEach((y) => expect(marginal[y]).toBeCloseTo(0.25, 10))
    ;[1, 3, 5, 7].forEach((y) => expect(marginal[y]).toBeCloseTo(0, 10))
    // And the work register only ever holds an element of the orbit {1, 7, 4, 13}.
    const workMarginal = new Array<number>(16).fill(0)
    for (let i = 0; i < sv.dim; i++) workMarginal[i >> 3] += sv.probability(i)
    ;[1, 7, 4, 13].forEach((v) => expect(workMarginal[v]).toBeCloseTo(0.25, 10))
    expect(workMarginal.reduce((s, p) => s + p, 0)).toBeCloseTo(1, 10)
  })
})

// ────────────────────────────────────────────────────────────
// OpenQASM gate bodies — the exported definitions run as written
// ────────────────────────────────────────────────────────────

describe('exported gate bodies, interpreted from the OpenQASM 3 definitions', () => {
  it('u3Parameters closes: e^{iγ} U(θ, φ, λ) rebuilds a random 2×2 exactly', () => {
    const rng = mulberry32(41)
    for (let trial = 0; trial < 20; trial++) {
      const v = randomUnitary(2, rng)
      const { theta, phi, lambda, gamma } = u3Parameters(v)
      const g = c(Math.cos(gamma), Math.sin(gamma))
      expectMatrixClose(u3Matrix(theta, phi, lambda).map((z) => mul(g, z)), v, 9)
    }
    // Degenerate rows: diagonal and anti-diagonal inputs.
    for (const v of [S, X, [c(0, 1), c(0), c(0), c(0, -1)], [c(0), c(1), c(-1), c(0)]]) {
      const { theta, phi, lambda, gamma } = u3Parameters(v)
      const g = c(Math.cos(gamma), Math.sin(gamma))
      expectMatrixClose(u3Matrix(theta, phi, lambda).map((z) => mul(g, z)), v, 9)
    }
  })

  it('a 2×2 body reproduces the matrix, global phase included', () => {
    const rng = mulberry32(42)
    for (const v of [H, sxMatrix(), randomUnitary(2, rng), randomUnitary(2, rng)]) {
      expectMatrixClose(interpretBody(oneQubitToQasmBody(v), { a: 0 }, 1), v, 9)
    }
  })

  it('the Givens synthesis reassembles to the input for named and random 4×4 unitaries', () => {
    const rng = mulberry32(43)
    const named = MATRIX_PRESETS.filter((p) => p.qubits === 2).map((p) => p.entries.map((e) => parseComplexEntry(e)!))
    const cxMat: Complex[] = permutationMatrix([0, 1, 3, 2])
    for (const u of [...named, cxMat, randomUnitary(4, rng), randomUnitary(4, rng), randomUnitary(4, rng)]) {
      expectMatrixClose(synthesisMatrix(synthesizeTwoQubit(u)), u, 9)
    }
  })

  it('a 4×4 body reproduces the matrix exactly — operand a is the low index bit', () => {
    const rng = mulberry32(44)
    const named = MATRIX_PRESETS.filter((p) => p.qubits === 2).map((p) => p.entries.map((e) => parseComplexEntry(e)!))
    for (const u of [...named, randomUnitary(4, rng), randomUnitary(4, rng), randomUnitary(4, rng)]) {
      expectMatrixClose(interpretBody(twoQubitToQasmBody(u), { a: 0, b: 1 }, 2), u, 8)
    }
  })

  it('the permutation ladder for +7 mod 15 and ×7 mod 15 implements exactly those permutations', () => {
    for (const perm of [modularAddPermutation(7, 15, 4), modularMulPermutation(7, 15, 4), modularAddPermutation(1, 8, 3)]) {
      const width = Math.log2(perm.length)
      const operands = Object.fromEntries(Array.from({ length: width }, (_, i) => [`r${i}`, i]))
      const got = interpretBody(permutationToQasmBody(perm, width), operands, width)
      expectMatrixClose(got, permutationMatrix(perm), 12)
    }
    // A single transposition between states differing in every bit, on 2 qubits.
    const got = interpretBody(permutationToQasmBody([3, 1, 2, 0], 2), { r0: 0, r1: 1 }, 2)
    expectMatrixClose(got, permutationMatrix([3, 1, 2, 0]), 12)
  })

  it('the QFT body is the DFT and the inverse body is its adjoint', () => {
    for (const width of [1, 2, 3]) {
      const operands = Object.fromEntries(Array.from({ length: width }, (_, i) => [`r${i}`, i]))
      expectMatrixClose(interpretBody(qftToQasmBody(width, false), operands, width), dftMatrix(width), 10)
      expectMatrixClose(interpretBody(qftToQasmBody(width, true), operands, width), dftMatrix(width, true), 10)
    }
  })
})

describe('extended presets', () => {
  it('×2 mod 3 period finding reads 0 or 2 on the counting register, never 1 or 3', () => {
    const p = EXTENDED_PRESETS.find((x) => x.id === 'period-2-mod-3')!
    const sv = simulate(p.circuit)
    const marginal = [0, 0, 0, 0]
    for (let i = 0; i < sv.dim; i++) marginal[i & 3] += sv.probability(i)
    expect(marginal[0]).toBeCloseTo(0.5, 10)
    expect(marginal[2]).toBeCloseTo(0.5, 10)
    expect(marginal[1]).toBeCloseTo(0, 10)
    expect(marginal[3]).toBeCloseTo(0, 10)
  })

  it('the Shor preset is the circuit the end-to-end test built by hand', () => {
    const p = EXTENDED_PRESETS.find((x) => x.id === 'shor-15')!
    const sv = simulate(p.circuit)
    const marginal = new Array<number>(8).fill(0)
    for (let i = 0; i < sv.dim; i++) marginal[i & 7] += sv.probability(i)
    ;[0, 2, 4, 6].forEach((y) => expect(marginal[y]).toBeCloseTo(0.25, 10))
    ;[1, 3, 5, 7].forEach((y) => expect(marginal[y]).toBeCloseTo(0, 10))
  })

  it('every extended preset fits its declared width and has a unique id', () => {
    const ids = new Set(EXTENDED_PRESETS.map((p) => p.id))
    expect(ids.size).toBe(EXTENDED_PRESETS.length)
    for (const p of EXTENDED_PRESETS) {
      for (const op of p.circuit.ops) for (const q of op.qubits) expect(q).toBeLessThan(p.circuit.numQubits)
      expect(() => simulate(p.circuit)).not.toThrow()
    }
  })
})
