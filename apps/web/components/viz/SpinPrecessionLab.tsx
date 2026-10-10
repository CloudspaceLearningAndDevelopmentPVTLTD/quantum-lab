'use client'

import { useEffect, useMemo, useRef } from 'react'
import {
  coneAngle,
  generalizedRabiFrequency,
  labField,
  norm,
  probabilityOfOne,
  rabiTransitionProbability,
  rk4Step,
  rotateAbout,
  staticField,
  type FieldConfig,
  type Vec3,
} from '@/lib/viz/spinPrecession'
import { readVizColors, withAlpha, type VizColors } from './theme'
import {
  createFrameLoop,
  domIntersectionWatcher,
  prefersReducedMotion,
  watchThemeChange,
  type FrameLoop,
} from './frameLoop'

/**
 * SpinPrecessionLab — a Bloch sphere with a magnetic field on it.
 *
 * LEFT   the spin, the field, the precession cone and a fading trail, drawn in
 *        an orthographic projection. Either the lab frame or the frame rotating
 *        with the RF drive, the reader's choice — the whole pedagogical point
 *        is that the second one is where the qubit gate lives.
 * RIGHT  P(|1⟩) against time, with the closed-form Rabi curve drawn dashed on
 *        top of it whenever the closed form is actually valid (B₀ along z, spin
 *        starting at |0⟩). They lie on each other, which is the honest way to
 *        show the simulation is not making its physics up.
 *
 * NUMERICS. The Bloch equation dv/dt = γ(v × B) is integrated by RK4 in the LAB
 * frame with the full time-dependent RF field — no rotating-wave approximation,
 * no closed-form shortcut. The rotating-frame view is a coordinate change
 * applied to the result, not a different simulation. Everything the sphere
 * shows is therefore a consequence of one equation, which is exactly the claim
 * the page makes to the reader.
 *
 * TIME. A proton in a 1.5 T field precesses at 64 MHz, which is 64 million
 * turns per second, so the animation runs on a compressed clock and the page
 * displays the compression factor next to the frequency rather than quietly
 * animating a fictitious number. Simulation units set γ = 1 and B₀(reference) =
 * 1; the physical frequencies in the readouts are computed from the real γ and
 * the real field, and the two are related only through that stated factor.
 */

export type SpinStats = {
  /** Bloch vector in whichever frame is being displayed. */
  v: Vec3
  probabilityOne: number
  /** Angle between the spin and the effective field, in radians. */
  cone: number
  /** Elapsed simulation time in the module's dimensionless units. */
  simTime: number
  /** Elapsed drive time, used for the "equivalent gate" readout. */
  driveTime: number
  /** True while a scripted pulse is still running. */
  pulseActive: boolean
}

export type SpinLabProps = {
  /** Static field magnitude, in units of the reference field (ω₀ = this). */
  b0: number
  /** Tilt of B₀ away from +z, radians. Only meaningful with the drive off. */
  tilt: number
  /** RF amplitude as a fraction of B₀. Zero means no drive. */
  b1Ratio: number
  /** Detuning in units of ω₁. 0 is exact resonance. */
  detuningRatio: number
  /** RF phase in radians; π gives RX, π/2 gives RY. */
  drivePhase: number
  driveOn: boolean
  frame: 'lab' | 'rotating'
  /** Draw the dashed circle the spin is locked onto. */
  showCone: boolean
  running: boolean
  /** Bump to return the spin to |0⟩ and clear the trace. */
  resetKey: number
  /**
   * When set, run the drive for exactly this rotation angle and then stop.
   * The object identity is the trigger, so a second π pulse re-fires.
   */
  pulse: { angle: number } | null
  onStats?: (s: SpinStats) => void
  className?: string
}

const SPHERE_PAD = 26
const TRAIL_MAX = 260
const TRACE_MAX = 900
const EMIT_MS = 120

/** Screen seconds for one Larmor turn at the reference field, in the lab view. */
const LAB_SCREEN_PERIOD = 1.35
/** Screen seconds for one full Rabi cycle in the rotating view. */
const ROTATING_SCREEN_PERIOD = 3.2

type Projected = { sx: number; sy: number; depth: number }

/**
 * Orthographic projection of a Bloch-sphere point.
 * Bloch z (the |0⟩–|1⟩ axis) is drawn up the screen; `depth` is positive toward
 * the viewer and is used only for painter ordering, so the back of the sphere
 * reads as being behind it.
 */
function project(v: Vec3, az: number, el: number, r: number, cx: number, cy: number): Projected {
  const ca = Math.cos(az)
  const sa = Math.sin(az)
  const x1 = v[0] * ca - v[1] * sa
  const y1 = v[0] * sa + v[1] * ca
  const ce = Math.cos(el)
  const se = Math.sin(el)
  const depth = y1 * ce - v[2] * se
  const up = y1 * se + v[2] * ce
  return { sx: cx + x1 * r, sy: cy - up * r, depth }
}

export default function SpinPrecessionLab({
  b0,
  tilt,
  b1Ratio,
  detuningRatio,
  drivePhase,
  driveOn,
  frame,
  showCone,
  running,
  resetKey,
  pulse,
  onStats,
  className = '',
}: SpinLabProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const sizeRef = useRef({ w: 0, h: 0 })
  const loopRef = useRef<FrameLoop | null>(null)

  const live = useRef({ b0, tilt, b1Ratio, detuningRatio, drivePhase, driveOn, frame, showCone, running })
  live.current = { b0, tilt, b1Ratio, detuningRatio, drivePhase, driveOn, frame, showCone, running }
  const onStatsRef = useRef(onStats)
  onStatsRef.current = onStats

  // Generation counters: a change to either restarts the relevant piece of
  // state inside the loop without tearing the canvas down and rebuilding it.
  const resetGen = useRef(0)
  useEffect(() => {
    resetGen.current += 1
    loopRef.current?.start()
  }, [resetKey, b0, tilt, b1Ratio, detuningRatio, drivePhase, driveOn])

  useEffect(() => {
    loopRef.current?.start()
  }, [showCone])

  const pulseGen = useRef(0)
  const pulseReq = useRef<{ angle: number } | null>(null)
  useEffect(() => {
    if (!pulse) return
    pulseGen.current += 1
    pulseReq.current = pulse
    loopRef.current?.start()
  }, [pulse])

  useEffect(() => {
    loopRef.current?.start()
  }, [running, frame])

  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const reduceMotion = prefersReducedMotion()
    let colors = readVizColors(wrap)

    // ── Simulation state, all in dimensionless units with γ = 1 ──
    let v: Vec3 = [0, 0, 1]
    let simTime = 0
    let driveTime = 0
    let builtReset = -1
    let builtPulse = -1
    let pulseRemaining = 0
    let trailVecs: Vec3[] = []
    let trace: { t: number; p: number }[] = []
    // The closed-form Rabi curve is only meaningful measured from the release
    // of the spin at t = 0, so it is drawn only while the trace still holds its
    // own beginning. Once the ring buffer starts dropping points this goes
    // false and the overlay disappears rather than silently shifting.
    let traceFromStart = true
    let lastFrameMs = 0
    let lastEmit = 0

    const config = (): FieldConfig => {
      const s = live.current
      const useDrive = s.driveOn || pulseRemaining > 0
      const omega0 = s.b0
      const omega1 = useDrive ? s.b1Ratio * s.b0 : 0
      const detuning = s.detuningRatio * omega1
      return {
        b0: s.b0,
        // A resonant drive only means anything about a field along z, so a
        // tilted field and an RF pulse are never both live at once. The page
        // enforces this too; belt and braces, because a tilted resonance would
        // silently invalidate the closed-form curve drawn over the trace.
        tilt: useDrive ? 0 : s.tilt,
        b1: omega1,
        driveOmega: omega0 - detuning,
        drivePhase: s.drivePhase,
      }
    }

    /** Simulation-time advanced per screen second, and the substep count. */
    const clock = (): { rate: number; larmorPeriod: number } => {
      const s = live.current
      const omega0 = Math.max(1e-6, s.b0)
      const larmorPeriod = (2 * Math.PI) / omega0
      if (s.frame === 'rotating') {
        const omega1 = Math.max(1e-6, s.b1Ratio * s.b0)
        const detuning = s.detuningRatio * omega1
        const omega = generalizedRabiFrequency(omega1, detuning)
        return { rate: (2 * Math.PI) / omega / ROTATING_SCREEN_PERIOD, larmorPeriod }
      }
      // Fixed rate, so raising B₀ visibly speeds the precession up — which is
      // the one thing the Larmor formula says and the one thing the reader
      // should be able to see without reading a number.
      return { rate: (2 * Math.PI) / LAB_SCREEN_PERIOD, larmorPeriod }
    }

    const displayVector = (): Vec3 => {
      const s = live.current
      if (s.frame !== 'rotating') return v
      const cfg = config()
      return rotateAbout(v, [0, 0, 1], cfg.driveOmega * simTime)
    }

    /** The field to draw: the instantaneous lab field, or the static effective
     *  field the spin sees in the rotating frame. */
    const displayField = (): Vec3 => {
      const s = live.current
      const cfg = config()
      if (s.frame !== 'rotating') return labField(simTime, cfg)
      const detuning = cfg.b0 - cfg.driveOmega
      return [
        cfg.b1 * Math.cos(cfg.drivePhase),
        -cfg.b1 * Math.sin(cfg.drivePhase),
        detuning,
      ]
    }

    const onFrame = (now: number): boolean => {
      const s = live.current

      if (builtReset !== resetGen.current) {
        builtReset = resetGen.current
        v = [0, 0, 1]
        simTime = 0
        driveTime = 0
        pulseRemaining = 0
        trailVecs = []
        trace = [{ t: 0, p: probabilityOfOne(v) }]
        traceFromStart = true
        lastFrameMs = 0
      }
      if (builtPulse !== pulseGen.current) {
        builtPulse = pulseGen.current
        const req = pulseReq.current
        const omega1 = Math.max(1e-9, s.b1Ratio * s.b0)
        pulseRemaining = req ? req.angle / omega1 : 0
      }

      const dtScreen = lastFrameMs === 0 ? 0 : Math.min(0.05, (now - lastFrameMs) / 1000)
      lastFrameMs = now

      const advancing = (s.running || pulseRemaining > 0) && dtScreen > 0
      if (advancing) {
        const { rate, larmorPeriod } = clock()
        let dtSim = dtScreen * rate
        if (pulseRemaining > 0) dtSim = Math.min(dtSim, pulseRemaining)
        // Resolve the fastest thing in the problem — always the Larmor turn,
        // since the RF is a fraction of B₀ — with at least 120 RK4 steps.
        const substeps = Math.max(1, Math.min(600, Math.ceil(dtSim / (larmorPeriod / 120))))
        const h = dtSim / substeps
        const cfg = config()
        for (let i = 0; i < substeps; i++) {
          v = rk4Step(v, simTime, h, 1, (tt) => labField(tt, cfg))
          simTime += h
        }
        if (cfg.b1 > 0) driveTime += dtSim
        if (pulseRemaining > 0) {
          pulseRemaining = Math.max(0, pulseRemaining - dtSim)
        }

        const shown = displayVector()
        trailVecs.push(shown)
        if (trailVecs.length > TRAIL_MAX) trailVecs.shift()
        trace.push({ t: simTime, p: probabilityOfOne(v) })
        if (trace.length > TRACE_MAX) {
          trace.shift()
          traceFromStart = false
        }
      }

      const { w, h } = sizeRef.current
      if (w > 0 && h > 0) {
        draw(ctx, w, h, colors, {
          v: displayVector(),
          field: displayField(),
          trail: trailVecs,
          trace,
          cfg: config(),
          frame: s.frame,
          traceFromStart,
          showCone: s.showCone,
          simTime,
          driveTime,
          reduceMotion,
        })
      }

      if (now - lastEmit > EMIT_MS) {
        lastEmit = now
        onStatsRef.current?.({
          v: displayVector(),
          probabilityOne: probabilityOfOne(v),
          cone: coneAngle(v, staticField(config())),
          simTime,
          driveTime,
          pulseActive: pulseRemaining > 0,
        })
      }

      // Keep asking for frames while anything is moving. Under reduced motion
      // the page defaults to paused, so this simply never spins on its own.
      return advancing || pulseRemaining > 0
    }

    const loop = createFrameLoop(window, document, domIntersectionWatcher(wrap), onFrame)
    loopRef.current = loop

    const repaint = (): void => {
      const { w, h } = sizeRef.current
      if (w > 0 && h > 0) {
        draw(ctx, w, h, colors, {
          v: displayVector(),
          field: displayField(),
          trail: trailVecs,
          trace,
          cfg: config(),
          frame: live.current.frame,
          traceFromStart,
          showCone: live.current.showCone,
          simTime,
          driveTime,
          reduceMotion,
        })
      }
    }

    const stopTheme = watchThemeChange(() => {
      colors = readVizColors(wrap)
      repaint()
    })

    const resize = (): void => {
      const rect = wrap.getBoundingClientRect()
      const w = Math.max(1, Math.round(rect.width))
      const hh = Math.max(1, Math.round(rect.height))
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      sizeRef.current = { w, h: hh }
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(hh * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${hh}px`
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

  const label = useMemo(() => {
    const drive = driveOn ? `a resonant radio-frequency drive at ${Math.round(b1Ratio * 100)} per cent of B zero` : 'no drive'
    return (
      `A Bloch sphere in the ${frame} frame. The spin arrow precesses about the magnetic field, ` +
      `which is tilted ${Math.round((tilt * 180) / Math.PI)} degrees from the vertical, with ${drive}. ` +
      `Beside it, the probability of measuring one plotted against time, with the closed-form Rabi ` +
      `curve drawn over it. Exact figures are in the readouts beside this canvas.`
    )
  }, [frame, tilt, driveOn, b1Ratio])

  return (
    <div ref={wrapRef} className={`relative w-full ${className}`} style={{ height: 420 }}>
      <canvas ref={canvasRef} className="block h-full w-full" role="img" aria-label={label} />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Rendering
// ─────────────────────────────────────────────────────────────────────────────

export type DrawState = {
  v: Vec3
  field: Vec3
  trail: Vec3[]
  trace: { t: number; p: number }[]
  cfg: FieldConfig
  frame: 'lab' | 'rotating'
  traceFromStart: boolean
  showCone: boolean
  simTime: number
  driveTime: number
  reduceMotion: boolean
}

const AZIMUTH = -0.62
const ELEVATION = 0.34

/**
 * Exported for SpinPrecessionLab.test.ts, which drives it against a recording
 * stub context. A canvas render path that throws leaves a blank box and no
 * error anywhere a user would see, so it is worth a test even though the test
 * cannot look at the pixels.
 */
export function draw(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  colors: VizColors,
  s: DrawState
): void {
  ctx.clearRect(0, 0, w, h)
  // The trace panel is dropped entirely on narrow canvases rather than squeezed
  // into an unreadable sliver; the numbers it shows are also in the readouts.
  const split = w < 560 ? w : Math.min(w * 0.58, w - 190)
  drawSphere(ctx, 0, 0, split, h, colors, s)
  if (split < w - 40) drawTrace(ctx, split, 0, w - split, h, colors, s)
}

function drawSphere(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  w: number,
  h: number,
  colors: VizColors,
  s: DrawState
): void {
  const cx = x0 + w / 2
  const cy = y0 + h / 2
  const r = Math.max(20, Math.min(w, h) / 2 - SPHERE_PAD)
  const P = (v: Vec3) => project(v, AZIMUTH, ELEVATION, r, cx, cy)

  // Sphere body
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fillStyle = withAlpha(colors.surface2, 0.55)
  ctx.fill()
  ctx.strokeStyle = withAlpha(colors.inkSecondary, 0.3)
  ctx.lineWidth = 1
  ctx.stroke()

  // Equator and two meridians, split into front and back halves so the sphere
  // reads as a solid rather than a wire ball.
  const ring = (a: Vec3, b: Vec3) => {
    for (const front of [false, true]) {
      ctx.beginPath()
      let started = false
      for (let i = 0; i <= 180; i++) {
        const th = (i / 180) * Math.PI * 2
        const c = Math.cos(th)
        const sn = Math.sin(th)
        const p = P([a[0] * c + b[0] * sn, a[1] * c + b[1] * sn, a[2] * c + b[2] * sn])
        const isFront = p.depth > 0
        if (isFront !== front) {
          started = false
          continue
        }
        if (!started) {
          ctx.moveTo(p.sx, p.sy)
          started = true
        } else ctx.lineTo(p.sx, p.sy)
      }
      ctx.strokeStyle = withAlpha(colors.sky, front ? 0.4 : 0.14)
      ctx.lineWidth = front ? 1.1 : 1
      ctx.stroke()
    }
  }
  ring([1, 0, 0], [0, 1, 0])
  ring([1, 0, 0], [0, 0, 1])
  ring([0, 1, 0], [0, 0, 1])

  // Axis labels
  const mono = '600 11px ui-monospace, SFMono-Regular, Menlo, monospace'
  ctx.font = mono
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const labels: [Vec3, string][] = [
    [[0, 0, 1.19], '|0⟩'],
    [[0, 0, -1.19], '|1⟩'],
    [[1.2, 0, 0], '|+⟩'],
    [[0, 1.2, 0], '|i⟩'],
  ]
  for (const [pos, text] of labels) {
    const p = P(pos)
    ctx.fillStyle = p.depth > 0 ? colors.inkSecondary : withAlpha(colors.inkMuted, 0.5)
    ctx.fillText(text, p.sx, p.sy)
  }

  const fieldMag = norm(s.field)
  const fieldHat: Vec3 =
    fieldMag > 1e-9
      ? [s.field[0] / fieldMag, s.field[1] / fieldMag, s.field[2] / fieldMag]
      : [0, 0, 1]

  // The precession cone: the circle the spin actually traces around the field.
  const cone = coneAngle(s.v, s.field)
  if (s.showCone && fieldMag > 1e-9 && cone > 0.04 && cone < Math.PI - 0.04) {
    const a = perpendicular(fieldHat)
    const b = crossVec(fieldHat, a)
    const cc = Math.cos(cone)
    const ss = Math.sin(cone)
    ctx.beginPath()
    for (let i = 0; i <= 120; i++) {
      const th = (i / 120) * Math.PI * 2
      const p = P([
        fieldHat[0] * cc + (a[0] * Math.cos(th) + b[0] * Math.sin(th)) * ss,
        fieldHat[1] * cc + (a[1] * Math.cos(th) + b[1] * Math.sin(th)) * ss,
        fieldHat[2] * cc + (a[2] * Math.cos(th) + b[2] * Math.sin(th)) * ss,
      ])
      if (i === 0) ctx.moveTo(p.sx, p.sy)
      else ctx.lineTo(p.sx, p.sy)
    }
    ctx.setLineDash([3, 4])
    ctx.strokeStyle = withAlpha(colors.amber, 0.45)
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.setLineDash([])
  }

  // Trail
  if (s.trail.length > 1) {
    for (let i = 1; i < s.trail.length; i++) {
      const a = P(s.trail[i - 1])
      const b = P(s.trail[i])
      const t = i / s.trail.length
      ctx.beginPath()
      ctx.moveTo(a.sx, a.sy)
      ctx.lineTo(b.sx, b.sy)
      ctx.strokeStyle = withAlpha(colors.violet, 0.06 + 0.5 * t * t)
      ctx.lineWidth = 1.4
      ctx.stroke()
    }
  }

  // The field vector (amber) and the spin (violet).
  arrow(ctx, P([0, 0, 0]), P(scale(fieldHat, 1.02)), colors.amber, 2, 'B')
  arrow(ctx, P([0, 0, 0]), P(s.v), colors.violet, 3, null)

  // Head dot on the spin so it stays visible when it points at the camera.
  const tip = P(s.v)
  ctx.beginPath()
  ctx.arc(tip.sx, tip.sy, 4.5, 0, Math.PI * 2)
  ctx.fillStyle = colors.violet
  ctx.fill()
  ctx.strokeStyle = colors.surface2
  ctx.lineWidth = 1.5
  ctx.stroke()

  ctx.font = '600 11px ui-monospace, SFMono-Regular, Menlo, monospace'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillStyle = colors.inkSecondary
  ctx.fillText(s.frame === 'rotating' ? 'rotating frame' : 'lab frame', x0 + 10, y0 + 8)
  ctx.fillStyle = colors.amberText
  ctx.fillText(
    s.frame === 'rotating' ? 'B  effective field' : 'B  instantaneous field',
    x0 + 10,
    y0 + 24
  )
}

function drawTrace(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  w: number,
  h: number,
  colors: VizColors,
  s: DrawState
): void {
  const padL = 8
  const padR = 14
  const padT = 34
  const padB = 30
  const px = x0 + padL
  const py = y0 + padT
  const pw = Math.max(10, w - padL - padR)
  const ph = Math.max(10, h - padT - padB)

  ctx.strokeStyle = withAlpha(colors.inkSecondary, 0.22)
  ctx.lineWidth = 1
  ctx.strokeRect(px + 0.5, py + 0.5, pw, ph)

  const mono = '10px ui-monospace, SFMono-Regular, Menlo, monospace'
  ctx.font = '600 11px ui-monospace, SFMono-Regular, Menlo, monospace'
  ctx.fillStyle = colors.inkSecondary
  ctx.textAlign = 'left'
  ctx.textBaseline = 'bottom'
  ctx.fillText('P(|1⟩) vs time', px, py - 16)

  // Half-way line: a π/2 pulse parks the spin here.
  ctx.setLineDash([2, 4])
  ctx.strokeStyle = withAlpha(colors.inkMuted, 0.4)
  ctx.beginPath()
  ctx.moveTo(px, py + ph / 2)
  ctx.lineTo(px + pw, py + ph / 2)
  ctx.stroke()
  ctx.setLineDash([])

  ctx.font = mono
  ctx.fillStyle = colors.inkMuted
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillText('1', px + 3, py + 2)
  ctx.textBaseline = 'bottom'
  ctx.fillText('0', px + 3, py + ph - 2)

  if (s.trace.length < 2) {
    ctx.fillStyle = colors.inkMuted
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('press play', px + pw / 2, py + ph / 2)
    return
  }

  const t0 = s.trace[0].t
  const t1 = s.trace[s.trace.length - 1].t
  const span = Math.max(1e-6, t1 - t0)
  const toX = (t: number) => px + ((t - t0) / span) * pw
  const toY = (p: number) => py + (1 - p) * ph

  // The closed-form Rabi curve, drawn only where it is actually valid: field
  // along z, drive on, spin released from |0⟩ at t = 0.
  const omega1 = s.cfg.b1
  const detuning = s.cfg.b0 - s.cfg.driveOmega
  const overlayValid = omega1 > 0 && s.cfg.tilt === 0 && s.traceFromStart
  if (overlayValid) {
    ctx.beginPath()
    for (let i = 0; i <= 200; i++) {
      const t = t0 + (i / 200) * span
      const p = rabiTransitionProbability(omega1, detuning, t)
      if (i === 0) ctx.moveTo(toX(t), toY(p))
      else ctx.lineTo(toX(t), toY(p))
    }
    ctx.setLineDash([4, 3])
    ctx.strokeStyle = withAlpha(colors.amber, 0.9)
    ctx.lineWidth = 1.6
    ctx.stroke()
    ctx.setLineDash([])
  }

  ctx.beginPath()
  for (let i = 0; i < s.trace.length; i++) {
    const p = s.trace[i]
    if (i === 0) ctx.moveTo(toX(p.t), toY(p.p))
    else ctx.lineTo(toX(p.t), toY(p.p))
  }
  ctx.strokeStyle = colors.teal
  ctx.lineWidth = 1.8
  ctx.stroke()

  ctx.font = mono
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillStyle = colors.tealText
  ctx.fillText('simulated', px, py + ph + 6)
  if (overlayValid) {
    ctx.textAlign = 'right'
    ctx.fillStyle = colors.amberText
    ctx.fillText('closed form', px + pw, py + ph + 6)
  }
}

// ── small vector and drawing helpers ──

function scale(v: Vec3, k: number): Vec3 {
  return [v[0] * k, v[1] * k, v[2] * k]
}

function crossVec(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

/** Any unit vector perpendicular to `v`, chosen to avoid the degenerate case. */
function perpendicular(v: Vec3): Vec3 {
  const seed: Vec3 = Math.abs(v[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]
  const c = crossVec(v, seed)
  const n = Math.hypot(c[0], c[1], c[2]) || 1
  return [c[0] / n, c[1] / n, c[2] / n]
}

function arrow(
  ctx: CanvasRenderingContext2D,
  from: Projected,
  to: Projected,
  color: string,
  width: number,
  label: string | null
): void {
  ctx.beginPath()
  ctx.moveTo(from.sx, from.sy)
  ctx.lineTo(to.sx, to.sy)
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.lineCap = 'round'
  ctx.stroke()

  const dx = to.sx - from.sx
  const dy = to.sy - from.sy
  const len = Math.hypot(dx, dy)
  if (len > 6) {
    const ux = dx / len
    const uy = dy / len
    const head = 9
    ctx.beginPath()
    ctx.moveTo(to.sx, to.sy)
    ctx.lineTo(to.sx - ux * head - uy * head * 0.42, to.sy - uy * head + ux * head * 0.42)
    ctx.lineTo(to.sx - ux * head + uy * head * 0.42, to.sy - uy * head - ux * head * 0.42)
    ctx.closePath()
    ctx.fillStyle = color
    ctx.fill()
  }
  if (label) {
    ctx.font = '600 11px ui-monospace, SFMono-Regular, Menlo, monospace'
    ctx.fillStyle = color
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, to.sx + 12, to.sy - 10)
  }
}
