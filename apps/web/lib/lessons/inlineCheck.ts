/**
 * inlineCheck.ts — the logic behind the 'inline-check' block
 * (components/lesson/InlineCheck.tsx renders it, LessonShell gates on it).
 *
 * WHY a separate module: this repo's vitest run is a plain Node environment
 * (see vitest.config.ts — no DOM, no testing-library), so, exactly as
 * lib/deeperExplain.ts does, the state machine and the "which blocks render"
 * decision live here as pure functions the tests can exercise directly, and
 * the .tsx file stays a thin view over them.
 *
 * WHY the block exists at all: Brilliant's question-first pattern. The
 * research on QL's shape called out prose-then-end-quiz as the gap — the
 * learner never commits to a prediction before reading the answer, so the
 * reading never gets to surprise them. An inline-check sits BEFORE the
 * section that answers it.
 *
 * THE GATE IS SOFT, ON PURPOSE. `gateBlocks` withholds the blocks after an
 * unrevealed check, but the check itself always offers a "show me anyway"
 * skip that reveals them unconditionally. Nothing is ever actually blocked:
 * this is a nudge to predict, not an access control, and it must never be
 * confused with the paywall in lib/lessons/access.ts, which is enforced
 * server-side precisely because nothing client-side can be.
 *
 * ANALYTICS/PROGRESS: deliberately none. `recordQuizScore` is keyed per
 * lesson and its denominator is the metadata outline's QUIZ question count
 * (lib/coach/recommend.ts, components/admin/CohortProgress.tsx) — feeding
 * inline-check answers into it would corrupt the coach's ratios. And
 * `EventName` in lib/analytics/events.ts is a closed union owned outside
 * this change, so there is no honest event to emit without widening it.
 * The block is render-only for now; the seam to add later is the `onReveal`
 * callback in the component.
 */

import type { InlineCheckBlock, LessonBlock } from './types'

export interface InlineCheckState {
  /** The option id the learner locked in, or null before (or after a skip). */
  pickedId: string | null
  /** True once the gated content below the check should render. */
  revealed: boolean
  /** True when the learner revealed via "show me anyway" without answering. */
  skipped: boolean
}

export const INITIAL_CHECK_STATE: InlineCheckState = {
  pickedId: null,
  revealed: false,
  skipped: false,
}

/**
 * Lock in an answer. First pick wins and reveals the content below; picking
 * again is a no-op (the returned state is `===` the input, so callers can
 * cheaply detect "nothing happened"). A pick after a skip is allowed — the
 * question stays answerable so a skipper can still commit and get feedback.
 */
export function pickOption(state: InlineCheckState, optionId: string): InlineCheckState {
  if (state.pickedId !== null) return state
  return { pickedId: optionId, revealed: true, skipped: false }
}

/**
 * "Show me anyway": reveal the content below without answering. A no-op once
 * revealed (by either route) — same `===` contract as `pickOption`.
 */
export function skipCheck(state: InlineCheckState): InlineCheckState {
  if (state.revealed) return state
  return { pickedId: null, revealed: true, skipped: true }
}

/** null before any pick; otherwise whether the locked-in pick was right. */
export function isCorrectPick(
  block: InlineCheckBlock,
  state: InlineCheckState,
): boolean | null {
  if (state.pickedId === null) return null
  return state.pickedId === block.correctId
}

/** The little uppercase label the card wears. Framing defaults to 'predict'. */
export function framingLabel(block: InlineCheckBlock): 'Predict' | 'Recall' {
  return (block.framing ?? 'predict') === 'predict' ? 'Predict' : 'Recall'
}

/**
 * The blocks to render right now: everything up to AND INCLUDING the first
 * inline-check whose id is not in `revealedIds`. The check itself always
 * renders — the question is the screen — and everything after it waits until
 * the learner answers or skips. With no unrevealed checks, the whole list.
 */
export function gateBlocks(
  blocks: LessonBlock[],
  revealedIds: ReadonlySet<string>,
): LessonBlock[] {
  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i]
    if (block.kind === 'inline-check' && !revealedIds.has(block.id)) {
      return blocks.slice(0, i + 1)
    }
  }
  return blocks
}
