/**
 * lib/workbench/qml.worker.ts — the Web Worker behind /workbench/qml-check.
 *
 * Nothing but message plumbing: the training itself is `runQmlSession`, which
 * is the same function the main-thread fallback and the tests call. The page
 * constructs this with `new Worker(new URL('./qml.worker.ts', import.meta.url))`
 * (components/workbench/useQmlSession.ts), which is the form the bundler
 * knows how to split into its own chunk.
 *
 * One session at a time. A `start` while a session is running stops the old
 * one first; the old session's final `finished` message is still delivered
 * (with cutOff: true) before the new one's `started`, because the loop only
 * checks the flag between slices.
 */

import type { ComparisonConfig } from './qml'
import { runQmlSession, type SessionMessage } from './qmlSession'

export type WorkerRequest =
  | { type: 'start'; config: ComparisonConfig; budgetMs: number }
  | { type: 'stop' }

const ctx = self as unknown as {
  postMessage: (m: SessionMessage) => void
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null
}

let stopRequested = false
let running: Promise<void> | null = null

/** A macrotask turn: lets a queued `stop` message run before the next slice. */
const yieldNow = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

ctx.onmessage = (e) => {
  const msg = e.data
  if (msg.type === 'stop') {
    stopRequested = true
    return
  }
  if (msg.type === 'start') {
    const previous = running
    stopRequested = true
    running = (async () => {
      if (previous) await previous
      stopRequested = false
      await runQmlSession(msg.config, (m) => ctx.postMessage(m), {
        shouldStop: () => stopRequested,
        yieldNow,
        now: () => performance.now(),
        budgetMs: msg.budgetMs,
      })
    })()
  }
}
