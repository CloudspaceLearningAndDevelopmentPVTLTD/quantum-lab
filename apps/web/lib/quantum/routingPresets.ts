/**
 * routingPresets.ts — the three circuits /workbench/routing races on, plus
 * the generators behind them so a test can build them at other sizes.
 *
 * Built from the simulator's own gate set (there is no controlled-phase gate,
 * so each CP(θ) is two CXs and three phase gates). Routing scores count those
 * CXs, which is also what a device would run.
 */

import { mulberry32, type Circuit, type GateOp } from '@/lib/quantum'

/**
 * CP(θ) = diag(1, 1, 1, e^{iθ}) as P(θ/2)⊗P(θ/2) · CX · (I⊗P(−θ/2)) · CX.
 * routing.test.ts checks this against the diagonal directly.
 */
export function controlledPhase(control: number, target: number, theta: number): GateOp[] {
  return [
    { name: 'P', qubits: [control], theta: theta / 2 },
    { name: 'P', qubits: [target], theta: theta / 2 },
    { name: 'CX', qubits: [control, target] },
    { name: 'P', qubits: [target], theta: -theta / 2 },
    { name: 'CX', qubits: [control, target] },
  ]
}

/**
 * The quantum Fourier transform WITHOUT the final bit-reversal swaps — the
 * form compilers emit, since the reversal is a relabelling. With qubit 0 the
 * least significant bit, |x⟩ ↦ (1/√N) Σ_k e^{2πi xk/N} |rev(k)⟩.
 */
export function qftCircuit(n: number): Circuit {
  const ops: GateOp[] = []
  for (let j = n - 1; j >= 0; j--) {
    ops.push({ name: 'H', qubits: [j] })
    for (let k = j - 1; k >= 0; k--) {
      ops.push(...controlledPhase(k, j, Math.PI / 2 ** (j - k)))
    }
  }
  return { numQubits: n, ops }
}

/**
 * GHZ prepared the naive way: H on qubit 0, then CX from qubit 0 to every
 * other qubit. Every CX shares the same control, so on any sparse map most of
 * them need swaps — which is exactly why it is here. (The chain form
 * CX 0→1, 1→2, … needs no swaps on a line and would make a dull race.)
 */
export function ghzStarCircuit(n: number): Circuit {
  const ops: GateOp[] = [{ name: 'H', qubits: [0] }]
  for (let q = 1; q < n; q++) ops.push({ name: 'CX', qubits: [0, q] })
  return { numQubits: n, ops }
}

/**
 * Random circuit: `layers` rounds of a single-qubit rotation on every qubit
 * followed by `cxPerLayer` CXs between uniformly random distinct pairs.
 * Seeded, so "Random 10-qubit" is the same circuit for everyone.
 */
export function randomCircuit(n: number, layers: number, cxPerLayer: number, seed: number): Circuit {
  const rng = mulberry32(seed)
  const ops: GateOp[] = []
  const singles = ['H', 'RX', 'RY', 'RZ', 'T'] as const
  for (let l = 0; l < layers; l++) {
    for (let q = 0; q < n; q++) {
      const name = singles[Math.floor(rng() * singles.length)]
      const op: GateOp = { name, qubits: [q] }
      if (name === 'RX' || name === 'RY' || name === 'RZ') op.theta = rng() * 2 * Math.PI
      ops.push(op)
    }
    for (let g = 0; g < cxPerLayer; g++) {
      const a = Math.floor(rng() * n)
      let b = Math.floor(rng() * (n - 1))
      if (b >= a) b++
      ops.push({ name: 'CX', qubits: [a, b] })
    }
  }
  return { numQubits: n, ops }
}

export interface RoutingPreset {
  id: string
  label: string
  blurb: string
  circuit: Circuit
}

export const ROUTING_PRESETS: readonly RoutingPreset[] = [
  {
    id: 'qft8',
    label: 'QFT-8',
    blurb: '8-qubit Fourier transform: 28 controlled phases, every pair of qubits talks to every other.',
    circuit: qftCircuit(8),
  },
  {
    id: 'ghz12',
    label: 'GHZ-12',
    blurb: '12-qubit GHZ in star form: eleven CXs all controlled by qubit 0.',
    circuit: ghzStarCircuit(12),
  },
  {
    id: 'random10',
    label: 'Random-10',
    blurb: '10 qubits, five layers of rotations with eight random CXs each (seed 2024).',
    circuit: randomCircuit(10, 5, 8, 2024),
  },
]
