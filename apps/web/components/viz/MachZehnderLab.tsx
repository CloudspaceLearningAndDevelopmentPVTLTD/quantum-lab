'use client'

import { useEffect, useRef, useState } from 'react'
import {
  ARM_A,
  ARM_B,
  MACH_ZEHNDER_DEFAULTS,
  machZehnder,
  machZehnderTable,
  modeProbabilities,
  photonIn,
  runTable,
  type MachZehnderOptions,
  type MachZehnderResult,
} from '@/lib/quantum/optics'
import { mulberry32 } from '@/lib/quantum'
import { readVizColors, withAlpha, type VizColors } from './theme'
import {
  createFrameLoop,
  domIntersectionWatcher,
  prefersReducedMotion,
  watchThemeChange,
  type FrameLoop,
} from './frameLoop'

/**
 * MachZehnderLab — the optical table, drawn from the same run of lib/quantum/optics
 * that produces the numbers beside it.
 *
 * THE PICTURE IS NOT A DIAGRAM. Beam brightness is |amplitude|² in that mode, taken
 * from `machZehnder()`'s arm and port states; when an arm is blocked the beam past the
 * card goes dark because the engine says the amplitude there is zero, not because a
 * flag turned a line off.
 *
 * THE CLICKS ARE SAMPLED, NOT SCRIPTED. Every ~70 ms one shot is drawn against the
 * computed port probabilities: the ring flashes at whichever detector won, the counter
 * increments, and the running fractions wander toward the theory curve at the rate
 * √N shot noise demands. That is the single-photon story the page is telling — the
 * wave goes both ways, the click happens in one place — so it must not be faked by
 * lighting both detectors at partial opacity.
 *
 * Geometry: A is the arm the photon is transmitted into at the first splitter and
 * leaves through D1 (upward); B is the reflected arm, leaving through D2 (rightward).
 * With no phase difference every photon leaves through D2.
 */

const CANVAS_H = 470
const Y_DET_A = 40
const Y_HIGH = 96
const Y_LOW = 218
const STRIP_TOP = 288
const STRIP_BOTTOM = 428
/** Below this the table is unreadable, so the wrapper scrolls instead of squeezing. */
export const MIN_TABLE_WIDTH = 600
/** Milliseconds between sampled shots while the animation runs. */
const SHOT_INTERVAL_MS = 70
/** Shots drawn in one go when the visitor has asked for reduced motion. */
const STATIC_SHOTS = 2000
const EMIT_MS = 160
/** Points in the theory curve drawn in the fringe strip. */
const CURVE_POINTS = 160

export type Tool = 'phase' | 'block'
export type Arm = 0 | 1

export type MachZehnderStats = {
  ports: [number, number]
  arms: [number, number]
  survival: number
  visibility: number
  maxVisibility: number
  distinguishability: number
  overlap: number
  /** Sampled detector counts, and shots in which the photon was absorbed on the way. */
  counts: [number, number]
  lost: number
}

type Props = {
  phase: number
  /** Which arm holds the phase shifter, or null when it is still in the tray. */
  phaseArm: Arm | null
  blockedArm: Arm | null
  /** Half-wave plate angle in arm A, radians, or null for no which-path marker. */
  markerAngle: number | null
  /** Polariser angle in front of both detectors, radians, or null. */
  analyserAngle: number | null
  reflectivity: number
  running: boolean
  /** Bump to clear the accumulated counts. */
  resetKey: number
  /** Tool the keyboard path will place when a slot is activated. */
  selectedTool: Tool
  onPlace: (arm: Arm, tool: Tool) => void
  onStats?: (stats: MachZehnderStats) => void
  className?: string
}

type Point = readonly [number, number]

function optionsFrom(props: Props): MachZehnderOptions {
  return {
    ...MACH_ZEHNDER_DEFAULTS,
    // With the shifter still in the tray there is no phase difference to have.
    phase: props.phaseArm === null ? 0 : props.phase,
    phaseArm: props.phaseArm ?? ARM_A,
    blockedArm: props.blockedArm,
    markerAngle: props.markerAngle,
    markerArm: ARM_A,
    reflectivity: props.reflectivity,
    analyserAngle: props.analyserAngle,
    secondSplitter: true,
  }
}

// ── geometry ────────────────────────────────────────────────────────────────

type Geometry = {
  xSource: number
  xBS1: number
  xBS2: number
  xDetB: number
  slotX: number
  markerX: number
  input: Point[]
  /** Each arm is split at its component slot, so a beam block darkens only what is
   *  downstream of the card rather than the whole arm. */
  armAPre: Point[]
  armAPost: Point[]
  armBPre: Point[]
  armBPost: Point[]
  outA: Point[]
  outB: Point[]
}

function geometry(w: number): Geometry {
  const xSource = Math.round(w * 0.055)
  const xBS1 = Math.round(w * 0.21)
  const xBS2 = Math.round(w * 0.63)
  const xDetB = Math.round(w * 0.88)
  const run = xBS2 - xBS1
  const slotX = Math.round(xBS1 + run * 0.62)
  return {
    xSource,
    xBS1,
    xBS2,
    xDetB,
    slotX,
    markerX: Math.round(xBS1 + run * 0.24),
    input: [
      [xSource + 26, Y_LOW],
      [xBS1, Y_LOW],
    ],
    // Transmitted at BS1, folded upward by the far mirror, arrives at BS2 going up.
    armAPre: [
      [xBS1, Y_LOW],
      [slotX, Y_LOW],
    ],
    armAPost: [
      [slotX, Y_LOW],
      [xBS2, Y_LOW],
      [xBS2, Y_HIGH],
    ],
    // Reflected upward at BS1, folded rightward by the near mirror.
    armBPre: [
      [xBS1, Y_LOW],
      [xBS1, Y_HIGH],
      [slotX, Y_HIGH],
    ],
    armBPost: [
      [slotX, Y_HIGH],
      [xBS2, Y_HIGH],
    ],
    outA: [
      [xBS2, Y_HIGH],
      [xBS2, Y_DET_A],
    ],
    outB: [
      [xBS2, Y_HIGH],
      [xDetB, Y_HIGH],
    ],
  }
}

/** Point a fraction `u` of the way along a polyline, by arc length. */
function pointAt(points: Point[], u: number): Point {
  const clamped = Math.max(0, Math.min(1, u))
  let total = 0
  const lengths: number[] = []
  for (let i = 1; i < points.length; i++) {
    const d = Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1])
    lengths.push(d)
    total += d
  }
  if (total === 0) return points[0]
  let travel = clamped * total
  for (let i = 0; i < lengths.length; i++) {
    if (travel <= lengths[i] || i === lengths.length - 1) {
      const f = lengths[i] === 0 ? 0 : travel / lengths[i]
      return [
        points[i][0] + (points[i + 1][0] - points[i][0]) * f,
        points[i][1] + (points[i + 1][1] - points[i][1]) * f,
      ]
    }
    travel -= lengths[i]
  }
  return points[points.length - 1]
}

// ── drawing helpers ─────────────────────────────────────────────────────────

function strokePolyline(ctx: CanvasRenderingContext2D, points: Point[]): void {
  ctx.beginPath()
  ctx.moveTo(points[0][0], points[0][1])
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1])
  ctx.stroke()
}

/** A beam whose glow tracks the probability actually in that mode. */
function drawBeam(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  intensity: number,
  color: string,
): void {
  const i = Math.max(0, Math.min(1, intensity))
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  // The dim rail stays visible at zero intensity so the table remains readable when
  // a port goes perfectly dark — that darkness is the result, not a rendering bug.
  ctx.strokeStyle = withAlpha(color, 0.13)
  ctx.lineWidth = 1.5
  strokePolyline(ctx, points)
  if (i < 0.004) return
  ctx.strokeStyle = withAlpha(color, 0.12 + 0.5 * i)
  ctx.lineWidth = 1.5 + 5 * i
  strokePolyline(ctx, points)
  ctx.strokeStyle = withAlpha(color, 0.55 + 0.45 * i)
  ctx.lineWidth = 1.2 + 1.6 * i
  strokePolyline(ctx, points)
}

/** Travelling brightness along a beam. Purely a direction cue; carries no numbers. */
function drawFlow(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  intensity: number,
  color: string,
  phase: number,
  count = 3,
): void {
  if (intensity < 0.01) return
  for (let k = 0; k < count; k++) {
    const u = (phase + k / count) % 1
    const [x, y] = pointAt(points, u)
    const fade = Math.sin(Math.PI * u) ** 0.5
    ctx.fillStyle = withAlpha(color, 0.85 * intensity * fade)
    ctx.beginPath()
    ctx.arc(x, y, 2.6, 0, Math.PI * 2)
    ctx.fill()
  }
}

function drawSplitter(ctx: CanvasRenderingContext2D, x: number, y: number, c: VizColors): void {
  ctx.save()
  ctx.translate(x, y)
  ctx.fillStyle = withAlpha(c.sky, 0.16)
  ctx.strokeStyle = withAlpha(c.sky, 0.75)
  ctx.lineWidth = 1.4
  ctx.beginPath()
  ctx.rect(-11, -11, 22, 22)
  ctx.fill()
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(-11, 11)
  ctx.lineTo(11, -11)
  ctx.stroke()
  ctx.restore()
}

function drawMirror(ctx: CanvasRenderingContext2D, x: number, y: number, c: VizColors): void {
  ctx.save()
  ctx.translate(x, y)
  ctx.strokeStyle = withAlpha(c.inkSecondary, 0.85)
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(-11, 11)
  ctx.lineTo(11, -11)
  ctx.stroke()
  ctx.restore()
}

/** A wave plate or polariser: a tilted bar showing its optic axis. */
function drawPlate(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  color: string,
  vertical: boolean,
): void {
  ctx.save()
  ctx.translate(x, y)
  ctx.fillStyle = withAlpha(color, 0.18)
  ctx.strokeStyle = withAlpha(color, 0.8)
  ctx.lineWidth = 1.3
  const w = vertical ? 22 : 9
  const h = vertical ? 9 : 22
  ctx.beginPath()
  ctx.rect(-w / 2, -h / 2, w, h)
  ctx.fill()
  ctx.stroke()
  // The axis marker, drawn in the plane transverse to the beam.
  ctx.strokeStyle = withAlpha(color, 0.95)
  ctx.lineWidth = 2
  const r = 8
  const dx = Math.cos(angle) * r
  const dy = Math.sin(angle) * r
  ctx.beginPath()
  if (vertical) {
    ctx.moveTo(-dx, -dy * 0.4)
    ctx.lineTo(dx, dy * 0.4)
  } else {
    ctx.moveTo(-dy * 0.4, -dx)
    ctx.lineTo(dy * 0.4, dx)
  }
  ctx.stroke()
  ctx.restore()
}

function drawDetector(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  facing: 'up' | 'right',
  label: string,
  rate: number,
  flash: number,
  c: VizColors,
  color: string,
): void {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(facing === 'up' ? -Math.PI / 2 : 0)
  ctx.fillStyle = withAlpha(color, 0.14 + 0.4 * rate)
  ctx.strokeStyle = withAlpha(color, 0.85)
  ctx.lineWidth = 1.4
  ctx.beginPath()
  ctx.moveTo(-9, -13)
  ctx.lineTo(9, -8)
  ctx.lineTo(9, 8)
  ctx.lineTo(-9, 13)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  if (flash > 0) {
    ctx.strokeStyle = withAlpha(color, flash)
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(0, 0, 13 + 12 * (1 - flash), 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.restore()
  ctx.fillStyle = c.inkSecondary
  ctx.font = '600 11px ui-sans-serif, system-ui, sans-serif'
  ctx.textAlign = facing === 'up' ? 'center' : 'left'
  ctx.textBaseline = facing === 'up' ? 'bottom' : 'middle'
  if (facing === 'up') ctx.fillText(label, x, y - 20)
  else ctx.fillText(label, x + 16, y)
}

function drawSource(ctx: CanvasRenderingContext2D, x: number, y: number, c: VizColors): void {
  ctx.save()
  ctx.fillStyle = withAlpha(c.amber, 0.16)
  ctx.strokeStyle = withAlpha(c.amber, 0.8)
  ctx.lineWidth = 1.4
  ctx.beginPath()
  // Plain rect rather than roundRect: a missing roundRect would throw inside the draw
  // and the frame loop would stop, blanking the whole canvas over a corner radius.
  ctx.rect(x - 22, y - 12, 46, 24)
  ctx.fill()
  ctx.stroke()
  ctx.restore()
  ctx.fillStyle = c.inkMuted
  ctx.font = '600 10px ui-sans-serif, system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.fillText('one photon', x, y + 16)
}

// ── the component ───────────────────────────────────────────────────────────

type Shot = { detector: 0 | 1 | -1; age: number }

export default function MachZehnderLab(props: Props) {
  const { onPlace, selectedTool, className = '' } = props
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const loopRef = useRef<FrameLoop | null>(null)
  const sizeRef = useRef({ w: 0, h: CANVAS_H })
  const [width, setWidth] = useState(MIN_TABLE_WIDTH)

  const propsRef = useRef(props)
  propsRef.current = props
  const onStatsRef = useRef(props.onStats)
  onStatsRef.current = props.onStats

  /**
   * Two generations, because the two pieces of work have different lifetimes. The
   * fringe curve and the swept visibility depend on everything EXCEPT the phase — the
   * sweep covers every phase by construction — so dragging the φ slider must not
   * re-run 250 tables per frame.
   */
  const sweepGeneration = useRef(0)
  useEffect(() => {
    sweepGeneration.current += 1
    loopRef.current?.start()
  }, [props.phaseArm, props.blockedArm, props.markerAngle, props.analyserAngle, props.reflectivity])

  /** Bumped whenever anything about the table changes, phase included. */
  const configGeneration = useRef(0)
  useEffect(() => {
    configGeneration.current += 1
    loopRef.current?.start()
  }, [
    props.phase,
    props.phaseArm,
    props.blockedArm,
    props.markerAngle,
    props.analyserAngle,
    props.reflectivity,
  ])

  const countsGeneration = useRef(0)
  useEffect(() => {
    countsGeneration.current += 1
    loopRef.current?.start()
  }, [props.resetKey])

  useEffect(() => {
    loopRef.current?.start()
  }, [props.running])

  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const reduceMotion = prefersReducedMotion()
    let colors = readVizColors(wrap)
    let rand = mulberry32(0x51f7a3)

    let solvedSweep = -1
    let solvedConfig = -1
    let countedConfig = -1
    let countedGeneration = -1
    /**
     * The phase-independent half of the answer: arm powers, the marker overlap and the
     * swept visibility, plus the fringe curve drawn under the table. Recomputed only
     * when a component moves.
     */
    let sweep: MachZehnderResult = machZehnder(optionsFrom(propsRef.current))
    let curveA: number[] = []
    let curveB: number[] = []
    /** The phase-dependent half: where the photon actually lands right now. */
    let ports: [number, number] = sweep.ports
    let survival = sweep.survival
    let counts: [number, number] = [0, 0]
    let lost = 0
    let lastShot = 0
    let lastEmit = 0
    const flashes: Shot[] = []

    const solveSweep = (): void => {
      const options = optionsFrom(propsRef.current)
      sweep = machZehnder(options)
      curveA = []
      curveB = []
      const input = photonIn(2, ARM_A)
      for (let i = 0; i <= CURVE_POINTS; i++) {
        const phase = (2 * Math.PI * i) / CURVE_POINTS
        const probs = modeProbabilities(runTable(input, machZehnderTable({ ...options, phase })))
        curveA.push(probs[ARM_A] ?? 0)
        curveB.push(probs[ARM_B] ?? 0)
      }
    }

    const solvePoint = (): void => {
      const options = optionsFrom(propsRef.current)
      const out = runTable(photonIn(2, ARM_A), machZehnderTable(options))
      const probs = modeProbabilities(out)
      ports = [probs[ARM_A] ?? 0, probs[ARM_B] ?? 0]
      survival = ports[0] + ports[1]
    }

    /** Draw one shot against the computed port probabilities. */
    const takeShot = (): 0 | 1 | -1 => {
      const u = rand()
      const [pA, pB] = ports
      if (u < pA) {
        counts[0] += 1
        return 0
      }
      if (u < pA + pB) {
        counts[1] += 1
        return 1
      }
      lost += 1
      return -1
    }

    const emit = (): void => {
      onStatsRef.current?.({
        ports,
        survival,
        arms: sweep.arms,
        visibility: sweep.visibility,
        maxVisibility: sweep.maxVisibility,
        distinguishability: sweep.distinguishability,
        overlap: sweep.overlap,
        counts: [counts[0], counts[1]],
        lost,
      })
    }

    const onFrame = (now: number): boolean => {
      const live = propsRef.current
      if (solvedSweep !== sweepGeneration.current) {
        solveSweep()
        solvedSweep = sweepGeneration.current
      }
      if (solvedConfig !== configGeneration.current) {
        solvePoint()
        solvedConfig = configGeneration.current
      }
      // Counts restart on an explicit reset, and whenever the table itself changes —
      // statistics accumulated under a different interferometer are not this one's.
      if (
        countedGeneration !== countsGeneration.current ||
        countedConfig !== configGeneration.current
      ) {
        counts = [0, 0]
        lost = 0
        flashes.length = 0
        rand = mulberry32(0x51f7a3 ^ (countsGeneration.current * 2654435761))
        countedGeneration = countsGeneration.current
        countedConfig = configGeneration.current
        if (reduceMotion) for (let i = 0; i < STATIC_SHOTS; i++) takeShot()
      }

      let more = false
      if (!reduceMotion && live.running) {
        more = true
        if (now - lastShot >= SHOT_INTERVAL_MS) {
          lastShot = now
          flashes.push({ detector: takeShot(), age: 0 })
        }
        for (const f of flashes) f.age += 1
        while (flashes.length > 0 && flashes[0].age > 34) flashes.shift()
      }

      if (now - lastEmit > EMIT_MS) {
        lastEmit = now
        emit()
      }

      const { w } = sizeRef.current
      if (w > 0) render(ctx, w, now, live, ports, curveA, curveB, sweep.arms, counts, flashes, colors, reduceMotion)
      return more
    }

    const loop = createFrameLoop(window, document, domIntersectionWatcher(wrap), onFrame)
    loopRef.current = loop

    const repaint = (): void => {
      const { w } = sizeRef.current
      if (w > 0) {
        render(ctx, w, 0, propsRef.current, ports, curveA, curveB, sweep.arms, counts, flashes, colors, reduceMotion)
      }
    }
    const stopTheme = watchThemeChange(() => {
      colors = readVizColors(wrap)
      repaint()
    })

    const resize = (): void => {
      const rect = wrap.getBoundingClientRect()
      const w = Math.max(MIN_TABLE_WIDTH, Math.round(rect.width))
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      sizeRef.current = { w, h: CANVAS_H }
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(CANVAS_H * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${CANVAS_H}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      setWidth(w)
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

  const geo = geometry(width)
  const heldBy = (arm: Arm): Tool | null => {
    if (props.blockedArm === arm) return 'block'
    if (props.phaseArm === arm) return 'phase'
    return null
  }

  const slotLabel = (arm: Arm): string => {
    const held = heldBy(arm)
    if (held === 'block') return 'beam block'
    if (held === 'phase') return 'phase shifter'
    return 'empty'
  }

  const armName = (arm: Arm) => (arm === ARM_A ? 'A' : 'B')

  const slot = (arm: Arm, top: number) => {
    const held = heldBy(arm)
    return (
      <button
        key={arm}
        type="button"
        // The slot is a real button, so the whole interaction works from the keyboard:
        // pick a tool in the tray, Tab to a slot, press Enter. Dragging is the shortcut,
        // not the only route.
        onClick={() => onPlace(arm, selectedTool)}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          const tool = e.dataTransfer.getData('text/plain')
          if (tool === 'phase' || tool === 'block') onPlace(arm, tool)
        }}
        aria-label={`Arm ${armName(arm)} component slot, currently ${slotLabel(arm)}. Activates the ${
          selectedTool === 'phase' ? 'phase shifter' : 'beam block'
        }.`}
        className={`focus-ring absolute -translate-x-1/2 -translate-y-1/2 rounded-md border px-2 py-1 text-[10px] font-bold uppercase tracking-wide transition-colors ${
          held === 'block'
            ? 'border-q-rose/60 bg-q-rose/15 text-q-rose-text'
            : held === 'phase'
              ? 'border-q-amber/60 bg-q-amber/15 text-q-amber-text'
              : 'border-dashed border-line-strong bg-surface-2/80 text-ink-muted hover:border-q-violet/50 hover:text-ink-secondary'
        }`}
        style={{ left: geo.slotX, top }}
      >
        {held === 'block' ? '▮ block' : held === 'phase' ? 'φ shifter' : `arm ${armName(arm)}`}
      </button>
    )
  }

  return (
    <div className={`w-full overflow-x-auto ${className}`}>
      <div ref={wrapRef} className="relative w-full" style={{ minWidth: MIN_TABLE_WIDTH, height: CANVAS_H }}>
        <canvas
          ref={canvasRef}
          className="block"
          role="img"
          aria-label={
            'A Mach-Zehnder interferometer: one photon, a first beam splitter, two arms A and B ' +
            'folded by mirrors, and a second splitter feeding detectors D1 and D2. Beam brightness ' +
            'is the probability in that mode. Below the table, the two detector probabilities are ' +
            'plotted against the phase difference over a full turn. The exact figures are in the ' +
            'controls and the tables beside this canvas.'
          }
        />
        {slot(ARM_A as Arm, Y_LOW)}
        {slot(ARM_B as Arm, Y_HIGH)}
      </div>
    </div>
  )
}

// ── render ──────────────────────────────────────────────────────────────────

function render(
  ctx: CanvasRenderingContext2D,
  w: number,
  now: number,
  props: Props,
  ports: readonly [number, number],
  curveA: number[],
  curveB: number[],
  arms: readonly [number, number],
  counts: [number, number],
  flashes: Shot[],
  c: VizColors,
  reduceMotion: boolean,
): void {
  const g = geometry(w)
  ctx.clearRect(0, 0, w, CANVAS_H)

  const flow = reduceMotion ? 0 : (now / 1400) % 1
  const [pA, pB] = ports
  const [aA, aB] = arms
  // Straight off the first splitter, before anything in the arms has acted: arm A gets
  // the transmitted fraction, arm B the reflected one. This is what lights the run of
  // beam UP TO a block — the card absorbs the light, it does not prevent its arrival.
  const preA = 1 - props.reflectivity
  const preB = props.reflectivity

  // Beams, in the order light meets them.
  drawBeam(ctx, g.input, 1, c.amber)
  drawBeam(ctx, g.armAPre, preA, c.violet)
  drawBeam(ctx, g.armAPost, aA, c.violet)
  drawBeam(ctx, g.armBPre, preB, c.teal)
  drawBeam(ctx, g.armBPost, aB, c.teal)
  drawBeam(ctx, g.outA, pA, c.violet)
  drawBeam(ctx, g.outB, pB, c.teal)

  if (!reduceMotion) {
    drawFlow(ctx, g.input, 1, c.amber, flow)
    drawFlow(ctx, g.armAPre, preA, c.violet, flow, 2)
    drawFlow(ctx, g.armAPost, aA, c.violet, flow, 2)
    drawFlow(ctx, g.armBPre, preB, c.teal, flow, 2)
    drawFlow(ctx, g.armBPost, aB, c.teal, flow, 2)
    drawFlow(ctx, g.outA, pA, c.violet, (flow * 2) % 1, 2)
    drawFlow(ctx, g.outB, pB, c.teal, (flow * 2) % 1, 2)
  }

  drawSource(ctx, g.xSource, Y_LOW, c)
  drawSplitter(ctx, g.xBS1, Y_LOW, c)
  drawSplitter(ctx, g.xBS2, Y_HIGH, c)
  drawMirror(ctx, g.xBS2, Y_LOW, c)
  drawMirror(ctx, g.xBS1, Y_HIGH, c)

  // The which-path marker sits in arm A, on the horizontal run before the slot.
  if (props.markerAngle !== null) {
    drawPlate(ctx, g.markerX, Y_LOW, props.markerAngle, c.rose, false)
    ctx.fillStyle = c.roseText
    ctx.font = '600 10px ui-sans-serif, system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillText('HWP', g.markerX, Y_LOW + 16)
  }
  if (props.analyserAngle !== null) {
    drawPlate(ctx, g.xBS2, Y_DET_A + 34, props.analyserAngle, c.sky, true)
    drawPlate(ctx, g.xDetB - 34, Y_HIGH, props.analyserAngle, c.sky, false)
  }

  const flashAt = (detector: 0 | 1): number => {
    let best = 0
    for (const f of flashes) {
      if (f.detector !== detector) continue
      const v = 1 - f.age / 34
      if (v > best) best = v
    }
    return best
  }

  const total = counts[0] + counts[1]
  drawDetector(ctx, g.xBS2, Y_DET_A, 'up', 'D1', pA, flashAt(0), c, c.violet)
  drawDetector(ctx, g.xDetB, Y_HIGH, 'right', 'D2', pB, flashAt(1), c, c.teal)

  ctx.font = '600 11px ui-monospace, SFMono-Regular, monospace'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.fillStyle = c.violetText
  ctx.fillText(`${counts[0]}`, g.xBS2, Y_DET_A - 34)
  ctx.textAlign = 'left'
  ctx.fillStyle = c.tealText
  ctx.fillText(`${counts[1]}`, g.xDetB + 16, Y_HIGH + 6)
  if (total > 0) {
    ctx.fillStyle = c.inkMuted
    ctx.font = '10px ui-sans-serif, system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(`${((counts[0] / total) * 100).toFixed(0)}%`, g.xBS2, Y_DET_A - 21)
    ctx.textAlign = 'left'
    ctx.fillText(`${((counts[1] / total) * 100).toFixed(0)}%`, g.xDetB + 16, Y_HIGH + 20)
  }

  // Arm labels.
  ctx.font = '600 10px ui-sans-serif, system-ui, sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'bottom'
  ctx.fillStyle = withAlpha(c.violet, 0.85)
  ctx.fillText('arm A', g.xBS1 + 16, Y_LOW - 10)
  ctx.fillStyle = withAlpha(c.teal, 0.85)
  ctx.fillText('arm B', g.xBS1 + 16, Y_HIGH - 10)

  renderStrip(ctx, w, props, ports, curveA, curveB, c)
}

function renderStrip(
  ctx: CanvasRenderingContext2D,
  w: number,
  props: Props,
  ports: readonly [number, number],
  curveA: number[],
  curveB: number[],
  c: VizColors,
): void {
  const left = 44
  const right = w - 18
  const top = STRIP_TOP + 16
  const bottom = STRIP_BOTTOM
  if (right <= left || curveA.length === 0) return

  const x = (i: number) => left + ((right - left) * i) / (curveA.length - 1)
  const y = (p: number) => bottom - (bottom - top) * Math.max(0, Math.min(1, p))

  ctx.strokeStyle = withAlpha(c.lineStrong, 1)
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(left, top)
  ctx.lineTo(left, bottom)
  ctx.lineTo(right, bottom)
  ctx.stroke()

  ctx.fillStyle = c.inkMuted
  ctx.font = '10px ui-sans-serif, system-ui, sans-serif'
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  ctx.fillText('1.0', left - 6, top)
  ctx.fillText('0.5', left - 6, (top + bottom) / 2)
  ctx.fillText('0', left - 6, bottom)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  for (const [frac, label] of [
    [0, '0'],
    [0.25, 'π/2'],
    [0.5, 'π'],
    [0.75, '3π/2'],
    [1, '2π'],
  ] as const) {
    ctx.fillText(label, left + (right - left) * frac, bottom + 5)
  }
  ctx.textAlign = 'left'
  ctx.fillStyle = c.inkSecondary
  ctx.font = '600 10px ui-sans-serif, system-ui, sans-serif'
  ctx.fillText('P(click) vs phase difference φ', left + 4, STRIP_TOP)

  const line = (curve: number[], color: string) => {
    ctx.strokeStyle = withAlpha(color, 0.9)
    ctx.lineWidth = 2
    ctx.beginPath()
    for (let i = 0; i < curve.length; i++) {
      const px = x(i)
      const py = y(curve[i])
      if (i === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    }
    ctx.stroke()
  }
  line(curveA, c.violet)
  line(curveB, c.teal)

  // Where the interferometer is set right now. Without a phase shifter on the table
  // there is no phase difference to mark, so the marker sits at zero.
  const phase = props.phaseArm === null ? 0 : props.phase
  const frac = ((phase % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) / (2 * Math.PI)
  const markerX = left + (right - left) * frac
  ctx.strokeStyle = withAlpha(c.amber, 0.7)
  ctx.lineWidth = 1.5
  ctx.setLineDash([4, 4])
  ctx.beginPath()
  ctx.moveTo(markerX, top)
  ctx.lineTo(markerX, bottom)
  ctx.stroke()
  ctx.setLineDash([])

  for (const [p, color] of [
    [ports[0], c.violet],
    [ports[1], c.teal],
  ] as const) {
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(markerX, y(p), 4, 0, Math.PI * 2)
    ctx.fill()
  }
}
