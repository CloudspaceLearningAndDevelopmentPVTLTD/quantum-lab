/**
 * classesRoutes.test.ts — the classes API, exercised through the real handlers,
 * the real gate and the real store, exactly as classroomRoutes.test.ts does for
 * assignments. Mocked: Supabase itself (the same style of in-memory database)
 * and lib/orgs/store's `listMembers`, so a test can state who holds which seat.
 *
 * The claims, in order of how badly each would hurt to be wrong:
 *   · an instructor of one licence cannot create, roster or delete classes in
 *     another, and cannot publish into another licence's class
 *   · a learner seat can read the class list but cannot write any of it
 *   · a roster may only name seats OF THIS LICENCE — a seat id from another
 *     org is refused as a whole
 *   · publishing through the original assignments route still stores
 *     class_id null — the pre-classes default is untouched
 *   · publishing through the classes route stores the class, after proving the
 *     class belongs to the org named in the request
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// ────────────────────────────────────────────────────────────
// A tiny in-memory Supabase (extended: multi-row inserts, for rosters)
// ────────────────────────────────────────────────────────────

type Row = Record<string, unknown>

const db: Record<string, Row[]> = {
  org_members: [],
  org_assignments: [],
  org_classes: [],
  org_class_members: [],
}

const tokens = new Map<string, string>()

const ORG_A = 'org-alpha'
const ORG_B = 'org-beta'
const TEACHER_A = '00000000-0000-0000-0000-00000000000a'
const TEACHER_B = '00000000-0000-0000-0000-00000000000b'
const LEARNER = '00000000-0000-0000-0000-00000000000c'

let idCounter = 0

function matches(row: Row, filters: [string, unknown][]): boolean {
  return filters.every(([column, value]) => row[column] === value)
}

function builder(table: string) {
  const filters: [string, unknown][] = []
  let op: 'select' | 'insert' | 'update' | 'delete' | null = null
  let payload: Row[] = []

  function rows(): Row[] {
    return db[table].filter((row) => matches(row, filters))
  }

  function run(): { data: Row[]; error: null } {
    if (op === 'insert') {
      const added = payload.map((value) => ({
        id: `row-${++idCounter}`,
        created_at: new Date().toISOString(),
        ...value,
      }))
      db[table].push(...added)
      return { data: added, error: null }
    }
    if (op === 'update') {
      const hit = rows()
      for (const row of hit) Object.assign(row, payload[0] ?? {})
      return { data: hit, error: null }
    }
    if (op === 'delete') {
      const hit = rows()
      db[table] = db[table].filter((row) => !hit.includes(row))
      return { data: hit, error: null }
    }
    return { data: rows(), error: null }
  }

  const chain = {
    select() {
      if (op === null) op = 'select'
      return chain
    },
    insert(value: Row | Row[]) {
      op = 'insert'
      payload = Array.isArray(value) ? value : [value]
      return chain
    },
    update(value: Row) {
      op = 'update'
      payload = [value]
      return chain
    },
    delete() {
      op = 'delete'
      return chain
    },
    eq(column: string, value: unknown) {
      filters.push([column, value])
      return chain
    },
    order() {
      return chain
    },
    async maybeSingle() {
      const { data } = run()
      return { data: data[0] ?? null, error: null }
    },
    async single() {
      const { data } = run()
      return data[0]
        ? { data: data[0], error: null }
        : { data: null, error: { message: 'no rows' } }
    },
    then(resolve: (value: { data: Row[]; error: null }) => unknown) {
      return Promise.resolve(run()).then(resolve)
    },
  }
  return chain
}

const fakeClient = {
  from: (table: string) => builder(table),
}

vi.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: true,
  getSupabase: () => ({
    auth: {
      getUser: async (token: string) => {
        const id = tokens.get(token)
        return id
          ? { data: { user: { id } }, error: null }
          : { data: { user: null }, error: { message: 'invalid token' } }
      },
    },
  }),
}))

vi.mock('@/lib/billing/entitlements', () => ({
  getServiceSupabase: () => fakeClient,
}))

// Seats: data, not authorisation. The gate reads org_members through the fake
// client above; this is what the roster check in PATCH resolves seats with.
vi.mock('@/lib/orgs/store', () => ({
  listMembers: async (orgId: string) =>
    db.org_members
      .filter((row) => row.org_id === orgId)
      .map((row) => ({
        id: String(row.id),
        orgId: String(row.org_id),
        userId: String(row.user_id),
        email: String(row.email),
        role: row.role,
        status: row.status,
        joinedAt: '2026-01-01T00:00:00.000Z',
      })),
}))

const classes = await import('@/app/api/orgs/classes/route')
const classAssignments = await import('@/app/api/orgs/classes/assignments/route')
const assignments = await import('@/app/api/orgs/assignments/route')

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

// The real in-memory rate limiter is live in these handlers and keys on
// x-forwarded-for. Give every request its own address so this file exercises
// authorisation, not the limiter — which has its own tests.
let ipCounter = 0
function nextIp(): string {
  return `10.0.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`
}

function get(url: string, token?: string): Request {
  return new Request(`https://q.test${url}`, {
    headers: {
      'x-forwarded-for': nextIp(),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  })
}

function send(url: string, method: string, body: unknown, token?: string): Request {
  return new Request(`https://q.test${url}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': nextIp(),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

const LESSON = 'what-is-a-qubit'

async function makeClass(token: string, orgId: string, name = 'Tuesday'): Promise<string> {
  const response = await classes.POST(send('/api/orgs/classes', 'POST', { orgId, name }, token))
  expect(response.status).toBe(201)
  const body = (await response.json()) as { class: { id: string } }
  return body.class.id
}

beforeEach(() => {
  for (const table of Object.keys(db)) db[table] = []
  tokens.clear()
  idCounter = 0

  tokens.set('t-teacher-a', TEACHER_A)
  tokens.set('t-teacher-b', TEACHER_B)
  tokens.set('t-learner', LEARNER)

  db.org_members = [
    { id: 'seat-teacher-a', org_id: ORG_A, user_id: TEACHER_A, email: 'teacher.a@uni.edu', role: 'admin', status: 'active' },
    { id: 'seat-learner', org_id: ORG_A, user_id: LEARNER, email: 'learner@uni.edu', role: 'member', status: 'active' },
    { id: 'seat-teacher-b', org_id: ORG_B, user_id: TEACHER_B, email: 'teacher.b@uni.edu', role: 'owner', status: 'active' },
  ]
})

// ────────────────────────────────────────────────────────────

describe('classes: who may read and write', () => {
  it('answers 401, not 400, to an anonymous caller who omits orgId', async () => {
    expect((await classes.GET(get('/api/orgs/classes'))).status).toBe(401)
    expect((await classes.GET(get('/api/orgs/classes', 't-learner'))).status).toBe(400)
  })

  it('refuses an anonymous caller with 401', async () => {
    const response = await classes.GET(get(`/api/orgs/classes?orgId=${ORG_A}`))
    expect(response.status).toBe(401)
  })

  it('lets any active seat read the class list', async () => {
    await makeClass('t-teacher-a', ORG_A)
    const response = await classes.GET(get(`/api/orgs/classes?orgId=${ORG_A}`, 't-learner'))
    expect(response.status).toBe(200)
    const body = (await response.json()) as { classes: unknown[]; memberships: unknown[] }
    expect(body.classes).toHaveLength(1)
    expect(body.memberships).toEqual([])
  })

  it('records the verified caller as the creator, not a body field', async () => {
    await makeClass('t-teacher-a', ORG_A)
    expect(db.org_classes[0].created_by).toBe(TEACHER_A)
  })

  it('refuses a learner creating a class, and stores nothing', async () => {
    const response = await classes.POST(
      send('/api/orgs/classes', 'POST', { orgId: ORG_A, name: 'Self-made' }, 't-learner')
    )
    expect(response.status).toBe(403)
    expect(db.org_classes).toHaveLength(0)
  })

  it('refuses an instructor of another licence, and leaks nothing in the body', async () => {
    await makeClass('t-teacher-a', ORG_A, 'Alpha only')
    const denied = await classes.GET(get(`/api/orgs/classes?orgId=${ORG_A}`, 't-teacher-b'))
    expect(denied.status).toBe(403)
    expect(JSON.stringify(await denied.json())).not.toContain('Alpha only')

    const write = await classes.POST(
      send('/api/orgs/classes', 'POST', { orgId: ORG_A, name: 'Trespass' }, 't-teacher-b')
    )
    expect(write.status).toBe(403)
    expect(db.org_classes).toHaveLength(1)
  })

  it('refuses a duplicate class name on the same licence', async () => {
    await makeClass('t-teacher-a', ORG_A, 'Tuesday')
    const response = await classes.POST(
      send('/api/orgs/classes', 'POST', { orgId: ORG_A, name: 'tuesday' }, 't-teacher-a')
    )
    expect(response.status).toBe(409)
    expect(db.org_classes).toHaveLength(1)
  })
})

describe('classes: rosters', () => {
  it('sets a roster of this licence’s seats, and replaces it wholesale', async () => {
    const classId = await makeClass('t-teacher-a', ORG_A)
    const first = await classes.PATCH(
      send('/api/orgs/classes', 'PATCH', { orgId: ORG_A, classId, memberIds: ['seat-learner', 'seat-teacher-a'] }, 't-teacher-a')
    )
    expect(first.status).toBe(200)
    expect(db.org_class_members).toHaveLength(2)

    const second = await classes.PATCH(
      send('/api/orgs/classes', 'PATCH', { orgId: ORG_A, classId, memberIds: ['seat-learner'] }, 't-teacher-a')
    )
    expect(second.status).toBe(200)
    expect(db.org_class_members.map((r) => r.member_id)).toEqual(['seat-learner'])
  })

  it('refuses a seat id from another licence, as a whole', async () => {
    const classId = await makeClass('t-teacher-a', ORG_A)
    const response = await classes.PATCH(
      send('/api/orgs/classes', 'PATCH', { orgId: ORG_A, classId, memberIds: ['seat-learner', 'seat-teacher-b'] }, 't-teacher-a')
    )
    expect(response.status).toBe(400)
    expect(db.org_class_members).toHaveLength(0)
  })

  it('refuses a learner writing a roster', async () => {
    const classId = await makeClass('t-teacher-a', ORG_A)
    const response = await classes.PATCH(
      send('/api/orgs/classes', 'PATCH', { orgId: ORG_A, classId, memberIds: ['seat-learner'] }, 't-learner')
    )
    expect(response.status).toBe(403)
    expect(db.org_class_members).toHaveLength(0)
  })

  it('refuses a roster for a class of another licence', async () => {
    const classId = await makeClass('t-teacher-b', ORG_B, 'Beta class')
    const response = await classes.PATCH(
      send('/api/orgs/classes', 'PATCH', { orgId: ORG_A, classId, memberIds: ['seat-learner'] }, 't-teacher-a')
    )
    expect(response.status).toBe(404)
    expect(db.org_class_members).toHaveLength(0)
  })
})

describe('class-scoped publishing', () => {
  const valid = {
    title: 'Week 1',
    dueAt: new Date(Date.now() + 86_400_000).toISOString(),
    items: [{ kind: 'lesson', ref: LESSON }],
  }

  it('the original assignments route still stores class_id null — the default is untouched', async () => {
    const response = await assignments.POST(
      send('/api/orgs/assignments', 'POST', { orgId: ORG_A, ...valid }, 't-teacher-a')
    )
    expect(response.status).toBe(201)
    expect(db.org_assignments).toHaveLength(1)
    expect(db.org_assignments[0].class_id ?? null).toBeNull()
  })

  it('publishes to a class of this licence and stores the target', async () => {
    const classId = await makeClass('t-teacher-a', ORG_A)
    const response = await classAssignments.POST(
      send('/api/orgs/classes/assignments', 'POST', { orgId: ORG_A, classId, ...valid }, 't-teacher-a')
    )
    expect(response.status).toBe(201)
    const body = (await response.json()) as { assignment: { classId?: string } }
    expect(body.assignment.classId).toBe(classId)
    expect(db.org_assignments[0].class_id).toBe(classId)
    expect(db.org_assignments[0].created_by).toBe(TEACHER_A)
  })

  it('refuses a class id belonging to another licence, storing nothing', async () => {
    const foreign = await makeClass('t-teacher-b', ORG_B, 'Beta class')
    const response = await classAssignments.POST(
      send('/api/orgs/classes/assignments', 'POST', { orgId: ORG_A, classId: foreign, ...valid }, 't-teacher-a')
    )
    expect(response.status).toBe(404)
    expect(db.org_assignments).toHaveLength(0)
  })

  it('refuses a learner, storing nothing', async () => {
    const classId = await makeClass('t-teacher-a', ORG_A)
    const response = await classAssignments.POST(
      send('/api/orgs/classes/assignments', 'POST', { orgId: ORG_A, classId, ...valid }, 't-learner')
    )
    expect(response.status).toBe(403)
    expect(db.org_assignments).toHaveLength(0)
  })

  it('still validates the items exist in this deployment', async () => {
    const classId = await makeClass('t-teacher-a', ORG_A)
    const response = await classAssignments.POST(
      send('/api/orgs/classes/assignments', 'POST', {
        orgId: ORG_A,
        classId,
        ...valid,
        items: [{ kind: 'lesson', ref: 'no-such-lesson' }],
      }, 't-teacher-a')
    )
    expect(response.status).toBe(400)
    expect(await response.text()).toContain('no-such-lesson')
    expect(db.org_assignments).toHaveLength(0)
  })
})

describe('deleting a class', () => {
  it('a manager removes a class and its roster rows go with it', async () => {
    const classId = await makeClass('t-teacher-a', ORG_A)
    await classes.PATCH(
      send('/api/orgs/classes', 'PATCH', { orgId: ORG_A, classId, memberIds: ['seat-learner'] }, 't-teacher-a')
    )
    const response = await classes.DELETE(
      get(`/api/orgs/classes?orgId=${ORG_A}&classId=${classId}`, 't-teacher-a')
    )
    expect(response.status).toBe(200)
    expect(db.org_classes).toHaveLength(0)
    // The fake database has no FK cascades; assert the class itself is gone and
    // note that org_class_members cleanup is the schema's ON DELETE CASCADE,
    // exercised in local mode by classes.test.ts.
  })

  it('refuses a learner deleting a class', async () => {
    const classId = await makeClass('t-teacher-a', ORG_A)
    const response = await classes.DELETE(
      get(`/api/orgs/classes?orgId=${ORG_A}&classId=${classId}`, 't-learner')
    )
    expect(response.status).toBe(403)
    expect(db.org_classes).toHaveLength(1)
  })

  it('refuses an instructor of another licence deleting a class', async () => {
    const classId = await makeClass('t-teacher-a', ORG_A)
    const response = await classes.DELETE(
      get(`/api/orgs/classes?orgId=${ORG_A}&classId=${classId}`, 't-teacher-b')
    )
    expect(response.status).toBe(403)
    expect(db.org_classes).toHaveLength(1)
  })
})
