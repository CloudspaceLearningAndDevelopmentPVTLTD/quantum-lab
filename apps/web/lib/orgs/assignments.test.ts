/**
 * assignments.test.ts — the coursework calculations.
 *
 * These are the numbers an instructor grades from, so the assertions are about
 * meaning, not shape. In particular:
 *   · "has not opted in to sharing" must never be reported as "has done nothing"
 *   · a completion timestamp must never move later on a re-share
 *   · a cell in the CSV must never be executed as a spreadsheet formula
 *
 * Every one of these would still be green if the feature were deleted only if
 * the module were deleted with it — each asserts a specific wrong answer the
 * obvious implementation gives.
 */

import { describe, expect, it } from 'vitest'
import {
  assignmentsCsv,
  byDueDate,
  csvCell,
  CSV_COLUMNS,
  dueState,
  evaluateAssignment,
  emptySnapshot,
  isValidDueAt,
  mergeCompletions,
  normalizeItems,
  onTime,
  summarizeAssignment,
  unknownRefs,
  MAX_ITEMS,
  type Assignment,
  type CohortMemberProgress,
  type ProgressSnapshot,
} from '@/lib/orgs/assignments'

const DUE = '2026-03-01T23:59:00.000Z'
const NOW = Date.parse('2026-02-25T12:00:00.000Z')

function assignment(overrides: Partial<Assignment> = {}): Assignment {
  return {
    id: 'a1',
    orgId: 'org-1',
    title: 'Week 3',
    items: [
      { kind: 'lesson', ref: 'what-is-a-qubit' },
      { kind: 'challenge', ref: 'bell-pair' },
    ],
    dueAt: DUE,
    createdBy: 'u-teacher',
    createdAt: '2026-02-01T00:00:00.000Z',
    ...overrides,
  }
}

function snapshot(overrides: Partial<ProgressSnapshot> = {}): ProgressSnapshot {
  return { ...emptySnapshot(), ...overrides }
}

function row(
  email: string,
  snap: ProgressSnapshot | null,
  extra: Partial<CohortMemberProgress> = {}
): CohortMemberProgress {
  return {
    memberId: `m-${email}`,
    email,
    role: 'member',
    userId: `u-${email}`,
    snapshot: snap,
    ...extra,
  }
}

// ────────────────────────────────────────────────────────────

describe('normalizeItems', () => {
  it('drops malformed entries instead of throwing on them', () => {
    const items = normalizeItems([
      { kind: 'lesson', ref: 'a' },
      { kind: 'nonsense', ref: 'b' },
      { kind: 'exam' },
      null,
      'lesson:c',
      { kind: 'challenge', ref: '   ' },
    ])
    expect(items).toEqual([{ kind: 'lesson', ref: 'a' }])
  })

  it('de-duplicates (kind, ref) so a doubled item cannot inflate the denominator', () => {
    const items = normalizeItems([
      { kind: 'lesson', ref: 'a' },
      { kind: 'lesson', ref: 'a' },
      { kind: 'exam', ref: 'a' },
    ])
    expect(items).toEqual([
      { kind: 'lesson', ref: 'a' },
      { kind: 'exam', ref: 'a' },
    ])
  })

  it('caps the list', () => {
    const many = Array.from({ length: MAX_ITEMS + 10 }, (_, i) => ({ kind: 'lesson', ref: `l${i}` }))
    expect(normalizeItems(many)).toHaveLength(MAX_ITEMS)
  })
})

describe('unknownRefs', () => {
  const known = {
    lessons: new Set(['what-is-a-qubit']),
    challenges: new Set(['bell-pair']),
    exams: new Set(['foundations-cert']),
  }

  it('reports items this deployment does not have', () => {
    const missing = unknownRefs(
      [
        { kind: 'lesson', ref: 'what-is-a-qubit' },
        { kind: 'lesson', ref: 'deleted-lesson' },
        { kind: 'exam', ref: 'bell-pair' },
      ],
      known
    )
    expect(missing).toEqual([
      { kind: 'lesson', ref: 'deleted-lesson' },
      // Right id, wrong kind: an exam named after a challenge does not exist.
      { kind: 'exam', ref: 'bell-pair' },
    ])
  })
})

describe('isValidDueAt', () => {
  it('accepts an ISO date and refuses nonsense', () => {
    expect(isValidDueAt(DUE)).toBe(true)
    expect(isValidDueAt('next tuesday')).toBe(false)
    expect(isValidDueAt(1_772_000_000_000)).toBe(false)
    // Far outside the ±10 year window: a typo that would poison "overdue".
    expect(isValidDueAt('1970-01-01T00:00:00.000Z')).toBe(false)
  })
})

describe('evaluateAssignment', () => {
  it('counts an item done only when the matching kind of progress has it', () => {
    // The lesson slug appears in `challenges` and vice versa: a naive
    // implementation that searched all three lists would call this complete.
    const crossed = snapshot({ lessons: ['bell-pair'], challenges: ['what-is-a-qubit'] })
    expect(evaluateAssignment(assignment(), crossed).done).toBe(0)
  })

  it('treats a missing snapshot as nothing done, without throwing', () => {
    const progress = evaluateAssignment(assignment(), null)
    expect(progress.done).toBe(0)
    expect(progress.complete).toBe(false)
    expect(progress.items).toHaveLength(2)
  })

  it('is complete only when every item is done', () => {
    const partial = snapshot({ lessons: ['what-is-a-qubit'] })
    expect(evaluateAssignment(assignment(), partial).complete).toBe(false)
    const all = snapshot({ lessons: ['what-is-a-qubit'], challenges: ['bell-pair'] })
    expect(evaluateAssignment(assignment(), all).complete).toBe(true)
  })

  it('never calls an empty assignment complete', () => {
    expect(evaluateAssignment(assignment({ items: [] }), snapshot()).complete).toBe(false)
  })
})

describe('dueState', () => {
  const done = snapshot({ lessons: ['what-is-a-qubit'], challenges: ['bell-pair'] })

  it('reports complete even after the deadline', () => {
    const a = assignment()
    const late = Date.parse('2026-04-01T00:00:00.000Z')
    expect(dueState(a, evaluateAssignment(a, done), late)).toBe('complete')
  })

  it('reports overdue, due-soon and open from the same assignment', () => {
    const a = assignment()
    const empty = evaluateAssignment(a, null)
    expect(dueState(a, empty, Date.parse('2026-03-02T00:00:00.000Z'))).toBe('overdue')
    expect(dueState(a, empty, Date.parse('2026-02-28T12:00:00.000Z'))).toBe('due-soon')
    expect(dueState(a, empty, NOW)).toBe('open')
  })
})

describe('mergeCompletions', () => {
  const a = assignment()
  const done = snapshot({ lessons: ['what-is-a-qubit'], challenges: ['bell-pair'] })

  it('records the first completion and then never moves it', () => {
    const first = mergeCompletions([a], done, {}, '2026-02-26T09:00:00.000Z')
    expect(first[a.id]).toBe('2026-02-26T09:00:00.000Z')
    // Re-sharing an unchanged snapshot a week later must not make it late.
    const second = mergeCompletions([a], done, first, '2026-03-05T09:00:00.000Z')
    expect(second[a.id]).toBe('2026-02-26T09:00:00.000Z')
  })

  it('drops a timestamp when the assignment is no longer complete', () => {
    const before = { [a.id]: '2026-02-26T09:00:00.000Z' }
    // The instructor added a third item; the learner is no longer finished.
    const widened = assignment({ items: [...a.items, { kind: 'exam', ref: 'foundations-cert' }] })
    expect(mergeCompletions([widened], done, before, '2026-03-05T09:00:00.000Z')).toEqual({})
  })
})

describe('onTime', () => {
  const a = assignment()

  it('is null when there is nothing to judge, not false', () => {
    expect(onTime(a, undefined)).toBeNull()
    expect(onTime(a, 'not a date')).toBeNull()
  })

  it('compares the recorded completion with the deadline', () => {
    expect(onTime(a, '2026-02-27T09:00:00.000Z')).toBe(true)
    expect(onTime(a, '2026-03-02T09:00:00.000Z')).toBe(false)
  })
})

describe('summarizeAssignment', () => {
  const a = assignment()
  const done = snapshot({ lessons: ['what-is-a-qubit'], challenges: ['bell-pair'] })

  it('computes rates over sharers only, and reports the denominator', () => {
    const rows = [row('a@x.edu', done), row('b@x.edu', snapshot()), row('c@x.edu', null)]
    const summary = summarizeAssignment(a, rows, NOW)
    expect(summary.learners).toBe(3)
    expect(summary.sharing).toBe(2)
    expect(summary.completed).toBe(1)
    // 1 of 2 sharers, NOT 1 of 3 people. The non-sharer is not a zero.
    expect(summary.completionRate).toBe(0.5)
  })

  it('returns null rather than 0% when nobody shares', () => {
    const summary = summarizeAssignment(a, [row('c@x.edu', null)], NOW)
    expect(summary.completionRate).toBeNull()
  })

  it('counts nobody overdue before the deadline, and only sharers after it', () => {
    const rows = [row('a@x.edu', done), row('b@x.edu', snapshot()), row('c@x.edu', null)]
    expect(summarizeAssignment(a, rows, NOW).overdue).toBe(0)
    const after = Date.parse('2026-03-02T00:00:00.000Z')
    expect(summarizeAssignment(a, rows, after).overdue).toBe(1)
  })
})

describe('csvCell', () => {
  it('neutralises a formula so a spreadsheet renders it as text', () => {
    // A learner controls their own email address. Without this, opening the
    // gradebook in Excel runs it.
    expect(csvCell('=HYPERLINK("http://evil","x")')).toBe(`"'=HYPERLINK(""http://evil"",""x"")"`)
    expect(csvCell('+1')).toBe(`'+1`)
    expect(csvCell('-alice@x.edu')).toBe(`'-alice@x.edu`)
  })

  it('quotes commas, quotes and newlines, and leaves ordinary text alone', () => {
    expect(csvCell('Week 3, part 2')).toBe('"Week 3, part 2"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell('a\nb')).toBe('"a\nb"')
    expect(csvCell('plain')).toBe('plain')
    expect(csvCell(null)).toBe('')
  })
})

describe('assignmentsCsv', () => {
  const a = assignment()
  const done = snapshot({ lessons: ['what-is-a-qubit'], challenges: ['bell-pair'] })

  it('distinguishes not_shared from not_started', () => {
    const rows = [
      row('quiet@x.edu', null),
      row('trying@x.edu', snapshot()),
      row('finished@x.edu', done, {
        sharedAt: '2026-02-26T09:00:00.000Z',
        completedAt: { a1: '2026-02-26T09:00:00.000Z' },
      }),
    ]
    const csv = assignmentsCsv([a], rows)
    const lines = csv.trim().split('\n')
    expect(lines[0]).toBe(CSV_COLUMNS.join(','))
    // Rows are sorted by email: finished, quiet, trying.
    expect(lines[1]).toContain('finished@x.edu')
    expect(lines[1]).toContain('complete')
    expect(lines[1]).toContain('yes') // on time
    expect(lines[2]).toContain('quiet@x.edu')
    expect(lines[2]).toContain('not_shared')
    expect(lines[3]).toContain('trying@x.edu')
    expect(lines[3]).toContain('not_started')
  })

  it('leaves the item count blank for a non-sharer rather than writing 0', () => {
    const csv = assignmentsCsv([a], [row('quiet@x.edu', null)])
    const cells = csv.trim().split('\n')[1].split(',')
    // student_email, assignment, due_at, items_total, items_complete, status…
    expect(cells[3]).toBe('2')
    expect(cells[4]).toBe('')
    expect(cells[5]).toBe('not_shared')
  })

  it('marks a late completion as on_time=no', () => {
    const csv = assignmentsCsv(
      [a],
      [row('late@x.edu', done, { completedAt: { a1: '2026-03-04T09:00:00.000Z' } })]
    )
    expect(csv.trim().split('\n')[1]).toContain('no')
  })

  it('is byte-identical across two calls with the same data', () => {
    const rows = [row('b@x.edu', done), row('a@x.edu', null)]
    expect(assignmentsCsv([a], rows)).toBe(assignmentsCsv([a], [...rows].reverse()))
  })
})

describe('byDueDate', () => {
  it('sorts soonest first and breaks ties by title', () => {
    const later = assignment({ id: 'a2', dueAt: '2026-04-01T00:00:00.000Z', title: 'B' })
    const tie = assignment({ id: 'a3', title: 'A' })
    expect([later, assignment(), tie].sort(byDueDate).map((a) => a.id)).toEqual(['a3', 'a1', 'a2'])
  })
})
