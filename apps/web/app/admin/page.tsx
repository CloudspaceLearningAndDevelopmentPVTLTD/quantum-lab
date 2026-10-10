'use client'

/**
 * /admin — the organisation console.
 *
 * Three states, in order of how often they are hit:
 *   1. LOCKED — the visitor's entitlement has no 'team.admin'. In local mode a
 *      "preview with demo data" escape hatch is offered, because otherwise the
 *      entire feature is invisible during development.
 *   2. EMPTY — entitled, but no organisation yet. Offer to create one.
 *   3. CONSOLE — switcher, then tabs for Seats / Invites / Progress.
 *
 * Plus the invite-acceptance card, shown when the URL carries ?invite=<token>.
 * Everything degrades to localStorage; nothing here can throw a render error.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSession } from '@/components/auth/useSession'
import { useEntitlement } from '@/components/billing/useEntitlement'
import { hasFeature, PLAN_BY_ID, type PlanId } from '@/lib/plans'
import {
  addMember,
  createOrg,
  getInviteByToken,
  listMembers,
  listOrgs,
  markInviteAccepted,
  setMemberStatus,
  storageMode,
} from '@/lib/orgs/store'
import { isInviteToken, isInviteUsable } from '@/lib/orgs/invites'
import { canManageSeats, type Org, type OrgInvite, type OrgRole } from '@/lib/orgs/types'
import { authFetch } from '@/lib/authFetch'
import { isSupabaseConfigured } from '@/lib/supabase'
import { signInHref } from '@/components/auth/AccountButton'
import SeatTable from '@/components/admin/SeatTable'
import InvitePanel from '@/components/admin/InvitePanel'
import CohortProgress from '@/components/admin/CohortProgress'
import AssignedWork from '@/components/admin/AssignedWork'

type TabId = 'coursework' | 'seats' | 'invites' | 'progress'

/**
 * "Coursework" is first, and it is the tab a `member` lands on.
 *
 * A learner reaches this page because the invite link they were sent points at
 * it — `/admin?invite=<token>` — so this is where they already arrive, seat in
 * hand. Giving them the seat table as a landing screen was the old behaviour and
 * told them nothing they could act on.
 *
 * A friendlier URL for a learner (`/cohort`, in the site navigation) belongs to
 * whoever owns app/layout.tsx and components/ui/SiteNav.tsx; it is written up as
 * an open item in docs/CLASSROOM.md rather than reached into from here.
 */
const TABS: { id: TabId; label: string }[] = [
  { id: 'coursework', label: 'Coursework' },
  { id: 'seats', label: 'Seats' },
  { id: 'invites', label: 'Invites' },
  { id: 'progress', label: 'Progress' },
]

const SEATED_PLANS: PlanId[] = ['team', 'edu']

interface PendingInvite {
  token: string
  orgId: string
  email: string
  expired: boolean
}

export default function AdminPage() {
  const { user, loading: sessionLoading } = useSession()
  const { entitlement, loading: entitlementLoading, refresh: refreshEntitlement } = useEntitlement()

  const [orgs, setOrgs] = useState<Org[]>([])
  const [orgId, setOrgId] = useState<string | null>(null)
  const [myRole, setMyRole] = useState<OrgRole>('owner')
  const [loadingOrgs, setLoadingOrgs] = useState(true)
  const [tab, setTab] = useState<TabId>('coursework')
  const [preview, setPreview] = useState(false)
  const [mode, setMode] = useState<'supabase' | 'local'>('local')
  const [error, setError] = useState<string | null>(null)
  const [reloadNonce, setReloadNonce] = useState(0)

  // Create-org form
  const [newName, setNewName] = useState('')
  const [chosenPlan, setNewPlan] = useState<PlanId>('team')
  // With a backend, a new org must be on the plan the caller personally holds
  // (the database refuses anything else), so that plan is the only choice.
  const newPlan: PlanId =
    isSupabaseConfigured && SEATED_PLANS.includes(entitlement.planId)
      ? entitlement.planId
      : chosenPlan
  const [creating, setCreating] = useState(false)

  // Invite acceptance
  const [pending, setPending] = useState<PendingInvite | null>(null)
  const [inviteNote, setInviteNote] = useState<string | null>(null)

  const userId = user?.id ?? null
  const userEmail = user?.email ?? null

  const unlocked = hasFeature(entitlement, 'team.admin') || preview

  // ── Load organisations ──────────────────────────────────────
  const loadOrgs = useCallback(async () => {
    setError(null)
    try {
      const found = await listOrgs(userId)
      setOrgs(found)
      setMode(storageMode())
      setOrgId((current) => {
        if (current && found.some((o) => o.id === current)) return current
        return found.length > 0 ? found[0].id : null
      })
    } catch {
      setError('Could not load your organisations. Refresh to try again.')
    } finally {
      setLoadingOrgs(false)
    }
  }, [userId])

  useEffect(() => {
    if (!unlocked) return
    setLoadingOrgs(true)
    void loadOrgs()
  }, [unlocked, loadOrgs, reloadNonce])

  // ── Resolve my role in the selected org ─────────────────────
  useEffect(() => {
    if (!orgId) return
    let active = true
    void (async () => {
      try {
        const members = await listMembers(orgId)
        if (!active) return
        const mine = members.find(
          (m) =>
            (userId !== null && m.userId === userId) ||
            (userEmail !== null && m.email.toLowerCase() === userEmail.toLowerCase())
        )
        // With no auth backend there is no "me" to find, so local mode grants
        // owner-level controls — the data never leaves this browser anyway.
        setMyRole(mine ? mine.role : storageMode() === 'local' ? 'owner' : 'member')
      } catch {
        if (active) setMyRole('member')
      }
    })()
    return () => {
      active = false
    }
  }, [orgId, userId, userEmail, reloadNonce])

  // ── ?invite=<token> ─────────────────────────────────────────
  useEffect(() => {
    // SSR guard: there is no location during server rendering.
    if (typeof window === 'undefined') return
    let token = ''
    try {
      token = new URLSearchParams(window.location.search).get('invite')?.trim() ?? ''
    } catch {
      token = ''
    }
    if (!token) return
    if (!isInviteToken(token)) {
      setInviteNote('That invite link is not valid. Ask an admin to send a new one.')
      return
    }

    // SECURITY FIX (audit finding INV-1): the token is opaque now, so the org
    // and the email are LOOKED UP, not decoded out of the URL. That is the fix:
    // the old code trusted whatever the link claimed, and the link was
    // forgeable. Resolution happens server-side (or, with no backend, against
    // this browser's own store, where the row was written when it was minted).
    let cancelled = false
    void (async () => {
      try {
        const response = await fetch(`/api/orgs/invite?token=${encodeURIComponent(token)}`, {
          headers: { accept: 'application/json' },
          cache: 'no-store',
        })
        const body: unknown = await response.json().catch(() => null)
        const invite =
          body && typeof body === 'object' && 'invite' in body
            ? (body as { invite?: OrgInvite }).invite
            : undefined
        if (invite) {
          if (cancelled) return
          setPending({
            token,
            orgId: invite.orgId,
            email: invite.email,
            expired: !isInviteUsable(invite),
          })
          return
        }
      } catch {
        // Fall through to the local store: in a zero-config deployment the
        // route has nothing to read and this browser does.
      }

      const local = await getInviteByToken(token).catch(() => null)
      if (cancelled) return
      if (!local) {
        setInviteNote('That invite link is not valid. Ask an admin to send a new one.')
        return
      }
      setPending({
        token,
        orgId: local.orgId,
        email: local.email,
        expired: !isInviteUsable(local),
      })
    })()

    return () => {
      cancelled = true
    }
  }, [])

  const acceptInvite = useCallback(async () => {
    if (!pending || pending.expired) return
    setInviteNote(null)
    try {
      // SECURITY FIX (audit finding INV-1): with a backend, the claim goes
      // through the server route, which re-checks the token, the expiry, single
      // use, and that the SIGNED-IN caller's verified email is the invited one.
      // None of that can be enforced here — this is the browser.
      //
      // Branch on whether a backend EXISTS, not on storageMode(): that is only
      // set once listOrgs() has run, which never happens for an invitee
      // without the team.admin feature — so every real invitee was sent down
      // the local path and told "the licence may be full".
      if (isSupabaseConfigured) {
        const response = await authFetch('/api/orgs/invite/accept', {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ token: pending.token }),
        })
        if (!response.ok) {
          const body: unknown = await response.json().catch(() => null)
          const message =
            body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string'
              ? (body as { error: string }).error
              : 'Could not claim that seat.'
          setInviteNote(message)
          return
        }
      } else {
        // Local demo mode: the store is this browser's localStorage, so the
        // "seat" and the invite are both things this browser already owns.
        const member = await addMember(pending.orgId, pending.email, 'member', 'active')
        if (member.status !== 'active') {
          await setMemberStatus(pending.orgId, member.id, 'active')
        }
        const local = await getInviteByToken(pending.token).catch(() => null)
        // Single use applies locally too, so a link cannot be replayed.
        if (local) await markInviteAccepted(local.id)
      }

      setPending(null)
      setOrgId(pending.orgId)
      // With a backend the seat is real: re-read the entitlement so the
      // console unlocks from the plan the seat grants. Locally there is no
      // entitlement to re-read, so the demo console is opened directly.
      if (isSupabaseConfigured) refreshEntitlement()
      else setPreview(true)
      setInviteNote(`Seat claimed for ${pending.email}.`)
      setReloadNonce((n) => n + 1)
      try {
        window.history.replaceState(null, '', '/admin')
      } catch {
        // A blocked history write is cosmetic only.
      }
    } catch {
      setInviteNote('Could not claim that seat — the licence may be full.')
    }
  }, [pending, refreshEntitlement])

  const create = useCallback(async () => {
    const name = newName.trim()
    if (!name) {
      setError('Give the organisation a name first.')
      return
    }
    setCreating(true)
    setError(null)
    try {
      const org = await createOrg({
        name,
        planId: newPlan,
        ownerId: userId ?? 'local-owner',
        ownerEmail: userEmail ?? 'you@example.edu',
      })
      setNewName('')
      setOrgId(org.id)
      setReloadNonce((n) => n + 1)
    } catch {
      setError('Could not create that organisation. Try again in a moment.')
    } finally {
      setCreating(false)
    }
  }, [newName, newPlan, userId, userEmail])

  const activeOrg = useMemo(() => orgs.find((o) => o.id === orgId) ?? null, [orgs, orgId])
  const canManage = canManageSeats(myRole)

  // ── Header ──────────────────────────────────────────────────
  const header = (
    <header>
      <p className="section-label">Admin</p>
      <h1 className="section-title mt-1">Your organisation</h1>
      <p className="section-desc mt-2 max-w-2xl">
        Seats, invitations and cohort progress for a Team or University licence.
      </p>
    </header>
  )

  const inviteCard = pending ? (
    <div className="card p-5">
      <span className="section-label">Invitation</span>
      <h2 className="mt-1 text-base font-semibold text-ink">
        You have been invited to a Qubit16 licence
      </h2>
      <p className="section-desc mt-1">
        The seat is reserved for <span className="text-ink">{pending.email}</span>.
      </p>
      {pending.expired ? (
        <p className="mt-3 rounded-card border border-q-amber/40 bg-q-amber/10 p-3 text-sm text-q-amber-text">
          This invitation has expired. Ask an admin to send a fresh link.
        </p>
      ) : isSupabaseConfigured && !user ? (
        // The accept route checks that the SIGNED-IN caller's verified email
        // is the invited one, so a signed-out invitee must sign in first —
        // and come straight back here, invite token intact.
        sessionLoading ? null : (
          <a
            href={signInHref(`/admin?invite=${encodeURIComponent(pending.token)}`)}
            className="btn-primary focus-ring mt-4 inline-flex"
          >
            Sign in as {pending.email} to accept
          </a>
        )
      ) : (
        <button type="button" className="btn-primary focus-ring mt-4" onClick={() => void acceptInvite()}>
          Accept invitation
        </button>
      )}
    </div>
  ) : null

  const note = inviteNote ? (
    <p className="rounded-card border border-line bg-surface-2 p-3 text-sm text-ink-secondary">
      {inviteNote}
    </p>
  ) : null

  // ── 1. Locked ───────────────────────────────────────────────
  if (!unlocked) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-12 space-y-6">
        {header}
        {note}
        {inviteCard}
        <div className="card p-6">
          <h2 className="text-base font-semibold text-ink">Seat management is a Team feature</h2>
          <p className="section-desc mt-2 max-w-xl">
            The admin console — seats, invitations, roles and cohort progress — is part of the
            Team plan (10 seats) and the University plan (unlimited seats across a department).
            Your current plan is{' '}
            <span className="text-ink">{PLAN_BY_ID[entitlement.planId].name}</span>.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <a href="/pricing" className="btn-primary focus-ring">
              See Team and University plans
            </a>
            {/* Local-only escape hatch: without it the whole feature is
                invisible in development, where nobody has an entitlement. */}
            {/* Only when there is NO backend. With one, `mode` is still
                'local' before listOrgs() has run, and this button used to
                open the real console — whose "create organisation" wrote to
                the live database. */}
            {!isSupabaseConfigured && !entitlementLoading ? (
              <button
                type="button"
                className="btn-ghost focus-ring"
                onClick={() => setPreview(true)}
              >
                Preview with demo data
              </button>
            ) : null}
          </div>
          {!isSupabaseConfigured ? (
            <p className="mt-4 text-xs text-ink-muted">
              No backend is configured, so the preview runs entirely on data stored in this
              browser.
            </p>
          ) : null}
        </div>
      </div>
    )
  }

  // ── 2 & 3. Console ──────────────────────────────────────────
  return (
    <div className="mx-auto max-w-5xl px-4 py-12 space-y-6">
      {header}
      {note}
      {inviteCard}

      {error ? (
        <div className="rounded-card border border-q-rose/40 bg-q-rose/10 p-3 text-sm text-q-rose-text">
          {error}
        </div>
      ) : null}

      {loadingOrgs ? (
        <div className="card p-8 text-center text-sm text-ink-secondary">
          Loading organisations…
        </div>
      ) : orgs.length === 0 ? (
        <div className="card p-6">
          <h2 className="text-base font-semibold text-ink">Create an organisation</h2>
          <p className="section-desc mt-1 max-w-xl">
            An organisation holds the seats on your licence. You take the first seat as owner.
          </p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <input
              type="text"
              aria-label="Organisation name"
              placeholder="Department of Physics"
              className="focus-ring flex-1 rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink placeholder:text-ink-muted"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              disabled={creating}
            />
            <select
              aria-label="Plan"
              className="focus-ring rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink-secondary"
              value={newPlan}
              onChange={(e) => setNewPlan(e.target.value as PlanId)}
              disabled={creating}
            >
              {SEATED_PLANS.filter(
                // With a backend, the database only accepts an org on the
                // plan you personally subscribe to.
                (id) => !isSupabaseConfigured || id === entitlement.planId
              ).map((id) => (
                <option key={id} value={id}>
                  {PLAN_BY_ID[id].name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn-primary focus-ring"
              onClick={() => void create()}
              disabled={creating}
            >
              {creating ? 'Creating…' : 'Create organisation'}
            </button>
          </div>
        </div>
      ) : (
        <>
          {orgs.length > 1 ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-ink-muted">Organisation</span>
              {orgs.map((org) => (
                <button
                  key={org.id}
                  type="button"
                  className={`focus-ring rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                    org.id === orgId
                      ? 'border-q-violet/50 bg-q-violet/10 text-q-violet-text'
                      : 'border-line text-ink-secondary hover:text-ink'
                  }`}
                  onClick={() => setOrgId(org.id)}
                >
                  {org.name}
                </button>
              ))}
            </div>
          ) : null}

          {activeOrg ? (
            <div className="card p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <h2 className="text-base font-semibold text-ink">{activeOrg.name}</h2>
                  <p className="text-xs text-ink-muted">
                    {PLAN_BY_ID[activeOrg.planId].name} licence · {activeOrg.slug}
                  </p>
                </div>
                <span className="pill border-line text-ink-muted">
                  {mode === 'supabase' ? 'Synced' : 'This browser only'}
                </span>
              </div>
            </div>
          ) : null}

          <nav className="flex gap-2" aria-label="Admin sections">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`focus-ring rounded-full border px-4 py-1.5 text-xs font-semibold transition-colors ${
                  tab === t.id
                    ? 'border-q-violet/50 bg-q-violet/10 text-q-violet-text'
                    : 'border-line text-ink-secondary hover:text-ink'
                }`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </nav>

          {orgId ? (
            <section>
              {tab === 'coursework' ? (
                <AssignedWork
                  key={`coursework-${orgId}-${reloadNonce}`}
                  orgId={orgId}
                  orgName={activeOrg?.name ?? 'this organisation'}
                />
              ) : null}
              {tab === 'seats' ? (
                <SeatTable key={`seats-${orgId}-${reloadNonce}`} orgId={orgId} canManage={canManage} />
              ) : null}
              {tab === 'invites' ? (
                <InvitePanel
                  orgId={orgId}
                  onInvited={() => setReloadNonce((n) => n + 1)}
                />
              ) : null}
              {tab === 'progress' ? (
                <CohortProgress key={`progress-${orgId}-${reloadNonce}`} orgId={orgId} />
              ) : null}
            </section>
          ) : null}
        </>
      )}
    </div>
  )
}
