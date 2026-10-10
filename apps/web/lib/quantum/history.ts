/**
 * history.ts — a small, pure undo/redo stack, generic over any value type.
 *
 * Deliberately hook-free: nothing here touches React. A thin wrapper in the
 * simulator page (a `useReducer` around these functions) is what makes it
 * live state; this module is just the transition logic, which is why it is
 * trivial to unit-test in isolation.
 *
 * Standard undo-stack semantics:
 *  - `push` records the current `present` into `past` and clears `future`
 *    (redoing a stale branch after a fresh edit would be surprising).
 *  - `undo` / `redo` are no-ops when there is nothing to undo/redo — they
 *    return the SAME state reference, so a caller (e.g. a React reducer) can
 *    bail out cheaply and skip a re-render.
 *  - `past` is capped at MAX_PAST entries; pushing beyond the cap drops the
 *    oldest entry rather than growing unbounded.
 */

/** How many past states to retain. Older entries are dropped on push. */
export const MAX_PAST = 100

export interface HistoryState<T> {
  past: T[]
  present: T
  future: T[]
}

/** A fresh history with no past or future — `present` is the starting value. */
export function createHistory<T>(present: T): HistoryState<T> {
  return { past: [], present, future: [] }
}

/**
 * Record a new present value. The old present moves onto `past` (capped at
 * MAX_PAST, oldest dropped first) and `future` is cleared — pushing after an
 * undo abandons whatever was undone, same as any editor's undo stack.
 */
export function push<T>(state: HistoryState<T>, value: T): HistoryState<T> {
  const past = [...state.past, state.present]
  if (past.length > MAX_PAST) past.splice(0, past.length - MAX_PAST)
  return { past, present: value, future: [] }
}

/** Step back one entry. A no-op (same reference) when `past` is empty. */
export function undo<T>(state: HistoryState<T>): HistoryState<T> {
  if (state.past.length === 0) return state
  const present = state.past[state.past.length - 1]
  const past = state.past.slice(0, -1)
  return { past, present, future: [state.present, ...state.future] }
}

/** Step forward one entry. A no-op (same reference) when `future` is empty. */
export function redo<T>(state: HistoryState<T>): HistoryState<T> {
  if (state.future.length === 0) return state
  const [present, ...future] = state.future
  const past = [...state.past, state.present]
  if (past.length > MAX_PAST) past.splice(0, past.length - MAX_PAST)
  return { past, present, future }
}

export function canUndo<T>(state: HistoryState<T>): boolean {
  return state.past.length > 0
}

export function canRedo<T>(state: HistoryState<T>): boolean {
  return state.future.length > 0
}
