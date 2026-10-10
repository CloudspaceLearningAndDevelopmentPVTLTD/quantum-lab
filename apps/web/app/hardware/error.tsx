'use client'

/**
 * app/hardware/error.tsx — error boundary for hardware.
 *
 * This page talks to services/api, which talks to IBM and Braket. The sentence
 * that matters is the one about submitted jobs: a learner who has just spent
 * real credits and then sees an error page needs to know, immediately, that
 * the job is not lost and where to look for it.
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
      boundary="hardware"
      title="The hardware page could not load"
      links={[{ href: '/simulator', label: 'Simulate in the browser instead' }]}
    >
      <p>The device list or the job monitor failed while rendering.</p>
      <p>Any job you already submitted is unaffected. Jobs live with the provider once accepted, not in this page — reload and the monitor will pick them up again. This failure did not submit anything and did not spend any credit.</p>
    </RouteError>
  )
}
