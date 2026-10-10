'use client'

/**
 * CourseSignup — the opt-in form for the 7-day email course.
 *
 * Mounted in ONE place: the foot of /learn (app/learn/page.tsx), which made
 * the product call this header used to defer — the course index is where a
 * person has just seen what the lessons are and is deciding how to take
 * them. All three prerequisites from docs/ONBOARDING.md §"Email: nothing is
 * sent, on purpose" now exist (consent record, unsubscribe, and the
 * dispatch endpoint at app/api/email/dispatch), so a confirmed signup will
 * receive the course once an operator configures sending — the copy below
 * still says "once sending launches" because in any deployment without
 * RESEND_API_KEY + EMAIL_DISPATCH_SECRET + the durable store, that is the
 * truth.
 *
 * Behaviour notes:
 *   • The success message is the server's fixed anti-enumeration line
 *     ("if that address can receive mail from us…") — this component never
 *     invents a more certain-sounding one.
 *   • A 429 and a 503 are shown as themselves: "wait a bit" and "nothing was
 *     recorded, try again". No silent retry loops — retrying a signup form
 *     is how one person becomes three rows of noise.
 */

import { useState, type FormEvent } from 'react'

type Phase =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'done'; message: string }
  | { kind: 'error'; message: string }

export default function CourseSignup(): React.ReactElement {
  const [email, setEmail] = useState('')
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (phase.kind === 'sending') return
    setPhase({ kind: 'sending' })
    try {
      const response = await fetch('/api/email/subscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const body: unknown = await response.json().catch(() => null)
      const message =
        body && typeof body === 'object' && !Array.isArray(body)
          ? String(
              (body as Record<string, unknown>).message ??
                (body as Record<string, unknown>).error ??
                ''
            )
          : ''
      if (response.ok) {
        setPhase({ kind: 'done', message: message || 'Check your inbox for a confirmation link.' })
      } else {
        setPhase({
          kind: 'error',
          message: message || 'That did not go through. Please try again in a moment.',
        })
      }
    } catch {
      setPhase({
        kind: 'error',
        message: 'The signup could not be sent. Check your connection and try again.',
      })
    }
  }

  if (phase.kind === 'done') {
    return (
      <p role="status" className="text-sm text-ink-muted">
        {phase.message}
      </p>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-3" aria-label="Sign up for the 7-day email course">
      <div>
        <label htmlFor="course-signup-email" className="text-sm font-semibold">
          The 7-day quantum email course
        </label>
        <p className="mt-1 text-sm text-ink-muted">
          One short lesson a day, once sending launches. Double opt-in, one-click unsubscribe
          in every message, and your address is used for nothing else.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <input
          id="course-signup-email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          className="focus-ring min-w-0 flex-1 rounded-card border px-3 py-2 text-sm"
          disabled={phase.kind === 'sending'}
        />
        <button
          type="submit"
          className="focus-ring rounded-card border px-4 py-2 text-sm font-semibold"
          disabled={phase.kind === 'sending'}
        >
          {phase.kind === 'sending' ? 'Sending…' : 'Send me the confirm link'}
        </button>
      </div>
      {phase.kind === 'error' ? (
        <p role="alert" className="text-sm text-ink-muted">
          {phase.message}
        </p>
      ) : null}
    </form>
  )
}
