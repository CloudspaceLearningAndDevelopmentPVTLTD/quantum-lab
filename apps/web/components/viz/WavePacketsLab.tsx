'use client'

import { useEffect, useRef } from 'react'
import {
  centeredGrid,
  expectationX,
  gaussianPacket,
  norm,
  probabilityCurrent,
  probabilityDensity,
  SplitStepPropagator,
  type Grid,
  type Wavefunction,
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
 * WavePacketsLab — a scattering sandbox on the shared split-step propagator.
 *
 * The grid is a module constant so the page can build potentials on the same x values the
 * canvas draws: 1024 points (a power of two, because the propagator transforms) spanning
 * ±60, which is long enough for the incoming packet, the barrier and both outgoing lobes
 * to be separate objects at the same time.
 *
 * ABSORBING EDGES. The FFT makes the domain a ring, so a packet that reaches one end
 * reappears at the other. A soft mask at each end swallows outgoing flux instead, and the
 * propagator books what it swallowed to the left or right of the scattering centre — which
 * is what keeps the transmitted and reflected fractions meaningful long after both lobes
 * have left the picture. Norm on the grid therefore falls toward zero on purpose; the
 * fractions are what survive.
 */

export const WP_N = 1024
export const WP_HALF_WIDTH = 60
export const WP_GRID: Grid = centeredGrid(WP_N, WP_HALF_WIDTH)
/** Integration step, and steps per animation frame. Together these set the pace. */
const DT = 0.02
const STEPS_PER_FRAME = 10
/** Frames of integration for the single static render under prefers-reduced-motion. */
const STATIC_FRAMES = 150

const PAD_L = 42
const PAD_R = 18
const PAD_T = 18
const PAD_B = 28
/** Share of the plot height given to the probability-current strip. */
const CURRENT_SHARE = 0.26

export type PacketStats = {
  transmitted: number
  reflected: number
  /** Probability still on the grid — falls as the absorbing edges eat the outgoing lobes. */
  remaining: number
  meanX: number
  time: number
}

type Props = {
  potential: Float64Array
  /** Bump whenever `potential` has been mutated or replaced. */
  potentialVersion: number
  packet: { x0: number; k0: number; sigma: number }
  running: boolean
  resetKey: number
  showCurrent: boolean
  /** Enables the potential-drawing cursor and its keyboard handling. */
  drawing: boolean
  /** World-space paint request: set V near `x` toward `energy`. */
  onPaint?: (x: number, energy: number) => void
  onStats?: (s: PacketStats) => void
  className?: string
}

type Sim = {
  psi: Wavefunction
  prop: SplitStepPropagator
  density: Float64Array
  current: Float64Array
  time: number
  peak: number
  currentPeak: number
}

const SPLIT_INDEX = Math.round(WP_N / 2)

function buildSim(potential: Float64Array, packet: Props['packet']): Sim {
  const psi = gaussianPacket(WP_GRID, packet)
  const density = probabilityDensity(psi)
  let peak = 0
  for (let i = 0; i < WP_N; i++) peak = Math.max(peak, density[i])
  return {
    psi,
    prop: new SplitStepPropagator(WP_GRID, potential, {
      dt: DT,
      absorbFraction: 0.09,
      absorbStrength: 0.45,
      splitIndex: SPLIT_INDEX,
    }),
    density,
    current: probabilityCurrent(WP_GRID, psi),
    time: 0,
    peak: peak > 0 ? peak : 1,
    currentPeak: 1e-6,
  }
}

function measure(sim: Sim): PacketStats {
  let left = sim.prop.absorbedLeft
  let right = sim.prop.absorbedRight
  for (let i = 0; i < WP_N; i++) {
    const p = sim.density[i] * WP_GRID.dx
    if (i < SPLIT_INDEX) left += p
    else right += p
  }
  const total = left + right
  return {
    transmitted: total > 0 ? right / total : 0,
    reflected: total > 0 ? left / total : 0,
    remaining: norm(sim.psi, WP_GRID.dx),
    meanX: expectationX(WP_GRID, sim.psi),
    time: sim.time,
  }
}

export default function WavePacketsLab({
  potential,
  potentialVersion,
  packet,
  running,
  resetKey,
  showCurrent,
  drawing,
  onPaint,
  onStats,
  className = '',
}: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const sizeRef = useRef({ w: 0, h: 0 })
  const simRef = useRef<Sim | null>(null)
  const loopRef = useRef<FrameLoop | null>(null)
  const lastEmitRef = useRef(0)
  const cursorRef = useRef(0)

  const propsRef = useRef({ potential, packet, running, showCurrent, drawing })
  propsRef.current = { potential, packet, running, showCurrent, drawing }

  const onStatsRef = useRef(onStats)
  onStatsRef.current = onStats
  const onPaintRef = useRef(onPaint)
  onPaintRef.current = onPaint

  const generationRef = useRef(0)
  const builtRef = useRef(-1)

  useEffect(() => {
    generationRef.current += 1
    loopRef.current?.start()
  }, [potentialVersion, packet.x0, packet.k0, packet.sigma, resetKey])

  // Redraw-only changes (the current strip, the drawing cursor) still need a frame.
  useEffect(() => {
    loopRef.current?.start()
  }, [showCurrent, drawing, running])

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
        simRef.current = buildSim(p.potential, p.packet)
        builtRef.current = generationRef.current
        lastEmitRef.current = 0
        if (reduceMotion) {
          // One long integration up front, so a reader who has asked for no motion still
          // sees the answer rather than the initial condition.
          advance(simRef.current, STATIC_FRAMES * STEPS_PER_FRAME)
        }
      }
      return simRef.current
    }

    const advance = (sim: Sim, steps: number) => {
      sim.prop.advance(sim.psi, steps)
      sim.time += steps * DT
      probabilityDensity(sim.psi, sim.density)
      probabilityCurrent(WP_GRID, sim.psi, sim.current)
      let peak = 0
      for (let i = 0; i < WP_N; i++) peak = Math.max(peak, Math.abs(sim.current[i]))
      // The current scale ratchets up and then decays slowly, so the strip does not
      // flicker its own axis while the packet moves.
      sim.currentPeak = Math.max(peak, sim.currentPeak * 0.995)
    }

    const onFrame = (now: number): boolean => {
      const sim = ensureSim()
      const p = propsRef.current
      const animate = p.running && !reduceMotion
      if (animate) advance(sim, STEPS_PER_FRAME)

      if (now - lastEmitRef.current > 150) {
        lastEmitRef.current = now
        onStatsRef.current?.(measure(sim))
      }

      const { w, h } = sizeRef.current
      if (w > 0 && h > 0) render(ctx, sim, p, cursorRef.current, w, h, colors)
      return animate
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

    // ── Pointer drawing ──────────────────────────────────────────────────────
    const worldFromEvent = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      const { w, h } = sizeRef.current
      const geom = geometry(w, h, propsRef.current.showCurrent)
      const fx = (event.clientX - rect.left - PAD_L) / Math.max(1, geom.plotW)
      const x = WP_GRID.x[0] + fx * (WP_GRID.x[WP_N - 1] - WP_GRID.x[0])
      const scale = energyScale(propsRef.current.potential, propsRef.current.packet)
      const fy = (geom.mainBottom - (event.clientY - rect.top)) / Math.max(1, geom.mainH)
      return { x, energy: scale.floor + fy * (scale.ceiling - scale.floor) }
    }

    let painting = false
    const onPointerDown = (event: PointerEvent) => {
      if (!propsRef.current.drawing || !onPaintRef.current) return
      painting = true
      canvas.setPointerCapture(event.pointerId)
      const { x, energy } = worldFromEvent(event)
      cursorRef.current = x
      onPaintRef.current(x, energy)
      event.preventDefault()
    }
    const onPointerMove = (event: PointerEvent) => {
      if (!painting || !propsRef.current.drawing || !onPaintRef.current) return
      const { x, energy } = worldFromEvent(event)
      cursorRef.current = x
      onPaintRef.current(x, energy)
    }
    const onPointerUp = (event: PointerEvent) => {
      if (!painting) return
      painting = false
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
    }
    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('pointercancel', onPointerUp)

    // ── Keyboard drawing ─────────────────────────────────────────────────────
    // The same edits the pointer makes, reachable from the keyboard: left/right walk a
    // cursor along the axis, up/down raise and lower the potential under it. Without this
    // the drawing feature would be mouse-only, which is not a feature, it is an exclusion.
    const onKeyDown = (event: KeyboardEvent) => {
      if (!propsRef.current.drawing || !onPaintRef.current) return
      const span = WP_GRID.x[WP_N - 1] - WP_GRID.x[0]
      const stepX = span / 80
      const index = Math.round((cursorRef.current - WP_GRID.x[0]) / WP_GRID.dx)
      const here = propsRef.current.potential[Math.max(0, Math.min(WP_N - 1, index))] ?? 0
      const scale = energyScale(propsRef.current.potential, propsRef.current.packet)
      const stepE = (scale.ceiling - scale.floor) / 24

      switch (event.key) {
        case 'ArrowLeft':
          cursorRef.current = Math.max(WP_GRID.x[0], cursorRef.current - stepX)
          break
        case 'ArrowRight':
          cursorRef.current = Math.min(WP_GRID.x[WP_N - 1], cursorRef.current + stepX)
          break
        case 'ArrowUp':
          onPaintRef.current(cursorRef.current, here + stepE)
          break
        case 'ArrowDown':
          onPaintRef.current(cursorRef.current, here - stepE)
          break
        case 'Home':
          cursorRef.current = WP_GRID.x[0]
          break
        case 'End':
          cursorRef.current = WP_GRID.x[WP_N - 1]
          break
        default:
          return
      }
      event.preventDefault()
      loop.start()
    }
    canvas.addEventListener('keydown', onKeyDown)

    const observer = new ResizeObserver(resize)
    observer.observe(wrap)
    resize()
    loop.start()

    return () => {
      observer.disconnect()
      stopTheme()
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerUp)
      canvas.removeEventListener('keydown', onKeyDown)
      loop.dispose()
      loopRef.current = null
    }
  }, [])

  useEffect(() => {
    if (running) loopRef.current?.start()
  }, [running])

  const energy = (packet.k0 * packet.k0) / 2
  const label =
    `A Gaussian wave packet of mean energy ${energy.toFixed(2)} moving right along a potential ` +
    `landscape, with its probability density and probability current plotted. ` +
    (drawing
      ? 'Potential drawing is on: arrow left and right to move the cursor, up and down to raise and lower the potential under it.'
      : '')

  return (
    <div
      ref={wrapRef}
      className={`relative min-h-[400px] w-full ${className}`}
      style={{ height: 440 }}
    >
      <canvas
        ref={canvasRef}
        className={`focus-ring block h-full w-full rounded ${drawing ? 'cursor-crosshair' : ''}`}
        role={drawing ? 'application' : 'img'}
        tabIndex={drawing ? 0 : undefined}
        aria-label={label}
      />
    </div>
  )
}

/** Vertical layout of the two panels, shared by the renderer and the pointer mapping. */
function geometry(w: number, h: number, showCurrent: boolean) {
  const plotW = Math.max(10, w - PAD_L - PAD_R)
  const bottom = h - PAD_B
  const total = Math.max(10, bottom - PAD_T)
  const currentH = showCurrent ? Math.round(total * CURRENT_SHARE) : 0
  const mainH = Math.max(10, total - currentH - (showCurrent ? 14 : 0))
  return { plotW, mainH, currentH, mainBottom: PAD_T + mainH, bottom }
}

/** The energy window the main panel covers, from the potential and the packet's energy. */
function energyScale(potential: Float64Array, packet: { k0: number }) {
  const energy = (packet.k0 * packet.k0) / 2
  let vMin = 0
  let vMax = 0
  for (let i = 0; i < potential.length; i++) {
    if (potential[i] < vMin) vMin = potential[i]
    if (potential[i] > vMax) vMax = potential[i]
  }
  const ceiling = Math.max(vMax * 1.35, energy * 1.9, 0.6)
  const floor = Math.min(vMin * 1.25, 0)
  return { floor, ceiling }
}

function render(
  ctx: CanvasRenderingContext2D,
  sim: Sim,
  p: { potential: Float64Array; packet: { x0: number; k0: number; sigma: number }; showCurrent: boolean; drawing: boolean },
  cursorX: number,
  w: number,
  h: number,
  colors: VizColors
): void {
  const geom = geometry(w, h, p.showCurrent)
  const { plotW, mainBottom, mainH } = geom
  const x0 = WP_GRID.x[0]
  const x1 = WP_GRID.x[WP_N - 1]
  const xOf = (x: number) => PAD_L + ((x - x0) / (x1 - x0)) * plotW

  const scale = energyScale(p.potential, p.packet)
  const yOfE = (e: number) =>
    mainBottom - ((e - scale.floor) / (scale.ceiling - scale.floor)) * mainH

  ctx.clearRect(0, 0, w, h)
  ctx.font = '600 11px ui-monospace, SFMono-Regular, Menlo, monospace'

  // ── Zero-energy baseline ────────────────────────────────────────────────────
  const zeroY = yOfE(0)
  ctx.strokeStyle = withAlpha(colors.inkSecondary, 0.16)
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(PAD_L, zeroY + 0.5)
  ctx.lineTo(w - PAD_R, zeroY + 0.5)
  ctx.stroke()

  // ── Potential, filled to the baseline ───────────────────────────────────────
  ctx.beginPath()
  ctx.moveTo(xOf(x0), zeroY)
  for (let i = 0; i < WP_N; i++) ctx.lineTo(xOf(WP_GRID.x[i]), yOfE(p.potential[i]))
  ctx.lineTo(xOf(x1), zeroY)
  ctx.closePath()
  ctx.fillStyle = withAlpha(colors.amber, 0.16)
  ctx.fill()
  ctx.beginPath()
  for (let i = 0; i < WP_N; i++) {
    const px = xOf(WP_GRID.x[i])
    const py = yOfE(p.potential[i])
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.strokeStyle = colors.amber
  ctx.lineWidth = 1.75
  ctx.stroke()

  // ── The packet's mean energy ────────────────────────────────────────────────
  const energy = (p.packet.k0 * p.packet.k0) / 2
  const ey = yOfE(energy)
  ctx.save()
  ctx.setLineDash([5, 4])
  ctx.strokeStyle = colors.sky
  ctx.lineWidth = 1.25
  ctx.beginPath()
  ctx.moveTo(PAD_L, ey + 0.5)
  ctx.lineTo(w - PAD_R, ey + 0.5)
  ctx.stroke()
  ctx.restore()
  ctx.fillStyle = colors.skyText
  ctx.textAlign = 'left'
  ctx.textBaseline = 'bottom'
  ctx.fillText(`E ${energy.toFixed(2)}`, PAD_L + 3, ey - 4)

  // ── Re ψ, faint, so the wavelength and its decay inside a barrier are visible ──
  const ampScale = Math.sqrt(sim.peak)
  const midY = mainBottom - mainH * 0.28
  ctx.strokeStyle = withAlpha(colors.teal, 0.32)
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let i = 0; i < WP_N; i++) {
    const y = midY - (sim.psi.re[i] / ampScale) * mainH * 0.16
    if (i === 0) ctx.moveTo(xOf(WP_GRID.x[i]), y)
    else ctx.lineTo(xOf(WP_GRID.x[i]), y)
  }
  ctx.stroke()

  // ── |ψ|² ────────────────────────────────────────────────────────────────────
  const densityH = mainH * 0.55
  ctx.beginPath()
  ctx.moveTo(xOf(x0), mainBottom)
  for (let i = 0; i < WP_N; i++) {
    ctx.lineTo(xOf(WP_GRID.x[i]), mainBottom - Math.min(1.2, sim.density[i] / sim.peak) * densityH)
  }
  ctx.lineTo(xOf(x1), mainBottom)
  ctx.closePath()
  ctx.fillStyle = withAlpha(colors.violet, 0.36)
  ctx.fill()
  ctx.beginPath()
  for (let i = 0; i < WP_N; i++) {
    const y = mainBottom - Math.min(1.2, sim.density[i] / sim.peak) * densityH
    if (i === 0) ctx.moveTo(xOf(WP_GRID.x[i]), y)
    else ctx.lineTo(xOf(WP_GRID.x[i]), y)
  }
  ctx.strokeStyle = colors.violet
  ctx.lineWidth = 1.75
  ctx.stroke()

  // ── Drawing cursor ──────────────────────────────────────────────────────────
  if (p.drawing) {
    const cx = xOf(Math.max(x0, Math.min(x1, cursorX)))
    ctx.save()
    ctx.setLineDash([2, 3])
    ctx.strokeStyle = withAlpha(colors.rose, 0.7)
    ctx.lineWidth = 1.25
    ctx.beginPath()
    ctx.moveTo(cx, PAD_T)
    ctx.lineTo(cx, mainBottom)
    ctx.stroke()
    ctx.restore()
  }

  // ── Probability current ─────────────────────────────────────────────────────
  if (p.showCurrent && geom.currentH > 0) {
    const top = mainBottom + 14
    const mid = top + geom.currentH / 2
    const half = geom.currentH / 2
    const peak = Math.max(sim.currentPeak, 1e-9)

    ctx.strokeStyle = withAlpha(colors.inkSecondary, 0.16)
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(PAD_L, mid + 0.5)
    ctx.lineTo(w - PAD_R, mid + 0.5)
    ctx.stroke()

    const yOfJ = (j: number) => mid - Math.max(-1, Math.min(1, j / peak)) * half * 0.92

    // Split the fill at zero: rightward flow reads sky, leftward flow reads rose, so a
    // reflected lobe is visible as current that has changed sign rather than as a lump
    // that happens to be on the left.
    for (const sign of [1, -1]) {
      ctx.beginPath()
      ctx.moveTo(xOf(x0), mid)
      for (let i = 0; i < WP_N; i++) {
        const j = sim.current[i]
        const clipped = sign > 0 ? Math.max(0, j) : Math.min(0, j)
        ctx.lineTo(xOf(WP_GRID.x[i]), yOfJ(clipped))
      }
      ctx.lineTo(xOf(x1), mid)
      ctx.closePath()
      ctx.fillStyle = withAlpha(sign > 0 ? colors.sky : colors.rose, 0.45)
      ctx.fill()
    }

    ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace'
    ctx.textAlign = 'right'
    ctx.textBaseline = 'top'
    ctx.fillStyle = colors.inkMuted
    ctx.fillText('j(x)  → sky, ← rose', w - PAD_R, top - 12)
  }

  // ── Axis captions ───────────────────────────────────────────────────────────
  ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace'
  ctx.textBaseline = 'top'
  ctx.textAlign = 'left'
  ctx.fillStyle = colors.inkMuted
  ctx.fillText('position x →', PAD_L, geom.bottom + 8)
  ctx.textAlign = 'center'
  ctx.fillStyle = colors.violetText
  ctx.fillText('|ψ|²', w / 2, geom.bottom + 8)
  ctx.textAlign = 'right'
  ctx.fillStyle = colors.amberText
  ctx.fillText('V(x)', w - PAD_R, geom.bottom + 8)
}
