/**
 * lib/workbench/qmlSession.ts — drives the three trainers in lib/workbench/qml.ts
 * to a bounded budget, from wherever it is called.
 *
 * The same `runQmlSession` runs inside the Web Worker
 * (lib/workbench/qml.worker.ts), on the main thread as a fallback when a
 * worker cannot be constructed, and in tests with a fake clock. The only thing
 * the environment supplies is `yieldNow`: a promise that resolves after the
 * event loop has had a turn, so a `stop` message can arrive and the tab never
 * freezes. Work is sliced by wall-clock time (`sliceMs`), not by step count,
 * because a 4-qubit VQC step is a hundred times slower than an MLP step.
 *
 * Budgets are the reader's, and visible on the page: every trainer has its own
 * step budget, and the session as a whole has a time budget. Whichever runs
 * out first ends the session; a trainer that was cut off reports `done: false`
 * and the page says so. Nothing is ever extrapolated.
 */

import {
  MODEL_IDS,
  decisionGrid,
  prepareComparison,
  type ComparisonConfig,
  type ModelId,
  type ModelReport,
} from './qml'

/** Resolution of the decision-surface grid the page paints, per side. */
export const GRID_RES = 48
/** Standardised half-width of the painted square. ±√3 covers the uniform datasets exactly. */
export const GRID_LIM = 2.2

export type SessionMessage =
  | { type: 'started'; config: ComparisonConfig }
  | { type: 'progress'; model: ModelId; report: ModelReport; grid: Float32Array | null; elapsedMs: number }
  | {
      type: 'finished'
      reports: Record<ModelId, ModelReport>
      grids: Record<ModelId, Float32Array>
      elapsedMs: number
      /** True when the time budget or a stop request ended the session early. */
      cutOff: boolean
    }
  | { type: 'error'; message: string }

export interface SessionControl {
  /** Polled between slices; return true to end the session after the current slice. */
  shouldStop: () => boolean
  /** Resolve after other work (a stop message, a paint) has had a chance to run. */
  yieldNow: () => Promise<void>
  /** Monotonic milliseconds. */
  now: () => number
  /** Longest stretch of work between yields. */
  sliceMs?: number
  /** Wall-clock cap on the whole session. */
  budgetMs: number
  /** Minimum interval between progress messages for one model. */
  progressEveryMs?: number
}

export async function runQmlSession(
  config: ComparisonConfig,
  emit: (m: SessionMessage) => void,
  control: SessionControl,
): Promise<void> {
  const sliceMs = control.sliceMs ?? 24
  const progressEveryMs = control.progressEveryMs ?? 150
  const t0 = control.now()
  const elapsed = () => control.now() - t0
  const overBudget = () => elapsed() >= control.budgetMs

  let comparison: ReturnType<typeof prepareComparison>
  try {
    comparison = prepareComparison(config)
  } catch (cause) {
    emit({ type: 'error', message: cause instanceof Error ? cause.message : String(cause) })
    return
  }
  emit({ type: 'started', config })

  const reports = {} as Record<ModelId, ModelReport>
  const grids = {} as Record<ModelId, Float32Array>
  let cutOff = false

  for (const id of MODEL_IDS) {
    const trainer = comparison.trainers[id]
    let lastProgress = -Infinity
    let lastGrid = -Infinity
    while (!trainer.done) {
      if (control.shouldStop() || overBudget()) {
        cutOff = true
        break
      }
      const sliceStart = control.now()
      while (!trainer.done && control.now() - sliceStart < sliceMs) {
        trainer.step()
      }
      const t = elapsed()
      if (t - lastProgress >= progressEveryMs || trainer.done) {
        lastProgress = t
        // The surface is the expensive part of a progress report for the VQC
        // (48² circuit runs), so it is refreshed less often than the numbers.
        const wantGrid = t - lastGrid >= 4 * progressEveryMs || trainer.done
        const grid = wantGrid ? decisionGrid(trainer, GRID_RES, GRID_LIM) : null
        if (wantGrid) lastGrid = t
        emit({ type: 'progress', model: id, report: trainer.report(), grid, elapsedMs: t })
      }
      await control.yieldNow()
    }
    reports[id] = trainer.report()
    grids[id] = decisionGrid(trainer, GRID_RES, GRID_LIM)
    if (cutOff) break
  }

  // A model the wall-clock budget never reached still gets a row here — not
  // actually blank, its trainer's current (possibly barely-trained) state,
  // honestly reported via report()/done:false, same as a cut-off model above.
  for (const id of MODEL_IDS) {
    if (!reports[id]) {
      reports[id] = comparison.trainers[id].report()
      grids[id] = decisionGrid(comparison.trainers[id], GRID_RES, GRID_LIM)
    }
  }

  emit({ type: 'finished', reports, grids, elapsedMs: elapsed(), cutOff })
}
