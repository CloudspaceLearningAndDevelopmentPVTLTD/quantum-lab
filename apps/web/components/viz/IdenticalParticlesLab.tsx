'use client'

import { useEffect, useRef } from 'react'
import type { Grid } from '@/lib/quantum/schrodinger'
import { separationDistribution, type Statistics } from '@/lib/quantum/identicalParticles'
import { mixColors, readVizColors, withAlpha, type VizColors } from './theme'
import { watchThemeChange } from './frameLoop'

/**
 * IdenticalParticlesLab — |ψ(x₁,x₂)|² as a heat map, with the separation distribution
 * P(x₁ − x₂) beside it and any sampled pairs scattered on top.
 *
 * Nothing animates. The picture is a static answer to a static question (which
 * statistics, which two orbitals), so there is no frame loop and prefers-reduced-motion
 * is satisfied by construction. The canvas repaints on prop change, resize and theme flip,
 * the same pattern as BoundStatesLab.
 *
 * The amplitude arrives as a prop rather than being built here: the page quotes the same
 * numbers (norm, ⟨(x₁−x₂)²⟩, P(0)) and two builds would be two chances to disagree.
 */

export type LabProps = {
  grid: Grid
  /** Row-major n×n amplitude, or null when the state does not exist (two fermions, one orbital). */
  psi: Float64Array | null
  /** The no-exchange product state for the same two orbitals — the dashed reference curve. */
  reference: Float64Array | null
  statistics: Statistics
  orbitalA: number
  orbitalB: number
  samples: Array<[number, number]>
  showReference: boolean
  className?: string
}

type Layout = {
  w: number
  h: number
  heat: { x: number; y: number; side: number }
  sep: { x: number; y: number; w: number; h: number }
}

const PAD = 14
const AXIS = 26

/** Side-by-side above 620px, stacked below. Pure, so the height is known before painting. */
export function layoutFor(width: number): Layout {
  const w = Math.max(280, width)
  if (w >= 620) {
    const h = 420
    const side = h - 2 * PAD - AXIS
    const heat = { x: PAD + AXIS, y: PAD, side }
    const sepX = heat.x + side + 28
    return { w, h, heat, sep: { x: sepX, y: PAD + 8, w: w - sepX - PAD, h: side - 8 } }
  }
  const side = w - 2 * PAD - AXIS
  const sepH = 150
  const h = PAD + side + AXIS + 18 + sepH + PAD
  return {
    w,
    h,
    heat: { x: PAD + AXIS, y: PAD, side },
    sep: { x: PAD + AXIS, y: PAD + side + AXIS + 18, w: side, h: sepH },
  }
}

export default function IdenticalParticlesLab(props: LabProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const layoutRef = useRef<Layout | null>(null)
  const colorsRef = useRef<VizColors | null>(null)
  const heatRef = useRef<HTMLCanvasElement | null>(null)
  const propsRef = useRef(props)
  propsRef.current = props

  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    colorsRef.current = readVizColors(wrap)
    heatRef.current = document.createElement('canvas')

    const paint = () => {
      const layout = layoutRef.current
      const colors = colorsRef.current
      if (layout && colors) render(ctx, heatRef.current!, propsRef.current, layout, colors)
    }

    let lastWidth = -1
    const resize = () => {
      const width = Math.round(wrap.getBoundingClientRect().width)
      if (width === lastWidth) return
      lastWidth = width
      const layout = layoutFor(width)
      layoutRef.current = layout
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      canvas.width = Math.round(layout.w * dpr)
      canvas.height = Math.round(layout.h * dpr)
      canvas.style.width = `${layout.w}px`
      canvas.style.height = `${layout.h}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
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
    const layout = layoutRef.current
    const colors = colorsRef.current
    const heat = heatRef.current
    const ctx = canvas?.getContext('2d')
    if (ctx && layout && colors && heat) render(ctx, heat, propsRef.current, layout, colors)
  })

  const { statistics, orbitalA, orbitalB, psi, samples } = props
  const who =
    statistics === 'boson' ? 'two bosons' : statistics === 'fermion' ? 'two fermions' : 'two distinguishable particles'
  const label = psi
    ? `Joint probability density of ${who} in orbitals ${orbitalA} and ${orbitalB} of a box, as a heat map ` +
      `over x1 and x2, with the diagonal x1 equals x2 marked${
        statistics === 'fermion' ? ' and the density zero along it' : ''
      }. Beside it, the distribution of the separation x1 minus x2${
        samples.length > 0 ? `, and ${samples.length} sampled pairs drawn as dots` : ''
      }.`
    : `No state to draw: two fermions cannot both occupy orbital ${orbitalA}.`

  return (
    <div ref={wrapRef} className={`relative w-full ${props.className ?? ''}`}>
      <canvas ref={canvasRef} className="block" role="img" aria-label={label} />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Painting
// ─────────────────────────────────────────────────────────────────────────────

/** Sequential ramp: canvas background → rose → warm highlight. Monotone in both themes. */
function ramp(colors: VizColors, t: number): string {
  if (t < 0.55) return mixColors(colors.surface2, colors.rose, t / 0.55)
  return mixColors(colors.rose, colors.amberText, (t - 0.55) / 0.45)
}

/** The slice of a canvas element the heat-map pass needs; a test supplies a fake. */
export type HeatTarget = {
  width: number
  height: number
  getContext(kind: '2d'): {
    createImageData(w: number, h: number): ImageData
    putImageData(image: ImageData, x: number, y: number): void
  } | null
}

/** Exported for the render-path test. Draws the whole scene into `ctx`. */
export function render(
  ctx: CanvasRenderingContext2D,
  heatCanvas: HeatTarget,
  p: LabProps,
  layout: Layout,
  colors: VizColors
): void {
  const { w, h, heat, sep } = layout
  const { grid, psi } = p
  const n = grid.n
  const length = grid.dx * (n + 1) // boxGrid: walls at 0 and L

  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = colors.surface2
  ctx.fillRect(0, 0, w, h)

  ctx.font = '11px ui-sans-serif, system-ui, sans-serif'
  ctx.textBaseline = 'middle'

  // ── Heat map ────────────────────────────────────────────────────────────────
  const hx = heat.x
  const hy = heat.y
  const side = heat.side

  if (psi) {
    // Paint the n×n density into an offscreen canvas at native resolution, then scale it
    // up in one drawImage: 16k cells as one blit rather than 16k fillRects per repaint.
    if (heatCanvas.width !== n || heatCanvas.height !== n) {
      heatCanvas.width = n
      heatCanvas.height = n
    }
    const hctx = heatCanvas.getContext('2d')
    if (hctx) {
      const image = hctx.createImageData(n, n)
      let peak = 0
      for (let k = 0; k < psi.length; k++) peak = Math.max(peak, psi[k] * psi[k])
      const inv = peak > 0 ? 1 / peak : 0
      // Precompute a 64-step colour table; parsing "rgb(…)" per pixel is the slow part.
      const steps = 64
      const table: Array<[number, number, number]> = []
      for (let s = 0; s <= steps; s++) table.push(parseRgb(ramp(colors, s / steps)))
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          const v = psi[i * n + j]
          const t = v * v * inv
          const [r, g, b] = table[Math.round(t * steps)]
          // Image row 0 is the top; x₂ (index j) increases upward, x₁ (index i) rightward.
          const o = ((n - 1 - j) * n + i) * 4
          image.data[o] = r
          image.data[o + 1] = g
          image.data[o + 2] = b
          image.data[o + 3] = 255
        }
      }
      hctx.putImageData(image, 0, 0)
    }
    ctx.save()
    ctx.imageSmoothingEnabled = true
    ctx.drawImage(heatCanvas as HTMLCanvasElement, hx, hy, side, side)
    ctx.restore()
  } else {
    ctx.fillStyle = withAlpha(colors.rose, 0.08)
    ctx.fillRect(hx, hy, side, side)
    ctx.fillStyle = colors.inkSecondary
    ctx.textAlign = 'center'
    ctx.font = 'bold 13px ui-sans-serif, system-ui, sans-serif'
    ctx.fillText('No such state', hx + side / 2, hy + side / 2 - 10)
    ctx.font = '11px ui-sans-serif, system-ui, sans-serif'
    ctx.fillText('two fermions, one orbital: ψ ≡ 0', hx + side / 2, hy + side / 2 + 10)
  }

  // Diagonal x₁ = x₂, bottom-left to top-right.
  ctx.save()
  ctx.setLineDash([4, 4])
  ctx.strokeStyle = withAlpha(colors.ink, 0.55)
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(hx, hy + side)
  ctx.lineTo(hx + side, hy)
  ctx.stroke()
  ctx.restore()

  // Sampled pairs.
  if (psi && p.samples.length > 0) {
    ctx.fillStyle = withAlpha(colors.ink, 0.85)
    for (const [x1, x2] of p.samples) {
      const px = hx + (x1 / length) * side
      const py = hy + side - (x2 / length) * side
      ctx.beginPath()
      ctx.arc(px, py, 1.6, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  // Frame and axes.
  ctx.strokeStyle = colors.lineStrong
  ctx.lineWidth = 1
  ctx.strokeRect(hx + 0.5, hy + 0.5, side - 1, side - 1)
  ctx.fillStyle = colors.inkMuted
  ctx.textAlign = 'center'
  ctx.fillText('0', hx, hy + side + 12)
  ctx.fillText('L', hx + side, hy + side + 12)
  ctx.fillStyle = colors.inkSecondary
  ctx.fillText('x₁  (particle 1)', hx + side / 2, hy + side + 12)
  ctx.save()
  ctx.translate(hx - 14, hy + side / 2)
  ctx.rotate(-Math.PI / 2)
  ctx.fillText('x₂  (particle 2)', 0, 0)
  ctx.restore()
  ctx.fillStyle = colors.inkMuted
  ctx.textAlign = 'right'
  ctx.fillText('L', hx - 4, hy + 6)
  ctx.fillText('0', hx - 4, hy + side - 6)

  // Diagonal label.
  ctx.fillStyle = withAlpha(colors.ink, 0.7)
  ctx.textAlign = 'left'
  ctx.fillText('x₁ = x₂', hx + side - 44, hy + 12)

  // ── Separation distribution ────────────────────────────────────────────────
  const sx = sep.x
  const sy = sep.y
  const sw = sep.w
  const sh = sep.h
  const plotBottom = sy + sh - 18
  const plotTop = sy + 14
  const plotH = plotBottom - plotTop

  const current = psi ? separationDistribution(psi, grid) : null
  const ref = p.reference ? separationDistribution(p.reference, grid) : null
  let peak = 0
  if (current) for (let k = 0; k < current.density.length; k++) peak = Math.max(peak, current.density[k])
  if (ref && p.showReference) for (let k = 0; k < ref.density.length; k++) peak = Math.max(peak, ref.density[k])
  if (!(peak > 0)) peak = 1

  const xOf = (r: number) => sx + ((r + length) / (2 * length)) * sw
  const yOf = (d: number) => plotBottom - (d / peak) * plotH

  // Baseline and the r = 0 marker.
  ctx.strokeStyle = colors.lineStrong
  ctx.beginPath()
  ctx.moveTo(sx, plotBottom + 0.5)
  ctx.lineTo(sx + sw, plotBottom + 0.5)
  ctx.stroke()
  ctx.save()
  ctx.setLineDash([3, 3])
  ctx.strokeStyle = withAlpha(colors.ink, 0.35)
  ctx.beginPath()
  ctx.moveTo(xOf(0) + 0.5, plotTop)
  ctx.lineTo(xOf(0) + 0.5, plotBottom)
  ctx.stroke()
  ctx.restore()

  if (ref && p.showReference) {
    ctx.save()
    ctx.setLineDash([5, 4])
    ctx.strokeStyle = withAlpha(colors.inkSecondary, 0.8)
    ctx.lineWidth = 1.25
    ctx.beginPath()
    for (let k = 0; k < ref.density.length; k++) {
      const x = xOf(ref.r[k])
      const y = yOf(ref.density[k])
      if (k === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
    ctx.restore()
  }

  if (current) {
    const accent = p.statistics === 'fermion' ? colors.rose : p.statistics === 'boson' ? colors.teal : colors.violet
    ctx.beginPath()
    ctx.moveTo(xOf(current.r[0]), plotBottom)
    for (let k = 0; k < current.density.length; k++) ctx.lineTo(xOf(current.r[k]), yOf(current.density[k]))
    ctx.lineTo(xOf(current.r[current.density.length - 1]), plotBottom)
    ctx.closePath()
    ctx.fillStyle = withAlpha(accent, 0.28)
    ctx.fill()
    ctx.strokeStyle = accent
    ctx.lineWidth = 1.5
    ctx.beginPath()
    for (let k = 0; k < current.density.length; k++) {
      const x = xOf(current.r[k])
      const y = yOf(current.density[k])
      if (k === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
  }

  ctx.fillStyle = colors.inkSecondary
  ctx.textAlign = 'left'
  ctx.fillText('P(x₁ − x₂)', sx, sy + 2)
  ctx.fillStyle = colors.inkMuted
  ctx.textAlign = 'center'
  ctx.fillText('−L', xOf(-length) + 8, plotBottom + 10)
  ctx.fillText('0', xOf(0), plotBottom + 10)
  ctx.fillText('+L', xOf(length) - 8, plotBottom + 10)
  if (p.showReference && ref) {
    ctx.textAlign = 'right'
    ctx.fillStyle = colors.inkMuted
    ctx.fillText('dashed: no exchange', sx + sw, sy + 2)
  }
}

function parseRgb(color: string): [number, number, number] {
  const m = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(color)
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])]
  const hex = /^#([0-9a-f]{6})$/i.exec(color.trim())
  if (hex) {
    const v = Number.parseInt(hex[1], 16)
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
  }
  return [128, 128, 128]
}
