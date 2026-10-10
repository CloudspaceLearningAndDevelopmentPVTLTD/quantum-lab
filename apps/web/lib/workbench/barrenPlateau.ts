/**
 * lib/workbench/barrenPlateau.ts — measure a barren plateau instead of
 * quoting one.
 *
 * The experiment is McClean et al., "Barren plateaus in quantum neural network
 * training landscapes" (Nat. Commun. 9, 4812, 2018): build a random
 * parameterised circuit, take the gradient of a cost with respect to one
 * angle, repeat over many random circuits, and watch the VARIANCE of that
 * gradient fall exponentially with qubit count. The mean is zero, so a
 * vanishing variance means a typical starting point has no slope to follow.
 *
 * The ansatz is theirs: RY(π/4) on every qubit, then layers of one random
 * Pauli rotation per qubit followed by a ladder of CZ gates.
 *
 * Three costs, because which cost you pick decides whether the plateau needs
 * depth (Cerezo et al., Nat. Commun. 12, 1791, 2021):
 *
 *   zz      ⟨Z₀Z₁⟩                      local; plateaus only once the circuit is deep
 *   global  1 − P(all qubits read 0)    plateaus even at constant depth
 *   local   1 − mean_q P(qubit q reads 0)   decays only polynomially at shallow depth
 *
 * Gradients are exact (parameter-shift on the exact statevector), so the only
 * noise in a reported variance is the finite number of random circuits — and
 * that is returned as a standard error alongside it.
 */

import { StateVector } from '@/lib/quantum'

export type PlateauCost = 'zz' | 'global' | 'local'

const AXES = ['RX', 'RY', 'RZ'] as const

export interface RandomCircuit {
  n: number
  /** axes[layer][qubit] indexes AXES; thetas[layer][qubit] is the angle. */
  axes: number[][]
  thetas: number[][]
}

export function randomCircuit(n: number, layers: number, rng: () => number): RandomCircuit {
  if (!Number.isInteger(n) || n < 2 || n > 14) throw new Error('n must be an integer between 2 and 14')
  if (!Number.isInteger(layers) || layers < 1) throw new Error('layers must be a positive integer')
  const axes: number[][] = []
  const thetas: number[][] = []
  for (let l = 0; l < layers; l++) {
    axes.push(Array.from({ length: n }, () => Math.floor(rng() * 3)))
    thetas.push(Array.from({ length: n }, () => rng() * 2 * Math.PI))
  }
  return { n, axes, thetas }
}

/** The cost with `shift` added to the first layer's first angle. */
export function evaluateCost(circuit: RandomCircuit, cost: PlateauCost, shift = 0): number {
  const { n, axes, thetas } = circuit
  const sv = new StateVector(n)
  for (let q = 0; q < n; q++) sv.applySingle('RY', q, Math.PI / 4)
  for (let l = 0; l < axes.length; l++) {
    for (let q = 0; q < n; q++) {
      sv.applySingle(AXES[axes[l][q]], q, thetas[l][q] + (l === 0 && q === 0 ? shift : 0))
    }
    for (let q = 0; q + 1 < n; q++) sv.applyControlled('Z', [q], q + 1)
  }

  const d = sv.data
  if (cost === 'global') return 1 - (d[0] * d[0] + d[1] * d[1])
  let acc = 0
  for (let i = 0; i < sv.dim; i++) {
    const p = d[2 * i] * d[2 * i] + d[2 * i + 1] * d[2 * i + 1]
    if (cost === 'zz') {
      acc += (i & 1) === ((i >> 1) & 1) ? p : -p
    } else {
      // n − popcount(i) of this basis state's qubits read 0.
      let ones = 0
      for (let v = i; v; v &= v - 1) ones++
      acc += p * (n - ones)
    }
  }
  return cost === 'zz' ? acc : 1 - acc / n
}

/**
 * ∂cost/∂θ for the first angle, by the parameter-shift rule. Exact for a
 * rotation exp(−iθP/2) and any observable — it is not a finite difference.
 */
export function gradient(circuit: RandomCircuit, cost: PlateauCost): number {
  return (evaluateCost(circuit, cost, Math.PI / 2) - evaluateCost(circuit, cost, -Math.PI / 2)) / 2
}

export interface VariancePoint {
  n: number
  layers: number
  samples: number
  /** Sample variance of the gradient over random circuits. */
  variance: number
  /** Standard error of that variance, from the spread of squared deviations. */
  stderr: number
}

export function summariseGradients(n: number, layers: number, gradients: readonly number[]): VariancePoint {
  const N = gradients.length
  if (N < 2) return { n, layers, samples: N, variance: 0, stderr: 0 }
  const mean = gradients.reduce((a, b) => a + b, 0) / N
  const sq = gradients.map((g) => (g - mean) ** 2)
  const variance = sq.reduce((a, b) => a + b, 0) / (N - 1)
  const meanSq = sq.reduce((a, b) => a + b, 0) / N
  const spread = sq.reduce((a, b) => a + (b - meanSq) ** 2, 0) / (N - 1)
  return { n, layers, samples: N, variance, stderr: Math.sqrt(spread / N) }
}

export function gradientVariance(
  n: number,
  layers: number,
  cost: PlateauCost,
  samples: number,
  rng: () => number,
): VariancePoint {
  const gradients: number[] = []
  for (let i = 0; i < samples; i++) gradients.push(gradient(randomCircuit(n, layers, rng), cost))
  return summariseGradients(n, layers, gradients)
}

export interface DecayFit {
  /** Slope of log₂(variance) against n. −1 means the variance halves per added qubit. */
  slopePerQubit: number
  intercept: number
}

/** Least-squares line through log₂(variance) vs n. null with under two usable points. */
export function fitDecay(points: readonly VariancePoint[]): DecayFit | null {
  const usable = points.filter((p) => p.variance > 0)
  if (usable.length < 2) return null
  const xs = usable.map((p) => p.n)
  const ys = usable.map((p) => Math.log2(p.variance))
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length
  const my = ys.reduce((a, b) => a + b, 0) / ys.length
  const sxx = xs.reduce((a, x) => a + (x - mx) ** 2, 0)
  if (sxx === 0) return null
  const slope = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / sxx
  return { slopePerQubit: slope, intercept: my - slope * mx }
}
