'use client'

import { useEffect, useMemo, useRef } from 'react'
import {
  inversionPumpRate,
  lasingThresholdPumpRate,
  populationsDark,
  threeLevelSteadyState,
  thresholdInversion,
  twoLevelSteadyState,
  type ThreeLevelParams,
} from '@/lib/quantum/laser'
import type { Scheme } from '@/lib/viz/laserCartoon'
import { readVizColors, withAlpha, type VizColors } from './theme'
import { watchThemeChange } from './frameLoop'

/**
 * LaserCharts — the two quantitative panels: level populations against pump
 * rate, and cavity photon number against pump rate, both from the exact
 * steady state in lib/quantum/laser.ts.
 *
 * There is no frame loop here. The curves depend only on the medium, the
 * cavity lifetime and the level scheme, so they are sampled once per change
 * (useMemo) and repainted when the pump marker moves, the theme flips or the
 * container resizes. Nothing animates, so reduced-motion needs no special
 * path.
 */

export const CHART_HEIGHT = 210
/** Pump axis runs from 0 to this many multiples of A₂₁. */
export const PUMP_MAX = 4
const SAMPLES = 320

type Curves = {
  x: number[]
  N1: number[]
  N2: number[]
  N3: number[]
  N2dark: number[]
  n: number[]
  Wi: number
  Wth: number
  nMax: number
  nFloor: number
}

export function sampleCurves(p: ThreeLevelParams, scheme: Scheme): Curves {
  const x: number[] = []
  const N1: number[] = []
  const N2: number[] = []
  const N3: number[] = []
  const N2dark: number[] = []
  const n: number[] = []
  let nMax = 0
  for (let i = 0; i <= SAMPLES; i++) {
    const r = (PUMP_MAX * i) / SAMPLES
    const W = r * p.A21
    x.push(r)
    if (scheme === 'three') {
      const s = threeLevelSteadyState(p, W)
      N1.push(s.N1 / p.N)
      N2.push(s.N2 / p.N)
      N3.push(s.N3 / p.N)
      N2dark.push(populationsDark(p, W).N2 / p.N)
      n.push(s.n)
    } else {
      const s = twoLevelSteadyState({ A21: p.A21, K: p.K, tauC: p.tauC, N: p.N }, W)
      N1.push(s.N1 / p.N)
      N2.push(s.N2 / p.N)
      N3.push(0)
      N2dark.push(s.N2 / p.N)
      n.push(s.n)
    }
    nMax = Math.max(nMax, n[n.length - 1])
  }
  const Wi = scheme === 'three' ? inversionPumpRate(p) / p.A21 : Infinity
  const Wth = scheme === 'three' ? lasingThresholdPumpRate(p) / p.A21 : Infinity
  // What the mode holds just below threshold — the spontaneous floor the
  // photon panel quotes when there is no take-off to draw.
  const floorIdx = Number.isFinite(Wth)
    ? Math.max(0, Math.min(SAMPLES, Math.floor((0.9 * Wth * SAMPLES) / PUMP_MAX)))
    : SAMPLES
  return { x, N1, N2, N3, N2dark, n, Wi, Wth, nMax, nFloor: n[floorIdx] }
}

type Props = {
  params: ThreeLevelParams
  scheme: Scheme
  /** Current pump rate in units of A₂₁. */
  pumpRatio: number
  className?: string
}

export default function LaserCharts({ params, scheme, pumpRatio, className = '' }: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const popRef = useRef<HTMLCanvasElement | null>(null)
  const photRef = useRef<HTMLCanvasElement | null>(null)

  const curves = useMemo(() => sampleCurves(params, scheme), [params, scheme])
  const liveRef = useRef({ curves, pumpRatio, scheme, params })
  liveRef.current = { curves, pumpRatio, scheme, params }
  const paintRef = useRef<(() => void) | null>(null)

  // Repaint on any prop change; the observer and theme watcher below are
  // built once and read the live props through liveRef.
  useEffect(() => {
    paintRef.current?.()
  }, [curves, pumpRatio, scheme, params])

  useEffect(() => {
    const wrap = wrapRef.current
    const pop = popRef.current
    const phot = photRef.current
    if (!wrap || !pop || !phot) return
    const popCtx = pop.getContext('2d')
    const photCtx = phot.getContext('2d')
    if (!popCtx || !photCtx) return

    let colors = readVizColors(wrap)

    const setup = (canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, w: number, h: number) => {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    const paint = () => {
      const w = Math.max(1, Math.round(pop.getBoundingClientRect().width))
      const w2 = Math.max(1, Math.round(phot.getBoundingClientRect().width))
      setup(pop, popCtx, w, CHART_HEIGHT)
      setup(phot, photCtx, w2, CHART_HEIGHT)
      const live = liveRef.current
      drawPopulations(popCtx, w, CHART_HEIGHT, live.curves, live.pumpRatio, live.scheme, colors)
      drawPhotons(photCtx, w2, CHART_HEIGHT, live.curves, live.pumpRatio, live.scheme, live.params, colors)
    }

    paintRef.current = paint
    const observer = new ResizeObserver(paint)
    observer.observe(wrap)
    const stopTheme = watchThemeChange(() => {
      colors = readVizColors(wrap)
      paint()
    })
    paint()
    return () => {
      observer.disconnect()
      stopTheme()
      paintRef.current = null
    }
  }, [])

  return (
    <div ref={wrapRef} className={`grid gap-3 md:grid-cols-2 ${className}`}>
      <canvas
        ref={popRef}
        className="block w-full"
        style={{ height: CHART_HEIGHT }}
        role="img"
        aria-label={describePopulations(curves, pumpRatio, scheme)}
      />
      <canvas
        ref={photRef}
        className="block w-full"
        style={{ height: CHART_HEIGHT }}
        role="img"
        aria-label={describePhotons(curves, pumpRatio, scheme)}
      />
    </div>
  )
}

// ────────────────────────────────────────────────────────────
// Painting
// ────────────────────────────────────────────────────────────

const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace'
const PAD = { l: 40, r: 12, t: 22, b: 26 }

type Frame = { X: (r: number) => number; Y: (v: number) => number; plotW: number; plotH: number }

function frame(w: number, h: number, yMax: number): Frame {
  const plotW = Math.max(10, w - PAD.l - PAD.r)
  const plotH = Math.max(10, h - PAD.t - PAD.b)
  return {
    X: (r) => PAD.l + (r / PUMP_MAX) * plotW,
    Y: (v) => PAD.t + (1 - v / yMax) * plotH,
    plotW,
    plotH,
  }
}

function axes(ctx: CanvasRenderingContext2D, F: Frame, yTicks: { v: number; label: string }[], c: VizColors) {
  ctx.strokeStyle = withAlpha(c.inkMuted, 0.25)
  ctx.lineWidth = 1
  ctx.font = `9px ${MONO}`
  ctx.fillStyle = c.inkMuted
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  for (const t of yTicks) {
    ctx.beginPath()
    ctx.moveTo(PAD.l, F.Y(t.v))
    ctx.lineTo(PAD.l + F.plotW, F.Y(t.v))
    ctx.stroke()
    ctx.fillText(t.label, PAD.l - 5, F.Y(t.v))
  }
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  for (let r = 0; r <= PUMP_MAX; r++) {
    ctx.fillText(r === PUMP_MAX ? `${r}·A₂₁` : `${r}`, F.X(r), PAD.t + F.plotH + 5)
  }
}

function polyline(
  ctx: CanvasRenderingContext2D,
  F: Frame,
  xs: number[],
  ys: number[],
  color: string,
  width: number,
  dash?: number[]
) {
  ctx.beginPath()
  for (let i = 0; i < xs.length; i++) {
    const px = F.X(xs[i])
    const py = F.Y(ys[i])
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.setLineDash(dash ?? [])
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.stroke()
  ctx.setLineDash([])
}

function marker(
  ctx: CanvasRenderingContext2D,
  F: Frame,
  r: number,
  label: string,
  color: string,
  dash: number[],
  side: 'left' | 'right'
) {
  if (!Number.isFinite(r) || r < 0 || r > PUMP_MAX) return
  ctx.setLineDash(dash)
  ctx.beginPath()
  ctx.moveTo(F.X(r), PAD.t)
  ctx.lineTo(F.X(r), PAD.t + F.plotH)
  ctx.strokeStyle = color
  ctx.lineWidth = 1.25
  ctx.stroke()
  ctx.setLineDash([])
  ctx.font = `600 9px ${MONO}`
  ctx.fillStyle = color
  ctx.textBaseline = 'top'
  ctx.textAlign = side === 'left' ? 'right' : 'left'
  ctx.fillText(label, F.X(r) + (side === 'left' ? -3 : 3), PAD.t + 2)
}

function drawPopulations(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  cv: Curves,
  pump: number,
  scheme: Scheme,
  c: VizColors
) {
  ctx.clearRect(0, 0, w, h)
  const F = frame(w, h, 1)
  axes(ctx, F, [
    { v: 0, label: '0' },
    { v: 0.5, label: '½' },
    { v: 1, label: '1' },
  ], c)

  if (scheme === 'three') {
    polyline(ctx, F, cv.x, cv.N2dark, withAlpha(c.rose, 0.45), 1.25, [4, 4])
    polyline(ctx, F, cv.x, cv.N3, withAlpha(c.amber, 0.9), 1.5)
  }
  polyline(ctx, F, cv.x, cv.N1, withAlpha(c.sky, 0.95), 2)
  polyline(ctx, F, cv.x, cv.N2, withAlpha(c.rose, 0.95), 2)

  // Inversion and threshold: distinct lines when they are far enough apart to
  // read, a single labelled line when they sit on top of each other.
  if (scheme === 'three') {
    const close = Number.isFinite(cv.Wth) && Math.abs(cv.Wth - cv.Wi) < 0.05
    marker(ctx, F, cv.Wi, close ? 'inversion + threshold' : 'inversion', withAlpha(c.teal, 0.9), [2, 3], 'left')
    if (!close) marker(ctx, F, cv.Wth, Number.isFinite(cv.Wth) ? 'threshold' : '', withAlpha(c.violet, 0.9), [2, 3], 'right')
  }
  marker(ctx, F, pump, '', withAlpha(c.amber, 0.9), [3, 4], 'right')

  // Legend and title.
  ctx.font = `9px ${MONO}`
  ctx.textBaseline = 'top'
  ctx.textAlign = 'left'
  ctx.fillStyle = c.inkMuted
  ctx.fillText('Level populations / N vs pump rate', PAD.l + 2, 4)
  let lx = PAD.l + 2
  const ly = PAD.t + F.plotH - 12
  const item = (label: string, color: string) => {
    ctx.fillStyle = color
    ctx.fillRect(lx, ly + 3, 10, 3)
    lx += 13
    ctx.fillStyle = c.inkSecondary
    ctx.textBaseline = 'top'
    ctx.fillText(label, lx, ly)
    lx += ctx.measureText(label).width + 10
  }
  item('N₁ ground', c.sky)
  item('N₂ upper', c.rose)
  if (scheme === 'three') {
    item('N₃ pump band', c.amber)
    item('N₂ without a cavity', withAlpha(c.rose, 0.45))
  }
}

function formatPhotons(n: number): string {
  if (n < 1000) return n.toFixed(n < 10 ? 1 : 0)
  const e = Math.floor(Math.log10(n))
  const m = n / 10 ** e
  return `${m.toFixed(1)}×10^${e}`
}

function drawPhotons(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  cv: Curves,
  pump: number,
  scheme: Scheme,
  p: ThreeLevelParams,
  c: VizColors
) {
  ctx.clearRect(0, 0, w, h)
  const lases = scheme === 'three' && Number.isFinite(cv.Wth) && cv.Wth < PUMP_MAX
  const yMax = lases ? cv.nMax * 1.08 : Math.max(1, cv.nMax * 1.6)
  const F = frame(w, h, yMax)
  axes(ctx, F, [
    { v: 0, label: '0' },
    { v: yMax / 2, label: formatPhotons(yMax / 2) },
    { v: yMax, label: formatPhotons(yMax) },
  ], c)

  polyline(ctx, F, cv.x, cv.n, withAlpha(c.rose, 0.95), 2)
  // Fill under the curve so the take-off reads as a wedge, not a hairline.
  ctx.beginPath()
  ctx.moveTo(F.X(0), F.Y(0))
  for (let i = 0; i < cv.x.length; i++) ctx.lineTo(F.X(cv.x[i]), F.Y(cv.n[i]))
  ctx.lineTo(F.X(PUMP_MAX), F.Y(0))
  ctx.closePath()
  ctx.fillStyle = withAlpha(c.rose, 0.12)
  ctx.fill()

  if (scheme === 'three') marker(ctx, F, cv.Wth, Number.isFinite(cv.Wth) ? 'threshold' : '', withAlpha(c.violet, 0.9), [2, 3], 'left')
  marker(ctx, F, pump, '', withAlpha(c.amber, 0.9), [3, 4], 'right')

  // Current value dot.
  const idx = Math.max(0, Math.min(cv.x.length - 1, Math.round((pump / PUMP_MAX) * (cv.x.length - 1))))
  ctx.beginPath()
  ctx.arc(F.X(cv.x[idx]), F.Y(cv.n[idx]), 4, 0, Math.PI * 2)
  ctx.fillStyle = c.amberText
  ctx.fill()

  ctx.font = `9px ${MONO}`
  ctx.textBaseline = 'top'
  ctx.textAlign = 'left'
  ctx.fillStyle = c.inkMuted
  ctx.fillText('Photons in the cavity mode vs pump rate', PAD.l + 2, 4)
  ctx.fillStyle = c.inkSecondary
  const note = lases
    ? `below threshold: ~${formatPhotons(cv.nFloor)} spontaneous photons · ΔN_th = ${formatPhotons(thresholdInversion(p))} atoms`
    : scheme === 'two'
      ? `no inversion, no gain: the mode never holds more than ~${formatPhotons(cv.nMax)} photons`
      : `cavity too lossy for this medium: ΔN_th = ${formatPhotons(thresholdInversion(p))} > N`
  ctx.fillText(note, PAD.l + 2, PAD.t + F.plotH - 12)
}

// ────────────────────────────────────────────────────────────
// Accessible descriptions
// ────────────────────────────────────────────────────────────

function at(cv: Curves, key: 'N1' | 'N2' | 'N3' | 'n', pump: number): number {
  const idx = Math.max(0, Math.min(cv.x.length - 1, Math.round((pump / PUMP_MAX) * (cv.x.length - 1))))
  return cv[key][idx]
}

export function describePopulations(cv: Curves, pump: number, scheme: Scheme): string {
  const pct = (v: number) => `${(v * 100).toFixed(1)} percent`
  const head =
    scheme === 'three'
      ? `Fractions of atoms in the ground level, the upper laser level and the pump band, plotted against pump rate from 0 to ${PUMP_MAX} times the spontaneous rate. `
      : `Fractions of atoms in the ground and upper levels of a two-level system, plotted against pump rate from 0 to ${PUMP_MAX} times the spontaneous rate. The two curves approach one half and never cross. `
  const marks =
    scheme === 'three'
      ? `Inversion begins at ${cv.Wi.toFixed(2)} times the spontaneous rate; lasing threshold is at ${
          Number.isFinite(cv.Wth) ? cv.Wth.toFixed(3) : 'no reachable pump rate'
        }. `
      : ''
  return (
    head +
    marks +
    `At the current pump, ${pump.toFixed(2)} times the spontaneous rate: ground ${pct(at(cv, 'N1', pump))}, upper ${pct(at(cv, 'N2', pump))}` +
    (scheme === 'three' ? `, pump band ${pct(at(cv, 'N3', pump))}.` : '.')
  )
}

export function describePhotons(cv: Curves, pump: number, scheme: Scheme): string {
  const n = at(cv, 'n', pump)
  if (scheme === 'two') {
    return `Cavity photon number against pump rate for a two-level medium: a flat line near zero. At the current pump it holds ${formatPhotons(n)} photons, all spontaneous.`
  }
  if (!Number.isFinite(cv.Wth)) {
    return `Cavity photon number against pump rate. This cavity is too lossy for the medium to reach threshold; the mode holds ${formatPhotons(n)} photons at the current pump.`
  }
  return (
    `Cavity photon number against pump rate: near zero up to the threshold at ${cv.Wth.toFixed(3)} times the spontaneous rate, then a straight line rising to ${formatPhotons(cv.nMax)} photons at ${PUMP_MAX} times. ` +
    `At the current pump, ${pump.toFixed(2)}, the mode holds ${formatPhotons(n)} photons.`
  )
}
