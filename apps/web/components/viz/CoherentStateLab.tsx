'use client'

import { useEffect, useRef } from 'react'
import {
  expectationX,
  gaussianPacket,
  probabilityDensity,
  spreadX,
  SplitStepPropagator,
  type Grid,
} from '@/lib/quantum/schrodinger'
import { readVizColors, withAlpha, type VizColors } from './theme'
import {
  createFrameLoop,
  domIntersectionWatcher,
  prefersReducedMotion,
  watchThemeChange,
  type FrameLoop,
} from './frameLoop'

/**
 * CoherentStateLab — a Gaussian sloshing in a parabola, next to the classical particle it
 * is pretending to be.
 *
 * TOP PANEL   the parabolic potential, the packet's energy line, and |ψ(x,t)|². Two
 *             markers ride the axis: ⟨x⟩ from the quantum state, and x(t) = a·cos(ωt)
 *             from Newton. They should sit on top of each other, forever.
 * BOTTOM      the last few periods of both, as curves. Agreement is easy to claim frame by
 *             frame and hard to fake over a trace.
 *
 * The integrator is the shared split-step propagator (lib/quantum/schrodinger.ts) — the
 * same one the scattering page uses and the same one the unit tests hold to the analytic
 * spreading law. Nothing about the physics is special-cased for this picture.
 *
 * REDUCED MOTION: the frame loop never advances time on its own. `stepRequest` (bumped by
 * a button in the controls rail) moves the state forward one sixteenth of a period at a
 * time, so the whole result is reachable without any animation at all.
 */

const PAD_L = 46
const PAD_R = 18
const PAD_T = 18
const PAD_B = 30
/** Fraction of the canvas height given to the ⟨x⟩-versus-time trace. */
const TRACE_SHARE = 0.34
/** Integration step. Small enough that a period is resolved to ~0.1% at every ω here. */
const DT = 0.004
/** Animation frames per classical period, held roughly constant as ω changes. */
const FRAMES_PER_PERIOD = 170
/** Samples kept for the trace: about two and a half periods at the pace above. */
const TRACE_POINTS = 420

export type CoherentStats = {
  time: number
  /** ⟨x⟩ from the evolved wavefunction. */
  meanX: number
  /** a·cos(ωt): where Newton says the particle is. */
  classicalX: number
  /** The packet's width now, and the width of the oscillator's own ground state. */
  spread: number
  groundWidth: number
  periods: number
}

type Props = {
  grid: Grid
  potential: Float64Array
  omega: number
  /** Initial displacement a. The classical amplitude. */
  displacement: number
  /** Packet width as a multiple of the ground-state width. 1 is the coherent state. */
  widthRatio: number
  running: boolean
  /** Bump to restart from t = 0. */
  resetKey: number
  /** Bump to advance one sixteenth of a period while paused. */
  stepRequest: number
  onStats?: (s: CoherentStats) => void
  className?: string
}

type Sim = {
  psi: { re: Float64Array; im: Float64Array }
  prop: SplitStepPropagator
  density: Float64Array
  time: number
  peak: number
  amplitude: number
  omega: number
  trace: { t: number; quantum: number; classical: number }[]
}

function buildSim(
  grid: Grid,
  potential: Float64Array,
  omega: number,
  displacement: number,
  widthRatio: number
): Sim {
  // The oscillator's ground state has |ψ|² of width 1/√(2ω); a packet of exactly that
  // width is a coherent state and never spreads. Anything else breathes.
  const groundWidth = 1 / Math.sqrt(2 * omega)
  const psi = gaussianPacket(grid, {
    x0: displacement,
    k0: 0,
    sigma: groundWidth * widthRatio,
  })
  const density = probabilityDensity(psi)
  let peak = 0
  for (let i = 0; i < grid.n; i++) peak = Math.max(peak, density[i])
  return {
    psi,
    prop: new SplitStepPropagator(grid, potential, { dt: DT }),
    density,
    time: 0,
    peak: peak > 0 ? peak : 1,
    amplitude: displacement,
    omega,
    trace: [],
  }
}

export default function CoherentStateLab({
  grid,
  potential,
  omega,
  displacement,
  widthRatio,
  running,
  resetKey,
  stepRequest,
  onStats,
  className = '',
}: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const sizeRef = useRef({ w: 0, h: 0 })
  const simRef = useRef<Sim | null>(null)
  const loopRef = useRef<FrameLoop | null>(null)
  const lastEmitRef = useRef(0)

  const propsRef = useRef({ grid, potential, omega, displacement, widthRatio, running })
  propsRef.current = { grid, potential, omega, displacement, widthRatio, running }

  const onStatsRef = useRef(onStats)
  onStatsRef.current = onStats

  // Bumped whenever the simulation must be rebuilt; the loop notices on its next frame.
  const generationRef = useRef(0)
  const builtRef = useRef(-1)
  const pendingStepsRef = useRef(0)

  useEffect(() => {
    generationRef.current += 1
    loopRef.current?.start()
  }, [grid, potential, omega, displacement, widthRatio, resetKey])

  // A manual step is the reduced-motion path through the whole demonstration, so it must
  // work whether or not the loop is animating.
  const firstStepRef = useRef(true)
  useEffect(() => {
    if (firstStepRef.current) {
      firstStepRef.current = false
      return
    }
    pendingStepsRef.current += Math.max(1, Math.round((2 * Math.PI) / omega / 16 / DT))
    loopRef.current?.start()
  }, [stepRequest, omega])

  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let colors = readVizColors(wrap)
    const reduceMotion = prefersReducedMotion()

    const ensureSim = (): Sim => {
      if (simRef.current === null || builtRef.current !== generationRef.current) {
        const p = propsRef.current
        simRef.current = buildSim(p.grid, p.potential, p.omega, p.displacement, p.widthRatio)
        builtRef.current = generationRef.current
        pendingStepsRef.current = 0
        lastEmitRef.current = 0
      }
      return simRef.current
    }

    const statsOf = (sim: Sim): CoherentStats => ({
      time: sim.time,
      meanX: expectationX(propsRef.current.grid, sim.psi),
      classicalX: sim.amplitude * Math.cos(sim.omega * sim.time),
      spread: spreadX(propsRef.current.grid, sim.psi),
      groundWidth: 1 / Math.sqrt(2 * sim.omega),
      periods: (sim.time * sim.omega) / (2 * Math.PI),
    })

    const advance = (sim: Sim, steps: number) => {
      if (steps <= 0) return
      sim.prop.advance(sim.psi, steps)
      sim.time += steps * DT
      probabilityDensity(sim.psi, sim.density)
      const quantum = expectationX(propsRef.current.grid, sim.psi)
      sim.trace.push({
        t: sim.time,
        quantum,
        classical: sim.amplitude * Math.cos(sim.omega * sim.time),
      })
      if (sim.trace.length > TRACE_POINTS) sim.trace.splice(0, sim.trace.length - TRACE_POINTS)
    }

    const onFrame = (now: number): boolean => {
      const sim = ensureSim()
      const p = propsRef.current

      const perFrame = Math.max(
        1,
        Math.round((2 * Math.PI) / p.omega / FRAMES_PER_PERIOD / DT)
      )
      if (pendingStepsRef.current > 0) {
        advance(sim, pendingStepsRef.current)
        pendingStepsRef.current = 0
      } else if (p.running && !reduceMotion) {
        advance(sim, perFrame)
      }

      if (now - lastEmitRef.current > 120) {
        lastEmitRef.current = now
        onStatsRef.current?.(statsOf(sim))
      }

      const { w, h } = sizeRef.current
      if (w > 0 && h > 0) render(ctx, sim, propsRef.current, w, h, colors)

      // Keep asking for frames only while something is actually moving.
      return p.running && !reduceMotion
    }

    const loop = createFrameLoop(window, document, domIntersectionWatcher(wrap), onFrame)
    loopRef.current = loop

    const stopTheme = watchThemeChange(() => {
      colors = readVizColors(wrap)
      loop.start()
    })

    const resize = () => {
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
    loop.start()

    return () => {
      observer.disconnect()
      stopTheme()
      loop.dispose()
      loopRef.current = null
    }
  }, [])

  // Restart the loop when `running` flips on.
  useEffect(() => {
    if (running) loopRef.current?.start()
  }, [running])

  const label =
    `A Gaussian wave packet oscillating in a harmonic potential of angular frequency ` +
    `${omega.toFixed(2)}, released from a displacement of ${displacement.toFixed(1)}. Its mean ` +
    `position is plotted against the classical cosine below the potential.`

  return (
    <div
      ref={wrapRef}
      className={`relative min-h-[400px] w-full ${className}`}
      style={{ height: 430 }}
    >
      <canvas ref={canvasRef} className="block h-full w-full" role="img" aria-label={label} />
    </div>
  )
}

function render(
  ctx: CanvasRenderingContext2D,
  sim: Sim,
  p: { grid: Grid; potential: Float64Array; omega: number; displacement: number },
  w: number,
  h: number,
  colors: VizColors
): void {
  const { grid } = p
  const traceH = Math.round((h - PAD_T - PAD_B) * TRACE_SHARE)
  const mainBottom = h - PAD_B - traceH - 16
  const plotW = Math.max(10, w - PAD_L - PAD_R)
  const plotH = Math.max(10, mainBottom - PAD_T)

  // Draw only the part of the grid the motion actually visits. The grid is wide so the
  // parabola's walls sit far outside the picture and the periodic boundary never sees any
  // amplitude; the picture wants the swing, not the empty margins.
  const groundWidth = 1 / Math.sqrt(2 * p.omega)
  const view = Math.min(
    Math.abs(grid.x[0]),
    Math.abs(p.displacement) * 1.5 + groundWidth * 6
  )
  const x0 = Math.max(grid.x[0], -view)
  const x1 = Math.min(grid.x[grid.n - 1], view)
  const iStart = Math.max(0, Math.floor((x0 - grid.x[0]) / grid.dx))
  const iEnd = Math.min(grid.n - 1, Math.ceil((x1 - grid.x[0]) / grid.dx))
  const xOf = (x: number) => PAD_L + ((x - x0) / (x1 - x0)) * plotW

  // Energy axis: tall enough to show the parabola well above the packet's own energy.
  const classicalEnergy = 0.5 * p.omega * p.omega * p.displacement * p.displacement
  const eMax = Math.max(classicalEnergy * 1.9, 0.5 * p.omega * 4)
  const yOfE = (e: number) => mainBottom - (e / eMax) * plotH

  ctx.clearRect(0, 0, w, h)
  ctx.font = '600 11px ui-monospace, SFMono-Regular, Menlo, monospace'

  // ── Parabola ────────────────────────────────────────────────────────────────
  ctx.strokeStyle = colors.amber
  ctx.lineWidth = 2
  ctx.beginPath()
  let started = false
  for (let i = iStart; i <= iEnd; i++) {
    const v = p.potential[i]
    if (v > eMax) {
      started = false
      continue
    }
    const px = xOf(grid.x[i])
    const py = yOfE(v)
    if (!started) {
      ctx.moveTo(px, py)
      started = true
    } else ctx.lineTo(px, py)
  }
  ctx.stroke()

  // ── Energy line and classical turning points ────────────────────────────────
  const turning = p.displacement
  ctx.save()
  ctx.setLineDash([5, 4])
  ctx.strokeStyle = withAlpha(colors.sky, 0.8)
  ctx.lineWidth = 1.25
  const ey = yOfE(classicalEnergy)
  ctx.beginPath()
  ctx.moveTo(xOf(-turning), ey)
  ctx.lineTo(xOf(turning), ey)
  ctx.stroke()
  ctx.restore()

  // ── |ψ|² along the bottom of the well ───────────────────────────────────────
  const densityH = plotH * 0.5
  ctx.beginPath()
  ctx.moveTo(xOf(grid.x[iStart]), mainBottom)
  for (let i = iStart; i <= iEnd; i++) {
    ctx.lineTo(xOf(grid.x[i]), mainBottom - Math.min(1.25, sim.density[i] / sim.peak) * densityH)
  }
  ctx.lineTo(xOf(grid.x[iEnd]), mainBottom)
  ctx.closePath()
  ctx.fillStyle = withAlpha(colors.violet, 0.38)
  ctx.fill()
  ctx.strokeStyle = colors.violet
  ctx.lineWidth = 1.75
  ctx.stroke()

  // ── The two markers ─────────────────────────────────────────────────────────
  const meanX = expectationX(grid, sim.psi)
  const classicalX = sim.amplitude * Math.cos(sim.omega * sim.time)

  ctx.strokeStyle = colors.teal
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(xOf(classicalX), mainBottom + 9, 6, 0, Math.PI * 2)
  ctx.stroke()

  ctx.fillStyle = colors.violet
  ctx.beginPath()
  ctx.arc(xOf(meanX), mainBottom + 9, 3.5, 0, Math.PI * 2)
  ctx.fill()

  // ── Baseline ────────────────────────────────────────────────────────────────
  ctx.strokeStyle = withAlpha(colors.inkSecondary, 0.16)
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(PAD_L, mainBottom + 0.5)
  ctx.lineTo(w - PAD_R, mainBottom + 0.5)
  ctx.stroke()

  // ── Trace: ⟨x⟩ and a·cos(ωt) over the last few periods ──────────────────────
  const traceTop = h - PAD_B - traceH
  const traceMid = traceTop + traceH / 2
  const amp = Math.max(1e-6, sim.amplitude)
  const yOfTrace = (x: number) => traceMid - (x / (amp * 1.25)) * (traceH / 2)

  ctx.strokeStyle = withAlpha(colors.inkSecondary, 0.16)
  ctx.beginPath()
  ctx.moveTo(PAD_L, traceMid + 0.5)
  ctx.lineTo(w - PAD_R, traceMid + 0.5)
  ctx.stroke()

  if (sim.trace.length > 1) {
    const first = sim.trace[0].t
    const last = sim.trace[sim.trace.length - 1].t
    const window = Math.max(1e-6, last - first)
    const tOf = (t: number) => PAD_L + ((t - first) / window) * plotW

    ctx.save()
    ctx.setLineDash([4, 3])
    ctx.strokeStyle = colors.teal
    ctx.lineWidth = 2.5
    ctx.beginPath()
    for (let i = 0; i < sim.trace.length; i++) {
      const px = tOf(sim.trace[i].t)
      const py = yOfTrace(sim.trace[i].classical)
      if (i === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    }
    ctx.stroke()
    ctx.restore()

    ctx.strokeStyle = colors.violet
    ctx.lineWidth = 1.5
    ctx.beginPath()
    for (let i = 0; i < sim.trace.length; i++) {
      const px = tOf(sim.trace[i].t)
      const py = yOfTrace(sim.trace[i].quantum)
      if (i === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    }
    ctx.stroke()
  }

  // ── Labels ──────────────────────────────────────────────────────────────────
  ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace'
  ctx.textBaseline = 'top'
  ctx.textAlign = 'left'
  ctx.fillStyle = colors.violetText
  ctx.fillText('⟨x⟩ quantum', PAD_L, traceTop - 13)
  ctx.fillStyle = colors.tealText
  ctx.fillText('a·cos(ωt) classical', PAD_L + 92, traceTop - 13)

  ctx.fillStyle = colors.inkMuted
  ctx.textAlign = 'left'
  ctx.fillText('position x →', PAD_L, h - PAD_B + 8)
  ctx.textAlign = 'right'
  ctx.fillText('time →', w - PAD_R, h - PAD_B + 8)

  ctx.save()
  ctx.translate(13, PAD_T + plotH / 2)
  ctx.rotate(-Math.PI / 2)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = colors.inkSecondary
  ctx.fillText('energy', 0, 0)
  ctx.restore()
}
