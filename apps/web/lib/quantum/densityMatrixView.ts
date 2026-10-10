/**
 * densityMatrixView.ts — ρ as a raw complex matrix, for the state-view widgets
 * (Hinton diagram, 3-D matrix histogram, the "state as a matrix" panel).
 *
 * Renamed from densityMatrix.ts during the wave-3 integration merge: this
 * module and lib/quantum/densityMatrix.ts were built independently on
 * separate branches and collided on the same filename with incompatible
 * APIs (this one works on a raw `ComplexMatrix` — an array of rows of
 * {re, im} — for rendering; the other exposes a `DensityMatrix` type built
 * around a Bloch-vector representation, used by the mixed-states/decoherence
 * pages). Both are kept; only this file's name changed. Update this comment
 * if the two are ever consolidated.
 *
 * A statevector |ψ⟩ describes the whole register. The density matrix
 * ρ = |ψ⟩⟨ψ| carries the same information, but unlike the vector it can also
 * describe a *part* of the register on its own: tracing out the qubits you are
 * not looking at leaves the reduced state ρ_A, which is the complete answer to
 * "what does qubit A look like to someone who only ever touches qubit A?".
 * For an entangled pair that reduced state is mixed even though the whole is
 * pure — which is what the entanglement page draws.
 *
 * CONVENTIONS (match lib/quantum.ts):
 *   - qubit q is bit q of the basis index: index = Σ_q bit_q · 2^q.
 *     Labels print MSB-first, so on two qubits index 1 is |01⟩ = qubit 0 set.
 *   - matrices are arrays of rows, each row an array of {re, im}. Row i,
 *     column j is ρ[i][j] = ⟨i|ρ|j⟩.
 *
 * This module is deliberately standalone: it imports only the Complex *type*
 * from lib/quantum.ts, so it can be tested and reused without the simulator.
 */

import type { Complex } from '@/lib/quantum'

export type { Complex }

/** A dense complex matrix, rows outermost. Square unless stated otherwise. */
export type ComplexMatrix = readonly (readonly Complex[])[]

const z = (re: number, im = 0): Complex => ({ re, im })

/** Number of qubits a d×d matrix or a length-d amplitude list describes; throws if d is not a power of two. */
export function qubitCount(dim: number): number {
  const n = Math.log2(dim)
  if (!Number.isInteger(n) || n < 0) throw new Error(`dimension ${dim} is not a power of two`)
  return n
}

/** Basis labels |00…0⟩ … |11…1⟩ in index order, MSB-first like StateVector.label(). */
export function basisLabels(numQubits: number): string[] {
  const dim = 1 << numQubits
  return Array.from({ length: dim }, (_, i) => `|${i.toString(2).padStart(numQubits, '0')}⟩`)
}

/** ρ = |ψ⟩⟨ψ|, i.e. ρ_ij = ψ_i · conj(ψ_j). The amplitudes are used as given (not renormalised). */
export function densityMatrix(amplitudes: readonly Complex[]): ComplexMatrix {
  const dim = amplitudes.length
  const rows: Complex[][] = new Array(dim)
  for (let i = 0; i < dim; i++) {
    const a = amplitudes[i]
    const row: Complex[] = new Array(dim)
    for (let j = 0; j < dim; j++) {
      const b = amplitudes[j]
      // a · conj(b) = (a.re + i a.im)(b.re − i b.im)
      row[j] = z(a.re * b.re + a.im * b.im, a.im * b.re - a.re * b.im)
    }
    rows[i] = row
  }
  return rows
}

/** The maximally mixed state I/d. */
export function maximallyMixed(dim: number): ComplexMatrix {
  return Array.from({ length: dim }, (_, i) =>
    Array.from({ length: dim }, (_, j) => z(i === j ? 1 / dim : 0))
  )
}

/** Tr ρ as a complex number (its imaginary part should be ~0 for any Hermitian ρ). */
export function trace(rho: ComplexMatrix): Complex {
  let re = 0
  let im = 0
  for (let i = 0; i < rho.length; i++) {
    re += rho[i][i].re
    im += rho[i][i].im
  }
  return z(re, im)
}

/** True when ρ = ρ† to within `tol` in every entry. */
export function isHermitian(rho: ComplexMatrix, tol = 1e-10): boolean {
  const d = rho.length
  for (let i = 0; i < d; i++) {
    if (rho[i].length !== d) return false
    for (let j = i; j < d; j++) {
      const a = rho[i][j]
      const b = rho[j][i]
      if (Math.abs(a.re - b.re) > tol || Math.abs(a.im + b.im) > tol) return false
    }
  }
  return true
}

/**
 * Purity Tr(ρ²). For Hermitian ρ this equals Σ_ij |ρ_ij|², which is what is
 * computed here — no matrix product needed. 1 for a pure state, 1/d for I/d.
 */
export function purity(rho: ComplexMatrix): number {
  let s = 0
  for (const row of rho) for (const v of row) s += v.re * v.re + v.im * v.im
  return s
}

/** Largest |ρ_ij| — the natural full-scale for a bar chart of the matrix. */
export function maxMagnitude(m: ComplexMatrix): number {
  let best = 0
  for (const row of m) for (const v of row) best = Math.max(best, Math.hypot(v.re, v.im))
  return best
}

/**
 * Partial trace over the qubits in `traceOut`.
 *
 * The result is indexed by the *kept* qubits in ascending order: the smallest
 * kept qubit becomes bit 0 of the reduced index, the next becomes bit 1, and so
 * on. Tracing nothing returns a copy; tracing everything returns the 1×1 matrix
 * [Tr ρ].
 *
 *   (ρ_keep)_{ab} = Σ_e ⟨a, e| ρ |b, e⟩
 *
 * where a, b run over kept-qubit bit patterns and e over traced-qubit patterns,
 * each spread back into the full index by the bit positions of its qubits.
 */
export function partialTrace(
  rho: ComplexMatrix,
  numQubits: number,
  traceOut: readonly number[]
): ComplexMatrix {
  const dim = 1 << numQubits
  if (rho.length !== dim) {
    throw new Error(`a ${numQubits}-qubit ρ must be ${dim}×${dim}, got ${rho.length} rows`)
  }
  const out = new Set<number>()
  for (const q of traceOut) {
    if (!Number.isInteger(q) || q < 0 || q >= numQubits) {
      throw new Error(`qubit ${q} is out of range for a ${numQubits}-qubit state`)
    }
    out.add(q)
  }
  const kept: number[] = []
  const traced: number[] = []
  for (let q = 0; q < numQubits; q++) (out.has(q) ? traced : kept).push(q)

  const keptDim = 1 << kept.length
  const tracedDim = 1 << traced.length

  /** Spread a compact bit pattern over the full-index bit positions in `qubits`. */
  const spread = (pattern: number, qubits: readonly number[]): number => {
    let idx = 0
    for (let k = 0; k < qubits.length; k++) if ((pattern >> k) & 1) idx |= 1 << qubits[k]
    return idx
  }
  const keptIndex = Array.from({ length: keptDim }, (_, a) => spread(a, kept))
  const tracedIndex = Array.from({ length: tracedDim }, (_, e) => spread(e, traced))

  const result: Complex[][] = Array.from({ length: keptDim }, () =>
    Array.from({ length: keptDim }, () => z(0))
  )
  for (let a = 0; a < keptDim; a++) {
    for (let b = 0; b < keptDim; b++) {
      let re = 0
      let im = 0
      for (let e = 0; e < tracedDim; e++) {
        const v = rho[keptIndex[a] | tracedIndex[e]][keptIndex[b] | tracedIndex[e]]
        re += v.re
        im += v.im
      }
      result[a][b] = z(re, im)
    }
  }
  return result
}

/** The reduced state of the qubits in `keep` — the partial trace over everything else. */
export function reducedState(
  rho: ComplexMatrix,
  numQubits: number,
  keep: readonly number[]
): ComplexMatrix {
  const keepSet = new Set(keep)
  const traceOut: number[] = []
  for (let q = 0; q < numQubits; q++) if (!keepSet.has(q)) traceOut.push(q)
  return partialTrace(rho, numQubits, traceOut)
}

/** Amplitudes of the Bell state Φ⁺ = (|00⟩ + |11⟩)/√2 in this module's index convention. */
export function bellPairAmplitudes(): Complex[] {
  const s = Math.SQRT1_2
  return [z(s), z(0), z(0), z(s)]
}

/** ρ for Φ⁺: 1/2 at the four corners (00,00), (00,11), (11,00), (11,11), zero elsewhere. */
export function bellPairDensityMatrix(): ComplexMatrix {
  return densityMatrix(bellPairAmplitudes())
}

/**
 * What one qubit of a Bell pair looks like on its own: I/2, the maximally
 * mixed single-qubit state. Which qubit does not matter — both halves are
 * identical. This is the whole point of the entanglement page's matrix
 * section: the pair is pure (purity 1) and each half is as mixed as a qubit
 * can be (purity 1/2).
 */
export function reducedBellQubit(qubit: 0 | 1 = 0): ComplexMatrix {
  return reducedState(bellPairDensityMatrix(), 2, [qubit])
}
