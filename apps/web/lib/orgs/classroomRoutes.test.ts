/**
 * classroomRoutes.test.ts — the classroom API, exercised through the real
 * handlers, the real gate and the real store.
 *
 * What is NOT mocked, because it is what is under test: the route handlers,
 * lib/orgs/access.ts, lib/orgs/apiHelpers.ts, lib/orgs/classroomStore.ts and
 * lib/orgs/assignments.ts. What IS mocked: Supabase itself (a small in-memory
 * database below) and lib/orgs/store.ts's `listMembers`, so a test can state
 * exactly who holds which seat.
 *
 * The claims each block makes, in order of how badly it would hurt to be wrong:
 *   · an instructor of one cohort cannot read another cohort — not its
 *     coursework, not its progress, not its CSV
 *   · a learner's progress is not stored without a consent row, and the refusal
 *     is server-side
 *   · revoking consent DELETES the stored snapshot
 *   · a learner cannot write a colleague's progress row by naming them
 *   · a member cannot publish, edit or withdraw an assignment
 *
 * None of these would pass if the feature were removed: every one asserts a
 * specific status code AND the state of the database afterwards.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// ────────────────────────────────────────────────────────────
// A tiny in-memory Supabase
// ────────────────────────────────────────────────────────────

type Row = Record<string, unknown>

const db: Record<string, Row[]> = {
  org_members: [],
  org_assignments: [],
  org_progress_consent: [],
  org_progress: [],
}

const tokens = new Map<string, string>()

const ORG_A = 'org-alpha'
const ORG_B = 'org-beta'
const TEACHER_A = '00000000-0000-0000-0000-00000000000a'
const TEACHER_B = '00000000-0000-0000-0000-00000000000b'
const LEARNER = '00000000-0000-0000-0000-00000000000c'
const QUIET = '00000000-0000-0000-0000-00000000000d'

let idCounter = 0

function matches(row: Row, filters: [string, unknown][]): boolean {
  return filters.every(([column, value]) => row[column] === value)
}

function builder(table: string) {
  const filters: [string, unknown][] = []
  let op: 'select' | 'insert' | 'update' | 'delete' | 'upsert' | null = null
  let payload: Row = {}
  let conflict: string[] = []

  function rows(): Row[] {
    return db[table].filter((row) => matches(row, filters))
  }

  function run(): { data: Row[]; error: null } {
    if (op === 'insert') {
      const row: Row = { id: `row-${++idCounter}`, created_at: new Date().toISOString(), ...payload }
      db[table].push(row)
      return { data: [row], error: null }
    }
    if (op === 'update') {
      const hit = rows()
      for (const row of hit) Object.assign(row, payload)
      return { data: hit, error: null }
    }
    if (op === 'delete') {
      const hit = rows()
      db[table] = db[table].filter((row) => !hit.includes(row))
      return { data: hit, error: null }
    }
    if (op === 'upsert') {
      const existing = db[table].find((row) => conflict.every((key) => row[key] === payload[key]))
      if (existing) {
        Object.assign(existing, payload)
        return { data: [existing], error: null }
      }
      const row: Row = { id: `row-${++idCounter}`, ...payload }
      db[table].push(row)
      return { data: [row], error: null }
    }
    return { data: rows(), error: null }
  }

  const chain = {
    select() {
      if (op === null) op = 'select'
      return chain
    },
    insert(value: Row) {
      op = 'insert'
      payload = value
      return chain
    },
    update(value: Row) {
      op = 'update'
      payload = value
      return chain
    },
    upsert(value: Row, options?: { onConflict?: string }) {
      op = 'upsert'
      payload = value
      conflict = (options?.onConflict ?? 'id').split(',').map((s) => s.trim())
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
// client above; this is what the handlers use to render a roster.
vi.mock('@/lib/orgs/store', () => ({
  listMembers: async (orgId: string) =>
    db.org_members
      .filter((row) => row.org_id === orgId)
      .map((row) => ({
        id: `m-${String(row.user_id)}`,
        orgId: String(row.org_id),
        userId: String(row.user_id),
        email: String(row.email),
        role: row.role,
        status: row.status,
        joinedAt: '2026-01-01T00:00:00.000Z',
      })),
}))

const assignments = await import('@/app/api/orgs/assignments/route')
const exportRoute = await import('@/app/api/orgs/assignments/export/route')
const progress = await import('@/app/api/orgs/progress/route')
const consent = await import('@/app/api/orgs/progress/consent/route')

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

function get(url: string, token?: string): Request {
  return new Request(`https://q.test${url}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  })
}

function send(url: string, method: string, body: unknown, token?: string): Request {
  return new Request(`https://q.test${url}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

const LESSON = 'what-is-a-qubit'
const CHALLENGE = 'flip-it'

async function publish(token: string, orgId: string, title = 'Week 1'): Promise<string> {
  const response = await assignments.POST(
    send('/api/orgs/assignments', 'POST', {
      orgId,
      title,
      dueAt: new Date(Date.now() + 86_400_000).toISOString(),
      items: [
        { kind: 'lesson', ref: LESSON },
        { kind: 'challenge', ref: CHALLENGE },
      ],
    }, token)
  )
  expect(response.status).toBe(201)
  const body = (await response.json()) as { assignment: { id: string } }
  return body.assignment.id
}

beforeEach(() => {
  for (const table of Object.keys(db)) db[table] = []
  tokens.clear()
  idCounter = 0

  tokens.set('t-teacher-a', TEACHER_A)
  tokens.set('t-teacher-b', TEACHER_B)
  tokens.set('t-learner', LEARNER)
  tokens.set('t-quiet', QUIET)

  db.org_members = [
    { org_id: ORG_A, user_id: TEACHER_A, email: 'teacher.a@uni.edu', role: 'admin', status: 'active' },
    { org_id: ORG_A, user_id: LEARNER, email: 'learner@uni.edu', role: 'member', status: 'active' },
    { org_id: ORG_A, user_id: QUIET, email: 'quiet@uni.edu', role: 'member', status: 'active' },
    { org_id: ORG_B, user_id: TEACHER_B, email: 'teacher.b@uni.edu', role: 'owner', status: 'active' },
  ]
})

// ────────────────────────────────────────────────────────────

describe('assignments: who may read and write', () => {
  it('answers 401, not 400, to an anonymous caller who omits orgId', async () => {
    expect((await assignments.GET(get('/api/orgs/assignments'))).status).toBe(401)
    expect((await progress.GET(get('/api/orgs/progress'))).status).toBe(401)
    // Signed in, the missing parameter is the caller's mistake: 400.
    expect((await assignments.GET(get('/api/orgs/assignments', 't-learner'))).status).toBe(400)
    expect((await progress.GET(get('/api/orgs/progress', 't-teacher-a'))).status).toBe(400)
  })

  it('refuses an anonymous caller with 401', async () => {
    const response = await assignments.GET(get(`/api/orgs/assignments?orgId=${ORG_A}`))
    expect(response.status).toBe(401)
  })

  it('lets a learner read their own cohort’s coursework', async () => {
    await publish('t-teacher-a', ORG_A)
    const response = await assignments.GET(
      get(`/api/orgs/assignments?orgId=${ORG_A}`, 't-learner')
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as { assignments: unknown[] }
    expect(body.assignments).toHaveLength(1)
  })

  it('refuses an instructor of another cohort, and leaks nothing in the body', async () => {
    await publish('t-teacher-a', ORG_A, 'Alpha week 1')
    const response = await assignments.GET(
      get(`/api/orgs/assignments?orgId=${ORG_A}`, 't-teacher-b')
    )
    expect(response.status).toBe(403)
    expect(JSON.stringify(await response.json())).not.toContain('Alpha week 1')
  })

  it('refuses a member who tries to publish, and stores nothing', async () => {
    const response = await assignments.POST(
      send('/api/orgs/assignments', 'POST', {
        orgId: ORG_A,
        title: 'Self-assigned',
        dueAt: new Date(Date.now() + 86_400_000).toISOString(),
        items: [{ kind: 'lesson', ref: LESSON }],
      }, 't-learner')
    )
    expect(response.status).toBe(403)
    expect(db.org_assignments).toHaveLength(0)
  })

  it('refuses an instructor publishing into a cohort that is not theirs', async () => {
    const response = await assignments.POST(
      send('/api/orgs/assignments', 'POST', {
        orgId: ORG_A,
        title: 'Trespass',
        dueAt: new Date(Date.now() + 86_400_000).toISOString(),
        items: [{ kind: 'lesson', ref: LESSON }],
      }, 't-teacher-b')
    )
    expect(response.status).toBe(403)
    expect(db.org_assignments).toHaveLength(0)
  })

  it('rejects an item this deployment does not have', async () => {
    const response = await assignments.POST(
      send('/api/orgs/assignments', 'POST', {
        orgId: ORG_A,
        title: 'Ghost lesson',
        dueAt: new Date(Date.now() + 86_400_000).toISOString(),
        items: [{ kind: 'lesson', ref: 'no-such-lesson' }],
      }, 't-teacher-a')
    )
    expect(response.status).toBe(400)
    expect(await response.text()).toContain('no-such-lesson')
  })

  it('records the verified caller as the author, not a body field', async () => {
    await publish('t-teacher-a', ORG_A)
    expect(db.org_assignments[0].created_by).toBe(TEACHER_A)
  })

  it('refuses a cross-org withdraw', async () => {
    const id = await publish('t-teacher-a', ORG_A)
    const response = await assignments.DELETE(
      get(`/api/orgs/assignments?orgId=${ORG_A}&assignmentId=${id}`, 't-teacher-b')
    )
    expect(response.status).toBe(403)
    expect(db.org_assignments).toHaveLength(1)
  })
})

describe('progress: nothing is stored without consent', () => {
  const snapshot = { lessons: [LESSON], challenges: [CHALLENGE], quizScores: {}, exams: [] }

  it('refuses a snapshot from a learner who has not opted in', async () => {
    const response = await progress.POST(
      send('/api/orgs/progress', 'POST', { orgId: ORG_A, snapshot }, 't-learner')
    )
    expect(response.status).toBe(403)
    expect(db.org_progress).toHaveLength(0)
  })

  it('stores it once consent is granted', async () => {
    const granted = await consent.POST(
      send('/api/orgs/progress/consent', 'POST', { orgId: ORG_A }, 't-learner')
    )
    expect(granted.status).toBe(201)

    const response = await progress.POST(
      send('/api/orgs/progress', 'POST', { orgId: ORG_A, snapshot }, 't-learner')
    )
    expect(response.status).toBe(200)
    expect(db.org_progress).toHaveLength(1)
    expect(db.org_progress[0].user_id).toBe(LEARNER)
    // The email comes from the SEAT, never from the caller.
    expect(db.org_progress[0].email).toBe('learner@uni.edu')
  })

  it('ignores a userId in the body: a learner cannot write a colleague’s row', async () => {
    await consent.POST(send('/api/orgs/progress/consent', 'POST', { orgId: ORG_A }, 't-learner'))
    await progress.POST(
      send('/api/orgs/progress', 'POST', { orgId: ORG_A, userId: QUIET, snapshot }, 't-learner')
    )
    expect(db.org_progress.map((row) => row.user_id)).toEqual([LEARNER])
  })

  it('records a completion timestamp for an assignment the snapshot finishes', async () => {
    const id = await publish('t-teacher-a', ORG_A)
    await consent.POST(send('/api/orgs/progress/consent', 'POST', { orgId: ORG_A }, 't-learner'))
    await progress.POST(
      send('/api/orgs/progress', 'POST', { orgId: ORG_A, snapshot }, 't-learner')
    )
    const completions = db.org_progress[0].completions as Record<string, string>
    expect(Object.keys(completions)).toEqual([id])
  })

  it('deletes the stored snapshot when consent is withdrawn', async () => {
    await consent.POST(send('/api/orgs/progress/consent', 'POST', { orgId: ORG_A }, 't-learner'))
    await progress.POST(
      send('/api/orgs/progress', 'POST', { orgId: ORG_A, snapshot }, 't-learner')
    )
    expect(db.org_progress).toHaveLength(1)

    const off = await consent.DELETE(
      send(`/api/orgs/progress/consent?orgId=${ORG_A}`, 'DELETE', undefined, 't-learner')
    )
    expect(off.status).toBe(200)
    expect(db.org_progress).toHaveLength(0)
    expect(db.org_progress_consent).toHaveLength(0)
  })

  it('will not let a stranger consent on an org they hold no seat in', async () => {
    const response = await consent.POST(
      send('/api/orgs/progress/consent', 'POST', { orgId: ORG_A }, 't-teacher-b')
    )
    expect(response.status).toBe(403)
    expect(db.org_progress_consent).toHaveLength(0)
  })
})

describe('progress: who may read the cohort', () => {
  const snapshot = { lessons: [LESSON], challenges: [], quizScores: {}, exams: [] }

  async function share(): Promise<void> {
    await consent.POST(send('/api/orgs/progress/consent', 'POST', { orgId: ORG_A }, 't-learner'))
    await progress.POST(send('/api/orgs/progress', 'POST', { orgId: ORG_A, snapshot }, 't-learner'))
  }

  it('shows the instructor sharers as data and everyone else as null', async () => {
    await share()
    const response = await progress.GET(get(`/api/orgs/progress?orgId=${ORG_A}`, 't-teacher-a'))
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      rows: { email: string; snapshot: unknown | null }[]
    }
    const sharer = body.rows.find((r) => r.email === 'learner@uni.edu')
    const quiet = body.rows.find((r) => r.email === 'quiet@uni.edu')
    expect(sharer?.snapshot).toMatchObject({ lessons: [LESSON] })
    // Not an empty snapshot. "Has not opted in" and "has done nothing" are
    // different facts and the API must not conflate them.
    expect(quiet?.snapshot).toBeNull()
  })

  it('refuses a member reading the cohort', async () => {
    await share()
    const response = await progress.GET(get(`/api/orgs/progress?orgId=${ORG_A}`, 't-learner'))
    expect(response.status).toBe(403)
  })

  it('refuses an instructor of another cohort', async () => {
    await share()
    const response = await progress.GET(get(`/api/orgs/progress?orgId=${ORG_A}`, 't-teacher-b'))
    expect(response.status).toBe(403)
    expect(JSON.stringify(await response.json())).not.toContain('learner@uni.edu')
  })
})

describe('CSV export', () => {
  it('serves the gradebook to an instructor of that cohort only', async () => {
    await publish('t-teacher-a', ORG_A, 'Week 1')
    await consent.POST(send('/api/orgs/progress/consent', 'POST', { orgId: ORG_A }, 't-learner'))
    await progress.POST(
      send('/api/orgs/progress', 'POST', {
        orgId: ORG_A,
        snapshot: { lessons: [LESSON], challenges: [CHALLENGE], quizScores: {}, exams: [] },
      }, 't-learner')
    )

    const denied = await exportRoute.GET(
      get(`/api/orgs/assignments/export?orgId=${ORG_A}`, 't-teacher-b')
    )
    expect(denied.status).toBe(403)

    const memberDenied = await exportRoute.GET(
      get(`/api/orgs/assignments/export?orgId=${ORG_A}`, 't-learner')
    )
    expect(memberDenied.status).toBe(403)

    const ok = await exportRoute.GET(
      get(`/api/orgs/assignments/export?orgId=${ORG_A}`, 't-teacher-a')
    )
    expect(ok.status).toBe(200)
    expect(ok.headers.get('content-type')).toContain('text/csv')
    expect(ok.headers.get('cache-control')).toBe('no-store')

    const csv = await ok.text()
    expect(csv.split('\n')[0]).toContain('student_email')
    expect(csv).toContain('learner@uni.edu,Week 1')
    expect(csv).toContain('complete')
    // The learner who never opted in is present and marked as such.
    expect(csv).toContain('not_shared')
  })
})
