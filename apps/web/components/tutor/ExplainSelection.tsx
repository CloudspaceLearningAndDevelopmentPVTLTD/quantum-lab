'use client'

/**
 * ExplainSelection — highlight any phrase in a lesson, get it explained by the
 * model already running on the learner's own device.
 *
 * WHY THIS IS AFFORDABLE HERE AND NOWHERE ELSE
 * --------------------------------------------
 * Selecting text is a reflex; a reader does it to keep their place. An
 * affordance on every selection therefore fires dozens of times per lesson.
 * Against a hosted tier that is dozens of billed calls and dozens of
 * messagesPerDay decrements for one lesson — which is why this pattern is
 * normally shipped as a paid feature or not at all. On-device inference costs
 * nothing per call and the phrase never leaves the machine, so here the reflex
 * is free to become a feature.
 *
 * WHAT HAPPENS WHEN THE MODEL IS NOT LOADED
 * -----------------------------------------
 * `currentDeviceEngine()` is consulted on every selection and NEVER
 * `createDeviceEngine`, directly or by implication: starting an unrequested
 * 376 MB-2.2 GB transfer is the single thing lib/llm/webllm.ts exists to
 * prevent. With no engine loaded there is nothing to press, so the button is
 * withheld — but the learner is told once, on their first real selection in the
 * lesson, that /tutor is what turns this on. Once, not every time: a reader
 * selects text dozens of times per lesson to keep their place, and repeating
 * the sentence on each of those turns a reading reflex into a recurring advert
 * for a multi-gigabyte download they have already declined by not going to
 * /tutor. The engine is a module singleton that survives navigation, so a
 * learner who switches it on at /tutor finds this working on the next lesson
 * they open, with no reload. The pointer also stands in for the answer in one
 * race: the engine was released between the selection and the press.
 *
 * PAYWALL: this reads only text the server already rendered into this page. It
 * cannot reach a withheld block, because a withheld block is not in the DOM.
 */

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { currentDeviceEngine, streamDeviceReply } from '@/lib/llm/webllm'

/** Below this, a "selection" is a stray click-drag, not a phrase. */
const MIN_SELECTION = 3
/**
 * Context handed to the model. A 1B model given much more than this starts
 * summarising the passage instead of explaining the phrase inside it.
 */
const MAX_CONTEXT = 600
/** How much of the phrase goes in the button's accessible name. */
const MAX_LABEL = 48

interface Target {
  /**
   * 'ready' — an engine is loaded and the phrase can be explained.
   * 'pointer' — no engine, so this selection gets the one-time sentence naming
   * /tutor instead of a button that could only apologise when pressed.
   */
  mode: 'ready' | 'pointer'
  /** The phrase, whitespace-collapsed. */
  text: string
  /** The prose around it, so the model explains it AS USED, not in the abstract. */
  context: string
  /**
   * Offsets inside the lesson-body wrapper. Absolute-within-the-wrapper rather
   * than fixed-to-viewport, so the affordance scrolls with the sentence it
   * points at instead of drifting off it.
   */
  top: number
  left: number
}

type AnswerStatus = 'streaming' | 'done' | 'error' | 'no-engine'

interface Answer {
  status: AnswerStatus
  text: string
}

export interface ExplainSelectionProps {
  /** Named in the prompt, so "measurement" is read as this lesson's meaning. */
  lessonTitle: string
  /**
   * The lesson body. Selections OUTSIDE this subtree are ignored — that is what
   * keeps the sidebar nav and the prev/next cards from arming the button.
   */
  children: ReactNode
}

/**
 * The passage the phrase sits in.
 *
 * Climbs to the nearest block element rather than trusting the range's own
 * container: a selection inside a <p> has that <p> as its container, but a
 * selection that lands entirely inside an <em> has the <em>, whose text is the
 * phrase itself — i.e. no context at all, which is the failure this feature is
 * supposed to avoid.
 */
function passageAround(range: Range, selected: string): string {
  const node = range.commonAncestorContainer
  const host = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
  const block = host?.closest('p, li, h1, h2, h3, figcaption, pre, blockquote') ?? host
  const full = (block?.textContent ?? selected).replace(/\s+/g, ' ').trim()
  if (full.length <= MAX_CONTEXT) return full

  // Long block: keep a window CENTRED on the phrase. Taking the head of the
  // block instead would hand the model context that does not contain it.
  const at = full.indexOf(selected)
  if (at < 0) return full.slice(0, MAX_CONTEXT)
  const pad = Math.max(0, Math.floor((MAX_CONTEXT - selected.length) / 2))
  const start = Math.max(0, at - pad)
  const end = Math.min(full.length, at + selected.length + pad)
  return `${start > 0 ? '…' : ''}${full.slice(start, end)}${end < full.length ? '…' : ''}`
}

function buildPrompt(lessonTitle: string, target: Target): string {
  return [
    `Lesson: ${lessonTitle}`,
    `Passage: "${target.context}"`,
    `Explain the phrase "${target.text}" as it is used in that passage, in 2-4 short sentences. Do not quote the passage back.`,
  ].join('\n\n')
}

export function ExplainSelection({ lessonTitle, children }: ExplainSelectionProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  /** The live Range, kept only to re-measure after a resize reflows the column. */
  const rangeRef = useRef<Range | null>(null)
  /**
   * Read by the debounced selection handler, which must see the current answer
   * without re-subscribing to `selectionchange` on every streamed token.
   */
  const answerRef = useRef<Answer | null>(null)
  /**
   * Bumped on close and on each new ask. A stream whose id has gone stale stops
   * writing state, so a dismissed panel cannot resurrect itself mid-token.
   */
  const runIdRef = useRef(0)
  /**
   * Has the "turn it on at /tutor" sentence been shown in THIS lesson yet? A ref
   * rather than state because showing it must not itself re-render, and because
   * the debounced selection handler below reads it without wanting to re-bind
   * `selectionchange` when it flips.
   */
  const pointerShownRef = useRef(false)

  const [target, setTarget] = useState<Target | null>(null)
  const [answer, setAnswer] = useState<Answer | null>(null)
  const open = answer !== null

  useEffect(() => {
    answerRef.current = answer
  }, [answer])

  // Next lesson, first selection again. Navigating between lessons reuses this
  // component instance (only TrackedPage is keyed by slug), so without this the
  // pointer would be shown once per SESSION rather than once per lesson, and a
  // learner who arrived mid-course would never see it at all.
  useEffect(() => {
    pointerShownRef.current = false
  }, [lessonTitle])

  const measure = useCallback((range: Range): { top: number; left: number } | null => {
    const root = rootRef.current
    if (!root) return null
    const rect = range.getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) return null
    const rootRect = root.getBoundingClientRect()
    return {
      // BELOW the last line of the selection, never over it. At 390px the
      // column IS the viewport, so anything centred on the selection covers the
      // very phrase the learner asked about.
      top: rect.bottom - rootRect.top + 8,
      // Clamped, or a phrase at the right edge pushes the button past the
      // column and gives a narrow screen a horizontal scrollbar.
      left: Math.max(0, Math.min(rect.left - rootRect.left, Math.max(0, root.clientWidth - 150))),
    }
  }, [])

  const close = useCallback(() => {
    runIdRef.current += 1
    // Stop the GPU generating an answer nobody will read. Safe to aim at the
    // shared engine: it runs one generation at a time, and the only one in
    // flight on a lesson page is the one being dismissed.
    if (answerRef.current?.status === 'streaming') {
      currentDeviceEngine()?.engine.interruptGenerate?.()
    }
    setAnswer(null)
    setTarget(null)
    rangeRef.current = null
    // Focus must not die on the node we just unmounted — that drops a keyboard
    // user back at the top of the document. The lesson body is programmatically
    // focusable, so focus lands back on the text they were reading.
    rootRef.current?.focus()
  }, [])

  // Selection watching. `selectionchange`, not `mouseup`, because it is the
  // only event that also fires for shift+arrow selection — i.e. for exactly the
  // users a floating affordance most easily leaves behind. Debounced because it
  // fires on every pixel of a drag, and a button that chases the cursor while
  // you are still choosing the phrase is worse than no button.
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    let timer: number | undefined

    const evaluate = () => {
      // Never move the affordance out from under an open panel.
      if (answerRef.current) return

      const selection = document.getSelection()
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
        setTarget(null)
        return
      }
      const range = selection.getRangeAt(0)
      // Scoped to the lesson body: a selection in the sidebar, the header or
      // the prev/next cards is not a phrase in the lesson.
      if (!root.contains(range.commonAncestorContainer)) {
        setTarget(null)
        return
      }
      // A selection inside our own panel is the learner copying the answer.
      if (overlayRef.current?.contains(range.commonAncestorContainer)) return

      const text = selection.toString().replace(/\s+/g, ' ').trim()
      if (text.length < MIN_SELECTION) {
        setTarget(null)
        return
      }
      // The gate that makes an unrequested 376 MB-2.2 GB download impossible:
      // nothing here loads an engine, it only asks whether one is already
      // running. Re-checked per selection, so switching the tutor on at /tutor
      // arms the button on the next lesson without a reload.
      const ready = currentDeviceEngine() !== null
      if (!ready && pointerShownRef.current) {
        setTarget(null)
        return
      }
      const at = measure(range)
      if (!at) {
        setTarget(null)
        return
      }
      if (!ready) pointerShownRef.current = true
      rangeRef.current = range
      setTarget({
        mode: ready ? 'ready' : 'pointer',
        text,
        context: passageAround(range, text),
        ...at,
      })
    }

    const onSelectionChange = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(evaluate, 150)
    }

    document.addEventListener('selectionchange', onSelectionChange)
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange)
      window.clearTimeout(timer)
    }
  }, [measure])

  // A resize reflows the column, which moves the text but not the offsets we
  // measured against it. Re-measure rather than dismiss: dismissing would kill
  // a half-streamed answer because a phone's URL bar collapsed.
  useEffect(() => {
    if (!target) return
    const onResize = () => {
      const range = rangeRef.current
      if (!range) return
      const at = measure(range)
      if (at) setTarget((prev) => (prev ? { ...prev, ...at } : prev))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [target, measure])

  // Escape closes, from anywhere — bound to the document rather than the panel,
  // because focus is deliberately NOT trapped and the learner may have tabbed
  // back into the lesson while the answer streamed.
  useEffect(() => {
    if (!target && !open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [target, open, close])

  // Focus moves into the panel once, on open, so a screen-reader user is
  // standing on the result and its close control instead of being told a region
  // appeared somewhere behind them. One move, no loop: Tab leaves normally.
  useEffect(() => {
    if (open) closeRef.current?.focus()
  }, [open])

  const explain = useCallback(async () => {
    const current = target
    if (!current || current.mode !== 'ready') return
    const live = currentDeviceEngine()
    if (!live) {
      // Released between the selection and the press (the learner pressed
      // "switch off" in the tutor panel). Say what would fix it; do not fix it
      // here by starting a download.
      setAnswer({ status: 'no-engine', text: '' })
      return
    }

    const runId = ++runIdRef.current
    setAnswer({ status: 'streaming', text: '' })
    try {
      await streamDeviceReply(
        live.engine,
        [{ role: 'user', content: buildPrompt(lessonTitle, current) }],
        (full) => {
          if (runIdRef.current !== runId) return
          setAnswer({ status: 'streaming', text: full })
        },
      )
      if (runIdRef.current !== runId) return
      setAnswer((prev) => (prev ? { status: 'done', text: prev.text } : prev))
    } catch {
      if (runIdRef.current !== runId) return
      setAnswer({ status: 'error', text: '' })
    }
  }, [lessonTitle, target])

  const label = target
    ? target.text.length > MAX_LABEL
      ? `${target.text.slice(0, MAX_LABEL)}…`
      : target.text
    : ''

  return (
    <div ref={rootRef} tabIndex={-1} className="relative outline-none">
      {children}

      {/*
        Always mounted, so it is a live region BEFORE its text changes — a
        status element created in the same commit as its first content is
        routinely missed by screen readers. It exists because a selection-
        triggered affordance is, by construction, a thing sighted users see and
        nobody else is told about.
      */}
      <div role="status" aria-live="polite" className="sr-only">
        {target && !open
          ? target.mode === 'ready'
            ? `Explain button available for the phrase “${label}”.`
            : 'Turning on the on-device tutor at /tutor explains selected text here.'
          : ''}
      </div>

      {/*
        No engine, first selection of the lesson: say what would enable this,
        once. Static content, deliberately NOT its own live region — the sr-only
        status above already carries this sentence, and a second announcement of
        the same words is how a helpful note becomes a nuisance. The link stays
        in the tab order, so it is reachable either way.
      */}
      {target?.mode === 'pointer' ? (
        <p
          className="absolute inset-x-0 z-20 rounded-lg border border-dashed border-line-strong bg-surface-2 px-3 py-2 text-[12px] leading-relaxed text-ink-secondary"
          style={{ top: `${target.top}px` }}
        >
          Turning on the on-device tutor at{' '}
          <Link
            href="/tutor"
            className="focus-ring rounded font-semibold text-q-violet-text underline underline-offset-2 hover:text-ink"
          >
            /tutor
          </Link>{' '}
          lets you select any phrase here and have it explained on your own machine.
        </p>
      ) : null}

      {target?.mode === 'ready' && !open ? (
        <div
          ref={overlayRef}
          className="absolute z-20"
          style={{ top: `${target.top}px`, left: `${target.left}px` }}
        >
          {/*
            A real <button>, not a styled div: it has to be reachable by Tab
            (browsers put the sequential focus starting point at the selection,
            so Tab from the highlighted phrase walks forward onto it) and
            operable by Enter and Space for free.

            preventDefault on mousedown is load-bearing, not a flourish:
            mousedown outside the selection collapses it, the collapse fires
            selectionchange, and the button unmounts BEFORE its own click lands.
            Without this line the affordance does not work with a mouse at all.
          */}
          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => void explain()}
            className="focus-ring rounded-lg border border-q-violet/40 bg-surface-2 px-2.5 py-1 text-[12px] font-semibold text-q-violet-text shadow-sm hover:bg-q-violet/10"
          >
            Explain
            <span className="sr-only"> “{label}”</span>
          </button>
        </div>
      ) : null}

      {target && answer ? (
        // inset-x-0, not a width anchored to the phrase: at 390px a popover
        // narrow enough to sit beside the selection is too narrow to read four
        // sentences in, and a wide one hanging off the right edge scrolls the
        // page sideways. Full column width, below the phrase, covers nothing it
        // is talking about.
        // role="dialog", not a bare labelled <div>: aria-label is PROHIBITED on
        // an element whose implicit role is generic, and axe fails that
        // (aria-prohibited-attr) — the panel would ship with no accessible name
        // at all. dialog is also the honest description: it takes focus on open
        // and Escape closes it. Non-modal on purpose, so focus is not trapped.
        <div
          ref={overlayRef}
          role="dialog"
          aria-label={`Explanation of “${label}”`}
          className="card absolute inset-x-0 z-20 bg-surface-2 p-4"
          style={{ top: `${target.top}px` }}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.09em] text-q-violet-text">
                Explained on this device
              </p>
              <p className="mt-1 text-[13px] text-ink-muted">&ldquo;{label}&rdquo;</p>
            </div>
            <button
              ref={closeRef}
              type="button"
              onClick={close}
              aria-label="Close explanation"
              className="focus-ring shrink-0 rounded px-1 leading-none text-ink-muted hover:text-ink"
            >
              ✕
            </button>
          </div>

          {/*
            aria-busy while tokens arrive. Without it a polite live region
            re-announces the whole answer on every one of the ~15 updates a
            second a local model produces, which is unusable; with it the region
            is announced once, when it settles.
          */}
          <div
            aria-live="polite"
            aria-busy={answer.status === 'streaming'}
            className="mt-3 text-[14px] leading-relaxed text-ink-secondary"
          >
            {answer.status === 'no-engine' ? (
              <p>
                Turn on the on-device tutor at{' '}
                <Link
                  href="/tutor"
                  className="focus-ring rounded text-q-violet-text underline decoration-q-violet/40 underline-offset-2 hover:decoration-q-violet"
                >
                  /tutor
                </Link>{' '}
                to explain selected text here.
              </p>
            ) : answer.status === 'error' ? (
              <p className="text-q-rose-text">
                The on-device model stopped before it finished. Try a shorter phrase.
              </p>
            ) : answer.text ? (
              <p className="whitespace-pre-wrap">{answer.text}</p>
            ) : answer.status === 'streaming' ? (
              <p className="flex items-center gap-2 text-ink-muted">
                <span
                  aria-hidden="true"
                  className="h-1.5 w-1.5 animate-pulse rounded-full bg-q-violet-text"
                />
                Reading the passage&hellip;
              </p>
            ) : (
              // Finished having emitted nothing — a 360M model does this on a
              // phrase it cannot place. Without this branch that state renders
              // as the pulsing "Reading the passage…" forever, while aria-busy
              // has already gone false, so a screen reader is handed a settled
              // region that claims to still be working.
              <p className="text-q-rose-text">
                The on-device model had nothing to say about that phrase. Try selecting a
                whole term.
              </p>
            )}
          </div>

          <p className="mt-3 text-[11px] text-ink-muted">
            Answered by the model on your device — the phrase never left it.
          </p>
        </div>
      ) : null}
    </div>
  )
}
