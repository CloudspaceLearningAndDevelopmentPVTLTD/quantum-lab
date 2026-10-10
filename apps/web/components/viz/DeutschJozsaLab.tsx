'use client'

import { useEffect, useRef } from 'react'
import { formatKet } from '@/lib/quantum'
import { readVizColors, withAlpha, type VizColors } from './theme'
import {
  createFrameLoop,
  domIntersectionWatcher,
  prefersReducedMotion,
  watchThemeChange,
  type FrameLoop,
} from './frameLoop'

/**
 * DeutschJozsaLab — the input register's amplitudes, drawn with their SIGN.
 *
 * The whole algorithm is legible in this one chart, which is why the page is
 * built around it rather than around a circuit diagram. The oracle call changes
 * no bar's height, only which side of the centre line it sits on; the second
 * Hadamard layer converts that pattern of signs into one surviving bar. If the
 * bars were probabilities, the oracle step would look like nothing happened —
 * and for a measurement made at that moment, nothing has.
 *
 * The amber ticks under the axis mark the inputs with f(x) = 1: exactly the bars
 * the oracle flips. Bar heights ease between steps so the eye can follow which
 * bar went where; under prefers-reduced-motion the new state is drawn at once.
 */

const EASE_MS = 340
const PAD_L = 44
const PAD_R = 16
const PAD_TOP = 30
const LABEL_H = 20
const TICK_H = 12
const BAR_GAP = 4

export interface DjLabProps {
  /** Signed amplitudes of the input register, one per basis state. */
  amplitudes: number[]
  /** Number of input qubits, for the ket labels. */
  numQubits: number
  /** f(x) for every x — the bars the oracle flips get a tick. */
  table: readonly (0 | 1)[]
  /** Caption drawn top-left: which step this is. */
  caption: string
  /** Highlight this basis state (the hidden string, or |0…0⟩ for Deutsch–Jozsa). */
  highlight: number | null
  className?: string
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const rad = Math.max(0, Math.min(r, w / 2, Math.abs(h) / 2))
  ctx.beginPath()
  ctx.moveTo(x + rad, y)
  ctx.lineTo(x + w - rad, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad)
  ctx.lineTo(x + w, y + h - rad)
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h)
  ctx.lineTo(x + rad, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad)
  ctx.lineTo(x, y + rad)
  ctx.quadraticCurveTo(x, y, x + rad, y)
  ctx.closePath()
}

export default function DeutschJozsaLab(props: DjLabProps) {
  const { className = '' } = props
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const sizeRef = useRef({ w: 0, h: 0 })
  const drawnRef = useRef<number[]>([])
  const loopRef = useRef<FrameLoop | null>(null)

  // The loop is created once and must not close over stale props.
  const propsRef = useRef(props)
  propsRef.current = props

  useEffect(() => {
    loopRef.current?.start()
  }, [props.amplitudes, props.caption, props.highlight])

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
      const { amplitudes, numQubits, table, caption, highlight } = propsRef.current
      const { w, h } = sizeRef.current
      if (w <= 0 || h <= 0) return false

      const dt = lastTime === 0 ? 16 : Math.min(now - lastTime, 120)
      lastTime = now

      const dim = amplitudes.length
      let drawn = drawnRef.current
      if (drawn.length !== dim) {
        drawn = reduceMotion ? amplitudes.slice() : new Array<number>(dim).fill(0)
        drawnRef.current = drawn
      }

      let settled = true
      if (reduceMotion) {
        for (let i = 0; i < dim; i++) drawn[i] = amplitudes[i]
      } else {
        const k = 1 - Math.pow(0.001, dt / EASE_MS)
        for (let i = 0; i < dim; i++) {
          const d = amplitudes[i] - drawn[i]
          if (Math.abs(d) < 0.0006) drawn[i] = amplitudes[i]
          else {
            drawn[i] += d * k
            settled = false
          }
        }
      }

      // ── Geometry: a centre line with room above and below for ±1 amplitude ──
      const plotTop = PAD_TOP
      const plotBottom = h - LABEL_H - TICK_H
      const midY = (plotTop + plotBottom) / 2
      const halfH = Math.max(8, (plotBottom - plotTop) / 2 - 4)
      const plotW = Math.max(10, w - PAD_L - PAD_R)
      const slot = plotW / dim
      const barW = Math.max(1, slot - BAR_GAP)

      ctx.clearRect(0, 0, w, h)

      // Guide lines at ±1/√N — where every amplitude sits after the Hadamards.
      const uniform = 1 / Math.sqrt(dim)
      ctx.setLineDash([4, 4])
      ctx.lineWidth = 1
      ctx.strokeStyle = withAlpha(colors.inkMuted, 0.45)
      for (const sign of [1, -1]) {
        const y = Math.round(midY - sign * uniform * halfH) + 0.5
        ctx.beginPath()
        ctx.moveTo(PAD_L, y)
        ctx.lineTo(w - PAD_R, y)
        ctx.stroke()
      }
      ctx.setLineDash([])

      ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace'
      ctx.fillStyle = colors.inkMuted
      ctx.textAlign = 'right'
      ctx.textBaseline = 'middle'
      ctx.fillText(`+1/√${dim}`, PAD_L - 6, midY - uniform * halfH)
      ctx.fillText(`−1/√${dim}`, PAD_L - 6, midY + uniform * halfH)

      // Bars.
      for (let i = 0; i < dim; i++) {
        const a = drawn[i]
        const x = PAD_L + i * slot + BAR_GAP / 2
        const barH = a * halfH
        const isHighlight = highlight === i
        const base = a < 0 ? colors.rose : colors.teal
        const fill = isHighlight && Math.abs(a) > 0.02 ? colors.amber : base

        // Track, so an empty slot still reads as a slot.
        ctx.fillStyle = withAlpha(colors.inkMuted, 0.07)
        drawRoundedRect(ctx, x, midY - halfH, barW, halfH * 2, 3)
        ctx.fill()

        if (Math.abs(barH) > 0.4) {
          // Negative amplitudes grow downward, so normalise to a top-left origin
          // with a positive height — a negative height makes the rounded corners
          // curve the wrong way.
          ctx.fillStyle = withAlpha(fill, 0.92)
          drawRoundedRect(ctx, x, barH >= 0 ? midY - barH : midY, barW, Math.abs(barH), 3)
          ctx.fill()
        }

        // Basis label. The full ket is preferred; at four qubits on a narrow
        // screen "|0110⟩" does not fit, so fall back to the bare bitstring rather
        // than dropping the label and leaving unlabelled bars.
        ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'top'
        const ket = formatKet(i, numQubits)
        const bits = i.toString(2).padStart(numQubits, '0')
        const label =
          ctx.measureText(ket).width <= slot + 3
            ? ket
            : ctx.measureText(bits).width <= slot + 3
              ? bits
              : null
        if (label) {
          ctx.fillStyle = isHighlight ? colors.amberText : colors.inkMuted
          ctx.fillText(label, x + barW / 2, plotBottom + 4)
        }

        // Amber tick for the inputs where f(x) = 1 — the ones the oracle flips.
        if (table[i] === 1) {
          ctx.fillStyle = withAlpha(colors.amber, 0.85)
          ctx.fillRect(x + barW / 2 - 5, plotBottom + LABEL_H + 2, 10, 3)
        }
      }

      // Centre line, drawn last so it sits on top of the bars.
      ctx.strokeStyle = withAlpha(colors.inkSecondary, 0.45)
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(PAD_L, Math.round(midY) + 0.5)
      ctx.lineTo(w - PAD_R, Math.round(midY) + 0.5)
      ctx.stroke()

      ctx.font = '600 12px ui-sans-serif, system-ui, sans-serif'
      ctx.fillStyle = colors.ink
      ctx.textAlign = 'left'
      ctx.textBaseline = 'top'
      ctx.fillText(caption, PAD_L - 28, 8)

      ctx.font = '10px ui-sans-serif, system-ui, sans-serif'
      ctx.fillStyle = colors.inkMuted
      ctx.textAlign = 'right'
      ctx.fillText('amber ticks: f(x) = 1', w - PAD_R, 10)

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
    <div ref={wrapRef} className={`relative h-[320px] min-h-[280px] w-full ${className}`}>
      <canvas
        ref={canvasRef}
        className="block h-full w-full"
        role="img"
        aria-label={describe(props)}
      />
    </div>
  )
}

/**
 * A11Y: the exact per-state numbers are in the table beside this chart, which is
 * always rendered. This summary says what the picture SHOWS — how many bars are
 * negative, and where the amplitude has collected.
 */
function describe({ amplitudes, numQubits, caption, highlight }: DjLabProps): string {
  const negative = amplitudes.filter((a) => a < -1e-9).length
  const live = amplitudes.filter((a) => Math.abs(a) > 1e-9).length
  const top = amplitudes
    .map((a, i) => ({ a, i }))
    .filter((d) => Math.abs(d.a) > 1e-6)
    .sort((u, v) => Math.abs(v.a) - Math.abs(u.a))
    .slice(0, 3)
    .map(
      (d) =>
        `${formatKet(d.i, numQubits)} amplitude ${d.a >= 0 ? '' : 'minus '}${Math.abs(d.a).toFixed(3)}`
    )
    .join('; ')
  const marked =
    highlight === null ? '' : ` Highlighted state: ${formatKet(highlight, numQubits)}.`
  return `Signed amplitude bars for the input register. ${caption} ${live} of ${amplitudes.length} states carry amplitude, ${negative} of them negative. ${top}.${marked}`
}
