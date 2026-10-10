'use client'

import { useEffect, useRef } from 'react'
import {
  CU_K_ALPHA_NM,
  DEFAULT_ELECTRON_MODEL,
  DEG,
  deBroglieWavelengthNm,
  electronIntensity,
  peakAngleDegAtVoltage,
  peakVoltageV,
  sampleAngleDeg,
  scatteringCdf,
  xrayPattern,
  xrayPowderPeaks,
  type ElectronModel,
} from '@/lib/viz/electronDiffraction'
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
 * ElectronDiffractionLab — Davisson and Germer's bench on canvas.
 *
 * Top canvas: an electron gun firing straight down onto the (111) face of a
 * nickel crystal, the scattered-intensity polar plot growing out of the crystal,
 * and a detector on a swing-arm at the angle the page sets. Individual electrons
 * are sampled one at a time from `electronIntensity` in lib/viz/electronDiffraction.ts
 * — the same function the unit tests check for its 50°/54 V peak — and the
 * detector counts the ones that land inside its aperture.
 *
 * Middle canvas: the detector's reading as the voltage is swept, plotted against
 * √V so the orders come out evenly spaced, with the page's current voltage marked.
 *
 * Bottom canvas: what X-rays of the electron's wavelength do to the same nickel —
 * the powder pattern, from the full three-dimensional lattice.
 *
 * ACCESSIBILITY: no pointer interaction lives here; every control is a real form
 * control in the page's rail. Each canvas carries a description of what it shows
 * now, and the page prints the same numbers in text.
 */

export const BENCH_HEIGHT = 360
export const SCAN_HEIGHT = 150
export const XRAY_HEIGHT = 170

/** The detector accepts electrons within this many degrees of its axis. */
export const DETECTOR_HALF_WIDTH_DEG = 3
/** The gun body hides scattering closer than this to the incident beam. */
export const GUN_SHADOW_DEG = 10
/** Fixed intensity that fills the polar plot, so raising the voltage does not rescale it. */
const POLAR_FULL_SCALE = 0.4

export const SCAN_MIN_V = 20
export const SCAN_MAX_V = 400

const ELECTRONS_PER_SECOND = 45
const SPEED_PX_PER_S = 260
const REDUCED_BATCH = 400
const EMIT_MS = 120

export type DetectorCounts = {
  fired: number
  clicks: number
}

type Particle = {
  /** Scattering angle, degrees from the incident beam; negative is to the left. */
  angleDeg: number
  /** Distance travelled along gun → crystal → out, px. */
  s: number
  total: number
  inbound: number
  counted: boolean
}

type Layout = {
  w: number
  h: number
  cx: number
  cy: number
  /** Radius of the detector arc. */
  arcR: number
  /** Radius the polar plot reaches at POLAR_FULL_SCALE. */
  plotR: number
  gunTop: number
  gunBottom: number
  gunW: number
  crystalW: number
  crystalH: number
}

type Props = {
  voltageV: number
  detectorDeg: number
  model?: ElectronModel
  running: boolean
  resetKey: number
  onCounts?: (c: DetectorCounts) => void
  className?: string
}

export default function ElectronDiffractionLab({
  voltageV,
  detectorDeg,
  model = DEFAULT_ELECTRON_MODEL,
  running,
  resetKey,
  onCounts,
  className = '',
}: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const benchRef = useRef<HTMLCanvasElement | null>(null)
  const scanRef = useRef<HTMLCanvasElement | null>(null)
  const xrayRef = useRef<HTMLCanvasElement | null>(null)
  const loopRef = useRef<FrameLoop | null>(null)

  const propsRef = useRef({ voltageV, detectorDeg, model, running })
  propsRef.current = { voltageV, detectorDeg, model, running }
  const onCountsRef = useRef(onCounts)
  onCountsRef.current = onCounts
  const resetGenRef = useRef(0)

  useEffect(() => {
    resetGenRef.current += 1
    loopRef.current?.start()
  }, [resetKey, voltageV, detectorDeg, model])

  useEffect(() => {
    loopRef.current?.start()
  }, [running])

  useEffect(() => {
    const wrap = wrapRef.current
    const bench = benchRef.current
    const scan = scanRef.current
    const xray = xrayRef.current
    if (!wrap || !bench || !scan || !xray) return
    const benchCtx = bench.getContext('2d')
    const scanCtx = scan.getContext('2d')
    const xrayCtx = xray.getContext('2d')
    if (!benchCtx || !scanCtx || !xrayCtx) return

    const reduceMotion = prefersReducedMotion()
    let colors = readVizColors(wrap)
    let width = 0
    let layout: Layout | null = null

    let rand = mulberry32(0x1927)
    let counts: DetectorCounts = { fired: 0, clicks: 0 }
    let particles: Particle[] = []
    let cdf = scatteringCdf(propsRef.current.voltageV, 0.5, propsRef.current.model)
    let cdfKey = ''
    let builtGen = -1
    let lastNow = 0
    let lastBatch = 0
    let lastEmit = 0
    let pending = 0

    const modelKey = () => {
      const p = propsRef.current
      return `${p.voltageV}|${p.model.rows}|${p.model.diffuse}|${p.model.formFactorScale}`
    }

    const reset = (): void => {
      counts = { fired: 0, clicks: 0 }
      particles = []
      pending = 0
      rand = mulberry32(0x1927 ^ (resetGenRef.current * 2246822519))
      builtGen = resetGenRef.current
      const key = modelKey()
      if (key !== cdfKey) {
        cdf = scatteringCdf(propsRef.current.voltageV, 0.5, propsRef.current.model)
        cdfKey = key
      }
    }

    const fire = (): Particle => {
      const angleDeg = sampleAngleDeg(rand(), cdf)
      counts.fired += 1
      const hit = Math.abs(angleDeg - propsRef.current.detectorDeg) <= DETECTOR_HALF_WIDTH_DEG
      if (hit) counts.clicks += 1
      const L = layout
      const inbound = L ? L.cy - L.gunBottom : 0
      const total = inbound + (L ? L.arcR : 0)
      return { angleDeg, s: 0, total, inbound, counted: hit }
    }

    const onFrame = (now: number): boolean => {
      if (builtGen !== resetGenRef.current) reset()
      const live = propsRef.current
      const dt = lastNow === 0 ? 0 : Math.min(0.05, (now - lastNow) / 1000)
      lastNow = now

      let more = false
      if (reduceMotion) {
        particles = []
        if (live.running) {
          if (now - lastBatch > 400) {
            lastBatch = now
            for (let i = 0; i < REDUCED_BATCH; i++) fire()
          }
          more = true
        }
      } else {
        if (live.running && layout) {
          pending += ELECTRONS_PER_SECOND * dt
          const emit = Math.min(20, Math.floor(pending))
          pending -= emit
          for (let i = 0; i < emit; i++) particles.push(fire())
          more = true
        }
        const keep: Particle[] = []
        for (const p of particles) {
          p.s += SPEED_PX_PER_S * dt
          if (p.s < p.total) keep.push(p)
        }
        particles = keep
        if (particles.length > 0) more = true
      }

      if (now - lastEmit > EMIT_MS) {
        lastEmit = now
        onCountsRef.current?.({ ...counts })
      }
      paint()
      return more
    }

    const paint = (): void => {
      if (!layout || width <= 0) return
      const live = propsRef.current
      drawBench(benchCtx, layout, live.voltageV, live.detectorDeg, live.model, particles, counts, colors)
      drawScan(scanCtx, width, SCAN_HEIGHT, live.voltageV, live.detectorDeg, live.model, colors)
      drawXray(xrayCtx, width, XRAY_HEIGHT, live.voltageV, colors)
    }

    const loop = createFrameLoop(window, document, domIntersectionWatcher(wrap), onFrame)
    loopRef.current = loop

    const stopTheme = watchThemeChange(() => {
      colors = readVizColors(wrap)
      paint()
    })

    const setupCanvas = (
      canvas: HTMLCanvasElement,
      ctx: CanvasRenderingContext2D,
      w: number,
      h: number
    ) => {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    const resize = (): void => {
      const rect = wrap.getBoundingClientRect()
      width = Math.max(1, Math.round(rect.width))
      setupCanvas(bench, benchCtx, width, BENCH_HEIGHT)
      setupCanvas(scan, scanCtx, width, SCAN_HEIGHT)
      setupCanvas(xray, xrayCtx, width, XRAY_HEIGHT)
      layout = buildLayout(width, BENCH_HEIGHT)
      particles = []
      if (builtGen !== resetGenRef.current) reset()
      paint()
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
    <div ref={wrapRef} className={`w-full ${className}`}>
      <canvas
        ref={benchRef}
        className="block w-full"
        style={{ height: BENCH_HEIGHT }}
        role="img"
        aria-label={describeBench(voltageV, detectorDeg, model)}
      />
      <canvas
        ref={scanRef}
        className="block w-full"
        style={{ height: SCAN_HEIGHT }}
        role="img"
        aria-label={describeScan(voltageV, detectorDeg)}
      />
      <canvas
        ref={xrayRef}
        className="block w-full"
        style={{ height: XRAY_HEIGHT }}
        role="img"
        aria-label={describeXray(voltageV)}
      />
    </div>
  )
}

// ────────────────────────────────────────────────────────────
// Geometry
// ────────────────────────────────────────────────────────────

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export function buildLayout(w: number, h: number): Layout {
  const crystalH = 44
  const cy = h - crystalH - 22
  const cx = w / 2
  const arcR = clamp(Math.min(w / 2 - 44, cy - 46), 80, 300)
  return {
    w,
    h,
    cx,
    cy,
    arcR,
    plotR: arcR * 0.86,
    gunTop: 8,
    gunBottom: Math.max(40, cy - arcR - 4),
    gunW: 22,
    crystalW: clamp(w * 0.42, 120, 300),
    crystalH,
  }
}

/** Screen position of a point at angle θ (degrees from the incident beam, + is right) and radius r from the crystal. */
function polar(L: Layout, thetaDeg: number, r: number): { x: number; y: number } {
  const a = thetaDeg * DEG
  return { x: L.cx + Math.sin(a) * r, y: L.cy - Math.cos(a) * r }
}

// ────────────────────────────────────────────────────────────
// Painting
// ────────────────────────────────────────────────────────────

const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace'

function drawBench(
  ctx: CanvasRenderingContext2D,
  L: Layout,
  voltageV: number,
  detectorDeg: number,
  model: ElectronModel,
  particles: readonly Particle[],
  counts: DetectorCounts,
  c: VizColors
): void {
  ctx.clearRect(0, 0, L.w, L.h)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  // ── Angle arc and ticks ──
  ctx.strokeStyle = withAlpha(c.inkMuted, 0.3)
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.arc(L.cx, L.cy, L.arcR, Math.PI, 2 * Math.PI)
  ctx.stroke()
  ctx.font = `9px ${MONO}`
  ctx.fillStyle = c.inkMuted
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (let deg = -90; deg <= 90; deg += 15) {
    const inner = polar(L, deg, L.arcR - 4)
    const outer = polar(L, deg, L.arcR + (deg % 30 === 0 ? 6 : 3))
    ctx.beginPath()
    ctx.moveTo(inner.x, inner.y)
    ctx.lineTo(outer.x, outer.y)
    ctx.stroke()
    if (deg % 30 === 0 && deg !== 0) {
      const at = polar(L, deg, L.arcR + 16)
      ctx.fillText(`${Math.abs(deg)}°`, at.x, at.y)
    }
  }

  // ── Polar plot of scattered intensity ──
  const plot = (sign: 1 | -1) => {
    ctx.beginPath()
    ctx.moveTo(L.cx, L.cy)
    for (let deg = GUN_SHADOW_DEG; deg <= 90; deg += 0.5) {
      const r = L.plotR * clamp(electronIntensity(deg, voltageV, model) / POLAR_FULL_SCALE, 0, 1.08)
      const p = polar(L, sign * deg, r)
      ctx.lineTo(p.x, p.y)
    }
    ctx.closePath()
  }
  for (const sign of [1, -1] as const) {
    plot(sign)
    ctx.fillStyle = withAlpha(c.violet, 0.16)
    ctx.fill()
    ctx.strokeStyle = withAlpha(c.violet, 0.9)
    ctx.lineWidth = 1.6
    ctx.stroke()
  }

  // ── Predicted first-order peak, both sides ──
  const peak = peakAngleDegAtVoltage(voltageV)
  if (peak !== null) {
    for (const sign of [1, -1] as const) {
      const a = polar(L, sign * peak, L.arcR - 10)
      const b = polar(L, sign * peak, L.arcR + 1)
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.strokeStyle = c.teal
      ctx.lineWidth = 2.5
      ctx.stroke()
    }
  }
  // Fixed-position readouts: top-left the prediction, top-right the detector.
  // Anchoring them to the arc put them off-canvas at 10° and 90° on a phone.
  ctx.font = `600 9px ${MONO}`
  ctx.fillStyle = c.tealText
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillText(
    peak === null ? 'D sin θ = λ has no solution: λ > D' : `D sin θ = λ → peak at ${peak.toFixed(1)}° (teal ticks)`,
    10,
    6
  )

  // ── Incident beam ──
  ctx.beginPath()
  ctx.moveTo(L.cx, L.gunBottom)
  ctx.lineTo(L.cx, L.cy)
  ctx.strokeStyle = withAlpha(c.violet, 0.55)
  ctx.lineWidth = 3
  ctx.stroke()

  // ── Detector arm and detector ──
  const det = polar(L, detectorDeg, L.arcR)
  ctx.setLineDash([3, 4])
  ctx.beginPath()
  ctx.moveTo(L.cx, L.cy)
  ctx.lineTo(det.x, det.y)
  ctx.strokeStyle = withAlpha(c.amber, 0.7)
  ctx.lineWidth = 1.25
  ctx.stroke()
  ctx.setLineDash([])
  // Aperture wedge.
  ctx.beginPath()
  ctx.moveTo(L.cx, L.cy)
  ctx.arc(
    L.cx,
    L.cy,
    L.arcR,
    (detectorDeg - DETECTOR_HALF_WIDTH_DEG - 90) * DEG,
    (detectorDeg + DETECTOR_HALF_WIDTH_DEG - 90) * DEG
  )
  ctx.closePath()
  ctx.fillStyle = withAlpha(c.amber, 0.1)
  ctx.fill()
  // Detector box, facing the crystal.
  ctx.save()
  ctx.translate(det.x, det.y)
  ctx.rotate(detectorDeg * DEG)
  roundRect(ctx, -13, -9, 26, 18, 4)
  ctx.fillStyle = withAlpha(c.amber, 0.22)
  ctx.fill()
  ctx.strokeStyle = c.amber
  ctx.lineWidth = 1.5
  ctx.stroke()
  ctx.restore()
  const reading = electronIntensity(detectorDeg, voltageV, model)
  ctx.font = `600 9px ${MONO}`
  ctx.fillStyle = c.amberText
  ctx.textAlign = 'right'
  ctx.textBaseline = 'top'
  ctx.fillText(`detector ${detectorDeg.toFixed(0)}°`, L.w - 10, 6)
  ctx.font = `9px ${MONO}`
  ctx.fillStyle = c.inkSecondary
  ctx.fillText(`reads ${((100 * reading) / POLAR_FULL_SCALE).toFixed(0)}% of scale`, L.w - 10, 18)

  // ── Electrons in flight ──
  for (const p of particles) {
    let x: number
    let y: number
    if (p.s < p.inbound) {
      x = L.cx
      y = L.gunBottom + p.s
    } else {
      const out = polar(L, p.angleDeg, p.s - p.inbound)
      x = out.x
      y = out.y
    }
    ctx.beginPath()
    ctx.arc(x, y, 2.2, 0, Math.PI * 2)
    ctx.fillStyle = p.counted && p.s >= p.inbound ? c.amberText : c.violetText
    ctx.fill()
  }

  // ── Crystal ──
  drawCrystal(ctx, L, c)

  // ── Gun ──
  roundRect(ctx, L.cx - L.gunW / 2, L.gunTop, L.gunW, L.gunBottom - L.gunTop, 4)
  ctx.fillStyle = withAlpha(c.surface2, 0.96)
  ctx.fill()
  ctx.strokeStyle = withAlpha(c.violet, 0.75)
  ctx.lineWidth = 1.5
  ctx.stroke()
  ctx.font = `600 9px ${MONO}`
  ctx.fillStyle = c.violetText
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(`e⁻ gun · ${voltageV.toFixed(0)} V`, L.cx + L.gunW / 2 + 6, L.gunTop + 12)

  // ── Legend ──
  ctx.font = `9px ${MONO}`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'bottom'
  ctx.fillStyle = c.inkMuted
  ctx.fillText(
    `λ = ${deBroglieWavelengthNm(voltageV).toFixed(4)} nm · ${format(counts.fired)} fired · ${format(counts.clicks)} at detector`,
    10,
    L.h - 6
  )
}

function drawCrystal(ctx: CanvasRenderingContext2D, L: Layout, c: VizColors): void {
  const x = L.cx - L.crystalW / 2
  const y = L.cy
  roundRect(ctx, x, y, L.crystalW, L.crystalH, 4)
  ctx.fillStyle = withAlpha(c.teal, 0.1)
  ctx.fill()
  ctx.strokeStyle = withAlpha(c.teal, 0.6)
  ctx.lineWidth = 1.25
  ctx.stroke()
  // Rows of atoms: the (111) surface seen edge-on, rows D apart.
  const pitch = 11
  const rowGap = 10
  for (let r = 0; r < 3; r++) {
    const yy = y + 7 + r * rowGap
    const offset = r % 2 === 0 ? 0 : pitch / 2
    for (let xx = x + 8 + offset; xx < x + L.crystalW - 6; xx += pitch) {
      ctx.beginPath()
      ctx.arc(xx, yy, r === 0 ? 2.4 : 1.8, 0, Math.PI * 2)
      ctx.fillStyle = withAlpha(c.tealText, r === 0 ? 0.95 : 0.45)
      ctx.fill()
    }
  }
  // Label inside the block, under the atom rows, so it cannot collide with
  // the legend line at the foot of the canvas on a narrow screen.
  ctx.font = `600 9px ${MONO}`
  ctx.fillStyle = c.tealText
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('Ni (111) · rows 0.216 nm apart', L.cx, y + L.crystalH - 8)
}

/** Detector reading against √V, with the current voltage and the predicted orders marked. */
function drawScan(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  voltageV: number,
  detectorDeg: number,
  model: ElectronModel,
  c: VizColors
): void {
  ctx.clearRect(0, 0, w, h)
  const padL = 36
  const padR = 12
  const padT = 16
  const padB = 24
  const plotW = Math.max(10, w - padL - padR)
  const plotH = Math.max(10, h - padT - padB)
  const rMin = Math.sqrt(SCAN_MIN_V)
  const rMax = Math.sqrt(SCAN_MAX_V)
  const X = (v: number) => padL + ((Math.sqrt(v) - rMin) / (rMax - rMin)) * plotW
  const Y = (p: number) => padT + (1 - clamp(p, 0, 1)) * plotH

  ctx.strokeStyle = withAlpha(c.inkMuted, 0.25)
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(padL, padT + plotH)
  ctx.lineTo(padL + plotW, padT + plotH)
  ctx.stroke()
  ctx.font = `9px ${MONO}`
  ctx.fillStyle = c.inkMuted
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  for (const v of [20, 54, 100, 200, 300, 400]) ctx.fillText(`${v} V`, X(v), padT + plotH + 5)

  // Predicted orders.
  for (let n = 1; n <= 4; n++) {
    const v = peakVoltageV(detectorDeg, n, model.rowSpacingNm)
    if (!Number.isFinite(v) || v < SCAN_MIN_V || v > SCAN_MAX_V) continue
    ctx.setLineDash([2, 3])
    ctx.beginPath()
    ctx.moveTo(X(v), padT)
    ctx.lineTo(X(v), padT + plotH)
    ctx.strokeStyle = withAlpha(c.teal, 0.7)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.fillStyle = c.tealText
    ctx.textBaseline = 'bottom'
    ctx.fillText(`n=${n}`, X(v), padT - 2)
  }

  // The curve, on a fixed scale so the orders can be compared across angles.
  ctx.beginPath()
  const steps = Math.max(60, Math.floor(plotW))
  for (let i = 0; i <= steps; i++) {
    const r = rMin + ((rMax - rMin) * i) / steps
    const v = r * r
    const y = electronIntensity(detectorDeg, v, model) / POLAR_FULL_SCALE
    const px = X(v)
    const py = Y(y)
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.strokeStyle = withAlpha(c.violet, 0.9)
  ctx.lineWidth = 2
  ctx.stroke()

  // Current voltage.
  ctx.setLineDash([3, 4])
  ctx.beginPath()
  ctx.moveTo(X(voltageV), padT)
  ctx.lineTo(X(voltageV), padT + plotH)
  ctx.strokeStyle = withAlpha(c.amber, 0.8)
  ctx.lineWidth = 1.25
  ctx.stroke()
  ctx.setLineDash([])
  ctx.beginPath()
  ctx.arc(X(voltageV), Y(electronIntensity(detectorDeg, voltageV, model) / POLAR_FULL_SCALE), 4, 0, Math.PI * 2)
  ctx.fillStyle = c.amberText
  ctx.fill()

  ctx.font = `9px ${MONO}`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillStyle = c.inkMuted
  ctx.fillText(`detector at ${detectorDeg.toFixed(0)}° · reading vs voltage, √V axis`, padL + 2, 2)
}

/** Nickel powder pattern at the electron's wavelength, with the Cu Kα pattern for reference. */
function drawXray(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  voltageV: number,
  c: VizColors
): void {
  ctx.clearRect(0, 0, w, h)
  const padL = 36
  const padR = 12
  const padT = 26
  const padB = 24
  const plotW = Math.max(10, w - padL - padR)
  const plotH = Math.max(10, h - padT - padB)
  const minTT = 20
  const maxTT = 130
  const X = (tt: number) => padL + ((tt - minTT) / (maxTT - minTT)) * plotW
  const Y = (p: number) => padT + (1 - clamp(p, 0, 1)) * plotH

  ctx.strokeStyle = withAlpha(c.inkMuted, 0.25)
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(padL, padT + plotH)
  ctx.lineTo(padL + plotW, padT + plotH)
  ctx.stroke()
  ctx.font = `9px ${MONO}`
  ctx.fillStyle = c.inkMuted
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  for (const tt of [20, 40, 60, 80, 100, 120]) ctx.fillText(`${tt}°`, X(tt), padT + plotH + 5)

  const curve = (peaks: ReturnType<typeof xrayPowderPeaks>, width: number) => {
    ctx.beginPath()
    const steps = Math.max(120, Math.floor(plotW * 1.5))
    for (let i = 0; i <= steps; i++) {
      const tt = minTT + ((maxTT - minTT) * i) / steps
      const px = X(tt)
      const py = Y(xrayPattern(peaks, tt, width))
      if (i === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    }
  }

  // Reference: the pattern every textbook prints, Cu Kα.
  const ref = xrayPowderPeaks(CU_K_ALPHA_NM)
  curve(ref, 0.7)
  ctx.strokeStyle = withAlpha(c.inkMuted, 0.45)
  ctx.lineWidth = 1
  ctx.setLineDash([2, 3])
  ctx.stroke()
  ctx.setLineDash([])

  // At the electron's wavelength.
  const lambda = deBroglieWavelengthNm(voltageV)
  const peaks = xrayPowderPeaks(lambda)
  curve(peaks, 0.7)
  ctx.strokeStyle = withAlpha(c.sky, 0.95)
  ctx.lineWidth = 1.8
  ctx.stroke()

  ctx.font = `9px ${MONO}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'bottom'
  let lastX = -100
  for (const p of peaks) {
    if (p.twoThetaDeg < minTT || p.twoThetaDeg > maxTT) continue
    const x = X(p.twoThetaDeg)
    const y = Y(p.intensity)
    if (x - lastX < 26 && p.intensity < 0.2) continue
    lastX = x
    ctx.fillStyle = c.skyText
    ctx.fillText(p.label, x, y - 3)
  }

  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillStyle = c.inkMuted
  ctx.fillText(
    `X-rays on nickel powder at λ = ${lambda.toFixed(4)} nm (solid) · Cu Kα 0.1541 nm (dotted) · 2θ axis`,
    padL + 2,
    2
  )
  ctx.fillText('sharp lines from the 3-D lattice — compare the one broad electron peak above', padL + 2, 12)
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

function format(n: number): string {
  return n < 100000 ? n.toLocaleString('en-US') : n.toExponential(1)
}

// ────────────────────────────────────────────────────────────
// Accessible descriptions
// ────────────────────────────────────────────────────────────

export function describeBench(voltageV: number, detectorDeg: number, model: ElectronModel): string {
  const lambda = deBroglieWavelengthNm(voltageV)
  const peak = peakAngleDegAtVoltage(voltageV, 1, model.rowSpacingNm)
  const reading = electronIntensity(detectorDeg, voltageV, model) / POLAR_FULL_SCALE
  const where =
    peak === null
      ? `At this voltage the wavelength, ${lambda.toFixed(3)} nanometres, is longer than the 0.216 nanometre row spacing, so there is no diffraction peak at any angle — only a smooth fall-off.`
      : `The first-order peak is predicted at ${peak.toFixed(1)} degrees from the beam.`
  return (
    `An electron gun at ${voltageV.toFixed(0)} volts fires straight down onto the (111) face of a nickel crystal. ` +
    `The scattered intensity is drawn as a polar plot around the crystal. ${where} ` +
    `A detector sits ${detectorDeg.toFixed(0)} degrees from the incident beam and reads ${(100 * reading).toFixed(0)} percent of full scale.`
  )
}

export function describeScan(voltageV: number, detectorDeg: number): string {
  const v1 = peakVoltageV(detectorDeg, 1)
  const v2 = peakVoltageV(detectorDeg, 2)
  return (
    `The detector's reading at ${detectorDeg.toFixed(0)} degrees as the voltage is swept from ${SCAN_MIN_V} to ${SCAN_MAX_V} volts, plotted against the square root of the voltage. ` +
    `First order peaks at ${Number.isFinite(v1) ? v1.toFixed(0) : 'no'} volts and second order at ${Number.isFinite(v2) ? v2.toFixed(0) : 'no'} volts. ` +
    `The current voltage, ${voltageV.toFixed(0)}, is marked.`
  )
}

export function describeXray(voltageV: number): string {
  const lambda = deBroglieWavelengthNm(voltageV)
  const peaks = xrayPowderPeaks(lambda)
  const lines = peaks
    .filter((p) => p.twoThetaDeg <= 130)
    .map((p) => `${p.label} at ${p.twoThetaDeg.toFixed(1)} degrees`)
    .join(', ')
  return (
    `The X-ray powder diffraction pattern of nickel at ${lambda.toFixed(4)} nanometres, the electron's wavelength at ${voltageV.toFixed(0)} volts: ` +
    `sharp lines at two-theta of ${lines || 'no angle below 130 degrees'}. The Cu K-alpha pattern is dotted alongside for reference.`
  )
}
