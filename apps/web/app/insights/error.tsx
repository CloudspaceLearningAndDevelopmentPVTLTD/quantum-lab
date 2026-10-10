'use client'

/**
 * app/insights/error.tsx — error boundary for insights.
 *
 * Insights computes everything from a localStorage ring buffer with no network
 * at all, so the only realistic failure is a malformed or partially-written
 * buffer. That is worth naming precisely, because the fix - the delete button
 * already on the page - is one the learner owns, and because it is a chance to
 * restate that the data never left the device.
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
      boundary="insights"
      title="Your insights could not be drawn"
      links={[{ href: '/learn', label: 'The course' }]}
    >
      <p>The dashboard failed while reading or charting your activity. Nothing was sent anywhere: this page computes every number in your browser from data that never leaves it.</p>
      <p>If it fails again after a reload, the stored activity buffer is probably corrupt. Deleting it from this page is safe — it holds only counts and slugs, and nothing else depends on it.</p>
    </RouteError>
  )
}
