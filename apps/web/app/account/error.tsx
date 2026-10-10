'use client'

/**
 * app/account/error.tsx — error boundary for account.
 *
 * Reads entitlement and subscription state from the server. The reassurance
 * that matters is about billing: a failure here is a read failure and cannot
 * have changed a subscription.
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
      boundary="account"
      title="Your account page could not load"
      links={[{ href: '/pricing', label: 'Plans' }, { href: '/learn', label: 'The course' }]}
    >
      <p>Your plan and billing details could not be read. Your subscription is unchanged — this page only reads, and Stripe is the record either way.</p>
      <p>If you were sent here from checkout, the payment still went through; the confirmation just could not be displayed.</p>
    </RouteError>
  )
}
