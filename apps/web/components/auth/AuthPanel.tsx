'use client'

/**
 * AuthPanel — accounts when they exist, a calm explanation when they don't.
 *
 * The default state (no Supabase project configured) is deliberately not an
 * error: saving works locally in this browser, and the panel simply explains
 * how to switch on cross-device sync.
 *
 * `?next=/some/path` on the page URL is honoured: once the visitor is signed
 * in (by the email link, which carries `next` back here, or by the code) they
 * are sent back to where they came from.
 */

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { safeNextPath, useSession } from '@/components/auth/useSession'

const AMBER = { color: 'var(--q-amber-text)', background: 'rgb(var(--q-amber-rgb) / 0.14)' }
const TEAL = { color: 'var(--q-teal-text)', background: 'rgb(var(--q-teal-rgb) / 0.14)' }

/** Seconds before "Resend" is offered again — Supabase rate-limits OTP mail. */
const RESEND_COOLDOWN_S = 60

/** `?next=` on the current URL, validated, or null. */
function nextFromUrl(): string | null {
  if (typeof window === 'undefined') return null
  return safeNextPath(new URLSearchParams(window.location.search).get('next'))
}

export default function AuthPanel({ className = '' }: { className?: string }) {
  const { user, loading, configured, signIn, verifyCode, signOut, authError, clearAuthError } =
    useSession()
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [sending, setSending] = useState(false)
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const [error, setError] = useState<string | null>(null)
  // Read from the URL on demand, never during the first render: the page is
  // statically rendered, so the query string is not known on the server.
  // (`user` is always null on that first render, which is the only place the
  // signed-in branch below reads it.)
  const next = user ? nextFromUrl() : null

  // Signed in (by the email link landing here, by the code, or in another
  // tab) with somewhere to go back to — go there. Without this, every "Sign in
  // to …" prompt in the app stranded the user on /account.
  useEffect(() => {
    if (user && next) router.replace(next)
  }, [user, next, router])

  useEffect(() => {
    if (cooldown <= 0) return
    const t = window.setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => window.clearTimeout(t)
  }, [cooldown])

  const send = useCallback(
    async (address: string) => {
      setSending(true)
      setError(null)
      clearAuthError()
      const result = await signIn(address, nextFromUrl())
      setSending(false)
      if (result.error) {
        setError(result.error)
        return
      }
      setSentTo(address.trim())
      setCode('')
      setCooldown(RESEND_COOLDOWN_S)
    },
    [signIn, clearAuthError]
  )

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      void send(email)
    },
    [email, send]
  )

  const handleCode = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (!sentTo) return
      setVerifying(true)
      setError(null)
      const result = await verifyCode(sentTo, code)
      setVerifying(false)
      if (result.error) setError(result.error)
      // Success needs no handling: the session store updates and this panel
      // re-renders as signed in (and follows `next`, above).
    },
    [sentTo, code, verifyCode]
  )

  if (!configured) {
    return (
      <section className={`card p-5 ${className}`}>
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="text-[13px] font-semibold text-ink-secondary">Your circuits</h2>
          <span className="pill" style={AMBER}>
            local storage
          </span>
        </div>
        <p className="mt-2 text-sm text-ink-secondary">
          Everything you save is stored in this browser, so you can build and reload circuits
          right away — no account needed.
        </p>
        <p className="mt-2 text-[13px] text-ink-muted">
          Want accounts and cross-device sync? Add{' '}
          <code className="font-mono text-q-violet-text">NEXT_PUBLIC_SUPABASE_URL</code> and{' '}
          <code className="font-mono text-q-violet-text">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to{' '}
          <code className="font-mono text-q-violet-text">apps/web/.env.local</code> — see{' '}
          <code className="font-mono text-q-violet-text">supabase/README.md</code>.
        </p>
      </section>
    )
  }

  if (loading) {
    return (
      <section className={`card p-5 ${className}`}>
        <p className="text-sm text-ink-muted">Checking your session…</p>
      </section>
    )
  }

  if (user) {
    return (
      <section className={`card flex flex-wrap items-center justify-between gap-3 p-5 ${className}`}>
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-sm text-ink">{user.email ?? 'Signed in'}</span>
          <span className="pill" style={TEAL}>
            synced
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {next ? (
            <p className="text-[13px] text-ink-muted" role="status">
              Signed in — taking you back…
            </p>
          ) : null}
          <button type="button" className="btn-ghost focus-ring" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className={`card p-5 ${className}`}>
      <h2 className="text-[13px] font-semibold text-ink-secondary">Sign in or create an account</h2>
      <p className="mt-1 text-[13px] text-ink-muted">
        We email you a magic link — no password to remember. New here? The same link creates your
        account.
      </p>
      {sentTo ? (
        <div className="mt-3">
          {/*
            A11Y (WCAG 4.1.3): this appears after an async round trip while
            focus is still on the submit button, so it must announce itself —
            otherwise a screen-reader user pressed "Send magic link" and heard
            silence.
          */}
          <p className="text-[13px] text-q-teal-text" role="status">
            Sent to <strong className="font-semibold">{sentTo}</strong>. Open the link in that
            email to sign in.
          </p>
          <form className="mt-3 flex flex-wrap items-center gap-2" onSubmit={handleCode}>
            <label htmlFor="auth-code" className="w-full text-[12px] text-ink-muted">
              Reading the email on another device, or the link says it expired? Enter the code from
              the email instead:
            </label>
            <input
              id="auth-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123456"
              maxLength={12}
              className="focus-ring w-36 rounded-lg border border-line bg-surface-2 px-3 py-2 font-mono text-sm tracking-widest text-ink placeholder:text-ink-muted"
            />
            <button type="submit" className="btn-ghost focus-ring" disabled={verifying || !code.trim()}>
              {verifying ? 'Checking…' : 'Sign in with code'}
            </button>
          </form>
          <div className="mt-3 flex flex-wrap gap-4 text-[12px]">
            <button
              type="button"
              className="focus-ring text-q-violet-text underline underline-offset-2 disabled:text-ink-muted disabled:no-underline"
              disabled={sending || cooldown > 0}
              onClick={() => void send(sentTo)}
            >
              {sending ? 'Sending…' : cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend email'}
            </button>
            <button
              type="button"
              className="focus-ring text-q-violet-text underline underline-offset-2"
              onClick={() => {
                setSentTo(null)
                setError(null)
              }}
            >
              Use a different email
            </button>
          </div>
        </div>
      ) : (
        <form className="mt-3 flex flex-wrap items-center gap-2" onSubmit={handleSubmit}>
          <input
            type="email"
            value={email}
            required
            autoComplete="email"
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            aria-label="Email address"
            className="focus-ring min-w-[220px] flex-1 rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink placeholder:text-ink-muted"
          />
          <button type="submit" className="btn-primary focus-ring" disabled={sending}>
            {sending ? 'Sending…' : 'Send magic link'}
          </button>
        </form>
      )}
      {/* A11Y (WCAG 3.3.1): an error in a sign-in form is worth interrupting for. */}
      {error ? (
        <p className="mt-2 text-[13px] text-q-rose-text" role="alert">
          {error}
        </p>
      ) : null}
      {authError && !error ? (
        <p className="mt-2 text-[13px] text-q-rose-text" role="alert">
          {authError}
        </p>
      ) : null}
    </section>
  )
}
