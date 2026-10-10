'use client'

/**
 * DevicePractice — unlimited extra recall questions, written on this machine.
 *
 * The review queue is finite: it can only ever hold the questions the course
 * ships. A learner who wants one more rep on entanglement has nothing left to
 * draw on. The on-device model changes the economics of that completely — a
 * generated question costs no API call, no key, no message quota and no
 * network, which is the only way this could be offered to an anonymous visitor
 * at all, and the only way it still works when the service worker is serving
 * the app offline.
 *
 * WHAT THIS IS NOT
 * ----------------
 * These are NOT curated cards. A 360M-2.2B model will, sooner or later, ask a
 * question with a wrong premise or give an answer that is subtly false. So the
 * caveat here is permanent rather than a dismissible first-run notice, it sits
 * above the generated text rather than under it, and the generated block is
 * drawn in a different frame from the real cards (dashed, badged, tinted
 * label) so the two cannot be confused at a glance. Nothing generated here is
 * written to the spaced-repetition schedule: grading a machine-made question
 * would let a hallucination move real course material's due date.
 *
 * NEVER loads a model. `currentDeviceEngine()` reports what is already running
 * and returns null otherwise; calling `createDeviceEngine()` from here would
 * start an unrequested 376 MB-2.2 GB download from a page the learner opened
 * to review flashcards. With nothing loaded this renders a one-line pointer at
 * /tutor, where that download is an explicit, sized, opt-in press.
 */

import Link from 'next/link'
import { useCallback, useEffect, useId, useRef, useState } from 'react'

import { currentDeviceEngine, streamDeviceReply, type DeviceEngine } from '@/lib/llm/webllm'

interface Generated {
  question: string
  answer: string
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'generating' }
  | { kind: 'ready'; item: Generated }
  /** The model replied, but not in a shape that splits into question + answer. */
  | { kind: 'unusable' }
  | { kind: 'failed'; message: string }

/**
 * Pull QUESTION:/ANSWER: out of whatever the model actually said.
 *
 * JSON is the obvious ask and the wrong one: a small quantised model emits
 * unbalanced braces, prose after the closing brace, or a fenced block with a
 * comment in it, and `JSON.parse` then throws on output a human would have read
 * fine. Two labelled lines degrade far better — and this still assumes nothing,
 * because the model may bold the labels, open with "Sure!", or carry straight
 * on with a second question. Returns null when both parts are not there, which
 * the caller reports as "that one did not come out usable" rather than
 * rendering half a card.
 */
export function parseQuestionAnswer(raw: string): Generated | null {
  const text = raw.replace(/\*\*/g, '').replace(/\r/g, '')
  const questionMatch =
    /(?:^|\n)[^\S\n]*QUESTION[^\S\n]*:([\s\S]*?)(?=\n[^\S\n]*ANSWER[^\S\n]*:|$)/i.exec(text)
  const answerMatch = /(?:^|\n)[^\S\n]*ANSWER[^\S\n]*:([\s\S]*)/i.exec(text)
  if (!questionMatch || !answerMatch) return null

  // A small model that has finished one pair often starts another instead of
  // stopping, so everything from a second QUESTION: onwards is dropped.
  const tidy = (s: string): string =>
    s
      .split(/\n[^\S\n]*QUESTION[^\S\n]*:/i)[0]!
      .trim()
      .replace(/^["'“”]+|["'“”]+$/g, '')
      .trim()

  const question = tidy(questionMatch[1] ?? '')
  const answer = tidy(answerMatch[1] ?? '')
  if (!question || !answer) return null
  return { question, answer }
}

/**
 * The instruction, given as a completed example rather than as a rule.
 *
 * `streamDeviceReply` prepends the shared tutor system prompt, which tells the
 * model to answer in 2-4 sentences of plain prose — directly at odds with the
 * rigid two-line format needed here. A model this size resolves that conflict
 * by following the system prompt and ignoring us. One worked exchange in the
 * exact shape wanted is what actually pins the format; the closing turn then
 * has to say not to copy the example, because otherwise it frequently returns
 * the sample question verbatim.
 */
function buildHistory(
  topic: string,
  avoid: string | null,
): { role: 'user' | 'assistant'; content: string }[] {
  return [
    {
      role: 'user',
      content:
        'Write one short recall question about "Superposition" for a beginner, with its answer. ' +
        'Reply with exactly two lines in this format and nothing else:\n' +
        'QUESTION: <one sentence>\nANSWER: <one or two sentences>',
    },
    {
      role: 'assistant',
      content:
        'QUESTION: What does it mean for a qubit to be in superposition?\n' +
        'ANSWER: It holds a combination of the 0 and 1 states at once, and measuring it returns ' +
        'just one of them, with a probability set by that combination.',
    },
    {
      role: 'user',
      content:
        `Now do the same for "${topic}". Use the same two-line format. Do not repeat the example question.` +
        (avoid === null ? '' : ` Ask about a different point than: "${avoid}"`),
    },
  ]
}

export default function DevicePractice({ topic, className }: { topic: string; className?: string }) {
  const [engine, setEngine] = useState<DeviceEngine | null>(null)
  const [checked, setChecked] = useState(false)
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const [revealed, setRevealed] = useState(false)
  const lastQuestion = useRef<string | null>(null)
  const alive = useRef(true)
  /**
   * Which generation the UI is currently willing to accept.
   *
   * This component does NOT unmount between cards — ReviewSession keeps it in
   * the same position and only changes `topic` — so `alive` cannot catch the
   * case that matters: a generation started on card 3 resolving after the
   * learner has moved to card 4. Without this counter that answer is rendered
   * under the new card's heading, which is precisely the silent mislabelling
   * the topic reset below exists to prevent. Bumped on every new request and on
   * every topic change; a resolution whose ticket no longer matches is dropped.
   */
  const requestId = useRef(0)
  const headingId = useId()
  const answerId = useId()

  // Asked for AFTER mount: the server render has no module-scope engine, so
  // reading it during render hands the server "no tutor" and the client "tutor
  // ready" for the same markup — a hydration mismatch for exactly the learners
  // who have the model loaded.
  useEffect(() => {
    setEngine(currentDeviceEngine()?.engine ?? null)
    setChecked(true)
  }, [])

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  // A new card means a new topic, and a question generated for the previous one
  // would silently be relabelled as practice for this one.
  useEffect(() => {
    requestId.current += 1
    setPhase({ kind: 'idle' })
    setRevealed(false)
    lastQuestion.current = null
  }, [topic])

  const generate = useCallback(async () => {
    // Re-read rather than trusting the mount-time snapshot: the learner may
    // have switched the tutor off since. Still only ever reads; never loads.
    const live = currentDeviceEngine()
    if (!live) {
      setEngine(null)
      return
    }
    setEngine(live.engine)
    setRevealed(false)
    setPhase({ kind: 'generating' })
    const ticket = (requestId.current += 1)
    try {
      /*
       * Tokens are collected, not displayed.
       *
       * Everywhere else in this app streaming is the point — it turns a slow
       * local model's silence into visible thinking. Here it would destroy the
       * feature: ANSWER: arrives on the same stream as QUESTION:, so a learner
       * watching it type has read the answer before they can attempt recall.
       * The wait is covered by the live-region status line instead.
       */
      const raw = await streamDeviceReply(
        live.engine,
        buildHistory(topic, lastQuestion.current),
        () => {},
      )
      if (!alive.current || requestId.current !== ticket) return
      const item = parseQuestionAnswer(raw)
      if (item === null) {
        setPhase({ kind: 'unusable' })
        return
      }
      lastQuestion.current = item.question
      setPhase({ kind: 'ready', item })
    } catch (err) {
      if (!alive.current || requestId.current !== ticket) return
      setPhase({
        kind: 'failed',
        message:
          err instanceof Error && err.message
            ? err.message.slice(0, 160)
            : 'The on-device model stopped before it finished.',
      })
    }
  }, [topic])

  // Nothing at all until the engine question is settled — see the hydration
  // note above.
  if (!checked) return null

  const frame = `rounded-card border border-dashed border-line-strong bg-surface-2 p-4 ${className ?? ''}`

  if (engine === null) {
    return (
      <section className={frame} aria-labelledby={headingId}>
        <h2 id={headingId} className="text-[13px] font-bold text-ink">
          Extra practice, generated on your device
        </h2>
        <p className="mt-1 max-w-prose text-[12px] leading-relaxed text-ink-secondary">
          Turning on the on-device tutor at{' '}
          <Link
            href="/tutor"
            className="focus-ring rounded font-semibold text-q-violet-text underline underline-offset-2 hover:text-ink"
          >
            /tutor
          </Link>{' '}
          lets this page write unlimited free practice questions here, offline.
        </p>
      </section>
    )
  }

  const busy = phase.kind === 'generating'

  return (
    <section className={frame} aria-labelledby={headingId}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id={headingId} className="text-[13px] font-bold text-ink">
          Extra practice, generated on your device
        </h2>
        {/* The badge repeats what the paragraph below says, because the
            paragraph gets read once and the badge is seen every time. */}
        <span className="rounded-full border border-q-amber/40 bg-q-amber/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.09em] text-q-amber-text">
          Machine-written
        </span>
      </div>

      {/* PERMANENT: not dismissible, not folded into a disclosure, and never
          positioned below the question it qualifies. */}
      <p className="mt-1 max-w-prose text-[12px] leading-relaxed text-ink-secondary">
        Written by the small model running on this machine — free, private and offline, but checked
        by nobody. These are practice prompts rather than course content and they can be wrong; the
        card above is the verified one.
      </p>

      <div aria-live="polite" className="mt-3 empty:mt-0">
        {busy ? (
          <p className="text-[12px] text-ink-muted">
            Writing a question about {topic} on this device…
          </p>
        ) : null}

        {phase.kind === 'ready' ? (
          <div className="rounded-lg border border-line bg-surface px-3.5 py-3">
            <p className="text-[14px] font-semibold leading-relaxed text-ink">
              {phase.item.question}
            </p>
            {/* Rendered whether or not it is revealed, and hidden with the
                `hidden` attribute rather than by being absent: the reveal
                button's aria-controls has to point at an element that actually
                exists, or axe flags the reference as broken. `hidden` keeps it
                out of the accessibility tree until it is wanted. */}
            <p
              id={answerId}
              hidden={!revealed}
              className="mt-3 border-t border-line pt-3 text-[13px] leading-relaxed text-ink-secondary"
            >
              <span className="mr-2 text-[11px] font-bold uppercase tracking-[0.09em] text-q-amber-text">
                Suggested answer
              </span>
              {phase.item.answer}
            </p>
          </div>
        ) : null}

        {phase.kind === 'unusable' ? (
          <p className="max-w-prose text-[12px] leading-relaxed text-ink-secondary">
            That came back in a shape this page could not read — small models do that. Generating
            again usually fixes it.
          </p>
        ) : null}

        {phase.kind === 'failed' ? (
          <p className="max-w-prose text-[12px] leading-relaxed text-q-rose-text">
            {phase.message} Your review cards are unaffected.
          </p>
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {/* Revealing is a press, never a hover or an auto-expand: the few
            seconds of retrieval before the answer appears are the entire
            exercise. */}
        {phase.kind === 'ready' ? (
          <button
            type="button"
            onClick={() => setRevealed((r) => !r)}
            aria-expanded={revealed}
            aria-controls={answerId}
            className="focus-ring rounded-lg border border-line bg-surface px-3.5 py-2 text-[13px] font-semibold text-ink hover:border-line-strong"
          >
            {revealed ? 'Hide the answer' : 'Show the answer'}
          </button>
        ) : null}

        <button
          type="button"
          onClick={() => void generate()}
          disabled={busy}
          // The busy state changes the label and the surface, never the
          // opacity: opacity on a control that still carries words drops it
          // under 4.5:1, which the axe suite fails — it has caught exactly this
          // twice already.
          className={`focus-ring rounded-lg border px-3.5 py-2 text-[13px] font-semibold disabled:cursor-default ${
            busy
              ? 'border-line bg-surface-3 text-ink-muted'
              : 'border-line bg-surface text-ink hover:border-line-strong'
          }`}
        >
          {busy
            ? 'Generating…'
            : phase.kind === 'ready'
              ? 'Generate another'
              : 'Generate a practice question'}
        </button>
      </div>
    </section>
  )
}
