'use client'

/**
 * AssignmentComposer — pick work, set a deadline, publish it to the cohort.
 *
 * Deliberately one screen with no wizard: the whole job is a title, a date and
 * a list of items, and every extra step is a place for an instructor to lose
 * what they typed.
 *
 * What this component does NOT do, and must not start doing: decide who may
 * publish. The Publish button is hidden for a member, but that is convenience,
 * not a control — `POST /api/orgs/assignments` re-checks the caller's role
 * against this org server-side and refuses. If you ever find yourself relying on
 * the hidden button, read the note at the top of docs/CLASSROOM.md.
 */

import { useCallback, useMemo, useState } from 'react'
import {
  MAX_CLASS_NAME,
  MAX_INSTRUCTIONS,
  MAX_ITEMS,
  MAX_TITLE,
  type Assignment,
  type AssignmentItem,
  type AssignmentItemKind,
  type OrgClass,
} from '@/lib/orgs/assignments'
import { CATALOGUE, KIND_LABEL } from '@/lib/orgs/itemLabels'
import { createCohortClass, publishAssignment } from '@/lib/orgs/classroomClient'

export interface AssignmentComposerProps {
  orgId: string
  onPublished: (assignment: Assignment) => void
  /**
   * The licence's classes, loaded by the parent (which also needs them for its
   * own filters). With the prop omitted entirely the composer shows no class
   * control and publishes exactly as it did before classes existed; passing an
   * array (even an empty one) opens the class picker and the "new class" field.
   */
  classes?: OrgClass[]
  /** Called after "New class" succeeds, so the parent can refresh its list. */
  onClassCreated?: (created: OrgClass) => void
}

const KINDS: AssignmentItemKind[] = ['lesson', 'challenge', 'exam']

/** Default deadline: a week out, at the end of that day in local time. */
function defaultDue(): string {
  const date = new Date(Date.now() + 7 * 86_400_000)
  date.setHours(23, 59, 0, 0)
  // `datetime-local` wants a local-time string with no zone, hence the manual
  // formatting — toISOString() would silently shift the instructor's evening
  // deadline by their UTC offset.
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`
}

export default function AssignmentComposer({
  orgId,
  onPublished,
  classes,
  onClassCreated,
}: AssignmentComposerProps) {
  const [title, setTitle] = useState('')
  const [instructions, setInstructions] = useState('')
  const [due, setDue] = useState(defaultDue)
  const [kind, setKind] = useState<AssignmentItemKind>('lesson')
  const [selected, setSelected] = useState<AssignmentItem[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** '' targets everyone on the licence — the only behaviour before classes. */
  const [classId, setClassId] = useState('')
  const [newClassName, setNewClassName] = useState('')
  const [creatingClass, setCreatingClass] = useState(false)

  const withClasses = classes !== undefined

  const selectedKeys = useMemo(
    () => new Set(selected.map((item) => `${item.kind}:${item.ref}`)),
    [selected]
  )

  const toggle = useCallback((item: AssignmentItem) => {
    setSelected((current) => {
      const key = `${item.kind}:${item.ref}`
      const without = current.filter((i) => `${i.kind}:${i.ref}` !== key)
      if (without.length !== current.length) return without
      if (current.length >= MAX_ITEMS) return current
      return [...current, item]
    })
  }, [])

  const publish = useCallback(async () => {
    setError(null)
    const trimmed = title.trim()
    if (!trimmed) {
      setError('Give the assignment a title your cohort will recognise.')
      return
    }
    if (selected.length === 0) {
      setError('Pick at least one lesson, challenge or exam.')
      return
    }
    const dueMs = Date.parse(due)
    if (!Number.isFinite(dueMs)) {
      setError('That due date could not be read.')
      return
    }
    if (dueMs < Date.now()) {
      setError('That due date is in the past. Learners would see it overdue the moment it appears.')
      return
    }

    setBusy(true)
    try {
      const assignment = await publishAssignment({
        orgId,
        // '' (everyone) publishes through the original path, untouched by the
        // classes feature. Only a real selection adds a target.
        ...(classId ? { classId } : {}),
        title: trimmed,
        ...(instructions.trim() ? { instructions: instructions.trim() } : {}),
        items: selected,
        dueAt: new Date(dueMs).toISOString(),
      })
      setTitle('')
      setInstructions('')
      setSelected([])
      setDue(defaultDue())
      onPublished(assignment)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not publish that assignment.')
    } finally {
      setBusy(false)
    }
  }, [title, instructions, due, selected, classId, orgId, onPublished])

  const addClass = useCallback(async () => {
    const name = newClassName.trim()
    if (!name) return
    setError(null)
    setCreatingClass(true)
    try {
      const created = await createCohortClass(orgId, name)
      setNewClassName('')
      // Target the class just created: an instructor who names a class while
      // composing is almost always about to publish to it.
      setClassId(created.id)
      onClassCreated?.(created)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create that class.')
    } finally {
      setCreatingClass(false)
    }
  }, [newClassName, orgId, onClassCreated])

  return (
    <div className="card p-5">
      <span className="section-label">New assignment</span>
      <h3 className="mt-1 text-base font-semibold text-ink">Set work for this cohort</h3>
      <p className="section-desc mt-1">
        Everyone holding a seat sees it, with a checklist they can tick off by doing the work.
      </p>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div>
          <label htmlFor="assignment-title" className="text-xs font-semibold text-ink-secondary">
            Title
          </label>
          <input
            id="assignment-title"
            type="text"
            maxLength={MAX_TITLE}
            placeholder="Week 3 — interference and the double slit"
            className="focus-ring mt-1 w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink placeholder:text-ink-muted"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={busy}
          />
        </div>
        <div>
          <label htmlFor="assignment-due" className="text-xs font-semibold text-ink-secondary">
            Due
          </label>
          <input
            id="assignment-due"
            type="datetime-local"
            className="focus-ring mt-1 w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink"
            value={due}
            onChange={(e) => setDue(e.target.value)}
            disabled={busy}
          />
        </div>
      </div>

      <div className="mt-3">
        <label htmlFor="assignment-notes" className="text-xs font-semibold text-ink-secondary">
          Instructions <span className="font-normal text-ink-muted">(optional)</span>
        </label>
        <textarea
          id="assignment-notes"
          rows={2}
          maxLength={MAX_INSTRUCTIONS}
          placeholder="Bring one question about interference to Thursday's seminar."
          className="focus-ring mt-1 w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink placeholder:text-ink-muted"
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          disabled={busy}
        />
      </div>

      {/* ── Class targeting ─────────────────────────────────────
          Rendered only when the parent supplies classes. A class narrows who
          the work is FOR (and the completion figures computed from it); it is
          not a visibility wall — every seat on the licence can still read the
          licence's coursework, and the caption below says so. */}
      {withClasses ? (
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div>
            <label htmlFor="assignment-class" className="text-xs font-semibold text-ink-secondary">
              Assign to
            </label>
            <select
              id="assignment-class"
              className="focus-ring mt-1 w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink"
              value={classId}
              onChange={(e) => setClassId(e.target.value)}
              disabled={busy}
            >
              <option value="">Everyone on the licence</option>
              {(classes ?? []).map((cls) => (
                <option key={cls.id} value={cls.id}>
                  {cls.name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-ink-muted">
              A class sets who the work counts for. It does not hide the assignment from the rest
              of the licence.
            </p>
          </div>
          <div>
            <label htmlFor="assignment-new-class" className="text-xs font-semibold text-ink-secondary">
              New class <span className="font-normal text-ink-muted">(optional)</span>
            </label>
            <div className="mt-1 flex gap-2">
              <input
                id="assignment-new-class"
                type="text"
                maxLength={MAX_CLASS_NAME}
                placeholder="PHYS 201, Tuesday section"
                className="focus-ring w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink placeholder:text-ink-muted"
                value={newClassName}
                onChange={(e) => setNewClassName(e.target.value)}
                disabled={busy || creatingClass}
              />
              <button
                type="button"
                className="btn-ghost focus-ring shrink-0 text-xs"
                onClick={() => void addClass()}
                disabled={busy || creatingClass || !newClassName.trim()}
              >
                {creatingClass ? 'Creating…' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ── Item picker ─────────────────────────────────────── */}
      <div className="mt-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-ink-muted">Add</span>
          {KINDS.map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={kind === k}
              className={`focus-ring rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                kind === k
                  ? 'border-q-violet/50 bg-q-violet/10 text-q-violet-text'
                  : 'border-line text-ink-secondary hover:text-ink'
              }`}
              onClick={() => setKind(k)}
            >
              {KIND_LABEL[k]}s
            </button>
          ))}
          <span className="ml-auto text-xs text-ink-muted">
            {selected.length} selected{selected.length >= MAX_ITEMS ? ` (max ${MAX_ITEMS})` : ''}
          </span>
        </div>

        <ul className="mt-3 max-h-64 space-y-1 overflow-y-auto rounded-card border border-line p-2">
          {CATALOGUE[kind].map((entry) => {
            const key = `${entry.kind}:${entry.ref}`
            const checked = selectedKeys.has(key)
            return (
              <li key={key}>
                <label className="flex cursor-pointer items-start gap-3 rounded-lg px-2 py-1.5 hover:bg-surface-2">
                  <input
                    type="checkbox"
                    className="focus-ring mt-1"
                    checked={checked}
                    disabled={busy || (!checked && selected.length >= MAX_ITEMS)}
                    onChange={() => toggle({ kind: entry.kind, ref: entry.ref })}
                  />
                  <span>
                    <span className="block text-sm text-ink">{entry.title}</span>
                    <span className="block text-xs text-ink-muted">{entry.detail}</span>
                  </span>
                </label>
              </li>
            )
          })}
        </ul>
      </div>

      {error ? (
        <p className="mt-3 rounded-card border border-q-rose/40 bg-q-rose/10 p-3 text-sm text-q-rose-text">
          {error}
        </p>
      ) : null}

      <button
        type="button"
        className="btn-primary focus-ring mt-4"
        onClick={() => void publish()}
        disabled={busy}
      >
        {busy ? 'Publishing…' : classId ? 'Publish to class' : 'Publish to cohort'}
      </button>
    </div>
  )
}

export { AssignmentComposer }
