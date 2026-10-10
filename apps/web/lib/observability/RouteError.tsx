'use client'

/**
 * RouteError.tsx — the body of every error.tsx in this app.
 *
 * WHY IT LIVES IN lib/ AND NOT components/. Twelve error boundaries would
 * otherwise be twelve near-copies, and the failure mode of near-copies is that
 * eleven of them stop reporting the day someone edits the twelfth.
 * components/ is being edited by three other workstreams; lib/observability is
 * this one's, and an error boundary is observability before it is UI.
 *
 * WHAT AN ERROR BOUNDARY OWES THE LEARNER, and what a blank page does not give
 * them:
 *   1. WHICH thing broke — "the simulator", not "an error occurred".
 *   2. Whether their work survived. In this app it almost always did, because
 *      circuits, progress and exam attempts are in localStorage and never in
 *      the render that just failed. Saying so is the single most useful
 *      sentence on the page.
 *   3. A way back. `reset()` re-renders the segment; the links go somewhere
 *      that is known to work. A boundary with no action is a dead end with
 *      better typography.
 *   4. The digest, so a support conversation can start with an id rather than
 *      "it broke earlier".
 *
 * WHAT IT DOES NOT DO: render `error.message` or a stack. A Next production
 * build already replaces server-thrown messages with a generic string, but
 * client-thrown ones survive, and those can carry a URL, a field value, or a
 * fragment of a learner's own circuit. The digest is the only identifier shown.
 */

import Link from 'next/link'
import { useEffect } from 'react'
import { reportError } from '@/lib/observability/report'

export interface RouteErrorProps {
  /** The error Next caught. Only `digest` is ever rendered. */
  error: Error & { digest?: string }
  /** Next's re-render of the failed segment. */
  reset: () => void
  /**
   * Which boundary this is, e.g. 'simulator'. Sent with the report so an issue
   * in Sentry says where it happened without any URL or query string.
   */
  boundary: string
  /** Headline. Name the feature — "The simulator stopped", not "Error". */
  title: string
  /** One or two sentences: what happened, what survived, what to try. */
  children: React.ReactNode
  /** Extra ways back, beyond "Try again" and "Home". */
  links?: { href: string; label: string }[]
}

export function RouteError({
  error,
  reset,
  boundary,
  title,
  children,
  links = [],
}: RouteErrorProps): React.JSX.Element {
  useEffect(() => {
    // Runs once per error instance. `digest` is Next's own id and is safe to
    // send — it is a hash, not content. Nothing else about the failure travels.
    reportError(error, { boundary, digest: error.digest ?? 'none' })
  }, [error, boundary])

  return (
    // Not <main>: app/layout.tsx already renders the single <main> landmark and
    // an error.tsx renders inside it. A second one is the `main > main` defect
    // that was closed across 19 routes; do not reintroduce it here.
    <div className="mx-auto max-w-2xl px-6 py-16">
      <div className="card p-8">
        <p className="section-label">Something went wrong</p>
        <h1 className="mt-2 text-2xl font-bold text-ink sm:text-3xl">{title}</h1>
        <div className="mt-4 space-y-3 text-sm leading-relaxed text-ink-secondary">
          {children}
        </div>

        <div className="mt-7 flex flex-wrap gap-3">
          <button type="button" onClick={() => reset()} className="btn-primary focus-ring">
            Try again
          </button>
          {links.map((link) => (
            <Link key={link.href} href={link.href} className="btn-ghost focus-ring">
              {link.label}
            </Link>
          ))}
          <Link href="/" className="btn-ghost focus-ring">
            Home
          </Link>
        </div>

        {error.digest ? (
          <p className="mt-6 text-xs text-ink-muted">
            Reference for support:{' '}
            <code className="font-mono text-ink-secondary">{error.digest}</code>
          </p>
        ) : null}
      </div>
    </div>
  )
}
