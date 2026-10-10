/**
 * orgs/classroomStore.ts — storage for assignments, consent and shared progress.
 *
 * Same shape, same rules and the same trailing `ctx: OrgContext` as
 * lib/orgs/store.ts — read that file's header first; everything it says about
 * WHO THE CALLER IS applies here unchanged:
 *
 *   ctx supplied → SERVER. The caller has already been verified from a bearer
 *                  token and gated by lib/orgs/access.ts. No local fallback: on
 *                  the server, falling back to localStorage means writing to
 *                  nothing and reporting success.
 *   ctx absent   → BROWSER. localStorage under 'quantum-lab.classroom', so the
 *                  admin and instructor consoles are explorable with no backend.
 *
 * THIS MODULE AUTHORISES NOTHING. It is storage. The gate is `requireOrgRole`
 * and it runs in the handler before any call lands here. The one rule that IS
 * here — `upsertSnapshot` refusing to write without a consent row — is not
 * authorisation, it is the privacy invariant from progressShare.ts, and it is
 * duplicated in the route on purpose: two independent refusals, because the
 * failure mode is exfiltrating a learner's coursework.
 */

import { isSupabaseConfigured } from '@/lib/supabase'
import type { OrgContext } from '@/lib/orgs/store'
import type {
  Assignment,
  AssignmentItem,
  ClassMembership,
  OrgClass,
  ProgressSnapshot,
} from '@/lib/orgs/assignments'
import { normalizeItems } from '@/lib/orgs/assignments'
import { normalizeSnapshot, type ProgressConsent } from '@/lib/orgs/progressShare'

const STORAGE_KEY = 'quantum-lab.classroom'

const ASSIGNMENTS_TABLE = 'org_assignments'
const CONSENT_TABLE = 'org_progress_consent'
const PROGRESS_TABLE = 'org_progress'
const CLASSES_TABLE = 'org_classes'
const CLASS_MEMBERS_TABLE = 'org_class_members'

/**
 * One learner's stored progress row.
 *
 * `completions` is written by the server on ingest (see `upsertSnapshot`) and
 * never recomputed from an older snapshot, which is what makes the timestamps
 * in it comparable with a due date.
 */
export interface ProgressRow {
  orgId: string
  userId: string
  email: string
  snapshot: ProgressSnapshot
  updatedAt: string
  completions: Record<string, string>
}

// ────────────────────────────────────────────────────────────
// Row shapes — mirror supabase/schema-orgs.sql
// ────────────────────────────────────────────────────────────

interface AssignmentRow {
  id: string
  org_id: string
  /** Optional so a pre-classes database (no column yet) still parses. */
  class_id?: string | null
  title: string
  instructions: string | null
  items: unknown
  due_at: string
  created_by: string | null
  created_at: string
}

function rowToAssignment(row: AssignmentRow): Assignment {
  const assignment: Assignment = {
    id: row.id,
    orgId: row.org_id,
    title: row.title,
    items: normalizeItems(row.items),
    dueAt: row.due_at,
    createdBy: row.created_by ?? '',
    createdAt: row.created_at,
  }
  if (row.instructions) assignment.instructions = row.instructions
  // NULL stays absent: an assignment with no class is shaped exactly as every
  // assignment was before classes existed.
  if (row.class_id) assignment.classId = row.class_id
  return assignment
}

interface ClassRow {
  id: string
  org_id: string
  name: string
  created_by: string | null
  created_at: string
}

function rowToClass(row: ClassRow): OrgClass {
  return {
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    createdBy: row.created_by ?? '',
    createdAt: row.created_at,
  }
}

// ────────────────────────────────────────────────────────────
// Local (browser) database
// ────────────────────────────────────────────────────────────

/** ClassMembership plus the org, so local reads can scope without a join. */
interface LocalClassMembership extends ClassMembership {
  orgId: string
}

interface LocalDb {
  assignments: Assignment[]
  consents: ProgressConsent[]
  progress: ProgressRow[]
  classes: OrgClass[]
  classMembers: LocalClassMembership[]
}

function emptyDb(): LocalDb {
  return { assignments: [], consents: [], progress: [], classes: [], classMembers: [] }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeLocal(raw: unknown): LocalDb {
  if (!isRecord(raw)) return emptyDb()
  const assignments = Array.isArray(raw.assignments)
    ? raw.assignments.filter(isRecord).map((r) => ({
        id: String(r.id ?? ''),
        orgId: String(r.orgId ?? ''),
        ...(typeof r.classId === 'string' && r.classId ? { classId: r.classId } : {}),
        title: String(r.title ?? ''),
        ...(typeof r.instructions === 'string' ? { instructions: r.instructions } : {}),
        items: normalizeItems(r.items),
        dueAt: String(r.dueAt ?? ''),
        createdBy: String(r.createdBy ?? ''),
        createdAt: String(r.createdAt ?? ''),
      }))
      .filter((a) => a.id && a.orgId && a.dueAt)
    : []
  const consents = Array.isArray(raw.consents)
    ? raw.consents.filter(isRecord).map((r) => ({
        orgId: String(r.orgId ?? ''),
        userId: String(r.userId ?? ''),
        grantedAt: String(r.grantedAt ?? ''),
      }))
      .filter((c) => c.orgId)
    : []
  const progress = Array.isArray(raw.progress)
    ? raw.progress.filter(isRecord).map((r) => ({
        orgId: String(r.orgId ?? ''),
        userId: String(r.userId ?? ''),
        email: String(r.email ?? ''),
        snapshot: normalizeSnapshot(r.snapshot),
        updatedAt: String(r.updatedAt ?? ''),
        completions: isRecord(r.completions)
          ? Object.fromEntries(
              Object.entries(r.completions).filter(
                (entry): entry is [string, string] => typeof entry[1] === 'string'
              )
            )
          : {},
      }))
      .filter((p) => p.orgId)
    : []
  const classes = Array.isArray(raw.classes)
    ? raw.classes.filter(isRecord).map((r) => ({
        id: String(r.id ?? ''),
        orgId: String(r.orgId ?? ''),
        name: String(r.name ?? ''),
        createdBy: String(r.createdBy ?? ''),
        createdAt: String(r.createdAt ?? ''),
      }))
      .filter((c) => c.id && c.orgId && c.name)
    : []
  const classMembers = Array.isArray(raw.classMembers)
    ? raw.classMembers.filter(isRecord).map((r) => ({
        orgId: String(r.orgId ?? ''),
        classId: String(r.classId ?? ''),
        memberId: String(r.memberId ?? ''),
      }))
      .filter((m) => m.orgId && m.classId && m.memberId)
    : []
  return { assignments, consents, progress, classes, classMembers }
}

function readLocal(): LocalDb {
  if (typeof window === 'undefined') return emptyDb()
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return emptyDb()
    return normalizeLocal(JSON.parse(raw) as unknown)
  } catch {
    return emptyDb()
  }
}

function writeLocal(db: LocalDb): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(db))
  } catch {
    // Quota exceeded or storage blocked. The in-memory result still returns.
  }
}

function newId(prefix: string): string {
  const c = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined
  if (c && typeof c.randomUUID === 'function') {
    try {
      return c.randomUUID()
    } catch {
      // fall through
    }
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * In local mode there is no auth, so there is no user id to key consent on.
 * Everything in that browser is the same person by construction.
 */
export const LOCAL_USER = 'local-learner'

function localKey(userId: string | null): string {
  return userId && userId.trim() ? userId : LOCAL_USER
}

/** True when this call must use the backend rather than localStorage. */
/*
 * Renamed from `useBackend`. It is a type-guard predicate — "should this call
 * go to the backend?" — and never was a React hook, but eslint-plugin-react-hooks
 * matches on the `use` prefix alone and so reported every one of the fifteen
 * call sites below as a hook called outside a component. Fifteen errors that
 * were all the same false positive would have been reason enough to switch
 * rules-of-hooks off, and that rule catches real bugs, so the English verb
 * phrase gives way to the convention rather than the other way round.
 */
function shouldUseBackend(ctx?: OrgContext): ctx is OrgContext {
  return ctx !== undefined && isSupabaseConfigured
}

// ────────────────────────────────────────────────────────────
// Assignments
// ────────────────────────────────────────────────────────────

export async function listAssignments(orgId: string, ctx?: OrgContext): Promise<Assignment[]> {
  if (shouldUseBackend(ctx)) {
    try {
      const { data, error } = await ctx.client
        .from(ASSIGNMENTS_TABLE)
        .select('*')
        .eq('org_id', orgId)
        .order('due_at', { ascending: true })
      if (!error && Array.isArray(data)) return (data as AssignmentRow[]).map(rowToAssignment)
    } catch {
      // Fall through to the honest empty answer below.
    }
    // No local copy exists on the server: an empty list is the truth, not a
    // reason to read this process's (non-existent) localStorage.
    return []
  }
  return readLocal()
    .assignments.filter((a) => a.orgId === orgId)
    .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt))
}

export interface CreateAssignmentInput {
  orgId: string
  /**
   * Omitted → the whole licence, which is what every caller that predates
   * classes already asks for by saying nothing. The route that accepts a
   * classId verifies it names a class OF THIS ORG before it lands here.
   */
  classId?: string
  title: string
  instructions?: string
  items: AssignmentItem[]
  dueAt: string
  createdBy: string
}

export async function createAssignment(
  input: CreateAssignmentInput,
  ctx?: OrgContext
): Promise<Assignment> {
  if (shouldUseBackend(ctx)) {
    const { data, error } = await ctx.client
      .from(ASSIGNMENTS_TABLE)
      .insert({
        org_id: input.orgId,
        class_id: input.classId ?? null,
        title: input.title,
        instructions: input.instructions ?? null,
        items: input.items,
        due_at: input.dueAt,
        // The VERIFIED caller, handed down from the route. Never a body field.
        created_by: ctx.userId,
      })
      .select('*')
      .single()
    // Server-side there is nowhere to fall back to; a swallowed failure would
    // report an assignment the cohort will never see.
    if (error || !data) throw new Error(error?.message ?? 'Could not create the assignment.')
    return rowToAssignment(data as AssignmentRow)
  }

  const assignment: Assignment = {
    id: newId('assignment'),
    orgId: input.orgId,
    title: input.title,
    items: input.items,
    dueAt: input.dueAt,
    createdBy: input.createdBy,
    createdAt: new Date().toISOString(),
  }
  if (input.instructions) assignment.instructions = input.instructions
  if (input.classId) assignment.classId = input.classId
  const db = readLocal()
  writeLocal({ ...db, assignments: [...db.assignments, assignment] })
  return assignment
}

export type AssignmentPatch = Partial<Pick<Assignment, 'title' | 'instructions' | 'items' | 'dueAt'>>

export async function updateAssignment(
  orgId: string,
  assignmentId: string,
  patch: AssignmentPatch,
  ctx?: OrgContext
): Promise<Assignment | null> {
  if (shouldUseBackend(ctx)) {
    try {
      const fields: Record<string, unknown> = {}
      if (patch.title !== undefined) fields.title = patch.title
      if (patch.instructions !== undefined) fields.instructions = patch.instructions || null
      if (patch.items !== undefined) fields.items = patch.items
      if (patch.dueAt !== undefined) fields.due_at = patch.dueAt
      const { data, error } = await ctx.client
        .from(ASSIGNMENTS_TABLE)
        .update(fields)
        // org_id is in the predicate as well as the id: a row id from another
        // org must not be updatable even if one leaks into a request.
        .eq('id', assignmentId)
        .eq('org_id', orgId)
        .select('*')
        .single()
      if (!error && data) return rowToAssignment(data as AssignmentRow)
    } catch {
      // Fall through to null — the route turns that into a 404.
    }
    return null
  }

  const db = readLocal()
  const index = db.assignments.findIndex((a) => a.id === assignmentId && a.orgId === orgId)
  if (index === -1) return null
  const current = db.assignments[index]
  const next: Assignment = {
    ...current,
    title: patch.title ?? current.title,
    items: patch.items ?? current.items,
    dueAt: patch.dueAt ?? current.dueAt,
  }
  if (patch.instructions !== undefined) {
    if (patch.instructions) next.instructions = patch.instructions
    else delete next.instructions
  }
  const assignments = [...db.assignments]
  assignments[index] = next
  writeLocal({ ...db, assignments })
  return next
}

export async function deleteAssignment(
  orgId: string,
  assignmentId: string,
  ctx?: OrgContext
): Promise<boolean> {
  if (shouldUseBackend(ctx)) {
    try {
      const { error } = await ctx.client
        .from(ASSIGNMENTS_TABLE)
        .delete()
        .eq('id', assignmentId)
        .eq('org_id', orgId)
      return !error
    } catch {
      return false
    }
  }
  const db = readLocal()
  const assignments = db.assignments.filter(
    (a) => !(a.id === assignmentId && a.orgId === orgId)
  )
  if (assignments.length === db.assignments.length) return false
  writeLocal({ ...db, assignments })
  return true
}

// ────────────────────────────────────────────────────────────
// Classes
//
// Same contract as everything above: this module authorises
// nothing. The routes under app/api/orgs/classes gate every call
// with requireOrgRole before it lands here.
// ────────────────────────────────────────────────────────────

export async function listClasses(orgId: string, ctx?: OrgContext): Promise<OrgClass[]> {
  if (shouldUseBackend(ctx)) {
    try {
      const { data, error } = await ctx.client
        .from(CLASSES_TABLE)
        .select('id, org_id, name, created_by, created_at')
        .eq('org_id', orgId)
        .order('created_at', { ascending: true })
      if (!error && Array.isArray(data)) return (data as ClassRow[]).map(rowToClass)
    } catch {
      // Fall through to the honest empty answer.
    }
    return []
  }
  return readLocal().classes.filter((c) => c.orgId === orgId)
}

export interface CreateClassInput {
  orgId: string
  name: string
  createdBy: string
}

export async function createClass(input: CreateClassInput, ctx?: OrgContext): Promise<OrgClass> {
  if (shouldUseBackend(ctx)) {
    const { data, error } = await ctx.client
      .from(CLASSES_TABLE)
      .insert({
        org_id: input.orgId,
        name: input.name,
        // The VERIFIED caller, handed down from the route. Never a body field.
        created_by: ctx.userId,
      })
      .select('id, org_id, name, created_by, created_at')
      .single()
    if (error || !data) throw new Error(error?.message ?? 'Could not create the class.')
    return rowToClass(data as ClassRow)
  }

  const cls: OrgClass = {
    id: newId('class'),
    orgId: input.orgId,
    name: input.name,
    createdBy: input.createdBy,
    createdAt: new Date().toISOString(),
  }
  const db = readLocal()
  writeLocal({ ...db, classes: [...db.classes, cls] })
  return cls
}

/**
 * Remove a class. Its assignments survive and fall back to targeting the whole
 * licence — the same ON DELETE SET NULL the schema declares, mirrored here so
 * local mode cannot behave differently from a real database.
 */
export async function deleteClass(
  orgId: string,
  classId: string,
  ctx?: OrgContext
): Promise<boolean> {
  if (shouldUseBackend(ctx)) {
    try {
      const { error } = await ctx.client
        .from(CLASSES_TABLE)
        .delete()
        .eq('id', classId)
        .eq('org_id', orgId)
      return !error
    } catch {
      return false
    }
  }
  const db = readLocal()
  const classes = db.classes.filter((c) => !(c.id === classId && c.orgId === orgId))
  if (classes.length === db.classes.length) return false
  writeLocal({
    ...db,
    classes,
    classMembers: db.classMembers.filter((m) => !(m.classId === classId && m.orgId === orgId)),
    assignments: db.assignments.map((a) => {
      if (a.orgId !== orgId || a.classId !== classId) return a
      const { classId: _dropped, ...rest } = a
      return rest
    }),
  })
  return true
}

export async function listClassMemberships(
  orgId: string,
  ctx?: OrgContext
): Promise<ClassMembership[]> {
  if (shouldUseBackend(ctx)) {
    try {
      const { data, error } = await ctx.client
        .from(CLASS_MEMBERS_TABLE)
        .select('class_id, member_id')
        .eq('org_id', orgId)
      if (error || !Array.isArray(data)) return []
      return (data as Record<string, unknown>[]).map((row) => ({
        classId: String(row.class_id ?? ''),
        memberId: String(row.member_id ?? ''),
      }))
    } catch {
      return []
    }
  }
  return readLocal()
    .classMembers.filter((m) => m.orgId === orgId)
    .map(({ classId, memberId }) => ({ classId, memberId }))
}

/**
 * Replace one class's roster wholesale. Replace-not-merge on purpose: the
 * caller (the console) shows the full checkbox list and sends what is ticked,
 * so a diff protocol would only add a way for the two to disagree. `memberIds`
 * are org_members.id values the ROUTE has already checked belong to this org.
 */
export async function setClassMembers(
  orgId: string,
  classId: string,
  memberIds: string[],
  ctx?: OrgContext
): Promise<void> {
  if (shouldUseBackend(ctx)) {
    const removed = await ctx.client
      .from(CLASS_MEMBERS_TABLE)
      .delete()
      .eq('org_id', orgId)
      .eq('class_id', classId)
    if (removed.error) throw new Error(removed.error.message)
    if (memberIds.length === 0) return
    const { error } = await ctx.client.from(CLASS_MEMBERS_TABLE).insert(
      memberIds.map((memberId) => ({
        org_id: orgId,
        class_id: classId,
        member_id: memberId,
      }))
    )
    if (error) throw new Error(error.message)
    return
  }
  const db = readLocal()
  writeLocal({
    ...db,
    classMembers: [
      ...db.classMembers.filter((m) => !(m.orgId === orgId && m.classId === classId)),
      ...memberIds.map((memberId) => ({ orgId, classId, memberId })),
    ],
  })
}

// ────────────────────────────────────────────────────────────
// Consent
// ────────────────────────────────────────────────────────────

export async function getConsent(
  orgId: string,
  userId: string,
  ctx?: OrgContext
): Promise<ProgressConsent | null> {
  if (shouldUseBackend(ctx)) {
    try {
      const { data, error } = await ctx.client
        .from(CONSENT_TABLE)
        .select('org_id, user_id, granted_at')
        .eq('org_id', orgId)
        .eq('user_id', userId)
        .maybeSingle()
      if (error || !data) return null
      const row = data as { org_id: string; user_id: string; granted_at: string }
      return { orgId: row.org_id, userId: row.user_id, grantedAt: row.granted_at }
    } catch {
      // Cannot prove consent → there is none. Fail closed: this is the check
      // that decides whether a learner's coursework may be stored at all.
      return null
    }
  }
  const key = localKey(userId)
  return readLocal().consents.find((c) => c.orgId === orgId && c.userId === key) ?? null
}

export async function grantConsent(
  orgId: string,
  userId: string,
  ctx?: OrgContext
): Promise<ProgressConsent> {
  const grantedAt = new Date().toISOString()
  if (shouldUseBackend(ctx)) {
    const { error } = await ctx.client
      .from(CONSENT_TABLE)
      .upsert({ org_id: orgId, user_id: userId, granted_at: grantedAt }, { onConflict: 'org_id,user_id' })
    if (error) throw new Error(error.message)
    return { orgId, userId, grantedAt }
  }
  const key = localKey(userId)
  const db = readLocal()
  const consents = db.consents.filter((c) => !(c.orgId === orgId && c.userId === key))
  const consent: ProgressConsent = { orgId, userId: key, grantedAt }
  writeLocal({ ...db, consents: [...consents, consent] })
  return consent
}

/**
 * Stop sharing, and delete what was shared.
 *
 * The deletion is the point. A revoke that leaves the last snapshot on the
 * instructor's screen has not stopped anything, so the snapshot row goes first
 * and the consent row second — in that order, so a failure halfway leaves
 * consent granted with no data rather than data with no consent.
 */
export async function revokeConsent(
  orgId: string,
  userId: string,
  ctx?: OrgContext
): Promise<void> {
  if (shouldUseBackend(ctx)) {
    const progress = await ctx.client
      .from(PROGRESS_TABLE)
      .delete()
      .eq('org_id', orgId)
      .eq('user_id', userId)
    if (progress.error) throw new Error(progress.error.message)
    const consent = await ctx.client
      .from(CONSENT_TABLE)
      .delete()
      .eq('org_id', orgId)
      .eq('user_id', userId)
    if (consent.error) throw new Error(consent.error.message)
    return
  }
  const key = localKey(userId)
  const db = readLocal()
  writeLocal({
    ...db,
    progress: db.progress.filter((p) => !(p.orgId === orgId && p.userId === key)),
    consents: db.consents.filter((c) => !(c.orgId === orgId && c.userId === key)),
  })
}

// ────────────────────────────────────────────────────────────
// Shared progress
// ────────────────────────────────────────────────────────────

export async function listProgress(orgId: string, ctx?: OrgContext): Promise<ProgressRow[]> {
  if (shouldUseBackend(ctx)) {
    try {
      const { data, error } = await ctx.client
        .from(PROGRESS_TABLE)
        .select('org_id, user_id, email, snapshot, completions, updated_at')
        .eq('org_id', orgId)
      if (error || !Array.isArray(data)) return []
      return (data as Record<string, unknown>[]).map((row) => ({
        orgId: String(row.org_id ?? orgId),
        userId: String(row.user_id ?? ''),
        email: String(row.email ?? ''),
        snapshot: normalizeSnapshot(row.snapshot),
        updatedAt: String(row.updated_at ?? ''),
        completions: isRecord(row.completions)
          ? Object.fromEntries(
              Object.entries(row.completions).filter(
                (entry): entry is [string, string] => typeof entry[1] === 'string'
              )
            )
          : {},
      }))
    } catch {
      return []
    }
  }
  return readLocal().progress.filter((p) => p.orgId === orgId)
}

export interface UpsertSnapshotInput {
  orgId: string
  userId: string
  email: string
  snapshot: ProgressSnapshot
  /** assignmentId → ISO, computed by the caller from the assignments it read. */
  completions: Record<string, string>
}

/**
 * Store (or replace) one learner's snapshot.
 *
 * Refuses without a consent row. The route checks the same thing first; this is
 * the second refusal, and it is the one that survives a future caller that
 * forgets. Returns the stored row.
 */
export async function upsertSnapshot(
  input: UpsertSnapshotInput,
  ctx?: OrgContext
): Promise<ProgressRow> {
  const consent = await getConsent(input.orgId, input.userId, ctx)
  if (!consent) {
    throw new ConsentRequiredError()
  }
  const updatedAt = new Date().toISOString()

  if (shouldUseBackend(ctx)) {
    const { error } = await ctx.client.from(PROGRESS_TABLE).upsert(
      {
        org_id: input.orgId,
        // The VERIFIED caller. A user id from the body never reaches here.
        user_id: ctx.userId,
        email: input.email,
        snapshot: input.snapshot,
        completions: input.completions,
        updated_at: updatedAt,
      },
      { onConflict: 'org_id,user_id' }
    )
    if (error) throw new Error(error.message)
    return {
      orgId: input.orgId,
      userId: input.userId,
      email: input.email,
      snapshot: input.snapshot,
      updatedAt,
      completions: input.completions,
    }
  }

  const key = localKey(input.userId)
  const db = readLocal()
  const row: ProgressRow = {
    orgId: input.orgId,
    userId: key,
    email: input.email,
    snapshot: input.snapshot,
    updatedAt,
    completions: input.completions,
  }
  writeLocal({
    ...db,
    progress: [...db.progress.filter((p) => !(p.orgId === input.orgId && p.userId === key)), row],
  })
  return row
}

/** Thrown by `upsertSnapshot` when the learner has not opted in. */
export class ConsentRequiredError extends Error {
  constructor() {
    super('This learner has not agreed to share their progress with this organisation.')
    this.name = 'ConsentRequiredError'
  }
}

export function isConsentRequiredError(err: unknown): err is ConsentRequiredError {
  return err instanceof ConsentRequiredError
}
