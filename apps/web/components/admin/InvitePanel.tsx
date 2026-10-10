'use client'

/**
 * InvitePanel — mint a seat invitation and hand over the link.
 *
 * Tries the server route first (which is where the seat cap is really
 * enforced, and where email delivery would be wired). If that route has no
 * data to work with — the usual case in local development, where the org only
 * exists in this browser's localStorage — it falls back to the store so the
 * flow is still demonstrable end to end.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { addMember, createInviteRecord, isSeatLimitError, storageMode } from '@/lib/orgs/store'
import {
  buildInviteRecord,
  buildInviteUrl,
  isPlausibleEmail,
  mintInviteToken,
} from '@/lib/orgs/invites'
import type { OrgRole } from '@/lib/orgs/types'
import { authFetch } from '@/lib/authFetch'

export interface InvitePanelProps {
  orgId: string
  onInvited?: () => void
}

const ROLES: OrgRole[] = ['member', 'admin', 'owner']

interface SeatFullState {
  message: string
  seatsUsed: number
  seatsTotal: number | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export default function InvitePanel({ orgId, onInvited }: InvitePanelProps) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<OrgRole>('member')
  const [sending, setSending] = useState(false)
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [seatFull, setSeatFull] = useState<SeatFullState | null>(null)
  const [copied, setCopied] = useState(false)

  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current)
    }
  }, [])

  /** Local path: hold the seat and mint the token in this browser. */
  const inviteLocally = useCallback(
    async (address: string): Promise<string> => {
      await addMember(orgId, address, role, 'invited')
      // SECURITY FIX (audit finding INV-1): the same random-and-hashed token
      // the server mints. The old local path called makeInviteToken(), which
      // encoded the org and email reversibly — a link anyone could forge. Only
      // the hash is written to localStorage here; the raw token goes into the
      // URL below and nowhere else.
      const { token, tokenHash } = await mintInviteToken()
      await createInviteRecord(buildInviteRecord(orgId, address, role, tokenHash))
      return buildInviteUrl(token)
    },
    [orgId, role]
  )

  const submit = useCallback(async () => {
    const address = email.trim().toLowerCase()
    setError(null)
    setSeatFull(null)
    setUrl(null)

    if (!isPlausibleEmail(address)) {
      setError('Enter a valid email address.')
      return
    }

    setSending(true)
    try {
      let link: string | null = null

      // The server route only has data when Supabase is configured; in local
      // mode there is nothing for it to find, so skip straight to the store.
      if (storageMode() === 'supabase') {
        // SECURITY (audit finding ORG-1): the route now requires an
        // owner/admin seat in this org, proved by the caller's access token.
        const response = await authFetch('/api/orgs/invite', {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ orgId, email: address, role }),
        })
        const body: unknown = await response.json().catch(() => null)

        if (response.status === 409) {
          const record = isRecord(body) ? body : {}
          setSeatFull({
            message:
              typeof record.error === 'string'
                ? record.error
                : 'Every seat on this licence is in use.',
            seatsUsed: typeof record.seatsUsed === 'number' ? record.seatsUsed : 0,
            seatsTotal: typeof record.seatsTotal === 'number' ? record.seatsTotal : null,
          })
          return
        }

        if (response.ok && isRecord(body) && typeof body.url === 'string') {
          link = body.url
        }
      }

      if (!link) link = await inviteLocally(address)

      setUrl(link)
      setEmail('')
      onInvited?.()
    } catch (err) {
      if (isSeatLimitError(err)) {
        setSeatFull({
          message: err.message,
          seatsUsed: err.seatsUsed,
          seatsTotal: Number.isFinite(err.seatsTotal) ? err.seatsTotal : null,
        })
      } else {
        setError('Could not create that invite. Try again in a moment.')
      }
    } finally {
      setSending(false)
    }
  }, [email, orgId, role, inviteLocally, onInvited])

  const copy = useCallback(async () => {
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      if (copyTimer.current) clearTimeout(copyTimer.current)
      copyTimer.current = setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard access can be denied outright — the link is on screen anyway.
      setError('Clipboard access was blocked. Select the link above and copy it manually.')
    }
  }, [url])

  return (
    <div className="space-y-4">
      <div className="card p-5">
        <span className="section-label">Invite</span>
        <h3 className="mt-1 text-base font-semibold text-ink">Add someone to this licence</h3>
        <p className="section-desc mt-1">
          The seat is held as soon as the invite is created, and released if you remove it.
        </p>

        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            aria-label="Email address to invite"
            placeholder="colleague@university.edu"
            className="focus-ring flex-1 rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink placeholder:text-ink-muted"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit()
            }}
            disabled={sending}
          />
          <select
            aria-label="Role for the invited member"
            className="focus-ring rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink-secondary"
            value={role}
            onChange={(e) => setRole(e.target.value as OrgRole)}
            disabled={sending}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn-primary focus-ring"
            onClick={() => void submit()}
            disabled={sending}
          >
            {sending ? 'Creating…' : 'Send invite'}
          </button>
        </div>

        {error ? (
          <p className="mt-3 rounded-card border border-q-rose/40 bg-q-rose/10 p-3 text-sm text-q-rose-text">
            {error}
          </p>
        ) : null}

        {seatFull ? (
          <div className="mt-3 rounded-card border border-q-rose/40 bg-q-rose/10 p-3 text-sm text-q-rose-text">
            <p className="font-semibold">{seatFull.message}</p>
            <p className="mt-1 text-ink-secondary">
              {seatFull.seatsUsed}
              {seatFull.seatsTotal === null ? '' : ` of ${seatFull.seatsTotal}`} seats are in use.
              Suspend or remove a member to free one up, or move to a larger plan.
            </p>
            <a href="/pricing" className="btn-primary focus-ring mt-3">
              See plans
            </a>
          </div>
        ) : null}

        {url ? (
          <div className="mt-4">
            <p className="text-xs font-semibold uppercase tracking-[0.09em] text-ink-muted">
              Invite link
            </p>
            <div className="code-block mt-2 whitespace-pre-wrap break-all">{url}</div>
            <button
              type="button"
              className="btn-ghost focus-ring mt-2 text-xs"
              onClick={() => void copy()}
            >
              {copied ? 'Copied ✓' : 'Copy link'}
            </button>
          </div>
        ) : null}
      </div>

      {/* Be honest about what this environment does and does not do. */}
      <div className="rounded-card border border-q-amber/40 bg-q-amber/10 p-4 text-sm text-q-amber-text">
        <p className="font-semibold">No email is sent from this environment.</p>
        <p className="mt-1 text-ink-secondary">
          Invite delivery is not wired up here, so copy the link above and share it however
          you normally reach your cohort. Connecting Resend, or switching to Supabase Auth&rsquo;s
          own invite email, is a single call in{' '}
          <code className="font-mono text-q-amber-text">app/api/orgs/invite/route.ts</code> — the
          spot is marked in the file.
        </p>
      </div>
    </div>
  )
}

export { InvitePanel }
