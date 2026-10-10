/**
 * classes.test.ts — per-class targeting: the pure rule, and the store.
 *
 * Two halves:
 *
 *   · `assignmentAppliesTo` and friends in lib/orgs/assignments.ts — the ONE
 *     place the "no classId means everyone" rule lives. The first block pins
 *     that rule down, because every completion figure the instructor console
 *     shows is computed through it.
 *   · classroomStore's class functions in LOCAL mode, against a stubbed
 *     window.localStorage — creating and listing classes, replacing a roster
 *     wholesale, and the two invariants that must survive a class being
 *     deleted: its memberships go with it, and its assignments DO NOT — they
 *     fall back to targeting the whole licence, mirroring the schema's
 *     ON DELETE SET NULL.
 *
 * The backend paths of the same functions are exercised end-to-end through the
 * real route handlers in classesRoutes.test.ts, the same split
 * classroomRoutes.test.ts uses for assignments.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  assignmentAppliesTo,
  classIdsForMember,
  memberIdsOfClass,
  type Assignment,
  type ClassMembership,
} from '@/lib/orgs/assignments'
import {
  createAssignment,
  createClass,
  deleteClass,
  listAssignments,
  listClasses,
  listClassMemberships,
  setClassMembers,
} from '@/lib/orgs/classroomStore'

// ────────────────────────────────────────────────────────────
// The pure rule
// ────────────────────────────────────────────────────────────

function assignment(overrides: Partial<Assignment> = {}): Assignment {
  return {
    id: 'a1',
    orgId: 'org-1',
    title: 'Week 1',
    items: [{ kind: 'lesson', ref: 'what-is-a-qubit' }],
    dueAt: '2026-09-01T00:00:00.000Z',
    createdBy: 'teacher',
    createdAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('assignmentAppliesTo', () => {
  it('applies to everyone when there is no classId — the pre-classes default', () => {
    expect(assignmentAppliesTo(assignment(), new Set())).toBe(true)
    expect(assignmentAppliesTo(assignment(), new Set(['class-1']))).toBe(true)
  })

  it('applies only to seats in the named class when there is one', () => {
    const scoped = assignment({ classId: 'class-1' })
    expect(assignmentAppliesTo(scoped, new Set(['class-1']))).toBe(true)
    expect(assignmentAppliesTo(scoped, new Set(['class-2']))).toBe(false)
    expect(assignmentAppliesTo(scoped, new Set())).toBe(false)
  })
})

describe('membership helpers', () => {
  const memberships: ClassMembership[] = [
    { classId: 'class-1', memberId: 'seat-a' },
    { classId: 'class-1', memberId: 'seat-b' },
    { classId: 'class-2', memberId: 'seat-a' },
  ]

  it('collects the classes of one seat', () => {
    expect(classIdsForMember(memberships, 'seat-a')).toEqual(new Set(['class-1', 'class-2']))
    expect(classIdsForMember(memberships, 'seat-z')).toEqual(new Set())
  })

  it('collects the seats of one class', () => {
    expect(memberIdsOfClass(memberships, 'class-1')).toEqual(new Set(['seat-a', 'seat-b']))
    expect(memberIdsOfClass(memberships, 'class-9')).toEqual(new Set())
  })
})

// ────────────────────────────────────────────────────────────
// The store, in local (browser) mode
// ────────────────────────────────────────────────────────────

describe('classroomStore classes (local mode)', () => {
  beforeEach(() => {
    const backing = new Map<string, string>()
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => backing.get(key) ?? null,
        setItem: (key: string, value: string) => void backing.set(key, value),
        removeItem: (key: string) => void backing.delete(key),
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('creates and lists classes per org', async () => {
    const made = await createClass({ orgId: 'org-1', name: 'Tuesday', createdBy: 'teacher' })
    await createClass({ orgId: 'org-2', name: 'Other licence', createdBy: 'teacher' })

    const listed = await listClasses('org-1')
    expect(listed).toHaveLength(1)
    expect(listed[0]).toMatchObject({ id: made.id, orgId: 'org-1', name: 'Tuesday' })
  })

  it('replaces a roster wholesale, scoped to the class', async () => {
    const a = await createClass({ orgId: 'org-1', name: 'A', createdBy: 't' })
    const b = await createClass({ orgId: 'org-1', name: 'B', createdBy: 't' })
    await setClassMembers('org-1', a.id, ['seat-1', 'seat-2'])
    await setClassMembers('org-1', b.id, ['seat-2'])

    // Shrinking the roster must remove, not merge.
    await setClassMembers('org-1', a.id, ['seat-2'])

    const memberships = await listClassMemberships('org-1')
    expect(memberIdsOfClass(memberships, a.id)).toEqual(new Set(['seat-2']))
    expect(memberIdsOfClass(memberships, b.id)).toEqual(new Set(['seat-2']))
  })

  it('creates assignments untargeted by default — zero change for existing callers', async () => {
    const made = await createAssignment({
      orgId: 'org-1',
      title: 'Week 1',
      items: [{ kind: 'lesson', ref: 'what-is-a-qubit' }],
      dueAt: '2026-09-01T00:00:00.000Z',
      createdBy: 'teacher',
    })
    expect(made.classId).toBeUndefined()
    const listed = await listAssignments('org-1')
    expect(listed[0].classId).toBeUndefined()
  })

  it('stores a class target when one is given', async () => {
    const cls = await createClass({ orgId: 'org-1', name: 'A', createdBy: 't' })
    const made = await createAssignment({
      orgId: 'org-1',
      classId: cls.id,
      title: 'Scoped',
      items: [{ kind: 'lesson', ref: 'what-is-a-qubit' }],
      dueAt: '2026-09-01T00:00:00.000Z',
      createdBy: 'teacher',
    })
    expect(made.classId).toBe(cls.id)
    const listed = await listAssignments('org-1')
    expect(listed.find((a) => a.id === made.id)?.classId).toBe(cls.id)
  })

  it('deleting a class keeps its assignments and retargets them to everyone', async () => {
    const cls = await createClass({ orgId: 'org-1', name: 'A', createdBy: 't' })
    await setClassMembers('org-1', cls.id, ['seat-1'])
    const made = await createAssignment({
      orgId: 'org-1',
      classId: cls.id,
      title: 'Survivor',
      items: [{ kind: 'lesson', ref: 'what-is-a-qubit' }],
      dueAt: '2026-09-01T00:00:00.000Z',
      createdBy: 'teacher',
    })

    expect(await deleteClass('org-1', cls.id)).toBe(true)

    expect(await listClasses('org-1')).toHaveLength(0)
    expect(await listClassMemberships('org-1')).toHaveLength(0)
    const listed = await listAssignments('org-1')
    const survivor = listed.find((a) => a.id === made.id)
    expect(survivor).toBeDefined()
    // The schema says ON DELETE SET NULL; local mode must agree.
    expect(survivor?.classId).toBeUndefined()
  })

  it('refuses to delete a class of another org', async () => {
    const cls = await createClass({ orgId: 'org-1', name: 'A', createdBy: 't' })
    expect(await deleteClass('org-2', cls.id)).toBe(false)
    expect(await listClasses('org-1')).toHaveLength(1)
  })
})
