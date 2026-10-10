/**
 * calibration.worker.ts — runs a CalibrationRun off the main thread.
 *
 * The run itself is cheap (a few hundred Bernoulli draws per step) but it is
 * bounded and paced here so the page can draw the trace as it grows without
 * the UI thread ever owning a loop. The protocol is small on purpose:
 *
 *   page → worker   { type: 'start', runId, config, stepsPerSecond }   begin a fresh run
 *                   { type: 'severity', value }                         change drift live
 *                   { type: 'stop' }                                    abandon the run
 *   worker → page   { type: 'progress', runId, records, done }          new step records
 *
 * `runId` lets the page drop a chunk from a run it has already abandoned: a
 * 'stop' and a 'start' are processed in order by the worker, but a progress
 * message the worker posted just before the 'stop' can still be in flight.
 *
 * `stepsPerSecond: 0` means "as fast as possible": steps are still delivered
 * in chunks with a yield between them so a 'stop' is honoured promptly.
 *
 * components/workbench/useCalibrationRun.ts speaks this protocol and falls back
 * to running the same loop inline (setTimeout-sliced) where Worker is missing.
 */

import { createCalibrationRun, type CalibrationConfig, type CalibrationRun, type StepRecord } from './calibration'

export type WorkerInbound =
  | { type: 'start'; runId: number; config: CalibrationConfig; stepsPerSecond: number }
  | { type: 'severity'; value: number }
  | { type: 'stop' }

export type WorkerOutbound = { type: 'progress'; runId: number; records: StepRecord[]; done: boolean }

/** Wall-clock tick between chunks when paced. 30 Hz reads as continuous. */
export const TICK_MS = 33
/** Steps per chunk when unpaced. Small enough that a stop lands within a frame. */
export const FAST_CHUNK = 40

/**
 * The loop, factored so the inline fallback and the worker share it exactly.
 * `schedule` is setTimeout in both hosts; `emit` is postMessage or a React
 * setState. Returns a stop function.
 */
export function startPacedRun(
  config: CalibrationConfig,
  stepsPerSecond: number,
  emit: (msg: WorkerOutbound) => void,
  schedule: (fn: () => void, ms: number) => unknown,
  cancel: (handle: unknown) => void,
  runId = 0
): { stop: () => void; run: CalibrationRun } {
  const run = createCalibrationRun(config)
  let stopped = false
  let handle: unknown = null
  // Fractional steps carry over between ticks so 45 steps/s at 30 Hz is exact.
  let carry = 0

  const tick = () => {
    handle = null
    if (stopped) return
    let n: number
    if (stepsPerSecond > 0) {
      carry += (stepsPerSecond * TICK_MS) / 1000
      n = Math.floor(carry)
      carry -= n
    } else {
      n = FAST_CHUNK
    }
    const records: StepRecord[] = []
    for (let i = 0; i < n; i++) {
      const r = run.step()
      if (!r) break
      records.push(r)
    }
    const done = run.done
    if (records.length > 0 || done) emit({ type: 'progress', runId, records, done })
    if (!done) handle = schedule(tick, stepsPerSecond > 0 ? TICK_MS : 0)
  }

  handle = schedule(tick, 0)
  return {
    run,
    stop: () => {
      stopped = true
      if (handle !== null) cancel(handle)
      handle = null
    },
  }
}

// ── Worker entry ─────────────────────────────────────────────────────────────
// Guarded so importing this module for its types or for startPacedRun from a
// test or the inline fallback does not try to attach to a worker scope.

type WorkerScope = {
  postMessage(msg: WorkerOutbound): void
  addEventListener(type: 'message', fn: (e: MessageEvent<WorkerInbound>) => void): void
}

// `importScripts` is absent from module workers, so the test is the global's
// prototype chain: inside any worker, globalThis is a WorkerGlobalScope.
const workerGlobal = (globalThis as { WorkerGlobalScope?: abstract new () => unknown }).WorkerGlobalScope
const isWorkerScope = typeof workerGlobal === 'function' && globalThis instanceof workerGlobal

if (isWorkerScope) {
  const scope = self as unknown as WorkerScope
  let active: { stop: () => void; run: CalibrationRun } | null = null
  scope.addEventListener('message', (e) => {
    const msg = e.data
    if (msg.type === 'start') {
      active?.stop()
      active = startPacedRun(
        msg.config,
        msg.stepsPerSecond,
        (out) => scope.postMessage(out),
        (fn, ms) => setTimeout(fn, ms),
        (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
        msg.runId
      )
    } else if (msg.type === 'severity') {
      active?.run.setSeverity(msg.value)
    } else if (msg.type === 'stop') {
      active?.stop()
      active = null
    }
  })
}
