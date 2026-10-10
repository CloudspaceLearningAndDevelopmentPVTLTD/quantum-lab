'use client'

/**
 * app/admin/error.tsx — error boundary for admin.
 *
 * The only route group whose data is genuinely server-side: orgs, seats and
 * members come from Supabase. So this is the one boundary where 'try again' is
 * the right first move and where a persistent failure means an operator, not
 * the user, has something to fix.
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
      boundary="admin"
      title="The admin console could not load"
      links={[{ href: '/account', label: 'Your account' }]}
    >
      <p>Organisation, seat or member data could not be loaded. Nothing was changed — this page failed while reading, not while writing.</p>
      <p>If it keeps failing, the database this deployment uses is likely unavailable; quote the reference below to whoever operates it.</p>
    </RouteError>
  )
}
