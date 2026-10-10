/**
 * densityMatrix.ts — mixed states as matrices, on top of lib/quantum.ts.
 *
 * The statevector engine can only describe a system that has one definite
 * quantum state. Everything on /visualizations/density-matrix is about the
 * case where it does not: a qubit that is |0⟩ with probability p and |1⟩
 * otherwise, a qubit that has been dephased, or one half of an entangled
 * pair. Those need ρ = Σ pᵢ |ψᵢ⟩⟨ψᵢ|, and this module builds, transforms and
 * reads ρ for a few qubits at a time.
 *
 * Conventions match lib/quantum.ts exactly: basis index i has qubit q in bit
 * (i >> q) & 1, labels are printed MSB-first (Qiskit order), |0⟩ is +z on the
 * Bloch sphere, |+⟩ is +x and |i⟩ is +y. ρ is stored as a dense array of
 * Complex rows — the largest matrix this page ever holds is 4×4, so clarity
 * beats a Float64Array here.
 *
 * densityMatrix.test.ts checks every number this module produces against a
 * value derived by hand, never against another call into the same code.
 */

import { StateVector, c, cAbs, cAdd, cConj, cMul, cScale, type Complex } from '@/lib/quantum'

export interface DensityMatrix {
  numQubits: number
  dim: number
  /** rho[i][j] = ⟨i|ρ|j⟩ */
  rho: Complex[][]
}

export type Vec3 = [number, number, number]

const ZERO: Complex = { re: 0, im: 0 }

function zeros(dim: number): Complex[][] {
  return Array.from({ length: dim }, () => Array.from({ length: dim }, () => ({ ...ZERO })))
}

function qubitsFor(dim: number): number {
  const n = Math.log2(dim)
  if (!Number.isInteger(n) || n < 1) throw new Error(`dimension ${dim} is not a power of two`)
  return n
}

// ────────────────────────────────────────────────────────────
// Construction
// ────────────────────────────────────────────────────────────

/** ρ = |ψ⟩⟨ψ|. The state is normalised first, so ρ always has unit trace. */
export function densityFromState(state: StateVector): DensityMatrix {
  const psi = state.clone().normalize().amplitudes()
  const dim = psi.length
  const rho = zeros(dim)
  for (let i = 0; i < dim; i++) {
    for (let j = 0; j < dim; j++) {
      rho[i][j] = cMul(psi[i], cConj(psi[j]))
    }
  }
  return { numQubits: state.numQubits, dim, rho }
}

/**
 * A classical mixture: ρ = Σ pᵢ |ψᵢ⟩⟨ψᵢ|. Weights are normalised so callers
 * can pass raw odds; a negative weight is rejected because it would not be a
 * probability and the result would not be a state.
 */
export function mixture(parts: readonly { weight: number; state: StateVector }[]): DensityMatrix {
  if (parts.length === 0) throw new Error('a mixture needs at least one state')
  const dim = parts[0].state.dim
  let total = 0
  for (const p of parts) {
    if (!(p.weight >= 0) || !Number.isFinite(p.weight)) {
      throw new Error(`mixture weight ${p.weight} is not a probability`)
    }
    if (p.state.dim !== dim) throw new Error('every state in a mixture must have the same dimension')
    total += p.weight
  }
  if (total <= 0) throw new Error('mixture weights must not all be zero')
  const rho = zeros(dim)
  for (const p of parts) {
    if (p.weight === 0) continue
    const term = densityFromState(p.state).rho
    const w = p.weight / total
    for (let i = 0; i < dim; i++) {
      for (let j = 0; j < dim; j++) {
        rho[i][j] = cAdd(rho[i][j], cScale(term[i][j], w))
      }
    }
  }
  return { numQubits: parts[0].state.numQubits, dim, rho }
}

/**
 * Single-qubit ρ from a Bloch vector: ρ = (I + x·σₓ + y·σᵧ + z·σ_z) / 2.
 * A vector longer than 1 is not a state (ρ would have a negative eigenvalue).
 */
export function densityFromBloch(r: Vec3): DensityMatrix {
  const [x, y, z] = r
  const len = Math.hypot(x, y, z)
  if (len > 1 + 1e-9) throw new Error(`Bloch vector of length ${len} lies outside the sphere`)
  return {
    numQubits: 1,
    dim: 2,
    rho: [
      [c((1 + z) / 2), c(x / 2, -y / 2)],
      [c(x / 2, y / 2), c((1 - z) / 2)],
    ],
  }
}

/** The maximally mixed state I/d on n qubits. */
export function maximallyMixed(numQubits: number): DensityMatrix {
  const dim = 1 << numQubits
  const rho = zeros(dim)
  for (let i = 0; i < dim; i++) rho[i][i] = c(1 / dim)
  return { numQubits, dim, rho }
}

// ────────────────────────────────────────────────────────────
// Scalars read off ρ
// ────────────────────────────────────────────────────────────

/** Tr ρ as a complex number; for any valid state this is 1 + 0i. */
export function trace(m: DensityMatrix): Complex {
  let t: Complex = { ...ZERO }
  for (let i = 0; i < m.dim; i++) t = cAdd(t, m.rho[i][i])
  return t
}

/**
 * Purity Tr(ρ²) = Σᵢⱼ |ρᵢⱼ|² for Hermitian ρ. Equals 1 for a pure state and
 * 1/d for the maximally mixed state on d dimensions.
 */
export function purity(m: DensityMatrix): number {
  let s = 0
  for (let i = 0; i < m.dim; i++) {
    for (let j = 0; j < m.dim; j++) {
      const a = m.rho[i][j]
      s += a.re * a.re + a.im * a.im
    }
  }
  return s
}

/** Largest |ρᵢⱼ − conj(ρⱼᵢ)| over the matrix; 0 for a Hermitian ρ. */
export function hermiticityDefect(m: DensityMatrix): number {
  let worst = 0
  for (let i = 0; i < m.dim; i++) {
    for (let j = 0; j < m.dim; j++) {
      const a = m.rho[i][j]
      const b = cConj(m.rho[j][i])
      worst = Math.max(worst, Math.hypot(a.re - b.re, a.im - b.im))
    }
  }
  return worst
}

export function isHermitian(m: DensityMatrix, tol = 1e-10): boolean {
  return hermiticityDefect(m) <= tol
}

/**
 * Bloch vector of a single-qubit ρ: (Tr ρσₓ, Tr ρσᵧ, Tr ρσ_z). Written out,
 * that is x = 2 Re ρ₀₁, y = −2 Im ρ₀₁ (ρ₀₁ = ⟨0|ρ|1⟩), z = ρ₀₀ − ρ₁₁.
 */
export function blochVector(m: DensityMatrix): Vec3 {
  if (m.dim !== 2) throw new Error('blochVector needs a single-qubit density matrix')
  const r01 = m.rho[0][1]
  return [2 * r01.re, -2 * r01.im, m.rho[0][0].re - m.rho[1][1].re]
}

/** |r| for a single qubit, from the purity: |r| = √(2 Tr ρ² − 1). */
export function blochLengthFromPurity(p: number): number {
  return Math.sqrt(Math.max(0, 2 * p - 1))
}

/**
 * Von Neumann entropy of a single qubit in bits. Eigenvalues of a qubit ρ are
 * (1 ± |r|)/2, so S = H₂((1 + |r|)/2): 0 for pure, 1 for maximally mixed.
 */
export function qubitEntropyBits(m: DensityMatrix): number {
  const r = Math.min(1, Math.hypot(...blochVector(m)))
  const lam = [(1 + r) / 2, (1 - r) / 2]
  let s = 0
  for (const l of lam) if (l > 1e-15) s -= l * Math.log2(l)
  return s
}

// ────────────────────────────────────────────────────────────
// Measurement
// ────────────────────────────────────────────────────────────

/** ⟨φ|ρ|φ⟩ — the probability that a projective measurement finds |φ⟩. */
export function projectionProbability(m: DensityMatrix, phi: StateVector): number {
  if (phi.dim !== m.dim) throw new Error('projector and density matrix dimensions differ')
  const v = phi.clone().normalize().amplitudes()
  let p: Complex = { ...ZERO }
  for (let i = 0; i < m.dim; i++) {
    let row: Complex = { ...ZERO }
    for (let j = 0; j < m.dim; j++) row = cAdd(row, cMul(m.rho[i][j], v[j]))
    p = cAdd(p, cMul(cConj(v[i]), row))
  }
  return Math.min(1, Math.max(0, p.re))
}

/** Diagonal of ρ: probabilities of each computational-basis outcome. */
export function computationalProbabilities(m: DensityMatrix): number[] {
  return m.rho.map((row, i) => Math.min(1, Math.max(0, row[i].re)))
}

export type PauliBasis = 'z' | 'x' | 'y'

/** The +1 and −1 eigenstates of σ_z, σₓ, σᵧ as single-qubit statevectors. */
export function pauliEigenstates(basis: PauliBasis): { plus: StateVector; minus: StateVector } {
  const plus = new StateVector(1)
  const minus = new StateVector(1)
  minus.applySingle('X', 0)
  if (basis === 'x') {
    plus.applySingle('H', 0)
    minus.applySingle('H', 0)
  } else if (basis === 'y') {
    plus.applySingle('H', 0).applySingle('S', 0)
    minus.applySingle('H', 0).applySingle('S', 0)
  }
  return { plus, minus }
}

/** P(+1) and P(−1) for a single-qubit ρ measured along a Pauli axis. */
export function pauliMeasurement(m: DensityMatrix, basis: PauliBasis): { plus: number; minus: number } {
  const { plus, minus } = pauliEigenstates(basis)
  return { plus: projectionProbability(m, plus), minus: projectionProbability(m, minus) }
}

// ────────────────────────────────────────────────────────────
// Channels
// ────────────────────────────────────────────────────────────

/**
 * Computational-basis dephasing: keep the populations, scale every coherence
 * by (1 − λ). λ = 0 leaves ρ alone; λ = 1 is a complete dephasing, which for a
 * single qubit is the same as having measured σ_z and forgotten the answer.
 * This is a convex mix of the identity and the map ρ ↦ Σₖ |k⟩⟨k|ρ|k⟩⟨k|, so it
 * is a valid channel on any number of qubits.
 */
export function dephase(m: DensityMatrix, lambda: number): DensityMatrix {
  if (!(lambda >= 0 && lambda <= 1)) throw new Error(`dephasing strength ${lambda} must lie in [0, 1]`)
  const keep = 1 - lambda
  const rho = m.rho.map((row, i) => row.map((a, j) => (i === j ? { ...a } : cScale(a, keep))))
  return { numQubits: m.numQubits, dim: m.dim, rho }
}

/**
 * Partial trace over the listed qubits. The remaining qubits keep their
 * relative order, and the lowest surviving qubit becomes qubit 0 of the
 * result. Tracing out every qubit is rejected — that would be a number, not
 * a state.
 */
export function partialTrace(m: DensityMatrix, traceOut: readonly number[]): DensityMatrix {
  const drop = new Set<number>()
  for (const q of traceOut) {
    if (!Number.isInteger(q) || q < 0 || q >= m.numQubits) {
      throw new Error(`qubit ${q} is out of range for a ${m.numQubits}-qubit state`)
    }
    drop.add(q)
  }
  const keep: number[] = []
  for (let q = 0; q < m.numQubits; q++) if (!drop.has(q)) keep.push(q)
  if (keep.length === 0) throw new Error('cannot trace out every qubit')

  const dropped = [...drop]
  const keptDim = 1 << keep.length
  const droppedDim = 1 << dropped.length
  const rho = zeros(keptDim)

  // Assemble a full index from a kept-index and a dropped-index.
  const fullIndex = (k: number, d: number): number => {
    let idx = 0
    keep.forEach((q, bit) => {
      if ((k >> bit) & 1) idx |= 1 << q
    })
    dropped.forEach((q, bit) => {
      if ((d >> bit) & 1) idx |= 1 << q
    })
    return idx
  }

  for (let a = 0; a < keptDim; a++) {
    for (let b = 0; b < keptDim; b++) {
      let sum: Complex = { ...ZERO }
      for (let d = 0; d < droppedDim; d++) {
        sum = cAdd(sum, m.rho[fullIndex(a, d)][fullIndex(b, d)])
      }
      rho[a][b] = sum
    }
  }
  return { numQubits: keep.length, dim: keptDim, rho }
}

// ────────────────────────────────────────────────────────────
// Named states the page uses
// ────────────────────────────────────────────────────────────

/** |ψ(θ, φ)⟩ = cos(θ/2)|0⟩ + e^{iφ} sin(θ/2)|1⟩ as a statevector. */
export function blochState(theta: number, phi: number): StateVector {
  const sv = new StateVector(1)
  sv.applySingle('RY', 0, theta)
  sv.applySingle('P', 0, phi)
  return sv
}

export type PairPreset = 'phi-plus' | 'psi-minus' | 'product' | 'tunable'

/**
 * Two-qubit states for the partial-trace section. `alpha` only matters for
 * 'tunable': cos α |00⟩ + sin α |11⟩, which runs from a product state (α = 0)
 * to the Bell state Φ⁺ (α = π/4).
 */
export function pairState(preset: PairPreset, alpha = Math.PI / 4): StateVector {
  const sv = new StateVector(2)
  switch (preset) {
    case 'phi-plus':
      sv.applySingle('H', 0)
      sv.applyControlled('X', [0], 1)
      return sv
    case 'psi-minus':
      sv.applySingle('X', 0)
      sv.applySingle('X', 1)
      sv.applySingle('H', 0)
      sv.applyControlled('X', [0], 1)
      return sv
    case 'product':
      // |+⟩ on qubit 0, |0⟩ on qubit 1: pure, and both halves are pure too.
      sv.applySingle('H', 0)
      return sv
    case 'tunable':
      sv.applySingle('RY', 0, 2 * alpha)
      sv.applyControlled('X', [0], 1)
      return sv
  }
}

/** Basis label for row/column i of a density matrix, MSB-first. */
export function basisLabel(m: DensityMatrix, i: number): string {
  return `|${i.toString(2).padStart(m.numQubits, '0')}⟩`
}

/** Largest |ρᵢⱼ| — the scale a heat-map colours against. */
export function maxAbsEntry(m: DensityMatrix): number {
  let worst = 0
  for (const row of m.rho) for (const a of row) worst = Math.max(worst, cAbs(a))
  return worst
}

/** Number of qubits implied by a square Complex matrix, for callers that build ρ by hand. */
export function fromMatrix(rho: Complex[][]): DensityMatrix {
  const dim = rho.length
  if (rho.some((row) => row.length !== dim)) throw new Error('density matrix must be square')
  return { numQubits: qubitsFor(dim), dim, rho: rho.map((row) => row.map((a) => ({ ...a }))) }
}
