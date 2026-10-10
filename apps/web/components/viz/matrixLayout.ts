/**
 * matrixLayout.ts — the pure geometry and colour behind MatrixHistogram3D and
 * HintonDiagram. No DOM, no three.js: every number the two renderers place on
 * screen is computed here so it can be unit-tested in node, and so the 3-D bars
 * and the flat squares can never disagree about which entry is which.
 *
 * PHASE COLOUR. Both views colour an entry by arg(ρ_ij) on a cyclic ring. The
 * hue mapping is the one components/circuit/qsphereScene.ts already uses for
 * the q-sphere — phase 0 → hue 250° (blue-violet), π → 70° (amber) — so a
 * reader who has seen the q-sphere reads these pictures with the same key. The
 * ring is OKLCH at fixed lightness and chroma so every phase has the same
 * visual weight in both themes; it is converted to sRGB here by hand because
 * neither SVG attributes in older engines nor THREE.Color parse `oklch()`.
 */

import type { ComplexMatrix } from '@/lib/quantum/densityMatrixView'

// ─── Phase colour ─────────────────────────────────────────────────────────────

/** Hue in degrees [0, 360) for a phase in radians; matches the q-sphere key. */
export function phaseHue(phase: number): number {
  const deg = (phase / (2 * Math.PI)) * 360 + 250
  const wrapped = ((deg % 360) + 360) % 360
  return wrapped === 360 ? 0 : wrapped
}

/** Lightness/chroma of the phase ring. 0.7/0.15 sits inside sRGB at every hue. */
export const PHASE_RING = { lightness: 0.7, chroma: 0.15 } as const

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

function linearToSrgb(c: number): number {
  const v = clamp01(c)
  return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055
}

/**
 * OKLCH → sRGB, returned as [r, g, b] in 0..1. Björn Ottosson's published
 * matrices (OKLab → LMS → linear sRGB), then the sRGB transfer curve. Out-of-
 * gamut components are clamped rather than re-mapped — fine for the ring above,
 * which stays in gamut by construction.
 */
export function oklchToRgb(L: number, C: number, hDeg: number): [number, number, number] {
  const h = (hDeg * Math.PI) / 180
  const a = C * Math.cos(h)
  const b = C * Math.sin(h)

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b
  const s_ = L - 0.0894841775 * a - 1.291485548 * b

  const l = l_ * l_ * l_
  const m = m_ * m_ * m_
  const s = s_ * s_ * s_

  const r = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
  const bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s

  return [linearToSrgb(r), linearToSrgb(g), linearToSrgb(bl)]
}

/** `#rrggbb` for an [r, g, b] triple in 0..1. */
export function rgbToHex([r, g, b]: [number, number, number]): string {
  const to = (v: number) => Math.round(clamp01(v) * 255).toString(16).padStart(2, '0')
  return `#${to(r)}${to(g)}${to(b)}`
}

/** The ring colour for a phase in radians, as an [r, g, b] triple in 0..1. */
export function phaseRgb(phase: number): [number, number, number] {
  return oklchToRgb(PHASE_RING.lightness, PHASE_RING.chroma, phaseHue(phase))
}

/** The ring colour for a phase in radians, as `#rrggbb`. */
export function phaseHex(phase: number): string {
  return rgbToHex(phaseRgb(phase))
}

/** Evenly spaced stops around the ring, for a legend or a conic gradient. */
export function phaseRingStops(count = 12): { phase: number; hex: string }[] {
  const n = Math.max(2, Math.floor(count))
  return Array.from({ length: n + 1 }, (_, k) => {
    const phase = (k / n) * 2 * Math.PI
    return { phase, hex: phaseHex(phase) }
  })
}

// ─── Entries ──────────────────────────────────────────────────────────────────

export interface MatrixEntry {
  row: number
  col: number
  re: number
  im: number
  /** |ρ_ij| */
  magnitude: number
  /** arg(ρ_ij) in (−π, π]; 0 for a zero entry. */
  phase: number
}

/** Magnitudes below this are treated as exactly zero (no bar, no square, phase 0). */
export const ZERO_EPS = 1e-9

/** Flatten a matrix into entries, row-major. Ragged rows are tolerated (missing cells skipped). */
export function matrixEntries(matrix: ComplexMatrix): MatrixEntry[] {
  const out: MatrixEntry[] = []
  for (let i = 0; i < matrix.length; i++) {
    const row = matrix[i] ?? []
    for (let j = 0; j < row.length; j++) {
      const v = row[j]
      const re = Number.isFinite(v?.re) ? v.re : 0
      const im = Number.isFinite(v?.im) ? v.im : 0
      const magnitude = Math.hypot(re, im)
      out.push({
        row: i,
        col: j,
        re,
        im,
        magnitude,
        phase: magnitude < ZERO_EPS ? 0 : Math.atan2(im, re),
      })
    }
  }
  return out
}

/** Number of columns: the longest row, so a ragged input still gets a full grid. */
export function columnCount(matrix: ComplexMatrix): number {
  let n = 0
  for (const row of matrix) n = Math.max(n, row?.length ?? 0)
  return n
}

/** True when every imaginary part is negligible — the picture then needs only a sign key. */
export function isRealMatrix(matrix: ComplexMatrix, eps = ZERO_EPS): boolean {
  for (const row of matrix) for (const v of row) if (Math.abs(v.im) > eps) return false
  return true
}

/**
 * The magnitude drawn at full size. A caller may pin it (e.g. 1 for a density
 * matrix, so 0.5 always reads as half); otherwise the largest entry fills the
 * chart. Never 0, never NaN.
 */
export function resolveScale(matrix: ComplexMatrix, requested?: number): number {
  if (requested !== undefined && Number.isFinite(requested) && requested > 0) return requested
  let best = 0
  for (const row of matrix) for (const v of row) best = Math.max(best, Math.hypot(v.re, v.im))
  return best > ZERO_EPS ? best : 1
}

/** Fraction of full size for a magnitude: 0 for nothing, clamped to [0, 1], never NaN. */
export function fraction(magnitude: number, scale: number): number {
  if (!Number.isFinite(magnitude) || !Number.isFinite(scale) || scale <= 0) return 0
  const f = magnitude / scale
  return f < ZERO_EPS ? 0 : f > 1 ? 1 : f
}

// ─── 3-D bar grid ─────────────────────────────────────────────────────────────

export interface BarGrid {
  rows: number
  cols: number
  /** World x of column j's centre (columns run left → right). */
  x: number[]
  /** World z of row i's centre (rows run front → back, so row 0 is nearest the camera). */
  z: number[]
  /** Footprint of one bar. */
  barWidth: number
  /** Height of a bar at fraction 1. */
  maxHeight: number
  /** Half-size of the ground plane; the grid fits in [−extent, extent] on x and z. */
  extentX: number
  extentZ: number
  /** Radius the camera should frame: the ground diagonal plus the tallest bar. */
  focus: number
}

export const BAR_SPACING = 1
export const BAR_FILL = 0.68
export const BAR_MAX_HEIGHT = 2.4

/** Centre a rows×cols grid of unit-pitch bars on the origin. Empty in, empty out — never NaN. */
export function barGrid(rows: number, cols: number): BarGrid {
  const r = Math.max(0, Math.floor(rows))
  const c = Math.max(0, Math.floor(cols))
  const centre = (n: number, k: number) => (k - (n - 1) / 2) * BAR_SPACING
  const x = Array.from({ length: c }, (_, j) => centre(c, j))
  // Row 0 is drawn nearest the viewer (largest z in three.js's right-handed,
  // camera-at-+z frame), so the matrix reads top-to-bottom like the printed one.
  const z = Array.from({ length: r }, (_, i) => -centre(r, i))
  const extentX = (c * BAR_SPACING) / 2
  const extentZ = (r * BAR_SPACING) / 2
  const focus = Math.hypot(extentX, extentZ, BAR_MAX_HEIGHT / 2) || 1
  return {
    rows: r,
    cols: c,
    x,
    z,
    barWidth: BAR_SPACING * BAR_FILL,
    maxHeight: BAR_MAX_HEIGHT,
    extentX,
    extentZ,
    focus,
  }
}

/** World height of a bar. Zero entries get a hairline so the grid position still reads. */
export function barHeight(magnitude: number, scale: number, maxHeight = BAR_MAX_HEIGHT): number {
  const f = fraction(magnitude, scale)
  return f === 0 ? 0 : Math.max(0.01, f * maxHeight)
}

/** Show every label up to 8 entries, then thin them so a 16- or 32-wide axis stays legible. */
export function labelStride(count: number): number {
  if (count <= 8) return 1
  if (count <= 16) return 2
  return Math.ceil(count / 8)
}

// ─── Hinton grid (flat) ───────────────────────────────────────────────────────

export interface HintonLayout {
  rows: number
  cols: number
  /** Side of one grid cell in px. 0 when there is no room — draw nothing. */
  cell: number
  /** Top-left of cell (0, 0). */
  originX: number
  originY: number
  /** Space reserved for the row labels (left) and column labels (top). */
  gutterLeft: number
  gutterTop: number
  /** Total drawn size, so the caller can set an SVG viewBox. */
  width: number
  height: number
}

/**
 * Fit a rows×cols grid plus a label gutter into a box. The grid is square-celled
 * and left/top aligned after the gutter. Any non-positive or non-finite box
 * gives cell 0 and a zero-size layout: the caller must draw nothing, not throw.
 */
export function hintonLayout(
  rows: number,
  cols: number,
  width: number,
  height: number,
  opts: { gutterLeft?: number; gutterTop?: number; pad?: number } = {}
): HintonLayout {
  const r = Math.max(0, Math.floor(rows))
  const c = Math.max(0, Math.floor(cols))
  const gutterLeft = Math.max(0, opts.gutterLeft ?? 40)
  const gutterTop = Math.max(0, opts.gutterTop ?? 22)
  const pad = Math.max(0, opts.pad ?? 4)
  const w = Number.isFinite(width) ? width : 0
  const h = Number.isFinite(height) ? height : 0
  const freeW = w - gutterLeft - pad
  const freeH = h - gutterTop - pad
  if (r === 0 || c === 0 || freeW <= 0 || freeH <= 0) {
    return { rows: r, cols: c, cell: 0, originX: gutterLeft, originY: gutterTop, gutterLeft, gutterTop, width: 0, height: 0 }
  }
  const cell = Math.max(0, Math.min(freeW / c, freeH / r))
  return {
    rows: r,
    cols: c,
    cell,
    originX: gutterLeft,
    originY: gutterTop,
    gutterLeft,
    gutterTop,
    width: gutterLeft + cell * c + pad,
    height: gutterTop + cell * r + pad,
  }
}

/**
 * Side of a Hinton square. Linear in magnitude, not in area: an entry of 0.5
 * draws at half the cell so that "the diagonal stayed at ½ while the corners
 * vanished" is visible as exactly that. The cap leaves a hairline between
 * neighbouring full-size squares.
 */
export function hintonSide(magnitude: number, scale: number, cell: number): number {
  const f = fraction(magnitude, scale)
  return f === 0 ? 0 : Math.max(1, f * cell * 0.9)
}

// ─── Accessible text ──────────────────────────────────────────────────────────

/** Row/column label, falling back to the index when the caller gave none. */
export function labelFor(labels: readonly string[] | undefined, k: number): string {
  return labels?.[k] ?? String(k)
}

/** Format one complex entry for a table cell or a tooltip: `0.50`, `−0.50`, `0.35 e^{i0.50π}`. */
export function formatEntry(re: number, im: number, digits = 2): string {
  const mag = Math.hypot(re, im)
  if (mag < ZERO_EPS) return '0'
  if (Math.abs(im) < ZERO_EPS) return (re < 0 ? '−' : '') + Math.abs(re).toFixed(digits)
  const phasePi = Math.atan2(im, re) / Math.PI
  const sign = phasePi < 0 ? '−' : ''
  return `${mag.toFixed(digits)} e^(${sign}i${Math.abs(phasePi).toFixed(2)}π)`
}

/**
 * A one-sentence accessible summary: shape, then the largest few entries as
 * |row⟩⟨col| pairs. Both renderers use it as their aria-label so a screen reader
 * gets the same facts a sighted reader gets from the bars.
 */
export function describeMatrix(
  matrix: ComplexMatrix,
  labels?: readonly string[],
  maxListed = 6
): string {
  const rows = matrix.length
  const cols = columnCount(matrix)
  if (rows === 0 || cols === 0) return 'Empty matrix.'
  const entries = matrixEntries(matrix)
    .filter((e) => e.magnitude >= ZERO_EPS)
    .sort((a, b) => b.magnitude - a.magnitude)
  if (entries.length === 0) return `${rows} by ${cols} matrix, all entries zero.`
  const listed = entries
    .slice(0, maxListed)
    .map((e) => `${labelFor(labels, e.row)}⟨${labelFor(labels, e.col).replace(/^\|/, '').replace(/⟩$/, '')}| ${formatEntry(e.re, e.im)}`)
  const more = entries.length > maxListed ? `, and ${entries.length - maxListed} more` : ''
  return `${rows} by ${cols} matrix with ${entries.length} non-zero ${entries.length === 1 ? 'entry' : 'entries'}: ${listed.join(', ')}${more}.`
}
