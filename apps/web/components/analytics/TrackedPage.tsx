'use client'

/**
 * TrackedPage — the drop-in for page-level "this was viewed/opened" events.
 *
 * Renders nothing. Fires exactly one event on mount and never again, however
 * many times the surrounding component re-renders.
 *
 * The ref guard is the point of this component. React 18's StrictMode mounts,
 * unmounts and re-mounts every component in development, so a bare
 * `useEffect(() => track(...), [])` fires TWICE — the classic analytics bug that
 * quietly doubles every "viewed" number in dev and makes the two environments
 * disagree. A module-free instance ref survives the second mount of the same
 * element, so the event is emitted once per real mount.
 */

import { useEffect, useRef } from 'react'
import type { EventName, EventPropValue } from '@/lib/analytics/events'
import { track } from '@/lib/analytics/track'

export interface TrackedPageProps {
  event: EventName
  props?: Record<string, EventPropValue>
}

export function TrackedPage({ event, props }: TrackedPageProps) {
  const firedRef = useRef(false)
  // Kept in a ref so a changing props object never re-runs the effect: the
  // event is a mount fact, not a render fact.
  const propsRef = useRef(props)
  propsRef.current = props

  useEffect(() => {
    if (firedRef.current) return
    firedRef.current = true
    // `track` no-ops on opt-out and swallows storage errors, so this cannot
    // affect rendering or control flow.
    track(event, propsRef.current)
  }, [event])

  return null
}

export default TrackedPage
