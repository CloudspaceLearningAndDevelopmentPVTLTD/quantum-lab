'use client'

import { useMemo, useState } from 'react'
import type { QuizQuestion } from '@/lib/lessons/types'
import { track } from '@/lib/analytics/track'

interface QuizProps {
  questions: QuizQuestion[]
  onScore?: (score: number) => void
}

/** Map of question id → the option id the learner picked (locked once set). */
type AnswerMap = Record<string, string>

export function Quiz({ questions, onScore }: QuizProps) {
  const [answers, setAnswers] = useState<AnswerMap>({})
  const [reported, setReported] = useState(false)

  const total = questions.length
  const answeredCount = Object.keys(answers).length
  const correctCount = useMemo(
    () =>
      questions.filter((q) => answers[q.id] !== undefined && answers[q.id] === q.correctId)
        .length,
    [questions, answers],
  )
  const allAnswered = total > 0 && answeredCount === total

  function pick(question: QuizQuestion, optionId: string) {
    if (answers[question.id] !== undefined) return // locked
    const next: AnswerMap = { ...answers, [question.id]: optionId }
    setAnswers(next)

    // One event per question locked in. The only identifier this component is
    // given is the question id — no prompt text, no chosen option text.
    track('quiz.answered', {
      questionId: question.id,
      correct: optionId === question.correctId,
    })

    if (Object.keys(next).length === total && !reported) {
      const score = questions.filter((q) => next[q.id] === q.correctId).length
      setReported(true)
      onScore?.(score)
    }
  }

  function reset() {
    setAnswers({})
    setReported(false)
  }

  return (
    <section className="card p-5" aria-label="Check your understanding">
      <div className="flex items-baseline justify-between gap-4">
        <h3 className="text-sm font-bold text-ink">Check your understanding</h3>
        <span className="text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-muted">
          {answeredCount} / {total} answered
        </span>
      </div>

      <ol className="mt-5 space-y-7">
        {questions.map((question, qIndex) => {
          const picked = answers[question.id]
          const locked = picked !== undefined

          return (
            <li key={question.id}>
              <p className="text-[15px] font-semibold leading-relaxed text-ink">
                <span className="mr-2 text-ink-muted">{qIndex + 1}.</span>
                {question.prompt}
              </p>

              <div className="mt-3 space-y-2">
                {question.options.map((option) => {
                  const isPicked = picked === option.id
                  const isCorrect = option.id === question.correctId
                  // Once locked, always reveal the correct option in teal so a
                  // wrong pick still teaches the right answer.
                  const showCorrect = locked && isCorrect
                  const showWrong = locked && isPicked && !isCorrect

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
                      onClick={() => pick(question, option.id)}
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
                  <span className="mr-2 text-[11px] font-bold uppercase tracking-[0.09em] text-q-violet">
                    Why
                  </span>
                  {question.explanation}
                </p>
              ) : null}
            </li>
          )
        })}
      </ol>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <p className="text-sm text-ink-secondary">
          {allAnswered ? (
            <span className={correctCount === total ? 'text-q-teal-text' : 'text-q-amber-text'}>
              <strong className="font-bold">
                {correctCount} of {total}
              </strong>{' '}
              —{' '}
              {correctCount === total
                ? 'nicely done'
                : correctCount === 0
                  ? 'worth re-reading the section above'
                  : correctCount >= total - 1
                    ? 'close — read the explanation on the one you missed'
                    : 'worth re-reading the section above'}
            </span>
          ) : (
            <span className="text-ink-muted">
              Pick an answer to lock it in and see the explanation.
            </span>
          )}
        </p>
        <button
          type="button"
          onClick={reset}
          disabled={answeredCount === 0}
          className="btn-ghost focus-ring"
        >
          Try again
        </button>
      </div>
    </section>
  )
}
