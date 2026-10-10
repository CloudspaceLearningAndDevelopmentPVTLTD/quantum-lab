'use client'

import { useEffect, useRef, useState } from 'react'
import type { BandStructure, Filling } from '@/lib/quantum/bands'
import { freeElectronFolded } from '@/lib/quantum/bands'
import { readVizColors, withAlpha, type VizColors } from './theme'
import { watchThemeChange } from './frameLoop'

/**
 * BandStructureLab — E(k) in the reduced zone on the left, the same energies laid over
 * three cells of the potential on the right, sharing one energy axis.
 *
 * Nothing in here animates on its own: the canvas repaints when its props change, when
 * it is resized, and when the theme flips. The "switch the potential on" ramp lives in
 * the page, which hands down a new BandStructure per frame; under prefers-reduced-motion
 * the page steps that ramp instead of sweeping it, and this component does not care
 * which.
 *
 * The band structure arrives as a prop rather than being solved here for the same reason
 * as in BoundStatesLab: the page quotes the same edges and gaps in a table, and two
 * solves would be two chances to disagree.
 */

const PAD_L = 54
const PAD_R = 14
const PAD_T = 20
const PAD_B = 34
const GUTTER = 26
/** Stacked, the top panel's k-axis captions need room before the next panel starts. */
const GUTTER_STACKED = 46

/** Side-by-side below this width the right panel would be too narrow to read. */
const STACK_BELOW = 640
const HEIGHT_WIDE = 470
const HEIGHT_STACKED = 560

type Props = {
  structure: BandStructure
  filling: Filling
  /** Barrier geometry, for the real-space panel. `height` is the value being displayed. */
  barrier: { period: number; width: number; height: number }
  /** Overlay the folded free-electron parabola. */
  showFree: boolean
  energyFloor: number
  energyCeiling: number
  className?: string
}

export default function BandStructureLab({
  structure,
  filling,
  barrier,
  showFree,
  energyFloor,
  energyCeiling,
  className = '',
}: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const sizeRef = useRef({ w: 0, h: 0 })
  const colorsRef = useRef<VizColors | null>(null)
  const [stacked, setStacked] = useState(false)

  const propsRef = useRef<RenderProps>({
    structure,
    filling,
    barrier,
    showFree,
    energyFloor,
    energyCeiling,
  })
  propsRef.current = { structure, filling, barrier, showFree, energyFloor, energyCeiling }

  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    colorsRef.current = readVizColors(wrap)

    const paint = () => {
      const { w, h } = sizeRef.current
      const colors = colorsRef.current
      if (w > 0 && h > 0 && colors) render(ctx, propsRef.current, w, h, colors)
    }

    const resize = () => {
      const rect = wrap.getBoundingClientRect()
      const w = Math.max(1, Math.round(rect.width))
      const h = Math.max(1, Math.round(rect.height))
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      sizeRef.current = { w, h }
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      setStacked(w < STACK_BELOW)
      paint()
    }

    const observer = new ResizeObserver(resize)
    observer.observe(wrap)
    resize()

    const stopTheme = watchThemeChange(() => {
      colorsRef.current = readVizColors(wrap)
      paint()
    })

    return () => {
      observer.disconnect()
      stopTheme()
    }
  }, [])

  // Repaint on any prop change.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const { w, h } = sizeRef.current
    const colors = colorsRef.current
    if (ctx && colors && w > 0 && h > 0) render(ctx, propsRef.current, w, h, colors)
  })

  const { bands } = structure
  const gapWord =
    filling.regime === 'metal'
      ? 'no gap at the Fermi level'
      : `a gap of ${filling.gap.toFixed(3)} at the Fermi level`
  const label =
    `Band structure. ${bands.length} allowed band${bands.length === 1 ? '' : 's'} drawn against ` +
    `wavevector on the left and against position on the right. With ${filling.electronsPerCell} ` +
    `electron${filling.electronsPerCell === 1 ? '' : 's'} per cell there is ${gapWord}: ` +
    `${filling.regime}. The band edges are listed in the table below the picture.`

  return (
    <div
      ref={wrapRef}
      className={`relative w-full ${className}`}
      style={{ height: stacked ? HEIGHT_STACKED : HEIGHT_WIDE }}
    >
      <canvas ref={canvasRef} className="block h-full w-full" role="img" aria-label={label} />
    </div>
  )
}

type RenderProps = {
  structure: BandStructure
  filling: Filling
  barrier: { period: number; width: number; height: number }
  showFree: boolean
  energyFloor: number
  energyCeiling: number
}

type Panel = { x: number; y: number; w: number; h: number }

const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace'

function render(
  ctx: CanvasRenderingContext2D,
  p: RenderProps,
  w: number,
  h: number,
  colors: VizColors
): void {
  ctx.clearRect(0, 0, w, h)
  const stacked = w < STACK_BELOW

  let dispersion: Panel
  let space: Panel
  if (stacked) {
    const total = h - PAD_T - PAD_B - GUTTER_STACKED
    const topH = Math.round(total * 0.58)
    dispersion = { x: PAD_L, y: PAD_T, w: w - PAD_L - PAD_R, h: topH }
    space = { x: PAD_L, y: PAD_T + topH + GUTTER_STACKED, w: w - PAD_L - PAD_R, h: total - topH }
  } else {
    const inner = w - PAD_L - PAD_R - GUTTER
    const leftW = Math.round(inner * 0.6)
    dispersion = { x: PAD_L, y: PAD_T, w: leftW, h: h - PAD_T - PAD_B }
    space = { x: PAD_L + leftW + GUTTER, y: PAD_T, w: inner - leftW, h: h - PAD_T - PAD_B }
  }

  drawDispersion(ctx, p, dispersion, colors)
  drawRealSpace(ctx, p, space, colors, stacked)
}

/** Shared y mapping: energy → canvas y inside a panel. */
function energyScale(p: RenderProps, panel: Panel): (e: number) => number {
  const span = p.energyCeiling - p.energyFloor || 1
  return (e: number) => panel.y + panel.h - ((e - p.energyFloor) / span) * panel.h
}

/** Between one and two "nice" ticks per 60px of axis. */
function energyTicks(floor: number, ceiling: number, pixels: number): number[] {
  const target = Math.max(2, Math.floor(pixels / 60))
  const raw = (ceiling - floor) / target
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const candidates = [1, 2, 2.5, 5, 10].map((m) => m * mag)
  const step = candidates.find((c) => c >= raw) ?? candidates[candidates.length - 1]
  const ticks: number[] = []
  for (let v = Math.ceil(floor / step) * step; v <= ceiling + 1e-9; v += step) ticks.push(v)
  return ticks
}

function formatTick(v: number): string {
  if (Math.abs(v) >= 100) return v.toFixed(0)
  if (Math.abs(v) >= 10) return v.toFixed(1)
  return Number.isInteger(v) ? v.toFixed(0) : v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
}

/** Which colour a band, or a part of it, gets from the filling. */
function occupancyColor(bandIndex: number, filling: Filling, colors: VizColors): string {
  if (bandIndex < filling.filledBands) return colors.teal
  if (bandIndex === filling.highestOccupied && filling.partiallyFilled) return colors.teal
  return colors.violet
}

function drawDispersion(
  ctx: CanvasRenderingContext2D,
  p: RenderProps,
  panel: Panel,
  colors: VizColors
): void {
  const { structure, filling } = p
  const { bands, kSamples, cell } = structure
  const a = cell.period
  const kMax = Math.PI / a
  const yOf = energyScale(p, panel)
  const xOf = (k: number) => panel.x + ((k + kMax) / (2 * kMax)) * panel.w

  // ── Gaps: shaded across the zone ─────────────────────────────────────────────
  ctx.fillStyle = withAlpha(colors.rose, 0.09)
  for (let n = 1; n < bands.length; n++) {
    const lo = bands[n - 1].top
    const hi = bands[n].bottom
    if (hi - lo <= 1e-9) continue
    const yTop = Math.max(panel.y, yOf(Math.min(hi, p.energyCeiling)))
    const yBot = Math.min(panel.y + panel.h, yOf(Math.max(lo, p.energyFloor)))
    if (yBot > yTop) ctx.fillRect(panel.x, yTop, panel.w, yBot - yTop)
  }

  // ── Axes and zone boundaries ─────────────────────────────────────────────────
  ctx.save()
  ctx.beginPath()
  ctx.rect(panel.x, panel.y, panel.w, panel.h)
  ctx.clip()

  ctx.strokeStyle = colors.lineStrong
  ctx.lineWidth = 1
  ctx.setLineDash([3, 4])
  ctx.beginPath()
  for (const k of [-kMax, 0, kMax]) {
    const x = Math.round(xOf(k)) + 0.5
    ctx.moveTo(x, panel.y)
    ctx.lineTo(x, panel.y + panel.h)
  }
  ctx.stroke()
  ctx.setLineDash([])

  // ── Free-electron parabola, folded ───────────────────────────────────────────
  if (p.showFree) {
    ctx.strokeStyle = withAlpha(colors.sky, 0.8)
    ctx.lineWidth = 1.25
    ctx.setLineDash([5, 4])
    // Every band's mean potential shifts the whole spectrum by V̄; the folded parabola
    // is drawn shifted the same way so that at V₀ → 0 the two pictures coincide and at
    // finite V₀ the difference on screen is the gap, not the average.
    const mean = cell.slabs.reduce((s, slab) => s + slab.width * slab.potential, 0) / a
    for (let n = 0; n < 8; n++) {
      if (freeElectronFolded(a, n, 0) + mean > p.energyCeiling && freeElectronFolded(a, n, kMax) + mean > p.energyCeiling) break
      ctx.beginPath()
      for (let j = 0; j < kSamples.length; j++) {
        const k = kSamples[j]
        const e = freeElectronFolded(a, n, k) + mean
        const x = xOf(k)
        if (j === 0) ctx.moveTo(x, yOf(e))
        else ctx.lineTo(x, yOf(e))
      }
      ctx.stroke()
      ctx.beginPath()
      for (let j = 0; j < kSamples.length; j++) {
        const k = kSamples[j]
        const e = freeElectronFolded(a, n, k) + mean
        const x = xOf(-k)
        if (j === 0) ctx.moveTo(x, yOf(e))
        else ctx.lineTo(x, yOf(e))
      }
      ctx.stroke()
    }
    ctx.setLineDash([])
  }

  // ── Bands ────────────────────────────────────────────────────────────────────
  for (const band of bands) {
    if (band.bottom > p.energyCeiling) break
    const color = occupancyColor(band.index, filling, colors)
    const isPartial = band.index === filling.highestOccupied && filling.partiallyFilled
    ctx.lineWidth = 2.25
    for (const sign of [1, -1]) {
      // For a half-filled band, draw the part below E_F teal and the rest violet.
      if (isPartial) {
        drawBandSegment(ctx, band, kSamples, sign, xOf, yOf, (e) => e <= filling.fermiEnergy, colors.teal)
        drawBandSegment(ctx, band, kSamples, sign, xOf, yOf, (e) => e > filling.fermiEnergy, colors.violet)
      } else {
        drawBandSegment(ctx, band, kSamples, sign, xOf, yOf, () => true, color)
      }
    }
  }

  // ── Fermi level ──────────────────────────────────────────────────────────────
  if (filling.electronsPerCell > 0 && !filling.overflow) {
    const y = Math.round(yOf(filling.fermiEnergy)) + 0.5
    if (y >= panel.y && y <= panel.y + panel.h) {
      ctx.strokeStyle = colors.amber
      ctx.lineWidth = 1.5
      ctx.setLineDash([6, 4])
      ctx.beginPath()
      ctx.moveTo(panel.x, y)
      ctx.lineTo(panel.x + panel.w, y)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.fillStyle = colors.amberText
      ctx.font = `600 11px ${MONO}`
      ctx.textAlign = 'left'
      ctx.textBaseline = 'bottom'
      ctx.fillText('E_F', panel.x + 6, y - 3)
    }
  }
  ctx.restore()

  // ── Frame, ticks, captions ───────────────────────────────────────────────────
  ctx.strokeStyle = colors.lineStrong
  ctx.lineWidth = 1
  ctx.strokeRect(panel.x + 0.5, panel.y + 0.5, panel.w - 1, panel.h - 1)

  ctx.font = `10px ${MONO}`
  ctx.fillStyle = colors.inkMuted
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  for (const tick of energyTicks(p.energyFloor, p.energyCeiling, panel.h)) {
    const y = yOf(tick)
    if (y < panel.y - 1 || y > panel.y + panel.h + 1) continue
    ctx.fillText(formatTick(tick), panel.x - 6, y)
    ctx.fillRect(panel.x - 3, Math.round(y), 3, 1)
  }

  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  const yLabel = panel.y + panel.h + 7
  ctx.fillText('−π/a', xOf(-kMax), yLabel)
  ctx.fillText('0', xOf(0), yLabel)
  ctx.fillText('π/a', xOf(kMax), yLabel)
  ctx.fillStyle = colors.inkSecondary
  ctx.textAlign = 'left'
  ctx.fillText('wavevector k →', panel.x, yLabel + 13)

  ctx.save()
  ctx.translate(13, panel.y + panel.h / 2)
  ctx.rotate(-Math.PI / 2)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = colors.inkSecondary
  ctx.fillText('energy (ħ = m = 1)', 0, 0)
  ctx.restore()
}

function drawBandSegment(
  ctx: CanvasRenderingContext2D,
  band: { energies: Float64Array },
  kSamples: Float64Array,
  sign: number,
  xOf: (k: number) => number,
  yOf: (e: number) => number,
  include: (e: number) => boolean,
  color: string
): void {
  ctx.strokeStyle = color
  ctx.beginPath()
  let open = false
  for (let j = 0; j < kSamples.length; j++) {
    const e = band.energies[j]
    if (!include(e)) {
      open = false
      continue
    }
    const x = xOf(sign * kSamples[j])
    const y = yOf(e)
    if (!open) {
      ctx.moveTo(x, y)
      open = true
    } else {
      ctx.lineTo(x, y)
    }
  }
  ctx.stroke()
}

function drawRealSpace(
  ctx: CanvasRenderingContext2D,
  p: RenderProps,
  panel: Panel,
  colors: VizColors,
  stacked: boolean
): void {
  const { structure, filling, barrier } = p
  const { bands } = structure
  const yOf = energyScale(p, panel)
  const cells = 3
  const a = barrier.period
  const xOf = (x: number) => panel.x + (x / (cells * a)) * panel.w

  ctx.save()
  ctx.beginPath()
  ctx.rect(panel.x, panel.y, panel.w, panel.h)
  ctx.clip()

  // ── Allowed bands as stripes across the crystal ──────────────────────────────
  for (const band of bands) {
    if (band.bottom > p.energyCeiling) break
    const isPartial = band.index === filling.highestOccupied && filling.partiallyFilled
    const yTop = yOf(Math.min(band.top, p.energyCeiling))
    const yBot = yOf(Math.max(band.bottom, p.energyFloor))
    // A tight-binding band can be thinner than a pixel; give it one so it is visible.
    const hPx = Math.max(1.5, yBot - yTop)
    if (isPartial) {
      const yF = yOf(filling.fermiEnergy)
      ctx.fillStyle = withAlpha(colors.violet, 0.16)
      ctx.fillRect(panel.x, yTop, panel.w, Math.max(0, yF - yTop))
      ctx.fillStyle = withAlpha(colors.teal, 0.35)
      ctx.fillRect(panel.x, yF, panel.w, Math.max(0, yBot - yF))
    } else {
      const color = occupancyColor(band.index, filling, colors)
      ctx.fillStyle = withAlpha(color, color === colors.teal ? 0.35 : 0.16)
      ctx.fillRect(panel.x, yTop, panel.w, hPx)
    }
  }

  // ── The potential, three cells of it ─────────────────────────────────────────
  const vTop = yOf(Math.min(barrier.height, p.energyCeiling))
  const vZero = yOf(0)
  ctx.fillStyle = withAlpha(colors.amber, 0.18)
  ctx.strokeStyle = colors.amber
  ctx.lineWidth = 1.75
  ctx.beginPath()
  ctx.moveTo(xOf(0), vZero)
  for (let c = 0; c < cells; c++) {
    const x0 = c * a + (a - barrier.width)
    const x1 = (c + 1) * a
    ctx.lineTo(xOf(x0), vZero)
    ctx.lineTo(xOf(x0), vTop)
    ctx.lineTo(xOf(x1), vTop)
    ctx.lineTo(xOf(x1), vZero)
  }
  ctx.stroke()
  for (let c = 0; c < cells; c++) {
    const x0 = c * a + (a - barrier.width)
    ctx.fillRect(xOf(x0), vTop, xOf(c * a + a) - xOf(x0), vZero - vTop)
  }

  // ── Fermi level ──────────────────────────────────────────────────────────────
  if (filling.electronsPerCell > 0 && !filling.overflow) {
    const y = Math.round(yOf(filling.fermiEnergy)) + 0.5
    if (y >= panel.y && y <= panel.y + panel.h) {
      ctx.strokeStyle = colors.amber
      ctx.lineWidth = 1.5
      ctx.setLineDash([6, 4])
      ctx.beginPath()
      ctx.moveTo(panel.x, y)
      ctx.lineTo(panel.x + panel.w, y)
      ctx.stroke()
      ctx.setLineDash([])
    }
  }

  // ── Gap labels ───────────────────────────────────────────────────────────────
  ctx.font = `600 10px ${MONO}`
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  for (let n = 1; n < bands.length; n++) {
    const lo = bands[n - 1].top
    const hi = bands[n].bottom
    const gap = hi - lo
    if (gap <= 1e-9) continue
    const yMid = yOf(0.5 * (lo + hi))
    if (yMid < panel.y + 6 || yMid > panel.y + panel.h - 6) continue
    if (yOf(lo) - yOf(hi) < 11) continue
    const text = `gap ${gap < 10 ? gap.toFixed(2) : gap.toFixed(1)}`
    // A backing box: the label often sits on the Fermi line or a barrier edge.
    const tw = ctx.measureText(text).width
    ctx.fillStyle = withAlpha(colors.surface2, 0.85)
    ctx.fillRect(panel.x + panel.w - tw - 9, yMid - 7, tw + 6, 14)
    ctx.fillStyle = colors.roseText
    ctx.fillText(text, panel.x + panel.w - 6, yMid)
  }

  // ── Band labels ──────────────────────────────────────────────────────────────
  ctx.textAlign = 'left'
  for (const band of bands) {
    if (band.bottom > p.energyCeiling) break
    const yMid = yOf(0.5 * (Math.max(band.bottom, p.energyFloor) + Math.min(band.top, p.energyCeiling)))
    if (yMid < panel.y + 6 || yMid > panel.y + panel.h - 6) continue
    const filledWord =
      band.index < filling.filledBands
        ? 'filled'
        : band.index === filling.highestOccupied && filling.partiallyFilled
          ? 'half'
          : 'empty'
    const text = `${band.index + 1} · ${filledWord}`
    const tw = ctx.measureText(text).width
    ctx.fillStyle = withAlpha(colors.surface2, 0.85)
    ctx.fillRect(panel.x + 3, yMid - 7, tw + 6, 14)
    ctx.fillStyle =
      band.index < filling.filledBands ||
      (band.index === filling.highestOccupied && filling.partiallyFilled)
        ? colors.tealText
        : colors.violetText
    ctx.fillText(text, panel.x + 6, yMid)
  }
  ctx.restore()

  ctx.strokeStyle = colors.lineStrong
  ctx.lineWidth = 1
  ctx.strokeRect(panel.x + 0.5, panel.y + 0.5, panel.w - 1, panel.h - 1)

  ctx.font = `10px ${MONO}`
  ctx.fillStyle = colors.inkMuted
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillText('position x → (three cells)', panel.x, panel.y + panel.h + 7)
  ctx.textAlign = 'right'
  ctx.fillText(`a = ${a.toFixed(2)}`, panel.x + panel.w, panel.y + panel.h + 7)

  if (stacked) {
    // The stacked layout's second panel needs its own tick labels.
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    for (const tick of energyTicks(p.energyFloor, p.energyCeiling, panel.h)) {
      const y = yOf(tick)
      if (y < panel.y - 1 || y > panel.y + panel.h + 1) continue
      ctx.fillText(formatTick(tick), panel.x - 6, y)
      ctx.fillRect(panel.x - 3, Math.round(y), 3, 1)
    }
  }
}
