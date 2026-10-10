'use client'

/**
 * The progress line on a path card. Reads this browser's progress after mount
 * — localStorage does not exist on the server — and holds its height with an
 * empty bar until then, so there is neither a hydration mismatch nor a jump.
 */

import { useEffect, useState } from 'react'
import { getPath } from '@/lib/paths/catalogue'
import { loadPathsState, pathProgress, readCompletionSources } from '@/lib/paths/resolve'

export function PathProgressBadge({ slug, rgb }: { slug: string; rgb: string }) {
  const [state, setState] = useState<{ done: number; total: number; active: boolean } | null>(null)

  useEffect(() => {
    const path = getPath(slug)
    if (!path) return
    const { done, total } = pathProgress(path, readCompletionSources())
    setState({ done, total, active: loadPathsState().active === slug })
  }, [slug])

  const ratio = state && state.total > 0 ? state.done / state.total : 0
  const label = !state
    ? ' '
    : state.done === 0
      ? `${state.total} steps`
      : state.done === state.total
        ? 'Complete'
        : `${state.done} of ${state.total} done`

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between text-xs font-semibold text-ink-muted">
        <span>{label}</span>
        {state?.active ? <span className="pill border-line text-ink-secondary">Following</span> : null}
      </div>
      <div
        className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-3"
        role="progressbar"
        aria-label="Path progress"
        aria-valuemin={0}
        aria-valuemax={state?.total ?? 0}
        aria-valuenow={state?.done ?? 0}
      >
        <div
          className="h-full rounded-full transition-[width] duration-500 ease-out"
          style={{ width: `${Math.round(ratio * 100)}%`, backgroundColor: `rgb(${rgb})` }}
        />
      </div>
    </div>
  )
}
