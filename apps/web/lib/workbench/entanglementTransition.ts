/**
 * lib/workbench/entanglementTransition.ts — the measurement-induced
 * entanglement transition, at the scale a browser tab reaches.
 *
 * The experiment (Li, Chen & Fisher, Phys. Rev. B 98, 205136, 2018; Skinner,
 * Ruhman & Nahum, Phys. Rev. X 9, 031009, 2019): a chain of L qubits evolves
 * under a brickwork of random two-qubit gates, and after every layer each
 * qubit is measured with probability p. Unitaries build entanglement,
 * measurements destroy it, and the half-chain entropy of the resulting pure
 * state switches from growing with L (volume law) to not growing (area law)
 * at a critical p.
 *
 * With Clifford gates the whole thing runs on a stabilizer tableau, which is
 * how the published numerics reach hundreds of qubits — and why this can run
 * here at all.
 *
 * What this module does NOT do is locate the critical point. It returns means
 * with standard errors at the sizes you ask for; the crossing of a handful of
 * small-L curves is a finite-size estimate, and the page says so.
 */

import { Tableau, applyRandomTwoQubitClifford } from '@/lib/quantum/stabilizer'

/**
 * The critical rate reported for random Clifford circuits with projective
 * measurements, from finite-size scaling on chains of hundreds of qubits (Li, Chen & Fisher,
 * Phys. Rev. B 100, 134306, 2019). A literature value — never computed here.
 */
export const LITERATURE_P_C = 0.16

export interface TransitionSample {
  /** S(L/2) in bits at the end of the circuit. */
  halfChainEntropy: number
  /** How many single-qubit measurements the circuit made. */
  measurements: number
}

/**
 * One circuit realisation. Open boundaries: layer t couples (0,1),(2,3),… when
 * t is even and (1,2),(3,4),… when odd. `layers` defaults to 2L, long enough
 * for the half-chain entropy to saturate from a product state at these sizes.
 */
export function sampleHybridCircuit(
  L: number,
  p: number,
  rng: () => number,
  layers: number = 2 * L,
): TransitionSample {
  if (!Number.isInteger(L) || L < 2) throw new Error('L must be an integer of at least 2')
  if (!(p >= 0 && p <= 1)) throw new Error('p must be between 0 and 1')
  const t = new Tableau(L)
  let measurements = 0
  for (let layer = 0; layer < layers; layer++) {
    for (let q = layer % 2; q + 1 < L; q += 2) applyRandomTwoQubitClifford(t, q, q + 1, rng)
    if (p > 0) {
      for (let q = 0; q < L; q++) {
        if (rng() < p) {
          t.measure(q, rng)
          measurements++
        }
      }
    }
  }
  return { halfChainEntropy: t.entropy(L >> 1), measurements }
}

export interface TransitionPoint {
  L: number
  p: number
  samples: number
  /** Mean half-chain entropy over circuit realisations, in bits. */
  mean: number
  /** Standard error of that mean. 0 when samples < 2. */
  stderr: number
}

export function summarise(L: number, p: number, entropies: readonly number[]): TransitionPoint {
  const n = entropies.length
  const mean = n ? entropies.reduce((a, b) => a + b, 0) / n : 0
  const variance = n > 1 ? entropies.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1) : 0
  return { L, p, samples: n, mean, stderr: n > 1 ? Math.sqrt(variance / n) : 0 }
}

/** One (L, p) point: `samples` independent circuits. */
export function transitionPoint(L: number, p: number, samples: number, rng: () => number): TransitionPoint {
  const entropies: number[] = []
  for (let i = 0; i < samples; i++) entropies.push(sampleHybridCircuit(L, p, rng).halfChainEntropy)
  return summarise(L, p, entropies)
}
