/**
 * storeSupabase.test.ts — the Postgres half of the exam store.
 *
 * `attemptRoutes.test.ts` runs the whole feature against the in-memory
 * fallback, which is the right place to test behaviour and the wrong place to
 * test PERSISTENCE: the memory store hands back the same JavaScript object it
 * was given, so `rowToAttempt`/`attemptToRow` never run and a mistyped column
 * name would sail through every one of those assertions.
 *
 * This file sets `SUPABASE_SERVICE_ROLE_KEY`, which selects the Supabase
 * backend, and puts a table double behind it that stores only what was actually
 * written — so a snake_case key that does not survive the round trip fails
 * here. The `exam_attempts` column names it asserts are the ones in
 * supabase/schema-exams.sql; if you rename one there, this goes red, which is
 * the point.
 *
 * What it does NOT prove: that the SQL file itself is valid, or that RLS is
 * configured as its banner says. Neither has ever been run against a live
 * project — same caveat as schema-billing.sql and schema-orgs.sql, and it is
 * written down in STATUS.md rather than glossed over here.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => {
  const tables = new Map<string, Record<string, unknown>[]>()

  function rows(name: string): Record<string, unknown>[] {
    const existing = tables.get(name)
    if (existing) return existing
    const fresh: Record<string, unknown>[] = []
    tables.set(name, fresh)
    return fresh
  }

  function table(name: string) {
    const q = {
      op: 'select' as 'select' | 'insert' | 'update',
      eqs: [] as Array<[string, unknown]>,
      payload: null as Record<string, unknown> | null,
      desc: false,
      orderBy: '',
      max: Infinity,
    }
    const matches = (row: Record<string, unknown>): boolean =>
      q.eqs.every(([col, val]) => row[col] === val)

    function run(mode: 'many' | 'maybe'): Promise<unknown> {
      const all = rows(name)
      if (q.op === 'insert') {
        // Deep-copied on the way in, exactly like a real round trip: a store
        // that hands back the caller's own object cannot catch a lost field.
        all.push(JSON.parse(JSON.stringify(q.payload ?? {})) as Record<string, unknown>)
        return Promise.resolve({ data: null, error: null })
      }
      if (q.op === 'update') {
        for (const hit of all.filter(matches)) {
          Object.assign(hit, JSON.parse(JSON.stringify(q.payload ?? {})))
        }
        return Promise.resolve({ data: null, error: null })
      }
      let hits = all.filter(matches).map((r) => JSON.parse(JSON.stringify(r)))
      if (q.orderBy) {
        hits = hits.sort((a, b) =>
          q.desc
            ? String(b[q.orderBy]).localeCompare(String(a[q.orderBy]))
            : String(a[q.orderBy]).localeCompare(String(b[q.orderBy]))
        )
      }
      if (Number.isFinite(q.max)) hits = hits.slice(0, q.max)
      if (mode === 'maybe') return Promise.resolve({ data: hits[0] ?? null, error: null })
      return Promise.resolve({ data: hits, error: null })
    }

    const api = {
      select() {
        return api
      },
      insert(payload: Record<string, unknown>) {
        q.op = 'insert'
        q.payload = payload
        return api
      },
      update(payload: Record<string, unknown>) {
        q.op = 'update'
        q.payload = payload
        return api
      },
      eq(col: string, val: unknown) {
        q.eqs.push([col, val])
        return api
      },
      order(col: string, opts?: { ascending?: boolean }) {
        q.orderBy = col
        q.desc = opts?.ascending === false
        return api
      },
      limit(n: number) {
        q.max = n
        return api
      },
      maybeSingle: () => run('maybe'),
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        run('many').then(resolve, reject),
    }
    return api
  }

  return { tables, client: { from: (name: string) => table(name) } }
})

vi.mock('@supabase/supabase-js', () => ({ createClient: () => db.client }))
vi.mock('@/lib/supabase', () => ({ isSupabaseConfigured: true, getSupabase: () => db.client }))

// Set BEFORE importing: entitlements.ts reads it at module load, and it is what
// selects the Supabase backend over the in-process fallback.
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.supabase.test'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'

const { getExamStore, ATTEMPTS_TABLE, CERTIFICATES_TABLE } = await import('@/lib/exams/store')
const store = getExamStore()

const attempt = {
  id: 'att_deadbeef',
  examId: 'foundations-cert',
  subjectKind: 'user' as const,
  subjectId: 'user-1',
  startedAt: '2026-08-17T10:00:00.000Z',
  expiresAt: '2026-08-17T10:25:00.000Z',
  questionIds: ['f01', 'f02', 'f03'],
  answers: {
    f01: { questionId: 'f01', selectedIds: ['a'], flagged: false },
    f02: { questionId: 'f02', selectedIds: [], numberValue: 0.5, flagged: true },
  },
}

beforeEach(() => {
  db.tables.clear()
})

describe('the Supabase-backed exam store', () => {
  it('selects the durable backend when a service-role key is present', () => {
    expect(store.kind).toBe('supabase')
    expect(store.durable).toBe(true)
  })

  it('writes the columns supabase/schema-exams.sql declares', async () => {
    await store.insertAttempt(attempt)
    const row = (db.tables.get(ATTEMPTS_TABLE) ?? [])[0] as Record<string, unknown>

    expect(Object.keys(row).sort()).toEqual(
      [
        'answers',
        'certificate_id',
        'closed_by',
        'exam_id',
        'expires_at',
        'id',
        'passed',
        'question_ids',
        'score',
        'started_at',
        'subject_id',
        'subject_kind',
        'submitted_at',
      ].sort()
    )
    expect(row.subject_kind).toBe('user')
    expect(row.question_ids).toEqual(['f01', 'f02', 'f03'])
    // An open attempt has neither, which is what the CHECK constraint pairs.
    expect(row.score).toBeNull()
    expect(row.submitted_at).toBeNull()
  })

  it('round-trips an attempt without losing a field', async () => {
    await store.insertAttempt(attempt)
    const read = await store.getAttempt(attempt.id)
    expect(read).toEqual(attempt)
  })

  it('round-trips a graded attempt, including the optional fields', async () => {
    const graded = {
      ...attempt,
      submittedAt: '2026-08-17T10:20:00.000Z',
      closedBy: 'candidate' as const,
      score: 0.8,
      passed: true,
      certificateId: 'QL-AAAAA-AAAAA-4',
    }
    await store.insertAttempt(attempt)
    await store.updateAttempt(graded)
    expect(await store.getAttempt(attempt.id)).toEqual(graded)
  })

  it('finds a subject latest attempt at one exam, newest first', async () => {
    await store.insertAttempt({ ...attempt, id: 'att_old', startedAt: '2026-08-01T10:00:00.000Z' })
    await store.insertAttempt({ ...attempt, id: 'att_new', startedAt: '2026-08-16T10:00:00.000Z' })
    // Same subject, different exam: must not be returned for this one.
    await store.insertAttempt({
      ...attempt,
      id: 'att_other_exam',
      examId: 'advanced-cert',
      startedAt: '2026-08-17T10:00:00.000Z',
    })

    const latest = await store.latestAttempt('user-1', 'foundations-cert')
    expect(latest?.id).toBe('att_new')
    expect((await store.listAttempts('user-1')).map((a) => a.id)).toEqual([
      'att_other_exam',
      'att_new',
      'att_old',
    ])
  })

  it('returns null rather than inventing an attempt for an unknown id', async () => {
    expect(await store.getAttempt('att_nope')).toBeNull()
    expect(await store.latestAttempt('nobody', 'foundations-cert')).toBeNull()
  })

  it('round-trips a certificate and finds it by attempt', async () => {
    const record = {
      id: 'QL-4F2AH-9C31T-K',
      userId: 'user-1',
      examId: 'foundations-cert',
      attemptId: attempt.id,
      displayName: 'Ada Lovelace',
      score: 0.93,
      issuedAt: '2026-08-17T10:21:00.000Z',
    }
    await store.insertCertificate(record)

    const row = (db.tables.get(CERTIFICATES_TABLE) ?? [])[0] as Record<string, unknown>
    expect(row.display_name).toBe('Ada Lovelace')
    expect(row.user_id).toBe('user-1')

    expect(await store.getCertificate(record.id)).toEqual(record)
    expect(await store.certificateForAttempt(attempt.id)).toEqual(record)
    expect(await store.getCertificate('QL-AAAAA-AAAAA-4')).toBeNull()
  })
})
