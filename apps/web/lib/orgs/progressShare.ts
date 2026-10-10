/**
 * orgs/progressShare.ts — the privacy decision at the centre of the classroom
 * feature, written down as code.
 *
 * ── The contradiction this resolves ──────────────────────────
 * docs/ANALYTICS.md says, correctly, that Qubit16 measures itself on the
 * learner's device and nowhere else. `/insights` computes everything in the
 * browser; `lib/lessons/progress.ts` and `lib/challenges/types.ts` write to
 * localStorage and never to a network. Meanwhile /pricing sells "cohort progress
 * and usage analytics" to a university, and the admin console's Progress tab
 * rendered a table whose non-self rows were a seeded PRNG.
 *
 * Both cannot be true. The resolution is NOT to start uploading progress. It is:
 *
 *   1. Nothing leaves the device until the learner grants consent, per
 *      organisation, in an explicit action of their own.
 *   2. The grant is specific and legible: SHARED_FIELDS below is the exact list
 *      of what is sent, in the words the learner is shown. There is no second,
 *      longer list somewhere in the code.
 *   3. The server refuses a snapshot from a learner with no consent row. The
 *      opt-in is a server-side gate, not a checkbox the client honours.
 *   4. Revoking deletes the stored snapshot. "Stop sharing" that leaves last
 *      week's data on the instructor's screen is not stopping.
 *   5. An instructor sees "has not shared" as a first-class state — never a row
 *      of zeroes that reads like a learner who did nothing.
 *
 * What is NOT shared, and must not be added here without the same explicit
 * consent step: analytics events (`quantum-lab.events`), saved circuits, tutor
 * conversations, time-on-page, or anything resembling a timestamped activity
 * stream. This module carries course outcomes, not behaviour.
 *
 * PURE: no browser APIs, no Supabase, no React. The browser-side collection of
 * a snapshot lives in lib/orgs/snapshotClient.ts; the storage lives in
 * lib/orgs/classroomStore.ts; the gate lives in app/api/orgs/progress/*.
 */

import type { ProgressSnapshot } from '@/lib/orgs/assignments'
import { emptySnapshot } from '@/lib/orgs/assignments'

/**
 * The disclosure, in plain words. Rendered verbatim by the consent card in
 * components/admin/AssignedWork.tsx and quoted in docs/CLASSROOM.md.
 *
 * EDITING RULE: if you add a field to ProgressSnapshot, add a line here in the
 * same commit. `progressShare.test.ts` asserts the two lists have the same
 * length, so a silently widened snapshot fails the suite rather than shipping.
 */
export const SHARED_FIELDS: readonly string[] = [
  'Which lessons you have marked complete.',
  'Your quiz scores, as the number of questions you got right in each lesson.',
  'Which practice challenges you have solved.',
  'Which certification exams you have passed.',
]

/** The fields of ProgressSnapshot, in the same order as SHARED_FIELDS. */
export const SNAPSHOT_FIELDS: readonly (keyof ProgressSnapshot)[] = [
  'lessons',
  'quizScores',
  'challenges',
  'exams',
]

/** Said once, in one place, so the UI and the docs cannot drift. */
export const NOT_SHARED_NOTE =
  'Not shared: your saved circuits, your tutor conversations, anything you type, ' +
  'and the on-device usage data behind /insights. Sharing is per organisation, ' +
  'and you can stop at any time — stopping deletes the copy your instructor can see.'

export interface ProgressConsent {
  orgId: string
  userId: string
  grantedAt: string
}

// ────────────────────────────────────────────────────────────
// Validation of an incoming snapshot
// ────────────────────────────────────────────────────────────

/**
 * Caps. A snapshot is a small, bounded document: the course has tens of lessons
 * and challenges, not thousands. These bounds are what stop `POST` from being a
 * free key-value store attached to an org row.
 */
export const MAX_SNAPSHOT_IDS = 200
export const MAX_ID_LENGTH = 80
export const MAX_QUIZ_ENTRIES = 200

function idList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of value) {
    if (out.length >= MAX_SNAPSHOT_IDS) break
    if (typeof raw !== 'string') continue
    const trimmed = raw.trim()
    if (!trimmed || trimmed.length > MAX_ID_LENGTH || seen.has(trimmed)) continue
    seen.add(trimmed)
    out.push(trimmed)
  }
  // Sorted so an unchanged snapshot serialises identically every time and a
  // re-send is a no-op diff rather than a spurious "updated".
  return out.sort()
}

function scoreMap(value: unknown): Record<string, number> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const out: Record<string, number> = {}
  let count = 0
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (count >= MAX_QUIZ_ENTRIES) break
    if (typeof key !== 'string' || !key.trim() || key.length > MAX_ID_LENGTH) continue
    if (typeof raw !== 'number' || !Number.isFinite(raw)) continue
    // A quiz score is a count of correct answers. Negative is nonsense; the
    // upper bound is generous because it is a bound, not a rule about quizzes.
    if (raw < 0 || raw > 1_000) continue
    out[key.trim()] = Math.round(raw)
    count += 1
  }
  return out
}

/**
 * Coerce untrusted JSON into a snapshot. Never throws; anything unrecognised is
 * dropped rather than rejected, because a learner whose browser sent one odd
 * field should still have their lessons recorded.
 */
export function normalizeSnapshot(value: unknown): ProgressSnapshot {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return emptySnapshot()
  }
  const record = value as Record<string, unknown>
  return {
    lessons: idList(record.lessons),
    quizScores: scoreMap(record.quizScores),
    challenges: idList(record.challenges),
    exams: idList(record.exams),
  }
}

/**
 * A one-line summary for the learner: "this is what would be sent". Shown next
 * to the consent toggle so the decision is made with the actual numbers in
 * front of them, not an abstraction.
 */
export function describeSnapshot(snapshot: ProgressSnapshot): string {
  const parts = [
    `${snapshot.lessons.length} lesson${snapshot.lessons.length === 1 ? '' : 's'} complete`,
    `${Object.keys(snapshot.quizScores).length} quiz score${
      Object.keys(snapshot.quizScores).length === 1 ? '' : 's'
    }`,
    `${snapshot.challenges.length} challenge${snapshot.challenges.length === 1 ? '' : 's'} solved`,
    `${snapshot.exams.length} exam${snapshot.exams.length === 1 ? '' : 's'} passed`,
  ]
  return parts.join(' · ')
}
