'use client'

/**
 * app/simulator/error.tsx — error boundary for simulator.
 *
 * The simulator is the one route where a learner may have unsaved work on
 * screen, so the first thing this says is where that work is. lib/quantum.ts
 * allocates a 2^n complex statevector; the realistic failure is an out-of-
 * memory on a large qubit count, and the second paragraph names it because
 * 'try fewer qubits' is actionable and 'try again' is not.
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
      boundary="simulator"
      title="The simulator stopped"
      links={[{ href: '/circuits', label: 'Your saved circuits' }]}
    >
      <p>The circuit editor or the state inspector failed while rendering. Your saved circuits are untouched — they are stored in this browser, and this failure did not reach them.</p>
      <p>If this happened right after adding a qubit: the statevector doubles in size with every qubit, so a wide circuit can exhaust the memory the browser tab is allowed. Reload and rebuild with fewer qubits.</p>
    </RouteError>
  )
}
