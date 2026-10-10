'use client'

/**
 * NextUpCard — one recommendation, presented as an action rather than a note.
 *
 * The rank matters visually. A recommendation list where every row looks
 * identical is not a recommendation, it is a menu; rank 1 gets a violet ring
 * and larger type so the eye lands on the thing the coach actually thinks you
 * should do next.
 */

import Link from 'next/link'
import { destinationFor, type Recommendation } from '@/lib/coach/recommend'

interface NextUpCardProps {
  rec: Recommendation
  rank: number
}

/** Fixed hue per kind, so the colour is a legend the learner can learn. */
const KIND_STYLE: Record<
  Recommendation['kind'],
  { label: string; border: string; text: string; cta: string }
> = {
  revise: { label: 'Revise', border: 'var(--q-amber)', text: 'var(--q-amber-text)', cta: 'Revise the lesson' },
  advance: { label: 'Advance', border: 'var(--q-violet)', text: 'var(--q-violet-text)', cta: 'Start the lesson' },
  practise: { label: 'Practise', border: 'var(--q-teal)', text: 'var(--q-teal-text)', cta: 'Open the simulator' },
  explore: { label: 'Explore', border: 'var(--q-sky)', text: 'var(--q-sky-text)', cta: 'Open the visualization' },
}

export function NextUpCard({ rec, rank }: NextUpCardProps) {
  const style = KIND_STYLE[rec.kind]
  const isTop = rank === 1
  const href = destinationFor(rec)

  return (
    <article
      className={`card card-hover p-5 ${
        isTop ? 'ring-1 ring-q-violet ring-offset-2 ring-offset-bg' : ''
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="pill"
          style={{ borderColor: style.border, color: style.text }}
        >
          {style.label}
        </span>
        <span className="text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-muted">
          #{rank}
          {isTop ? ' · next up' : ''}
        </span>
        <span className="ml-auto text-[11px] text-ink-muted">
          about {rec.estimatedMinutes} min
        </span>
      </div>

      <h3
        className={`mt-3 font-bold text-ink ${isTop ? 'text-xl' : 'text-base'}`}
      >
        {rec.title}
      </h3>

      <p
        className={`mt-2 text-ink-secondary ${isTop ? 'text-sm' : 'text-[13px]'}`}
      >
        {rec.why}
      </p>

      <div className="mt-4 flex items-center gap-3">
        {/*
          A11Y (WCAG 2.4.4 Link Purpose, Level A). Three recommendation cards
          sit side by side and their CTAs are drawn from a four-entry table, so
          a screen-reader user pulling up the link list heard "Start the lesson,
          Start the lesson, Open the visualization" with nothing to tell them
          apart. The visible text stays short; the accessible name names the
          destination, which also keeps 2.5.3 satisfied because the visible
          label is still a prefix of the name.
        */}
        <Link href={href} className="btn-primary focus-ring" aria-label={`${style.cta}: ${rec.title}`}>
          {style.cta}
        </Link>
        <span className="text-[11px] text-ink-muted">
          confidence {Math.round(rec.confidence * 100)}%
        </span>
      </div>
    </article>
  )
}
