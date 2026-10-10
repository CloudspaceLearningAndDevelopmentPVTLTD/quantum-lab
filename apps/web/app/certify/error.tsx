'use client'

/**
 * app/certify/error.tsx — error boundary for certify.
 *
 * The one boundary where the learner's first question is about the CLOCK, not
 * the page. Two things have to stay true for this copy to be honest, and both
 * are now server-side facts rather than browser ones: an attempt is a row with
 * its own answers, so a reload resumes it rather than restarting it; and the
 * deadline was stamped when the attempt was created and is not counted by this
 * page, so a render failure consumes no more time than the wall clock does. If
 * either ever stops being true, correct this copy in the same change.
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
      boundary="certify"
      title="The exam could not be shown"
      links={[{ href: '/certify', label: 'Back to the exams' }]}
    >
      <p>The exam view failed while rendering. Your answers are saved on our side as you give them, so reloading resumes the same paper where you left it — on this device or any other you are signed in on.</p>
      <p>The clock is kept by our server against a deadline fixed when you began, not counted by this page. This error is not burning your time any faster than the minutes are passing.</p>
    </RouteError>
  )
}
