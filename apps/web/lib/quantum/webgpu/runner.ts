/**
 * runner.ts — time a circuit on a backend, and walk N upward to find the
 * largest state a backend can hold under a budget.
 *
 * Backend-agnostic: the page hands in whichever StatevectorBackend it got
 * from createBackend(), and the tests hand in a CpuBackend with a fake clock.
 * Timing brackets runCircuit() → flush(): allocation is excluded (it is a
 * one-off per size and, on the GPU, is a buffer create rather than compute),
 * and readback is excluded (the page reports it separately as part of the
 * float32-vs-float64 comparison).
 */

import type { Circuit } from '@/lib/quantum'
import { runCircuit, statevectorBytes, type BackendKind, type Precision, type StatevectorBackend } from '../backend'
import { DEFAULT_BUDGET, benchmarkCircuit, nextProbeStep, type BenchmarkKind, type ProbeBudget } from './benchmarks'
import type { AmplitudeArray, BasisState } from './reference'

export interface RunReport {
  kind: BackendKind
  precision: Precision
  numQubits: number
  /** Gates in the circuit as written. */
  gates: number
  /** Backend calls after kernel fusion — dispatches on the GPU. */
  dispatches: number
  /** runCircuit() start → flush() resolved, in ms. */
  wallMs: number
  /** Statevector size on this backend. */
  bytes: number
  /** The most probable basis states, highest first. */
  top: BasisState[]
  /** Full amplitudes, when asked for. */
  amplitudes?: AmplitudeArray
}

export interface TimeOptions {
  now?: () => number
  /** How many top states to report. Default 8. */
  topK?: number
  /** Read the full statevector back. Off by default — 2^N × 8 bytes over the bus. */
  readAmplitudes?: boolean
  fuse?: boolean
}

/** Allocate, run, flush, and report. The backend is left holding the final state. */
export async function timeCircuit(
  backend: StatevectorBackend,
  circuit: Circuit,
  options: TimeOptions = {},
): Promise<RunReport> {
  const now = options.now ?? defaultNow
  backend.allocate(circuit.numQubits)
  const start = now()
  const dispatches = runCircuit(circuit, backend, { fuse: options.fuse })
  await backend.flush()
  const wallMs = now() - start
  const top = await backend.topStates(options.topK ?? 8)
  const amplitudes = options.readAmplitudes ? await backend.amplitudes() : undefined
  return {
    kind: backend.kind,
    precision: backend.precision,
    numQubits: circuit.numQubits,
    gates: circuit.ops.length,
    dispatches,
    wallMs,
    bytes: statevectorBytes(circuit.numQubits, backend.precision),
    top,
    amplitudes,
  }
}

export interface ProbeRung {
  numQubits: number
  wallMs: number
  bytes: number
}

export interface ProbeReport {
  kind: BackendKind
  /** Largest N that completed inside the budget. */
  largest: number
  /** Why the probe stopped. */
  reason: string
  rungs: ProbeRung[]
  budget: ProbeBudget
}

export interface ProbeOptions {
  now?: () => number
  budget?: ProbeBudget
  /** First size to try. Default 4. */
  startQubits?: number
  /** Called after every rung so a page can render progress. */
  onRung?: (rung: ProbeRung) => void
  /** Return true to abort; the report then says so. */
  shouldStop?: () => boolean
  /** Let the event loop breathe between rungs (the CPU path blocks the thread while it runs). */
  yieldBetween?: () => Promise<void>
  seed?: number
}

/**
 * Run `kind` at increasing N on `backend` until nextProbeStep() says stop.
 * The backend's own ceiling (maxQubits) is folded into the budget so a GPU
 * that binds at most 2^26 amplitudes stops there with that reason.
 */
export async function probeCapacity(
  backend: StatevectorBackend,
  kind: BenchmarkKind,
  options: ProbeOptions = {},
): Promise<ProbeReport> {
  const now = options.now ?? defaultNow
  const base = options.budget ?? DEFAULT_BUDGET
  const budget: ProbeBudget = { ...base, maxQubits: Math.min(base.maxQubits, backend.maxQubits) }
  const rungs: ProbeRung[] = []
  let n = Math.max(1, Math.min(options.startQubits ?? 4, budget.maxQubits))
  let lastMs: number | undefined

  // The first rung always runs; after that nextProbeStep() decides.
  for (;;) {
    if (options.shouldStop?.()) {
      return { kind: backend.kind, largest: rungs.at(-1)?.numQubits ?? 0, reason: 'stopped', rungs, budget }
    }
    let wallMs: number
    try {
      const report = await timeCircuit(backend, benchmarkCircuit(kind, n, options.seed), { now, topK: 1 })
      wallMs = report.wallMs
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return {
        kind: backend.kind,
        largest: rungs.at(-1)?.numQubits ?? 0,
        reason: `${n} qubits failed: ${message}`,
        rungs,
        budget,
      }
    }
    const rung = { numQubits: n, wallMs, bytes: statevectorBytes(n, backend.precision) }
    rungs.push(rung)
    options.onRung?.(rung)
    lastMs = wallMs
    const step = nextProbeStep(backend.precision, n, lastMs, budget)
    if (step.action === 'stop') {
      // nextProbeStep() already discounts a run that itself broke the time
      // budget (largest = n − 1); the rung stays in the list so the page can
      // show the number that crossed the line.
      return { kind: backend.kind, largest: Math.max(0, step.largest), reason: step.reason, rungs, budget }
    }
    n = step.numQubits
    if (options.yieldBetween) await options.yieldBetween()
  }
}

function defaultNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}
