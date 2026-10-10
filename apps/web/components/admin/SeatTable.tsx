'use client'

/**
 * SeatTable — who holds a seat, and the controls to change that.
 *
 * Reads and writes through lib/orgs/store.ts rather than fetching the API, so
 * the console is fully usable with nothing but localStorage. The store picks
 * Supabase when it is configured; the API routes enforce the same rules again
 * for any caller that is not this component.
 *
 * Nothing in here throws: every failure becomes an inline message.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  isSeatLimitError,
  listMembers,
  removeMember,
  seatUsage,
  setMemberRole,
  setMemberStatus,
  type SeatUsage,
} from '@/lib/orgs/store'
import type { OrgMember, OrgMemberStatus, OrgRole } from '@/lib/orgs/types'
import { relativeTime } from '@/lib/circuit-store'
import { formatLimit } from '@/lib/plans'

export interface SeatTableProps {
  orgId: string
  canManage: boolean
}

const ROLE_PILL: Record<OrgRole, string> = {
  owner: 'border-q-violet/40 bg-q-violet/10 text-q-violet-text',
  admin: 'border-q-teal/40 bg-q-teal/10 text-q-teal-text',
  member: 'border-line text-ink-muted',
}

const STATUS_PILL: Record<OrgMemberStatus, string> = {
  active: 'border-q-teal/40 bg-q-teal/10 text-q-teal-text',
  invited: 'border-q-amber/40 bg-q-amber/10 text-q-amber-text',
  suspended: 'border-q-rose/40 bg-q-rose/10 text-q-rose-text',
}

const ROLES: OrgRole[] = ['owner', 'admin', 'member']

function formatJoined(iso: string): string {
  const at = Date.parse(iso)
  if (!Number.isFinite(at)) return '—'
  return new Date(at).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

/** Bar hue: violet normally, amber past 80%, rose when the licence is full. */
function meterHue(used: number, total: number): string {
  if (!Number.isFinite(total) || total <= 0) return 'bg-q-violet'
  const ratio = used / total
  if (ratio >= 1) return 'bg-q-rose'
  if (ratio > 0.8) return 'bg-q-amber'
  return 'bg-q-violet'
}

export default function SeatTable({ orgId, canManage }: SeatTableProps) {
  const [members, setMembers] = useState<OrgMember[]>([])
  const [seats, setSeats] = useState<SeatUsage>({ used: 0, total: 0, available: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)

  // Confirm-on-second-click reverts after 3s; the timer is cleared on unmount.
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const [nextMembers, nextSeats] = await Promise.all([
        listMembers(orgId),
        seatUsage(orgId),
      ])
      setMembers(nextMembers)
      setSeats(nextSeats)
    } catch {
      setError('Could not load the seat list. Refresh to try again.')
    } finally {
      setLoading(false)
    }
  }, [orgId])

  useEffect(() => {
    setLoading(true)
    void load()
  }, [load])

  useEffect(() => {
    return () => {
      if (confirmTimer.current) clearTimeout(confirmTimer.current)
    }
  }, [])

  const ownerCount = useMemo(
    () => members.filter((m) => m.role === 'owner' && m.status !== 'suspended').length,
    [members]
  )

  const lastOwnerMessage =
    'That is the only owner. Promote someone else to owner first — otherwise ' +
    'nobody can manage the licence.'

  const changeRole = useCallback(
    async (member: OrgMember, role: OrgRole) => {
      if (role === member.role) return
      if (member.role === 'owner' && ownerCount <= 1 && role !== 'owner') {
        setError(lastOwnerMessage)
        return
      }
      setBusyId(member.id)
      setError(null)
      try {
        await setMemberRole(orgId, member.id, role)
        await load()
      } catch {
        setError('Could not change that role. Try again in a moment.')
      } finally {
        setBusyId(null)
      }
    },
    [orgId, ownerCount, load]
  )

  const toggleSuspend = useCallback(
    async (member: OrgMember) => {
      const next: OrgMemberStatus = member.status === 'suspended' ? 'active' : 'suspended'
      if (next === 'suspended' && member.role === 'owner' && ownerCount <= 1) {
        setError(lastOwnerMessage)
        return
      }
      setBusyId(member.id)
      setError(null)
      try {
        await setMemberStatus(orgId, member.id, next)
        await load()
      } catch (err) {
        setError(
          isSeatLimitError(err)
            ? err.message
            : 'Could not change that status. Try again in a moment.'
        )
      } finally {
        setBusyId(null)
      }
    },
    [orgId, ownerCount, load]
  )

  const askRemove = useCallback((memberId: string) => {
    setConfirmId(memberId)
    if (confirmTimer.current) clearTimeout(confirmTimer.current)
    confirmTimer.current = setTimeout(() => setConfirmId(null), 3000)
  }, [])

  const doRemove = useCallback(
    async (member: OrgMember) => {
      if (member.role === 'owner' && ownerCount <= 1) {
        setConfirmId(null)
        setError(lastOwnerMessage)
        return
      }
      setConfirmId(null)
      setBusyId(member.id)
      setError(null)
      try {
        await removeMember(orgId, member.id)
        await load()
      } catch {
        setError('Could not remove that member. Try again in a moment.')
      } finally {
        setBusyId(null)
      }
    },
    [orgId, ownerCount, load]
  )

  const total = seats.total
  const percent = Number.isFinite(total) && total > 0 ? Math.min(100, (seats.used / total) * 100) : 0

  return (
    <div className="space-y-4">
      {/* ── Seat meter ─────────────────────────────────────── */}
      <div className="card p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="section-label">Seats</span>
          <span className="text-sm text-ink-secondary">
            <span className="font-semibold text-ink">{formatLimit(seats.used)}</span>
            {' of '}
            <span className="font-semibold text-ink">{formatLimit(total)}</span>
            {' in use'}
            {Number.isFinite(seats.available) ? (
              <span className="text-ink-muted"> · {formatLimit(seats.available)} free</span>
            ) : null}
          </span>
        </div>
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
          <div
            className={`h-full rounded-full transition-all duration-300 ${meterHue(seats.used, total)}`}
            style={{ width: Number.isFinite(total) ? `${percent}%` : '12%' }}
          />
        </div>
        {!Number.isFinite(total) ? (
          <p className="mt-2 text-xs text-ink-muted">
            The University plan has no seat ceiling — the bar is illustrative only.
          </p>
        ) : null}
      </div>

      {error ? (
        <div className="rounded-card border border-q-rose/40 bg-q-rose/10 p-3 text-sm text-q-rose-text">
          {error}
        </div>
      ) : null}

      {/* ── Table ──────────────────────────────────────────── */}
      {loading ? (
        <div className="card p-8 text-center text-sm text-ink-secondary">Loading seats…</div>
      ) : members.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-sm font-semibold text-ink">No one holds a seat yet</p>
          <p className="mt-1 text-sm text-ink-secondary">
            Invite your first colleague from the Invites tab and they will appear here.
          </p>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-line text-[11px] uppercase tracking-[0.09em] text-ink-muted">
                <th className="px-4 py-3 font-semibold">Member</th>
                <th className="px-4 py-3 font-semibold">Role</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Joined</th>
                <th className="px-4 py-3 font-semibold">Last active</th>
                {canManage ? <th className="px-4 py-3 text-right font-semibold">Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {members.map((member) => {
                const busy = busyId === member.id
                return (
                  <tr key={member.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-3 text-ink">{member.email}</td>
                    <td className="px-4 py-3">
                      <span className={`pill ${ROLE_PILL[member.role]}`}>{member.role}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`pill ${STATUS_PILL[member.status]}`}>{member.status}</span>
                    </td>
                    <td className="px-4 py-3 text-ink-secondary">{formatJoined(member.joinedAt)}</td>
                    <td className="px-4 py-3 text-ink-secondary">
                      {member.lastActiveAt ? relativeTime(member.lastActiveAt) : 'never'}
                    </td>
                    {canManage ? (
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <select
                            aria-label={`Role for ${member.email}`}
                            className="focus-ring rounded-lg border border-line bg-surface-2 px-2 py-1 text-xs text-ink-secondary"
                            value={member.role}
                            disabled={busy}
                            onChange={(e) => void changeRole(member, e.target.value as OrgRole)}
                          >
                            {ROLES.map((role) => (
                              <option key={role} value={role}>
                                {role}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            className="btn-ghost focus-ring px-2 py-1 text-xs"
                            disabled={busy}
                            onClick={() => void toggleSuspend(member)}
                          >
                            {member.status === 'suspended' ? 'Reactivate' : 'Suspend'}
                          </button>
                          <button
                            type="button"
                            className={`btn-ghost focus-ring px-2 py-1 text-xs ${
                              confirmId === member.id
                                ? 'border-q-rose/50 text-q-rose-text'
                                : ''
                            }`}
                            disabled={busy}
                            onClick={() =>
                              confirmId === member.id ? void doRemove(member) : askRemove(member.id)
                            }
                          >
                            {confirmId === member.id ? 'Sure?' : 'Remove'}
                          </button>
                        </div>
                      </td>
                    ) : null}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {!canManage ? (
        <p className="text-xs text-ink-muted">
          You are viewing this licence as a member — only owners and admins can change seats.
        </p>
      ) : null}
    </div>
  )
}

export { SeatTable }
