'use client'

/**
 * CohortConsole — what an instructor actually runs a course from.
 *
 * Three things, in the order a term uses them: publish an assignment, watch who
 * has done it, take the marks away as CSV.
 *
 * ── The honesty rules this component is built around ─────────
 * 1. A learner who has not opted in to sharing is shown as "not sharing", never
 *    as 0%. The old Progress tab filled those rows from a seeded PRNG in local
 *    mode and with zeroes otherwise; both told an instructor something untrue.
 * 2. Every figure on this screen is computed only over learners who share, and
 *    the denominator is stated next to it.
 * 3. Nothing here is a permission check. The console hides controls a member
 *    cannot use, and the API refuses them independently — see
 *    lib/orgs/access.ts. If the two ever disagree, the API is right.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSession } from '@/components/auth/useSession'
import { listMembers, listOrgs, storageMode } from '@/lib/orgs/store'
import { canManageSeats, type Org, type OrgRole } from '@/lib/orgs/types'
import {
  byDueDate,
  dueState,
  evaluateAssignment,
  memberIdsOfClass,
  summarizeAssignment,
  type Assignment,
  type ClassMembership,
  type CohortMemberProgress,
  type OrgClass,
} from '@/lib/orgs/assignments'
import { describeItem } from '@/lib/orgs/itemLabels'
import {
  STAND_IN_NOTE,
  downloadCohortCsv,
  fetchAssignments,
  fetchClasses,
  fetchCohort,
  setClassRoster,
  usingBackend,
  withdrawAssignment,
} from '@/lib/orgs/classroomClient'
import AssignmentComposer from '@/components/instructor/AssignmentComposer'

function dueLabel(iso: string): string {
  const at = Date.parse(iso)
  if (!Number.isFinite(at)) return 'no due date'
  return new Date(at).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

export default function CohortConsole() {
  const { user } = useSession()
  const userId = user?.id ?? null
  const userEmail = user?.email ?? null

  const [orgs, setOrgs] = useState<Org[]>([])
  const [orgId, setOrgId] = useState<string | null>(null)
  const [role, setRole] = useState<OrgRole>('member')
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [rows, setRows] = useState<CohortMemberProgress[]>([])
  const [classes, setClasses] = useState<OrgClass[]>([])
  const [memberships, setMemberships] = useState<ClassMembership[]>([])
  /** null = the whole licence, which is the only view that existed before classes. */
  const [classFilter, setClassFilter] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  // ── Which organisations am I in, and as what? ──────────────
  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const found = await listOrgs(userId)
        if (!active) return
        setOrgs(found)
        setOrgId((current) =>
          current && found.some((o) => o.id === current) ? current : (found[0]?.id ?? null)
        )
      } catch {
        if (active) setError('Could not load your organisations. Refresh to try again.')
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [userId])

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
        // Local mode has no session to match, so the console shows the manager
        // view — the data is this browser's own and the API is not involved.
        setRole(mine ? mine.role : usingBackend() ? 'member' : 'owner')
      } catch {
        if (active) setRole('member')
      }
    })()
    return () => {
      active = false
    }
  }, [orgId, userId, userEmail])

  // ── Coursework and cohort ──────────────────────────────────
  const load = useCallback(async () => {
    if (!orgId) return
    setError(null)
    try {
      const [found, cohort, cohortClasses] = await Promise.all([
        fetchAssignments(orgId),
        fetchCohort(orgId),
        fetchClasses(orgId),
      ])
      setAssignments([...found].sort(byDueDate))
      setRows(cohort)
      setClasses(cohortClasses.classes)
      setMemberships(cohortClasses.memberships)
      // A filter can outlive the class it names (another admin removed it, or
      // the org switched). Falling back to the whole licence is the only view
      // that cannot show a stale subset.
      setClassFilter((current) =>
        current && cohortClasses.classes.some((c) => c.id === current) ? current : null
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load this cohort.')
    }
  }, [orgId])

  useEffect(() => {
    void load()
  }, [load])

  const canManage = canManageSeats(role)
  const activeOrg = useMemo(() => orgs.find((o) => o.id === orgId) ?? null, [orgs, orgId])

  // Owners and admins are the teaching staff; the roll-up is about learners.
  const learners = useMemo(() => rows.filter((r) => r.role === 'member'), [rows])
  const sharing = useMemo(() => learners.filter((r) => r.snapshot !== null).length, [learners])

  /** Seats in the currently selected class; null when viewing the whole licence. */
  const filterSeatIds = useMemo(
    () => (classFilter ? memberIdsOfClass(memberships, classFilter) : null),
    [classFilter, memberships]
  )
  const visibleLearners = useMemo(
    () => (filterSeatIds ? learners.filter((r) => filterSeatIds.has(r.memberId)) : learners),
    [learners, filterSeatIds]
  )
  const classNames = useMemo(() => new Map(classes.map((c) => [c.id, c.name])), [classes])

  /**
   * The learners an assignment is FOR — its own class if it has one, otherwise
   * the current view. This is what makes every denominator on screen honest: a
   * class-scoped assignment is never measured against seats it was not set for.
   */
  const learnersFor = useCallback(
    (assignment: Assignment): CohortMemberProgress[] => {
      if (!assignment.classId) return visibleLearners
      const seats = memberIdsOfClass(memberships, assignment.classId)
      return learners.filter((r) => seats.has(r.memberId))
    },
    [visibleLearners, learners, memberships]
  )

  const visibleAssignments = useMemo(
    () =>
      classFilter
        ? // Class view: the class's own work, plus licence-wide work — which
          // still applies to these learners, so hiding it would misreport them.
          assignments.filter((a) => !a.classId || a.classId === classFilter)
        : assignments,
    [assignments, classFilter]
  )

  const toggleClassSeat = useCallback(
    async (memberId: string) => {
      if (!orgId || !classFilter) return
      const current = memberIdsOfClass(memberships, classFilter)
      if (current.has(memberId)) current.delete(memberId)
      else current.add(memberId)
      try {
        await setClassRoster(orgId, classFilter, [...current])
        await load()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not update that class.')
      }
    },
    [orgId, classFilter, memberships, load]
  )

  const remove = useCallback(
    async (assignmentId: string) => {
      if (!orgId) return
      try {
        await withdrawAssignment(orgId, assignmentId)
        await load()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not withdraw that assignment.')
      }
    },
    [orgId, load]
  )

  const exportCsv = useCallback(async () => {
    if (!orgId) return
    setExporting(true)
    setError(null)
    try {
      await downloadCohortCsv(orgId, activeOrg?.slug ?? orgId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not build the export.')
    } finally {
      setExporting(false)
    }
  }, [orgId, activeOrg])

  if (loading) {
    return <div className="card p-8 text-center text-sm text-ink-secondary">Loading cohorts…</div>
  }

  if (orgs.length === 0) {
    return (
      <div className="card p-6">
        <h3 className="text-base font-semibold text-ink">No cohort yet</h3>
        <p className="section-desc mt-2 max-w-xl">
          A cohort is a Team or University licence. Create one in the admin console, invite your
          students to it, and their coursework appears here.
        </p>
        <a href="/admin" className="btn-primary focus-ring mt-4">
          Open the admin console
        </a>
      </div>
    )
  }

  if (!canManage) {
    return (
      <div className="card p-6">
        <h3 className="text-base font-semibold text-ink">You hold a learner seat</h3>
        <p className="section-desc mt-2 max-w-xl">
          Setting work and reading cohort progress needs an owner or admin seat on the licence. Ask
          whoever manages it to change your role. What has been assigned to you is on your own
          coursework page.
        </p>
        <a href="/admin" className="btn-ghost focus-ring mt-4">
          See what you have been assigned
        </a>
      </div>
    )
  }

  const nowMs = Date.now()

  return (
    <div className="space-y-5">
      {orgs.length > 1 ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-ink-muted">Cohort</span>
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

      {error ? (
        <div className="rounded-card border border-q-rose/40 bg-q-rose/10 p-3 text-sm text-q-rose-text">
          {error}
        </div>
      ) : null}

      {/* ── What you can and cannot see, said up front ──────── */}
      <div className="rounded-card border border-line bg-surface-2 p-4 text-sm">
        <p className="font-semibold text-ink">
          {sharing} of {learners.length} learner{learners.length === 1 ? '' : 's'} share their
          progress with you.
        </p>
        <p className="mt-1 text-ink-secondary">
          Progress is private by default. A learner turns sharing on themselves, from their
          coursework page, and can turn it off again — which deletes the copy you can see. Everyone
          who has not opted in appears below as{' '}
          <span className="text-ink">not sharing</span>, never as zero.
        </p>
        {storageMode() === 'local' ? (
          <p className="mt-2 text-xs text-ink-muted">{STAND_IN_NOTE}</p>
        ) : null}
      </div>

      {/* ── Classes: filter and roster ─────────────────────────
          A class is a targeting rule, not a wall: the chips below change which
          learners the figures are computed over, and a class-scoped assignment
          is measured only against its class. Reading is still licence-wide. */}
      {classes.length > 0 ? (
        <div className="rounded-card border border-line bg-surface-2 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-ink-muted">Class</span>
            <button
              type="button"
              className={`focus-ring rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                classFilter === null
                  ? 'border-q-violet/50 bg-q-violet/10 text-q-violet-text'
                  : 'border-line text-ink-secondary hover:text-ink'
              }`}
              onClick={() => setClassFilter(null)}
            >
              Whole licence
            </button>
            {classes.map((cls) => {
              const count = memberIdsOfClass(memberships, cls.id).size
              return (
                <button
                  key={cls.id}
                  type="button"
                  className={`focus-ring rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                    cls.id === classFilter
                      ? 'border-q-violet/50 bg-q-violet/10 text-q-violet-text'
                      : 'border-line text-ink-secondary hover:text-ink'
                  }`}
                  onClick={() => setClassFilter(cls.id)}
                >
                  {cls.name}
                  <span className="ml-1 font-normal text-ink-muted">({count})</span>
                </button>
              )
            })}
          </div>

          {classFilter ? (
            <div className="mt-3 border-t border-line pt-3">
              <p className="text-xs font-semibold text-ink-secondary">Who is in this class</p>
              {learners.length === 0 ? (
                <p className="mt-1 text-sm text-ink-secondary">No learner seats on this licence yet.</p>
              ) : (
                <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                  {learners.map((row) => (
                    <li key={row.memberId}>
                      <label className="flex cursor-pointer items-center gap-2 py-0.5 text-sm text-ink">
                        <input
                          type="checkbox"
                          className="focus-ring"
                          checked={filterSeatIds?.has(row.memberId) ?? false}
                          onChange={() => void toggleClassSeat(row.memberId)}
                        />
                        {row.email}
                      </label>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2 text-xs text-ink-muted">
                Class membership decides who an assignment counts for. It does not hide coursework:
                every seat on the licence can still read all of it.
              </p>
            </div>
          ) : null}
        </div>
      ) : null}

      {orgId ? (
        <AssignmentComposer
          orgId={orgId}
          onPublished={() => void load()}
          classes={classes}
          onClassCreated={() => void load()}
        />
      ) : null}

      {/* ── The assignments ─────────────────────────────────── */}
      {visibleAssignments.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-sm font-semibold text-ink">
            {classFilter ? 'Nothing assigned to this class yet' : 'Nothing assigned yet'}
          </p>
          <p className="mt-1 text-sm text-ink-secondary">
            Publish an assignment above and it appears here with a completion count.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-base font-semibold text-ink">Assigned work</h3>
            <button
              type="button"
              className="btn-ghost focus-ring text-xs"
              onClick={() => void exportCsv()}
              disabled={exporting}
            >
              {exporting ? 'Building…' : 'Export CSV for your gradebook'}
            </button>
          </div>

          {visibleAssignments.map((assignment) => {
            // A class-scoped assignment is summarised over ITS class, never the
            // whole roster — otherwise every seat outside the class would sit
            // in the denominator as silent failure.
            const audience = learnersFor(assignment)
            const summary = summarizeAssignment(assignment, audience, nowMs)
            const open = openId === assignment.id
            const percent =
              summary.completionRate === null ? null : Math.round(summary.completionRate * 100)
            return (
              <div key={assignment.id} className="card p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <h4 className="text-sm font-semibold text-ink">{assignment.title}</h4>
                    <p className="text-xs text-ink-muted">
                      Due {dueLabel(assignment.dueAt)} · {assignment.items.length} item
                      {assignment.items.length === 1 ? '' : 's'}
                      {assignment.classId
                        ? ` · ${classNames.get(assignment.classId) ?? 'a removed class'}`
                        : ''}
                    </p>
                  </div>
                  <p className="text-xs text-ink-secondary">
                    {percent === null ? (
                      <span className="text-ink-muted">no shared progress yet</span>
                    ) : (
                      <>
                        {summary.completed}/{summary.sharing} complete
                        <span className="text-ink-muted"> ({percent}% of those sharing)</span>
                      </>
                    )}
                  </p>
                </div>

                {assignment.instructions ? (
                  <p className="mt-2 whitespace-pre-wrap text-sm text-ink-secondary">
                    {assignment.instructions}
                  </p>
                ) : null}

                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn-ghost focus-ring text-xs"
                    aria-expanded={open}
                    onClick={() => setOpenId(open ? null : assignment.id)}
                  >
                    {open ? 'Hide learners' : 'Show learners'}
                  </button>
                  <button
                    type="button"
                    className="btn-ghost focus-ring text-xs text-q-rose-text"
                    onClick={() => void remove(assignment.id)}
                  >
                    Withdraw
                  </button>
                </div>

                {open ? (
                  <ul className="mt-3 divide-y divide-line border-t border-line">
                    {audience.length === 0 ? (
                      <li className="py-3 text-sm text-ink-secondary">
                        {assignment.classId
                          ? 'No learner seats in this class yet.'
                          : 'No learner seats on this licence yet.'}
                      </li>
                    ) : null}
                    {audience.map((row) => {
                      const progress = evaluateAssignment(assignment, row.snapshot)
                      const state = dueState(assignment, progress, nowMs)
                      return (
                        <li key={row.memberId} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                          <span className="text-sm text-ink">{row.email}</span>
                          {row.snapshot === null ? (
                            <span className="pill border-line text-ink-muted">not sharing</span>
                          ) : (
                            <span className="text-xs text-ink-secondary">
                              {progress.done}/{progress.total} done
                              <span
                                className={
                                  state === 'overdue'
                                    ? ' text-q-rose-text'
                                    : state === 'complete'
                                      ? ' text-q-teal-text'
                                      : ' text-ink-muted'
                                }
                              >
                                {' · '}
                                {state === 'complete' ? 'complete' : state === 'overdue' ? 'overdue' : 'in progress'}
                              </span>
                            </span>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                ) : null}

                <ul className="mt-3 flex flex-wrap gap-1.5">
                  {assignment.items.map((item) => {
                    const entry = describeItem(item)
                    return (
                      <li key={`${item.kind}:${item.ref}`}>
                        <span className="pill border-line text-ink-muted">{entry.title}</span>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export { CohortConsole }
