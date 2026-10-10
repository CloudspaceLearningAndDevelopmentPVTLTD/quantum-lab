'use client'

/**
 * app/error.tsx — error boundary for root.
 *
 * The fallback for every route that does not name its own boundary. It is
 * deliberately vague about WHAT broke, because it does not know; every route
 * group where the answer would be useful has its own error.tsx next to its
 * page. Adding one is four lines - copy this file.
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
      boundary="root"
      title="This page stopped part way through"
      links={[{ href: '/learn', label: 'Back to the course' }]}
    >
      <p>Something in this page failed while it was rendering. It is usually transient, and trying again is worth one attempt before anything else.</p>
      <p>Nothing you saved is affected. Circuits, lesson progress and exam attempts live in your own browser&apos;s storage, not in the part of the page that just failed.</p>
    </RouteError>
  )
}
