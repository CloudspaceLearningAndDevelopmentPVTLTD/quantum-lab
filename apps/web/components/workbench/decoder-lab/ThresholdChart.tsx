'use client'

import { useEffect, useRef } from 'react'
import { readVizColors, withAlpha, type VizColors } from '@/components/viz/theme'
import { watchThemeChange } from '@/components/viz/frameLoop'
import { rateWithInterval, type CurveKey, type SweepPoint } from '@/lib/qec/session'

/**
 * ThresholdChart — logical error rate against physical error rate, log-y.
 *
 * MWPM at every distance is drawn in sky, thin to thick with d, so the crossing
 * is visible as the point where the thick line stops being the lowest. The
 * learned decoders sit on top at the trained distance only. Points with zero
 * failures are drawn as open markers at the 95% upper bound — a logical error
 * rate of exactly zero is never a measurement, only a sample size.
 *
 * Colours come from the CSS tokens at runtime (components/viz/theme.ts); the
 * canvas repaints on theme change and on resize. No animation: the chart is a
 * static picture of the numbers in the table beneath it, which is the
 * accessible rendering of the same data.
 */

export const CURVE_STYLE: Record<CurveKey, { label: string; color: keyof VizColors; text: keyof VizColors; width: number; alpha: number; dash?: number[] }> = {
  'mwpm-3': { label: 'MWPM d = 3', color: 'sky', text: 'skyText', width: 1.25, alpha: 0.55 },
  'mwpm-5': { label: 'MWPM d = 5', color: 'sky', text: 'skyText', width: 1.75, alpha: 0.8 },
  'mwpm-7': { label: 'MWPM d = 7', color: 'sky', text: 'skyText', width: 2.5, alpha: 1 },
  lookup: { label: 'lookup table', color: 'amber', text: 'amberText', width: 2, alpha: 1 },
  mlp: { label: 'MLP', color: 'violet', text: 'violetText', width: 2, alpha: 1 },
  transformer: { label: 'transformer', color: 'rose', text: 'roseText', width: 2, alpha: 1 },
}

export const CURVE_ORDER: CurveKey[] = ['mwpm-3', 'mwpm-5', 'mwpm-7', 'lookup', 'mlp', 'transformer']

type Props = {
  points: SweepPoint[]
  /** Distance the learned decoders were trained at. */
  d: number
  trainedAtP: number | null
  trainedSamples: number | null
  thresholdGuide: number
  /** Physical error rate of a bare qubit is p; the chart draws that as the break-even line. */
  className?: string
  ariaLabel: string
}

export default function ThresholdChart({ points, d, trainedAtP, trainedSamples, thresholdGuide, className = '', ariaLabel }: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const propsRef = useRef({ points, d, trainedAtP, trainedSamples, thresholdGuide })
  propsRef.current = { points, d, trainedAtP, trainedSamples, thresholdGuide }

  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    let colors = readVizColors(wrap)
    let size = { w: 0, h: 0 }

    const paint = (): void => {
      if (size.w > 0 && size.h > 0) render(ctx, propsRef.current, size.w, size.h, colors)
    }
    const resize = (): void => {
      const rect = wrap.getBoundingClientRect()
      const w = Math.max(1, Math.round(rect.width))
      const h = Math.max(1, Math.round(rect.height))
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      size = { w, h }
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      paint()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(wrap)
    resize()
    const stopTheme = watchThemeChange(() => {
      colors = readVizColors(wrap)
      paint()
    })
    return () => {
      observer.disconnect()
      stopTheme()
    }
  }, [])

  // Repaint whenever the data changes. The effect above owns sizing; this one
  // only needs a fresh draw with the same context.
  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const rect = wrap.getBoundingClientRect()
    render(ctx, propsRef.current, Math.round(rect.width), Math.round(rect.height), readVizColors(wrap))
  }, [points, d, trainedAtP, trainedSamples, thresholdGuide])

  return (
    <div ref={wrapRef} className={`relative w-full ${className}`} style={{ height: 380 }}>
      <canvas ref={canvasRef} className="block h-full w-full" role="img" aria-label={ariaLabel} />
    </div>
  )
}

function render(
  ctx: CanvasRenderingContext2D,
  props: { points: SweepPoint[]; d: number; trainedAtP: number | null; trainedSamples: number | null; thresholdGuide: number },
  w: number,
  h: number,
  colors: VizColors
): void {
  ctx.clearRect(0, 0, w, h)
  const pad = { left: 56, right: 18, top: 34, bottom: 40 }
  const left = pad.left
  const right = w - pad.right
  const top = pad.top
  const bottom = h - pad.bottom
  const cw = right - left
  const ch = bottom - top
  if (cw < 20 || ch < 20) return
  const mono = '10px ui-monospace, SFMono-Regular, Menlo, monospace'

  const pts = props.points.filter(Boolean)
  const xMax = Math.max(props.thresholdGuide * 1.3, ...pts.map((p) => p.p), 0.05) * 1.05
  // Log-y: floor at the smallest resolvable rate on the chart.
  let yMin = 1e-3
  for (const pt of pts) {
    for (const c of Object.values(pt.curves)) {
      if (!c) continue
      const r = rateWithInterval(c)
      const floor = r.rate > 0 ? r.rate : r.hi
      if (floor > 0) yMin = Math.min(yMin, floor)
    }
  }
  yMin = Math.pow(10, Math.floor(Math.log10(Math.max(yMin, 1e-5))))
  const yMax = 1
  const logMin = Math.log10(yMin)
  const logMax = Math.log10(yMax)
  const xOf = (p: number) => left + (p / xMax) * cw
  const yOf = (rate: number) => bottom - ((Math.log10(Math.max(rate, yMin)) - logMin) / (logMax - logMin)) * ch

  // Frame and gridlines.
  ctx.strokeStyle = colors.line
  ctx.lineWidth = 1
  ctx.strokeRect(left, top, cw, ch)
  ctx.font = mono
  ctx.fillStyle = colors.inkMuted
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  for (let e = Math.round(logMin); e <= 0; e++) {
    const y = yOf(Math.pow(10, e))
    ctx.strokeStyle = withAlpha(colors.ink, 0.07)
    ctx.beginPath()
    ctx.moveTo(left, y)
    ctx.lineTo(right, y)
    ctx.stroke()
    ctx.fillText(e === 0 ? '100%' : e === -1 ? '10%' : e === -2 ? '1%' : `10^${e}`, left - 6, y)
  }
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  const xTicks = xMax > 0.12 ? [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3] : [0, 0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07, 0.08]
  for (const t of xTicks) {
    if (t > xMax) break
    ctx.fillText(`${(t * 100).toFixed(xMax > 0.12 ? 0 : 1)}%`, xOf(t), bottom + 5)
  }
  ctx.fillStyle = colors.inkSecondary
  ctx.fillText('physical error rate p (depolarising, per qubit per round)', left + cw / 2, bottom + 20)
  ctx.save()
  ctx.translate(14, top + ch / 2)
  ctx.rotate(-Math.PI / 2)
  ctx.textBaseline = 'middle'
  ctx.fillText('logical error rate per shot', 0, 0)
  ctx.restore()

  // Break-even: an unencoded qubit fails with probability p.
  ctx.save()
  ctx.setLineDash([3, 4])
  ctx.strokeStyle = withAlpha(colors.ink, 0.35)
  ctx.lineWidth = 1
  ctx.beginPath()
  let started = false
  for (let i = 0; i <= 60; i++) {
    const p = (xMax * i) / 60
    if (p < yMin) continue
    const x = xOf(p)
    const y = yOf(p)
    if (!started) {
      ctx.moveTo(x, y)
      started = true
    } else ctx.lineTo(x, y)
  }
  ctx.stroke()
  // Threshold guide.
  ctx.setLineDash([6, 4])
  ctx.strokeStyle = withAlpha(colors.teal, 0.8)
  const gx = xOf(props.thresholdGuide)
  if (gx > left && gx < right) {
    ctx.beginPath()
    ctx.moveTo(gx, top)
    ctx.lineTo(gx, bottom)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.fillStyle = colors.tealText
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.fillText('≈ textbook threshold', gx + 4, top + 4)
  }
  ctx.restore()
  ctx.fillStyle = withAlpha(colors.ink, 0.5)
  ctx.textAlign = 'right'
  ctx.textBaseline = 'bottom'
  const beX = Math.min(xMax, 0.95 * xMax)
  if (beX > yMin) ctx.fillText('no code (rate = p)', xOf(beX) - 2, yOf(beX) - 3)

  // Curves.
  const sorted = pts.slice().sort((a, b) => a.p - b.p)
  for (const key of CURVE_ORDER) {
    const style = CURVE_STYLE[key]
    const series = sorted
      .map((pt) => ({ p: pt.p, c: pt.curves[key] }))
      .filter((s): s is { p: number; c: { failures: number; shots: number } } => !!s.c && s.c.shots > 0)
    if (series.length === 0) continue
    const color = withAlpha(colors[style.color], style.alpha)

    // Confidence band.
    if (key !== 'mwpm-3' && key !== 'mwpm-5') {
      ctx.fillStyle = withAlpha(colors[style.color], 0.1)
      ctx.beginPath()
      series.forEach((s, i) => {
        const r = rateWithInterval(s.c)
        const y = yOf(Math.max(r.hi, yMin))
        if (i === 0) ctx.moveTo(xOf(s.p), y)
        else ctx.lineTo(xOf(s.p), y)
      })
      for (let i = series.length - 1; i >= 0; i--) {
        const r = rateWithInterval(series[i].c)
        ctx.lineTo(xOf(series[i].p), yOf(Math.max(r.lo, yMin)))
      }
      ctx.closePath()
      ctx.fill()
    }

    ctx.strokeStyle = color
    ctx.lineWidth = style.width
    ctx.lineJoin = 'round'
    ctx.beginPath()
    series.forEach((s, i) => {
      const r = rateWithInterval(s.c)
      const y = yOf(r.rate > 0 ? r.rate : r.hi)
      if (i === 0) ctx.moveTo(xOf(s.p), y)
      else ctx.lineTo(xOf(s.p), y)
    })
    ctx.stroke()
    for (const s of series) {
      const r = rateWithInterval(s.c)
      const x = xOf(s.p)
      ctx.beginPath()
      if (r.rate > 0) {
        ctx.arc(x, yOf(r.rate), 3, 0, Math.PI * 2)
        ctx.fillStyle = color
        ctx.fill()
      } else {
        // Zero failures: open marker at the upper bound.
        ctx.arc(x, yOf(r.hi), 3.5, 0, Math.PI * 2)
        ctx.fillStyle = colors.surface2
        ctx.fill()
        ctx.stroke()
      }
    }
  }

  // Legend.
  ctx.font = mono
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  let lx = left + 6
  const ly = top - 12
  const present = new Set<CurveKey>()
  for (const pt of pts) for (const k of Object.keys(pt.curves)) present.add(k as CurveKey)
  for (const key of CURVE_ORDER) {
    if (!present.has(key)) continue
    const style = CURVE_STYLE[key]
    ctx.fillStyle = colors[style.text]
    const text = `— ${style.label}`
    ctx.fillText(text, lx, ly)
    lx += ctx.measureText(text).width + 14
  }

  // Annotation.
  if (props.trainedSamples !== null && props.trainedAtP !== null) {
    ctx.fillStyle = colors.inkMuted
    ctx.textAlign = 'right'
    ctx.textBaseline = 'top'
    ctx.fillText(
      `learned decoders: d = ${props.d}, trained on ${props.trainedSamples.toLocaleString('en-US')} samples at p = ${(props.trainedAtP * 100).toFixed(1)}%`,
      right - 4,
      bottom - 14
    )
  }
}
