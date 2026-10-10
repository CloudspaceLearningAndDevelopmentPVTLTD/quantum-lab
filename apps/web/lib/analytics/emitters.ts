/**
 * emitters.ts — the two taxonomy events that need memory to be honest.
 *
 * `circuit.built` and `viz.interacted` are READ by /coach, /insights and
 * `journey.ts`, but until now nothing EMITTED them — two of the fifteen names
 * in the closed taxonomy were permanently zero. They could not be one-line
 * `track(...)` calls at their seams because both would then fire on every
 * keystroke of a slider drag or every re-run of the same circuit, flooding the
 * 1,000-event ring buffer and evicting the events the dashboards actually
 * chart. The dedup state lives here, in one module, instead of being
 * re-invented (differently) at each call site.
 *
 *   · circuit.built — at most once per tab session per circuit SHAPE, so
 *     "edited then ran a new circuit" counts once however many times it runs.
 *   · viz.interacted — debounced past a slider drag, at most once per
 *     visualization page visit; the slug prop matches what `viz.opened` emits
 *     (VizFrame: the last path segment) because every reader unions the two.
 *
 * Same privacy posture as track.ts: everything funnels through `track`, which
 * no-ops on SSR and opt-out. Nothing here reads storage or the network.
 */

import { track } from './track'

/** Structural view of lib/quantum's Circuit — enough to name a shape. */
export interface CircuitShape {
  numQubits: number
  ops: { name: string; qubits: number[]; theta?: number }[]
}

/**
 * A canonical string for "the same circuit". Gate order matters (it is a
 * program), angles are rounded to 3 decimals so a slider wobble on θ does not
 * mint a new shape.
 */
export function circuitShapeKey(circuit: CircuitShape): string {
  const ops = circuit.ops
    .map(
      (op) =>
        `${op.name}@${op.qubits.join('.')}${
          op.theta !== undefined ? `:${op.theta.toFixed(3)}` : ''
        }`
    )
    .join(';')
  return `${circuit.numQubits}|${ops}`
}

/** Shapes already reported this tab session (module state dies with the tab). */
const builtShapes = new Set<string>()

/**
 * Report that a circuit was actually built — called from the simulator's
 * run/step path, i.e. the first moment a composed circuit is USED rather than
 * on every placement click. An empty grid is not a built circuit. Counts and
 * flags only, never the circuit itself: the ops are user-authored content.
 */
export function trackCircuitBuilt(circuit: CircuitShape): void {
  if (circuit.ops.length === 0) return
  const key = circuitShapeKey(circuit)
  if (builtShapes.has(key)) return
  builtShapes.add(key)
  track('circuit.built', {
    numQubits: circuit.numQubits,
    gateCount: circuit.ops.length,
  })
}

/** Long enough to outlast a slider drag; short enough to survive a quick visit. */
export const VIZ_INTERACTION_DEBOUNCE_MS = 400

let vizPath: string | null = null
let vizFired = false
let vizTimer: ReturnType<typeof setTimeout> | null = null

/** `/visualizations/bloch-sphere?x#y` → 'bloch-sphere'; anything else → null. */
function vizSlug(pathname: string): string | null {
  const parts = (pathname.split(/[?#]/)[0] ?? '').split('/').filter(Boolean)
  if (parts.length < 2 || parts[0] !== 'visualizations') return null
  return parts[parts.length - 1] ?? null
}

/**
 * Note that a control on a visualization page was touched.
 *
 * Trailing debounce, then at most one `viz.interacted` per page visit: the
 * event means "this person explored the physics", and one drag of one slider
 * is exactly as much evidence of that as forty input events. Navigating to a
 * different visualization (a new pathname) re-arms it, so each page visited
 * counts — mirroring VizFrame's per-slug `viz.opened`. Calls from non-
 * visualization pages (the simulator reuses these controls) are ignored:
 * emitting `viz.interacted` there would corrupt the slug sets every reader
 * builds.
 */
export function noteVizInteraction(pathname: string | null | undefined): void {
  if (!pathname) return
  const slug = vizSlug(pathname)
  if (!slug) return

  if (pathname !== vizPath) {
    vizPath = pathname
    vizFired = false
    if (vizTimer !== null) {
      clearTimeout(vizTimer)
      vizTimer = null
    }
  }
  if (vizFired) return

  if (vizTimer !== null) clearTimeout(vizTimer)
  const armedFor = pathname
  vizTimer = setTimeout(() => {
    vizTimer = null
    // The visit may have ended (navigation) between arming and firing.
    if (vizFired || vizPath !== armedFor) return
    vizFired = true
    track('viz.interacted', { slug })
  }, VIZ_INTERACTION_DEBOUNCE_MS)
}

/** Test-only: module state would otherwise leak between vitest cases. */
export function resetEmittersForTests(): void {
  builtShapes.clear()
  vizPath = null
  vizFired = false
  if (vizTimer !== null) {
    clearTimeout(vizTimer)
    vizTimer = null
  }
}
