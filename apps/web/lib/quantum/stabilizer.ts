/**
 * lib/quantum/stabilizer.ts — a Clifford (stabilizer) simulator.
 *
 * lib/quantum.ts stores 2^n amplitudes and stops at 16 qubits. This stores the
 * state as the n Pauli operators that stabilize it — the Aaronson–Gottesman
 * tableau (Phys. Rev. A 70, 052328, 2004) — which costs 2n(2n+1) BITS, so a
 * thousand qubits is a few hundred kilobytes. The price is the gate set:
 * Clifford gates and Pauli measurements only. A T gate has no tableau.
 *
 * Layout: rows 0..n-1 are destabilizers, rows n..2n-1 are the stabilizer
 * generators, row 2n is scratch for deterministic measurements. Each row is n
 * x-bits, n z-bits (packed 32 to a word) and one sign bit.
 *
 * Qubit q is bit q, the same little-endian convention StateVector uses, so the
 * cross-checks in stabilizer.test.ts compare the two engines index for index.
 *
 * Destabilizer SIGNS are not meaningful after a measurement (rowsum on two
 * anticommuting rows has no ±1 answer, and the algorithm never reads it).
 * Stabilizer signs always are.
 */

function popcount(v: number): number {
  v = v - ((v >>> 1) & 0x55555555)
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333)
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24
}

export interface MeasureResult {
  outcome: 0 | 1
  /** False when the outcome was a fair coin; true when the state fixed it. */
  deterministic: boolean
}

export class Tableau {
  readonly n: number
  private readonly w: number
  private readonly x: Uint32Array
  private readonly z: Uint32Array
  private readonly r: Uint8Array

  /** The all-|0⟩ state on n qubits. */
  constructor(n: number) {
    if (!Number.isInteger(n) || n < 1 || n > MAX_STABILIZER_QUBITS) {
      throw new Error(`numQubits must be an integer between 1 and ${MAX_STABILIZER_QUBITS}`)
    }
    this.n = n
    this.w = Math.ceil(n / 32)
    const rows = 2 * n + 1
    this.x = new Uint32Array(rows * this.w)
    this.z = new Uint32Array(rows * this.w)
    this.r = new Uint8Array(rows)
    for (let i = 0; i < n; i++) {
      this.x[i * this.w + (i >>> 5)] |= 1 << (i & 31)
      this.z[(n + i) * this.w + (i >>> 5)] |= 1 << (i & 31)
    }
  }

  clone(): Tableau {
    const t = new Tableau(this.n)
    t.x.set(this.x)
    t.z.set(this.z)
    t.r.set(this.r)
    return t
  }

  private check(q: number): void {
    if (!Number.isInteger(q) || q < 0 || q >= this.n) {
      throw new Error(`qubit ${q} is out of range for a ${this.n}-qubit tableau`)
    }
  }

  h(a: number): this {
    this.check(a)
    const wi = a >>> 5
    const m = 1 << (a & 31)
    for (let row = 0, idx = wi; row < 2 * this.n; row++, idx += this.w) {
      const xv = this.x[idx] & m
      const zv = this.z[idx] & m
      if (xv && zv) this.r[row] ^= 1
      if (!xv !== !zv) {
        this.x[idx] ^= m
        this.z[idx] ^= m
      }
    }
    return this
  }

  s(a: number): this {
    this.check(a)
    const wi = a >>> 5
    const m = 1 << (a & 31)
    for (let row = 0, idx = wi; row < 2 * this.n; row++, idx += this.w) {
      if (this.x[idx] & m) {
        if (this.z[idx] & m) this.r[row] ^= 1
        this.z[idx] ^= m
      }
    }
    return this
  }

  /** Pauli gates only move signs: a row picks one up when it anticommutes. */
  private pauli(a: number, flipOnX: boolean, flipOnZ: boolean): this {
    this.check(a)
    const wi = a >>> 5
    const m = 1 << (a & 31)
    for (let row = 0, idx = wi; row < 2 * this.n; row++, idx += this.w) {
      const hit = (flipOnX && (this.x[idx] & m) !== 0) !== (flipOnZ && (this.z[idx] & m) !== 0)
      if (hit) this.r[row] ^= 1
    }
    return this
  }

  x_(a: number): this {
    return this.pauli(a, false, true)
  }

  y(a: number): this {
    return this.pauli(a, true, true)
  }

  z_(a: number): this {
    return this.pauli(a, true, false)
  }

  sdg(a: number): this {
    return this.z_(a).s(a)
  }

  /** √X, up to a global phase the tableau cannot see. */
  sx(a: number): this {
    return this.h(a).s(a).h(a)
  }

  sxdg(a: number): this {
    return this.h(a).sdg(a).h(a)
  }

  cx(c: number, t: number): this {
    this.check(c)
    this.check(t)
    if (c === t) throw new Error('control and target must differ')
    const cw = c >>> 5
    const cm = 1 << (c & 31)
    const tw = t >>> 5
    const tm = 1 << (t & 31)
    for (let row = 0, base = 0; row < 2 * this.n; row++, base += this.w) {
      const xc = (this.x[base + cw] & cm) !== 0
      const zt = (this.z[base + tw] & tm) !== 0
      if (xc && zt) {
        const xt = (this.x[base + tw] & tm) !== 0
        const zc = (this.z[base + cw] & cm) !== 0
        if (xt === zc) this.r[row] ^= 1
      }
      if (xc) this.x[base + tw] ^= tm
      if (zt) this.z[base + cw] ^= cm
    }
    return this
  }

  cz(a: number, b: number): this {
    return this.h(b).cx(a, b).h(b)
  }

  cy(c: number, t: number): this {
    return this.sdg(t).cx(c, t).s(t)
  }

  swap(a: number, b: number): this {
    return this.cx(a, b).cx(b, a).cx(a, b)
  }

  /**
   * Apply a two-qubit Clifford given as a lookup table: entry p — a Pauli on
   * (a, b) packed as x_a | z_a<<1 | x_b<<2 | z_b<<3 — holds its image in the
   * low four bits and a sign flip in bit 4. One pass over the rows, whatever
   * the gate, instead of one pass per H, S and CNOT it would decompose into.
   */
  applyPauliTable(a: number, b: number, table: Uint8Array): this {
    this.check(a)
    this.check(b)
    if (a === b) throw new Error('the two qubits must differ')
    const aw = a >>> 5
    const am = 1 << (a & 31)
    const bw = b >>> 5
    const bm = 1 << (b & 31)
    for (let row = 0, base = 0; row < 2 * this.n; row++, base += this.w) {
      const p =
        (this.x[base + aw] & am ? 1 : 0) |
        (this.z[base + aw] & am ? 2 : 0) |
        (this.x[base + bw] & bm ? 4 : 0) |
        (this.z[base + bw] & bm ? 8 : 0)
      if (p === 0) continue
      const e = table[p]
      const d = p ^ e
      if (d & 1) this.x[base + aw] ^= am
      if (d & 2) this.z[base + aw] ^= am
      if (d & 4) this.x[base + bw] ^= bm
      if (d & 8) this.z[base + bw] ^= bm
      if (e & 16) this.r[row] ^= 1
    }
    return this
  }

  /**
   * The lookup table for applyPauliTable, read off by pushing all fifteen
   * two-qubit Paulis through `gates` as the rows of a two-qubit tableau.
   */
  static pauliTable(gates: (t: Tableau) => void): Uint8Array {
    const table = new Uint8Array(16)
    for (let first = 0; first < 16; first += 4) {
      const t = new Tableau(2)
      for (let row = 0; row < 4; row++) {
        t.x[row] = ((first + row) & 1) | (((first + row) >> 2) & 1) << 1
        t.z[row] = (((first + row) >> 1) & 1) | (((first + row) >> 3) & 1) << 1
      }
      gates(t)
      for (let row = 0; row < 4; row++) {
        const x = t.x[row]
        const z = t.z[row]
        table[first + row] = (x & 1) | ((z & 1) << 1) | ((x & 2) << 1) | ((z & 2) << 2) | (t.r[row] << 4)
      }
    }
    return table
  }

  /**
   * Row h ← row i · row h, with the sign tracked. The exponent of i picked up
   * at each qubit is Aaronson–Gottesman's g(); it is +1 for the cyclic products
   * (XY, YZ, ZX) and −1 for the reverse, computed a word at a time.
   */
  private rowsum(h: number, i: number): void {
    const hb = h * this.w
    const ib = i * this.w
    let sum = 0
    for (let k = 0; k < this.w; k++) {
      const x1 = this.x[ib + k]
      const z1 = this.z[ib + k]
      const x2 = this.x[hb + k]
      const z2 = this.z[hb + k]
      const plus = (x1 & z1 & z2 & ~x2) | (x1 & ~z1 & z2 & x2) | (~x1 & z1 & x2 & ~z2)
      const minus = (x1 & z1 & x2 & ~z2) | (x1 & ~z1 & z2 & ~x2) | (~x1 & z1 & x2 & z2)
      sum += popcount(plus) - popcount(minus)
      this.x[hb + k] = x1 ^ x2
      this.z[hb + k] = z1 ^ z2
    }
    const total = (((2 * this.r[h] + 2 * this.r[i] + sum) % 4) + 4) % 4
    this.r[h] = total & 2 ? 1 : 0
  }

  /** True when a Z measurement of qubit a has a fixed outcome in this state. */
  isDeterministic(a: number): boolean {
    this.check(a)
    const wi = a >>> 5
    const m = 1 << (a & 31)
    for (let row = this.n; row < 2 * this.n; row++) {
      if (this.x[row * this.w + wi] & m) return false
    }
    return true
  }

  /** Projective Z measurement of qubit a. Collapses the state. */
  measure(a: number, rng: () => number = Math.random): MeasureResult {
    this.check(a)
    const n = this.n
    const wi = a >>> 5
    const m = 1 << (a & 31)

    let p = -1
    for (let row = n; row < 2 * n; row++) {
      if (this.x[row * this.w + wi] & m) {
        p = row
        break
      }
    }

    if (p >= 0) {
      // Some stabilizer anticommutes with Z_a: the outcome is a fair coin.
      for (let row = 0; row < 2 * n; row++) {
        if (row !== p && this.x[row * this.w + wi] & m) this.rowsum(row, p)
      }
      const dst = (p - n) * this.w
      const src = p * this.w
      for (let k = 0; k < this.w; k++) {
        this.x[dst + k] = this.x[src + k]
        this.z[dst + k] = this.z[src + k]
        this.x[src + k] = 0
        this.z[src + k] = 0
      }
      this.r[p - n] = this.r[p]
      this.z[src + wi] = m
      const outcome: 0 | 1 = rng() < 0.5 ? 0 : 1
      this.r[p] = outcome
      return { outcome, deterministic: false }
    }

    // Z_a is already in the stabilizer group (up to sign). Read the sign off by
    // multiplying together the stabilizers whose destabilizer partner hits a.
    const scratch = 2 * n
    const sb = scratch * this.w
    for (let k = 0; k < this.w; k++) {
      this.x[sb + k] = 0
      this.z[sb + k] = 0
    }
    this.r[scratch] = 0
    for (let i = 0; i < n; i++) {
      if (this.x[i * this.w + wi] & m) this.rowsum(scratch, i + n)
    }
    return { outcome: this.r[scratch] ? 1 : 0, deterministic: true }
  }

  /** Measure, then flip back to |0⟩ if the outcome was 1. */
  reset(a: number, rng: () => number = Math.random): this {
    if (this.measure(a, rng).outcome === 1) this.x_(a)
    return this
  }

  private rowString(row: number): string {
    let out = this.r[row] ? '-' : '+'
    for (let q = 0; q < this.n; q++) {
      const m = 1 << (q & 31)
      const xv = this.x[row * this.w + (q >>> 5)] & m
      const zv = this.z[row * this.w + (q >>> 5)] & m
      out += xv ? (zv ? 'Y' : 'X') : zv ? 'Z' : 'I'
    }
    return out
  }

  /**
   * The n stabilizer generators, e.g. ["+XX", "+ZZ"]. Character k of each
   * string (after the sign) is the Pauli on qubit k. One valid generating set —
   * not a canonical form; two tableaux for the same state can list different
   * generators.
   */
  stabilizers(): string[] {
    return Array.from({ length: this.n }, (_, i) => this.rowString(this.n + i))
  }

  /** The destabilizers. Their signs are not meaningful after a measurement. */
  destabilizers(): string[] {
    return Array.from({ length: this.n }, (_, i) => this.rowString(i))
  }

  /**
   * Entanglement entropy, in bits, across every cut between qubit k-1 and qubit
   * k: result[k] = S(qubits 0..k-1), for k = 0..upTo.
   *
   * For a stabilizer state S(A) = rank(generators restricted to A) − |A|
   * (Fattal et al., quant-ph/0406168). One Gaussian elimination with the
   * columns taken in qubit order gives the rank of every prefix at once, so the
   * whole profile costs the same as a single cut.
   */
  entropyProfile(upTo: number = this.n): number[] {
    if (!Number.isInteger(upTo) || upTo < 0 || upTo > this.n) {
      throw new Error(`cut must be between 0 and ${this.n}`)
    }
    const n = this.n
    const w = this.w
    const xs = this.x.slice(n * w, 2 * n * w)
    const zs = this.z.slice(n * w, 2 * n * w)
    const profile = [0]
    let rank = 0
    for (let q = 0; q < upTo; q++) {
      const wi = q >>> 5
      const m = 1 << (q & 31)
      for (const part of [xs, zs]) {
        let p = -1
        for (let row = rank; row < n; row++) {
          if (part[row * w + wi] & m) {
            p = row
            break
          }
        }
        if (p < 0) continue
        if (p !== rank) {
          for (let k = 0; k < w; k++) {
            const tx = xs[p * w + k]
            xs[p * w + k] = xs[rank * w + k]
            xs[rank * w + k] = tx
            const tz = zs[p * w + k]
            zs[p * w + k] = zs[rank * w + k]
            zs[rank * w + k] = tz
          }
        }
        for (let row = rank + 1; row < n; row++) {
          if (part[row * w + wi] & m) {
            for (let k = wi; k < w; k++) {
              xs[row * w + k] ^= xs[rank * w + k]
              zs[row * w + k] ^= zs[rank * w + k]
            }
          }
        }
        rank++
      }
      profile.push(rank - (q + 1))
    }
    return profile
  }

  /** S(qubits 0..k-1) in bits. */
  entropy(k: number): number {
    return this.entropyProfile(k)[k]
  }
}

/** 2n(2n+1) bits: at this size the tableau is ~8 MB and a gate is still fast. */
export const MAX_STABILIZER_QUBITS = 4096

// ─────────────────────────────────────────────────────────────────────────────
// Programs
// ─────────────────────────────────────────────────────────────────────────────

export type CliffordGate =
  | 'H'
  | 'S'
  | 'SDG'
  | 'X'
  | 'Y'
  | 'Z'
  | 'SX'
  | 'SXDG'
  | 'CX'
  | 'CY'
  | 'CZ'
  | 'SWAP'
  | 'M'
  | 'RESET'

export interface CliffordOp {
  gate: CliffordGate
  qubits: number[]
}

export interface CliffordProgram {
  numQubits: number
  ops: CliffordOp[]
}

/** Apply one op. Returns the measurement result for 'M', otherwise null. */
export function applyCliffordOp(t: Tableau, op: CliffordOp, rng: () => number = Math.random): MeasureResult | null {
  const [a, b] = op.qubits
  switch (op.gate) {
    case 'H':
      t.h(a)
      return null
    case 'S':
      t.s(a)
      return null
    case 'SDG':
      t.sdg(a)
      return null
    case 'X':
      t.x_(a)
      return null
    case 'Y':
      t.y(a)
      return null
    case 'Z':
      t.z_(a)
      return null
    case 'SX':
      t.sx(a)
      return null
    case 'SXDG':
      t.sxdg(a)
      return null
    case 'CX':
      t.cx(a, b)
      return null
    case 'CY':
      t.cy(a, b)
      return null
    case 'CZ':
      t.cz(a, b)
      return null
    case 'SWAP':
      t.swap(a, b)
      return null
    case 'M':
      return t.measure(a, rng)
    case 'RESET':
      t.reset(a, rng)
      return null
  }
}

export interface ProgramRun {
  tableau: Tableau
  /** One entry per M op, in program order. */
  measurements: { qubit: number; outcome: 0 | 1; deterministic: boolean }[]
}

export function runCliffordProgram(program: CliffordProgram, rng: () => number = Math.random): ProgramRun {
  const tableau = new Tableau(program.numQubits)
  const measurements: ProgramRun['measurements'] = []
  for (const op of program.ops) {
    const result = applyCliffordOp(tableau, op, rng)
    if (result) measurements.push({ qubit: op.qubits[0], ...result })
  }
  return { tableau, measurements }
}

const GATE_ALIASES: Record<string, { gate: CliffordGate; arity: 1 | 2 }> = {
  h: { gate: 'H', arity: 1 },
  s: { gate: 'S', arity: 1 },
  sdg: { gate: 'SDG', arity: 1 },
  x: { gate: 'X', arity: 1 },
  y: { gate: 'Y', arity: 1 },
  z: { gate: 'Z', arity: 1 },
  sx: { gate: 'SX', arity: 1 },
  sxdg: { gate: 'SXDG', arity: 1 },
  reset: { gate: 'RESET', arity: 1 },
  cx: { gate: 'CX', arity: 2 },
  cnot: { gate: 'CX', arity: 2 },
  cy: { gate: 'CY', arity: 2 },
  cz: { gate: 'CZ', arity: 2 },
  swap: { gate: 'SWAP', arity: 2 },
}

/** Gates people will paste that no tableau can run, with the reason. */
const NON_CLIFFORD = new Set(['t', 'tdg', 'rx', 'ry', 'rz', 'p', 'u', 'u3', 'ccx', 'cswap', 'cp', 'crz'])

/**
 * Parse the Clifford subset of OpenQASM (2 or 3): one register, the gates in
 * GATE_ALIASES, `measure`. A single-qubit gate on the bare register name
 * broadcasts. Anything else is an error that names the line — a T gate in
 * particular gets told why, since "why can't it run my circuit" is the first
 * question this tool gets asked.
 */
export function parseCliffordProgram(source: string): CliffordProgram {
  let numQubits = 0
  let register = ''
  const ops: CliffordOp[] = []
  const statements = source
    .split('\n')
    .flatMap((line, i) =>
      line
        .replace(/\/\/.*$/, '')
        .split(';')
        .map((text) => ({ text: text.trim(), line: i + 1 })),
    )
    .filter((s) => s.text.length > 0)

  const operand = (token: string, line: number): number[] => {
    const indexed = token.match(/^([A-Za-z_]\w*)\[(\d+)\]$/)
    if (indexed) {
      if (indexed[1] !== register) throw new Error(`Line ${line}: unknown register "${indexed[1]}".`)
      const q = Number(indexed[2])
      if (q >= numQubits) throw new Error(`Line ${line}: ${token} is outside the ${numQubits}-qubit register.`)
      return [q]
    }
    if (token === register) return Array.from({ length: numQubits }, (_, q) => q)
    throw new Error(`Line ${line}: cannot read operand "${token}".`)
  }

  for (const { text, line } of statements) {
    if (/^(OPENQASM|include)\b/i.test(text)) continue
    if (/^(bit|creg)\b/.test(text)) continue

    const decl = text.match(/^qubit\[(\d+)\]\s+([A-Za-z_]\w*)$/) ?? text.match(/^qreg\s+([A-Za-z_]\w*)\[(\d+)\]$/)
    if (decl) {
      if (register) throw new Error(`Line ${line}: only one qubit register is supported.`)
      const isQasm3 = text.startsWith('qubit')
      numQubits = Number(isQasm3 ? decl[1] : decl[2])
      register = isQasm3 ? decl[2] : decl[1]
      if (numQubits < 1 || numQubits > MAX_STABILIZER_QUBITS) {
        throw new Error(`Line ${line}: the register must have between 1 and ${MAX_STABILIZER_QUBITS} qubits.`)
      }
      continue
    }
    if (!register) throw new Error(`Line ${line}: declare the register first, e.g. "qubit[4] q;".`)

    const measure = text.match(/^(?:[\w\[\]]+\s*=\s*)?measure\s+([\w\[\]]+)(?:\s*->\s*[\w\[\]]+)?$/)
    if (measure) {
      for (const q of operand(measure[1], line)) ops.push({ gate: 'M', qubits: [q] })
      continue
    }

    const call = text.match(/^([A-Za-z]\w*)(\([^)]*\))?\s+(.+)$/)
    if (!call) throw new Error(`Line ${line}: cannot read "${text}".`)
    const name = call[1].toLowerCase()
    const spec = GATE_ALIASES[name]
    if (!spec || call[2]) {
      if (NON_CLIFFORD.has(name)) {
        throw new Error(
          `Line ${line}: ${name} is not a Clifford gate. A stabilizer tableau can only follow gates that map Pauli operators to Pauli operators — use the statevector simulator for this circuit.`,
        )
      }
      throw new Error(`Line ${line}: unsupported gate "${call[1]}".`)
    }
    const args = call[3].split(',').map((a) => a.trim())
    if (args.length !== spec.arity) {
      throw new Error(`Line ${line}: ${name} takes ${spec.arity} operand${spec.arity > 1 ? 's' : ''}.`)
    }
    if (spec.arity === 1) {
      for (const q of operand(args[0], line)) ops.push({ gate: spec.gate, qubits: [q] })
    } else {
      const a = operand(args[0], line)
      const b = operand(args[1], line)
      if (a.length !== 1 || b.length !== 1) throw new Error(`Line ${line}: ${name} needs two indexed qubits.`)
      if (a[0] === b[0]) throw new Error(`Line ${line}: ${name} needs two different qubits.`)
      ops.push({ gate: spec.gate, qubits: [a[0], b[0]] })
    }
  }

  if (!register) throw new Error('Declare a register, e.g. "qubit[4] q;".')
  return { numQubits, ops }
}

// ─────────────────────────────────────────────────────────────────────────────
// Uniformly random Clifford gates
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The 24 single-qubit Cliffords (mod phase) as words in H and S, found by
 * breadth-first search over what each word does to X and Z.
 */
export const SINGLE_QUBIT_CLIFFORDS: readonly string[] = (() => {
  const signature = (word: string): string => {
    const t = new Tableau(1)
    for (const g of word) {
      if (g === 'H') t.h(0)
      else t.s(0)
    }
    return t.destabilizers()[0] + t.stabilizers()[0]
  }
  const seen = new Map<string, string>([[signature(''), '']])
  let frontier = ['']
  while (frontier.length > 0) {
    const next: string[] = []
    for (const word of frontier) {
      for (const g of ['H', 'S']) {
        const candidate = word + g
        const sig = signature(candidate)
        if (!seen.has(sig)) {
          seen.set(sig, candidate)
          next.push(candidate)
        }
      }
    }
    frontier = next
  }
  return [...seen.values()]
})()

function applyWord(t: Tableau, word: string, q: number): void {
  for (const g of word) {
    if (g === 'H') t.h(q)
    else t.s(q)
  }
}

/** I, R, R² for R = "S then H", which cycles the three Pauli axes. */
const AXIS_CYCLES = ['', 'SH', 'SHSH'] as const

/**
 * A two-qubit Clifford by index, 0..11519. The group splits into four classes
 * by entangling content — none (576), CNOT-like (5184), iSWAP-like (5184) and
 * SWAP-like (576) — each a pair of single-qubit Cliffords after a fixed core
 * (the decomposition used for two-qubit randomized benchmarking; Corcoles et
 * al., Phys. Rev. A 87, 030301, 2013). stabilizer.test.ts enumerates all
 * 11520 and checks they are distinct, which is what makes a uniform index a
 * uniform Clifford.
 */
export function applyTwoQubitCliffordGates(t: Tableau, a: number, b: number, index: number): void {
  if (!Number.isInteger(index) || index < 0 || index >= TWO_QUBIT_CLIFFORD_COUNT) {
    throw new Error('two-qubit Clifford index out of range')
  }
  const local = index % 576
  let cls = Math.floor(index / 576) // 0 | 1..9 | 10..18 | 19
  if (cls >= 1 && cls <= 18) {
    const k = (cls - 1) % 9
    applyWord(t, AXIS_CYCLES[k % 3], a)
    applyWord(t, AXIS_CYCLES[Math.floor(k / 3)], b)
    if (cls <= 9) {
      t.cx(a, b)
    } else {
      // iSWAP, up to phase: S⊗S, then CZ, then SWAP.
      t.s(a).s(b).cz(a, b).swap(a, b)
    }
    cls = 0
  } else if (cls === 19) {
    t.swap(a, b)
  }
  applyWord(t, SINGLE_QUBIT_CLIFFORDS[local % 24], a)
  applyWord(t, SINGLE_QUBIT_CLIFFORDS[Math.floor(local / 24)], b)
}

export const TWO_QUBIT_CLIFFORD_COUNT = 11520

const cliffordTables = new Map<number, Uint8Array>()

/**
 * The same gate as applyTwoQubitCliffordGates, applied in a single pass over
 * the tableau through a cached lookup table — an order of magnitude fewer row
 * visits, which is what makes the random-circuit experiments interactive.
 */
export function applyTwoQubitClifford(t: Tableau, a: number, b: number, index: number): void {
  let table = cliffordTables.get(index)
  if (!table) {
    table = Tableau.pauliTable((small) => applyTwoQubitCliffordGates(small, 0, 1, index))
    cliffordTables.set(index, table)
  }
  t.applyPauliTable(a, b, table)
}

export function applyRandomTwoQubitClifford(t: Tableau, a: number, b: number, rng: () => number): void {
  applyTwoQubitClifford(t, a, b, Math.floor(rng() * TWO_QUBIT_CLIFFORD_COUNT))
}

// ─────────────────────────────────────────────────────────────────────────────
// Preset states, built as programs so the lab can show what it ran
// ─────────────────────────────────────────────────────────────────────────────

export function ghzProgram(n: number): CliffordProgram {
  const ops: CliffordOp[] = [{ gate: 'H', qubits: [0] }]
  for (let q = 1; q < n; q++) ops.push({ gate: 'CX', qubits: [q - 1, q] })
  return { numQubits: n, ops }
}

/** The 1D cluster state: |+⟩ everywhere, CZ along the chain. */
export function clusterChainProgram(n: number): CliffordProgram {
  const ops: CliffordOp[] = []
  for (let q = 0; q < n; q++) ops.push({ gate: 'H', qubits: [q] })
  for (let q = 1; q < n; q++) ops.push({ gate: 'CZ', qubits: [q - 1, q] })
  return { numQubits: n, ops }
}

/** The 2D cluster state on a side × side grid, qubits numbered row by row. */
export function clusterGridProgram(side: number): CliffordProgram {
  const n = side * side
  const ops: CliffordOp[] = []
  for (let q = 0; q < n; q++) ops.push({ gate: 'H', qubits: [q] })
  for (let row = 0; row < side; row++) {
    for (let col = 0; col < side; col++) {
      const q = row * side + col
      if (col + 1 < side) ops.push({ gate: 'CZ', qubits: [q, q + 1] })
      if (row + 1 < side) ops.push({ gate: 'CZ', qubits: [q, q + side] })
    }
  }
  return { numQubits: n, ops }
}

/**
 * A brickwork of uniformly random two-qubit Cliffords on a line, `depth`
 * layers deep, applied straight to a tableau (the gates have no short names to
 * list as a program).
 */
export function randomBrickwork(n: number, depth: number, rng: () => number): Tableau {
  const t = new Tableau(n)
  for (let layer = 0; layer < depth; layer++) {
    for (let q = layer % 2; q + 1 < n; q += 2) applyRandomTwoQubitClifford(t, q, q + 1, rng)
  }
  return t
}
