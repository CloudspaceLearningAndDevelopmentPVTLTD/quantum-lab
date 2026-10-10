/**
 * qsphere-layout.ts — pure layout math for the Q-sphere widget.
 *
 * The Q-sphere (IBM Composer's other loved widget) puts every basis state on
 * the surface of a sphere:
 *
 *  - latitude by Hamming weight: |0...0⟩ at the north pole, |1...1⟩ at the
 *    south pole, and the C(n, w) states of weight w spread evenly around the
 *    ring at polar angle θ = π·w/n. Ring populations therefore follow the
 *    binomial coefficients — that invariant is pinned by the test beside this
 *    file.
 *  - node size ∝ |amplitude| (magnitude, not probability, so a 1/√2 pair
 *    reads as two clearly-visible nodes rather than two half-sized ones).
 *  - node hue = phase of the amplitude, using the same complex-plane
 *    convention as the phase disks: arg(a) in (−π, π], 0 along +x,
 *    counter-clockwise positive. The hue wheel is OKLCH, whose hue axis is
 *    close to perceptually even — equal phase steps read as equal colour
 *    steps, unlike an HSL wheel where the green third dominates. Phase colour
 *    is DATA encoding, not theming, which is why it is a computed constant
 *    here and not a CSS token (ADR-0007 governs theme tokens; a phase wheel
 *    must not change meaning between themes). Fixed L/C keep every hue
 *    legible on both the light and dark surfaces.
 *
 * Rendering (drag rotation, SVG) lives in components/circuit/QSphere.tsx;
 * everything in this file is DOM-free so it can be tested under node.
 */

import { cAbs, cArg, type StateVector } from './quantum'

/**
 * Above 5 qubits (32 nodes) the equatorial rings hold 10+ overlapping nodes
 * at readable widget sizes and the sphere stops being legible — the component
 * renders a note instead of a misleading picture.
 */
export const QSPHERE_MAX_QUBITS = 5

/** Amplitudes below this magnitude are float noise, not physics. */
export const QSPHERE_EPS = 1e-9

/** Number of set bits in a basis-state index. */
export function hammingWeight(i: number): number {
  let w = 0
  let x = i
  while (x) {
    w += x & 1
    x >>= 1
  }
  return w
}

export interface QSphereNode {
  /** Basis-state index (qubit 0 = LSB, per lib/quantum.ts / ADR-0003). */
  index: number
  /** Hamming weight — which latitude ring this node sits on. */
  weight: number
  /** Unit-sphere position: z is the pole axis (+1 = north = |0...0⟩). */
  x: number
  y: number
  z: number
  /** |amplitude| in [0, 1] — drives node radius. */
  magnitude: number
  /** arg(amplitude) in (−π, π] — drives node hue. 0 when magnitude ≈ 0. */
  phase: number
  /** |amplitude|² — used for the top-k summary. */
  probability: number
}

/**
 * All 2^n basis-state nodes with positions and amplitude data.
 *
 * Weight-w states are spread evenly in azimuth around their ring, in
 * increasing index order, with a per-ring half-step stagger so nodes on
 * adjacent rings do not stack into vertical columns.
 */
export function qsphereNodes(sv: StateVector): QSphereNode[] {
  const n = sv.numQubits
  const counts = new Array<number>(n + 1).fill(0)
  for (let i = 0; i < sv.dim; i++) counts[hammingWeight(i)]++
  const seen = new Array<number>(n + 1).fill(0)

  const nodes: QSphereNode[] = []
  for (let i = 0; i < sv.dim; i++) {
    const w = hammingWeight(i)
    const theta = (Math.PI * w) / n // polar angle from north pole
    const rank = seen[w]++
    const phi = (2 * Math.PI * (rank + w / 2)) / counts[w]
    const a = sv.amplitude(i)
    const magnitude = cAbs(a)
    nodes.push({
      index: i,
      weight: w,
      x: Math.sin(theta) * Math.cos(phi),
      y: Math.sin(theta) * Math.sin(phi),
      z: Math.cos(theta),
      magnitude,
      // atan2(0, 0) = 0: a zero amplitude rests at phase 0 rather than
      // flickering on float noise — same convention as quantum-phase.ts.
      phase: magnitude < QSPHERE_EPS ? 0 : cArg(a),
      probability: magnitude * magnitude,
    })
  }
  return nodes
}

export interface ProjectedPoint {
  /** Screen x in [-1, 1] (right positive). */
  sx: number
  /** Screen y in [-1, 1] (down positive, matching SVG). */
  sy: number
  /** Camera-axis distance: positive = far side of the sphere. */
  depth: number
}

/**
 * Rotate a unit-sphere point by yaw (about the pole axis) then pitch (about
 * the screen's horizontal axis), and project orthographically. Orthographic
 * is deliberate: no perspective distortion, so equal magnitudes render as
 * equal radii wherever the node sits — the encoding stays honest under drag.
 */
export function rotateProject(
  p: { x: number; y: number; z: number },
  yaw: number,
  pitch: number
): ProjectedPoint {
  const cy = Math.cos(yaw)
  const sy = Math.sin(yaw)
  const x1 = p.x * cy - p.y * sy
  const y1 = p.x * sy + p.y * cy
  const cp = Math.cos(pitch)
  const sp = Math.sin(pitch)
  const depth = y1 * cp - p.z * sp
  const z1 = y1 * sp + p.z * cp
  return { sx: x1, sy: -z1, depth }
}

/**
 * Phase → OKLCH colour string. Hue runs the full wheel over 2π so phase φ and
 * φ ± 2π agree; phase 0 sits at hue 250 (the app's violet neighbourhood) so a
 * plain real-positive state matches the rest of the UI rather than opening on
 * an alarm red. Fixed lightness/chroma chosen to clear contrast on both
 * themes' surfaces.
 */
export function phaseColor(phase: number): string {
  const turns = phase / (2 * Math.PI)
  const hue = (((turns * 360 + 250) % 360) + 360) % 360
  return `oklch(0.7 0.15 ${hue.toFixed(1)})`
}
