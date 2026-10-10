'use client'

import { useEffect, useMemo, useRef } from 'react'
import {
  addBarrenSample,
  barrenGradientSample,
  barrenVariance,
  newBarrenAccumulator,
  newLandscapeJob,
  optimiserStep,
  startOptimiser,
  stepLandscape,
  type BarrenAccumulator,
  type Ising,
  type LandscapeJob,
  type OptimiserState,
} from './vqe/landscape'
import { mixColors, readVizColors, withAlpha, type VizColors } from './theme'
import {
  createFrameLoop,
  domIntersectionWatcher,
  prefersReducedMotion,
  watchThemeChange,
  type FrameLoop,
} from './frameLoop'
import { mulberry32 } from '@/lib/quantum'

/**
 * VQELab — two panels sharing one frame loop.
 *
 * LEFT   The energy landscape E(θ, φ) of the shared-parameter ansatz over the full
 *        2π × 2π torus, computed cell by cell (a real statevector simulation per
 *        cell), with the optimiser's trail drawn on top as it descends.
 * RIGHT  Var[∂(E/n)/∂θ] against qubit count, on a log axis, accumulating live from
 *        parameter-shift gradients of random deep RY–CZ–RX circuits. This is the
 *        barren plateau, measured rather than asserted. The RX sublayer is load
 *        bearing and not decoration — see barrenGradientSample's header.
 *
 * MEASURED cost, in node, running the same functions the loop calls (48 × 48 grid,
 * 3 layers, whole map timed and divided by frames):
 *   landscape, 4 rows/frame   n = 4: 1.83 ms/frame   n = 6: 2.01   n = 8: 9.37
 *   barren, 1 sample each of widths 2/4/6/8/10:      4.52 ms/frame
 * (was 1.86 ms before the RX sublayer was restored to the barren ansatz: it adds n
 * more gates per layer and roughly doubles the work. 4.52 + the 2.3 ms landscape row
 * at n = 8 still sits inside a 16.7 ms frame.)
 * 9.37 ms is over a frame budget on its own, which is why `rowsPerFrame` drops to one
 * row at n = 8 — 2.3 ms, at the cost of the map taking 48 frames instead of 12 to
 * fill. Both jobs stop on their own: the landscape when it is full, the barren
 * columns when the caller stops them. Neither runs while the canvas is off-screen or
 * the tab is hidden — see frameLoop.ts.
 *
 * The landscape is rebuilt from scratch whenever n, J, h or the layer count changes,
 * which is why those controls are a segmented picker rather than a slider: dragging a
 * slider would queue a full recomputation on every intermediate value.
 */

/**
 * Landscape rows per frame, chosen to keep one frame near 2 ms at every width.
 * Cost per row is O(size · 2^n · layers · n), so it roughly quadruples per two qubits.
 */
function rowsPerFrame(n: number): number {
  if (n <= 6) return 4
  if (n === 7) return 2
  return 1
}
/** Grid resolution per axis. 48² = 2304 statevector simulations for a full map. */
export const LANDSCAPE_SIZE = 48
/** Qubit counts the barren-plateau panel samples. */
export const BARREN_WIDTHS: readonly number[] = [2, 4, 6, 8, 10]
const EMIT_MS = 200

export type VQEStats = {
  optimiser: {
    theta: number
    phi: number
    energy: number
    step: number
    converged: boolean
  }
  /** 0..1 while the landscape is filling. */
  landscapeProgress: number
  landscapeMin: number
  /** Var[∂(E/n)/∂θ] and sample count per width, in BARREN_WIDTHS order. */
  barren: { n: number; variance: number; samples: number }[]
}

type Props = {
  model: Ising
  layers: number
  /** Where the optimiser starts. Changing either restarts it. */
  startTheta: number
  startPhi: number
  /** When true the loop takes gradient-descent steps. */
  optimising: boolean
  /** When true the loop accumulates barren-plateau gradient samples. */
  barrenRunning: boolean
  /** Bump to clear the optimiser trail and the barren accumulators. */
  resetKey: number
  /** Called when the learner clicks a point on the landscape. */
  onPick?: (theta: number, phi: number) => void
  onStats?: (s: VQEStats) => void
  className?: string
}

const PAD = 34
const SPLIT = 0.62

export default function VQELab({
  model,
  layers,
  startTheta,
  startPhi,
  optimising,
  barrenRunning,
  resetKey,
  onPick,
  onStats,
  className = '',
}: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const sizeRef = useRef({ w: 0, h: 0 })
  const loopRef = useRef<FrameLoop | null>(null)

  const propsRef = useRef({ model, layers, startTheta, startPhi, optimising, barrenRunning })
  propsRef.current = { model, layers, startTheta, startPhi, optimising, barrenRunning }
  const onStatsRef = useRef(onStats)
  onStatsRef.current = onStats
  const onPickRef = useRef(onPick)
  onPickRef.current = onPick

  const landscapeGeneration = useRef(0)
  const optimiserGeneration = useRef(0)
  const barrenGeneration = useRef(0)

  useEffect(() => {
    landscapeGeneration.current += 1
    optimiserGeneration.current += 1
    loopRef.current?.start()
  }, [model, layers])

  useEffect(() => {
    optimiserGeneration.current += 1
    loopRef.current?.start()
  }, [startTheta, startPhi, resetKey])

  useEffect(() => {
    barrenGeneration.current += 1
    loopRef.current?.start()
  }, [resetKey])

  useEffect(() => {
    loopRef.current?.start()
  }, [optimising, barrenRunning])

  const jobRef = useRef<LandscapeJob | null>(null)
  const optRef = useRef<OptimiserState | null>(null)
  const barrenRef = useRef<BarrenAccumulator[]>([])

  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const reduceMotion = prefersReducedMotion()
    let colors = readVizColors(wrap)
    let rand = mulberry32(0x1d872b41)
    let builtLandscape = -1
    let builtOptimiser = -1
    let builtBarren = -1
    let lastEmit = 0

    const onFrame = (now: number): boolean => {
      const live = propsRef.current
      let more = false

      if (builtLandscape !== landscapeGeneration.current) {
        jobRef.current = newLandscapeJob(live.model, live.layers, LANDSCAPE_SIZE)
        builtLandscape = landscapeGeneration.current
      }
      if (builtOptimiser !== optimiserGeneration.current) {
        optRef.current = startOptimiser(live.model, live.layers, live.startTheta, live.startPhi)
        builtOptimiser = optimiserGeneration.current
      }
      if (builtBarren !== barrenGeneration.current) {
        barrenRef.current = BARREN_WIDTHS.map((n) => newBarrenAccumulator(n))
        rand = mulberry32(0x1d872b41 ^ (barrenGeneration.current * 40503))
        builtBarren = barrenGeneration.current
      }

      const job = jobRef.current
      if (job && job.rowsDone < job.size) {
        // Under reduced motion, finish the map in one pass rather than animating it
        // in: the map is information, the sweep is decoration.
        const rows = reduceMotion ? job.size : rowsPerFrame(live.model.n)
        if (stepLandscape(job, rows)) more = true
      }

      if (live.optimising && optRef.current && !optRef.current.converged) {
        optRef.current = optimiserStep(optRef.current, live.model, live.layers)
        if (!optRef.current.converged) more = true
      }

      if (live.barrenRunning) {
        for (const acc of barrenRef.current) {
          addBarrenSample(acc, barrenGradientSample({ ...live.model, n: acc.n }, rand))
        }
        if (!reduceMotion) more = true
      }

      if (now - lastEmit > EMIT_MS) {
        lastEmit = now
        onStatsRef.current?.(collectStats())
      }

      const { w, h } = sizeRef.current
      if (w > 0 && h > 0) {
        render(ctx, live.model, jobRef.current, optRef.current, barrenRef.current, w, h, colors)
      }
      return more
    }

    const collectStats = (): VQEStats => {
      const job = jobRef.current
      const opt = optRef.current
      return {
        optimiser: {
          theta: opt?.theta ?? 0,
          phi: opt?.phi ?? 0,
          energy: opt?.energy ?? NaN,
          step: opt?.step ?? 0,
          converged: opt?.converged ?? false,
        },
        landscapeProgress: job ? job.rowsDone / job.size : 0,
        landscapeMin: job && Number.isFinite(job.min) ? job.min : NaN,
        barren: barrenRef.current.map((acc) => ({
          n: acc.n,
          variance: barrenVariance(acc),
          samples: acc.samples,
        })),
      }
    }

    const loop = createFrameLoop(window, document, domIntersectionWatcher(wrap), onFrame)
    loopRef.current = loop

    const repaint = (): void => {
      const { w, h } = sizeRef.current
      if (w > 0 && h > 0) {
        render(
          ctx,
          propsRef.current.model,
          jobRef.current,
          optRef.current,
          barrenRef.current,
          w,
          h,
          colors
        )
      }
    }

    const stopTheme = watchThemeChange(() => {
      colors = readVizColors(wrap)
      repaint()
    })

    // Clicking the map picks a starting point. The same value is reachable from the
    // θ₀ and φ₀ sliders in the controls rail, so this is a shortcut and not the only
    // route — a canvas click handler on its own is not a keyboard-accessible control.
    const onClick = (event: MouseEvent): void => {
      const { w, h } = sizeRef.current
      const rect = canvas.getBoundingClientRect()
      const x = event.clientX - rect.left
      const y = event.clientY - rect.top
      const mapW = Math.max(10, w * SPLIT - PAD * 1.5)
      const mapH = Math.max(10, h - PAD * 1.6)
      const relX = (x - PAD) / mapW
      const relY = (y - PAD * 0.8) / mapH
      if (relX < 0 || relX > 1 || relY < 0 || relY > 1) return
      onPickRef.current?.(relX * 2 * Math.PI, relY * 2 * Math.PI)
    }
    canvas.addEventListener('click', onClick)

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
      canvas.removeEventListener('click', onClick)
      stopTheme()
      loop.dispose()
      loopRef.current = null
    }
  }, [])

  const label = useMemo(
    () =>
      `Energy landscape of a ${layers}-layer ansatz on a ${model.n}-qubit transverse-field ` +
      `Ising chain with J equals ${model.J} and h equals ${model.h}, drawn over both shared ` +
      `parameters from 0 to 2 pi. Dark regions are low energy. The optimiser's trail runs ` +
      `downhill from the chosen start. Beside it, the variance of the energy gradient ` +
      `against qubit count on a logarithmic axis — the bars shrink as qubits are added, ` +
      `which is the barren plateau. Exact figures are in the tables below this canvas.`,
    [layers, model.n, model.J, model.h]
  )

  return (
    <div ref={wrapRef} className={`relative w-full ${className}`} style={{ height: 460 }}>
      <canvas ref={canvasRef} className="block h-full w-full" role="img" aria-label={label} />
    </div>
  )
}

function render(
  ctx: CanvasRenderingContext2D,
  model: Ising,
  job: LandscapeJob | null,
  opt: OptimiserState | null,
  barren: BarrenAccumulator[],
  w: number,
  h: number,
  colors: VizColors
): void {
  ctx.clearRect(0, 0, w, h)

  const mapX = PAD
  const mapY = PAD * 0.8
  const mapW = Math.max(10, w * SPLIT - PAD * 1.5)
  const mapH = Math.max(10, h - PAD * 1.6)

  const mono = '10px ui-monospace, SFMono-Regular, Menlo, monospace'
  const monoBold = '600 11px ui-monospace, SFMono-Regular, Menlo, monospace'

  // ── The landscape ──
  if (job) {
    const size = job.size
    const cellW = mapW / size
    const cellH = mapH / size
    const lo = Number.isFinite(job.min) ? job.min : 0
    const hi = Number.isFinite(job.max) ? job.max : 1
    const span = hi - lo || 1
    for (let row = 0; row < job.rowsDone; row++) {
      for (let col = 0; col < size; col++) {
        const v = job.values[row * size + col]
        if (Number.isNaN(v)) continue
        const t = (v - lo) / span
        // Low energy (what we want) reads teal; high energy reads amber, through
        // violet in the middle. Three stops, so the mid-range is not a mud colour.
        const color =
          t < 0.5
            ? mixColors(colors.teal, colors.violet, t * 2)
            : mixColors(colors.violet, colors.amber, (t - 0.5) * 2)
        ctx.fillStyle = color
        ctx.fillRect(mapX + col * cellW, mapY + row * cellH, cellW + 0.6, cellH + 0.6)
      }
    }
    // Unfilled rows read as the page background, so mark the frontier.
    if (job.rowsDone < size) {
      ctx.strokeStyle = withAlpha(colors.inkSecondary, 0.4)
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(mapX, mapY + job.rowsDone * cellH + 0.5)
      ctx.lineTo(mapX + mapW, mapY + job.rowsDone * cellH + 0.5)
      ctx.stroke()
    }
  }

  ctx.strokeStyle = withAlpha(colors.inkSecondary, 0.25)
  ctx.lineWidth = 1
  ctx.strokeRect(mapX + 0.5, mapY + 0.5, mapW, mapH)

  // ── The optimiser trail ──
  if (opt && job) {
    const toX = (theta: number) => mapX + (wrap2pi(theta) / (2 * Math.PI)) * mapW
    const toY = (phi: number) => mapY + (wrap2pi(phi) / (2 * Math.PI)) * mapH
    ctx.strokeStyle = colors.ink
    ctx.lineWidth = 1.75
    ctx.beginPath()
    opt.path.forEach((p, i) => {
      const x = toX(p.theta)
      const y = toY(p.phi)
      // A step that wraps across the edge of the torus would otherwise draw a line
      // straight across the whole map.
      if (i === 0) ctx.moveTo(x, y)
      else {
        const prev = opt.path[i - 1]
        const jumped =
          Math.abs(wrap2pi(p.theta) - wrap2pi(prev.theta)) > Math.PI ||
          Math.abs(wrap2pi(p.phi) - wrap2pi(prev.phi)) > Math.PI
        if (jumped) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
    })
    ctx.stroke()

    const head = opt.path[opt.path.length - 1]
    ctx.beginPath()
    ctx.arc(toX(head.theta), toY(head.phi), 4.5, 0, Math.PI * 2)
    ctx.fillStyle = opt.converged ? colors.rose : colors.ink
    ctx.fill()
    ctx.strokeStyle = colors.surface2
    ctx.lineWidth = 1.5
    ctx.stroke()
  }

  // ── Map axes ──
  ctx.font = mono
  ctx.fillStyle = colors.inkMuted
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.fillText('θ  0 → 2π', mapX + mapW / 2, mapY + mapH + 6)
  ctx.save()
  ctx.translate(mapX - 8, mapY + mapH / 2)
  ctx.rotate(-Math.PI / 2)
  ctx.textBaseline = 'bottom'
  ctx.fillText('φ  0 → 2π', 0, 0)
  ctx.restore()

  ctx.font = monoBold
  ctx.textAlign = 'left'
  ctx.textBaseline = 'bottom'
  ctx.fillStyle = colors.inkSecondary
  ctx.fillText(`E(θ, φ)  ·  ${model.n} qubits`, mapX, mapY - 6)
  if (job && Number.isFinite(job.min)) {
    ctx.textAlign = 'right'
    ctx.fillStyle = colors.tealText
    ctx.fillText(`grid min ${job.min.toFixed(3)}`, mapX + mapW, mapY - 6)
  }

  // ── The barren-plateau panel ──
  const chartX = w * SPLIT + PAD * 0.4
  const chartW = Math.max(20, w - chartX - PAD * 0.6)
  const chartY = mapY + 14
  const chartH = Math.max(20, mapH - 14)

  ctx.font = monoBold
  ctx.textAlign = 'left'
  ctx.textBaseline = 'bottom'
  ctx.fillStyle = colors.inkSecondary
  ctx.fillText('Var[∂E/∂θ] per site', chartX, mapY - 6)

  const variances = barren.map((acc) => barrenVariance(acc))
  const positive = variances.filter((v) => v > 0)
  if (positive.length > 0) {
    // Log axis: the whole claim is that this spans orders of magnitude, and a linear
    // axis would render everything past the second column as an invisible sliver.
    const maxLog = Math.log10(Math.max(...positive))
    const minLog = Math.min(...positive.map((v) => Math.log10(v)))
    const floor = Math.min(minLog, maxLog - 1) - 0.4
    const slot = chartW / barren.length
    for (let i = 0; i < barren.length; i++) {
      const v = variances[i]
      const x = chartX + i * slot + slot * 0.16
      const bw = slot * 0.68
      if (v > 0) {
        const t = (Math.log10(v) - floor) / (maxLog - floor || 1)
        const bh = Math.max(1, t * chartH)
        ctx.fillStyle = mixColors(colors.rose, colors.teal, t)
        ctx.fillRect(x, chartY + chartH - bh, bw, bh)
      }
      ctx.font = mono
      ctx.fillStyle = colors.inkMuted
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.fillText(`${barren[i].n}q`, x + bw / 2, chartY + chartH + 5)
      if (v > 0) {
        ctx.textBaseline = 'bottom'
        ctx.fillStyle = colors.inkSecondary
        const t = (Math.log10(v) - floor) / (maxLog - floor || 1)
        ctx.fillText(v.toExponential(1), x + bw / 2, chartY + chartH - Math.max(1, t * chartH) - 3)
      }
    }
    ctx.font = mono
    ctx.fillStyle = colors.inkMuted
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.fillText(
      `${barren[0].samples.toLocaleString('en-US')} samples · depth 2n · log scale`,
      chartX,
      chartY + chartH + 20
    )
  } else {
    ctx.font = mono
    ctx.fillStyle = colors.inkMuted
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.fillText('Not sampling yet.', chartX, chartY + 4)
  }

  // ── Colour scale for the map ──
  if (job && Number.isFinite(job.min)) {
    const barY = h - PAD * 0.55
    const barW = mapW * 0.5
    for (let i = 0; i < barW; i++) {
      const t = i / barW
      ctx.fillStyle =
        t < 0.5
          ? mixColors(colors.teal, colors.violet, t * 2)
          : mixColors(colors.violet, colors.amber, (t - 0.5) * 2)
      ctx.fillRect(mapX + i, barY, 1.5, 6)
    }
    ctx.font = mono
    ctx.fillStyle = colors.inkMuted
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.fillText(job.min.toFixed(2), mapX, barY + 8)
    ctx.textAlign = 'right'
    ctx.fillText(job.max.toFixed(2), mapX + barW, barY + 8)
  }
}

function wrap2pi(a: number): number {
  return ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
}
