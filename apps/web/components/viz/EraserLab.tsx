'use client'

import { useEffect, useRef } from 'react'
import { eraserRates, quantumEraser, type EraserRates, type EraserResult } from '@/lib/quantum/optics'
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
 * EraserLab — the delayed-choice quantum eraser, run as an experiment rather than
 * asserted as a story.
 *
 * LEFT   The table. A source of polarisation-entangled pairs; the signal photon goes
 *        into a Mach-Zehnder interferometer with a half-wave plate marking one arm;
 *        the idler goes off to a polariser you can rotate, and a detector.
 * RIGHT  Three curves against the interferometer phase, filled in from SAMPLED SHOTS
 *        as the scan runs: the signal singles at D1, and the two coincidence
 *        subensembles the idler sorts those same clicks into.
 *
 * WHY IT IS BUILT THIS WAY. Every shot is drawn once, from the joint distribution over
 * (signal port, idler outcome) that lib/quantum/optics computes. The same click is then
 * counted into the singles histogram AND into whichever coincidence histogram the
 * idler's result assigns it to. Nothing is generated twice and nothing is generated
 * from a fringe formula. That is what makes the payoff honest: the flat singles curve
 * and the two fringed coincidence curves are three views of ONE list of detections, so
 * "the fringes were always there, hidden in the sorting" is something the visitor can
 * watch happen rather than something the copy has to promise.
 */

const CANVAS_H = 470
export const MIN_TABLE_WIDTH = 720
/** Phase bins across 0…2π that the scan fills in. */
export const BINS = 60
/** Shots taken per animation frame while scanning. */
const SHOTS_PER_FRAME = 90
/** Shots per bin under prefers-reduced-motion, filled in one pass. */
const STATIC_SHOTS_PER_BIN = 400
const EMIT_MS = 180

/** Table geometry, in the left panel. */
const Y_SIGNAL_LOW = 214
const Y_SIGNAL_HIGH = 108
const Y_DET_A = 52
const Y_IDLER = 318
const SPLIT = 0.52

export type EraserStats = {
  singles: [number, number]
  coincidence: [number, number]
  coincidenceOrthogonal: [number, number]
  visibility: { singles: number; coincidence: number; coincidenceOrthogonal: number }
  overlap: number
  /** Shots taken in the current scan. */
  shots: number
  /** Measured visibility of the accumulated histograms, or null before enough data. */
  measured: { singles: number | null; coincidence: number | null } | null
}

type Props = {
  /** Interferometer phase, radians. Ignored while `scanning`. */
  phase: number
  /** Half-wave plate angle in arm A, radians, or null for an unmarked interferometer. */
  markerAngle: number | null
  /** Idler polariser angle, radians. */
  idlerAngle: number
  /** Sweep the phase and accumulate counts into the histograms. */
  scanning: boolean
  /** Bump to clear the histograms. */
  resetKey: number
  onStats?: (s: EraserStats) => void
  className?: string
}

type Histogram = {
  /** Shots per bin. */
  shots: Int32Array
  /** D1 clicks per bin, regardless of the idler. */
  singles: Int32Array
  /** D1 clicks whose idler passed the polariser. */
  coincidence: Int32Array
  /** D1 clicks whose idler came out the polariser's other port. */
  coincidenceOrthogonal: Int32Array
}

function newHistogram(): Histogram {
  return {
    shots: new Int32Array(BINS),
    singles: new Int32Array(BINS),
    coincidence: new Int32Array(BINS),
    coincidenceOrthogonal: new Int32Array(BINS),
  }
}

const binPhase = (bin: number) => (2 * Math.PI * (bin + 0.5)) / BINS

/**
 * Visibility of a histogram column, using the mean of the top and bottom sixths rather
 * than the single largest and smallest bins — with a few hundred shots per bin the
 * extreme bins are dominated by shot noise and a raw max/min reads high on pure noise.
 */
function histogramVisibility(counts: Int32Array, shots: Int32Array): number | null {
  const rates: number[] = []
  for (let i = 0; i < BINS; i++) {
    if (shots[i] < 30) return null
    rates.push(counts[i] / shots[i])
  }
  rates.sort((a, b) => a - b)
  const k = Math.max(1, Math.round(BINS / 6))
  let lo = 0
  let hi = 0
  for (let i = 0; i < k; i++) {
    lo += rates[i]
    hi += rates[BINS - 1 - i]
  }
  lo /= k
  hi /= k
  if (hi + lo <= 1e-9) return 0
  return Math.max(0, Math.min(1, (hi - lo) / (hi + lo)))
}

export default function EraserLab(props: Props) {
  const { className = '' } = props
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const loopRef = useRef<FrameLoop | null>(null)
  const sizeRef = useRef({ w: 0 })

  const propsRef = useRef(props)
  propsRef.current = props
  const onStatsRef = useRef(props.onStats)
  onStatsRef.current = props.onStats

  const configGeneration = useRef(0)
  useEffect(() => {
    configGeneration.current += 1
    loopRef.current?.start()
  }, [props.markerAngle, props.idlerAngle, props.resetKey])

  useEffect(() => {
    loopRef.current?.start()
  }, [props.phase, props.scanning])

  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const reduceMotion = prefersReducedMotion()
    let colors = readVizColors(wrap)
    let rand = mulberry32(0x2b91d5)

    let builtConfig = -1
    let histogram = newHistogram()
    let shotsTaken = 0
    let scanBin = 0
    let lastEmit = 0
    /** Theory curves, per bin, for the three histograms. */
    let theorySingles: number[] = []
    let theoryCoincidence: number[] = []
    let theoryOrthogonal: number[] = []
    // `live` is re-evaluated every frame, so it uses the cheap rates-only path;
    // `summary` carries the visibility figures and is refreshed only when the table
    // changes, because each of its three numbers costs a full phase sweep.
    let live: EraserRates = eraserRates({
      phase: 0,
      markerAngle: propsRef.current.markerAngle,
      idlerAngle: propsRef.current.idlerAngle,
      reflectivity: 0.5,
    })
    let summary: EraserResult = quantumEraser({
      phase: 0,
      markerAngle: propsRef.current.markerAngle,
      idlerAngle: propsRef.current.idlerAngle,
      reflectivity: 0.5,
    })

    const options = (phase: number) => ({
      phase,
      markerAngle: propsRef.current.markerAngle,
      idlerAngle: propsRef.current.idlerAngle,
      reflectivity: 0.5,
    })

    const rebuild = (): void => {
      histogram = newHistogram()
      shotsTaken = 0
      scanBin = 0
      rand = mulberry32(0x2b91d5 ^ (configGeneration.current * 2246822519))
      theorySingles = []
      theoryCoincidence = []
      theoryOrthogonal = []
      summary = quantumEraser(options(propsRef.current.phase))
      for (let bin = 0; bin < BINS; bin++) {
        const r = eraserRates(options(binPhase(bin)))
        theorySingles.push(r.singles[0])
        theoryCoincidence.push(r.coincidence[0])
        theoryOrthogonal.push(r.coincidenceOrthogonal[0])
      }
    }

    /**
     * One shot, drawn from the joint distribution over the four outcomes
     * (signal at D1 or D2) × (idler through the polariser or out its other port).
     * The engine gives the two D1 branches directly; the two D2 branches are what is
     * left of the unit budget.
     */
    const takeShot = (bin: number, r: EraserRates): void => {
      const pass = r.coincidence[0]
      const fail = r.coincidenceOrthogonal[0]
      const u = rand()
      histogram.shots[bin] += 1
      shotsTaken += 1
      if (u < pass) {
        histogram.singles[bin] += 1
        histogram.coincidence[bin] += 1
      } else if (u < pass + fail) {
        histogram.singles[bin] += 1
        histogram.coincidenceOrthogonal[bin] += 1
      }
      // Otherwise the signal landed at D2; it still happened, it just does not enter
      // any of the three D1 curves.
    }

    const emit = (): void => {
      const enough = shotsTaken >= BINS * 30
      onStatsRef.current?.({
        singles: live.singles,
        coincidence: live.coincidence,
        coincidenceOrthogonal: live.coincidenceOrthogonal,
        visibility: summary.visibility,
        overlap: summary.overlap,
        shots: shotsTaken,
        measured: enough
          ? {
              singles: histogramVisibility(histogram.singles, histogram.shots),
              coincidence: histogramVisibility(histogram.coincidence, histogram.shots),
            }
          : null,
      })
    }

    const onFrame = (now: number): boolean => {
      const p = propsRef.current
      if (builtConfig !== configGeneration.current) {
        rebuild()
        builtConfig = configGeneration.current
        if (reduceMotion) {
          for (let bin = 0; bin < BINS; bin++) {
            const r = eraserRates(options(binPhase(bin)))
            for (let i = 0; i < STATIC_SHOTS_PER_BIN; i++) takeShot(bin, r)
          }
        }
      }

      live = eraserRates(options(p.phase))

      let more = false
      if (!reduceMotion && p.scanning) {
        more = true
        // Walk the scan across the bins, taking a burst in each. The phase axis is
        // swept exactly the way a lab sweeps a piezo: bin by bin, counting.
        const r = eraserRates(options(binPhase(scanBin)))
        for (let i = 0; i < SHOTS_PER_FRAME; i++) takeShot(scanBin, r)
        scanBin = (scanBin + 1) % BINS
      }

      if (now - lastEmit > EMIT_MS) {
        lastEmit = now
        emit()
      }

      const { w } = sizeRef.current
      if (w > 0) {
        render(ctx, w, p, live, histogram, {
          singles: theorySingles,
          coincidence: theoryCoincidence,
          orthogonal: theoryOrthogonal,
        }, scanBin, colors, reduceMotion || !p.scanning)
      }
      return more
    }

    const loop = createFrameLoop(window, document, domIntersectionWatcher(wrap), onFrame)
    loopRef.current = loop

    const repaint = (): void => {
      const { w } = sizeRef.current
      if (w > 0) {
        render(ctx, w, propsRef.current, live, histogram, {
          singles: theorySingles,
          coincidence: theoryCoincidence,
          orthogonal: theoryOrthogonal,
        }, scanBin, colors, true)
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
      sizeRef.current = { w }
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(CANVAS_H * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${CANVAS_H}px`
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
    <div className={`w-full overflow-x-auto ${className}`}>
      <div
        ref={wrapRef}
        className="relative w-full"
        style={{ minWidth: MIN_TABLE_WIDTH, height: CANVAS_H }}
      >
        <canvas
          ref={canvasRef}
          className="block"
          role="img"
          aria-label={
            'Left: an optical table. A source of entangled photon pairs sends one photon into a ' +
            'Mach-Zehnder interferometer whose upper arm carries a half-wave plate, and its partner ' +
            'to a rotatable polariser and a detector. Right: three curves against the ' +
            'interferometer phase — the signal detector D1 on its own, and the same clicks split ' +
            'into the two subensembles the partner photon sorts them into. Exact figures are in ' +
            'the readouts beside this canvas.'
          }
        />
      </div>
    </div>
  )
}

// ── drawing ─────────────────────────────────────────────────────────────────

type Point = readonly [number, number]

function strokePath(ctx: CanvasRenderingContext2D, points: Point[]): void {
  ctx.beginPath()
  ctx.moveTo(points[0][0], points[0][1])
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1])
  ctx.stroke()
}

function beam(ctx: CanvasRenderingContext2D, points: Point[], intensity: number, color: string): void {
  const i = Math.max(0, Math.min(1, intensity))
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = withAlpha(color, 0.13)
  ctx.lineWidth = 1.5
  strokePath(ctx, points)
  if (i < 0.004) return
  ctx.strokeStyle = withAlpha(color, 0.14 + 0.42 * i)
  ctx.lineWidth = 1.5 + 4.5 * i
  strokePath(ctx, points)
  ctx.strokeStyle = withAlpha(color, 0.6 + 0.4 * i)
  ctx.lineWidth = 1.2 + 1.4 * i
  strokePath(ctx, points)
}

function splitterGlyph(ctx: CanvasRenderingContext2D, x: number, y: number, c: VizColors): void {
  ctx.save()
  ctx.translate(x, y)
  ctx.fillStyle = withAlpha(c.sky, 0.16)
  ctx.strokeStyle = withAlpha(c.sky, 0.75)
  ctx.lineWidth = 1.3
  ctx.beginPath()
  ctx.rect(-10, -10, 20, 20)
  ctx.fill()
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(-10, 10)
  ctx.lineTo(10, -10)
  ctx.stroke()
  ctx.restore()
}

function mirrorGlyph(ctx: CanvasRenderingContext2D, x: number, y: number, c: VizColors): void {
  ctx.save()
  ctx.translate(x, y)
  ctx.strokeStyle = withAlpha(c.inkSecondary, 0.85)
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(-10, 10)
  ctx.lineTo(10, -10)
  ctx.stroke()
  ctx.restore()
}

/** A plate in the beam, with a bar showing its optic axis in the transverse plane. */
function plateGlyph(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  color: string,
  label: string,
  c: VizColors,
): void {
  ctx.save()
  ctx.translate(x, y)
  ctx.fillStyle = withAlpha(color, 0.18)
  ctx.strokeStyle = withAlpha(color, 0.85)
  ctx.lineWidth = 1.3
  ctx.beginPath()
  ctx.rect(-5, -13, 10, 26)
  ctx.fill()
  ctx.stroke()
  ctx.strokeStyle = withAlpha(color, 1)
  ctx.lineWidth = 2.2
  ctx.beginPath()
  ctx.moveTo(-Math.sin(angle) * 4, Math.cos(angle) * 11)
  ctx.lineTo(Math.sin(angle) * 4, -Math.cos(angle) * 11)
  ctx.stroke()
  ctx.restore()
  ctx.fillStyle = c.inkMuted
  ctx.font = '600 10px ui-sans-serif, system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.fillText(label, x, y + 17)
}

function detectorGlyph(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  facing: 'up' | 'right',
  label: string,
  rate: number,
  color: string,
  c: VizColors,
): void {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(facing === 'up' ? -Math.PI / 2 : 0)
  ctx.fillStyle = withAlpha(color, 0.14 + 0.42 * rate)
  ctx.strokeStyle = withAlpha(color, 0.85)
  ctx.lineWidth = 1.3
  ctx.beginPath()
  ctx.moveTo(-8, -12)
  ctx.lineTo(8, -7)
  ctx.lineTo(8, 7)
  ctx.lineTo(-8, 12)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  ctx.restore()
  ctx.fillStyle = c.inkSecondary
  ctx.font = '600 11px ui-sans-serif, system-ui, sans-serif'
  if (facing === 'up') {
    ctx.textAlign = 'center'
    ctx.textBaseline = 'bottom'
    ctx.fillText(label, x, y - 17)
  } else {
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, x + 15, y)
  }
}

function render(
  ctx: CanvasRenderingContext2D,
  w: number,
  props: Props,
  live: EraserRates,
  histogram: Histogram,
  theory: { singles: number[]; coincidence: number[]; orthogonal: number[] },
  scanBin: number,
  c: VizColors,
  hideScanMarker: boolean,
): void {
  ctx.clearRect(0, 0, w, CANVAS_H)
  const tableW = w * SPLIT
  renderTable(ctx, tableW, props, live, c)
  renderPlot(ctx, tableW, w, props, live, histogram, theory, scanBin, c, hideScanMarker)
}

function renderTable(
  ctx: CanvasRenderingContext2D,
  tableW: number,
  props: Props,
  live: EraserRates,
  c: VizColors,
): void {
  const xSource = Math.round(tableW * 0.1)
  const xBS1 = Math.round(tableW * 0.3)
  const xBS2 = Math.round(tableW * 0.72)
  const xDetB = Math.round(tableW * 0.93)
  const xMarker = Math.round(xBS1 + (xBS2 - xBS1) * 0.42)
  const xIdlerPol = Math.round(tableW * 0.6)
  const xIdlerDet = Math.round(tableW * 0.88)

  // Both arms always carry half the probability; the interference is in the ports.
  const armIntensity = 0.5
  const [pA, pB] = live.singles

  const signalIn: Point[] = [
    [xSource + 20, Y_SIGNAL_LOW],
    [xBS1, Y_SIGNAL_LOW],
  ]
  const armA: Point[] = [
    [xBS1, Y_SIGNAL_LOW],
    [xBS2, Y_SIGNAL_LOW],
    [xBS2, Y_SIGNAL_HIGH],
  ]
  const armB: Point[] = [
    [xBS1, Y_SIGNAL_LOW],
    [xBS1, Y_SIGNAL_HIGH],
    [xBS2, Y_SIGNAL_HIGH],
  ]
  const outA: Point[] = [
    [xBS2, Y_SIGNAL_HIGH],
    [xBS2, Y_DET_A],
  ]
  const outB: Point[] = [
    [xBS2, Y_SIGNAL_HIGH],
    [xDetB, Y_SIGNAL_HIGH],
  ]
  const idler: Point[] = [
    [xSource, Y_SIGNAL_LOW + 14],
    [xSource, Y_IDLER],
    [xIdlerDet, Y_IDLER],
  ]

  beam(ctx, signalIn, 1, c.amber)
  beam(ctx, armA, armIntensity, c.violet)
  beam(ctx, armB, armIntensity, c.teal)
  beam(ctx, outA, pA, c.violet)
  beam(ctx, outB, pB, c.teal)
  beam(ctx, idler, 1, c.rose)

  // Source.
  ctx.save()
  ctx.fillStyle = withAlpha(c.amber, 0.16)
  ctx.strokeStyle = withAlpha(c.amber, 0.85)
  ctx.lineWidth = 1.4
  ctx.beginPath()
  ctx.rect(xSource - 16, Y_SIGNAL_LOW - 14, 34, 28)
  ctx.fill()
  ctx.stroke()
  ctx.restore()
  ctx.fillStyle = c.amberText
  ctx.font = '600 10px ui-sans-serif, system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'bottom'
  ctx.fillText('entangled pair', xSource + 2, Y_SIGNAL_LOW - 20)

  splitterGlyph(ctx, xBS1, Y_SIGNAL_LOW, c)
  splitterGlyph(ctx, xBS2, Y_SIGNAL_HIGH, c)
  mirrorGlyph(ctx, xBS2, Y_SIGNAL_LOW, c)
  mirrorGlyph(ctx, xBS1, Y_SIGNAL_HIGH, c)

  if (props.markerAngle !== null) {
    plateGlyph(ctx, xMarker, Y_SIGNAL_LOW, props.markerAngle, c.rose, 'HWP · marks arm A', c)
  }
  plateGlyph(ctx, xIdlerPol, Y_IDLER, props.idlerAngle, c.sky, 'idler polariser θ', c)

  detectorGlyph(ctx, xBS2, Y_DET_A, 'up', 'D1', pA, c.violet, c)
  detectorGlyph(ctx, xDetB, Y_SIGNAL_HIGH, 'right', 'D2', pB, c.teal, c)
  detectorGlyph(ctx, xIdlerDet, Y_IDLER, 'right', 'Di', 0.5, c.rose, c)

  ctx.font = '600 10px ui-sans-serif, system-ui, sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'bottom'
  ctx.fillStyle = withAlpha(c.violet, 0.85)
  ctx.fillText('arm A', xBS1 + 14, Y_SIGNAL_LOW - 9)
  ctx.fillStyle = withAlpha(c.teal, 0.85)
  ctx.fillText('arm B', xBS1 + 14, Y_SIGNAL_HIGH - 9)

  // The delayed-choice statement, drawn as a timeline rather than claimed in prose.
  const tlY = CANVAS_H - 46
  const tlLeft = 18
  const tlRight = tableW - 18
  ctx.strokeStyle = withAlpha(c.lineStrong, 1)
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(tlLeft, tlY)
  ctx.lineTo(tlRight, tlY)
  ctx.stroke()
  const marks: [number, string, string][] = [
    [0.06, 'pair born', c.amber],
    [0.42, 'D1 or D2 clicks', c.violet],
    [0.82, 'θ chosen, Di clicks', c.sky],
  ]
  ctx.font = '600 9px ui-sans-serif, system-ui, sans-serif'
  ctx.textAlign = 'center'
  for (const [f, label, color] of marks) {
    const x = tlLeft + (tlRight - tlLeft) * f
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(x, tlY, 3.5, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = c.inkMuted
    ctx.textBaseline = 'top'
    ctx.fillText(label, x, tlY + 7)
  }
  ctx.fillStyle = c.inkMuted
  ctx.textAlign = 'left'
  ctx.textBaseline = 'bottom'
  ctx.fillText('the idler arm is longer, so the choice is made last', tlLeft, tlY - 8)
}

function renderPlot(
  ctx: CanvasRenderingContext2D,
  tableW: number,
  w: number,
  props: Props,
  live: EraserRates,
  histogram: Histogram,
  theory: { singles: number[]; coincidence: number[]; orthogonal: number[] },
  scanBin: number,
  c: VizColors,
  hideScanMarker: boolean,
): void {
  const left = Math.round(tableW + 52)
  const right = w - 20
  const top = 46
  const bottom = CANVAS_H - 56
  if (right - left < 80 || theory.singles.length === 0) return

  // With the marker in, every curve is a rate out of at most 0.5 and a 0…0.6 axis keeps
  // the fringes large. Take the marker out and the singles themselves swing to 1, so the
  // axis has to grow or the top of that curve would be silently clipped off.
  let peak = 0
  for (const values of [theory.singles, theory.coincidence, theory.orthogonal]) {
    for (const v of values) if (v > peak) peak = v
  }
  const yMax = Math.min(1.05, Math.max(0.6, peak * 1.12))
  const x = (phase: number) => left + ((right - left) * phase) / (2 * Math.PI)
  const y = (p: number) => bottom - (bottom - top) * Math.max(0, Math.min(1, p / yMax))

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
  for (const v of [0, 0.25, 0.5, 0.75, 1]) {
    if (v > yMax) continue
    ctx.fillText(v.toFixed(2), left - 6, y(v))
  }
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  for (const [frac, label] of [
    [0, '0'],
    [0.5, 'π'],
    [1, '2π'],
  ] as const) {
    ctx.fillText(label, left + (right - left) * frac, bottom + 5)
  }
  ctx.fillStyle = c.inkSecondary
  ctx.font = '600 10px ui-sans-serif, system-ui, sans-serif'
  ctx.textAlign = 'left'
  ctx.fillText('rate at D1 vs interferometer phase φ', left - 22, 22)

  const curve = (values: number[], color: string, dashed = false) => {
    ctx.strokeStyle = withAlpha(color, dashed ? 0.55 : 0.9)
    ctx.lineWidth = dashed ? 1.5 : 2
    if (dashed) ctx.setLineDash([5, 4])
    ctx.beginPath()
    for (let bin = 0; bin < values.length; bin++) {
      const px = x(binPhase(bin))
      const py = y(values[bin])
      if (bin === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    }
    ctx.stroke()
    ctx.setLineDash([])
  }

  curve(theory.singles, c.amber, true)
  curve(theory.coincidence, c.violet)
  curve(theory.orthogonal, c.teal)

  // Sampled points on top of the theory. These are the actual counts.
  const dots = (counts: Int32Array, color: string, radius: number) => {
    ctx.fillStyle = withAlpha(color, 0.95)
    for (let bin = 0; bin < BINS; bin++) {
      const n = histogram.shots[bin]
      if (n < 8) continue
      ctx.beginPath()
      ctx.arc(x(binPhase(bin)), y(counts[bin] / n), radius, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  dots(histogram.singles, c.amberText, 1.9)
  dots(histogram.coincidence, c.violetText, 2.4)
  dots(histogram.coincidenceOrthogonal, c.tealText, 2.4)

  // Where the interferometer is parked, and where the scan currently is.
  const phaseFrac = (((props.phase % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) / (2 * Math.PI)
  const px = left + (right - left) * phaseFrac
  ctx.strokeStyle = withAlpha(c.inkMuted, 0.5)
  ctx.lineWidth = 1.2
  ctx.setLineDash([3, 4])
  ctx.beginPath()
  ctx.moveTo(px, top)
  ctx.lineTo(px, bottom)
  ctx.stroke()
  ctx.setLineDash([])
  for (const [p, color] of [
    [live.coincidence[0], c.violet],
    [live.coincidenceOrthogonal[0], c.teal],
    [live.singles[0], c.amber],
  ] as const) {
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(px, y(p), 3.5, 0, Math.PI * 2)
    ctx.fill()
  }
  if (!hideScanMarker) {
    ctx.strokeStyle = withAlpha(c.sky, 0.8)
    ctx.lineWidth = 1.5
    const sx = x(binPhase(scanBin))
    ctx.beginPath()
    ctx.moveTo(sx, bottom)
    ctx.lineTo(sx, bottom - 12)
    ctx.stroke()
  }

  // Legend.
  const legend: [string, string][] = [
    ['D1 singles — every shot', c.amber],
    ['in coincidence with θ', c.violet],
    ['in coincidence with θ+90°', c.teal],
  ]
  ctx.font = '10px ui-sans-serif, system-ui, sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  legend.forEach(([label, color], i) => {
    const ly = CANVAS_H - 38 + i * 12
    ctx.strokeStyle = withAlpha(color, 0.9)
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(left - 20, ly)
    ctx.lineTo(left - 4, ly)
    ctx.stroke()
    ctx.fillStyle = c.inkMuted
    ctx.fillText(label, left + 2, ly)
  })
}
