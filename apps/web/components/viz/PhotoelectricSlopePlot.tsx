'use client'

import { useEffect, useRef } from 'react'
import {
  METALS,
  stoppingVoltageV,
  thresholdFrequencyHz,
  type Metal,
} from '@/lib/viz/photoelectric'
import { readVizColors, withAlpha, type VizColors } from './theme'
import { watchThemeChange } from './frameLoop'

/**
 * PhotoelectricSlopePlot — stopping voltage against frequency, the graph Millikan
 * spent ten years measuring in an attempt to prove Einstein wrong.
 *
 * Nothing here moves, so there is no frame loop: the canvas is repainted when the
 * controls change, when the element resizes, and when the theme flips. A canvas
 * rather than SVG only because the rest of the page's plotting lives on canvas and
 * the two should look like one drawing.
 *
 * Every point is sampled from `stoppingVoltageV`, the same function the readouts on
 * the page use — the straight line is a *result* of Einstein's equation being plotted,
 * not a straight line drawn to look like one. The slope triangle is measured off two
 * plotted points, so the h it quotes is genuinely read from the graph.
 */

const PAD_L = 46
const PAD_R = 18
const PAD_T = 16
const PAD_B = 40

/** Axis limits, in Hz and volts. Chosen so platinum's threshold at 1.53e15 Hz fits. */
const F_MAX = 20e14
const V_MAX = 6.5

type Props = {
  activeMetal: Metal
  /** The frequency the controls are currently set to, marked on the plot. */
  frequencyHz: number
  className?: string
}

export default function PhotoelectricSlopePlot({
  activeMetal,
  frequencyHz,
  className = '',
}: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const sizeRef = useRef({ w: 0, h: 0 })
  const propsRef = useRef({ activeMetal, frequencyHz })
  propsRef.current = { activeMetal, frequencyHz }
  const repaintRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    repaintRef.current?.()
  }, [activeMetal, frequencyHz])

  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let colors = readVizColors(wrap)

    const repaint = (): void => {
      const { w, h } = sizeRef.current
      if (w > 0 && h > 0) renderSlopePlot(ctx, propsRef.current, w, h, colors)
    }
    repaintRef.current = repaint

    const stopTheme = watchThemeChange(() => {
      colors = readVizColors(wrap)
      repaint()
    })

    const resize = (): void => {
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
      repaint()
    }

    const observer = new ResizeObserver(resize)
    observer.observe(wrap)
    resize()

    return () => {
      observer.disconnect()
      stopTheme()
      repaintRef.current = null
    }
  }, [])

  const f0 = thresholdFrequencyHz(activeMetal.workFunctionEv)
  const stop = stoppingVoltageV(frequencyHz, activeMetal.workFunctionEv)
  const label =
    `Stopping voltage against light frequency for sodium, zinc, copper and platinum. ` +
    `Four parallel straight lines of identical slope h over e, each starting from its own ` +
    `threshold frequency. ${activeMetal.name} is highlighted: its threshold is ` +
    `${(f0 / 1e14).toFixed(2)} times ten to the fourteen hertz, and at the ` +
    `${(frequencyHz / 1e14).toFixed(2)} times ten to the fourteen hertz currently selected ` +
    `the stopping voltage is ${stop.toFixed(2)} volts.`

  return (
    <div ref={wrapRef} className={`relative w-full ${className}`} style={{ height: 320 }}>
      <canvas ref={canvasRef} className="block h-full w-full" role="img" aria-label={label} />
    </div>
  )
}

export function renderSlopePlot(
  ctx: CanvasRenderingContext2D,
  props: { activeMetal: Metal; frequencyHz: number },
  w: number,
  h: number,
  colors: VizColors
): void {
  const { activeMetal, frequencyHz } = props
  ctx.clearRect(0, 0, w, h)

  const plotW = Math.max(20, w - PAD_L - PAD_R)
  const plotH = Math.max(20, h - PAD_T - PAD_B)
  const xOf = (f: number) => PAD_L + (f / F_MAX) * plotW
  const yOf = (v: number) => PAD_T + plotH - (v / V_MAX) * plotH
  const mono = (size: number, weight = '600') =>
    `${weight} ${size}px ui-monospace, SFMono-Regular, Menlo, monospace`

  // ── Grid ──
  ctx.strokeStyle = withAlpha(colors.inkMuted, 0.12)
  ctx.lineWidth = 1
  ctx.font = mono(10, '400')
  ctx.fillStyle = colors.inkMuted
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  for (let v = 0; v <= V_MAX; v += 1) {
    const y = Math.round(yOf(v)) + 0.5
    ctx.beginPath()
    ctx.moveTo(PAD_L, y)
    ctx.lineTo(PAD_L + plotW, y)
    ctx.stroke()
    ctx.fillText(`${v}`, PAD_L - 8, y)
  }
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  for (let f = 0; f <= F_MAX; f += 4e14) {
    const x = Math.round(xOf(f)) + 0.5
    ctx.beginPath()
    ctx.moveTo(x, PAD_T)
    ctx.lineTo(x, PAD_T + plotH)
    ctx.stroke()
    ctx.fillText(`${(f / 1e14).toFixed(0)}`, x, PAD_T + plotH + 6)
  }

  ctx.fillStyle = colors.inkSecondary
  ctx.font = mono(10)
  ctx.textAlign = 'right'
  ctx.fillText('frequency (10¹⁴ Hz) →', PAD_L + plotW, PAD_T + plotH + 22)
  ctx.save()
  ctx.translate(12, PAD_T + plotH / 2)
  ctx.rotate(-Math.PI / 2)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.fillText('stopping voltage (V)', 0, 0)
  ctx.restore()

  // ── One line per metal, sampled from the physics rather than drawn as y = mx + c ──
  for (const metal of METALS) {
    const active = metal.id === activeMetal.id
    const f0 = thresholdFrequencyHz(metal.workFunctionEv)
    if (f0 >= F_MAX) continue
    ctx.beginPath()
    let started = false
    for (let i = 0; i <= 120; i++) {
      const f = f0 + ((F_MAX - f0) * i) / 120
      const v = stoppingVoltageV(f, metal.workFunctionEv)
      if (v > V_MAX) break
      const x = xOf(f)
      const y = yOf(v)
      if (!started) {
        ctx.moveTo(x, y)
        started = true
      } else ctx.lineTo(x, y)
    }
    ctx.strokeStyle = active ? colors.amber : withAlpha(colors.inkMuted, 0.4)
    ctx.lineWidth = active ? 2.25 : 1.25
    ctx.stroke()

    // Threshold intercept.
    ctx.beginPath()
    ctx.arc(xOf(f0), yOf(0), active ? 4 : 2.5, 0, Math.PI * 2)
    ctx.fillStyle = active ? colors.amber : withAlpha(colors.inkMuted, 0.5)
    ctx.fill()

    ctx.font = mono(10, active ? '700' : '400')
    ctx.fillStyle = active ? colors.amberText : colors.inkMuted
    ctx.textAlign = 'left'
    ctx.textBaseline = 'bottom'
    // Label just above the threshold point, where the lines are furthest apart.
    ctx.fillText(metal.symbol, xOf(f0) + 6, yOf(0) - 6)
  }

  // ── Slope triangle on the active line: the measurement, made on screen ──
  const f0 = thresholdFrequencyHz(activeMetal.workFunctionEv)
  const fa = f0 + (F_MAX - f0) * 0.35
  const fb = f0 + (F_MAX - f0) * 0.75
  const va = stoppingVoltageV(fa, activeMetal.workFunctionEv)
  const vb = stoppingVoltageV(fb, activeMetal.workFunctionEv)
  if (vb <= V_MAX) {
    ctx.save()
    ctx.setLineDash([4, 3])
    ctx.strokeStyle = withAlpha(colors.amber, 0.6)
    ctx.lineWidth = 1.25
    ctx.beginPath()
    ctx.moveTo(xOf(fa), yOf(va))
    ctx.lineTo(xOf(fb), yOf(va))
    ctx.lineTo(xOf(fb), yOf(vb))
    ctx.stroke()
    ctx.restore()

    ctx.font = mono(10, '400')
    ctx.fillStyle = colors.amberText
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillText(
      `Δf = ${((fb - fa) / 1e14).toFixed(1)}×10¹⁴ Hz`,
      (xOf(fa) + xOf(fb)) / 2,
      yOf(va) + 5
    )
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(`ΔV = ${(vb - va).toFixed(2)} V`, xOf(fb) + 6, (yOf(va) + yOf(vb)) / 2)
  }

  // ── Live marker ──
  const emitting = frequencyHz > f0
  const vNow = stoppingVoltageV(frequencyHz, activeMetal.workFunctionEv)
  if (frequencyHz <= F_MAX && vNow <= V_MAX) {
    const x = xOf(frequencyHz)
    const y = yOf(vNow)
    ctx.save()
    ctx.setLineDash([3, 3])
    ctx.strokeStyle = withAlpha(emitting ? colors.violet : colors.rose, 0.55)
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(PAD_L, y)
    ctx.lineTo(x, y)
    ctx.lineTo(x, PAD_T + plotH)
    ctx.stroke()
    ctx.restore()

    ctx.beginPath()
    ctx.arc(x, y, 5, 0, Math.PI * 2)
    ctx.fillStyle = emitting ? colors.violet : colors.rose
    ctx.fill()

    ctx.font = mono(10)
    ctx.fillStyle = emitting ? colors.violetText : colors.roseText
    ctx.textAlign = x > PAD_L + plotW * 0.7 ? 'right' : 'left'
    ctx.textBaseline = 'bottom'
    const dxLabel = x > PAD_L + plotW * 0.7 ? -9 : 9
    ctx.fillText(
      emitting ? `${vNow.toFixed(2)} V` : 'below threshold — no emission',
      x + dxLabel,
      y - 6
    )
  }
}
