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
import { blochDistance, blochLength, type Vec3 } from '@/lib/viz/teleportation'

/**
 * TeleportLab — Alice's qubit on the left, Bob's on the right, and the two
 * channels between them.
 *
 * The drawing makes exactly one argument, and it makes it with geometry rather
 * than with a caption: Bob's Bloch arrow has NO LENGTH from the moment the pair
 * is shared until the moment the classical bits arrive. There is nothing to
 * measure, nothing to read, no signal — and then two ordinary bits crawl across
 * the gap at ordinary speed and the arrow snaps into exactly the direction
 * Alice's had. If the arrow ever appeared before the bits landed, the picture
 * would be claiming faster-than-light communication, so it does not.
 *
 * The left sphere makes the companion argument: the payload qubit does not
 * survive. It starts as the arrow Alice prepared; the Bell-basis rotation
 * entangles it with her half of the pair, which strips the phase and shrinks
 * the arrow to (cosθ, 0, 0) — a cloud for an equatorial state; and after the
 * measurement it sits at ±z with no trace of θ or φ. The prepared direction
 * stays on as a faint dashed ghost so the reader can still compare it with
 * Bob's arrow — but the ghost is a reference, not a qubit. Nothing was copied.
 *
 * The vectors are not animated approximations: `alice`, `payload` and `bob`
 * are handed in from lib/viz/teleportation.ts, which gets them from the
 * statevector engine. The only thing the frame loop animates is the two bits
 * crossing the channel and a short ease as Bob's arrow grows in.
 */

/** Milliseconds for one bit to cross the classical channel. */
const FLIGHT_MS = 1400
/** Ease for Bob's arrow snapping into place after the correction. */
const SETTLE_MS = 380

export type ChannelState = 'idle' | 'flying' | 'arrived'

type Props = {
  /** The state Alice prepared — the reference. */
  alice: Vec3
  /**
   * The payload qubit q0 right now — its actual reduced state, which is
   * `alice` only until the Bell-basis rotation. A zero vector means maximally
   * mixed.
   */
  payload: Vec3
  /**
   * Bob's qubit right now, as far as Bob can know it. A zero vector means
   * maximally mixed. The page passes the pre-measurement reduced state until
   * the classical bits have arrived, so this never carries information that
   * has not yet reached him.
   */
  bob: Vec3
  /** Whether the entangled pair has been shared yet. */
  entangled: boolean
  channel: ChannelState
  /** Alice's two measured bits, or null before she has measured. */
  bits: { c0: 0 | 1; c1: 0 | 1 } | null
  /** Stage title, drawn as the caption. */
  caption: string
  className?: string
}

export default function TeleportLab({
  alice,
  payload,
  bob,
  entangled,
  channel,
  bits,
  caption,
  className = '',
}: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const sizeRef = useRef({ w: 0, h: 0 })
  const loopRef = useRef<FrameLoop | null>(null)

  // Live props for a loop created once, which must never close over stale ones.
  const propsRef = useRef({ alice, payload, bob, entangled, channel, bits, caption })
  propsRef.current = { alice, payload, bob, entangled, channel, bits, caption }

  const flightRef = useRef(0)
  const settleRef = useRef(0)
  const lastBobRef = useRef<Vec3>(bob)

  // Restart the flight and the settle whenever the stage changes.
  useEffect(() => {
    flightRef.current = 0
    loopRef.current?.start()
  }, [channel])

  useEffect(() => {
    if (blochDistance(lastBobRef.current, bob) > 1e-9) {
      settleRef.current = 0
      lastBobRef.current = bob
    }
    loopRef.current?.start()
  }, [bob, alice, payload, entangled, bits, caption])

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
        // No travel animation and no ease: the bits are drawn parked in the
        // middle of the channel, and Bob's arrow is drawn at full length.
        // Everything the animation was carrying is still on screen.
        flightRef.current = 0.5
        settleRef.current = 1
      } else {
        if (propsRef.current.channel === 'flying') {
          flightRef.current = (flightRef.current + dt / FLIGHT_MS) % 1
          more = true
        } else {
          flightRef.current = propsRef.current.channel === 'arrived' ? 1 : 0
        }
        if (settleRef.current < 1) {
          settleRef.current = Math.min(1, settleRef.current + dt / SETTLE_MS)
          if (settleRef.current < 1) more = true
        }
      }

      const { w, h } = sizeRef.current
      if (w > 0 && h > 0) render(ctx, propsRef.current, flightRef.current, settleRef.current, w, h, colors)
      return more
    }

    const loop = createFrameLoop(window, document, domIntersectionWatcher(wrap), onFrame)
    loopRef.current = loop

    const repaint = (): void => {
      const { w, h } = sizeRef.current
      if (w > 0 && h > 0) {
        render(ctx, propsRef.current, flightRef.current, settleRef.current, w, h, colors)
      }
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
    () => describe({ alice, payload, bob, entangled, channel, bits, caption }),
    [alice, payload, bob, entangled, channel, bits, caption]
  )

  return (
    <div ref={wrapRef} className={`relative w-full ${className}`} style={{ height: 340 }}>
      <canvas ref={canvasRef} className="block h-full w-full" role="img" aria-label={label} />
    </div>
  )
}

/**
 * The accessible name. It says what the picture says: where Bob's arrow points,
 * how long it is, and whether the bits have arrived — because "a diagram of
 * quantum teleportation" would tell a screen-reader user nothing.
 */
/**
 * What the picture is entitled to say about Bob's qubit at this stage. The
 * "arrived" verdicts are gated on the channel, not on the numbers alone: before
 * the bits land Bob's displayed state is the pre-measurement one, and a bare
 * |0⟩ that happens to coincide with Alice's choice is not a delivery.
 */
type Verdict = 'intact' | 'wrong' | 'mixed' | 'not-sent'

function verdictOf(p: Pick<Props, 'alice' | 'bob' | 'channel'>): Verdict {
  const len = blochLength(p.bob)
  if (p.channel === 'arrived') {
    return len > 0.02 && blochDistance(p.alice, p.bob) < 1e-6 ? 'intact' : 'wrong'
  }
  return len < 0.02 ? 'mixed' : 'not-sent'
}

function describe(p: Omit<Props, 'className'>): string {
  const verdict = verdictOf(p)
  const bobPhrase =
    verdict === 'mixed'
      ? 'Bob’s qubit is maximally mixed — its Bloch arrow has no length, so no measurement he makes can reveal anything'
      : verdict === 'intact'
        ? 'Bob’s Bloch arrow now points exactly where Alice’s did: the state has arrived intact'
        : verdict === 'wrong'
          ? `Bob’s Bloch arrow has full length but points elsewhere, at x ${p.bob.x.toFixed(2)}, y ${p.bob.y.toFixed(2)}, z ${p.bob.z.toFixed(2)}`
          : 'Bob’s qubit is still his own untouched |0⟩; nothing has been sent'
  const payloadLen = blochLength(p.payload)
  const payloadPhrase =
    blochDistance(p.payload, p.alice) < 1e-6
      ? 'Alice’s payload qubit still points there'
      : !p.entangled
        ? 'Alice’s payload qubit is still |0⟩ — she has not prepared it yet'
        : payloadLen < 0.02
          ? 'Alice’s payload qubit has lost its direction — entangled with her half of the pair, it is now maximally mixed; only a faint ghost marks what she prepared'
          : p.bits !== null
            ? `Alice’s payload qubit has collapsed to |${p.payload.z > 0 ? 0 : 1}⟩, a plain computational state with no trace of the prepared direction, which is left only as a faint ghost`
            : `Alice’s payload qubit is entangled with her half of the pair: its phase is gone and its arrow now lies along x with length ${payloadLen.toFixed(2)}, the prepared direction left only as a faint ghost`
  const bitsPhrase =
    p.bits === null
      ? 'Alice has not measured yet'
      : p.channel === 'flying'
        ? `Alice’s two bits, c1 ${p.bits.c1} and c0 ${p.bits.c0}, are in flight down an ordinary channel`
        : p.channel === 'arrived'
          ? `Alice’s bits c1 ${p.bits.c1} and c0 ${p.bits.c0} have arrived and the correction is applied`
          : `Alice holds two bits, c1 ${p.bits.c1} and c0 ${p.bits.c0}, and has not sent them yet`
  return (
    `${p.caption}. Alice prepared a state with Bloch vector x ${p.alice.x.toFixed(2)}, ` +
    `y ${p.alice.y.toFixed(2)}, z ${p.alice.z.toFixed(2)}; ${payloadPhrase}. ` +
    `${p.entangled ? 'The entangled pair is shared. ' : ''}${bitsPhrase}. ${bobPhrase}.`
  )
}

// ── Projection ──────────────────────────────────────────────────────────────
//
// A fixed three-quarter view: azimuth turns the sphere so +x comes toward the
// viewer's left-front and +y goes right-back, elevation tilts it down so the
// equator reads as an ellipse rather than a line. Both are constants because a
// draggable sphere already exists at /visualizations/bloch-sphere; here the
// sphere is a readout, and a readout that moves is harder to compare.

const AZ = -0.62
const EL = 0.34

function project(v: Vec3, cx: number, cy: number, r: number): { x: number; y: number; depth: number } {
  const sx = v.x * Math.cos(AZ) + v.y * Math.sin(AZ)
  const depth = -v.x * Math.sin(AZ) + v.y * Math.cos(AZ)
  const sy = v.z * Math.cos(EL) - depth * Math.sin(EL)
  return { x: cx + r * sx, y: cy - r * sy, depth }
}

function drawSphere(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  vec: Vec3,
  colors: VizColors,
  accent: string,
  accentText: string,
  title: string,
  settle: number,
  /**
   * A reference direction drawn faint and dashed under the real arrow — the
   * state as prepared, kept visible after the qubit itself has stopped
   * pointing there. Skipped when it coincides with `vec`.
   */
  ghost?: Vec3
): void {
  ctx.strokeStyle = withAlpha(colors.inkSecondary, 0.22)
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.stroke()

  // Equator, as the ellipse the tilt makes of it.
  ctx.save()
  ctx.strokeStyle = withAlpha(colors.inkSecondary, 0.16)
  ctx.beginPath()
  ctx.ellipse(cx, cy, r, r * Math.sin(EL), 0, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()

  // The z axis, labelled: |0⟩ up, |1⟩ down.
  const top = project({ x: 0, y: 0, z: 1 }, cx, cy, r)
  const bottom = project({ x: 0, y: 0, z: -1 }, cx, cy, r)
  ctx.strokeStyle = withAlpha(colors.inkSecondary, 0.2)
  ctx.setLineDash([2, 3])
  ctx.beginPath()
  ctx.moveTo(top.x, top.y)
  ctx.lineTo(bottom.x, bottom.y)
  ctx.stroke()
  ctx.setLineDash([])

  ctx.font = '9px ui-monospace, SFMono-Regular, Menlo, monospace'
  ctx.fillStyle = colors.inkMuted
  ctx.textAlign = 'center'
  ctx.textBaseline = 'bottom'
  ctx.fillText('|0⟩', top.x, top.y - 3)
  ctx.textBaseline = 'top'
  ctx.fillText('|1⟩', bottom.x, bottom.y + 3)

  const showGhost = ghost !== undefined && blochDistance(ghost, vec) > 1e-6
  if (showGhost) {
    const tip = project(ghost, cx, cy, r)
    ctx.save()
    ctx.strokeStyle = withAlpha(accent, 0.38)
    ctx.lineWidth = 1.6
    ctx.lineCap = 'round'
    ctx.setLineDash([3, 4])
    ctx.beginPath()
    ctx.moveTo(cx, cy)
    ctx.lineTo(tip.x, tip.y)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.strokeStyle = withAlpha(accent, 0.55)
    ctx.lineWidth = 1.2
    ctx.beginPath()
    ctx.arc(tip.x, tip.y, 3.6, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
  }

  const len = blochLength(vec)
  if (len < 0.02) {
    // Maximally mixed: there is no arrow to draw, and drawing a short one would
    // be a lie about a state that has no direction at all. A cloud instead.
    ctx.fillStyle = withAlpha(colors.inkSecondary, 0.5)
    for (let i = 0; i < 44; i++) {
      const a = (i * 2.399963) % (Math.PI * 2)
      const rad = r * 0.62 * Math.sqrt(((i * 37) % 100) / 100)
      const px = cx + Math.cos(a) * rad
      const py = cy + Math.sin(a) * rad * Math.sin(EL + 0.7)
      ctx.fillRect(px, py, 1.4, 1.4)
    }
    ctx.fillStyle = colors.inkMuted
    ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('no direction', cx, cy + r + 16)
  } else {
    const scaled = { x: vec.x * settle, y: vec.y * settle, z: vec.z * settle }
    const tip = project(scaled, cx, cy, r)
    ctx.strokeStyle = accent
    ctx.lineWidth = 2.4
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(cx, cy)
    ctx.lineTo(tip.x, tip.y)
    ctx.stroke()
    ctx.fillStyle = accent
    ctx.beginPath()
    ctx.arc(tip.x, tip.y, 4.2, 0, Math.PI * 2)
    ctx.fill()
  }

  if (showGhost) {
    ctx.fillStyle = colors.inkMuted
    ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    // Sits under the "no direction" line when both are present.
    ctx.fillText('dashed: as prepared', cx, cy + r + (len < 0.02 ? 30 : 16))
  }

  ctx.font = '600 11px ui-monospace, SFMono-Regular, Menlo, monospace'
  ctx.fillStyle = accentText
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(title, cx, cy - r - 14)
}

function render(
  ctx: CanvasRenderingContext2D,
  p: Omit<Props, 'className'>,
  flight: number,
  settle: number,
  w: number,
  h: number,
  colors: VizColors
): void {
  ctx.clearRect(0, 0, w, h)

  const r = Math.max(38, Math.min(78, Math.min(w * 0.15, h * 0.28)))
  const cy = h * 0.44
  const leftX = Math.max(r + 22, w * 0.16)
  const rightX = Math.min(w - r - 22, w * 0.84)

  // Left: the payload qubit as it actually is, with the prepared direction as
  // a ghost once the two part company — which can only happen after the pair
  // is shared, so the ghost is withheld before that (at 'Start' the payload is
  // an unprepared |0⟩, not a state that has lost anything). Right: Bob's qubit
  // as far as he can know.
  drawSphere(
    ctx,
    leftX,
    cy,
    r,
    p.payload,
    colors,
    colors.sky,
    colors.skyText,
    'ALICE SENDS',
    1,
    p.entangled ? p.alice : undefined
  )
  drawSphere(ctx, rightX, cy, r, p.bob, colors, colors.teal, colors.tealText, 'BOB HOLDS', settle)

  const gapL = leftX + r + 14
  const gapR = rightX - r - 14
  const gapW = Math.max(20, gapR - gapL)

  const mono = '10px ui-monospace, SFMono-Regular, Menlo, monospace'
  const monoBold = '600 10px ui-monospace, SFMono-Regular, Menlo, monospace'

  // ── The entangled link ────────────────────────────────────────────────────
  // Drawn above the classical channel and dashed, because it carries
  // correlation and not information — nothing travels along it.
  const linkY = cy - 26
  ctx.save()
  ctx.setLineDash([4, 5])
  ctx.strokeStyle = p.entangled ? withAlpha(colors.violet, 0.85) : withAlpha(colors.inkSecondary, 0.2)
  ctx.lineWidth = 1.6
  ctx.beginPath()
  ctx.moveTo(gapL, linkY)
  ctx.lineTo(gapR, linkY)
  ctx.stroke()
  ctx.restore()
  ctx.font = monoBold
  ctx.textAlign = 'center'
  ctx.textBaseline = 'bottom'
  ctx.fillStyle = p.entangled ? colors.violetText : colors.inkMuted
  ctx.fillText(
    p.entangled ? 'entangled pair — correlation, not a channel' : 'no pair shared yet',
    (gapL + gapR) / 2,
    linkY - 7
  )

  // ── The classical channel ─────────────────────────────────────────────────
  const chanY = cy + 34
  ctx.strokeStyle = withAlpha(colors.inkSecondary, 0.3)
  ctx.lineWidth = 1.2
  ctx.beginPath()
  ctx.moveTo(gapL, chanY - 2)
  ctx.lineTo(gapR, chanY - 2)
  ctx.moveTo(gapL, chanY + 2)
  ctx.lineTo(gapR, chanY + 2)
  ctx.stroke()

  ctx.font = mono
  ctx.fillStyle = colors.inkMuted
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.fillText('classical channel — at most the speed of light', (gapL + gapR) / 2, chanY + 8)

  if (p.bits) {
    const drawBit = (t: number, value: 0 | 1, name: string, dy: number): void => {
      const x = gapL + gapW * Math.min(1, Math.max(0, t))
      const y = chanY + dy
      ctx.fillStyle = withAlpha(colors.amber, 0.9)
      // A plain rect, not ctx.roundRect: roundRect is missing on Safari below
      // 16, and a throw inside the frame callback stops the loop for good —
      // the canvas would simply be blank with nothing in the console tying it
      // to a rounded corner.
      ctx.fillRect(x - 11, y - 8, 22, 16)
      ctx.fillStyle = '#1a1408'
      ctx.font = '700 10px ui-monospace, SFMono-Regular, Menlo, monospace'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(`${name}${value}`, x, y)
    }
    if (p.channel === 'idle') {
      // Still in Alice's hands.
      drawBit(0, p.bits.c1, 'c₁', -14)
      drawBit(0, p.bits.c0, 'c₀', 14)
    } else if (p.channel === 'flying') {
      drawBit(flight, p.bits.c1, 'c₁', -14)
      drawBit(Math.max(0, flight - 0.14), p.bits.c0, 'c₀', 14)
    } else {
      drawBit(1, p.bits.c1, 'c₁', -14)
      drawBit(1, p.bits.c0, 'c₀', 14)
    }
  }

  // ── Caption and verdict ───────────────────────────────────────────────────
  ctx.font = monoBold
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillStyle = colors.inkSecondary
  ctx.fillText(p.caption.toUpperCase(), 14, 12)

  const verdict = verdictOf(p)
  const VERDICT_TEXT: Record<Verdict, string> = {
    intact: 'ARRIVED INTACT',
    wrong: 'WRONG ROTATION — NEEDS THE BITS',
    mixed: 'NOTHING TO READ YET',
    'not-sent': 'NOTHING SENT YET',
  }
  ctx.textAlign = 'right'
  ctx.fillStyle = verdict === 'intact' ? colors.tealText : colors.inkMuted
  ctx.fillText(VERDICT_TEXT[verdict], w - 14, 12)
}
