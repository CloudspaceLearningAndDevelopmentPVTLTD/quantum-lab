/**
 * backend.ts — the StatevectorBackend contract, and the CPU implementation.
 *
 * A backend owns one statevector and applies matrices to it. It does not know
 * gate names: lib/quantum.ts's runCircuitOn() turns a Circuit into matrix
 * calls, recordCircuit() below captures that stream as a BackendOp list, and
 * runCircuit() replays the list — optionally after the kernel-fusion pass in
 * lib/quantum/webgpu/fusion.ts — onto whichever backend the caller picked.
 *
 *   const backend = await createBackend({ prefer: 'webgpu' })   // webgpu/index.ts
 *   backend.allocate(20)
 *   runCircuit(circuit, backend)
 *   await backend.flush()
 *   const top = await backend.topStates(4)
 *   backend.dispose()
 *
 * Two implementations exist:
 *   CpuBackend    — this file. Float64. Wraps lib/quantum.ts's StateVector for
 *                   everything the engine exposes (allocation, SWAP, marginal
 *                   probability, collapse, probabilities, readback); the matrix
 *                   kernels themselves come from lib/quantum/webgpu/reference.ts,
 *                   because the engine applies gates by NAME and a backend
 *                   receives matrices. Above the engine's 16-qubit ceiling the
 *                   same reference kernels run on a raw Float64Array.
 *   WebGpuBackend — lib/quantum/webgpu/WebGpuBackend.ts. Float32 on the GPU.
 *
 * Every method that reads the state back is async because the GPU one has to
 * be; the gate methods are synchronous and, on the GPU, merely enqueue work.
 * flush() is the barrier: after `await backend.flush()` every enqueued gate has
 * finished, which is what a timing measurement needs.
 */

import {
  StateVector,
  runCircuitOn,
  type Circuit,
  type GateSink,
  type Matrix2x2,
} from '@/lib/quantum'
import {
  applyControlledRef,
  applyGateRef,
  applySwapRef,
  collapseRef,
  marginalRef,
  probabilitiesRef,
  topStatesRef,
  type AmplitudeArray,
  type BasisState,
} from './webgpu/reference'
import { assertQubit, dimension } from './webgpu/indexing'
import { fuseSingleQubitGates } from './webgpu/fusion'

export type BackendKind = 'cpu' | 'webgpu'
export type Precision = 'float64' | 'float32'

export interface StatevectorBackend extends GateSink {
  readonly kind: BackendKind
  readonly precision: Precision
  /** Qubits currently allocated; 0 before allocate(). */
  readonly numQubits: number
  /** Largest qubit count this backend will allocate. */
  readonly maxQubits: number
  /** Reset to |0…0⟩ on n qubits. Frees any previous state. */
  allocate(n: number): void
  /** Wait until every enqueued gate has finished. Resolves immediately on the CPU. */
  flush(): Promise<void>
  /** |a_i|² for every basis state — 2^n numbers; use topStates() when n is large. */
  probabilities(): Promise<Float64Array>
  /** Interleaved [re, im] amplitudes. Float32Array from the GPU, Float64Array from the CPU. */
  amplitudes(): Promise<AmplitudeArray>
  /** The k most probable basis states, highest first. */
  topStates(k: number): Promise<BasisState[]>
  /** Marginal probability that `target` reads 1. */
  marginal(target: number): Promise<number>
  /** Collapse `target`, returning the observed bit. */
  measure(target: number, rng?: () => number): Promise<0 | 1>
  /** Release every resource. The backend is unusable afterwards. */
  dispose(): void
}

// ────────────────────────────────────────────────────────────
// BackendOp — a circuit reduced to matrix calls
// ────────────────────────────────────────────────────────────

export type BackendOp =
  | { kind: 'gate'; matrix: Matrix2x2; target: number }
  | { kind: 'controlled'; matrix: Matrix2x2; controls: number[]; target: number }
  | { kind: 'swap'; a: number; b: number }

/** Capture the matrix stream runCircuitOn() would send to a backend. */
export function recordCircuit(circuit: Circuit): BackendOp[] {
  const ops: BackendOp[] = []
  runCircuitOn(circuit, {
    applyGate: (matrix, target) => ops.push({ kind: 'gate', matrix, target }),
    applyControlled: (matrix, controls, target) =>
      ops.push({ kind: 'controlled', matrix, controls: [...controls], target }),
    applySwap: (a, b) => ops.push({ kind: 'swap', a, b }),
  })
  return ops
}

/** Send a BackendOp list to a sink in order. */
export function replayOps(ops: readonly BackendOp[], sink: GateSink): void {
  for (const op of ops) {
    switch (op.kind) {
      case 'gate': sink.applyGate(op.matrix, op.target); break
      case 'controlled': sink.applyControlled(op.matrix, op.controls, op.target); break
      case 'swap': sink.applySwap(op.a, op.b); break
    }
  }
}

export interface RunCircuitOptions {
  /** Fuse runs of single-qubit gates on one qubit into one matrix. Default true. */
  fuse?: boolean
}

/**
 * Run a circuit on an allocated backend. Returns the number of backend calls
 * actually made (after fusion), which is the dispatch count on the GPU.
 */
export function runCircuit(
  circuit: Circuit,
  backend: StatevectorBackend,
  options: RunCircuitOptions = {},
): number {
  if (backend.numQubits !== circuit.numQubits) {
    throw new Error(
      `backend holds ${backend.numQubits} qubits but the circuit needs ${circuit.numQubits}; call allocate() first`
    )
  }
  const recorded = recordCircuit(circuit)
  const ops = options.fuse === false ? recorded : fuseSingleQubitGates(recorded)
  replayOps(ops, backend)
  return ops.length
}

// ────────────────────────────────────────────────────────────
// CpuBackend
// ────────────────────────────────────────────────────────────

/** The StateVector engine's own ceiling (lib/quantum.ts). */
export const ENGINE_MAX_QUBITS = 16

/**
 * 2^28 complex doubles is 4 GB — past what a tab will allocate. 2^27 (2 GB)
 * fails on most machines too, so the honest ceiling for the CPU path is where
 * `new Float64Array` stops throwing, and the workbench probes for it under a
 * stated budget rather than trusting this constant.
 */
export const CPU_MAX_QUBITS = 27

export class CpuBackend implements StatevectorBackend {
  readonly kind = 'cpu' as const
  readonly precision = 'float64' as const
  readonly maxQubits = CPU_MAX_QUBITS
  private n = 0
  private sv: StateVector | null = null
  private data: Float64Array = new Float64Array(0)
  private disposed = false

  get numQubits(): number { return this.n }

  allocate(n: number): void {
    this.assertLive()
    dimension(n) // validates 1..30
    if (n > this.maxQubits) throw new Error(`CpuBackend allocates at most ${this.maxQubits} qubits, got ${n}`)
    this.release()
    if (n <= ENGINE_MAX_QUBITS) {
      this.sv = new StateVector(n)
      this.data = this.sv.data
    } else {
      this.sv = null
      this.data = new Float64Array(2 * dimension(n))
      this.data[0] = 1
    }
    this.n = n
  }

  applyGate(matrix: Matrix2x2, target: number): void {
    this.assertAllocated()
    applyGateRef(this.data, this.n, matrix, target)
  }

  applyControlled(matrix: Matrix2x2, controls: readonly number[], target: number): void {
    this.assertAllocated()
    applyControlledRef(this.data, this.n, matrix, controls, target)
  }

  applySwap(a: number, b: number): void {
    this.assertAllocated()
    if (this.sv) this.sv.applySwap(a, b)
    else applySwapRef(this.data, this.n, a, b)
  }

  async flush(): Promise<void> {
    this.assertLive()
  }

  async probabilities(): Promise<Float64Array> {
    this.assertAllocated()
    if (this.sv) return Float64Array.from(this.sv.probabilities())
    return probabilitiesRef(this.data)
  }

  async amplitudes(): Promise<Float64Array> {
    this.assertAllocated()
    return this.data.slice()
  }

  async topStates(k: number): Promise<BasisState[]> {
    this.assertAllocated()
    return topStatesRef(this.data, k)
  }

  async marginal(target: number): Promise<number> {
    this.assertAllocated()
    if (this.sv) return this.sv.qubitProbability(target)
    return marginalRef(this.data, this.n, target)
  }

  async measure(target: number, rng: () => number = Math.random): Promise<0 | 1> {
    this.assertAllocated()
    if (this.sv) return this.sv.measureQubit(target, rng)
    assertQubit(target, this.n)
    const p1 = marginalRef(this.data, this.n, target)
    const outcome: 0 | 1 = rng() < p1 ? 1 : 0
    collapseRef(this.data, this.n, target, outcome, p1)
    return outcome
  }

  dispose(): void {
    this.release()
    this.disposed = true
  }

  private release(): void {
    this.sv = null
    this.data = new Float64Array(0)
    this.n = 0
  }

  private assertLive(): void {
    if (this.disposed) throw new Error('CpuBackend has been disposed')
  }

  private assertAllocated(): void {
    this.assertLive()
    if (this.n === 0) throw new Error('call allocate(n) before applying gates')
  }
}

/** Bytes one statevector of n qubits occupies at the given precision. */
export function statevectorBytes(numQubits: number, precision: Precision): number {
  return dimension(numQubits) * (precision === 'float64' ? 16 : 8)
}
