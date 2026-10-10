'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { prefersReducedMotion } from '@/components/viz/frameLoop'

/**
 * VizDescription — the running commentary for a visualization.
 *
 * A canvas is an opaque bitmap to a screen reader, so the best any of the 84
 * components in this directory manages is a fixed aria-label naming the picture
 * in general ("a Bloch sphere"). The learner never finds out what the sphere is
 * DOING, which is the entire content of the page. This renders the numbers that
 * matter as sentences, and re-announces them as they change.
 *
 * Two deliberate choices:
 *
 * 1. The caller supplies the facts. There is no reading pixels back off a
 *    canvas — every page already computes these quantities to feed its <Stat>
 *    tiles (P(0), Bloch z, purity, Larmor frequency), so the same values are
 *    passed straight in. A description derived from a different source than the
 *    picture is a description that silently goes stale.
 *
 * 2. It is visible, not sr-only. An accessibility feature nobody can see is one
 *    nobody notices breaking; the `spoken` overrides below would drift within a
 *    month. It is also just useful — a numeric readout in words beats squinting
 *    at an arrow, and it is the only part of the page that survives a copy-paste
 *    into notes.
 */

export type VizFact = {
  /** Short visible name, e.g. "P(0)". */
  label: string
  /** Already formatted by the caller — this component does no rounding. */
  value: string
  accent?: 'violet' | 'teal' | 'amber' | 'rose' | 'sky'
  /**
   * What to say instead of "label, value" when the visible label is symbols a
   * screen reader mangles: "P(0)" comes out as "P left paren zero right paren",
   * "θ" as "theta" only if the voice happens to know Greek. Supply prose here.
   */
  spoken?: string
}

export type VizDescriptionProps = {
  /** The quantities that matter right now, in the order they should be read. */
  facts: VizFact[]
  /** One sentence of context, read before the numbers. Should change rarely. */
  summary?: string
  /** Defaults to "What this is showing". */
  heading?: string
  /** See DEFAULT_INTERVAL_MS before overriding this. */
  intervalMs?: number
  /**
   * Whether the numbers are visible on load. Default is open: see the class
   * comment — the readout earns its place on screen, and hiding it by default
   * would make this the eighty-fifth thing on the page nobody ever looks at.
   * Pass false for a visualization whose controls rail already repeats these
   * exact values a few pixels away.
   */
  defaultOpen?: boolean
}

/**
 * How often the panel is allowed to change, in milliseconds.
 *
 * This is the number that decides whether the feature helps or harms. A value
 * updating at 60 Hz inside aria-live makes a screen reader unusable: NVDA and
 * JAWS replace the pending utterance every time the text changes, so the
 * sentence never finishes and the user hears an endless stutter of first
 * syllables. The rate has to be slower than speech, not faster.
 *
 * 2000 ms is one notch slower than a typical readout takes to speak. A four-fact
 * sentence is ~12 words, which is about 1.6 s at the 450 wpm experienced screen
 * reader users actually run at, so each announcement lands complete with a beat
 * of silence after it. Faster than this and announcements start stepping on each
 * other; much slower and dragging a slider stops feeling connected to the words.
 *
 * Commits are leading-edge: the first change after a quiet moment is immediate
 * (so a slider nudge answers at once) and the throttle only applies to the flood
 * behind it, with a trailing flush so the final resting value is always the last
 * thing spoken.
 */
const DEFAULT_INTERVAL_MS = 2000

/** `lastCommitRef` before anything has been committed: the first change goes out at once. */
const NEVER_COMMITTED = Number.NEGATIVE_INFINITY

/** ASCII unit/record/group separators — see snapshotKey. */
const UNIT_SEP = ''
const RECORD_SEP = ''
const GROUP_SEP = ''

const ACCENT_TEXT: Record<NonNullable<VizFact['accent']>, string> = {
  violet: 'text-q-violet-text',
  teal: 'text-q-teal-text',
  amber: 'text-q-amber-text',
  rose: 'text-q-rose-text',
  sky: 'text-q-sky-text',
}

/** Flatten the facts into one sentence — the exact string the voice will read. */
function toSentence(summary: string | undefined, facts: VizFact[]): string {
  const parts = facts.map((f) => f.spoken ?? `${f.label}, ${f.value}`)
  const body = parts.length > 0 ? `${parts.join('. ')}.` : ''
  if (!summary) return body
  return body ? `${summary} ${body}` : summary
}

/**
 * Everything the panel puts on screen, as one comparable string.
 *
 * It has to cover the tiles and not just the sentence. A caller that supplies
 * `spoken` for every fact — the case `spoken` exists for — holds the sentence
 * constant while the numbers move, so keying the throttle off the sentence alone
 * froze the tiles on whatever they happened to show at mount. Re-committing an
 * unchanged sentence costs nothing: React writes no new text into the live
 * region, so there is no second announcement.
 *
 * The separators are control characters because a label or a formatted value may
 * legitimately contain a comma, a pipe or a colon — "(0.31, -0.02)" is a value
 * this component already renders.
 */
function snapshotKey(sentence: string, facts: VizFact[]): string {
  const tiles = facts.map((f) => [f.label, f.value, f.accent ?? ''].join(UNIT_SEP)).join(RECORD_SEP)
  return [sentence, tiles].join(GROUP_SEP)
}

export function VizDescription({
  facts,
  summary,
  heading = 'What this is showing',
  intervalMs,
  defaultOpen = true,
}: VizDescriptionProps) {
  const [open, setOpen] = useState(defaultOpen)
  const panelId = useId()

  // Reduced motion is read in an effect, not in the initialiser: the server has
  // no matchMedia, so seeding state from it renders one interval on the server
  // and another on the client — a hydration mismatch on every viz page.
  const [calmer, setCalmer] = useState(false)
  useEffect(() => setCalmer(prefersReducedMotion()), [])

  // Someone who asked the system for less motion did not ask for less
  // information, but they did ask for less churn — a readout re-announcing
  // itself every two seconds is churn. Halve the rate rather than mute it.
  const interval = (intervalMs ?? DEFAULT_INTERVAL_MS) * (calmer ? 2 : 1)

  const sentence = toSentence(summary, facts)
  const key = snapshotKey(sentence, facts)

  // `shown` is the snapshot the panel currently holds; `sentence`/`facts` are
  // the truth. The gap between them is the throttle — and the tiles are part of
  // the same snapshot on purpose. Rendering them live while the sentence lagged
  // would put two different numbers for P(0) on screen at once, one of them
  // wrong; and a value flickering at 60 Hz is unreadable to a sighted user
  // anyway. The controls rail is where the instantaneous figure lives.
  const [shown, setShown] = useState<{ sentence: string; facts: VizFact[] }>({ sentence, facts })
  const latestRef = useRef({ key, sentence, facts })
  const shownKeyRef = useRef(key)
  const lastCommitRef = useRef(NEVER_COMMITTED)
  const timerRef = useRef<number | null>(null)

  // Written in an effect rather than straight through during render: a render
  // React starts and throws away (Strict Mode, an interrupted concurrent render)
  // must not be able to leave the pending flush pointing at a snapshot that was
  // never on screen.
  useEffect(() => {
    latestRef.current = { key, sentence, facts }
  })

  useEffect(() => {
    // Identical content is not a change worth committing: dragging φ on the
    // Bloch sphere moves the picture without moving P(0) or P(1) at all, and
    // re-announcing the same sentence would teach the opposite of the lesson.
    if (key === shownKeyRef.current) return

    const commit = () => {
      // Read through the ref, never the closure: this may be a flush that was
      // queued several values ago, and the resting value is the one to speak.
      const latest = latestRef.current
      shownKeyRef.current = latest.key
      lastCommitRef.current = Date.now()
      setShown({ sentence: latest.sentence, facts: latest.facts })
    }

    const waited = Date.now() - lastCommitRef.current
    if (waited >= interval) {
      commit()
      return
    }
    // A flush is already queued; it reads latestRef when it fires, so it will
    // carry the newest value rather than this stale one. Queueing a second timer
    // here is how a throttle quietly turns back into a 60 Hz firehose.
    if (timerRef.current !== null) return
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      commit()
    }, interval - waited)
  }, [key, interval])

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    },
    []
  )

  if (facts.length === 0 && !summary) return null

  return (
    <div className="border-t border-line bg-surface-2 px-3 py-2.5">
      <button
        type="button"
        className="focus-ring flex w-full items-center justify-between gap-3 rounded text-left"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="section-label">{heading}</span>
        {/* aria-hidden because aria-expanded already states this, and a button
            that announces both reads as "What this is showing, Hide, expanded". */}
        <span aria-hidden className="text-[11px] font-semibold text-ink-muted">
          {open ? 'Hide' : 'Show'}
        </span>
      </button>

      <div id={panelId}>
        {/*
          One live region, always mounted, holding one text node.

          Always mounted: collapsing the panel must not switch the announcements
          off — a screen reader user has no way to know the readout is behind a
          toggle, so collapsed-and-silent is the same as absent. When collapsed
          it is sr-only; when open it is the same words, visible.

          One text node, not the grid below: aria-live announces the nodes that
          changed, so wrapping the tiles would speak a bare "0.512" with its
          label left behind on the unchanged node next door. aria-atomic keeps
          the sentence whole even when only one number in it moved.
        */}
        <p
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className={open ? 'mt-2 text-[13px] leading-relaxed text-ink-secondary' : 'sr-only'}
        >
          {shown.sentence}
        </p>

        {open ? (
          // aria-hidden: this grid is the sentence above, set as tiles. Without
          // it every number is read twice, once in prose and once bare.
          <div aria-hidden className="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {shown.facts.map((fact, i) => (
              // Keyed by position: labels are caller data and two can collide
              // (two "Δ" tiles on the interference page), and the list is
              // rebuilt wholesale on every commit, so position is the identity.
              <div
                key={`${i}-${fact.label}`}
                className="rounded-lg border border-line bg-surface-3 px-2.5 py-1.5"
              >
                {/* text-ink-secondary, not text-ink-muted: muted on surface-3 is
                    4.58:1 in the light theme and this label is 10px, i.e. normal
                    size text needing 4.5:1, with nothing left for a future token
                    tweak. aria-hidden buys no exemption — axe checks contrast on
                    anything visible on screen. */}
                <div className="text-[10px] font-bold uppercase tracking-wider text-ink-secondary">
                  {fact.label}
                </div>
                <div
                  className={`font-mono text-[13px] font-bold ${ACCENT_TEXT[fact.accent ?? 'violet']}`}
                >
                  {fact.value}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}
