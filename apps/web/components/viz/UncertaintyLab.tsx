'use client'

import { useEffect, useMemo, useRef } from 'react'
import {
  HBAR,
  UNCERTAINTY_FLOOR,
  analyze,
  freeEvolve,
  gridAdvice,
  makeGrid,
  makePacket,
  type Analysis,
  type Grid,
  type PacketShape,
} from '@/lib/viz/uncertainty'
import { readVizColors, withAlpha, type VizColors } from './theme'
import {
  createFrameLoop,
  domIntersectionWatcher,
  prefersReducedMotion,
  watchThemeChange,
  type FrameLoop,
} from './frameLoop'

/**
 * UncertaintyLab — the same wavefunction, seen twice.
 *
 * TOP     |ψ(x)|², with the ±σx band shaded and the real part of ψ drawn faintly
 *         over it so the phase structure (a chirp, a boost) is visible rather
 *         than hidden inside a modulus.
 * BOTTOM  |φ(p)|², the actual discrete Fourier transform of that same array,
 *         with its own ±σp band. Nothing is fitted and nothing is assumed: the
 *         second panel is computed from the first, every frame.
 * FOOTER  σx·σp against the ħ/2 floor, as a bar that cannot cross the line.
 *
 * The floor is never enforced anywhere in the code — it is not clamped, and no
 * shape is special-cased. It holds because it is a theorem about the transform,
 * and lib/viz/uncertainty.test.ts checks the numbers against the harmonic
 * oscillator ladder and the free-spreading law rather than against themselves.
 */

export const GRID_POINTS = 1024
export const BOX_LENGTH = 40

export type UncertaintyStats = {
  sigmaX: number
  sigmaP: number
  product: number
  /** σx·σp in units of ħ/2. Exactly 1 for an unchirped Gaussian at rest. */
  ratio: number
  meanP: number
  /** Elapsed free-evolution time. */
  t: number
  warning: string | null
}

export type UncertaintyLabProps = {
  shape: PacketShape
  width: number
  k0: number
  chirp: number
  /** When true, the packet is released and evolves as a free particle. */
  evolving: boolean
  /** Bump to return to t = 0. */
  resetKey: number
  onStats?: (s: UncertaintyStats) => void
  className?: string
}

const EMIT_MS = 110
/** Simulation time per screen second while the packet is released. */
const EVOLVE_RATE = 1.1

export default function UncertaintyLab({
  shape,
  width,
  k0,
  chirp,
  evolving,
  resetKey,
  onStats,
  className = '',
}: UncertaintyLabProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const sizeRef = useRef({ w: 0, h: 0 })
  const loopRef = useRef<FrameLoop | null>(null)

  const live = useRef({ shape, width, k0, chirp, evolving })
  live.current = { shape, width, k0, chirp, evolving }
  const onStatsRef = useRef(onStats)
  onStatsRef.current = onStats

  const specGen = useRef(0)
  useEffect(() => {
    specGen.current += 1
    loopRef.current?.start()
  }, [shape, width, k0, chirp, resetKey])

  useEffect(() => {
    loopRef.current?.start()
  }, [evolving])

  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const reduceMotion = prefersReducedMotion()
    let colors = readVizColors(wrap)
    const grid: Grid = makeGrid(GRID_POINTS, BOX_LENGTH)

    let built = -1
    let t = 0
    let lastFrameMs = 0
    let lastEmit = 0
    let analysis: Analysis | null = null

    const rebuild = (): void => {
      const s = live.current
      const psi0 = makePacket(grid, { shape: s.shape, width: s.width, k0: s.k0, chirp: s.chirp })
      const psi = t === 0 ? psi0 : freeEvolve(grid, psi0, t)
      analysis = analyze(grid, psi)
    }

    const onFrame = (now: number): boolean => {
      const s = live.current
      if (built !== specGen.current) {
        built = specGen.current
        t = 0
        lastFrameMs = 0
      }

      const dtScreen = lastFrameMs === 0 ? 0 : Math.min(0.05, (now - lastFrameMs) / 1000)
      lastFrameMs = now
      // The box is periodic, so a packet that reaches the wall wraps around and
      // every number under it becomes meaningless. Freeze at the wall and say
      // so, rather than animating a packet eating its own tail.
      const room = analysis === null || gridAdvice(grid, analysis).ok
      const advancing = s.evolving && dtScreen > 0 && room
      if (advancing) t += dtScreen * EVOLVE_RATE

      rebuild()

      const { w, h } = sizeRef.current
      if (w > 0 && h > 0 && analysis) draw(ctx, w, h, colors, analysis, t, reduceMotion)

      if (analysis && now - lastEmit > EMIT_MS) {
        lastEmit = now
        const advice = gridAdvice(grid, analysis)
        onStatsRef.current?.({
          sigmaX: analysis.x.sigma,
          sigmaP: analysis.p.sigma,
          product: analysis.product,
          ratio: analysis.ratio,
          meanP: analysis.p.mean,
          t,
          warning: advice.message,
        })
      }

      return advancing
    }

    const loop = createFrameLoop(window, document, domIntersectionWatcher(wrap), onFrame)
    loopRef.current = loop

    const repaint = (): void => {
      const { w, h } = sizeRef.current
      rebuild()
      if (w > 0 && h > 0 && analysis) draw(ctx, w, h, colors, analysis, t, reduceMotion)
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
    () =>
      `Two stacked plots of the same quantum state: the probability density in position, ` +
      `a ${shape} packet of width ${width.toFixed(2)}, and below it the probability density ` +
      `in momentum, computed as its Fourier transform. Each is shaded across one standard ` +
      `deviation. A bar underneath compares their product with the h-bar over two floor. ` +
      `The exact numbers are in the readouts beside this canvas.`,
    [shape, width]
  )

  return (
    <div ref={wrapRef} className={`relative w-full ${className}`} style={{ height: 440 }}>
      <canvas ref={canvasRef} className="block h-full w-full" role="img" aria-label={label} />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Rendering
// ─────────────────────────────────────────────────────────────────────────────

const PAD_L = 40
const PAD_R = 16

/**
 * Exported for UncertaintyLab.test.ts, which drives it against a recording stub
 * context. See the note on SpinPrecessionLab.draw.
 */
export function draw(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  colors: VizColors,
  a: Analysis,
  t: number,
  reduceMotion: boolean
): void {
  ctx.clearRect(0, 0, w, h)
  const meterH = 62
  const gap = 22
  const panelH = Math.max(50, (h - meterH - gap * 2 - 18) / 2)

  drawPanel(ctx, {
    x: PAD_L,
    y: 16,
    w: Math.max(20, w - PAD_L - PAD_R),
    h: panelH,
    colors,
    coords: a.grid.x,
    prob: a.positionDensity,
    step: a.grid.dx,
    mean: a.x.mean,
    sigma: a.x.sigma,
    color: colors.violet,
    textColor: colors.violetText,
    title: 'position  |ψ(x)|²',
    axis: 'x',
    sigmaLabel: `σx = ${a.x.sigma.toFixed(3)}`,
    // The real part reveals the phase winding a modulus hides — this is where a
    // chirp becomes visible as a frequency that changes across the packet.
    wave: reduceMotion ? null : a.psi.re,
    // Position is always framed on the packet; a released packet drifts and
    // spreads, so the window follows it rather than shrinking it to a dot.
    span: Math.max(4, Math.min(a.grid.L / 2, 5 * a.x.sigma)),
  })

  drawPanel(ctx, {
    x: PAD_L,
    y: 16 + panelH + gap,
    w: Math.max(20, w - PAD_L - PAD_R),
    h: panelH,
    colors,
    coords: a.grid.k,
    prob: a.momentumDensity,
    step: a.grid.dk,
    mean: a.p.mean,
    sigma: a.p.sigma,
    color: colors.teal,
    textColor: colors.tealText,
    title: 'momentum  |φ(p)|²',
    axis: 'p',
    sigmaLabel: `σp = ${a.p.sigma.toFixed(3)}`,
    wave: null,
    span: Math.max(1.2, Math.min(Math.PI / a.grid.dx, 5 * a.p.sigma)),
  })

  drawMeter(ctx, PAD_L, 16 + 2 * panelH + 2 * gap, Math.max(20, w - PAD_L - PAD_R), meterH, colors, a, t)
}

type PanelOpts = {
  x: number
  y: number
  w: number
  h: number
  colors: VizColors
  coords: Float64Array
  prob: Float64Array
  step: number
  mean: number
  sigma: number
  color: string
  textColor: string
  title: string
  axis: string
  sigmaLabel: string
  wave: Float64Array | null
  span: number
}

function drawPanel(ctx: CanvasRenderingContext2D, o: PanelOpts): void {
  const { x, y, w, h, colors } = o
  const lo = o.mean - o.span
  const hi = o.mean + o.span
  const toX = (c: number) => x + ((c - lo) / (hi - lo)) * w

  let peak = 0
  for (let i = 0; i < o.prob.length; i++) if (o.prob[i] > peak) peak = o.prob[i]
  const scale = peak > 0 ? (h - 10) / peak : 0
  const base = y + h

  // ±σ band
  ctx.fillStyle = withAlpha(o.color, 0.13)
  const bandL = toX(o.mean - o.sigma)
  const bandR = toX(o.mean + o.sigma)
  ctx.fillRect(bandL, y, Math.max(1, bandR - bandL), h)

  // Baseline
  ctx.strokeStyle = withAlpha(colors.inkSecondary, 0.25)
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(x, base + 0.5)
  ctx.lineTo(x + w, base + 0.5)
  ctx.stroke()

  // The faint real part, drawn under the density.
  if (o.wave) {
    let waveMax = 0
    for (let i = 0; i < o.wave.length; i++) waveMax = Math.max(waveMax, Math.abs(o.wave[i]))
    if (waveMax > 0) {
      ctx.beginPath()
      let started = false
      for (let i = 0; i < o.coords.length; i++) {
        const c = o.coords[i]
        if (c < lo || c > hi) continue
        const px = toX(c)
        const py = base - (h * 0.42) - (o.wave[i] / waveMax) * (h * 0.34)
        if (!started) {
          ctx.moveTo(px, py)
          started = true
        } else ctx.lineTo(px, py)
      }
      ctx.strokeStyle = withAlpha(colors.inkSecondary, 0.32)
      ctx.lineWidth = 1
      ctx.stroke()
    }
  }

  // The density itself
  ctx.beginPath()
  ctx.moveTo(toX(lo), base)
  for (let i = 0; i < o.coords.length; i++) {
    const c = o.coords[i]
    if (c < lo || c > hi) continue
    ctx.lineTo(toX(c), base - o.prob[i] * scale)
  }
  ctx.lineTo(toX(hi), base)
  ctx.closePath()
  ctx.fillStyle = withAlpha(o.color, 0.34)
  ctx.fill()
  ctx.strokeStyle = o.color
  ctx.lineWidth = 1.6
  ctx.stroke()

  // σ ticks
  ctx.strokeStyle = withAlpha(o.color, 0.7)
  ctx.setLineDash([3, 3])
  for (const c of [o.mean - o.sigma, o.mean + o.sigma]) {
    ctx.beginPath()
    ctx.moveTo(toX(c), y)
    ctx.lineTo(toX(c), base)
    ctx.stroke()
  }
  ctx.setLineDash([])

  const mono = '10px ui-monospace, SFMono-Regular, Menlo, monospace'
  ctx.font = '600 11px ui-monospace, SFMono-Regular, Menlo, monospace'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'bottom'
  ctx.fillStyle = colors.inkSecondary
  ctx.fillText(o.title, x, y - 3)
  ctx.textAlign = 'right'
  ctx.fillStyle = o.textColor
  ctx.fillText(o.sigmaLabel, x + w, y - 3)

  ctx.font = mono
  ctx.fillStyle = colors.inkMuted
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.fillText(lo.toFixed(1), x + 2, base + 4)
  ctx.fillText(hi.toFixed(1), x + w - 2, base + 4)
  ctx.fillText(o.axis, x + w / 2, base + 4)
}

/**
 * The bound, as a bar. The floor sits at ħ/2 and is drawn as a hard rose line;
 * the bar starts there rather than at zero, because the interesting quantity is
 * how far above the floor the state sits, and a bar from zero would make every
 * shape look approximately the same.
 */
function drawMeter(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  colors: VizColors,
  a: Analysis,
  t: number
): void {
  const barY = y + 22
  const barH = 16
  const maxRatio = 4
  const ratio = Math.min(maxRatio, Math.max(1, a.ratio))
  const frac = (ratio - 1) / (maxRatio - 1)

  ctx.fillStyle = withAlpha(colors.inkSecondary, 0.1)
  ctx.fillRect(x, barY, w, barH)

  const fill = Math.max(2, frac * w)
  const grad = ctx.createLinearGradient(x, 0, x + w, 0)
  grad.addColorStop(0, colors.teal)
  grad.addColorStop(1, colors.amber)
  ctx.fillStyle = grad
  ctx.fillRect(x, barY, fill, barH)

  // The floor, at the left-hand edge: nothing can ever be to its left.
  ctx.strokeStyle = colors.rose
  ctx.lineWidth = 2.5
  ctx.beginPath()
  ctx.moveTo(x + 1, barY - 5)
  ctx.lineTo(x + 1, barY + barH + 5)
  ctx.stroke()

  ctx.font = '600 11px ui-monospace, SFMono-Regular, Menlo, monospace'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'bottom'
  ctx.fillStyle = colors.inkSecondary
  ctx.fillText('σx · σp', x, barY - 6)
  ctx.textAlign = 'right'
  ctx.fillStyle = a.ratio < 1.005 ? colors.tealText : colors.amberText
  ctx.fillText(
    `${a.product.toFixed(4)}  =  ${a.ratio.toFixed(3)} × ħ/2`,
    x + w,
    barY - 6
  )

  ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillStyle = colors.roseText
  ctx.fillText(`ħ/2 = ${UNCERTAINTY_FLOOR.toFixed(2)}  (forbidden below)`, x, barY + barH + 5)
  if (t > 0) {
    ctx.textAlign = 'right'
    ctx.fillStyle = colors.inkMuted
    ctx.fillText(`released  t = ${t.toFixed(2)}  ·  ħ = ${HBAR}, m = 1`, x + w, barY + barH + 5)
  }
}
