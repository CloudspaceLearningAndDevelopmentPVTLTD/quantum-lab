'use client'

import Link from 'next/link'
import { LESSONS } from '@/lib/lessons'
import { VISUALIZATIONS } from '@/lib/visualizations'

/**
 * Fallback served by the service worker when a navigation cannot be satisfied from the
 * network or the cache. It is a client component because the "Try again" button needs
 * `location.reload()` — and because it is precached, it must not depend on any data.
 */

const OFFLINE_READY: ReadonlyArray<{
  href: string
  title: string
  description: string
}> = [
  {
    href: '/simulator',
    title: 'Circuit simulator',
    description: 'Build circuits, run shots, inspect the state vector.',
  },
  {
    href: '/learn',
    title: 'The course',
    // Derived, not written out. This copy said "ten" and was already wrong
    // one lesson later; a hardcoded count in prose is a guaranteed future lie.
    description: `All ${LESSONS.length} lessons, with their embedded labs and exercises.`,
  },
  {
    href: '/circuits',
    title: 'Saved circuits',
    description: 'Anything already stored in this browser. Sync resumes when you reconnect.',
  },
  {
    href: '/certify',
    title: 'Certification practice',
    description: 'Work through practice questions offline.',
  },
]

export default function OfflinePage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <p className="section-label">Offline</p>
      <h1 className="section-title mt-2 text-3xl md:text-4xl">
        No connection — but the physics still runs
      </h1>
      <p className="section-desc mt-3">
        We couldn&rsquo;t reach the network, so this particular page isn&rsquo;t
        available. Almost everything in Qubit16 is computed in your browser, though,
        so the parts that matter keep working. Anything below that you&rsquo;ve visited
        before will open right now.
      </p>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => location.reload()}
          className="btn-primary focus-ring"
        >
          Try again
        </button>
        <Link href="/" className="btn-ghost focus-ring">
          Go home
        </Link>
      </div>

      <section className="card mt-8 p-6">
        <h2 className="text-lg font-bold text-ink">Works offline</h2>
        <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {OFFLINE_READY.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className="card-hover focus-ring block rounded-card border border-line bg-surface-2 p-4"
              >
                <span className="block text-sm font-semibold text-ink">{item.title}</span>
                <span className="mt-1 block text-sm text-ink-secondary">
                  {item.description}
                </span>
              </Link>
            </li>
          ))}
        </ul>

        {/* Derived from VISUALIZATIONS.length just above, for the same reason as
            the lesson count: a hardcoded number here drifts the next time a
            visualization is added or removed. */}
        <h3 className="section-label mt-8">The {VISUALIZATIONS.length} visualizations</h3>
        <ul className="mt-3 flex flex-wrap gap-2">
          {VISUALIZATIONS.map((viz) => (
            <li key={viz.href}>
              <Link href={viz.href} className="pill focus-ring">
                {viz.title}
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="card mt-4 border-line p-6">
        <h2 className="text-lg font-bold text-ink">Needs a connection</h2>
        <p className="mt-2 text-sm text-ink-secondary">
          The AI tutor, pricing and account pages, and syncing saved circuits to your
          account all talk to a server. They&rsquo;ll pick up again automatically once
          you&rsquo;re back online — nothing you do offline is lost.
        </p>
      </section>
    </div>
  )
}
