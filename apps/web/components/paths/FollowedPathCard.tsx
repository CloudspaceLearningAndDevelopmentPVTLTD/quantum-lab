'use client'

/**
 * FollowedPathCard — on /coach, the path the learner chose to follow and its
 * next step. With no followed path it invites them to pick one instead, since
 * the coach's goal chips are concept-sized and a path is career-sized.
 * Renders nothing until mounted: the choice lives in localStorage.
 */

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { getPath } from '@/lib/paths/catalogue'
import { loadPathsState, pathProgress, readCompletionSources, resolveStep } from '@/lib/paths/resolve'

interface Followed {
  slug: string
  icon: string
  title: string
  done: number
  total: number
  next?: { title: string; href: string }
}

export function FollowedPathCard() {
  const [state, setState] = useState<Followed | null | 'none'>(null)

  useEffect(() => {
    const path = getPath(loadPathsState().active ?? '')
    if (!path) {
      setState('none')
      return
    }
    const progress = pathProgress(path, readCompletionSources())
    const next = progress.next ? resolveStep(progress.next) : null
    setState({
      slug: path.slug,
      icon: path.icon,
      title: path.title,
      done: progress.done,
      total: progress.total,
      next: next ? { title: next.title, href: next.href } : undefined,
    })
  }, [])

  if (state === null) return null

  if (state === 'none') {
    return (
      <section className="card mt-6 flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between" aria-label="Learning paths">
        <p className="text-sm text-ink-secondary">
          <span className="font-semibold text-ink">Have a bigger goal?</span> Follow a learning path —
          software engineer, physics student, researcher and more — and it will show up here.
        </p>
        <Link href="/paths" className="btn-ghost focus-ring shrink-0">Browse paths</Link>
      </section>
    )
  }

  return (
    <section className="card mt-6 flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between" aria-label="Your learning path">
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className="text-2xl">{state.icon}</span>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-muted">Your path</p>
          <Link href={`/paths/${state.slug}`} className="focus-ring rounded font-bold text-ink hover:underline underline-offset-4">
            {state.title}
          </Link>
          <p className="text-xs text-ink-muted">{state.done} of {state.total} steps done</p>
        </div>
      </div>
      {state.next ? (
        <Link href={state.next.href} className="btn-primary focus-ring shrink-0">
          Next: {state.next.title}
        </Link>
      ) : (
        <Link href="/paths" className="btn-ghost focus-ring shrink-0">Path complete — pick another</Link>
      )}
    </section>
  )
}
