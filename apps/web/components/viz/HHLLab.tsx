'use client'

import { useEffect, useRef } from 'react'
import { readVizColors, withAlpha, type VizColors } from './theme'
import {
  createFrameLoop,
  domIntersectionWatcher,
  prefersReducedMotion,
  watchThemeChange,
  type FrameLoop,
} from './frameLoop'

/**
 * HHLLab — the clock register and the ancilla, the two places HHL's action
 * actually happens to watch live. (The state/solution register is shown as a
 * plain bar readout in the page below the canvas — see hhl-algorithm/page.tsx
 * — because what it holds only becomes legible once you have already read
 * the ancilla's herald, which the canvas draws first.)
 *
 * TOP    a two-segment gauge for P(ancilla = 0) / P(ancilla = 1). Flat at 100%
 *        / 0% until the rotation stage runs — the ancilla genuinely does
 *        nothing before then — then splits, and holds steady through the
 *        uncompute (the rotation is the only stage that touches it).
 *
 * BOTTOM the clock register's measurement probabilities, exactly like
 *        /visualizations/phase-estimation's probability panel — because this
 *        register is running phase estimation, on an operator with TWO
 *        eigenvalues in superposition instead of one. Watch two peaks form
 *        instead of one, then watch them both collapse back to y = 0 during
 *        the uncompute.
 */

const EASE_MS = 380
const PAD_L = 46
const PAD_R = 16
const PAD_T = 22
const AXIS_H = 20
const GAUGE_GAP = 32

export interface HhlLabProps {
  /** Joint probability of each clock reading y (marginalizing state + ancilla). */
  clockProbabilities: number[]
  /** [P(ancilla = 0), P(ancilla = 1)]. */
  ancillaProbabilities: [number, number]
  /** Clock readings that decode to one of A's eigenvalues — get a labelled tick. */
  eigenvalueReadings: { y: number; lambda: number }[]
  /** Caption drawn above the gauge. */
  caption: string
  className?: string
}

export default function HHLLab(props: HhlLabProps) {
  const { className = '' } = props
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const sizeRef = useRef({ w: 0, h: 0 })
  const barsRef = useRef<number[]>([])
  const ancillaRef = useRef<[number, number]>([1, 0])
  const loopRef = useRef<FrameLoop | null>(null)

  const propsRef = useRef(props)
  propsRef.current = props

  useEffect(() => {
    loopRef.current?.start()
  }, [props.clockProbabilities, props.ancillaProbabilities, props.caption])

  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const reduceMotion = prefersReducedMotion()
    let colors: VizColors = readVizColors(wrap)
    let lastTime = 0

    const frame = (now: number): boolean => {
      const { clockProbabilities: targetClock, ancillaProbabilities: targetAncilla, eigenvalueReadings, caption } =
        propsRef.current
      const { w, h } = sizeRef.current
      if (w <= 0 || h <= 0) return false

      const dt = lastTime === 0 ? 16 : Math.min(now - lastTime, 120)
      lastTime = now
      const dim = targetClock.length

      let bars = barsRef.current
      if (bars.length !== dim) {
        bars = reduceMotion ? targetClock.slice() : new Array<number>(dim).fill(1 / dim)
        barsRef.current = bars
      }
      let ancilla = ancillaRef.current

      let settled = true
      if (reduceMotion) {
        for (let i = 0; i < dim; i++) bars[i] = targetClock[i]
        ancilla = [targetAncilla[0], targetAncilla[1]]
      } else {
        const k = 1 - Math.pow(0.001, dt / EASE_MS)
        for (let i = 0; i < dim; i++) {
          const d = targetClock[i] - bars[i]
          if (Math.abs(d) < 1e-5) bars[i] = targetClock[i]
          else {
            bars[i] += d * k
            settled = false
          }
        }
        const da = targetAncilla[1] - ancilla[1]
        if (Math.abs(da) < 1e-5) ancilla = [targetAncilla[0], targetAncilla[1]]
        else {
          ancilla = [1 - (ancilla[1] + da * k), ancilla[1] + da * k]
          settled = false
        }
      }
      ancillaRef.current = ancilla

      ctx.clearRect(0, 0, w, h)

      ctx.font = '600 12px ui-sans-serif, system-ui, sans-serif'
      ctx.fillStyle = colors.ink
      ctx.textAlign = 'left'
      ctx.textBaseline = 'top'
      ctx.fillText(caption, 18, 8)

      // ── Panel 1: ancilla gauge ──
      const gaugeTop = PAD_T + 16
      const gaugeH = 18
      const gaugeW = Math.max(40, w - PAD_L - PAD_R)
      const p1 = ancilla[1]
      const successX = PAD_L + gaugeW * p1

      ctx.fillStyle = withAlpha(colors.inkMuted, 0.12)
      ctx.fillRect(PAD_L, gaugeTop, gaugeW, gaugeH)
      if (p1 > 0.002) {
        ctx.fillStyle = withAlpha(colors.amber, 0.85)
        ctx.fillRect(PAD_L, gaugeTop, successX - PAD_L, gaugeH)
      }
      ctx.strokeStyle = withAlpha(colors.inkSecondary, 0.4)
      ctx.lineWidth = 1
      ctx.strokeRect(PAD_L + 0.5, gaugeTop + 0.5, gaugeW - 1, gaugeH - 1)

      ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = colors.inkMuted
      ctx.textAlign = 'left'
      ctx.fillText('P(ancilla = 0)', PAD_L, gaugeTop + gaugeH + 12)
      ctx.textAlign = 'right'
      ctx.fillStyle = colors.amberText
      ctx.fillText(`P(ancilla = 1) = ${(p1 * 100).toFixed(1)}%`, w - PAD_R, gaugeTop + gaugeH + 12)

      // ── Panel 2: clock register probabilities ──
      const plotTop = gaugeTop + gaugeH + GAUGE_GAP + 14
      const plotBottom = h - AXIS_H
      const plotH = Math.max(20, plotBottom - plotTop)
      const plotW = Math.max(10, w - PAD_L - PAD_R)

      ctx.strokeStyle = withAlpha(colors.inkSecondary, 0.35)
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(PAD_L, Math.round(plotBottom) + 0.5)
      ctx.lineTo(w - PAD_R, Math.round(plotBottom) + 0.5)
      ctx.stroke()

      const uniform = 1 / dim
      ctx.setLineDash([3, 4])
      ctx.strokeStyle = withAlpha(colors.inkMuted, 0.5)
      ctx.lineWidth = 1
      const uniformY = Math.round(plotBottom - uniform * plotH) + 0.5
      ctx.beginPath()
      ctx.moveTo(PAD_L, uniformY)
      ctx.lineTo(w - PAD_R, uniformY)
      ctx.stroke()
      ctx.setLineDash([])

      const slot = plotW / dim
      const barW = Math.max(1, slot - 6)
      const eigenYs = new Set(eigenvalueReadings.map((e) => e.y))
      for (let y = 0; y < dim; y++) {
        const v = bars[y]
        const barH = Math.max(0, v * plotH)
        const x = PAD_L + y * slot + 3
        const isEigen = eigenYs.has(y) && v > uniform * 1.5
        ctx.fillStyle = isEigen ? withAlpha(colors.amber, 0.9) : withAlpha(colors.violet, 0.75)
        if (barH > 0.5) ctx.fillRect(x, plotBottom - barH, barW, barH)

        ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'top'
        ctx.fillStyle = isEigen ? colors.amberText : colors.inkMuted
        ctx.fillText(`y=${y}`, x + barW / 2, plotBottom + 4)
        const eigen = eigenvalueReadings.find((e) => e.y === y)
        if (eigen) {
          ctx.fillStyle = colors.inkMuted
          ctx.fillText(`λ=${eigen.lambda}`, x + barW / 2, plotBottom + 16)
        }
      }

      ctx.font = '10px ui-sans-serif, system-ui, sans-serif'
      ctx.textAlign = 'right'
      ctx.textBaseline = 'top'
      ctx.fillStyle = colors.inkMuted
      ctx.fillText('100%', PAD_L - 6, plotTop)
      ctx.fillText('0', PAD_L - 6, plotBottom - 10)
      ctx.textBaseline = 'bottom'
      ctx.fillText(`uniform = 1/${dim}`, w - PAD_R - 2, uniformY - 2)

      ctx.font = '10px ui-sans-serif, system-ui, sans-serif'
      ctx.fillStyle = colors.inkMuted
      ctx.textAlign = 'left'
      ctx.textBaseline = 'top'
      ctx.fillText('clock register', PAD_L, plotTop - 14)

      return !settled
    }

    const loop = createFrameLoop(window, document, domIntersectionWatcher(wrap), frame)
    loopRef.current = loop

    const stopTheme = watchThemeChange(() => {
      colors = readVizColors(wrap)
      loop.start()
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
      loop.start()
    }

    const observer = new ResizeObserver(resize)
    observer.observe(wrap)
    resize()

    return () => {
      observer.disconnect()
      stopTheme()
      loop.dispose()
      loopRef.current = null
    }
  }, [])

  return (
    <div ref={wrapRef} className={`relative h-[360px] min-h-[320px] w-full ${className}`}>
      <canvas
        ref={canvasRef}
        className="block h-full w-full"
        role="img"
        aria-label={describe(props)}
      />
    </div>
  )
}

function describe({ clockProbabilities: probs, ancillaProbabilities: anc, caption, eigenvalueReadings }: HhlLabProps): string {
  const ranked = probs
    .map((p, y) => ({ p, y }))
    .filter((d) => d.p > 0.01)
    .sort((a, b) => b.p - a.p)
    .map((d) => {
      const eigen = eigenvalueReadings.find((e) => e.y === d.y)
      return `y = ${d.y}${eigen ? ` (λ = ${eigen.lambda})` : ''} at ${(d.p * 100).toFixed(1)} percent`
    })
    .join('; ')
  return `HHL algorithm. ${caption} Ancilla: ${(anc[1] * 100).toFixed(1)} percent probability of reading 1. Clock register outcomes with non-negligible probability: ${ranked || 'none yet'}.`
}
