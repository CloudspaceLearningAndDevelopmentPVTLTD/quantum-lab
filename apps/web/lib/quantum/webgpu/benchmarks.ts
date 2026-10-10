/**
 * benchmarks.ts — the circuits the GPU Simulator workbench runs, and the
 * capacity-probe arithmetic, as pure functions.
 *
 * Three families, all parametrised by qubit count so the same shape scales
 * from 2 qubits to whatever the machine allows:
 *
 *   random   depth-20 layers of one random single-qubit gate per qubit plus one
 *            CX on a random pair — dense, no structure, the honest throughput
 *            test. Seeded, so CPU and GPU run the identical circuit.
 *   qft      the quantum Fourier transform: H, then controlled phases, then the
 *            reversing swaps. Its controlled phase is not in lib/quantum.ts's
 *            gate set, so it is decomposed into P and CX (cphase() below) —
 *            that is what makes QFT-N O(N²) gates here, as on hardware.
 *   ghz      H on qubit 0 and a CX chain. O(N) gates; the state has exactly two
 *            non-zero amplitudes, which is what makes it a good top-states check.
 *
 * The capacity probe walks N upward on one backend until the NEXT step would
 * blow a memory or time budget. The decision is nextProbeStep(); the page just
 * loops on it.
 */

import { mulberry32, type Circuit, type GateOp } from '@/lib/quantum'
import { statevectorBytes, type Precision } from '../backend'

export type BenchmarkKind = 'random' | 'qft' | 'ghz'

export const BENCHMARK_LABELS: Record<BenchmarkKind, string> = {
  random: 'Random, depth 20',
  qft: 'QFT-N',
  ghz: 'GHZ-N',
}

export const RANDOM_DEPTH = 20

const SINGLE_GATES = ['H', 'X', 'Y', 'Z', 'S', 'T', 'RX', 'RY', 'RZ'] as const

/**
 * Depth-`depth` random circuit. Each layer: one random single-qubit gate on
 * every qubit (rotations get a random angle), then one CX on a random pair.
 * Deterministic for a given seed.
 */
export function randomCircuit(numQubits: number, depth = RANDOM_DEPTH, seed = 16): Circuit {
  assertCount(numQubits)
  const rng = mulberry32(seed)
  const ops: GateOp[] = []
  for (let layer = 0; layer < depth; layer++) {
    for (let q = 0; q < numQubits; q++) {
      const name = SINGLE_GATES[Math.floor(rng() * SINGLE_GATES.length)]
      const op: GateOp = { name, qubits: [q] }
      if (name === 'RX' || name === 'RY' || name === 'RZ') op.theta = rng() * 2 * Math.PI
      ops.push(op)
    }
    if (numQubits >= 2) {
      const control = Math.floor(rng() * numQubits)
      let target = Math.floor(rng() * (numQubits - 1))
      if (target >= control) target++
      ops.push({ name: 'CX', qubits: [control, target] })
    }
  }
  return { numQubits, ops }
}

/**
 * Controlled phase CP(θ) from the gates lib/quantum.ts has:
 *   P(θ/2) on control · P(θ/2) on target · CX · P(−θ/2) on target · CX
 * On |11⟩ the two P(θ/2) contribute e^{iθ} and the CX pair leaves the target
 * at 1 during the P(−θ/2), which then does nothing; on every other basis state
 * the phases cancel. So the diagonal is (1, 1, 1, e^{iθ}) — CP(θ).
 */
export function cphase(control: number, target: number, theta: number): GateOp[] {
  return [
    { name: 'P', qubits: [control], theta: theta / 2 },
    { name: 'P', qubits: [target], theta: theta / 2 },
    { name: 'CX', qubits: [control, target] },
    { name: 'P', qubits: [target], theta: -theta / 2 },
    { name: 'CX', qubits: [control, target] },
  ]
}

/**
 * QFT on n qubits in the textbook order (Nielsen & Chuang 5.1): for each
 * qubit from the most significant down, H then CP(π/2^k) from each less
 * significant qubit, and finally swap to reverse the register. The result on
 * |x⟩ is Σ_k e^{2πi xk / 2^n} |k⟩ / √2^n with k read in this module's
 * LSB-first convention.
 */
export function qftCircuit(numQubits: number): Circuit {
  assertCount(numQubits)
  const ops: GateOp[] = []
  for (let j = numQubits - 1; j >= 0; j--) {
    ops.push({ name: 'H', qubits: [j] })
    for (let m = j - 1; m >= 0; m--) {
      const k = j - m + 1
      ops.push(...cphase(m, j, Math.PI / 2 ** (k - 1)))
    }
  }
  for (let i = 0; i < Math.floor(numQubits / 2); i++) {
    ops.push({ name: 'SWAP', qubits: [i, numQubits - 1 - i] })
  }
  return { numQubits, ops }
}

/** (|0…0⟩ + |1…1⟩)/√2 via H on qubit 0 and a CX chain. */
export function ghzCircuit(numQubits: number): Circuit {
  assertCount(numQubits)
  const ops: GateOp[] = [{ name: 'H', qubits: [0] }]
  for (let q = 1; q < numQubits; q++) ops.push({ name: 'CX', qubits: [q - 1, q] })
  return { numQubits, ops }
}

export function benchmarkCircuit(kind: BenchmarkKind, numQubits: number, seed = 16): Circuit {
  switch (kind) {
    case 'random': return randomCircuit(numQubits, RANDOM_DEPTH, seed)
    case 'qft': return qftCircuit(numQubits)
    case 'ghz': return ghzCircuit(numQubits)
  }
}

function assertCount(n: number): void {
  if (!Number.isInteger(n) || n < 1 || n > 30) {
    throw new Error(`numQubits must be an integer between 1 and 30, got ${n}`)
  }
}

// ────────────────────────────────────────────────────────────
// Capacity probe
// ────────────────────────────────────────────────────────────

export interface ProbeBudget {
  /** Largest statevector the probe will allocate, in bytes. */
  memoryBytes: number
  /** Longest single run the probe will accept before stopping, in ms. */
  timeMs: number
  /** Never probe past this many qubits regardless of budget. */
  maxQubits: number
}

/** 1 GiB of amplitudes and 2 s per circuit: enough to be honest, not enough to hang a tab. */
export const DEFAULT_BUDGET: ProbeBudget = {
  memoryBytes: 1024 * 1024 * 1024,
  timeMs: 2000,
  maxQubits: 28,
}

/** How much longer one more qubit takes: the state doubles and the gate count grows a little. */
export const TIME_GROWTH_PER_QUBIT = 2.2

export type ProbeStep =
  | { action: 'run'; numQubits: number }
  | { action: 'stop'; reason: string; largest: number }

/**
 * Decide the next probe step from the last run. `lastMs` is undefined before
 * the first run. Stops when the last run already broke the time budget, when
 * the next run is predicted to, or when the next state would not fit.
 */
export function nextProbeStep(
  precision: Precision,
  lastN: number,
  lastMs: number | undefined,
  budget: ProbeBudget = DEFAULT_BUDGET,
): ProbeStep {
  if (lastMs !== undefined && lastMs > budget.timeMs) {
    return {
      action: 'stop',
      reason: `${lastN} qubits took ${fmtMs(lastMs)}, over the ${fmtMs(budget.timeMs)} budget`,
      largest: lastN - 1,
    }
  }
  const next = lastN + 1
  if (next > budget.maxQubits) {
    return { action: 'stop', reason: `probe ceiling of ${budget.maxQubits} qubits reached`, largest: lastN }
  }
  const bytes = statevectorBytes(next, precision)
  if (bytes > budget.memoryBytes) {
    return {
      action: 'stop',
      reason: `${next} qubits needs ${fmtBytes(bytes)}, over the ${fmtBytes(budget.memoryBytes)} budget`,
      largest: lastN,
    }
  }
  if (lastMs !== undefined && lastMs * TIME_GROWTH_PER_QUBIT > budget.timeMs) {
    return {
      action: 'stop',
      reason: `${next} qubits would take about ${fmtMs(lastMs * TIME_GROWTH_PER_QUBIT)}, over the ${fmtMs(budget.timeMs)} budget`,
      largest: lastN,
    }
  }
  return { action: 'run', numQubits: next }
}

export function fmtMs(ms: number): string {
  if (!Number.isFinite(ms)) return '—'
  if (ms < 1) return `${(ms * 1000).toFixed(0)} µs`
  if (ms < 1000) return `${ms.toFixed(ms < 10 ? 2 : 0)} ms`
  return `${(ms / 1000).toFixed(2)} s`
}

export function fmtBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(bytes < 10 * 1024 ** 2 ? 1 : 0)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}
