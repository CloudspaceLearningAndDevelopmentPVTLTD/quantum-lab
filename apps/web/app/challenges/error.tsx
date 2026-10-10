'use client'

/**
 * app/challenges/error.tsx — error boundary for challenges.
 *
 * The workbench runs a real simulation to produce its verdict, so it shares
 * the simulator's memory failure mode. Par scores and completions are local.
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
      boundary="challenges"
      title="This challenge could not be shown"
      links={[{ href: '/challenges', label: 'All challenges' }]}
    >
      <p>The challenge workbench failed while rendering or while checking your circuit.</p>
      <p>Your progress and par scores are stored in this browser and are not affected. Reloading returns you to the same challenge.</p>
    </RouteError>
  )
}
