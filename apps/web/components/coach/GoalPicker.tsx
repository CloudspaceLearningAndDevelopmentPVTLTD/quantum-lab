'use client'

/**
 * GoalPicker — where the learner says where they are heading.
 *
 * A goal is the single biggest improvement available to a recommender that
 * would otherwise only know the default curriculum order: it turns "the next
 * lesson" into "the earliest thing blocking the thing you actually want".
 *
 * The choice persists to localStorage so the coach remembers it across visits.
 * Every access is SSR-guarded and wrapped in try/catch — private browsing and
 * disabled storage must degrade to "no saved goal", never to an exception.
 */

import { useEffect } from 'react'

const STORAGE_KEY = 'quantum-lab.coach-goal'

interface GoalPickerProps {
  value: string
  onChange: (v: string) => void
}

/** Each chip maps to a concept id, or '' for "no target, just browsing". */
export const GOALS: { label: string; slug: string }[] = [
  { label: 'Understand entanglement', slug: 'entanglement' },
  { label: "Get to Grover's algorithm", slug: 'grover' },
  { label: "Understand Shor's algorithm", slug: 'shor' },
  { label: 'Build real circuits', slug: 'gates-and-circuits' },
  { label: 'Just explore', slug: '' },
]

export function loadGoal(): string {
  if (typeof window === 'undefined') return ''
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw === null) return ''
    return GOALS.some((g) => g.slug === raw) ? raw : ''
  } catch {
    return ''
  }
}

function saveGoal(slug: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, slug)
  } catch {
    // Quota, private browsing, storage disabled — the in-memory choice is still
    // correct for this session, so carry on silently.
  }
}

export function GoalPicker({ value, onChange }: GoalPickerProps) {
  // Persist as a side effect of the value changing rather than inside the click
  // handler, so a goal restored from storage by the parent is never re-written
  // with a different value than the one being rendered.
  useEffect(() => {
    saveGoal(value)
  }, [value])

  return (
    <div>
      <p className="section-label">Your goal</p>
      <p className="section-desc mt-1">
        Tell the coach where you are heading and it will point at the earliest
        thing standing in your way.
      </p>
      <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Learning goal">
        {GOALS.map((goal) => {
          const selected = goal.slug === value
          return (
            <button
              key={goal.label}
              type="button"
              onClick={() => onChange(goal.slug)}
              aria-pressed={selected}
              className={`focus-ring rounded-full border px-3.5 py-1.5 text-[13px] font-semibold transition-colors duration-150 ${
                selected
                  ? 'border-q-violet bg-surface-3 text-q-violet-text'
                  : 'border-line bg-surface-2 text-ink-secondary hover:border-line-strong hover:text-ink'
              }`}
            >
              {goal.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
