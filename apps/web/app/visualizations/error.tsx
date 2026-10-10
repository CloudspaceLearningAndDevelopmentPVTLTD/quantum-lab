'use client'

/**
 * app/visualizations/error.tsx — error boundary for visualizations.
 *
 * All eight experiments compute their physics live on canvas, SVG or three.js,
 * and read their colours from CSS custom properties at runtime. The two
 * failures that actually happen are a WebGL context this machine will not give
 * (three.js, the Bloch sphere) and a numerical blow-up in an integrator. Both
 * are worth naming: the first is a per-machine problem the learner can route
 * around by picking a different experiment.
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
      boundary="visualizations"
      title="This visualization could not run"
      links={[{ href: '/visualizations', label: 'All experiments' }]}
    >
      <p>The experiment failed while it was computing or drawing. These run entirely in your browser, so nothing was sent anywhere and nothing was lost.</p>
      <p>If this is the Bloch sphere or another 3D view, your browser may have refused a WebGL context — that is a per-machine limit, and the 2D experiments will still work.</p>
    </RouteError>
  )
}
