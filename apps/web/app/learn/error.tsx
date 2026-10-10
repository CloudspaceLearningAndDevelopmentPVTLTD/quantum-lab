'use client'

/**
 * app/learn/error.tsx — error boundary for learn.
 *
 * Every lesson embeds a live visualization, so a lesson page inherits the
 * visualization failure modes on top of its own. The copy points at that
 * because 'the lesson text is fine, the embedded experiment is not' is a
 * distinction the learner can act on by reading on.
 */

import { RouteError } from '@/lib/observability/RouteError'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <RouteError
      error={error}
      reset={reset}
      boundary="learn"
      title="This lesson could not be shown"
      links={[{ href: '/learn', label: 'The course' }]}
    >
      <p>The lesson failed while rendering. Lessons embed a live experiment, so this is often the experiment rather than the lesson text.</p>
      <p>Your progress through the course is stored in this browser and is untouched.</p>
    </RouteError>
  )
}
