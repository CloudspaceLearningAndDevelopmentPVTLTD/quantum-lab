/**
 * gates-extended.ts — the gates that close the palette gap against Quirk.
 *
 * WHAT LIVES HERE
 *   √X and √X†             fixed 2×2 matrices.
 *   Fredkin (CSWAP)        swap two wires when a third is |1⟩.
 *   Multi-controlled X     any number of controls — the engine in quantum.ts
 *                          already generalises, so this file only validates.
 *   Custom matrix gate     a 2×2 or 4×4 the learner types in, with the
 *                          unitarity check that decides whether it is a gate at
 *                          all, and the entry parser the editor uses.
 *   Register blocks        +k mod N and ×k mod N as PERMUTATION unitaries on a
 *                          register, and the QFT / inverse QFT, each with an
 *                          optional control qubit. Together they are what makes
 *                          Shor's order-finding circuit something a learner can
 *                          assemble from the palette.
 *   Two-qubit synthesis    a 4×4 unitary written as OpenQASM 3 stdgates, so a
 *                          custom matrix exported from here runs in Qiskit.
 *
 * Everything operates on the raw interleaved [re, im] Float64Array a StateVector
 * carries, so this module has no runtime dependency on quantum.ts (which
 * imports it — a value import in the other direction would be a cycle).
 *
 * CONVENTIONS
 *   Registers are listed least-significant qubit FIRST: `register[0]` is bit 0
 *   of the integer the register holds. For a custom matrix on qubits [a, b],
 *   row/column index j has qubit a as its least significant bit — Qiskit's
 *   little-endian convention, the same one StateVector uses for basis labels.
 *   Controls, where a block accepts them, are the LEADING entries of `qubits`
 *   and `controls` says how many there are.
 */

import type { Complex, Preset } from '../quantum'

// ────────────────────────────────────────────────────────────
// Local complex helpers (no value import from quantum.ts — see header)
// ────────────────────────────────────────────────────────────

const cx = (re: number, im = 0): Complex => ({ re, im })
const mul = (a: Complex, b: Complex): Complex => ({
  re: a.re * b.re - a.im * b.im,
  im: a.re * b.im + a.im * b.re,
})
const add = (a: Complex, b: Complex): Complex => ({ re: a.re + b.re, im: a.im + b.im })
const conj = (a: Complex): Complex => ({ re: a.re, im: -a.im })
const abs = (a: Complex): number => Math.hypot(a.re, a.im)
const expi = (t: number): Complex => ({ re: Math.cos(t), im: Math.sin(t) })

/** Register widths past this make a permutation table nobody can read and a dense apply nobody can wait for. */
export const MAX_BLOCK_WIDTH = 10
/** Custom matrices are 2×2 or 4×4 — the sizes a learner can type and check by eye. */
export const MAX_UNITARY_QUBITS = 2
/** ‖U†U − I‖_max above this and the matrix is refused as a gate. */
export const UNITARY_TOLERANCE = 1e-6

// ────────────────────────────────────────────────────────────
// Fixed matrices
// ────────────────────────────────────────────────────────────

/** √X = ½ [[1+i, 1−i], [1−i, 1+i]]. Squares to X; equals H·S·H exactly. */
export function sxMatrix(): [Complex, Complex, Complex, Complex] {
  return [cx(0.5, 0.5), cx(0.5, -0.5), cx(0.5, -0.5), cx(0.5, 0.5)]
}

/** (√X)† = ½ [[1−i, 1+i], [1+i, 1−i]]. */
export function sxdgMatrix(): [Complex, Complex, Complex, Complex] {
  return [cx(0.5, -0.5), cx(0.5, 0.5), cx(0.5, 0.5), cx(0.5, -0.5)]
}

// ────────────────────────────────────────────────────────────
// Operand validation
// ────────────────────────────────────────────────────────────

function assertQubitIndex(q: number, numQubits: number, role: string): void {
  if (!Number.isInteger(q) || q < 0 || q >= numQubits) {
    throw new Error(`${role} index ${q} is out of range for a ${numQubits}-qubit state`)
  }
}

function assertDistinct(qubits: readonly number[], what: string): void {
  if (new Set(qubits).size !== qubits.length) {
    throw new Error(`${what} lists the same qubit twice: [${qubits.join(', ')}]`)
  }
}

// ────────────────────────────────────────────────────────────
// Fredkin
// ────────────────────────────────────────────────────────────

/** Swap qubits a and b on every amplitude whose control bit is 1. In place. */
export function applyCswap(
  data: Float64Array,
  numQubits: number,
  control: number,
  a: number,
  b: number,
): void {
  assertQubitIndex(control, numQubits, 'control qubit')
  assertQubitIndex(a, numQubits, 'qubit')
  assertQubitIndex(b, numQubits, 'qubit')
  if (control === a || control === b) {
    throw new Error(`control qubit ${control} cannot also be one of the swapped qubits`)
  }
  if (a === b) return // swapping a wire with itself is the identity
  const dim = 1 << numQubits
  const cbit = 1 << control, abit = 1 << a, bbit = 1 << b
  for (let i = 0; i < dim; i++) {
    if (!(i & cbit)) continue
    const ai = (i & abit) !== 0, bi = (i & bbit) !== 0
    if (ai === bi) continue
    const j = i ^ abit ^ bbit
    if (j <= i) continue
    for (const k of [0, 1]) {
      const t = data[2 * i + k]
      data[2 * i + k] = data[2 * j + k]
      data[2 * j + k] = t
    }
  }
}

// ────────────────────────────────────────────────────────────
// Dense matrix on a register
// ────────────────────────────────────────────────────────────

/**
 * Read the register value out of a basis index (register[0] = bit 0) and write
 * it back. Both are the only place the little-endian convention is encoded.
 */
function extract(i: number, register: readonly number[]): number {
  let v = 0
  for (let k = 0; k < register.length; k++) if (i & (1 << register[k])) v |= 1 << k
  return v
}
function insert(i: number, register: readonly number[], v: number): number {
  let out = i
  for (let k = 0; k < register.length; k++) {
    const bit = 1 << register[k]
    if (v & (1 << k)) out |= bit
    else out &= ~bit
  }
  return out
}

/**
 * Apply a dense 2^m × 2^m matrix (row-major, `Complex[]`) to a register of m
 * qubits, optionally only where every control qubit reads 1. In place.
 *
 * The matrix is NOT checked for unitarity here — `apply()` does that once per
 * op through `unitarityError`, and this function is also the workhorse for
 * the analytic QFT tests, which feed it the exact DFT.
 */
export function applyMatrixOnRegister(
  data: Float64Array,
  numQubits: number,
  register: readonly number[],
  matrix: readonly Complex[],
  controls: readonly number[] = [],
): void {
  const m = register.length
  if (m < 1) throw new Error('a matrix gate needs at least one register qubit')
  const d = 1 << m
  if (matrix.length !== d * d) {
    throw new Error(`a ${m}-qubit register takes a ${d}×${d} matrix (${d * d} entries), got ${matrix.length}`)
  }
  for (const q of register) assertQubitIndex(q, numQubits, 'register qubit')
  for (const q of controls) assertQubitIndex(q, numQubits, 'control qubit')
  assertDistinct([...controls, ...register], 'matrix gate')
  const dim = 1 << numQubits
  const regMask = register.reduce((acc, q) => acc | (1 << q), 0)
  const ctlMask = controls.reduce((acc, q) => acc | (1 << q), 0)
  const inRe = new Float64Array(d), inIm = new Float64Array(d)
  const idx = new Int32Array(d)
  for (let base = 0; base < dim; base++) {
    if (base & regMask) continue
    if ((base & ctlMask) !== ctlMask) continue
    for (let j = 0; j < d; j++) {
      const i = insert(base, register, j)
      idx[j] = i
      inRe[j] = data[2 * i]
      inIm[j] = data[2 * i + 1]
    }
    for (let r = 0; r < d; r++) {
      let re = 0, im = 0
      for (let col = 0; col < d; col++) {
        const e = matrix[r * d + col]
        re += e.re * inRe[col] - e.im * inIm[col]
        im += e.re * inIm[col] + e.im * inRe[col]
      }
      data[2 * idx[r]] = re
      data[2 * idx[r] + 1] = im
    }
  }
}

// ────────────────────────────────────────────────────────────
// Unitarity
// ────────────────────────────────────────────────────────────

/** Square dimension of a row-major matrix, or -1 if it is not square. */
export function matrixDimension(matrix: readonly Complex[]): number {
  const d = Math.round(Math.sqrt(matrix.length))
  return d * d === matrix.length ? d : -1
}

/** max_ij |(U†U − I)_ij|. Zero for a unitary; NaN entries make it Infinity. */
export function unitarityError(matrix: readonly Complex[]): number {
  const d = matrixDimension(matrix)
  if (d < 1) return Infinity
  let worst = 0
  for (let i = 0; i < d; i++) {
    for (let j = 0; j < d; j++) {
      // (U†U)_ij = Σ_k conj(U_ki) U_kj
      let acc = cx(0)
      for (let k = 0; k < d; k++) acc = add(acc, mul(conj(matrix[k * d + i]), matrix[k * d + j]))
      const target = i === j ? 1 : 0
      const err = Math.hypot(acc.re - target, acc.im)
      if (!Number.isFinite(err)) return Infinity
      if (err > worst) worst = err
    }
  }
  return worst
}

export function isUnitary(matrix: readonly Complex[], tol = UNITARY_TOLERANCE): boolean {
  return unitarityError(matrix) <= tol
}

/** How many qubits a custom matrix acts on, or throws if it is not 2×2 or 4×4. */
export function unitaryQubitCount(matrix: readonly Complex[] | undefined): number {
  if (!matrix) throw new Error('a custom matrix gate needs a matrix')
  const d = matrixDimension(matrix)
  if (d === 2) return 1
  if (d === 4) return 2
  throw new Error(`a custom matrix must be 2×2 or 4×4, got ${matrix.length} entries`)
}

// ────────────────────────────────────────────────────────────
// Matrix entry parser (for the editor — tested, so it lives here)
// ────────────────────────────────────────────────────────────

/**
 * Parse one matrix entry as typed by a learner.
 *
 * Grammar: a sum of terms, each `[sign] value [/ value] [i]`, where a value is
 * a decimal, `pi`, `sqrt2` / `√2`, or `e^(iθ)`-free — phases are typed as
 * cos/sin pairs. Accepted: "1", "-0.5", "i", "-i", "0.5i", "1/sqrt2",
 * "1/2 + 1/2i", "(1+i)/2", "0.7071-0.7071i". Whitespace is ignored.
 * Returns null on anything else; never throws.
 */
export function parseComplexEntry(text: string): Complex | null {
  const s = text.replace(/\s+/g, '').replace(/√2/g, 'sqrt2').toLowerCase()
  if (!s) return null
  // "(a+bi)/n" — a whole bracket divided by a value.
  const bracket = s.match(/^\(([^()]+)\)\/(pi|sqrt2|\d+\.?\d*|\.\d+)$/)
  if (bracket) {
    const inner = parseComplexEntry(bracket[1])
    const den = parseValue(bracket[2])
    if (!inner || den === null || den === 0) return null
    return cx(inner.re / den, inner.im / den)
  }
  const terms = s.match(/[+-]?[^+-]+/g)
  if (!terms || terms.join('') !== s) return null
  let re = 0, im = 0
  for (const term of terms) {
    const m = term.match(/^([+-]?)(pi|sqrt2|\d+\.?\d*|\.\d+)?(?:\/(pi|sqrt2|\d+\.?\d*|\.\d+))?(i?)$/)
    if (!m) return null
    const sign = m[1] === '-' ? -1 : 1
    const imag = m[4] === 'i'
    let value: number | null
    if (m[2] === undefined) {
      if (!imag) return null // a bare sign, or "/2"
      value = 1
    } else {
      value = parseValue(m[2])
    }
    if (value === null) return null
    if (m[3] !== undefined) {
      const den = parseValue(m[3])
      if (den === null || den === 0) return null
      value /= den
    }
    if (imag) im += sign * value
    else re += sign * value
  }
  return cx(re, im)
}

function parseValue(tok: string): number | null {
  if (tok === 'pi') return Math.PI
  if (tok === 'sqrt2') return Math.SQRT2
  if (!/^\d*\.?\d+$|^\d+\.?\d*$/.test(tok)) return null
  const v = parseFloat(tok)
  return Number.isFinite(v) ? v : null
}

/** Compact text for an entry, the inverse of parseComplexEntry for display. */
export function formatComplexEntry(z: Complex, digits = 4): string {
  const r = Math.abs(z.re) < 1e-12 ? 0 : z.re
  const i = Math.abs(z.im) < 1e-12 ? 0 : z.im
  const f = (v: number) => {
    const s = Number(v.toFixed(digits)).toString()
    return s
  }
  if (i === 0) return f(r)
  const imag = Math.abs(i) === 1 ? (i < 0 ? '-i' : 'i') : `${f(i)}i`
  if (r === 0) return imag
  return `${f(r)}${i > 0 && !imag.startsWith('-') ? '+' : ''}${imag}`
}

/** Named 2×2 and 4×4 matrices the editor offers as starting points. */
export const MATRIX_PRESETS: { id: string; label: string; qubits: 1 | 2; entries: string[] }[] = [
  { id: 'h', label: 'H', qubits: 1, entries: ['1/sqrt2', '1/sqrt2', '1/sqrt2', '-1/sqrt2'] },
  { id: 'sx', label: '√X', qubits: 1, entries: ['(1+i)/2', '(1-i)/2', '(1-i)/2', '(1+i)/2'] },
  { id: 'sy', label: '√Y', qubits: 1, entries: ['(1+i)/2', '(-1-i)/2', '(1+i)/2', '(1+i)/2'] },
  { id: 'ph', label: 'e^{iπ/4}Z', qubits: 1, entries: ['1/sqrt2+1/sqrt2i', '0', '0', '-1/sqrt2-1/sqrt2i'] },
  {
    id: 'iswap', label: 'iSWAP', qubits: 2,
    entries: ['1', '0', '0', '0', '0', '0', 'i', '0', '0', 'i', '0', '0', '0', '0', '0', '1'],
  },
  {
    id: 'sqrtswap', label: '√SWAP', qubits: 2,
    entries: [
      '1', '0', '0', '0',
      '0', '(1+i)/2', '(1-i)/2', '0',
      '0', '(1-i)/2', '(1+i)/2', '0',
      '0', '0', '0', '1',
    ],
  },
  {
    id: 'cz', label: 'CZ', qubits: 2,
    entries: ['1', '0', '0', '0', '0', '1', '0', '0', '0', '0', '1', '0', '0', '0', '0', '-1'],
  },
  {
    id: 'cs', label: 'CS', qubits: 2,
    entries: ['1', '0', '0', '0', '0', '1', '0', '0', '0', '0', '1', '0', '0', '0', '0', 'i'],
  },
]

// ────────────────────────────────────────────────────────────
// Permutations: modular arithmetic on a register
// ────────────────────────────────────────────────────────────

export function gcd(a: number, b: number): number {
  a = Math.abs(a); b = Math.abs(b)
  while (b) [a, b] = [b, a % b]
  return a
}

function assertModulus(modulus: number, width: number): void {
  if (!Number.isInteger(modulus) || modulus < 1) {
    throw new Error(`modulus must be a positive integer, got ${modulus}`)
  }
  if (!Number.isInteger(width) || width < 1 || width > MAX_BLOCK_WIDTH) {
    throw new Error(`register width must be an integer between 1 and ${MAX_BLOCK_WIDTH}, got ${width}`)
  }
  if (modulus > 1 << width) {
    throw new Error(`modulus ${modulus} does not fit in a ${width}-qubit register (max ${1 << width})`)
  }
}

/**
 * The permutation x ↦ (x + k) mod N on a register of `width` qubits.
 *
 * Values x ≥ N are outside the arithmetic and are left alone; that is what
 * keeps the map a bijection (and hence a unitary) on the whole register.
 */
export function modularAddPermutation(k: number, modulus: number, width: number): number[] {
  assertModulus(modulus, width)
  if (!Number.isInteger(k)) throw new Error(`k must be an integer, got ${k}`)
  const d = 1 << width
  const kk = ((k % modulus) + modulus) % modulus
  return Array.from({ length: d }, (_, x) => (x < modulus ? (x + kk) % modulus : x))
}

/**
 * The permutation x ↦ (k·x) mod N. Requires gcd(k, N) = 1 — otherwise two
 * inputs collide, the map is not invertible, and there is no unitary that
 * implements it. Shor's circuit only ever needs k coprime to N.
 */
export function modularMulPermutation(k: number, modulus: number, width: number): number[] {
  assertModulus(modulus, width)
  if (!Number.isInteger(k)) throw new Error(`k must be an integer, got ${k}`)
  const kk = ((k % modulus) + modulus) % modulus
  if (modulus > 1 && gcd(kk, modulus) !== 1) {
    throw new Error(`×${k} mod ${modulus} is not reversible: gcd(${k}, ${modulus}) = ${gcd(kk, modulus)} ≠ 1`)
  }
  const d = 1 << width
  return Array.from({ length: d }, (_, x) => (x < modulus ? (kk * x) % modulus : x))
}

/** True when `perm` is a bijection on [0, perm.length). */
export function isPermutation(perm: readonly number[]): boolean {
  const seen = new Uint8Array(perm.length)
  for (const p of perm) {
    if (!Number.isInteger(p) || p < 0 || p >= perm.length || seen[p]) return false
    seen[p] = 1
  }
  return true
}

/**
 * |x⟩ ↦ |perm[x]⟩ on a register, optionally controlled. In place (via a copy —
 * a permutation moves whole amplitudes, so gather/scatter beats pairwise swaps).
 */
export function applyPermutationOnRegister(
  data: Float64Array,
  numQubits: number,
  register: readonly number[],
  perm: readonly number[],
  controls: readonly number[] = [],
): void {
  const m = register.length
  if (m < 1) throw new Error('a register block needs at least one register qubit')
  if (perm.length !== 1 << m) {
    throw new Error(`a ${m}-qubit register takes a permutation of ${1 << m} values, got ${perm.length}`)
  }
  if (!isPermutation(perm)) throw new Error('block is not a permutation of the register values')
  for (const q of register) assertQubitIndex(q, numQubits, 'register qubit')
  for (const q of controls) assertQubitIndex(q, numQubits, 'control qubit')
  assertDistinct([...controls, ...register], 'register block')
  const dim = 1 << numQubits
  const ctlMask = controls.reduce((acc, q) => acc | (1 << q), 0)
  const src = data.slice()
  for (let i = 0; i < dim; i++) {
    if ((i & ctlMask) !== ctlMask) continue
    const j = insert(i, register, perm[extract(i, register)])
    data[2 * j] = src[2 * i]
    data[2 * j + 1] = src[2 * i + 1]
  }
}

// ────────────────────────────────────────────────────────────
// Quantum Fourier transform
// ────────────────────────────────────────────────────────────

/** Multiply every amplitude with both bits set by e^{iθ}. */
function controlledPhase(data: Float64Array, dim: number, a: number, b: number, theta: number, ctlMask: number): void {
  const mask = (1 << a) | (1 << b) | ctlMask
  const ph = expi(theta)
  for (let i = 0; i < dim; i++) {
    if ((i & mask) !== mask) continue
    const re = data[2 * i], im = data[2 * i + 1]
    data[2 * i] = re * ph.re - im * ph.im
    data[2 * i + 1] = re * ph.im + im * ph.re
  }
}

function hadamard(data: Float64Array, dim: number, q: number, ctlMask: number): void {
  const bit = 1 << q
  const r = Math.SQRT1_2
  for (let i = 0; i < dim; i++) {
    if (i & bit) continue
    if ((i & ctlMask) !== ctlMask) continue
    const j = i | bit
    const are = data[2 * i], aim = data[2 * i + 1]
    const bre = data[2 * j], bim = data[2 * j + 1]
    data[2 * i] = r * (are + bre); data[2 * i + 1] = r * (aim + bim)
    data[2 * j] = r * (are - bre); data[2 * j + 1] = r * (aim - bim)
  }
}

function swapBits(data: Float64Array, dim: number, a: number, b: number, ctlMask: number): void {
  if (a === b) return
  const abit = 1 << a, bbit = 1 << b
  for (let i = 0; i < dim; i++) {
    if ((i & ctlMask) !== ctlMask) continue
    const ai = (i & abit) !== 0, bi = (i & bbit) !== 0
    if (ai === bi) continue
    const j = i ^ abit ^ bbit
    if (j <= i) continue
    for (const k of [0, 1]) {
      const t = data[2 * i + k]; data[2 * i + k] = data[2 * j + k]; data[2 * j + k] = t
    }
  }
}

/**
 * QFT on a register: |x⟩ ↦ 2^{-m/2} Σ_y e^{2πi·xy/2^m} |y⟩, with register[0]
 * the least significant bit of both x and y. `inverse` applies the adjoint.
 *
 * Built from the textbook H / controlled-phase ladder plus the final bit
 * reversal, so it costs O(m²·2^n) rather than a dense 2^m × 2^m apply. The
 * test suite pins it against the DFT matrix applied through
 * applyMatrixOnRegister, which is the independent definition.
 */
export function applyQft(
  data: Float64Array,
  numQubits: number,
  register: readonly number[],
  inverse = false,
  controls: readonly number[] = [],
): void {
  const m = register.length
  if (m < 1) throw new Error('QFT needs at least one register qubit')
  if (m > MAX_BLOCK_WIDTH) throw new Error(`QFT register is limited to ${MAX_BLOCK_WIDTH} qubits`)
  for (const q of register) assertQubitIndex(q, numQubits, 'register qubit')
  for (const q of controls) assertQubitIndex(q, numQubits, 'control qubit')
  assertDistinct([...controls, ...register], 'QFT')
  const dim = 1 << numQubits
  const ctlMask = controls.reduce((acc, q) => acc | (1 << q), 0)
  const sign = inverse ? -1 : 1

  // Forward: for the most significant qubit downwards, H then the phase ladder
  // from every less-significant qubit; finish with the bit reversal. The
  // inverse is the same steps in reverse order with negated angles.
  const steps: (() => void)[] = []
  for (let j = m - 1; j >= 0; j--) {
    steps.push(() => hadamard(data, dim, register[j], ctlMask))
    for (let k = j - 1; k >= 0; k--) {
      const angle = sign * Math.PI / (1 << (j - k))
      steps.push(() => controlledPhase(data, dim, register[k], register[j], angle, ctlMask))
    }
  }
  for (let j = 0; j < m >> 1; j++) {
    steps.push(() => swapBits(data, dim, register[j], register[m - 1 - j], ctlMask))
  }
  if (inverse) steps.reverse()
  for (const step of steps) step()
}

/** The exact DFT matrix on m qubits, row-major — the reference the QFT is tested against. */
export function dftMatrix(m: number, inverse = false): Complex[] {
  const d = 1 << m
  const out: Complex[] = []
  const s = inverse ? -1 : 1
  for (let r = 0; r < d; r++) {
    for (let col = 0; col < d; col++) {
      const z = expi((s * 2 * Math.PI * ((r * col) % d)) / d)
      out.push(cx(z.re / Math.sqrt(d), z.im / Math.sqrt(d)))
    }
  }
  return out
}

/** The permutation matrix of `perm` (column x has its 1 in row perm[x]), row-major. */
export function permutationMatrix(perm: readonly number[]): Complex[] {
  const d = perm.length
  const out: Complex[] = Array.from({ length: d * d }, () => cx(0))
  perm.forEach((to, from) => { out[to * d + from] = cx(1) })
  return out
}

// ────────────────────────────────────────────────────────────
// Two-qubit unitary → OpenQASM 3 stdgates (Givens / QR synthesis)
// ────────────────────────────────────────────────────────────

/**
 * ZYZ-style parameters for one 2×2 unitary: V = e^{iγ} · U(θ, φ, λ) with
 * OpenQASM's U(θ,φ,λ) = [[cos θ/2, −e^{iλ} sin θ/2], [e^{iφ} sin θ/2, e^{i(φ+λ)} cos θ/2]].
 */
export function u3Parameters(v: readonly Complex[]): { theta: number; phi: number; lambda: number; gamma: number } {
  if (v.length !== 4) throw new Error('u3Parameters takes a 2×2 matrix')
  const [a, b, cc, d] = v
  const cos = Math.min(1, abs(a))
  const sin = Math.min(1, abs(cc))
  const theta = 2 * Math.atan2(sin, cos)
  // Phases. With θ in [0, π]: arg(a) = γ, arg(c) = γ + φ, arg(−b) = γ + λ,
  // arg(d) = γ + φ + λ. Degenerate rows (sin or cos = 0) leave one phase free.
  const argOr = (z: Complex, fallback: number) => (abs(z) > 1e-12 ? Math.atan2(z.im, z.re) : fallback)
  let gamma: number, phi: number, lambda: number
  if (cos > 1e-9 && sin > 1e-9) {
    gamma = argOr(a, 0)
    phi = argOr(cc, 0) - gamma
    lambda = argOr({ re: -b.re, im: -b.im }, 0) - gamma
  } else if (cos > 1e-9) {
    // Diagonal: a = e^{iγ}, d = e^{i(γ+φ+λ)}. Put it all in λ.
    gamma = argOr(a, 0)
    phi = 0
    lambda = argOr(d, 0) - gamma
  } else {
    // Anti-diagonal: c = e^{i(γ+φ)}, −b = e^{i(γ+λ)}. Choose γ = 0.
    gamma = 0
    phi = argOr(cc, 0)
    lambda = argOr({ re: -b.re, im: -b.im }, 0)
  }
  return { theta, phi, lambda, gamma }
}

/** OpenQASM U(θ,φ,λ) as a matrix — used by the tests to close the loop on u3Parameters. */
export function u3Matrix(theta: number, phi: number, lambda: number): Complex[] {
  const ct = Math.cos(theta / 2), st = Math.sin(theta / 2)
  const el = expi(lambda), ep = expi(phi), epl = expi(phi + lambda)
  return [cx(ct), cx(-el.re * st, -el.im * st), cx(ep.re * st, ep.im * st), cx(epl.re * ct, epl.im * ct)]
}

/**
 * One two-level step of the synthesis: a 2×2 unitary acting on basis states
 * `lo` and `hi` (which differ in exactly one bit) of the 2-qubit register.
 */
export interface TwoLevelStep {
  /** Which register bit (0 or 1) differs between the two basis states. */
  target: 0 | 1
  /** The other bit's value on both states — the control, possibly negated. */
  controlValue: 0 | 1
  /** The 2×2 acting on (|…0…⟩, |…1…⟩) of the target bit. */
  v: Complex[]
}

/** Build the 4×4 matrix of a two-level step (register bit 0 = LSB). */
function twoLevelMatrix(step: TwoLevelStep): Complex[] {
  const out: Complex[] = Array.from({ length: 16 }, (_, i) => cx(i % 5 === 0 ? 1 : 0))
  const other = step.target === 0 ? 1 : 0
  const lo = step.controlValue << other
  const hi = lo | (1 << step.target)
  out[lo * 4 + lo] = step.v[0]; out[lo * 4 + hi] = step.v[1]
  out[hi * 4 + lo] = step.v[2]; out[hi * 4 + hi] = step.v[3]
  return out
}

function matMul(a: readonly Complex[], b: readonly Complex[], d: number): Complex[] {
  const out: Complex[] = []
  for (let i = 0; i < d; i++) for (let j = 0; j < d; j++) {
    let acc = cx(0)
    for (let k = 0; k < d; k++) acc = add(acc, mul(a[i * d + k], b[k * d + j]))
    out.push(acc)
  }
  return out
}
function dagger(a: readonly Complex[], d: number): Complex[] {
  const out: Complex[] = []
  for (let i = 0; i < d; i++) for (let j = 0; j < d; j++) out.push(conj(a[j * d + i]))
  return out
}

export interface TwoQubitSynthesis {
  /** Phases applied FIRST, as a diagonal indexed by register value. */
  diagonal: number[]
  /** Then these, in order (steps[0] right after the diagonal). */
  steps: TwoLevelStep[]
}

/**
 * Write a 4×4 unitary as a diagonal of phases followed by two-level unitaries
 * between basis states that differ in one bit:
 *
 *     U = S_n · … · S_1 · D          (D acts first on a state)
 *
 * QR by Givens rotations in Gray-code row order (00, 01, 11, 10), so every
 * rotation pairs basis states one bit apart and becomes a singly-controlled U
 * in OpenQASM. Exact for any unitary input; the tests reconstruct the product.
 */
export function synthesizeTwoQubit(u: readonly Complex[]): TwoQubitSynthesis {
  if (u.length !== 16) throw new Error('synthesizeTwoQubit takes a 4×4 matrix')
  const gray = [0, 1, 3, 2]
  // Work on a copy; left-multiplying by G introduces zeros: G_n … G_1 U = D,
  // hence U = G_1† … G_n† D.
  let w: Complex[] = u.slice()
  const inverses: TwoLevelStep[] = []
  // Process columns in Gray order; within Gray position p, eliminate entries at
  // Gray positions > p from the bottom up, each rotation pairing consecutive
  // Gray rows (r−1, r) and zeroing row gray[r].
  for (let p = 0; p < 3; p++) {
    const col = gray[p]
    for (let r = 3; r > p; r--) {
      const zeroRow = gray[r], keepRow = gray[r - 1]
      const keep = w[keepRow * 4 + col], zero = w[zeroRow * 4 + col]
      if (abs(zero) < 1e-15) continue
      const n = Math.hypot(abs(keep), abs(zero))
      const target: 0 | 1 = ((keepRow ^ zeroRow) === 1 ? 0 : 1)
      const other = target === 0 ? 1 : 0
      const controlValue: 0 | 1 = ((keepRow >> other) & 1) as 0 | 1
      // The 2×2 acts on (x0, x1) = amplitudes of the target-bit-0 and -1 states.
      const keepIsX0 = ((keepRow >> target) & 1) === 0
      // keepIsX0:  G [keep; zero] = [n; 0]  with  G = 1/n [[k̄, z̄], [−z, k]]
      // else:      G [zero; keep] = [0; n]  with  G = 1/n [[k, −z], [z̄, k̄]]
      const g: Complex[] = keepIsX0
        ? [cx(keep.re / n, -keep.im / n), cx(zero.re / n, -zero.im / n),
           cx(-zero.re / n, -zero.im / n), cx(keep.re / n, keep.im / n)]
        : [cx(keep.re / n, keep.im / n), cx(-zero.re / n, -zero.im / n),
           cx(zero.re / n, -zero.im / n), cx(keep.re / n, -keep.im / n)]
      const stepG: TwoLevelStep = { target, controlValue, v: g }
      w = matMul(twoLevelMatrix(stepG), w, 4)
      inverses.push({ target, controlValue, v: dagger(g, 2) })
    }
  }
  // w is now diagonal (unitary ⇒ unit-modulus phases).
  const diagonal = [0, 1, 2, 3].map((i) => Math.atan2(w[i * 4 + i].im, w[i * 4 + i].re))
  // U = G_1† … G_n† D: D first, then G_n†, …, G_1†.
  return { diagonal, steps: inverses.reverse() }
}

/** Reassemble a synthesis into a 4×4 (test helper and definition of the ordering). */
export function synthesisMatrix(s: TwoQubitSynthesis): Complex[] {
  let m: Complex[] = Array.from({ length: 16 }, (_, i) => (i % 5 === 0 ? expi(s.diagonal[i / 5]) : cx(0)))
  for (const step of s.steps) m = matMul(twoLevelMatrix(step), m, 4)
  return m
}

/**
 * OpenQASM 3 statements (gate-body form, operands `a` = register bit 0 and
 * `b` = register bit 1) that implement a 4×4 unitary exactly, global phase
 * included via gphase.
 */
export function twoQubitToQasmBody(u: readonly Complex[], fmt: (x: number) => string = (x) => String(x)): string[] {
  const s = synthesizeTwoQubit(u)
  const lines: string[] = []
  const name = (bit: 0 | 1) => (bit === 0 ? 'a' : 'b')
  // The diagonal acts first. diag(e^{iδ00}, e^{iδ01}, e^{iδ10}, e^{iδ11}) with
  // index = (b << 1) | a is e^{iδ00} · P_a(δ01−δ00) · P_b(δ10−δ00) · CP(δ11−δ10−δ01+δ00).
  const [d00, d01, d10, d11] = s.diagonal
  if (Math.abs(d00) > 1e-15) lines.push(`gphase(${fmt(d00)});`)
  if (Math.abs(d01 - d00) > 1e-15) lines.push(`p(${fmt(d01 - d00)}) a;`)
  if (Math.abs(d10 - d00) > 1e-15) lines.push(`p(${fmt(d10 - d00)}) b;`)
  const cp = d11 - d10 - d01 + d00
  if (Math.abs(cp) > 1e-15) lines.push(`cp(${fmt(cp)}) a, b;`)
  for (const step of s.steps) {
    const { theta, phi, lambda, gamma } = u3Parameters(step.v)
    const t = name(step.target), ctl = name(step.target === 0 ? 1 : 0)
    if (step.controlValue === 0) lines.push(`x ${ctl};`)
    lines.push(`ctrl @ U(${fmt(theta)}, ${fmt(phi)}, ${fmt(lambda)}) ${ctl}, ${t};`)
    if (Math.abs(gamma) > 1e-15) lines.push(`p(${fmt(gamma)}) ${ctl};`)
    if (step.controlValue === 0) lines.push(`x ${ctl};`)
  }
  return lines
}

/** Gate-body statements for a 2×2 unitary, likewise exact. */
export function oneQubitToQasmBody(u: readonly Complex[], fmt: (x: number) => string = (x) => String(x)): string[] {
  const { theta, phi, lambda, gamma } = u3Parameters(u)
  const lines: string[] = []
  if (Math.abs(gamma) > 1e-15) lines.push(`gphase(${fmt(gamma)});`)
  lines.push(`U(${fmt(theta)}, ${fmt(phi)}, ${fmt(lambda)}) a;`)
  return lines
}

// ────────────────────────────────────────────────────────────
// Permutation → OpenQASM 3 (multi-controlled X ladder)
// ────────────────────────────────────────────────────────────

/**
 * Gate-body statements implementing |x⟩ ↦ |perm[x]⟩ on operands r0 … r{m−1}
 * (r0 = least significant). The permutation is factored into transpositions
 * (a b); each transposition of two basis states is an X ladder: flip every bit
 * where a and b differ except one, conditioned on the remaining bits — a
 * multi-controlled X with negated controls written as X conjugations.
 *
 * Correct but not compact; it exists so an exported Shor circuit is real
 * OpenQASM that another simulator can run, not a pragma it will ignore.
 */
export function permutationToQasmBody(perm: readonly number[], width: number): string[] {
  if (perm.length !== 1 << width || !isPermutation(perm)) {
    throw new Error('permutationToQasmBody needs a permutation of 2^width values')
  }
  const lines: string[] = []
  const r = (i: number) => `r${i}`
  // Decompose into transpositions by walking cycles. For a cycle c0 → c1 → …
  // → c_{L−1} → c0, applying (c0 c1) first, then (c0 c2), …, then (c0 c_{L−1})
  // sends c0 → c1 (untouched afterwards), c1 → c0 → c2, and so on. Gate-body
  // statements execute first-to-last, so that is the emission order.
  const seen = new Uint8Array(perm.length)
  const transpositions: [number, number][] = []
  for (let start = 0; start < perm.length; start++) {
    if (seen[start] || perm[start] === start) { seen[start] = 1; continue }
    const cycle: number[] = []
    let x = start
    while (!seen[x]) { seen[x] = 1; cycle.push(x); x = perm[x] }
    for (let i = 1; i < cycle.length; i++) transpositions.push([cycle[0], cycle[i]])
  }
  for (const [a, b] of transpositions) {
    const diff = a ^ b
    // Pick the highest differing bit as the X target; the others are flipped
    // conditionally before and after so the swap touches exactly |a⟩ and |b⟩.
    const bits = Array.from({ length: width }, (_, i) => i).filter((i) => diff & (1 << i))
    const target = bits[bits.length - 1]
    const helpers = bits.slice(0, -1)
    const controls = Array.from({ length: width }, (_, i) => i).filter((i) => i !== target)
    // State a with the helper bits already folded: after the helper CNOTs
    // (target-controlled), a and b agree on every non-target bit, and that
    // shared pattern is `a` with helper bits xor'd by a's target bit.
    const aTarget = (a >> target) & 1
    const pattern = helpers.reduce((acc, h) => (aTarget ? acc ^ (1 << h) : acc), a)
    const negated = controls.filter((q) => !((pattern >> q) & 1))
    const ladder: string[] = []
    for (const h of helpers) ladder.push(`cx ${r(target)}, ${r(h)};`)
    for (const q of negated) ladder.push(`x ${r(q)};`)
    if (controls.length === 0) ladder.push(`x ${r(target)};`)
    else ladder.push(`ctrl(${controls.length}) @ x ${controls.map(r).join(', ')}, ${r(target)};`)
    for (const q of negated) ladder.push(`x ${r(q)};`)
    for (const h of [...helpers].reverse()) ladder.push(`cx ${r(target)}, ${r(h)};`)
    lines.push(...ladder)
  }
  return lines
}

/** Gate-body statements for the QFT (or its inverse) on operands r0 … r{m−1}. */
export function qftToQasmBody(width: number, inverse: boolean, fmt: (x: number) => string = (x) => String(x)): string[] {
  const r = (i: number) => `r${i}`
  const lines: string[] = []
  const sign = inverse ? -1 : 1
  for (let j = width - 1; j >= 0; j--) {
    lines.push(`h ${r(j)};`)
    for (let k = j - 1; k >= 0; k--) lines.push(`cp(${fmt(sign * Math.PI / (1 << (j - k)))}) ${r(k)}, ${r(j)};`)
  }
  for (let j = 0; j < width >> 1; j++) lines.push(`swap ${r(j)}, ${r(width - 1 - j)};`)
  if (inverse) lines.reverse()
  return lines
}

// ────────────────────────────────────────────────────────────
// Presets built from the blocks
// ────────────────────────────────────────────────────────────

/**
 * Kept apart from PRESETS in quantum.ts on purpose: services/api's crosscheck
 * runs every entry of PRESETS through Qiskit, and these depend on the qb16_*
 * gate definitions the exporter writes, which that harness has not been
 * taught to trust yet. The simulator page lists both.
 */
export const EXTENDED_PRESETS: Preset[] = [
  {
    id: 'period-2-mod-3',
    name: 'Period finding, ×2 mod 3 (4 qubits)',
    blurb:
      'The smallest Shor-shaped circuit. The work register (q2, q3) starts at |1⟩ and is multiplied by ' +
      '2 mod 3 under the control of each counting qubit: 1 → 2 → 1, so the period is 2. After the inverse ' +
      'QFT the counting register (q0, q1) reads 0 or 2 — multiples of 4/2 — and never 1 or 3.',
    circuit: {
      numQubits: 4,
      ops: [
        { name: 'X', qubits: [2] },
        { name: 'H', qubits: [0] },
        { name: 'H', qubits: [1] },
        { name: 'BARRIER', qubits: [] },
        { name: 'MULK', qubits: [0, 2, 3], k: 2, modulus: 3, controls: 1 },
        { name: 'MULK', qubits: [1, 2, 3], k: 1, modulus: 3, controls: 1 },
        { name: 'BARRIER', qubits: [] },
        { name: 'IQFT', qubits: [0, 1] },
      ],
    },
  },
  {
    id: 'shor-15',
    name: "Shor's order finding, N = 15, a = 7 (7 qubits)",
    blurb:
      'The textbook instance. Counting register q0–q2 in superposition; work register q3–q6 starts at |1⟩ ' +
      'and is multiplied by 7, then 7² ≡ 4, then 7⁴ ≡ 1 (mod 15), each under one counting qubit. The ' +
      'inverse QFT turns the period-4 orbit {1, 7, 4, 13} into peaks at 0, 2, 4, 6 — read the period as 8/2.',
    circuit: {
      numQubits: 7,
      ops: [
        { name: 'X', qubits: [3] },
        { name: 'H', qubits: [0] },
        { name: 'H', qubits: [1] },
        { name: 'H', qubits: [2] },
        { name: 'BARRIER', qubits: [] },
        { name: 'MULK', qubits: [0, 3, 4, 5, 6], k: 7, modulus: 15, controls: 1 },
        { name: 'MULK', qubits: [1, 3, 4, 5, 6], k: 4, modulus: 15, controls: 1 },
        { name: 'MULK', qubits: [2, 3, 4, 5, 6], k: 1, modulus: 15, controls: 1 },
        { name: 'BARRIER', qubits: [] },
        { name: 'IQFT', qubits: [0, 1, 2] },
      ],
    },
  },
]
