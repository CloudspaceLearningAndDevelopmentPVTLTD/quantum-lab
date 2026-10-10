'use client'

/**
 * DeeperExplain — QPlayLearn's "explain one level deeper" pattern, powered by
 * the tutor the app already has.
 *
 * A small button at each section boundary ("Explain this differently") opens an
 * inline panel offering the same passage at two other depths — simpler, or more
 * mathematical. Choosing one POSTs to the existing /api/agent route with a
 * context hint (lesson slug + section heading + chosen depth) folded into the
 * user turn; the route accepts no client-supplied system prompt on purpose, and
 * its `level` field carries the depth shift (see lib/deeperExplain.ts).
 *
 * Honesty rules, inherited from ChatPanel:
 * - the GET tier probe runs when the panel opens, so if only the offline FAQ is
 *   live the panel says so BEFORE the learner asks, instead of a canned answer
 *   pretending to have read the section;
 * - a 429 renders as "the tutor is busy", never as a failure of the learner's;
 * - offline-sourced replies carry the same amber pill MessageBubble shows.
 *
 * PAYWALL: this component receives only a slug and a heading the page already
 * rendered. It never touches lesson bodies — for a paid lesson it exists only
 * on sections the entitled page delivered.
 */

import { useEffect, useRef, useState } from 'react'
import MessageBubble from '@/components/tutor/MessageBubble'
import {
  DEPTH_LABEL,
  probeTutorTier,
  requestDeeperExplanation,
  type DeeperExplainResult,
  type Depth,
  type TutorSource,
} from '@/lib/deeperExplain'
// Signed-in callers get their plan's tutor tier and quota, not the anonymous per-IP one.
import { authFetch } from '@/lib/authFetch'

export interface DeeperExplainProps {
  /** The lesson this section belongs to — already public in the page URL. */
  slug: string
  /** The section heading the button sits under — already rendered above it. */
  heading: string
}

const DEPTHS: Depth[] = ['simpler', 'mathematical']

const OFFLINE_NOTE =
  'Only the built-in offline tutor is available right now. It answers core topics from a fixed FAQ, so it may not engage with this exact section.'

const BUSY_NOTE = 'The tutor is busy right now — wait a moment and try again.'

export function DeeperExplain({ slug, heading }: DeeperExplainProps) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState<Depth | null>(null)
  const [result, setResult] = useState<DeeperExplainResult | null>(null)
  const [tier, setTier] = useState<TutorSource | null>(null)
  const probed = useRef(false)

  // Probe the tier when (and only when) the panel first opens: one page can
  // hold many sections, and firing a status request per section on mount would
  // point the whole lesson at the route's status limiter for no reason.
  useEffect(() => {
    if (!open || probed.current) return
    probed.current = true
    const controller = new AbortController()
    void probeTutorTier(authFetch, controller.signal).then((source) => {
      if (!controller.signal.aborted && source) setTier(source)
    })
    return () => controller.abort()
  }, [open])

  async function ask(depth: Depth) {
    if (loading) return
    setLoading(depth)
    setResult(null)
    const outcome = await requestDeeperExplanation(slug, heading, depth, authFetch)
    setResult(outcome)
    setLoading(null)
  }

  if (!open) {
    return (
      <div className="mt-3">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={false}
          aria-label={`Explain “${heading}” differently`}
          className="focus-ring rounded text-[13px] font-semibold text-q-violet-text underline decoration-q-violet/40 underline-offset-2 hover:decoration-q-violet"
        >
          Explain this differently
        </button>
      </div>
    )
  }

  return (
    <div className="card mt-3 p-4" aria-label={`Alternative explanations of “${heading}”`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.09em] text-q-violet-text">
            Explain this differently
          </p>
          <p className="mt-1 text-[13px] text-ink-muted">
            The tutor re-explains &ldquo;{heading}&rdquo; at another depth.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setOpen(false)
            setResult(null)
          }}
          aria-label="Close alternative explanations"
          className="focus-ring shrink-0 rounded px-1 leading-none text-ink-muted hover:text-ink"
        >
          ✕
        </button>
      </div>

      {tier === 'offline' ? (
        <p className="mt-3 rounded-lg border border-q-amber/40 bg-q-amber/[0.07] px-3 py-2 text-[13px] leading-relaxed text-q-amber-text">
          {OFFLINE_NOTE}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        {DEPTHS.map((depth) => (
          <button
            key={depth}
            type="button"
            onClick={() => void ask(depth)}
            disabled={loading !== null}
            aria-pressed={loading === depth}
            className="pill focus-ring border-q-violet/40 text-q-violet-text hover:bg-q-violet/10 disabled:opacity-50"
          >
            {DEPTH_LABEL[depth]}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="mt-3 flex items-center gap-2 text-[13px] text-ink-muted" aria-live="polite">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-q-violet-text" />
          Rethinking this section…
        </p>
      ) : null}

      {/* aria-live so the answer (or the busy note) is announced when it lands. */}
      <div aria-live="polite">
        {result?.kind === 'busy' ? (
          <p className="mt-3 text-[13px] leading-relaxed text-q-amber-text">{BUSY_NOTE}</p>
        ) : null}

        {result?.kind === 'error' ? (
          <p role="alert" className="mt-3 text-[13px] leading-relaxed text-q-rose-text">
            {result.message}
          </p>
        ) : null}

        {result?.kind === 'reply' ? (
          <div className="mt-4">
            <MessageBubble
              role="assistant"
              content={result.reply}
              offline={result.offline}
              source={result.source}
            />
          </div>
        ) : null}
      </div>
    </div>
  )
}
