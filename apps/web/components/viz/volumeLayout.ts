/**
 * volumeLayout.ts — every pure computation behind VolumeRenderer.tsx.
 *
 * No DOM, no three.js: texture encoding, box sizing, camera framing, clip-plane
 * geometry, the pointer-drag → plane-offset mapping and the 2-D slice painter
 * all live here so they can be unit-tested in node. The renderer is a thin
 * shell over these functions and the shaders.
 *
 * COORDINATES. Physics is z-up: (x, y, z). three.js is y-up. The house
 * convention (BlochSphere.tsx / blochFrame.ts's `toThree`) is (x, y, z)_physics →
 * (x, z, −y)_three — a proper rotation (det +1), not a plain axis swap, so
 * physics-space handedness (which matters for a complex Y_l^m's phase winding,
 * e.g. in the rotor volumes below) survives the trip into three.js's frame.
 * `physicsToThree` uses it for anything with position/direction semantics.
 * `boxWorldScale`, by contrast, builds a *magnitude* (a mesh `.scale`, always
 * ≥ 0) from physical extents, so it swaps axes WITHOUT the sign — negating a
 * scale component would mirror the mesh in world space independently of, and
 * potentially cancelling against, the sign fix applied at the texture-sampling
 * end (see `swapExtentToThree` and the shader's `uvw` comment).
 */

import type { Volume } from '@/lib/quantum/schrodinger3d'
import { sliceVolume } from '@/lib/quantum/schrodinger3d'

export type Axis3 = 'x' | 'y' | 'z'
export type Vec3 = [number, number, number]
export type Rgb = [number, number, number]

/** Longest world-space edge of the volume's bounding box. */
export const BOX_WORLD_SIZE = 1.6

/**
 * Physics (x, y, z) → three.js (x, z, −y). A proper rotation (det +1),
 * matching blochFrame.ts's `toThree` — use this for anything with position or
 * direction semantics (points, normals, unit axis vectors). Do NOT use it for
 * a magnitude (e.g. a box's world-space scale): see `swapExtentToThree`.
 */
export function physicsToThree(v: Vec3): Vec3 {
  // `+ 0` folds −0 (e.g. from −0 in v[1]) into 0, so callers that compare
  // results with strict equality never trip over the sign of zero.
  return [v[0], v[2], -v[1] + 0]
}

/**
 * Physical (x, y, z) extents → three.js (x, z, y) scale components, i.e. the
 * same axis swap as `physicsToThree` but WITHOUT the sign flip. A mesh's
 * `.scale` is a size, always ≥ 0 here (built from `Math.max`-clamped physical
 * extents): feeding it a negative component would mirror the mesh in world
 * space, which has nothing to do with fixing chirality and would cancel
 * against the sign the shader applies when it samples the texture (see the
 * `uvw` line in volumeShaders.ts). Only `boxWorldScale` needs this.
 */
function swapExtentToThree(v: Vec3): Vec3 {
  return [v[0], v[2], v[1]]
}

/** Physical side lengths of the grid, voxel-centre to voxel-centre plus one voxel. */
export function physicalExtent(v: Pick<Volume, 'min' | 'max' | 'spacing'>): Vec3 {
  return [
    v.max[0] - v.min[0] + v.spacing[0],
    v.max[1] - v.min[1] + v.spacing[1],
    v.max[2] - v.min[2] + v.spacing[2],
  ]
}

/**
 * World-space scale of the unit cube that holds the volume, in three.js axis
 * order, with the longest physical edge mapped to BOX_WORLD_SIZE. A degenerate
 * (zero-extent) volume scales to a tiny cube rather than to NaN.
 */
export function boxWorldScale(v: Pick<Volume, 'min' | 'max' | 'spacing'>): Vec3 {
  const ext = physicalExtent(v)
  const longest = Math.max(ext[0], ext[1], ext[2])
  if (!(longest > 0) || !Number.isFinite(longest)) return [1e-3, 1e-3, 1e-3]
  const k = BOX_WORLD_SIZE / longest
  return swapExtentToThree([ext[0] * k, ext[1] * k, ext[2] * k])
}

/**
 * Camera distance at which a box of the given world scale fits the view for a
 * vertical field of view `fovDeg` and the given aspect. Uses the bounding
 * sphere, so the box fits at every orbit angle, with a small margin. Never
 * returns less than a floor: a zero-area first paint must not put the camera
 * inside the box.
 */
export function fitDistance(scale: Vec3, fovDeg: number, aspect: number): number {
  const radius = 0.5 * Math.hypot(scale[0], scale[1], scale[2])
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1
  const vFov = (Math.max(1, Math.min(179, fovDeg)) * Math.PI) / 180
  // Horizontal FOV shrinks below aspect 1; fit the tighter of the two.
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * safeAspect)
  const fov = Math.min(vFov, hFov)
  const d = radius / Math.sin(fov / 2)
  return Math.max(0.5, d * 1.08)
}

/** Spherical orbit → Cartesian camera position (three.js y-up). */
export function orbitPosition(distance: number, azimuth: number, polar: number): Vec3 {
  const p = Math.min(Math.PI - 0.05, Math.max(0.05, polar))
  return [
    distance * Math.sin(p) * Math.sin(azimuth),
    distance * Math.cos(p),
    distance * Math.sin(p) * Math.cos(azimuth),
  ]
}

// ─────────────────────────────────────────────────────────────────────────────
// Texture encoding
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pack a volume into RGBA8 for a 3-D texture:
 *   R = 255·√(|ψ|²/max)   — square-root encoding so the faint tails keep
 *                            some precision in 8 bits (the shader squares it back),
 *   G = 255·(phase + π)/2π — the phase in (−π, π] mapped to [0, 255],
 *   B = 0, A = 255.
 * Unsigned bytes rather than floats because linear filtering of float 3-D
 * textures needs an optional extension and bytes do not.
 */
export function encodeVolumeRgba(v: Pick<Volume, 'density' | 'phase' | 'maxDensity'>): Uint8Array {
  const n = v.density.length
  const out = new Uint8Array(n * 4)
  const inv = v.maxDensity > 0 ? 1 / v.maxDensity : 0
  for (let i = 0; i < n; i++) {
    const d = Math.min(1, Math.max(0, v.density[i] * inv))
    const ph = v.phase[i]
    out[i * 4] = Math.round(Math.sqrt(d) * 255)
    out[i * 4 + 1] = Math.round(((ph + Math.PI) / (2 * Math.PI)) * 255)
    out[i * 4 + 2] = 0
    out[i * 4 + 3] = 255
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// Clip plane
// ─────────────────────────────────────────────────────────────────────────────

export interface ClipSpec {
  /** Physics axis the plane is perpendicular to. */
  axis: Axis3
  /** Position along that axis as a fraction of the box, 0 = min face, 1 = max face. */
  offset: number
  enabled: boolean
}

/** Clamp an offset to the box. */
export function clampOffset(offset: number): number {
  if (!Number.isFinite(offset)) return 0.5
  return Math.min(1, Math.max(0, offset))
}

/**
 * The clip half-space in the unit-cube object space the shader marches in,
 * as (nx, ny, nz, d) with "keep where dot(p, n) ≤ d". The cube spans
 * [−0.5, 0.5]³ in three.js axis order. The removed side is the +axis side
 * (the side the default camera looks at when the plane is x-normal), so
 * dragging the offset towards 1 restores the whole cloud.
 * Disabled → a plane no point can fail: d = 1e9.
 */
export function clipUniform(clip: ClipSpec | undefined): [number, number, number, number] {
  if (!clip || !clip.enabled) return [1, 0, 0, 1e9]
  const nPhys: Vec3 = clip.axis === 'x' ? [1, 0, 0] : clip.axis === 'y' ? [0, 1, 0] : [0, 0, 1]
  const n = physicsToThree(nPhys)
  return [n[0], n[1], n[2], clampOffset(clip.offset) - 0.5]
}

/** Physics axis → three.js unit vector. */
export function axisVectorThree(axis: Axis3): Vec3 {
  return physicsToThree(axis === 'x' ? [1, 0, 0] : axis === 'y' ? [0, 1, 0] : [0, 0, 1])
}

/**
 * World-space centre and in-plane size of the clip-plane quad, for a box of
 * the given world scale. Size is (width, height) of the cross-section along
 * the two axes the plane spans, in three.js order.
 */
export function clipPlanePlacement(
  clip: ClipSpec,
  scale: Vec3
): { center: Vec3; size: [number, number]; normal: Vec3 } {
  const n = axisVectorThree(clip.axis)
  const t = clampOffset(clip.offset) - 0.5
  // `+ 0` folds −0 into 0 so the centre compares cleanly.
  const center: Vec3 = [n[0] * t * scale[0] + 0, n[1] * t * scale[1] + 0, n[2] * t * scale[2] + 0]
  const others = [0, 1, 2].filter((k) => n[k] === 0)
  return { center, size: [scale[others[0]], scale[others[1]]], normal: n }
}

/**
 * Euler rotation (three.js XYZ order) and in-plane scale that turn a unit
 * PlaneGeometry — which lies in its own xy plane with normal +z — into the
 * clip-plane quad for the given physics axis. Each rotation is chosen to land
 * the plane's local +z on `axisVectorThree(axis)` (physicsToThree of the unit
 * axis vector), so the quad's normal always agrees with the half-space
 * `clipUniform` builds from the same function:
 *
 *   physics x → three normal +x: rotate about y by +π/2; the quad's local x
 *              then runs along world −z (physics y) and local y along world y
 *              (physics z)
 *   physics y → three normal −z (physicsToThree([0,1,0]) = (0, 0, −1)):
 *              rotate π about x, which sends local z → −z and local y → −y;
 *              local x still → world x (physics x), local y → world −y
 *              (physics z) — the quad is symmetric, so that extra sign on
 *              local y is not visible.
 *   physics z → three normal +y: rotate about x by −π/2; local x → world x,
 *              local y → world −z (physics y)
 *
 * `length` is the box's world extent along the normal — what a full drag
 * across the box covers.
 */
export function clipPlaneTransform(
  axis: Axis3,
  scale: Vec3
): { rotation: Vec3; size: [number, number]; length: number } {
  switch (axis) {
    case 'x':
      return { rotation: [0, Math.PI / 2, 0], size: [scale[2], scale[1]], length: scale[0] }
    case 'y':
      return { rotation: [Math.PI, 0, 0], size: [scale[0], scale[1]], length: scale[2] }
    default:
      return { rotation: [-Math.PI / 2, 0, 0], size: [scale[0], scale[2]], length: scale[1] }
  }
}

/**
 * Turn a pointer drag into a change of clip offset.
 *
 * `project` maps a world point to screen pixels. The plane's normal, projected
 * to the screen, gives the direction a drag must follow to move the plane; the
 * pixel length of one full box traversal along the normal gives the scale.
 * Returns the offset delta, or 0 when the normal is foreshortened to nothing
 * (looking straight down the axis), so a drag can never divide by zero.
 */
export function dragToOffsetDelta(
  deltaPx: [number, number],
  normalWorld: Vec3,
  boxLengthAlongNormal: number,
  project: (p: Vec3) => [number, number]
): number {
  const a = project([0, 0, 0])
  const b = project([
    normalWorld[0] * boxLengthAlongNormal,
    normalWorld[1] * boxLengthAlongNormal,
    normalWorld[2] * boxLengthAlongNormal,
  ])
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len2 = dx * dx + dy * dy
  if (!(len2 > 4)) return 0
  // Fraction of the full traversal covered by the drag's projection on it.
  return (deltaPx[0] * dx + deltaPx[1] * dy) / len2
}

// ─────────────────────────────────────────────────────────────────────────────
// Colour
// ─────────────────────────────────────────────────────────────────────────────

/** `#rrggbb` → [r, g, b] in 0..1. Anything else → the fallback. */
export function parseHex(hex: string, fallback: Rgb): Rgb {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return fallback
  const n = Number.parseInt(m[1], 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

export interface VolumePalette {
  /** Low-density end of the density ramp. */
  low: Rgb
  /** High-density end of the density ramp. */
  high: Rgb
  /** Hue wheel at phase 0, π/2, π, 3π/2. */
  phase: [Rgb, Rgb, Rgb, Rgb]
}

/**
 * Phase → colour by piecewise-linear interpolation around a four-stop wheel.
 * Phase 0 (a positive real lobe) is the first stop, π (negative) the third, so
 * a real state comes out in exactly two colours with the node between them.
 * Mirrored in the fragment shader; keep them in step.
 */
export function phaseColor(phase: number, wheel: [Rgb, Rgb, Rgb, Rgb]): Rgb {
  const twoPi = 2 * Math.PI
  let t = ((phase % twoPi) + twoPi) % twoPi
  t = (t / twoPi) * 4
  const i = Math.floor(t) % 4
  const f = t - Math.floor(t)
  const a = wheel[i]
  const b = wheel[(i + 1) % 4]
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]
}

/**
 * The transfer function's visibility term: normalised density re-scaled so
 * everything below `threshold` vanishes and the rest fills 0..1.
 */
export function transferVisibility(normalisedDensity: number, threshold: number): number {
  const th = Math.min(0.999, Math.max(0, threshold))
  return Math.min(1, Math.max(0, (normalisedDensity - th) / (1 - th)))
}

// ─────────────────────────────────────────────────────────────────────────────
// 2-D slice painting (the no-WebGL fallback)
// ─────────────────────────────────────────────────────────────────────────────

export interface SlicePaintOptions {
  axis: Axis3
  /** 0..1 along the axis. */
  offset: number
  threshold: number
  colorMode: 'density' | 'phase'
  palette: VolumePalette
  /** Page background, blended under the cloud so the slice reads in both themes. */
  background: Rgb
}

const AXIS_INDEX: Record<Axis3, 0 | 1 | 2> = { x: 0, y: 1, z: 2 }

/**
 * Paint one slice of the volume into an RGBA byte buffer of the slice's own
 * resolution (the caller scales it up on a canvas). Row 0 is the slice's
 * highest second coordinate so that, drawn top-down, "up" on screen is the
 * physics axis with the larger index — z for x- and y-normal slices.
 */
export function paintSlice(
  v: Volume,
  o: SlicePaintOptions
): { width: number; height: number; rgba: Uint8ClampedArray; horizontal: Axis3; vertical: Axis3 } {
  const axis = AXIS_INDEX[o.axis]
  const dims = [v.nx, v.ny, v.nz]
  const index = Math.round(clampOffset(o.offset) * (dims[axis] - 1))
  const s = sliceVolume(v, axis, index)
  const rgba = new Uint8ClampedArray(s.width * s.height * 4)
  const inv = v.maxDensity > 0 ? 1 / v.maxDensity : 0
  for (let j = 0; j < s.height; j++) {
    const row = s.height - 1 - j
    for (let i = 0; i < s.width; i++) {
      const k = row * s.width + i
      const vis = transferVisibility(s.density[k] * inv, o.threshold)
      const c =
        o.colorMode === 'phase'
          ? phaseColor(s.phase[k], o.palette.phase)
          : ([
              o.palette.low[0] + (o.palette.high[0] - o.palette.low[0]) * vis,
              o.palette.low[1] + (o.palette.high[1] - o.palette.low[1]) * vis,
              o.palette.low[2] + (o.palette.high[2] - o.palette.low[2]) * vis,
            ] as Rgb)
      // Alpha grows with the square root so the faint tail is still visible.
      const alpha = Math.sqrt(vis)
      const out = (j * s.width + i) * 4
      rgba[out] = Math.round(255 * (o.background[0] + (c[0] - o.background[0]) * alpha))
      rgba[out + 1] = Math.round(255 * (o.background[1] + (c[1] - o.background[1]) * alpha))
      rgba[out + 2] = Math.round(255 * (o.background[2] + (c[2] - o.background[2]) * alpha))
      rgba[out + 3] = 255
    }
  }
  const [h, vAxis] = o.axis === 'x' ? (['y', 'z'] as const) : o.axis === 'y' ? (['x', 'z'] as const) : (['x', 'y'] as const)
  return { width: s.width, height: s.height, rgba, horizontal: h, vertical: vAxis }
}

/**
 * Fit a `w × h` image into a `boxW × boxH` frame preserving aspect, centred.
 * Every output is finite and non-negative even for a zero-size frame, so a
 * first paint at 0 × 0 draws nothing rather than throwing.
 */
export function fitRect(
  w: number,
  h: number,
  boxW: number,
  boxH: number
): { x: number; y: number; width: number; height: number } {
  if (!(w > 0) || !(h > 0) || !(boxW > 0) || !(boxH > 0)) return { x: 0, y: 0, width: 0, height: 0 }
  const k = Math.min(boxW / w, boxH / h)
  const width = w * k
  const height = h * k
  return { x: (boxW - width) / 2, y: (boxH - height) / 2, width, height }
}
