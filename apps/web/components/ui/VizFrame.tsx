'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import { TrackedPage } from '@/components/analytics/TrackedPage'
import { VizDescription, type VizDescriptionProps } from '@/components/viz/VizDescription'

/**
 * The stable identifier for a visualization: the last segment of its route
 * (`/visualizations/bloch-sphere` → `bloch-sphere`). VizFrame is given a human
 * title, not a slug, and /insights groups "Most explored" by the `slug` prop —
 * so the path is the thing to emit.
 */
function slugFromPath(pathname: string | null): string {
  if (!pathname) return 'unknown'
  const segments = pathname.split('/').filter(Boolean)
  return segments.length > 0 ? segments[segments.length - 1] : 'unknown'
}

/**
 * Standard shell for every visualization page.
 *
 * Layout: a wide canvas area on the left, a controls rail on the right,
 * with the concept explanation below. Every visualization uses this so the
 * whole set reads as one product rather than five separate demos.
 */
export function VizFrame({
  title,
  tagline,
  level,
  canvas,
  controls,
  description,
  children,
}: {
  title: string
  tagline: string
  level: 'Beginner' | 'Intermediate' | 'Advanced'
  canvas: ReactNode
  controls?: ReactNode
  /**
   * A11Y: opt-in live readout of what the canvas is currently showing, rendered
   * directly beneath it. Omitted, nothing is added to the DOM at all — the 84
   * visualizations that have not adopted it render exactly as before.
   */
  description?: VizDescriptionProps
  children?: ReactNode
}) {
  const slug = slugFromPath(usePathname())
  // A11Y: ids for the region labels below. Derived from the slug so they are
  // stable across server and client renders (useId would also be fine, but the
  // slug reads better in a screen reader's landmark list).
  const canvasLabelId = `viz-canvas-${slug}`
  const controlsLabelId = `viz-controls-${slug}`

  const levelColor =
    level === 'Beginner'
      ? 'bg-q-teal/15 text-q-teal-text border-q-teal/30'
      : level === 'Intermediate'
        ? 'bg-q-violet/15 text-q-violet-text border-q-violet/30'
        : 'bg-q-amber/15 text-q-amber-text border-q-amber/30'

  return (
    // RESPONSIVE: 16px gutters below `sm`. Every visualization canvas sizes
    // itself to this container, so 24px→16px on each side is 16px more physics
    // on a 390px screen — measurable, and the canvases are the product.
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
      {/* Keyed by slug so moving between visualizations counts each one. */}
      <TrackedPage key={slug} event="viz.opened" props={{ slug, level }} />
      <Link
        href="/visualizations"
        className="focus-ring mb-6 inline-flex items-center gap-1.5 rounded text-sm text-ink-muted transition-colors hover:text-ink-secondary"
      >
        <span aria-hidden>←</span> All visualizations
      </Link>

      <div className="mb-8">
        <span className={`pill border ${levelColor}`}>{level}</span>
        <h1 className="mt-3 text-3xl font-extrabold tracking-tight md:text-4xl">{title}</h1>
        <p className="mt-2 max-w-2xl text-[15px] text-ink-secondary">{tagline}</p>
      </div>

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        {/* A11Y: the canvas was an unlabelled <div>, so the main content of the
            page was not reachable from a screen reader's landmark/region list —
            the only way in was to arrow through it. Naming the region makes the
            visualization itself a navigable destination. */}
        <section
          className="card overflow-hidden"
          role="region"
          aria-labelledby={canvasLabelId}
          tabIndex={-1}
        >
          <h2 id={canvasLabelId} className="sr-only">
            {title} visualization
          </h2>
          {canvas}
          {description ? <VizDescription {...description} /> : null}
        </section>
        {controls ? (
          // A11Y: <aside> is a complementary landmark; without a name, several
          // per page read as identical "complementary". The existing heading
          // now names it.
          <aside className="card p-4 sm:p-5" aria-labelledby={controlsLabelId}>
            <h2 id={controlsLabelId} className="section-label mb-4">
              Controls
            </h2>
            <div className="flex flex-col gap-5">{controls}</div>
          </aside>
        ) : null}
      </div>

      {children ? <div className="mt-10 max-w-3xl">{children}</div> : null}
    </div>
  )
}

/** A titled block of explanatory prose below a visualization. */
export function Explainer({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card mb-4 p-6">
      <h2 className="mb-3 text-lg font-bold">{title}</h2>
      <div className="space-y-3 text-[15px] leading-relaxed text-ink-secondary">{children}</div>
    </section>
  )
}
