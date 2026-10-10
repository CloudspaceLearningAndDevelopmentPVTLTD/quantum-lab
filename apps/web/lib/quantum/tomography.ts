/**
 * lib/quantum/tomography.ts — quantum state tomography numerics.
 *
 * Everything the /visualizations/state-tomography page displays is computed
 * here, on density matrices, with no DOM and no randomness of its own (every
 * sampler takes an `rng`). The module covers:
 *
 *   • single-qubit tomography: Pauli-axis sampling, the Bloch-vector estimate
 *     r_i = (n₊ − n₋)/N with its binomial standard error √((1 − r_i²)/N), and
 *     the projection back onto the sphere when noise pushes |r| past 1;
 *   • two-qubit tomography: sampling in the nine Pauli-pair bases, linear
 *     inversion ρ = ¼ Σ ⟨σ_a⊗σ_b⟩ σ_a⊗σ_b, and the Smolin–Gambetta–Smith
 *     maximum-likelihood correction that removes negative eigenvalues;
 *   • the metrics the page reports: trace distance, Hilbert–Schmidt distance,
 *     fidelity with a pure state, and the eigenvalues of a Hermitian matrix.
 *
 * Hermitian eigenproblems are solved through the real embedding
 * H = A + iB  ↦  [[A, −B], [B, A]], which is real symmetric, has every
 * eigenvalue of H twice, and is a ring homomorphism — so any function applied
 * to the spectrum of the embedding is the same function applied to the
 * spectrum of H. That lets one cyclic Jacobi routine for real symmetric
 * matrices serve every complex Hermitian need here, with no eigenvector
 * pairing ambiguity: the matrix function is assembled in the embedding and
 * read back from its blocks.
 *
 * Conventions: a two-qubit density matrix is indexed 2·a + b with `a` the
 * LEFT tensor factor (qubit A) — plain textbook order. StateVector in
 * lib/quantum.ts puts q0 in the LOW bit, so `reducedDensity` takes an explicit
 * list of which StateVector qubits become A, B, … in that left-to-right order.
 */

import {
  type Complex,
  c,
  cAdd,
  cConj,
  cMul,
  cAbs2,
  type StateVector,
} from '@/lib/quantum'

// ─────────────────────────────────────────────────────────────────────────────
// Density matrices
// ─────────────────────────────────────────────────────────────────────────────

export interface DensityMatrix {
  /** Hilbert-space dimension. */
  dim: number
  /** Row-major dim×dim, element (i, j) at i·dim + j. */
  data: Complex[]
}

export function zeros(dim: number): DensityMatrix {
  return { dim, data: Array.from({ length: dim * dim }, () => c(0)) }
}

export function identity(dim: number): DensityMatrix {
  const m = zeros(dim)
  for (let i = 0; i < dim; i++) m.data[i * dim + i] = c(1)
  return m
}

/** |ψ⟩⟨ψ| for a normalised amplitude list. */
export function pureDensity(amps: readonly Complex[]): DensityMatrix {
  const dim = amps.length
  const m = zeros(dim)
  for (let i = 0; i < dim; i++) {
    for (let j = 0; j < dim; j++) {
      m.data[i * dim + j] = cMul(amps[i], cConj(amps[j]))
    }
  }
  return m
}

export function add(a: DensityMatrix, b: DensityMatrix): DensityMatrix {
  if (a.dim !== b.dim) throw new Error('dimension mismatch')
  return { dim: a.dim, data: a.data.map((x, k) => cAdd(x, b.data[k])) }
}

export function scale(a: DensityMatrix, s: number): DensityMatrix {
  return { dim: a.dim, data: a.data.map((x) => c(x.re * s, x.im * s)) }
}

export function subtract(a: DensityMatrix, b: DensityMatrix): DensityMatrix {
  return add(a, scale(b, -1))
}

export function matmul(a: DensityMatrix, b: DensityMatrix): DensityMatrix {
  if (a.dim !== b.dim) throw new Error('dimension mismatch')
  const n = a.dim
  const out = zeros(n)
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      let re = 0
      let im = 0
      for (let k = 0; k < n; k++) {
        const x = a.data[i * n + k]
        const y = b.data[k * n + j]
        re += x.re * y.re - x.im * y.im
        im += x.re * y.im + x.im * y.re
      }
      out.data[i * n + j] = c(re, im)
    }
  }
  return out
}

/** Kronecker product a ⊗ b, `a` the left factor. */
export function kron(a: DensityMatrix, b: DensityMatrix): DensityMatrix {
  const n = a.dim * b.dim
  const out = zeros(n)
  for (let i = 0; i < a.dim; i++) {
    for (let j = 0; j < a.dim; j++) {
      const x = a.data[i * a.dim + j]
      for (let k = 0; k < b.dim; k++) {
        for (let l = 0; l < b.dim; l++) {
          out.data[(i * b.dim + k) * n + (j * b.dim + l)] = cMul(x, b.data[k * b.dim + l])
        }
      }
    }
  }
  return out
}

export function trace(m: DensityMatrix): Complex {
  let re = 0
  let im = 0
  for (let i = 0; i < m.dim; i++) {
    re += m.data[i * m.dim + i].re
    im += m.data[i * m.dim + i].im
  }
  return c(re, im)
}

/** Re Tr(ρ·op) — the expectation value of a Hermitian `op` in state ρ. */
export function expectation(rho: DensityMatrix, op: DensityMatrix): number {
  return trace(matmul(rho, op)).re
}

/** ⟨ψ|ρ|ψ⟩ — fidelity of ρ with the pure state ψ. */
export function fidelityWithPure(rho: DensityMatrix, psi: readonly Complex[]): number {
  if (psi.length !== rho.dim) throw new Error('dimension mismatch')
  let re = 0
  for (let i = 0; i < rho.dim; i++) {
    for (let j = 0; j < rho.dim; j++) {
      // conj(ψ_i) ρ_ij ψ_j
      const t = cMul(cMul(cConj(psi[i]), rho.data[i * rho.dim + j]), psi[j])
      re += t.re
    }
  }
  return re
}

/** Depolarising channel: (1 − p)ρ + p·I/d. */
export function depolarize(rho: DensityMatrix, p: number): DensityMatrix {
  return add(scale(rho, 1 - p), scale(identity(rho.dim), p / rho.dim))
}

/** Hilbert–Schmidt (Frobenius) distance ‖ρ − σ‖₂. */
export function hsDistance(a: DensityMatrix, b: DensityMatrix): number {
  const d = subtract(a, b)
  let s = 0
  for (const x of d.data) s += cAbs2(x)
  return Math.sqrt(s)
}

/** Trace distance ½‖ρ − σ‖₁ = ½ Σ |eig(ρ − σ)|. */
export function traceDistance(a: DensityMatrix, b: DensityMatrix): number {
  const ev = eigenvaluesHermitian(subtract(a, b))
  return 0.5 * ev.reduce((s, x) => s + Math.abs(x), 0)
}

/** Purity Tr(ρ²). */
export function purity(rho: DensityMatrix): number {
  return trace(matmul(rho, rho)).re
}

/**
 * Reduced density matrix of a StateVector on the qubits in `keep`, in that
 * left-to-right order (keep[0] is the left tensor factor). Every other qubit
 * is traced out.
 */
export function reducedDensity(sv: StateVector, keep: readonly number[]): DensityMatrix {
  const k = keep.length
  const dim = 1 << k
  const out = zeros(dim)
  const keepMask = keep.reduce((m, q) => m | (1 << q), 0)
  const amps = sv.amplitudes()
  // Index in the reduced space for a full basis index.
  const reducedIndex = (i: number): number => {
    let r = 0
    for (let t = 0; t < k; t++) r = (r << 1) | ((i >> keep[t]) & 1)
    return r
  }
  for (let i = 0; i < sv.dim; i++) {
    const ai = amps[i]
    if (ai.re === 0 && ai.im === 0) continue
    const ri = reducedIndex(i)
    const rest = i & ~keepMask
    for (let j = 0; j < sv.dim; j++) {
      if ((j & ~keepMask) !== rest) continue
      const rj = reducedIndex(j)
      const t = cMul(ai, cConj(amps[j]))
      const cur = out.data[ri * dim + rj]
      out.data[ri * dim + rj] = c(cur.re + t.re, cur.im + t.im)
    }
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// Paulis
// ─────────────────────────────────────────────────────────────────────────────

export type PauliLabel = 'I' | 'X' | 'Y' | 'Z'
export type Axis = 'X' | 'Y' | 'Z'
export const AXES: readonly Axis[] = ['X', 'Y', 'Z']
export const PAULI_LABELS: readonly PauliLabel[] = ['I', 'X', 'Y', 'Z']

export const PAULI: Record<PauliLabel, DensityMatrix> = {
  I: { dim: 2, data: [c(1), c(0), c(0), c(1)] },
  X: { dim: 2, data: [c(0), c(1), c(1), c(0)] },
  Y: { dim: 2, data: [c(0), c(0, -1), c(0, 1), c(0)] },
  Z: { dim: 2, data: [c(1), c(0), c(0), c(-1)] },
}

/** Projector onto the ±1 eigenstate of a Pauli axis: (I ± σ)/2. */
export function projector(axis: Axis, sign: 1 | -1): DensityMatrix {
  return scale(add(PAULI.I, scale(PAULI[axis], sign)), 0.5)
}

// ─────────────────────────────────────────────────────────────────────────────
// Single qubit
// ─────────────────────────────────────────────────────────────────────────────

export type Vec3 = [number, number, number]

export function blochFromDensity(rho: DensityMatrix): Vec3 {
  if (rho.dim !== 2) throw new Error('blochFromDensity needs a 2×2 matrix')
  return [expectation(rho, PAULI.X), expectation(rho, PAULI.Y), expectation(rho, PAULI.Z)]
}

/** ρ = ½(I + r·σ). Valid for any r; physical only when |r| ≤ 1. */
export function densityFromBloch(r: Vec3): DensityMatrix {
  return scale(
    add(add(PAULI.I, scale(PAULI.X, r[0])), add(scale(PAULI.Y, r[1]), scale(PAULI.Z, r[2]))),
    0.5
  )
}

/** Amplitudes of the pure state at polar angle θ, azimuth φ on the Bloch sphere. */
export function blochStateAmplitudes(theta: number, phi: number): [Complex, Complex] {
  return [c(Math.cos(theta / 2)), c(Math.sin(theta / 2) * Math.cos(phi), Math.sin(theta / 2) * Math.sin(phi))]
}

export const vecLength = (v: Vec3): number => Math.hypot(v[0], v[1], v[2])

/** P(+1) when measuring ρ along `axis`: (1 + ⟨σ⟩)/2. */
export function plusProbability(rho: DensityMatrix, axis: Axis): number {
  return expectation(rho, projector(axis, 1))
}

/** Binomial sample by direct trials — exact, and fast enough for 10⁵ shots. */
export function binomial(n: number, p: number, rng: () => number): number {
  let k = 0
  for (let i = 0; i < n; i++) if (rng() < p) k++
  return k
}

/** Multinomial sample over `probs` (which must sum to 1) by direct trials. */
export function multinomial(probs: readonly number[], n: number, rng: () => number): number[] {
  const counts = new Array(probs.length).fill(0)
  const cum: number[] = []
  let acc = 0
  for (const p of probs) {
    acc += p
    cum.push(acc)
  }
  for (let s = 0; s < n; s++) {
    const u = rng()
    let k = 0
    while (k < cum.length - 1 && u >= cum[k]) k++
    counts[k]++
  }
  return counts
}

export interface AxisCounts {
  axis: Axis
  plus: number
  minus: number
}

/** N shots along each of X, Y, Z. */
export function sampleSingleQubit(
  rho: DensityMatrix,
  shots: number,
  rng: () => number
): AxisCounts[] {
  return AXES.map((axis) => {
    const plus = binomial(shots, plusProbability(rho, axis), rng)
    return { axis, plus, minus: shots - plus }
  })
}

export interface SingleQubitEstimate {
  /** Estimated Bloch vector (n₊ − n₋)/N per axis. */
  vector: Vec3
  /** One-sigma standard error per component, √((1 − r²)/N). */
  stderr: Vec3
  /** |vector| — exceeds 1 when the estimate is unphysical. */
  length: number
  /** Nearest physical state when |vector| > 1; the vector itself otherwise. */
  physical: Vec3
}

/**
 * Linear inversion for one qubit. Each component is the mean of ±1 outcomes,
 * so its variance is (1 − r_i²)/N; the error bar uses the estimate in place
 * of the unknown r_i, as any experiment must.
 */
export function reconstructSingleQubit(counts: readonly AxisCounts[]): SingleQubitEstimate {
  const byAxis = new Map(counts.map((k) => [k.axis, k]))
  const vector = AXES.map((axis) => {
    const k = byAxis.get(axis)
    if (!k) throw new Error(`missing counts for axis ${axis}`)
    const n = k.plus + k.minus
    return n === 0 ? 0 : (k.plus - k.minus) / n
  }) as Vec3
  const stderr = AXES.map((axis, i) => {
    const k = byAxis.get(axis)!
    const n = k.plus + k.minus
    return n === 0 ? 1 : Math.sqrt(Math.max(0, 1 - vector[i] * vector[i]) / n)
  }) as Vec3
  const length = vecLength(vector)
  const physical: Vec3 = length > 1 ? (vector.map((v) => v / length) as Vec3) : vector
  return { vector, stderr, length, physical }
}

// ─────────────────────────────────────────────────────────────────────────────
// Two qubits
// ─────────────────────────────────────────────────────────────────────────────

export interface BasisCounts {
  a: Axis
  b: Axis
  /** Outcome counts indexed 2·sA + sB with s = 0 for +1 and 1 for −1. */
  counts: [number, number, number, number]
}

export const OUTCOME_LABELS = ['++', '+−', '−+', '−−'] as const

export const BASIS_PAIRS: readonly [Axis, Axis][] = AXES.flatMap((a) =>
  AXES.map((b) => [a, b] as [Axis, Axis])
)

/** Outcome probabilities Tr[ρ (Π_s^a ⊗ Π_t^b)] in the order of OUTCOME_LABELS. */
export function basisProbabilities(rho: DensityMatrix, a: Axis, b: Axis): [number, number, number, number] {
  if (rho.dim !== 4) throw new Error('basisProbabilities needs a 4×4 matrix')
  const out: number[] = []
  for (const sA of [1, -1] as const) {
    for (const sB of [1, -1] as const) {
      out.push(Math.max(0, expectation(rho, kron(projector(a, sA), projector(b, sB)))))
    }
  }
  const total = out.reduce((s, x) => s + x, 0)
  return out.map((x) => x / total) as [number, number, number, number]
}

export function sampleTwoQubit(rho: DensityMatrix, shots: number, rng: () => number): BasisCounts[] {
  return BASIS_PAIRS.map(([a, b]) => ({
    a,
    b,
    counts: multinomial(basisProbabilities(rho, a, b), shots, rng) as [number, number, number, number],
  }))
}

/** 4×4 table E[a][b] = ⟨σ_a ⊗ σ_b⟩ indexed by PAULI_LABELS order (I, X, Y, Z). */
export type PauliTable = number[][]

/**
 * Expectation values from the nine bases. ⟨A⊗B⟩ comes from the (A, B) basis
 * alone; the marginal ⟨A⊗I⟩ is visible in all three bases whose first axis is
 * A and is averaged across them, which is the standard linear-inversion choice.
 */
export function expectationsFromCounts(bases: readonly BasisCounts[]): PauliTable {
  const E: PauliTable = PAULI_LABELS.map(() => PAULI_LABELS.map(() => 0))
  const idx = (p: PauliLabel) => PAULI_LABELS.indexOf(p)
  E[0][0] = 1
  const marginalSum = new Map<string, { s: number; n: number }>()
  const addMarginal = (key: string, v: number) => {
    const cur = marginalSum.get(key) ?? { s: 0, n: 0 }
    marginalSum.set(key, { s: cur.s + v, n: cur.n + 1 })
  }
  for (const { a, b, counts } of bases) {
    const N = counts[0] + counts[1] + counts[2] + counts[3]
    if (N === 0) continue
    const sgn = [1, -1]
    let ab = 0
    let aI = 0
    let Ib = 0
    for (let sA = 0; sA < 2; sA++) {
      for (let sB = 0; sB < 2; sB++) {
        const f = counts[2 * sA + sB] / N
        ab += sgn[sA] * sgn[sB] * f
        aI += sgn[sA] * f
        Ib += sgn[sB] * f
      }
    }
    E[idx(a)][idx(b)] = ab
    addMarginal(`${a}I`, aI)
    addMarginal(`I${b}`, Ib)
  }
  for (const a of AXES) {
    const m = marginalSum.get(`${a}I`)
    if (m) E[idx(a)][0] = m.s / m.n
    const n = marginalSum.get(`I${a}`)
    if (n) E[0][idx(a)] = n.s / n.n
  }
  return E
}

/** The exact table for a known ρ — what an infinite-shot experiment would return. */
export function exactExpectations(rho: DensityMatrix): PauliTable {
  return PAULI_LABELS.map((a) => PAULI_LABELS.map((b) => expectation(rho, kron(PAULI[a], PAULI[b]))))
}

/** ρ = ¼ Σ_ab E_ab σ_a ⊗ σ_b. */
export function linearInversion(E: PauliTable): DensityMatrix {
  let rho = zeros(4)
  PAULI_LABELS.forEach((a, i) => {
    PAULI_LABELS.forEach((b, j) => {
      rho = add(rho, scale(kron(PAULI[a], PAULI[b]), E[i][j] / 4))
    })
  })
  return rho
}

// ─────────────────────────────────────────────────────────────────────────────
// Hermitian eigenproblems through the real embedding
// ─────────────────────────────────────────────────────────────────────────────

/** [[A, −B], [B, A]] for H = A + iB. */
export function realEmbedding(h: DensityMatrix): number[][] {
  const d = h.dim
  const M: number[][] = Array.from({ length: 2 * d }, () => new Array(2 * d).fill(0))
  for (let i = 0; i < d; i++) {
    for (let j = 0; j < d; j++) {
      const { re, im } = h.data[i * d + j]
      M[i][j] = re
      M[i + d][j + d] = re
      M[i][j + d] = -im
      M[i + d][j] = im
    }
  }
  return M
}

/**
 * Cyclic Jacobi for a real symmetric matrix. Returns eigenvalues (unsorted)
 * and the matrix whose COLUMNS are the corresponding eigenvectors.
 */
export function eigSymmetric(input: number[][]): { values: number[]; vectors: number[][] } {
  const n = input.length
  const A = input.map((row) => row.slice())
  const V: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))
  )
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += A[i][j] * A[i][j]
    if (off < 1e-26) break
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(A[p][q]) < 1e-300) continue
        const theta = (A[q][q] - A[p][p]) / (2 * A[p][q])
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1))
        const cs = 1 / Math.sqrt(t * t + 1)
        const sn = t * cs
        for (let k = 0; k < n; k++) {
          const akp = A[k][p]
          const akq = A[k][q]
          A[k][p] = cs * akp - sn * akq
          A[k][q] = sn * akp + cs * akq
        }
        for (let k = 0; k < n; k++) {
          const apk = A[p][k]
          const aqk = A[q][k]
          A[p][k] = cs * apk - sn * aqk
          A[q][k] = sn * apk + cs * aqk
        }
        for (let k = 0; k < n; k++) {
          const vkp = V[k][p]
          const vkq = V[k][q]
          V[k][p] = cs * vkp - sn * vkq
          V[k][q] = sn * vkp + cs * vkq
        }
      }
    }
  }
  return { values: A.map((row, i) => row[i]), vectors: V }
}

/** Eigenvalues of a Hermitian matrix, sorted descending. */
export function eigenvaluesHermitian(h: DensityMatrix): number[] {
  const { values } = eigSymmetric(realEmbedding(h))
  const sorted = values.slice().sort((a, b) => b - a)
  // The embedding carries each eigenvalue twice; take one of each pair.
  return sorted.filter((_, i) => i % 2 === 0)
}

/**
 * Apply a function to the spectrum of a Hermitian matrix: the result has the
 * same eigenvectors and eigenvalues f(λ). `f` receives the eigenvalues sorted
 * descending and returns the replacements in the same order.
 */
export function spectralMap(h: DensityMatrix, f: (sortedDesc: number[]) => number[]): DensityMatrix {
  const d = h.dim
  const { values, vectors } = eigSymmetric(realEmbedding(h))
  const order = values.map((_, i) => i).sort((i, j) => values[j] - values[i])
  const paired = order.filter((_, k) => k % 2 === 0).map((i) => values[i])
  const mapped = f(paired)
  if (mapped.length !== d) throw new Error('spectral function must return one value per eigenvalue')
  const newValues = new Array(2 * d).fill(0)
  order.forEach((i, k) => {
    newValues[i] = mapped[Math.floor(k / 2)]
  })
  const n = 2 * d
  const out = zeros(d)
  for (let i = 0; i < d; i++) {
    for (let j = 0; j < d; j++) {
      // M' = V Λ' Vᵀ; A' = top-left block, B' = bottom-left block.
      let re = 0
      let im = 0
      for (let k = 0; k < n; k++) {
        re += vectors[i][k] * newValues[k] * vectors[j][k]
        im += vectors[i + d][k] * newValues[k] * vectors[j][k]
      }
      out.data[i * d + j] = c(re, im)
    }
  }
  return out
}

/**
 * Smolin, Gambetta & Smith (PRL 108, 070502, 2012): the maximum-likelihood
 * density matrix under Gaussian noise is the Frobenius-nearest positive
 * unit-trace matrix, found by sorting the eigenvalues, zeroing the smallest
 * while it would be negative, and sharing what was removed equally among the
 * survivors. Pure spectral arithmetic; the eigenvectors are kept.
 */
export function mleEigenvalues(sortedDesc: readonly number[]): number[] {
  const d = sortedDesc.length
  const total = sortedDesc.reduce((s, x) => s + x, 0)
  const mu = sortedDesc.map((x) => x / total) // enforce trace 1
  const lambda = new Array(d).fill(0)
  let i = d
  let a = 0
  while (i > 0 && mu[i - 1] + a / i < 0) {
    a += mu[i - 1]
    i--
  }
  for (let j = 0; j < i; j++) lambda[j] = mu[j] + a / i
  return lambda
}

export function mleProject(rho: DensityMatrix): DensityMatrix {
  return spectralMap(rho, (ev) => mleEigenvalues(ev))
}

/** Column-major sanity: is every eigenvalue ≥ −tol? */
export function isPhysical(rho: DensityMatrix, tol = 1e-9): boolean {
  return eigenvaluesHermitian(rho).every((x) => x >= -tol)
}

// ─────────────────────────────────────────────────────────────────────────────
// Reference states for the page and the tests
// ─────────────────────────────────────────────────────────────────────────────

const R = Math.SQRT1_2

export const BELL_PHI_PLUS: readonly Complex[] = [c(R), c(0), c(0), c(R)]
export const BELL_PSI_MINUS: readonly Complex[] = [c(0), c(R), c(-R), c(0)]

/** |ψ_A⟩ ⊗ |ψ_B⟩ for two single-qubit amplitude pairs. */
export function productState(a: readonly Complex[], b: readonly Complex[]): Complex[] {
  const out: Complex[] = []
  for (const x of a) for (const y of b) out.push(cMul(x, y))
  return out
}

/** Haar-random pure state on `dim` amplitudes (Gaussian then normalise). */
export function randomPureState(dim: number, rng: () => number): Complex[] {
  const gauss = () => {
    const u = Math.max(rng(), 1e-12)
    const v = rng()
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }
  const amps = Array.from({ length: dim }, () => c(gauss(), gauss()))
  const norm = Math.sqrt(amps.reduce((s, x) => s + cAbs2(x), 0))
  return amps.map((x) => c(x.re / norm, x.im / norm))
}

/**
 * RMS reconstruction error of the single-qubit Bloch vector over `trials`
 * fresh experiments at `shots` per axis. The page's convergence plot and the
 * 1/√N test both use this.
 */
export function singleQubitRmsError(
  rho: DensityMatrix,
  shots: number,
  trials: number,
  rng: () => number
): number {
  const truth = blochFromDensity(rho)
  let sum = 0
  for (let t = 0; t < trials; t++) {
    const est = reconstructSingleQubit(sampleSingleQubit(rho, shots, rng))
    const dx = est.vector[0] - truth[0]
    const dy = est.vector[1] - truth[1]
    const dz = est.vector[2] - truth[2]
    sum += dx * dx + dy * dy + dz * dz
  }
  return Math.sqrt(sum / trials)
}
