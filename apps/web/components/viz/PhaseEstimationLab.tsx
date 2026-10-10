'use client'

import { useEffect, useRef } from 'react'
import { kickbackAngle } from '@/lib/viz/phaseEstimation'
import { readVizColors, withAlpha, type VizColors } from './theme'
import {
  createFrameLoop,
  domIntersectionWatcher,
  prefersReducedMotion,
  watchThemeChange,
  type FrameLoop,
} from './frameLoop'

/**
 * PhaseEstimationLab — the two halves of QPE, stacked.
 *
 * TOP    one dial per counting qubit. Each controlled-U^{2^j} turns qubit j's
 *        hand by 2πφ·2^j, so the register ends up holding the same number at
 *        every scale at once: qubit 0 turns by φ of a full circle, the last one
 *        turns by 2^{t−1}φ and is therefore the most sensitive to small changes
 *        in φ. That spread of scales IS the binary expansion, written in phases.
 *
 * BOTTOM the counting register's measurement probabilities. They stay perfectly
 *        flat through every controlled-U — the phases carry everything and a
 *        measurement would return noise — and then the inverse QFT collapses
 *        them onto the answer. Watching the bottom panel do nothing for most of
 *        the run is the point, not a rendering bug.
 *
 * At 10 counting qubits there are 1024 bins and perhaps 700 pixels, so bins are
 * bucketed per pixel and the bucket MAXIMUM is drawn — a mean would flatten the
 * one-bin-wide peak this page exists to show. The exact numbers are in the
 * readouts and the table beside the canvas.
 */

const EASE_MS = 380
const DIAL_PANEL_H = 118
const PAD_L = 46
const PAD_R = 16
const PAD_T = 22
const AXIS_H = 20

export interface QpeLabProps {
  /** Counting-register size. */
  t: number
  /** The true phase, for the dial angles and the target marker. */
  phi: number
  /** How many controlled-U powers have been applied so far (0…t). */
  appliedPowers: number
  /** Counting-register measurement probabilities at the current stage. */
  probabilities: number[]
  /** Caption drawn above the dials. */
  caption: string
  /** Draw the dashed marker at 2^t·φ (the value the register is trying to hold). */
  showTarget: boolean
  className?: string
}

/** Shortest signed distance from `from` to `to` on the phase circle. */
function angleDelta(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  return d
}

export default function PhaseEstimationLab(props: QpeLabProps) {
  const { className = '' } = props
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const sizeRef = useRef({ w: 0, h: 0 })
  const barsRef = useRef<number[]>([])
  const handsRef = useRef<number[]>([])
  const loopRef = useRef<FrameLoop | null>(null)

  const propsRef = useRef(props)
  propsRef.current = props

  useEffect(() => {
    loopRef.current?.start()
  }, [props.probabilities, props.appliedPowers, props.caption, props.t, props.phi])

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
      const { t, phi, appliedPowers, probabilities, caption, showTarget } = propsRef.current
      const { w, h } = sizeRef.current
      if (w <= 0 || h <= 0) return false

      const dt = lastTime === 0 ? 16 : Math.min(now - lastTime, 120)
      lastTime = now
      const dim = probabilities.length

      // ── Ease bars and dial hands toward their targets ──
      const targetHands = Array.from({ length: t }, (_, j) =>
        j < appliedPowers ? kickbackAngle(phi, j) : 0
      )
      let bars = barsRef.current
      let hands = handsRef.current
      if (bars.length !== dim) {
        bars = reduceMotion ? probabilities.slice() : new Array<number>(dim).fill(1 / dim)
        barsRef.current = bars
      }
      if (hands.length !== t) {
        hands = targetHands.slice()
        handsRef.current = hands
      }

      let settled = true
      if (reduceMotion) {
        for (let i = 0; i < dim; i++) bars[i] = probabilities[i]
        for (let j = 0; j < t; j++) hands[j] = targetHands[j]
      } else {
        const k = 1 - Math.pow(0.001, dt / EASE_MS)
        for (let i = 0; i < dim; i++) {
          const d = probabilities[i] - bars[i]
          if (Math.abs(d) < 1e-5) bars[i] = probabilities[i]
          else {
            bars[i] += d * k
            settled = false
          }
        }
        for (let j = 0; j < t; j++) {
          const d = angleDelta(hands[j], targetHands[j])
          if (Math.abs(d) < 0.004) hands[j] = targetHands[j]
          else {
            hands[j] += d * k
            settled = false
          }
        }
      }

      ctx.clearRect(0, 0, w, h)

      ctx.font = '600 12px ui-sans-serif, system-ui, sans-serif'
      ctx.fillStyle = colors.ink
      ctx.textAlign = 'left'
      ctx.textBaseline = 'top'
      ctx.fillText(caption, 18, 8)

      // ── Panel 1: one dial per counting qubit ──
      const dialTop = PAD_T + 12
      const dialRowH = DIAL_PANEL_H - 12
      const dialSlot = Math.max(24, (w - PAD_L - PAD_R) / t)
      const radius = Math.max(8, Math.min(24, dialSlot / 2 - 8, dialRowH / 2 - 22))
      for (let j = 0; j < t; j++) {
        const cx = PAD_L + dialSlot * (j + 0.5)
        const cy = dialTop + radius + 6
        const live = j < appliedPowers

        ctx.strokeStyle = withAlpha(colors.inkSecondary, live ? 0.4 : 0.18)
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.arc(cx, cy, radius, 0, Math.PI * 2)
        ctx.stroke()

        if (live) {
          // Canvas y grows downward, so negate the angle to draw it as maths.
          const a = hands[j]
          ctx.strokeStyle = colors.amber
          ctx.lineWidth = 2
          ctx.beginPath()
          ctx.moveTo(cx, cy)
          ctx.lineTo(cx + Math.cos(-a) * radius * 0.92, cy + Math.sin(-a) * radius * 0.92)
          ctx.stroke()
          ctx.fillStyle = colors.amber
          ctx.beginPath()
          ctx.arc(cx, cy, 2, 0, Math.PI * 2)
          ctx.fill()
        } else {
          ctx.fillStyle = withAlpha(colors.inkMuted, 0.35)
          ctx.beginPath()
          ctx.arc(cx, cy, 2, 0, Math.PI * 2)
          ctx.fill()
        }

        ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'top'
        ctx.fillStyle = live ? colors.inkSecondary : colors.inkMuted
        if (dialSlot > 34) ctx.fillText(`q${j}`, cx, cy + radius + 5)
        if (dialSlot > 52) {
          ctx.fillStyle = colors.inkMuted
          ctx.fillText(`U^${2 ** j}`, cx, cy + radius + 18)
        }
      }

      ctx.font = '10px ui-sans-serif, system-ui, sans-serif'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = colors.inkMuted
      ctx.fillText('phase', 12, dialTop + radius + 6)

      // ── Panel 2: measurement probabilities over the counting register ──
      const plotTop = DIAL_PANEL_H + PAD_T
      const plotBottom = h - AXIS_H
      const plotH = Math.max(20, plotBottom - plotTop)
      const plotW = Math.max(10, w - PAD_L - PAD_R)

      ctx.strokeStyle = withAlpha(colors.inkSecondary, 0.35)
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(PAD_L, Math.round(plotBottom) + 0.5)
      ctx.lineTo(w - PAD_R, Math.round(plotBottom) + 0.5)
      ctx.stroke()

      // Bucket bins to pixels, keeping the MAXIMUM so a one-bin peak survives.
      const columns = Math.min(dim, Math.max(1, Math.floor(plotW)))
      const colW = plotW / columns
      const bucketMax = new Array<number>(columns).fill(0)
      for (let i = 0; i < dim; i++) {
        const col = Math.min(columns - 1, Math.floor((i / dim) * columns))
        if (bars[i] > bucketMax[col]) bucketMax[col] = bars[i]
      }
      const peakIndex = bars.reduce((best, v, i) => (v > bars[best] ? i : best), 0)

      // The vertical scale is FIXED at probability 1 for every stage. A per-stage
      // scale would redraw the flat pre-QFT distribution as a full-height block,
      // which reads as "lots of probability" when it means the exact opposite —
      // every individual outcome is 1/2^t likely and none of them is the answer.
      // The dashed guide marks that uniform level so the flat state stays legible
      // even at t = 10, where it is a two-pixel sliver.
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

      // Only call something a peak once it actually stands out. While the
      // distribution is flat every bin is the argmax, and tinting bin 0 amber
      // would invent a winner that does not exist yet.
      const hasPeak = bars[peakIndex] > uniform * 1.5
      for (let col = 0; col < columns; col++) {
        const v = bucketMax[col]
        if (v <= 0) continue
        const barH = Math.max(1, v * plotH)
        const x = PAD_L + col * colW
        const isPeakCol =
          hasPeak && Math.min(columns - 1, Math.floor((peakIndex / dim) * columns)) === col
        ctx.fillStyle = isPeakCol ? colors.amber : withAlpha(colors.violet, 0.75)
        ctx.fillRect(x, plotBottom - barH, Math.max(1, colW - (colW > 4 ? 1.5 : 0)), barH)
      }

      // The value the register is trying to hold: 2^t·φ, which is generally not
      // an integer — the reason the peak is not always a single bar.
      if (showTarget) {
        const frac = ((phi % 1) + 1) % 1
        const x = PAD_L + (frac * dim * plotW) / dim
        ctx.setLineDash([4, 4])
        ctx.strokeStyle = colors.teal
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.moveTo(x, plotTop)
        ctx.lineTo(x, plotBottom)
        ctx.stroke()
        ctx.setLineDash([])
        ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace'
        ctx.fillStyle = colors.tealText
        ctx.textBaseline = 'top'
        const label = `2^${t}·φ = ${(frac * dim).toFixed(2)}`
        const tw = ctx.measureText(label).width
        ctx.textAlign = x + tw + 8 > w - PAD_R ? 'right' : 'left'
        ctx.fillText(label, x + (x + tw + 8 > w - PAD_R ? -6 : 6), plotTop + 2)
      }

      // Axis: first, middle and last outcome.
      ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace'
      ctx.fillStyle = colors.inkMuted
      ctx.textBaseline = 'top'
      ctx.textAlign = 'left'
      ctx.fillText('y = 0', PAD_L, plotBottom + 5)
      ctx.textAlign = 'right'
      ctx.fillText(`${dim - 1}`, w - PAD_R, plotBottom + 5)
      ctx.textAlign = 'center'
      ctx.fillText(`${dim >> 1}`, PAD_L + plotW / 2, plotBottom + 5)

      ctx.textAlign = 'right'
      ctx.textBaseline = 'top'
      ctx.fillText('100%', PAD_L - 6, plotTop)
      ctx.fillText('0', PAD_L - 6, plotBottom - 10)
      ctx.textAlign = 'right'
      ctx.textBaseline = 'bottom'
      ctx.fillText(`uniform = 1/${dim}`, w - PAD_R - 2, uniformY - 2)

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
    <div ref={wrapRef} className={`relative h-[400px] min-h-[360px] w-full ${className}`}>
      <canvas
        ref={canvasRef}
        className="block h-full w-full"
        role="img"
        aria-label={describe(props)}
      />
    </div>
  )
}

function describe({ t, phi, appliedPowers, probabilities, caption }: QpeLabProps): string {
  const dim = probabilities.length
  const ranked = probabilities
    .map((p, y) => ({ p, y }))
    .sort((a, b) => b.p - a.p)
    .slice(0, 3)
    .map((d) => `y = ${d.y} at ${(d.p * 100).toFixed(1)} percent`)
    .join('; ')
  const dials =
    appliedPowers === 0
      ? 'No controlled-U power has been applied yet, so every dial points the same way.'
      : `${appliedPowers} of ${t} controlled-U powers applied; counting qubit ${
          appliedPowers - 1
        } holds a phase of ${(kickbackAngle(phi, appliedPowers - 1) / (2 * Math.PI)).toFixed(3)} of a turn.`
  return `Quantum phase estimation. ${caption} ${dials} Measurement probabilities over ${dim} outcomes: ${ranked}.`
}
