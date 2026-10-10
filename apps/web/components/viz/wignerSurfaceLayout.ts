/**
 * wignerSurfaceLayout.ts — every geometry and colour computation behind
 * components/viz/WignerSurface.tsx, as pure functions with no three.js or DOM
 * dependency so they can be checked in node (wignerSurfaceLayout.test.ts).
 *
 * World-space convention for the 3-D view: quadrature x runs along three.js
 * +X, quadrature p runs along three.js +Z (towards the default camera), and the
 * function value is lifted along three.js +Y. `SurfaceOptions.halfWidth` is the
 * world half-extent the grid is squeezed into; `heightScale` is the world height
 * a value of `scale` reaches, so the plate stays the same size on screen for
 * every state and only the relief changes.
 */

import type { PhaseSpaceField } from '@/lib/quantum/phasespace'

export type Rgb = readonly [number, number, number]

export type SurfaceOptions = {
  /** World half-width of the plate (the grid spans [−halfWidth, halfWidth]). */
  halfWidth: number
  /** World height that a field value equal to `scale` reaches. */
  heightScale: number
  /** The value mapped to full height and full colour; must be > 0. */
  scale: number
}

export type DivergingPalette = {
  negative: Rgb
  zero: Rgb
  positive: Rgb
}

// ── Colour ───────────────────────────────────────────────────────────────────

/** `#rrggbb` → [r, g, b] in 0..1. Returns null for anything else. */
export function parseHex(hex: string): Rgb | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const n = Number.parseInt(m[1], 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

/** [r, g, b] in 0..1 → `rgb(r, g, b)` for a 2-D canvas. */
export function rgbCss(c: Rgb): string {
  const q = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255)
  return `rgb(${q(c[0])}, ${q(c[1])}, ${q(c[2])})`
}

/**
 * Diverging map: t ∈ [−1, 1] → colour. Negative values blend zero → negative,
 * positive values blend zero → positive, so zero is always the neutral and a
 * negative region can never be confused with a small positive one. Uses a
 * square-root ramp so faint structure (the cat fringes sit at ±0.3 of the
 * bound) is still clearly tinted. Non-finite t reads as zero.
 */
export function divergingColor(t: number, palette: DivergingPalette): Rgb {
  if (!Number.isFinite(t)) return palette.zero
  const k = Math.min(1, Math.abs(t))
  const w = Math.sqrt(k)
  const target = t < 0 ? palette.negative : palette.positive
  return [
    palette.zero[0] + (target[0] - palette.zero[0]) * w,
    palette.zero[1] + (target[1] - palette.zero[1]) * w,
    palette.zero[2] + (target[2] - palette.zero[2]) * w,
  ]
}

// ── Height-map mesh ──────────────────────────────────────────────────────────

export type SurfaceMesh = {
  /** xyz per vertex, n·n vertices, row-major by p then x (matches the field). */
  positions: Float32Array
  /** rgb per vertex, 0..1. */
  colors: Float32Array
  /** Two triangles per cell. */
  indices: Uint32Array
}

/** Guarded: a non-positive or non-finite scale/height collapses the relief to a flat plate. */
function safeGain(opts: SurfaceOptions): number {
  if (!(opts.scale > 0) || !Number.isFinite(opts.heightScale) || !Number.isFinite(opts.scale)) return 0
  return opts.heightScale / opts.scale
}

/** World x (or z) for a grid index: −halfWidth … +halfWidth. */
export function gridToWorld(index: number, n: number, halfWidth: number): number {
  if (n < 2 || !Number.isFinite(halfWidth)) return 0
  return -halfWidth + (2 * halfWidth * index) / (n - 1)
}

/** Allocate the mesh buffers and fill them for `field`. */
export function buildSurfaceMesh(
  field: PhaseSpaceField,
  opts: SurfaceOptions,
  palette: DivergingPalette
): SurfaceMesh {
  const { n } = field
  const positions = new Float32Array(n * n * 3)
  const colors = new Float32Array(n * n * 3)
  const indices = new Uint32Array(Math.max(0, n - 1) * Math.max(0, n - 1) * 6)
  fillSurfaceMesh(field, opts, palette, positions, colors)
  let k = 0
  for (let ip = 0; ip < n - 1; ip++) {
    for (let ix = 0; ix < n - 1; ix++) {
      const a = ip * n + ix
      const b = a + 1
      const c = a + n
      const d = c + 1
      // Counter-clockwise seen from +Y (above), so the face normal points up.
      indices[k++] = a
      indices[k++] = c
      indices[k++] = b
      indices[k++] = b
      indices[k++] = c
      indices[k++] = d
    }
  }
  return { positions, colors, indices }
}

/**
 * Refill existing position/colour buffers in place for a field of the same
 * grid size — the fast path for a slider drag. Heights are clamped to
 * ±1.5·heightScale so a field that exceeds `scale` cannot spike off-screen.
 */
export function fillSurfaceMesh(
  field: PhaseSpaceField,
  opts: SurfaceOptions,
  palette: DivergingPalette,
  positions: Float32Array,
  colors: Float32Array
): void {
  const { n, values } = field
  const gain = safeGain(opts)
  const cap = 1.5 * Math.abs(opts.heightScale)
  const inv = opts.scale > 0 ? 1 / opts.scale : 0
  for (let ip = 0; ip < n; ip++) {
    const z = gridToWorld(ip, n, opts.halfWidth)
    for (let ix = 0; ix < n; ix++) {
      const i = ip * n + ix
      const v = values[i]
      const safe = Number.isFinite(v) ? v : 0
      let y = safe * gain
      if (y > cap) y = cap
      else if (y < -cap) y = -cap
      positions[i * 3] = gridToWorld(ix, n, opts.halfWidth)
      positions[i * 3 + 1] = y
      positions[i * 3 + 2] = z
      const c = divergingColor(safe * inv, palette)
      colors[i * 3] = c[0]
      colors[i * 3 + 1] = c[1]
      colors[i * 3 + 2] = c[2]
    }
  }
}

/**
 * Sparse grid lines draped over the surface (every `every`-th row and column),
 * lifted by `lift` so they do not z-fight with the faces. Returns xyz pairs for
 * a LineSegments buffer. The two outermost lines are always included so the
 * plate has an edge.
 */
export function surfaceGridLines(
  positions: Float32Array,
  n: number,
  every: number,
  lift: number
): Float32Array {
  if (n < 2) return new Float32Array(0)
  const step = Math.max(1, Math.floor(every))
  const rows: number[] = []
  for (let i = 0; i < n; i += step) rows.push(i)
  if (rows[rows.length - 1] !== n - 1) rows.push(n - 1)
  // Each selected row and column contributes (n − 1) segments.
  const out = new Float32Array(rows.length * 2 * (n - 1) * 6)
  let k = 0
  const push = (i: number) => {
    out[k++] = positions[i * 3]
    out[k++] = positions[i * 3 + 1] + lift
    out[k++] = positions[i * 3 + 2]
  }
  for (const r of rows) {
    for (let ix = 0; ix < n - 1; ix++) {
      push(r * n + ix)
      push(r * n + ix + 1)
    }
    for (let ip = 0; ip < n - 1; ip++) {
      push(ip * n + r)
      push((ip + 1) * n + r)
    }
  }
  return out
}

// ── Contours (marching squares) ──────────────────────────────────────────────

/**
 * Iso-lines of `field` at `level`, as flat [x1, p1, x2, p2, …] segments in
 * quadrature coordinates. Standard marching squares with linear interpolation
 * along cell edges; the two ambiguous saddle cases are resolved by the cell's
 * centre value. Returns an empty array when the level is never crossed.
 */
export function marchingSquares(field: PhaseSpaceField, level: number): Float32Array {
  const { n, xs, ps, values } = field
  if (n < 2 || !Number.isFinite(level)) return new Float32Array(0)
  const segs: number[] = []

  // Interpolated crossing point between two grid nodes.
  const lerp = (a: number, b: number, va: number, vb: number) => {
    const d = vb - va
    const t = d === 0 ? 0.5 : (level - va) / d
    return a + (b - a) * Math.min(1, Math.max(0, t))
  }

  for (let ip = 0; ip < n - 1; ip++) {
    for (let ix = 0; ix < n - 1; ix++) {
      const v0 = values[ip * n + ix] // (x0, p0)
      const v1 = values[ip * n + ix + 1] // (x1, p0)
      const v2 = values[(ip + 1) * n + ix + 1] // (x1, p1)
      const v3 = values[(ip + 1) * n + ix] // (x0, p1)
      const code = (v0 >= level ? 1 : 0) | (v1 >= level ? 2 : 0) | (v2 >= level ? 4 : 0) | (v3 >= level ? 8 : 0)
      if (code === 0 || code === 15) continue
      const x0 = xs[ix]
      const x1 = xs[ix + 1]
      const p0 = ps[ip]
      const p1 = ps[ip + 1]
      // Edge crossings: bottom (v0–v1), right (v1–v2), top (v3–v2), left (v0–v3).
      const bottom = () => [lerp(x0, x1, v0, v1), p0]
      const right = () => [x1, lerp(p0, p1, v1, v2)]
      const top = () => [lerp(x0, x1, v3, v2), p1]
      const left = () => [x0, lerp(p0, p1, v0, v3)]
      const add = (a: number[], b: number[]) => segs.push(a[0], a[1], b[0], b[1])

      switch (code) {
        case 1:
        case 14:
          add(left(), bottom())
          break
        case 2:
        case 13:
          add(bottom(), right())
          break
        case 3:
        case 12:
          add(left(), right())
          break
        case 4:
        case 11:
          add(right(), top())
          break
        case 6:
        case 9:
          add(bottom(), top())
          break
        case 7:
        case 8:
          add(left(), top())
          break
        case 5:
        case 10: {
          // Saddle: decide by the centre value which diagonal pair connects.
          const centre = (v0 + v1 + v2 + v3) / 4
          const centreHigh = centre >= level
          if ((code === 5) === centreHigh) {
            add(left(), top())
            add(bottom(), right())
          } else {
            add(left(), bottom())
            add(right(), top())
          }
          break
        }
      }
    }
  }
  return Float32Array.from(segs)
}

/** The iso-levels drawn on the floor, as fractions of `scale`, symmetric about 0. */
export const CONTOUR_FRACTIONS: readonly number[] = [0.06, 0.18, 0.36, 0.6, 0.85]

export type ContourSet = {
  /** Segments of positive iso-lines, in quadrature coordinates. */
  positive: Float32Array
  /** Segments of negative iso-lines. */
  negative: Float32Array
}

export function contourSet(field: PhaseSpaceField, scale: number): ContourSet {
  if (!(scale > 0)) return { positive: new Float32Array(0), negative: new Float32Array(0) }
  const pos: Float32Array[] = []
  const neg: Float32Array[] = []
  for (const f of CONTOUR_FRACTIONS) {
    pos.push(marchingSquares(field, f * scale))
    neg.push(marchingSquares(field, -f * scale))
  }
  return { positive: concat(pos), negative: concat(neg) }
}

function concat(parts: Float32Array[]): Float32Array {
  let len = 0
  for (const p of parts) len += p.length
  const out = new Float32Array(len)
  let k = 0
  for (const p of parts) {
    out.set(p, k)
    k += p.length
  }
  return out
}

/**
 * Lift quadrature-space segments onto the world floor plane: (x, p) →
 * (X, floorY, Z) with the same squeeze the surface uses. Returns xyz pairs.
 */
export function contoursToWorld(
  segments: Float32Array,
  field: PhaseSpaceField,
  halfWidth: number,
  floorY: number
): Float32Array {
  const extent = field.xs[field.n - 1]
  const k = extent > 0 && Number.isFinite(halfWidth) ? halfWidth / extent : 0
  const out = new Float32Array((segments.length / 2) * 3)
  for (let i = 0; i < segments.length / 2; i++) {
    out[i * 3] = segments[i * 2] * k
    out[i * 3 + 1] = floorY
    out[i * 3 + 2] = segments[i * 2 + 1] * k
  }
  return out
}

// ── Floor texture ────────────────────────────────────────────────────────────

/** RGBA bytes of the field under the diverging map, n × n, for a DataTexture. */
export function floorTextureData(field: PhaseSpaceField, scale: number, palette: DivergingPalette): Uint8Array {
  const { n, values } = field
  const out = new Uint8Array(n * n * 4)
  const inv = scale > 0 ? 1 / scale : 0
  for (let i = 0; i < n * n; i++) {
    const c = divergingColor(values[i] * inv, palette)
    out[i * 4] = Math.round(c[0] * 255)
    out[i * 4 + 1] = Math.round(c[1] * 255)
    out[i * 4 + 2] = Math.round(c[2] * 255)
    out[i * 4 + 3] = 255
  }
  return out
}

// ── 2-D fallback ─────────────────────────────────────────────────────────────

export type HeatmapColors = {
  palette: DivergingPalette
  /** CSS colour strings for the frame, labels and contours. */
  ink: string
  inkMuted: string
  positiveLine: string
  negativeLine: string
}

export type HeatmapLayout = {
  /** Pixel rectangle the heat map occupies. */
  left: number
  top: number
  size: number
  /** Whether there is room to draw anything at all. */
  ok: boolean
}

/** Square plot area centred in a w × h canvas with a margin for axis labels. */
export function heatmapLayout(w: number, h: number, margin = 28): HeatmapLayout {
  const size = Math.floor(Math.min(w, h) - 2 * margin)
  if (!(size >= 8) || !Number.isFinite(size)) return { left: 0, top: 0, size: 0, ok: false }
  return {
    left: Math.floor((w - size) / 2),
    top: Math.floor((h - size) / 2),
    size,
    ok: true,
  }
}

/**
 * Paint the field as a heat map with contour lines and axis labels. Draws
 * nothing on a canvas too small to hold a plot, and never emits a non-finite
 * coordinate. `label` is the function's name for the corner caption.
 */
export function drawHeatmap(
  ctx: CanvasRenderingContext2D,
  field: PhaseSpaceField,
  w: number,
  h: number,
  scale: number,
  colors: HeatmapColors,
  label: string
): void {
  ctx.clearRect(0, 0, Math.max(0, w), Math.max(0, h))
  const box = heatmapLayout(w, h)
  if (!box.ok) return
  const { n } = field
  if (n < 2) return
  const cell = box.size / (n - 1)
  const inv = scale > 0 ? 1 / scale : 0

  // Cells are centred on grid nodes; p increases upwards on screen.
  for (let ip = 0; ip < n; ip++) {
    const y = box.top + box.size - ip * cell
    for (let ix = 0; ix < n; ix++) {
      const x = box.left + ix * cell
      ctx.fillStyle = rgbCss(divergingColor(field.values[ip * n + ix] * inv, colors.palette))
      ctx.fillRect(x - cell / 2, y - cell / 2, cell + 0.5, cell + 0.5)
    }
  }

  // Contours, mapped from quadrature to pixel space.
  const extent = field.xs[n - 1]
  const k = extent > 0 ? box.size / (2 * extent) : 0
  const px = (x: number) => box.left + box.size / 2 + x * k
  const py = (p: number) => box.top + box.size / 2 - p * k
  const contours = contourSet(field, scale)
  ctx.lineWidth = 1
  for (const [segs, color] of [
    [contours.positive, colors.positiveLine],
    [contours.negative, colors.negativeLine],
  ] as const) {
    if (segs.length === 0) continue
    ctx.strokeStyle = color
    ctx.beginPath()
    for (let i = 0; i < segs.length; i += 4) {
      ctx.moveTo(px(segs[i]), py(segs[i + 1]))
      ctx.lineTo(px(segs[i + 2]), py(segs[i + 3]))
    }
    ctx.stroke()
  }

  // Frame, axes through the origin, labels.
  ctx.strokeStyle = colors.inkMuted
  ctx.lineWidth = 1
  ctx.strokeRect(box.left + 0.5, box.top + 0.5, box.size - 1, box.size - 1)
  ctx.globalAlpha = 0.5
  ctx.beginPath()
  ctx.moveTo(px(-extent), py(0))
  ctx.lineTo(px(extent), py(0))
  ctx.moveTo(px(0), py(-extent))
  ctx.lineTo(px(0), py(extent))
  ctx.stroke()
  ctx.globalAlpha = 1

  ctx.fillStyle = colors.ink
  ctx.font = '600 12px ui-sans-serif, system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.fillText('x', box.left + box.size / 2, box.top + box.size + 8)
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  ctx.fillText('p', box.left - 8, box.top + box.size / 2)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'bottom'
  ctx.fillStyle = colors.inkMuted
  ctx.font = '11px ui-sans-serif, system-ui, sans-serif'
  ctx.fillText(`${label} (top view — 3-D unavailable)`, box.left, box.top - 6)
}
