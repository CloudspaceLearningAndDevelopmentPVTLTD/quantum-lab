/**
 * orgs/assignments.ts — the coursework model, and every calculation made from it.
 *
 * A PURE module, in the same sense as lib/orgs/types.ts: no browser APIs, no
 * Supabase, no React, no clock of its own (every function that needs "now" takes
 * it as an argument, so a test can state the date instead of mocking Date).
 * The route handlers, the storage layer, the instructor console and the learner
 * panel all import from here, so none of them can disagree about what "complete"
 * means.
 *
 * ── What an assignment is ────────────────────────────────────
 * A title, a due date, and an ordered list of items. An item is one lesson, one
 * challenge or one exam, named by the id that catalogue already uses:
 *
 *   lesson    → LessonMeta.slug   (lib/lessons)
 *   challenge → Challenge.id      (lib/challenges/catalogue)
 *   exam      → Exam.id           (lib/exams/catalogue)
 *
 * This module deliberately does NOT import those catalogues. It validates the
 * shape of a reference, not its existence — the callers that have a catalogue in
 * hand (the composer, the API route) check that, and this stays importable from
 * anywhere including a server route that must not pull lesson bodies into its
 * graph. `assignmentRefErrors()` is where that existence check is expressed, and
 * it takes the known-id sets as arguments for the same reason.
 *
 * ── Who it is assigned to ────────────────────────────────────
 * The organisation — or, since the classes workstream, one CLASS within it.
 * `classId` is optional and its absence means what every assignment meant
 * before classes existed: everyone on the licence. That default is load-bearing:
 * existing data has no classId and must keep behaving exactly as it always has.
 *
 * A class is a TARGETING rule, not an access boundary. Every permission check
 * is still the org check in lib/orgs/access.ts; what a class changes is who an
 * assignment is FOR — and therefore the denominator of every completion figure
 * computed from it. `assignmentAppliesTo()` below is the one place that rule
 * lives, so the instructor console and any future learner-side filter cannot
 * disagree about it. See docs/CLASSROOM.md for what classes deliberately do
 * NOT do yet.
 */

import type { OrgRole } from '@/lib/orgs/types'

// ────────────────────────────────────────────────────────────
// The model
// ────────────────────────────────────────────────────────────

export type AssignmentItemKind = 'lesson' | 'challenge' | 'exam'

export interface AssignmentItem {
  kind: AssignmentItemKind
  /** Catalogue id: a lesson slug, a challenge id or an exam id. */
  ref: string
}

export interface Assignment {
  id: string
  orgId: string
  /**
   * Absent (or empty) → the whole licence, which is the only behaviour that
   * existed before classes and stays the default. Set → the org_classes row
   * this work targets. Optional rather than `string | null` so every
   * pre-classes Assignment object in storage and in tests is already valid.
   */
  classId?: string
  title: string
  /** Optional note from the instructor. Plain text, never rendered as HTML. */
  instructions?: string
  items: AssignmentItem[]
  /** ISO-8601. Always present: an assignment without a due date is a reading list. */
  dueAt: string
  /** auth.users id of the instructor who created it. */
  createdBy: string
  createdAt: string
}

/** What a learner shares, when they have opted in. See progressShare.ts. */
export interface ProgressSnapshot {
  /** Lesson slugs marked complete. */
  lessons: string[]
  /** Lesson slug → number of quiz questions answered correctly (a raw count). */
  quizScores: Record<string, number>
  /** Challenge ids solved. */
  challenges: string[]
  /** Exam ids passed. */
  exams: string[]
}

export function emptySnapshot(): ProgressSnapshot {
  return { lessons: [], quizScores: {}, challenges: [], exams: [] }
}

/**
 * One learner's row as the instructor sees it.
 *
 * `snapshot === null` is the honest representation of "this person has not opted
 * in to sharing". It is NOT the same as an empty snapshot, and the UI and the
 * CSV both distinguish them — conflating the two would let an instructor read a
 * non-consenting learner as a learner who has done nothing.
 */
export interface CohortMemberProgress {
  memberId: string
  email: string
  role: OrgRole
  userId: string
  snapshot: ProgressSnapshot | null
  /** When the learner last pushed a snapshot. Undefined when never shared. */
  sharedAt?: string
  /**
   * assignmentId → ISO timestamp at which the server first observed every item
   * complete. Recorded on ingest, never recomputed backwards, which is why it
   * can be compared with a due date honestly.
   */
  completedAt?: Record<string, string>
}

// ────────────────────────────────────────────────────────────
// Classes
// ────────────────────────────────────────────────────────────

/** A named class inside one licence. Stored in org_classes. */
export interface OrgClass {
  id: string
  orgId: string
  name: string
  /** auth.users id of the instructor who created it; '' in local mode. */
  createdBy: string
  createdAt: string
}

/**
 * One seat's membership of one class. `memberId` is org_members.id — a SEAT,
 * not an auth.users id — so an invited seat with no account yet can still be
 * placed in a class.
 */
export interface ClassMembership {
  classId: string
  memberId: string
}

export const MAX_CLASS_NAME = 80

/**
 * Is this assignment for this seat?
 *
 * The whole class-targeting rule, in one place: no classId → everyone on the
 * licence (the pre-classes behaviour, unchanged); a classId → only seats in
 * that class. `memberClassIds` is the set of class ids the seat belongs to.
 */
export function assignmentAppliesTo(
  assignment: Assignment,
  memberClassIds: ReadonlySet<string>
): boolean {
  if (!assignment.classId) return true
  return memberClassIds.has(assignment.classId)
}

/** The class ids one seat belongs to, from the flat membership list. */
export function classIdsForMember(
  memberships: readonly ClassMembership[],
  memberId: string
): Set<string> {
  const out = new Set<string>()
  for (const m of memberships) {
    if (m.memberId === memberId) out.add(m.classId)
  }
  return out
}

/** The seat ids inside one class, from the flat membership list. */
export function memberIdsOfClass(
  memberships: readonly ClassMembership[],
  classId: string
): Set<string> {
  const out = new Set<string>()
  for (const m of memberships) {
    if (m.classId === classId) out.add(m.memberId)
  }
  return out
}

// ────────────────────────────────────────────────────────────
// Validation
// ────────────────────────────────────────────────────────────

export const MAX_TITLE = 120
export const MAX_INSTRUCTIONS = 2_000
/** A course-sized assignment. The cap exists so one row cannot become a blob. */
export const MAX_ITEMS = 40
const MAX_REF = 80

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isAssignmentItemKind(value: unknown): value is AssignmentItemKind {
  return value === 'lesson' || value === 'challenge' || value === 'exam'
}

/**
 * Coerce untrusted JSON into an item list, dropping anything malformed and
 * de-duplicating (kind, ref) pairs — assigning the same lesson twice would
 * inflate the denominator of every completion figure derived from it.
 */
export function normalizeItems(value: unknown): AssignmentItem[] {
  if (!Array.isArray(value)) return []
  const out: AssignmentItem[] = []
  const seen = new Set<string>()
  for (const raw of value) {
    if (out.length >= MAX_ITEMS) break
    if (!isRecord(raw)) continue
    const { kind, ref } = raw
    if (!isAssignmentItemKind(kind)) continue
    if (typeof ref !== 'string') continue
    const trimmed = ref.trim()
    if (!trimmed || trimmed.length > MAX_REF) continue
    const key = `${kind}:${trimmed}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ kind, ref: trimmed })
  }
  return out
}

/** Catalogue ids the deployment actually has, passed in by the caller. */
export interface KnownRefs {
  lessons: ReadonlySet<string>
  challenges: ReadonlySet<string>
  exams: ReadonlySet<string>
}

/**
 * Which items name something this deployment does not have.
 *
 * Returned rather than thrown, and returned as a LIST, because the useful error
 * message for an instructor names every bad reference at once. An empty array
 * means every item resolves.
 */
export function unknownRefs(items: AssignmentItem[], known: KnownRefs): AssignmentItem[] {
  return items.filter((item) => {
    if (item.kind === 'lesson') return !known.lessons.has(item.ref)
    if (item.kind === 'challenge') return !known.challenges.has(item.ref)
    return !known.exams.has(item.ref)
  })
}

/**
 * Is this a due date we can store and compare? Parseable, and not absurd.
 *
 * The lower bound is "not in the past at creation time" — enforced by the
 * caller, not here, because editing an assignment whose due date has passed is
 * legitimate and this function is used for both.
 */
export function isValidDueAt(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 40) return false
  const at = Date.parse(value)
  if (!Number.isFinite(at)) return false
  // A ±10 year window. Anything outside it is a typo or a fuzzer, and storing
  // it would poison every "overdue" calculation on the page.
  const decade = 10 * 365 * 86_400_000
  const now = Date.now()
  return at > now - decade && at < now + decade
}

// ────────────────────────────────────────────────────────────
// Completion
// ────────────────────────────────────────────────────────────

export interface ItemStatus {
  item: AssignmentItem
  done: boolean
}

export interface AssignmentProgress {
  assignmentId: string
  total: number
  done: number
  complete: boolean
  items: ItemStatus[]
}

/**
 * Has this learner finished this item?
 *
 * One place, so the learner's own checklist, the instructor's table and the CSV
 * can never drift apart. A quiz score is deliberately NOT part of "done": a
 * lesson counts as complete when the learner marked it complete, which is the
 * same rule /learn uses. Scores are reported separately.
 */
function itemDone(item: AssignmentItem, snapshot: ProgressSnapshot): boolean {
  if (item.kind === 'lesson') return snapshot.lessons.includes(item.ref)
  if (item.kind === 'challenge') return snapshot.challenges.includes(item.ref)
  return snapshot.exams.includes(item.ref)
}

export function evaluateAssignment(
  assignment: Assignment,
  snapshot: ProgressSnapshot | null
): AssignmentProgress {
  const source = snapshot ?? emptySnapshot()
  const items = assignment.items.map((item) => ({ item, done: itemDone(item, source) }))
  const done = items.filter((i) => i.done).length
  return {
    assignmentId: assignment.id,
    total: assignment.items.length,
    done,
    // An assignment with no items is not "complete"; it is misconfigured. The
    // composer refuses to create one, and this is the second line.
    complete: assignment.items.length > 0 && done === assignment.items.length,
    items,
  }
}

export type DueState = 'complete' | 'overdue' | 'due-soon' | 'open'

/** Within this many hours of the due date, a learner is told "due soon". */
const DUE_SOON_HOURS = 48

export function dueState(
  assignment: Assignment,
  progress: AssignmentProgress,
  nowMs: number
): DueState {
  if (progress.complete) return 'complete'
  const due = Date.parse(assignment.dueAt)
  if (!Number.isFinite(due)) return 'open'
  if (due < nowMs) return 'overdue'
  if (due - nowMs <= DUE_SOON_HOURS * 3_600_000) return 'due-soon'
  return 'open'
}

/** Soonest due first; ties broken by title so the order is stable. */
export function byDueDate(a: Assignment, b: Assignment): number {
  const diff = Date.parse(a.dueAt) - Date.parse(b.dueAt)
  if (Number.isFinite(diff) && diff !== 0) return diff
  return a.title.localeCompare(b.title)
}

/**
 * Was it finished before the deadline?
 *
 * `null` — not "false" — when the answer is unknown: not complete, never shared,
 * or complete but with no recorded completion timestamp (a snapshot ingested
 * before the assignment existed). A gradebook column that renders "late" for
 * "we do not know" is a column that fails a student.
 */
export function onTime(
  assignment: Assignment,
  completedAt: string | undefined
): boolean | null {
  if (!completedAt) return null
  const done = Date.parse(completedAt)
  const due = Date.parse(assignment.dueAt)
  if (!Number.isFinite(done) || !Number.isFinite(due)) return null
  return done <= due
}

/**
 * When each assignment first became complete, as far as the server has observed.
 *
 * Called by POST /api/orgs/progress on every ingest. It lives here, with its own
 * tests, because it is the function that decides whether a learner is recorded
 * as late — that is not logic to leave inside a route handler where the only way
 * to exercise it is through HTTP.
 *
 * Two rules, both deliberate:
 *   · a timestamp already recorded is NEVER moved. Re-sharing an unchanged
 *     snapshot must not push a completion later and turn an on-time submission
 *     into a late one.
 *   · a timestamp for an assignment that is no longer complete is DROPPED. A
 *     learner who resets their progress, or an instructor who adds an item to an
 *     existing assignment, must not leave a "completed at" next to a row the
 *     table shows as unfinished. The pair has to stay consistent, and `onTime()`
 *     returning null for "we do not know" is the other half of that.
 */
export function mergeCompletions(
  assignments: Assignment[],
  snapshot: ProgressSnapshot | null,
  previous: Record<string, string>,
  nowIso: string
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const assignment of assignments) {
    if (!evaluateAssignment(assignment, snapshot).complete) continue
    out[assignment.id] = previous[assignment.id] ?? nowIso
  }
  return out
}

// ────────────────────────────────────────────────────────────
// Cohort roll-up
// ────────────────────────────────────────────────────────────

export interface CohortSummary {
  /** Members counted in these figures — active seats only. */
  learners: number
  sharing: number
  /** Complete / learners who share. Null when nobody shares: 0% would be a lie. */
  completionRate: number | null
  completed: number
  overdue: number
}

export function summarizeAssignment(
  assignment: Assignment,
  rows: CohortMemberProgress[],
  nowMs: number
): CohortSummary {
  const sharing = rows.filter((r) => r.snapshot !== null)
  const completed = sharing.filter(
    (r) => evaluateAssignment(assignment, r.snapshot).complete
  ).length
  const past = Date.parse(assignment.dueAt) < nowMs
  return {
    learners: rows.length,
    sharing: sharing.length,
    completionRate: sharing.length === 0 ? null : completed / sharing.length,
    completed,
    // Only meaningful once the deadline has passed, and only over the people we
    // can actually see. A non-sharing learner is not counted as overdue —
    // we have no evidence either way and would be inventing it.
    overdue: past ? sharing.length - completed : 0,
  }
}

// ────────────────────────────────────────────────────────────
// CSV export
// ────────────────────────────────────────────────────────────

/**
 * RFC 4180 quoting.
 *
 * The leading-character guard is not cosmetic: a cell beginning `=`, `+`, `-`
 * or `@` is executed as a formula when the file is opened in Excel or Sheets,
 * and every cell in this file that a learner can influence (their email address)
 * flows straight in. Prefixing with a single quote is the standard mitigation
 * and is what a spreadsheet shows as plain text.
 */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  let text = String(value)
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

export const CSV_COLUMNS = [
  'student_email',
  'assignment',
  'due_at',
  'items_total',
  'items_complete',
  'status',
  'completed_at',
  'on_time',
  'last_shared_at',
] as const

/**
 * The gradebook export. One row per (learner × assignment).
 *
 * `status` is a four-value column, and the fourth value is the important one:
 *
 *   complete     — every item done
 *   in_progress  — some items done
 *   not_started  — sharing, nothing done
 *   not_shared   — this learner has NOT opted in to sharing progress
 *
 * `not_shared` must never be silently folded into `not_started`. They mean
 * opposite things to whoever grades from this file.
 *
 * The row order is (assignment in due order) × (learner by email), so two
 * exports of unchanged data are byte-identical and diffable.
 */
export function assignmentsCsv(
  assignments: Assignment[],
  rows: CohortMemberProgress[]
): string {
  const lines: string[] = [CSV_COLUMNS.join(',')]
  const ordered = [...assignments].sort(byDueDate)
  const learners = [...rows].sort((a, b) => a.email.localeCompare(b.email))

  for (const assignment of ordered) {
    for (const row of learners) {
      const shared = row.snapshot !== null
      const progress = evaluateAssignment(assignment, row.snapshot)
      const completedAt = row.completedAt?.[assignment.id]
      const status = !shared
        ? 'not_shared'
        : progress.complete
          ? 'complete'
          : progress.done > 0
            ? 'in_progress'
            : 'not_started'
      const punctual = shared && progress.complete ? onTime(assignment, completedAt) : null
      lines.push(
        [
          csvCell(row.email),
          csvCell(assignment.title),
          csvCell(assignment.dueAt),
          csvCell(progress.total),
          csvCell(shared ? progress.done : null),
          csvCell(status),
          csvCell(shared ? completedAt : null),
          csvCell(punctual === null ? null : punctual ? 'yes' : 'no'),
          csvCell(row.sharedAt),
        ].join(',')
      )
    }
  }
  // A trailing newline: POSIX text, and it stops the last row being merged by
  // tools that concatenate exports.
  return `${lines.join('\n')}\n`
}

/** Content-Disposition value for the export, with a date so files do not collide. */
export function csvFilename(orgSlugOrId: string, nowIso: string): string {
  const safe = orgSlugOrId.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 48) || 'cohort'
  const day = nowIso.slice(0, 10)
  // "qubit16", not "quantum-lab" — the pre-rename product name (see
  // lib/seo.ts's SITE.name comment). A downloaded file is one of the more
  // durable places a stale name survives, since nobody re-downloads a report
  // just because the app was renamed.
  return `qubit16-${safe}-${day}.csv`
}
