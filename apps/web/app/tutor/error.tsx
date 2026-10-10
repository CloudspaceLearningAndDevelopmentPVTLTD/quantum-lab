'use client'

/**
 * app/tutor/error.tsx — error boundary for tutor.
 *
 * The tutor already degrades honestly at the network layer: /api/agent answers
 * 200 with an offline reply when the agent service and Anthropic are both
 * unreachable, so a network failure NEVER reaches this boundary. Anything that
 * does get here is a rendering fault in the chat UI itself, which is why the
 * copy does not mention connectivity - saying 'check your connection' for a
 * bug in our own component sends the learner to fix something that is not
 * broken.
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
      boundary="tutor"
      title="The tutor page could not load"
      links={[{ href: '/learn', label: 'The course' }]}
    >
      <p>The chat panel failed while rendering. This is not a connection problem: the tutor answers offline when it cannot reach a model, so a network fault would have shown you an answer rather than this page.</p>
      <p>Your conversation is not stored on a server, so reloading starts a fresh one.</p>
    </RouteError>
  )
}
