'use client'

import dynamic from 'next/dynamic'
import type { ComponentType } from 'react'

/**
 * LazyViz — defer a heavy visualization component out of a route's First Load JS.
 *
 * MEASUREMENT that motivates this file (raw bytes on disk, `node scripts/analyze-bundle.mjs`):
 *
 *   /visualizations/bloch-sphere   864.0 kB total, 569.6 kB route-specific
 *   /visualizations/decoherence    853.1 kB total, 558.8 kB route-specific
 *   median route                   463.9 kB
 *
 * Both flagged at >1.8x the median. The single chunk responsible is
 * `static/chunks/9d78c252-*.js` at 512.2 kB, confirmed to be three.js by grepping it
 * for `WebGLRenderer` (35 hits) and `BufferGeometry` (14 hits).
 *
 * IMPORTANT NEGATIVE RESULT: that chunk is NOT in the shared bundle. The chunks shared
 * by all 30 routes total 294.4 kB and are react-dom + webpack runtime; three.js appears
 * in exactly two routes' chunk lists. So a visitor to the landing page was never paying
 * for three.js. The suspicion that it leaked into the shared chunk is measurably false.
 *
 * What is still true is that three.js sits in those two routes' *initial* payload — it is
 * fetched and parsed before hydration, blocking interactivity of the sliders and prose
 * that surround the canvas, even though nothing can be drawn until the browser has a
 * WebGL context anyway. `ssr: false` + a dynamic import moves it to a chunk fetched after
 * hydration, so the page's controls become usable while three.js is still downloading.
 *
 * The placeholder reserves the EXACT height the real component occupies, so there is no
 * layout shift when the swap happens. Both three.js visualizations render into a
 * `w-full min-h-[420px]` container, hence VIZ_MIN_HEIGHT below — if that class ever
 * changes in BlochSphere.tsx or DecoherenceLab.tsx, change it here in the same commit.
 */

/** Must match the `min-h-[420px]` on BlochSphere and DecoherenceLab's root element. */
export const VIZ_MIN_HEIGHT = 420

/**
 * The reserved-space placeholder. Deliberately inert: it occupies the same box as the
 * finished visualization and says so for screen readers, but paints nothing that would
 * change the page's design once the real component takes over.
 */
export function VizSkeleton({ minHeight = VIZ_MIN_HEIGHT }: { minHeight?: number }) {
  return (
    <div
      className="w-full"
      style={{ minHeight }}
      role="img"
      aria-label="Visualization loading."
      aria-busy="true"
    />
  )
}

/**
 * Wrap a dynamic import of a visualization so it loads after hydration.
 *
 * Call this at MODULE scope, never inside a render — `dynamic()` returns a new component
 * identity each call, and creating it during render would unmount and remount the canvas
 * (and with it the whole WebGL context) on every parent update.
 *
 *   const BlochSphere = lazyViz(() => import('@/components/viz/BlochSphere'))
 *
 * `ssr: false` is required, not merely an optimisation: these components touch
 * `document`, `window.matchMedia` and WebGL inside their effects, and their server-
 * rendered output is an empty sized div regardless, so server rendering them buys
 * nothing and would only pull three.js into the server bundle.
 */
export function lazyViz<P extends object>(
  loader: () => Promise<{ default: ComponentType<P> }>,
  options?: { minHeight?: number }
): ComponentType<P> {
  const minHeight = options?.minHeight ?? VIZ_MIN_HEIGHT
  return dynamic(loader, {
    ssr: false,
    loading: () => <VizSkeleton minHeight={minHeight} />,
  })
}

export default lazyViz
