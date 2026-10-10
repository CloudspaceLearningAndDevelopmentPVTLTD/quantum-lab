'use client'

import { useEffect, useMemo, useRef } from 'react'
import { readVizColors, withAlpha, type VizColors } from './theme'
import {
  createFrameLoop,
  domIntersectionWatcher,
  prefersReducedMotion,
  watchThemeChange,
  type FrameLoop,
} from './frameLoop'
import { MESSAGES, type Message } from '@/lib/viz/superdense'

/**
 * SuperdenseLab — one qubit crossing a channel with two bits inside it.
 *
 * The mirror of TeleportLab, and drawn to be read against it: there, two
 * classical bits crawl left to right while the quantum state waits; here, a
 * single qubit crosses and both bits come out the far end.
 *
 * Two things the picture has to be honest about, and both are drawn from
 * simulator output rather than asserted:
 *
 *  - Alice's qubit looks IDENTICAL for all four messages while it is in
 *    flight. Its Bloch arrow has no length in every case, so the packet is
 *    drawn as the same featureless dot whatever she sent. Intercepting it tells
 *    an eavesdropper nothing; the message lives in the correlation with a qubit
 *    that never moved.
 *  - The four possible answers Bob can read are drawn as bars of the exact
 *    decoded probability. With the pair, one bar is at 100% and the rest are
 *    flat zero. Without it, two bars sit at 50% and the message is half lost.
 */

const ARRIVE_MS = 1500

export type Phase = 'idle' | 'flying' | 'arrived'

type Props = {
  message: Message
  entangled: boolean
  phase: Phase
  /** Decoded probability per label, from the simulator. */
  readout: Record<Message, number>
  /** Whether Alice has applied her encoding yet. */
  encoded: boolean
  caption: string
  className?: string
}

export default function SuperdenseLab({
  message,
  entangled,
  phase,
  readout,
  encoded,
  caption,
  className = '',
}: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const sizeRef = useRef({ w: 0, h: 0 })
  const loopRef = useRef<FrameLoop | null>(null)

  const propsRef = useRef({ message, entangled, phase, readout, encoded, caption })
  propsRef.current = { message, entangled, phase, readout, encoded, caption }

  const flightRef = useRef(0)

  useEffect(() => {
    flightRef.current = 0
    loopRef.current?.start()
  }, [phase, message, entangled, encoded, readout, caption])

  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const reduceMotion = prefersReducedMotion()
    let colors = readVizColors(wrap)
    let lastTime = 0

    const onFrame = (now: number): boolean => {
      const dt = lastTime === 0 ? 16 : Math.min(now - lastTime, 120)
      lastTime = now
      let more = false

      if (reduceMotion) {
        flightRef.current = propsRef.current.phase === 'flying' ? 0.5 : propsRef.current.phase === 'arrived' ? 1 : 0
      } else if (propsRef.current.phase === 'flying') {
        flightRef.current = (flightRef.current + dt / ARRIVE_MS) % 1
        more = true
      } else {
        flightRef.current = propsRef.current.phase === 'arrived' ? 1 : 0
      }

      const { w, h } = sizeRef.current
      if (w > 0 && h > 0) render(ctx, propsRef.current, flightRef.current, w, h, colors)
      return more
    }

    const loop = createFrameLoop(window, document, domIntersectionWatcher(wrap), onFrame)
    loopRef.current = loop

    const repaint = (): void => {
      const { w, h } = sizeRef.current
      if (w > 0 && h > 0) render(ctx, propsRef.current, flightRef.current, w, h, colors)
    }

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

  const label = useMemo(
    () => describe({ message, entangled, phase, readout, encoded, caption }),
    [message, entangled, phase, readout, encoded, caption]
  )

  return (
    <div ref={wrapRef} className={`relative w-full ${className}`} style={{ height: 340 }}>
      <canvas ref={canvasRef} className="block h-full w-full" role="img" aria-label={label} />
    </div>
  )
}

function describe(p: Omit<Props, 'className'>): string {
  const rows = MESSAGES.map((m) => `${m} at ${((p.readout[m] ?? 0) * 100).toFixed(0)} percent`).join(', ')
  const best = MESSAGES.reduce((a, b) => (p.readout[b] > p.readout[a] ? b : a), MESSAGES[0])
  return (
    `${p.caption}. Alice wants to send the two bits ${p.message}. ` +
    `${p.entangled ? 'She and Bob share an entangled pair.' : 'They share no entangled pair — each qubit starts in |0⟩.'} ` +
    `${
      p.encoded
        ? p.entangled
          ? 'She has applied her encoding to her own qubit only; its Bloch arrow still has no length, so the qubit on the wire looks the same for all four messages. '
          : 'She has applied her encoding to her own qubit only; with no pair shared it is a plain |0⟩ or |1⟩, so the qubit on the wire carries at most one bit. '
        : ''
    }` +
    `${p.phase === 'flying' ? 'The single qubit is crossing the channel. ' : p.phase === 'arrived' ? 'Bob has decoded. ' : ''}` +
    `If both qubits were measured at this step: ${rows}. ` +
    (p.readout[p.message] > 0.999
      ? 'The sent message comes out with certainty.'
      : `The most likely reading is ${best}, and the message is not yet recovered.`)
  )
}

function render(
  ctx: CanvasRenderingContext2D,
  p: Omit<Props, 'className'>,
  flight: number,
  w: number,
  h: number,
  colors: VizColors
): void {
  ctx.clearRect(0, 0, w, h)

  const mono = '10px ui-monospace, SFMono-Regular, Menlo, monospace'
  const monoBold = '600 10px ui-monospace, SFMono-Regular, Menlo, monospace'

  const laneY = h * 0.36
  const aliceX = Math.max(64, w * 0.14)
  const bobX = Math.min(w - 64, w * 0.86)

  // ── The two qubits ────────────────────────────────────────────────────────
  const qubit = (cx: number, title: string, accent: string, accentText: string, dim: boolean) => {
    ctx.beginPath()
    ctx.arc(cx, laneY, 17, 0, Math.PI * 2)
    ctx.fillStyle = withAlpha(accent, dim ? 0.14 : 0.3)
    ctx.fill()
    ctx.strokeStyle = dim ? withAlpha(accent, 0.35) : accent
    ctx.lineWidth = 1.8
    ctx.stroke()
    ctx.font = monoBold
    ctx.fillStyle = accentText
    ctx.textAlign = 'center'
    ctx.textBaseline = 'alphabetic'
    ctx.fillText(title, cx, laneY - 27)
  }

  const inFlight = p.phase === 'flying'
  qubit(aliceX, 'ALICE', colors.amber, colors.amberText, inFlight || p.phase === 'arrived')
  qubit(bobX, 'BOB', colors.teal, colors.tealText, false)

  // ── The shared pair ───────────────────────────────────────────────────────
  ctx.save()
  ctx.setLineDash([4, 5])
  ctx.strokeStyle = p.entangled ? withAlpha(colors.violet, 0.85) : withAlpha(colors.inkSecondary, 0.18)
  ctx.lineWidth = 1.6
  ctx.beginPath()
  ctx.moveTo(aliceX + 22, laneY - 8)
  ctx.bezierCurveTo(w / 2, laneY - 54, w / 2, laneY - 54, bobX - 22, laneY - 8)
  ctx.stroke()
  ctx.restore()
  ctx.font = monoBold
  ctx.textAlign = 'center'
  ctx.textBaseline = 'bottom'
  ctx.fillStyle = p.entangled ? colors.violetText : colors.inkMuted
  ctx.fillText(
    p.entangled ? 'one shared Bell pair — the resource' : 'no shared pair',
    w / 2,
    laneY - 44
  )

  // ── The channel ───────────────────────────────────────────────────────────
  const chanY = laneY + 34
  ctx.strokeStyle = withAlpha(colors.inkSecondary, 0.28)
  ctx.lineWidth = 1.2
  ctx.beginPath()
  ctx.moveTo(aliceX, chanY)
  ctx.lineTo(bobX, chanY)
  ctx.stroke()
  ctx.font = mono
  ctx.fillStyle = colors.inkMuted
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.fillText('one qubit crosses — carrying two bits', w / 2, chanY + 8)

  if (p.phase !== 'idle') {
    const x = aliceX + (bobX - aliceX) * Math.min(1, Math.max(0, flight))
    // Deliberately featureless: the packet on the wire is the same picture for
    // all four messages, because the qubit itself is.
    ctx.beginPath()
    ctx.arc(x, chanY, 11, 0, Math.PI * 2)
    ctx.fillStyle = withAlpha(colors.amber, 0.32)
    ctx.fill()
    ctx.strokeStyle = colors.amber
    ctx.lineWidth = 1.6
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(x, chanY, 3, 0, Math.PI * 2)
    ctx.fillStyle = colors.amberText
    ctx.fill()
  }

  // ── What Bob reads ────────────────────────────────────────────────────────
  const barTop = h * 0.62
  const barH = h - barTop - 34
  const groupW = Math.min(300, w - 60)
  const left = (w - groupW) / 2
  const slot = groupW / MESSAGES.length

  ctx.font = monoBold
  ctx.fillStyle = colors.inkSecondary
  ctx.textAlign = 'left'
  ctx.textBaseline = 'bottom'
  // NOT "what Bob reads" — this is the computational-basis distribution of the
  // state as it stands at THIS step, which is the honest label at every step
  // and makes the jump to a single 100% bar at the decode mean something.
  ctx.fillText('IF BOTH QUBITS WERE MEASURED NOW', left, barTop - 8)

  MESSAGES.forEach((m, i) => {
    const value = p.readout[m] ?? 0
    const cx = left + slot * i + slot / 2
    const bw = Math.min(40, slot - 12)
    const bh = Math.max(1, value * barH)
    const isSent = m === p.message
    ctx.fillStyle = isSent ? colors.teal : withAlpha(colors.inkSecondary, 0.35)
    ctx.fillRect(cx - bw / 2, barTop + barH - bh, bw, bh)
    ctx.font = mono
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillStyle = isSent ? colors.tealText : colors.inkMuted
    ctx.fillText(m, cx, barTop + barH + 5)
    if (value > 0.005) {
      ctx.textBaseline = 'bottom'
      ctx.fillText(`${Math.round(value * 100)}%`, cx, barTop + barH - bh - 3)
    }
  })

  // Baseline under the bars.
  ctx.strokeStyle = withAlpha(colors.inkSecondary, 0.16)
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(left - 6, Math.round(barTop + barH) + 0.5)
  ctx.lineTo(left + groupW + 6, Math.round(barTop + barH) + 0.5)
  ctx.stroke()

  // ── Caption and verdict ───────────────────────────────────────────────────
  ctx.font = monoBold
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillStyle = colors.inkSecondary
  ctx.fillText(p.caption.toUpperCase(), 14, 12)

  // A verdict only once Bob has actually decoded. Mid-protocol the bars are
  // meant to be uninformative — saying "1 BIT LOST" there would be reporting a
  // failure that has not happened yet.
  if (p.phase === 'arrived') {
    const certain = (p.readout[p.message] ?? 0) > 0.999
    ctx.textAlign = 'right'
    ctx.fillStyle = certain ? colors.tealText : colors.roseText
    ctx.fillText(certain ? '2 BITS RECOVERED' : '1 BIT LOST', w - 14, 12)
  }
}
