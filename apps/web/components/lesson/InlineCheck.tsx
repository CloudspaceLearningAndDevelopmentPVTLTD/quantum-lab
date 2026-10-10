'use client'

/**
 * InlineCheck — the question-first card that fronts a lesson section
 * (Brilliant's pattern: predict, then read).
 *
 * A thin view over lib/lessons/inlineCheck.ts, for the same reason
 * DeeperExplain is thin over lib/deeperExplain.ts: the state machine and the
 * gating rule are pure functions in lib/ where the Node-environment vitest
 * run can reach them, and this file only maps state to markup.
 *
 * The card never blocks anything. Answering reveals the section below and
 * shows feedback + the explanation; "Show me anyway" reveals it without
 * answering (and the question stays answerable afterwards, so a skipper can
 * still commit and get feedback). `onReveal` fires exactly once, on the
 * not-revealed → revealed transition, whichever route caused it — LessonShell
 * uses it to un-gate the blocks below. No analytics and no progress writes
 * here on purpose; lib/lessons/inlineCheck.ts's header says why.
 */

import { useState } from 'react'
import type { InlineCheckBlock } from '@/lib/lessons/types'
import {
  INITIAL_CHECK_STATE,
  framingLabel,
  isCorrectPick,
  pickOption,
  skipCheck,
  type InlineCheckState,
} from '@/lib/lessons/inlineCheck'

interface InlineCheckProps {
  block: InlineCheckBlock
  /** Fired once, when the check first reveals the content below it. */
  onReveal: () => void
}

export function InlineCheck({ block, onReveal }: InlineCheckProps) {
  const [state, setState] = useState<InlineCheckState>(INITIAL_CHECK_STATE)

  /** Apply a transition; the lib functions return `===` state for no-ops. */
  function transition(next: InlineCheckState) {
    if (next === state) return
    setState(next)
    if (!state.revealed && next.revealed) onReveal()
  }

  const picked = state.pickedId
  const locked = picked !== null
  const correct = isCorrectPick(block, state)

  return (
    <section
      className="card border-q-violet/40 p-5"
      aria-label={`${framingLabel(block)} before reading on`}
    >
      <p className="text-[11px] font-bold uppercase tracking-[0.09em] text-q-violet">
        {framingLabel(block)} before you read on
      </p>
      <p className="mt-2 text-[15px] font-semibold leading-relaxed text-ink">
        {block.question}
      </p>

      <div className="mt-3 space-y-2">
        {block.options.map((option) => {
          const isPicked = picked === option.id
          const isCorrectOption = option.id === block.correctId
          // Same reveal convention as Quiz: once locked, the correct option is
          // always shown in teal so a wrong pick still teaches the answer.
          const showCorrect = locked && isCorrectOption
          const showWrong = locked && isPicked && !isCorrectOption

          const tone = showCorrect
            ? 'border-q-teal/60 bg-q-teal/10 text-q-teal-text'
            : showWrong
              ? 'border-q-rose/60 bg-q-rose/10 text-q-rose-text'
              : locked
                ? 'border-line bg-surface-2 text-ink-muted'
                : 'border-line bg-surface-2 text-ink-secondary hover:border-line-strong hover:text-ink'

          return (
            <button
              key={option.id}
              type="button"
              onClick={() => transition(pickOption(state, option.id))}
              disabled={locked}
              aria-pressed={isPicked}
              className={`focus-ring flex w-full items-start gap-3 rounded-lg border px-3.5 py-2.5 text-left text-sm transition-colors duration-150 disabled:cursor-default ${tone}`}
            >
              <span aria-hidden="true" className="mt-px w-3.5 shrink-0 font-bold">
                {showCorrect ? '✓' : showWrong ? '✗' : ''}
              </span>
              <span>{option.text}</span>
            </button>
          )
        })}
      </div>

      {locked ? (
        <p className="mt-3 rounded-lg border border-line bg-surface-2 px-3.5 py-3 text-[13px] leading-relaxed text-ink-secondary">
          <span
            className={`mr-2 text-[11px] font-bold uppercase tracking-[0.09em] ${
              correct ? 'text-q-teal-text' : 'text-q-rose-text'
            }`}
          >
            {correct ? 'Right' : 'Not quite'}
          </span>
          {block.explanation}
        </p>
      ) : null}

      {!state.revealed ? (
        <div className="mt-4 flex items-center justify-between gap-3 border-t border-line pt-3">
          <p className="text-[13px] text-ink-muted">
            Commit to an answer — the next section is the payoff.
          </p>
          <button
            type="button"
            onClick={() => transition(skipCheck(state))}
            className="btn-ghost focus-ring shrink-0"
          >
            Show me anyway
          </button>
        </div>
      ) : state.skipped && !locked ? (
        <p className="mt-3 text-[13px] text-ink-muted">
          Skipped — the section below has the answer, and the question stays
          open if you want to commit first.
        </p>
      ) : null}
    </section>
  )
}
