'use client'

/**
 * AssignedWork — what a learner owes, and the sharing decision that goes with it.
 *
 * ── The privacy decision, on screen ──────────────────────────
 * This is where the contradiction between "progress never leaves your device"
 * (docs/ANALYTICS.md, /insights) and "cohort progress and usage analytics"
 * (/pricing) is settled, and it is settled in the learner's favour: the list of
 * assignments is visible to them whatever they choose, and their progress goes
 * nowhere until they turn sharing on. The card states, in full sentences, every
 * field that would be sent — those sentences come from SHARED_FIELDS in
 * lib/orgs/progressShare.ts, so there is no second list anywhere that could say
 * something different.
 *
 * Turning sharing off deletes the shared copy. That is done by the server, and
 * a failure to delete is reported as a failure — never as a cheerful "done".
 *
 * The checklist itself is computed LOCALLY from this browser's own progress, so
 * a learner who never opts in still gets the full feature. Opting in changes who
 * else can see it, and nothing else.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSession } from '@/components/auth/useSession'
import { listMembers, storageMode } from '@/lib/orgs/store'
import {
  byDueDate,
  dueState,
  evaluateAssignment,
  type Assignment,
  type ProgressSnapshot,
} from '@/lib/orgs/assignments'
import { NOT_SHARED_NOTE, SHARED_FIELDS, describeSnapshot } from '@/lib/orgs/progressShare'
import { collectSnapshot } from '@/lib/orgs/snapshotClient'
import { describeItem, KIND_LABEL } from '@/lib/orgs/itemLabels'
import {
  STAND_IN_NOTE,
  fetchAssignments,
  fetchConsent,
  setSharing,
  shareSnapshot,
  usingBackend,
} from '@/lib/orgs/classroomClient'

export interface AssignedWorkProps {
  orgId: string
  orgName: string
}

const STATE_STYLE: Record<string, string> = {
  complete: 'border-q-teal/40 bg-q-teal/10 text-q-teal-text',
  overdue: 'border-q-rose/40 bg-q-rose/10 text-q-rose-text',
  'due-soon': 'border-q-amber/40 bg-q-amber/10 text-q-amber-text',
  open: 'border-line text-ink-muted',
}

const STATE_LABEL: Record<string, string> = {
  complete: 'done',
  overdue: 'overdue',
  'due-soon': 'due soon',
  open: 'open',
}

function dueLabel(iso: string): string {
  const at = Date.parse(iso)
  if (!Number.isFinite(at)) return 'no due date'
  return new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export default function AssignedWork({ orgId, orgName }: AssignedWorkProps) {
  const { user } = useSession()
  const userId = user?.id ?? null

  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [snapshot, setSnapshot] = useState<ProgressSnapshot | null>(null)
  const [granted, setGranted] = useState(false)
  const [sharedAt, setSharedAt] = useState<string | null>(null)
  const [seatEmail, setSeatEmail] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  // ── Load: assignments, my consent, and my own progress ─────
  useEffect(() => {
    let active = true
    setLoading(true)
    void (async () => {
      try {
        const [found, consent, mine] = await Promise.all([
          fetchAssignments(orgId),
          fetchConsent(orgId, userId),
          collectSnapshot(),
        ])
        if (!active) return
        setAssignments([...found].sort(byDueDate))
        setGranted(consent.granted)
        setSharedAt(consent.grantedAt)
        setSnapshot(mine)
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Could not load your coursework.')
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [orgId, userId])

  // Which seat is mine? With a backend the server decides and this is only for
  // display; in local mode it is the stand-in described in classroomClient.ts.
  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const members = await listMembers(orgId)
        if (!active) return
        const email = user?.email?.toLowerCase() ?? null
        const mine =
          members.find((m) => (userId !== null && m.userId === userId)) ??
          members.find((m) => email !== null && m.email.toLowerCase() === email) ??
          (usingBackend() ? undefined : members[0])
        setSeatEmail(mine?.email ?? '')
      } catch {
        // Only a label. An empty one is fine.
      }
    })()
    return () => {
      active = false
    }
  }, [orgId, userId, user?.email])

  const push = useCallback(
    async (current: ProgressSnapshot) => {
      const at = await shareSnapshot(orgId, userId, seatEmail || user?.email || '', current)
      setSharedAt(at || new Date().toISOString())
    },
    [orgId, userId, seatEmail, user?.email]
  )

  const turnOn = useCallback(async () => {
    setBusy(true)
    setError(null)
    setNote(null)
    try {
      await setSharing(orgId, userId, true)
      setGranted(true)
      const current = snapshot ?? (await collectSnapshot())
      setSnapshot(current)
      await push(current)
      setNote(`Shared with ${orgName}. You can stop at any time.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not turn sharing on.')
    } finally {
      setBusy(false)
    }
  }, [orgId, userId, snapshot, push, orgName])

  const turnOff = useCallback(async () => {
    setBusy(true)
    setError(null)
    setNote(null)
    try {
      await setSharing(orgId, userId, false)
      setGranted(false)
      setSharedAt(null)
      setNote('Sharing is off, and the copy your instructor could see has been deleted.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not stop sharing.')
    } finally {
      setBusy(false)
    }
  }, [orgId, userId])

  const resend = useCallback(async () => {
    setBusy(true)
    setError(null)
    setNote(null)
    try {
      const current = await collectSnapshot()
      setSnapshot(current)
      await push(current)
      setNote('Your instructor now sees your latest progress.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update your shared progress.')
    } finally {
      setBusy(false)
    }
  }, [push])

  const nowMs = Date.now()
  const outstanding = useMemo(
    () =>
      assignments.filter((a) => !evaluateAssignment(a, snapshot).complete).length,
    [assignments, snapshot]
  )

  if (loading) {
    return <div className="card p-8 text-center text-sm text-ink-secondary">Loading your coursework…</div>
  }

  return (
    <div className="space-y-4">
      {error ? (
        <div className="rounded-card border border-q-rose/40 bg-q-rose/10 p-3 text-sm text-q-rose-text">
          {error}
        </div>
      ) : null}
      {note ? (
        <p className="rounded-card border border-line bg-surface-2 p-3 text-sm text-ink-secondary">
          {note}
        </p>
      ) : null}

      {/* ── The consent card ────────────────────────────────── */}
      <div className="card p-5">
        <span className="section-label">Sharing</span>
        <h3 className="mt-1 text-base font-semibold text-ink">
          {granted
            ? `You are sharing your progress with ${orgName}`
            : `Share your progress with ${orgName}?`}
        </h3>
        <p className="section-desc mt-1">
          Your progress is private by default and is stored on this device. Your instructor sees
          nothing here unless you turn this on.
        </p>

        <p className="mt-3 text-sm font-semibold text-ink">What would be shared</p>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-ink-secondary">
          {SHARED_FIELDS.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="mt-2 text-sm text-ink-secondary">{NOT_SHARED_NOTE}</p>

        {snapshot ? (
          <p className="mt-3 text-xs text-ink-muted">
            Right now that would be: {describeSnapshot(snapshot)}.
          </p>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-2">
          {granted ? (
            <>
              <button
                type="button"
                className="btn-ghost focus-ring"
                onClick={() => void resend()}
                disabled={busy}
              >
                {busy ? 'Working…' : 'Update what they see'}
              </button>
              <button
                type="button"
                className="btn-ghost focus-ring text-q-rose-text"
                onClick={() => void turnOff()}
                disabled={busy}
              >
                Stop sharing and delete
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn-primary focus-ring"
              onClick={() => void turnOn()}
              disabled={busy}
            >
              {busy ? 'Working…' : 'Share my progress'}
            </button>
          )}
        </div>

        {granted && sharedAt ? (
          <p className="mt-3 text-xs text-ink-muted">
            Last sent {new Date(sharedAt).toLocaleString('en-US')}. Progress is not synced continuously —
            use &ldquo;Update what they see&rdquo; after a study session.
          </p>
        ) : null}
        {storageMode() === 'local' ? (
          <p className="mt-2 text-xs text-ink-muted">{STAND_IN_NOTE}</p>
        ) : null}
      </div>

      {/* ── The work ────────────────────────────────────────── */}
      {assignments.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-sm font-semibold text-ink">Nothing assigned</p>
          <p className="mt-1 text-sm text-ink-secondary">
            When your instructor sets work, it appears here with its deadline.
          </p>
        </div>
      ) : (
        <>
          <p className="text-sm text-ink-secondary">
            {outstanding === 0
              ? 'Everything assigned to you is done.'
              : `${outstanding} of ${assignments.length} assignment${
                  assignments.length === 1 ? '' : 's'
                } still to finish.`}
          </p>

          {assignments.map((assignment) => {
            const progress = evaluateAssignment(assignment, snapshot)
            const state = dueState(assignment, progress, nowMs)
            return (
              <div key={assignment.id} className="card p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <h4 className="text-sm font-semibold text-ink">{assignment.title}</h4>
                    <p className="text-xs text-ink-muted">Due {dueLabel(assignment.dueAt)}</p>
                  </div>
                  <span className={`pill ${STATE_STYLE[state] ?? STATE_STYLE.open}`}>
                    {STATE_LABEL[state] ?? 'open'} · {progress.done}/{progress.total}
                  </span>
                </div>

                {assignment.instructions ? (
                  <p className="mt-2 whitespace-pre-wrap text-sm text-ink-secondary">
                    {assignment.instructions}
                  </p>
                ) : null}

                <ul className="mt-3 space-y-1">
                  {progress.items.map(({ item, done }) => {
                    const entry = describeItem(item)
                    return (
                      <li
                        key={`${item.kind}:${item.ref}`}
                        className="flex items-baseline justify-between gap-3 text-sm"
                      >
                        <span className="flex items-baseline gap-2">
                          {/* aria-hidden on the glyph; the text after it carries
                              the state for a screen reader. */}
                          <span aria-hidden className={done ? 'text-q-teal-text' : 'text-ink-muted'}>
                            {done ? '✓' : '○'}
                          </span>
                          {entry.href ? (
                            <a
                              className="focus-ring text-ink underline decoration-line underline-offset-4 hover:decoration-ink-muted"
                              href={entry.href}
                            >
                              {entry.title}
                            </a>
                          ) : (
                            <span className="text-ink-secondary">{entry.title}</span>
                          )}
                        </span>
                        <span className="text-xs text-ink-muted">
                          {KIND_LABEL[item.kind]} · {done ? 'done' : 'not done'}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )
          })}
        </>
      )}
    </div>
  )
}

export { AssignedWork }
