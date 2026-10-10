/**
 * orgs/classroomClient.ts — the one place that decides "API or localStorage".
 *
 * The consoles must work in two deployments:
 *
 *   Supabase configured → every call goes through app/api/orgs/*, which is where
 *                         the role checks are. The browser NEVER writes an
 *                         assignment or a progress row directly in this mode,
 *                         because a browser cannot enforce who may.
 *   Nothing configured  → lib/orgs/classroomStore.ts against localStorage, so
 *                         /instructor and /admin are explorable in development
 *                         and in the demo. Nothing is protected because nothing
 *                         leaves the browser; the panels say so on screen.
 *
 * That branch lives here and nowhere else. A component that made the decision
 * itself would eventually make it differently, and the version that got it wrong
 * would be the one that wrote to localStorage while believing it had a server.
 *
 * Every function throws `Error` with a sentence written for a person. The
 * callers render `err.message` directly, so nothing here may forward a provider
 * message — the API routes already guarantee that on their side.
 */

'use client'

import { isSupabaseConfigured } from '@/lib/supabase'
import { authFetch } from '@/lib/authFetch'
import {
  assignmentsCsv,
  csvFilename,
  mergeCompletions,
  type Assignment,
  type AssignmentItem,
  type ClassMembership,
  type CohortMemberProgress,
  type OrgClass,
  type ProgressSnapshot,
} from '@/lib/orgs/assignments'
import {
  LOCAL_USER,
  createAssignment,
  createClass,
  deleteAssignment,
  deleteClass,
  getConsent,
  grantConsent,
  listAssignments,
  listClasses,
  listClassMemberships,
  listProgress,
  revokeConsent,
  setClassMembers,
  updateAssignment,
  upsertSnapshot,
  type AssignmentPatch,
} from '@/lib/orgs/classroomStore'
import { listMembers } from '@/lib/orgs/store'

/** True when calls go to the API; false when they go to this browser's storage. */
export function usingBackend(): boolean {
  return isSupabaseConfigured
}

/**
 * Local mode has no sessions, so "which seat am I?" has no answer. The learner
 * panel falls back to the first seat in the org and says so on screen — the same
 * stand-in convention components/admin/CohortProgress.tsx already uses. Shared
 * rows are then matched back to seats by email rather than by user id.
 *
 * This exists so the assign → see → complete → export loop is walkable with no
 * backend. It is a demo affordance and it is labelled as one in the UI.
 */
export const STAND_IN_NOTE =
  'No backend is configured, so this browser stands in for one seat on the licence. ' +
  'Nothing here leaves this browser.'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Turn a non-2xx into an Error carrying the server's sentence, if it sent one. */
async function fail(response: Response, fallback: string): Promise<never> {
  let message = fallback
  try {
    const body: unknown = await response.json()
    if (isRecord(body) && typeof body.error === 'string') message = body.error
  } catch {
    // Not JSON. The fallback sentence is already written for a person.
  }
  throw new Error(message)
}

async function getJson(url: string, fallback: string): Promise<unknown> {
  const response = await authFetch(url, {
    headers: { accept: 'application/json' },
    cache: 'no-store',
  })
  if (!response.ok) await fail(response, fallback)
  return response.json()
}

async function sendJson(
  url: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  body: unknown,
  fallback: string
): Promise<unknown> {
  const init: RequestInit = {
    method,
    headers: { accept: 'application/json' },
  }
  if (body !== undefined) {
    init.headers = { ...init.headers, 'content-type': 'application/json' }
    init.body = JSON.stringify(body)
  }
  const response = await authFetch(url, init)
  if (!response.ok) await fail(response, fallback)
  return response.json().catch(() => ({}))
}

// ────────────────────────────────────────────────────────────
// Assignments
// ────────────────────────────────────────────────────────────

export async function fetchAssignments(orgId: string): Promise<Assignment[]> {
  if (!usingBackend()) return listAssignments(orgId)
  const body = await getJson(
    `/api/orgs/assignments?orgId=${encodeURIComponent(orgId)}`,
    'Could not load coursework.'
  )
  if (!isRecord(body) || !Array.isArray(body.assignments)) return []
  return body.assignments as Assignment[]
}

export interface PublishInput {
  orgId: string
  /** Omitted → everyone on the licence, exactly as before classes existed. */
  classId?: string
  title: string
  instructions?: string
  items: AssignmentItem[]
  dueAt: string
}

export async function publishAssignment(input: PublishInput): Promise<Assignment> {
  if (!usingBackend()) {
    return createAssignment({ ...input, createdBy: LOCAL_USER })
  }
  // A class-scoped publish goes through the classes route, which verifies the
  // class belongs to this org before creating anything. The plain publish
  // keeps using the original endpoint UNCHANGED — that endpoint's contract
  // (no classId, targets everyone) is what existing data relies on.
  const body = input.classId
    ? await sendJson('/api/orgs/classes/assignments', 'POST', input, 'Could not publish that assignment.')
    : await sendJson('/api/orgs/assignments', 'POST', input, 'Could not publish that assignment.')
  if (!isRecord(body) || !isRecord(body.assignment)) {
    throw new Error('The assignment was not returned by the server.')
  }
  return body.assignment as unknown as Assignment
}

export async function editAssignment(
  orgId: string,
  assignmentId: string,
  patch: AssignmentPatch
): Promise<Assignment | null> {
  if (!usingBackend()) return updateAssignment(orgId, assignmentId, patch)
  const body = await sendJson(
    '/api/orgs/assignments',
    'PATCH',
    { orgId, assignmentId, ...patch },
    'Could not update that assignment.'
  )
  if (!isRecord(body) || !isRecord(body.assignment)) return null
  return body.assignment as unknown as Assignment
}

export async function withdrawAssignment(orgId: string, assignmentId: string): Promise<boolean> {
  if (!usingBackend()) return deleteAssignment(orgId, assignmentId)
  await sendJson(
    `/api/orgs/assignments?orgId=${encodeURIComponent(orgId)}&assignmentId=${encodeURIComponent(assignmentId)}`,
    'DELETE',
    undefined,
    'Could not withdraw that assignment.'
  )
  return true
}

// ────────────────────────────────────────────────────────────
// Classes
// ────────────────────────────────────────────────────────────

export interface CohortClasses {
  classes: OrgClass[]
  memberships: ClassMembership[]
}

export async function fetchClasses(orgId: string): Promise<CohortClasses> {
  if (!usingBackend()) {
    const [classes, memberships] = await Promise.all([
      listClasses(orgId),
      listClassMemberships(orgId),
    ])
    return { classes, memberships }
  }
  const body = await getJson(
    `/api/orgs/classes?orgId=${encodeURIComponent(orgId)}`,
    'Could not load the classes on this licence.'
  )
  if (!isRecord(body)) return { classes: [], memberships: [] }
  return {
    classes: Array.isArray(body.classes) ? (body.classes as OrgClass[]) : [],
    memberships: Array.isArray(body.memberships) ? (body.memberships as ClassMembership[]) : [],
  }
}

export async function createCohortClass(orgId: string, name: string): Promise<OrgClass> {
  if (!usingBackend()) {
    return createClass({ orgId, name, createdBy: LOCAL_USER })
  }
  const body = await sendJson('/api/orgs/classes', 'POST', { orgId, name }, 'Could not create that class.')
  if (!isRecord(body) || !isRecord(body.class)) {
    throw new Error('The class was not returned by the server.')
  }
  return body.class as unknown as OrgClass
}

/** Replace one class's roster wholesale with the given seat ids. */
export async function setClassRoster(
  orgId: string,
  classId: string,
  memberIds: string[]
): Promise<void> {
  if (!usingBackend()) {
    await setClassMembers(orgId, classId, memberIds)
    return
  }
  await sendJson(
    '/api/orgs/classes',
    'PATCH',
    { orgId, classId, memberIds },
    'Could not update that class.'
  )
}

export async function removeClass(orgId: string, classId: string): Promise<boolean> {
  if (!usingBackend()) return deleteClass(orgId, classId)
  await sendJson(
    `/api/orgs/classes?orgId=${encodeURIComponent(orgId)}&classId=${encodeURIComponent(classId)}`,
    'DELETE',
    undefined,
    'Could not remove that class.'
  )
  return true
}

// ────────────────────────────────────────────────────────────
// Consent and sharing
// ────────────────────────────────────────────────────────────

export interface ConsentState {
  granted: boolean
  grantedAt: string | null
}

export async function fetchConsent(orgId: string, userId: string | null): Promise<ConsentState> {
  if (!usingBackend()) {
    const consent = await getConsent(orgId, userId ?? LOCAL_USER)
    return { granted: consent !== null, grantedAt: consent?.grantedAt ?? null }
  }
  const body = await getJson(
    `/api/orgs/progress/consent?orgId=${encodeURIComponent(orgId)}`,
    'Could not check your sharing setting.'
  )
  if (!isRecord(body)) return { granted: false, grantedAt: null }
  return {
    granted: body.granted === true,
    grantedAt: typeof body.grantedAt === 'string' ? body.grantedAt : null,
  }
}

export async function setSharing(
  orgId: string,
  userId: string | null,
  on: boolean
): Promise<ConsentState> {
  if (!usingBackend()) {
    if (!on) {
      await revokeConsent(orgId, userId ?? LOCAL_USER)
      return { granted: false, grantedAt: null }
    }
    const consent = await grantConsent(orgId, userId ?? LOCAL_USER)
    return { granted: true, grantedAt: consent.grantedAt }
  }
  if (!on) {
    await sendJson(
      `/api/orgs/progress/consent?orgId=${encodeURIComponent(orgId)}`,
      'DELETE',
      undefined,
      'Could not stop sharing.'
    )
    return { granted: false, grantedAt: null }
  }
  const body = await sendJson(
    '/api/orgs/progress/consent',
    'POST',
    { orgId },
    'Could not turn sharing on.'
  )
  return {
    granted: true,
    grantedAt: isRecord(body) && typeof body.grantedAt === 'string' ? body.grantedAt : null,
  }
}

/**
 * Push the learner's snapshot. Called only after consent is on — the caller
 * checks, the route checks, and the store checks. Three, because the cost of
 * getting this one wrong is a learner's coursework leaving their device
 * without permission.
 */
export async function shareSnapshot(
  orgId: string,
  userId: string | null,
  email: string,
  snapshot: ProgressSnapshot
): Promise<string> {
  if (!usingBackend()) {
    const assignments = await listAssignments(orgId)
    const rows = await listProgress(orgId)
    const key = userId ?? LOCAL_USER
    const previous = rows.find((r) => r.userId === key)
    const row = await upsertSnapshot({
      orgId,
      userId: key,
      email,
      snapshot,
      completions: mergeCompletions(
        assignments,
        snapshot,
        previous?.completions ?? {},
        new Date().toISOString()
      ),
    })
    return row.updatedAt
  }
  const body = await sendJson(
    '/api/orgs/progress',
    'POST',
    { orgId, snapshot },
    'Could not share your progress.'
  )
  return isRecord(body) && typeof body.sharedAt === 'string' ? body.sharedAt : ''
}

// ────────────────────────────────────────────────────────────
// The instructor's view
// ────────────────────────────────────────────────────────────

export async function fetchCohort(orgId: string): Promise<CohortMemberProgress[]> {
  if (!usingBackend()) {
    const [members, shared] = await Promise.all([listMembers(orgId), listProgress(orgId)])
    const byUser = new Map(shared.map((row) => [row.userId, row]))
    const byEmail = new Map(shared.map((row) => [row.email.toLowerCase(), row]))
    return members.map((member) => {
      // Local mode has no auth, so a stored row is matched to a seat by EMAIL —
      // the learner panel writes the seat's own address (see STAND_IN_NOTE).
      const row =
        (member.userId ? byUser.get(member.userId) : undefined) ??
        byEmail.get(member.email.toLowerCase())
      const out: CohortMemberProgress = {
        memberId: member.id,
        email: member.email,
        role: member.role,
        userId: member.userId,
        snapshot: null,
      }
      // Only a seat that actually has a stored row gets one. Everyone else is
      // reported as not sharing — there is deliberately NO demo data on this
      // path. The Progress tab used to fill empty rows from a seeded PRNG; an
      // instructor must never be shown invented completion figures, in any mode.
      if (row) {
        out.snapshot = row.snapshot
        out.sharedAt = row.updatedAt
        out.completedAt = row.completions
      }
      return out
    })
  }
  const body = await getJson(
    `/api/orgs/progress?orgId=${encodeURIComponent(orgId)}`,
    'Could not load cohort progress.'
  )
  if (!isRecord(body) || !Array.isArray(body.rows)) return []
  return body.rows as CohortMemberProgress[]
}

/**
 * Fetch (or build) the gradebook CSV and hand it to the browser as a download.
 *
 * The backend path deliberately goes through `authFetch` + a blob rather than
 * `window.open`, because the export route requires an Authorization header that
 * a plain navigation cannot carry. The object URL is revoked immediately after
 * the click; leaving it alive keeps the whole file in memory for the life of
 * the document.
 */
export async function downloadCohortCsv(orgId: string, orgLabel: string): Promise<void> {
  let text: string
  if (!usingBackend()) {
    const [assignments, rows] = await Promise.all([listAssignments(orgId), fetchCohort(orgId)])
    text = assignmentsCsv(assignments, rows)
  } else {
    const response = await authFetch(`/api/orgs/assignments/export?orgId=${encodeURIComponent(orgId)}`, {
      cache: 'no-store',
    })
    if (!response.ok) await fail(response, 'Could not build the export.')
    text = await response.text()
  }

  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  try {
    const link = document.createElement('a')
    link.href = url
    link.download = csvFilename(orgLabel || orgId, new Date().toISOString())
    document.body.appendChild(link)
    link.click()
    link.remove()
  } finally {
    URL.revokeObjectURL(url)
  }
}
