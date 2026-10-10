'use client'

import Link from 'next/link'
import { AlreadySubscribedPrompt } from '@/components/auth/SignInLink'

interface LessonPaywallProps {
  lessonTitle: string
  /** How many blocks of this lesson are being withheld. */
  hiddenCount: number
}

const PRO_ADDS: string[] = [
  'The other three Advanced lessons — error correction, VQE, and quantum cryptography',
  'Certification for the Advanced track, with a shareable certificate',
  'Runs on real IBM Quantum hardware, not just the simulator',
  'The live Claude-powered tutor, on every lesson and every circuit',
]

/**
 * Shown in place of the withheld tail of a paid lesson.
 *
 * Deliberately warm rather than obstructive: the learner has just read three
 * blocks of real material and is mid-thought, so this reads as an invitation to
 * keep going rather than a barrier that resents them.
 */
export function LessonPaywall({ lessonTitle, hiddenCount }: LessonPaywallProps) {
  const sections = hiddenCount === 1 ? '1 more section' : `${hiddenCount} more sections`

  return (
    <section
      aria-label="Upgrade to continue this lesson"
      className="card relative overflow-hidden border-q-violet/30 p-8"
    >
      {/* Violet wash — decorative, so it stays out of the accessibility tree. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-gradient-to-br from-q-violet/25 via-q-violet/5 to-transparent"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-q-violet/20 blur-3xl"
      />

      <div className="relative">
        <span
          aria-hidden="true"
          className="flex h-11 w-11 items-center justify-center rounded-card border border-q-violet/40 bg-q-violet/15 text-q-violet-text"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.7">
            <rect x="5" y="11" width="14" height="9" rx="2" />
            <path d="M8 11V8a4 4 0 0 1 8 0v3" strokeLinecap="round" />
            <circle cx="12" cy="15.5" r="1.2" fill="currentColor" stroke="none" />
          </svg>
        </span>

        <h2 className="section-title mt-5 text-2xl">
          The rest of this lesson is part of the Advanced track
        </h2>

        <p className="section-desc mt-3 max-w-2xl">
          You have read the opening of <span className="text-ink">{lessonTitle}</span>, and{' '}
          {sections} are waiting — the part where the idea actually gets built. The Advanced
          track picks up exactly where Quantum Foundations stops, and Pro opens all of it.
        </p>

        <ul className="mt-6 space-y-2.5">
          {PRO_ADDS.map((item) => (
            <li key={item} className="flex items-start gap-3 text-sm text-ink-secondary">
              <svg
                aria-hidden="true"
                viewBox="0 0 20 20"
                className="mt-0.5 h-4 w-4 shrink-0 text-q-teal-text"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m4 10.5 4 4 8-9" />
              </svg>
              <span>{item}</span>
            </li>
          ))}
        </ul>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link href="/pricing" className="btn-primary focus-ring">
            See plans
          </Link>
          <Link href="/learn" className="btn-ghost focus-ring">
            Back to the free course
          </Link>
        </div>
        <AlreadySubscribedPrompt />

        <p className="mt-5 text-xs text-ink-muted">
          The whole Quantum Foundations course stays free, forever, with no account required.
        </p>
      </div>
    </section>
  )
}

export default LessonPaywall
