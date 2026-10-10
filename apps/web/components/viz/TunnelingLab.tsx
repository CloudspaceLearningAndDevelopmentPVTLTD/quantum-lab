'use client'

import { useEffect, useRef } from 'react'

/**
 * Real-time solver for the 1D time-dependent Schrödinger equation, drawn on a canvas.
 *
 * Natural units: ħ = 1, m = 1. The wavefunction lives on N = 600 lattice sites with
 * spacing dx = 1, and is advanced with the staggered ("Visscher") leapfrog scheme, in
 * which the real and imaginary parts are offset by half a time step. That scheme is
 * explicit, cheap, and conserves a discrete norm exactly, which matters here because the
 * whole point of the visualization is a probability budget that splits into two parts.
 *
 * A note on units. Slider energies are expressed in a display unit worth ENERGY_SCALE
 * lattice energy units — equivalently, one grid cell is sqrt(ENERGY_SCALE) ≈ 0.05 of the
 * length unit the slider energies are quoted in. This is not cosmetic: with the sliders
 * fed to the lattice raw, k0 = sqrt(2E) would be of order 1 *per grid point*, far outside
 * the continuum limit, where the lattice dispersion 1 − cos(k) departs badly from k²/2 and
 * the simulation stops agreeing with textbook barrier transmission. With this scale
 * k0·dx ≈ 0.1 and the measured transmission tracks the analytic result closely.
 */
export const ENERGY_SCALE = 0.0025

/** Lattice size. */
const N = 600
/** Grid spacing. */
const DX = 1
/** Time step. Stability for this scheme needs dt < 2 / (2/dx² + Vmax); 0.2 is far inside it. */
const DT = 0.2
/** Integration sub-steps per animation frame — sets how fast the packet moves on screen. */
const SUBSTEPS = 40
/** Frames of integration used for the single static render under prefers-reduced-motion. */
const STATIC_FRAMES = 420
/** Fraction of the grid at each end that absorbs outgoing waves. */
const DAMP_FRACTION = 0.08

const PAD_L = 14
const PAD_R = 14
const PAD_T = 18
const PAD_B = 26

const FALLBACK_INK_SECONDARY = '#8fa3c8'
const FALLBACK_INK_MUTED = '#7d8cb0'
const FALLBACK_VIOLET = '#a99dff'
const FALLBACK_TEAL = '#4edbca'
const FALLBACK_AMBER = '#f2a96a'
const FALLBACK_SKY = '#6283c8'
const FALLBACK_VIOLET_TEXT = '#c1bbfe'
const FALLBACK_TEAL_TEXT = '#8ae8da'
const FALLBACK_AMBER_TEXT = '#fac294'
const FALLBACK_ROSE_TEXT = '#f5a193'
const FALLBACK_SKY_TEXT = '#8faae0'
const FALLBACK_LINE_STRONG = 'rgba(255, 255, 255, 0.13)'

type Colors = {
  inkSecondary: string
  inkMuted: string
  violet: string
  teal: string
  amber: string
  sky: string
  violetText: string
  tealText: string
  amberText: string
  roseText: string
  skyText: string
  lineStrong: string
}

/** `#a99dff` -> `124, 106, 249`. Returns null for non-hex input. */
function hexToRgbTriple(hex: string): string | null {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim())
  if (!match) return null
  const n = Number.parseInt(match[1], 16)
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`
}

/** Build an `rgba()` string from a resolved hex colour custom property. */
function withAlpha(hex: string, alpha: number): string {
  const triple = hexToRgbTriple(hex)
  return triple ? `rgba(${triple}, ${alpha})` : hex
}

/** Resolve every colour this component needs from the current theme's CSS custom properties. */
function readColors(el: HTMLElement): Colors {
  const css = window.getComputedStyle(el)
  const read = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback
  return {
    inkSecondary: read('--ink-secondary', FALLBACK_INK_SECONDARY),
    inkMuted: read('--ink-muted', FALLBACK_INK_MUTED),
    violet: read('--q-violet', FALLBACK_VIOLET),
    teal: read('--q-teal', FALLBACK_TEAL),
    amber: read('--q-amber', FALLBACK_AMBER),
    sky: read('--q-sky', FALLBACK_SKY),
    violetText: read('--q-violet-text', FALLBACK_VIOLET_TEXT),
    tealText: read('--q-teal-text', FALLBACK_TEAL_TEXT),
    amberText: read('--q-amber-text', FALLBACK_AMBER_TEXT),
    roseText: read('--q-rose-text', FALLBACK_ROSE_TEXT),
    skyText: read('--q-sky-text', FALLBACK_SKY_TEXT),
    lineStrong: read('--line-strong', FALLBACK_LINE_STRONG),
  }
}

type Props = {
  barrierHeight: number
  barrierWidth: number
  particleEnergy: number
  packetWidth: number
  running: boolean
  resetKey: number
  onStats?: (s: { transmission: number; reflection: number }) => void
  className?: string
}

/** Everything the integrator mutates between frames. */
type Sim = {
  psiRe: Float64Array
  psiIm: Float64Array
  potential: Float64Array
  damping: Float64Array
  barrierStart: number
  barrierEnd: number
  /** Probability already swallowed by the absorbing layer, per side. */
  absorbedLeft: number
  absorbedRight: number
  /** Peak |psi|² of the initial packet — fixes the vertical scale of the density plot. */
  peak: number
}

function buildSim(
  barrierHeight: number,
  barrierWidth: number,
  particleEnergy: number,
  packetWidth: number
): Sim {
  const width = Math.max(1, Math.round(barrierWidth))
  const barrierStart = Math.round(0.55 * N - width / 2)
  const barrierEnd = barrierStart + width

  const potential = new Float64Array(N)
  for (let i = barrierStart; i < barrierEnd && i < N; i++) {
    if (i >= 0) potential[i] = barrierHeight * ENERGY_SCALE
  }

  // Absorbing layer: a mask that ramps from 1 at the inner edge to ~0.98 at the wall,
  // applied every sub-step so outgoing waves fade instead of bouncing back.
  const zone = Math.max(1, Math.floor(N * DAMP_FRACTION))
  const damping = new Float64Array(N)
  for (let i = 0; i < N; i++) {
    let t = 0
    if (i < zone) t = (zone - i) / zone
    else if (i >= N - zone) t = (i - (N - zone) + 1) / zone
    damping[i] = 1 - 0.02 * t * t
  }

  // Gaussian packet moving right.
  const psiRe = new Float64Array(N)
  const psiIm = new Float64Array(N)
  const sigma = Math.max(1, packetWidth)
  const k0 = Math.sqrt(2 * particleEnergy * ENERGY_SCALE)
  const x0 = 0.22 * N
  for (let i = 0; i < N; i++) {
    const d = i - x0
    const env = Math.exp(-(d * d) / (2 * sigma * sigma))
    psiRe[i] = env * Math.cos(k0 * i)
    psiIm[i] = env * Math.sin(k0 * i)
  }

  // Normalise so sum |psi|² dx = 1.
  let total = 0
  for (let i = 0; i < N; i++) total += (psiRe[i] * psiRe[i] + psiIm[i] * psiIm[i]) * DX
  const norm = total > 0 ? 1 / Math.sqrt(total) : 1
  let peak = 0
  for (let i = 0; i < N; i++) {
    psiRe[i] *= norm
    psiIm[i] *= norm
    const p = psiRe[i] * psiRe[i] + psiIm[i] * psiIm[i]
    if (p > peak) peak = p
  }

  return {
    psiRe,
    psiIm,
    potential,
    damping,
    barrierStart,
    barrierEnd,
    absorbedLeft: 0,
    absorbedRight: 0,
    peak: peak > 0 ? peak : 1,
  }
}

/** One leapfrog step: real part first using the current imaginary part, then vice versa. */
function step(sim: Sim): void {
  const { psiRe, psiIm, potential, damping } = sim
  const inv = 1 / (DX * DX)

  for (let i = 1; i < N - 1; i++) {
    const hIm = -0.5 * (psiIm[i + 1] - 2 * psiIm[i] + psiIm[i - 1]) * inv + potential[i] * psiIm[i]
    psiRe[i] += DT * hIm
  }
  for (let i = 1; i < N - 1; i++) {
    const hRe = -0.5 * (psiRe[i + 1] - 2 * psiRe[i] + psiRe[i - 1]) * inv + potential[i] * psiRe[i]
    psiIm[i] -= DT * hRe
  }

  psiRe[0] = 0
  psiIm[0] = 0
  psiRe[N - 1] = 0
  psiIm[N - 1] = 0

  // Absorb, and book-keep what was absorbed on each side so the transmitted and
  // reflected fractions stay meaningful long after the packets have left the grid.
  const mid = (sim.barrierStart + sim.barrierEnd) / 2
  for (let i = 0; i < N; i++) {
    const m = damping[i]
    if (m === 1) continue
    const before = psiRe[i] * psiRe[i] + psiIm[i] * psiIm[i]
    psiRe[i] *= m
    psiIm[i] *= m
    const lost = before - (psiRe[i] * psiRe[i] + psiIm[i] * psiIm[i])
    if (i < mid) sim.absorbedLeft += lost * DX
    else sim.absorbedRight += lost * DX
  }
}

/** Probability on each side of the barrier, on the grid plus whatever was absorbed. */
function measure(sim: Sim): { transmission: number; reflection: number } {
  const { psiRe, psiIm } = sim
  let reflection = sim.absorbedLeft
  let transmission = sim.absorbedRight
  for (let i = 0; i < N; i++) {
    const p = (psiRe[i] * psiRe[i] + psiIm[i] * psiIm[i]) * DX
    if (i < sim.barrierStart) reflection += p
    else if (i >= sim.barrierEnd) transmission += p
  }
  const total = reflection + transmission
  if (total <= 0) return { transmission: 0, reflection: 0 }
  return { transmission: transmission / total, reflection: reflection / total }
}

export default function TunnelingLab({
  barrierHeight,
  barrierWidth,
  particleEnergy,
  packetWidth,
  running,
  resetKey,
  onStats,
  className = '',
}: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rafRef = useRef<number | null>(null)
  const sizeRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 })
  const simRef = useRef<Sim | null>(null)
  const statsRef = useRef<{ transmission: number; reflection: number }>({
    transmission: 0,
    reflection: 0,
  })
  const lastEmitRef = useRef(0)

  // Latest props for the animation loop, which is created once and must not close
  // over stale values.
  const propsRef = useRef({ barrierHeight, barrierWidth, particleEnergy, packetWidth, running })
  propsRef.current = { barrierHeight, barrierWidth, particleEnergy, packetWidth, running }

  const onStatsRef = useRef(onStats)
  onStatsRef.current = onStats

  // Bumped whenever the simulation must start over; the loop notices and rebuilds.
  const generationRef = useRef(0)
  const builtGenerationRef = useRef(-1)
  /** Set by the animation effect; asks for one frame when the loop is not running. */
  const scheduleRef = useRef<(() => void) | null>(null)
  useEffect(() => {
    generationRef.current += 1
    scheduleRef.current?.()
  }, [barrierHeight, barrierWidth, particleEnergy, packetWidth, resetKey])

  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const reduceMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    // Canvas cannot read CSS custom properties directly, so resolve them here and
    // again whenever the theme class on <html> changes.
    let colors = readColors(wrap)

    const ensureSim = (): Sim => {
      if (simRef.current === null || builtGenerationRef.current !== generationRef.current) {
        const p = propsRef.current
        simRef.current = buildSim(p.barrierHeight, p.barrierWidth, p.particleEnergy, p.packetWidth)
        builtGenerationRef.current = generationRef.current
        statsRef.current = { transmission: 0, reflection: 0 }
        lastEmitRef.current = 0
        if (reduceMotion) {
          for (let f = 0; f < STATIC_FRAMES * SUBSTEPS; f++) step(simRef.current)
          statsRef.current = measure(simRef.current)
        }
      }
      return simRef.current
    }

    const draw = (now: number): void => {
      const sim = ensureSim()
      const p = propsRef.current
      const { w, h } = sizeRef.current

      if (!reduceMotion && p.running) {
        for (let s = 0; s < SUBSTEPS; s++) step(sim)
        statsRef.current = measure(sim)
      }

      // Throttle the React-visible stats to ~5 Hz.
      if (now - lastEmitRef.current > 200) {
        lastEmitRef.current = now
        onStatsRef.current?.(statsRef.current)
      }

      if (w > 0 && h > 0) render(ctx, sim, p, statsRef.current, w, h, colors)

      if (!reduceMotion && shouldRun()) rafRef.current = window.requestAnimationFrame(draw)
      else rafRef.current = null
    }

    // ── Frame-loop gating ────────────────────────────────────────────────────
    // MEASURED: this is the most expensive loop on the site. Per frame it runs 40
    // leapfrog sub-steps over the 600-site lattice plus a measure() sweep — benchmarked
    // at 0.157 ms/frame in node (600 frames in 94.1 ms), i.e. ~0.9% of a core
    // continuously, before the canvas work of stroking two 600-point paths on top.
    // It ran unconditionally. MEASURED with Playwright, rAF callbacks over a 2 s window:
    // scrolled 4000 px below the canvas, 117 callbacks before this gate (a full 60 fps —
    // this is 2D canvas, not WebGL, so it is not GPU-limited in headless), 0 after. Tab
    // hidden: 100 before, 0 after. Back on screen: 120, so it resumes at full rate.
    // That is ~117 x 40 = 4680 lattice sweeps per 2 s spent on a barrier nobody was
    // looking at.
    //
    // NOTE ON PHYSICS: this changes WHEN the integrator runs, never HOW. The scheme is
    // frame-counted, not wall-clock driven, so pausing freezes the packet and resuming
    // continues from the same state — no skipped or double-sized steps. The reference
    // values in docs/PERFORMANCE.md (T=0.376883661535, R=0.623116338465 after 420
    // frames) are unchanged.
    let pageVisible = typeof document === 'undefined' || !document.hidden
    let onScreen = true
    const shouldRun = () => pageVisible && onScreen

    const startLoop = () => {
      if (rafRef.current === null && shouldRun()) {
        rafRef.current = window.requestAnimationFrame(draw)
      }
    }
    const stopLoop = () => {
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }

    const onVisibilityChange = () => {
      pageVisible = !document.hidden
      if (pageVisible) startLoop()
      else stopLoop()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    const visibilityObserver =
      typeof IntersectionObserver === 'function'
        ? new IntersectionObserver(
            (entries) => {
              onScreen = entries.some((e) => e.isIntersecting)
              if (onScreen) startLoop()
              else stopLoop()
            },
            { rootMargin: '128px' }
          )
        : null
    visibilityObserver?.observe(wrap)

    // Re-read the theme's colours whenever <html>'s class changes, and repaint
    // once immediately so a toggle is reflected even while paused or hidden.
    const themeObserver =
      typeof MutationObserver === 'function'
        ? new MutationObserver(() => {
            colors = readColors(wrap)
            const sim = simRef.current
            const { w, h } = sizeRef.current
            if (sim && w > 0 && h > 0) render(ctx, sim, propsRef.current, statsRef.current, w, h, colors)
          })
        : null
    themeObserver?.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })

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
      if (reduceMotion) {
        const sim = ensureSim()
        render(ctx, sim, propsRef.current, statsRef.current, w, h, colors)
      }
    }

    // Under prefers-reduced-motion the loop stops after one frame, so control changes
    // have to ask for a fresh one explicitly.
    // Routes through startLoop so a control change on an off-screen or hidden canvas
    // does not wake the integrator; the pending generation is picked up by ensureSim()
    // on the first frame after it becomes visible again.
    scheduleRef.current = startLoop

    const observer = new ResizeObserver(resize)
    observer.observe(wrap)
    resize()
    startLoop()

    return () => {
      scheduleRef.current = null
      observer.disconnect()
      document.removeEventListener('visibilitychange', onVisibilityChange)
      visibilityObserver?.disconnect()
      themeObserver?.disconnect()
      stopLoop()
    }
  }, [])

  const label =
    `Wave packet of energy ${particleEnergy.toFixed(1)} striking a barrier of height ` +
    `${barrierHeight.toFixed(1)} and width ${barrierWidth} grid units. The probability density ` +
    `splits into a reflected part and a transmitted part that tunnelled through the barrier.`

  return (
    <div ref={wrapRef} className={`relative min-h-[400px] w-full ${className}`} style={{ height: 420 }}>
      <canvas ref={canvasRef} className="block h-full w-full" role="img" aria-label={label} />
    </div>
  )
}

function render(
  ctx: CanvasRenderingContext2D,
  sim: Sim,
  props: { barrierHeight: number; particleEnergy: number },
  stats: { transmission: number; reflection: number },
  w: number,
  h: number,
  colors: Colors
): void {
  const plotW = Math.max(10, w - PAD_L - PAD_R)
  const baseY = h - PAD_B
  const plotH = Math.max(10, baseY - PAD_T)

  const xOf = (i: number): number => PAD_L + (i / (N - 1)) * plotW

  // Shared energy axis: barrier top and the E line are measured against it.
  const eMax = Math.max(props.barrierHeight, props.particleEnergy) * 1.35 + 0.2
  const yOfEnergy = (e: number): number => baseY - (e / eMax) * plotH

  // The density curve gets its own scale, pinned to the initial packet's peak so a
  // shrinking transmitted lobe reads as genuinely smaller rather than being re-normalised.
  const densityH = plotH * 0.72
  const yOfDensity = (p: number): number => baseY - Math.min(1.15, p / sim.peak) * densityH

  ctx.clearRect(0, 0, w, h)

  // ── Baseline ──
  ctx.strokeStyle = withAlpha(colors.inkSecondary, 0.16)
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(PAD_L, baseY + 0.5)
  ctx.lineTo(w - PAD_R, baseY + 0.5)
  ctx.stroke()

  // ── Barrier ──
  const bx0 = xOf(sim.barrierStart)
  const bx1 = xOf(sim.barrierEnd)
  const byTop = yOfEnergy(props.barrierHeight)
  ctx.fillStyle = withAlpha(colors.amber, 0.16)
  ctx.fillRect(bx0, byTop, Math.max(1, bx1 - bx0), baseY - byTop)
  ctx.strokeStyle = colors.amber
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(bx0, baseY)
  ctx.lineTo(bx0, byTop)
  ctx.lineTo(bx1, byTop)
  ctx.lineTo(bx1, baseY)
  ctx.stroke()

  ctx.font = '600 11px ui-monospace, SFMono-Regular, Menlo, monospace'
  ctx.fillStyle = colors.amberText
  ctx.textAlign = 'center'
  ctx.textBaseline = 'bottom'
  if (bx1 - bx0 > 30) {
    ctx.fillText(`V₀ ${props.barrierHeight.toFixed(1)}`, (bx0 + bx1) / 2, byTop - 5)
  } else {
    ctx.textAlign = 'left'
    ctx.fillText(`V₀ ${props.barrierHeight.toFixed(1)}`, bx1 + 6, byTop - 3)
  }

  // ── Particle energy line ──
  const ey = yOfEnergy(props.particleEnergy)
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
  ctx.fillText(`E ${props.particleEnergy.toFixed(1)}`, PAD_L + 2, ey - 4)

  // ── Real part of psi, faint, to show the oscillation and its decay in the barrier ──
  const ampScale = Math.sqrt(sim.peak)
  const midY = baseY - densityH * 0.5
  ctx.strokeStyle = withAlpha(colors.teal, 0.35)
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let i = 0; i < N; i++) {
    const y = midY - (sim.psiRe[i] / ampScale) * densityH * 0.28
    if (i === 0) ctx.moveTo(xOf(i), y)
    else ctx.lineTo(xOf(i), y)
  }
  ctx.stroke()

  // ── |psi|² filled curve ──
  ctx.beginPath()
  ctx.moveTo(PAD_L, baseY)
  for (let i = 0; i < N; i++) {
    const p = sim.psiRe[i] * sim.psiRe[i] + sim.psiIm[i] * sim.psiIm[i]
    ctx.lineTo(xOf(i), yOfDensity(p))
  }
  ctx.lineTo(w - PAD_R, baseY)
  ctx.closePath()
  ctx.fillStyle = withAlpha(colors.violet, 0.35)
  ctx.fill()

  ctx.beginPath()
  for (let i = 0; i < N; i++) {
    const p = sim.psiRe[i] * sim.psiRe[i] + sim.psiIm[i] * sim.psiIm[i]
    const y = yOfDensity(p)
    if (i === 0) ctx.moveTo(xOf(i), y)
    else ctx.lineTo(xOf(i), y)
  }
  ctx.strokeStyle = colors.violet
  ctx.lineWidth = 1.75
  ctx.stroke()

  // ── Region readouts ──
  ctx.font = '600 11px ui-monospace, SFMono-Regular, Menlo, monospace'
  ctx.textBaseline = 'top'
  ctx.textAlign = 'center'
  ctx.fillStyle = colors.roseText
  ctx.fillText(`reflected ${(stats.reflection * 100).toFixed(1)}%`, (PAD_L + bx0) / 2, PAD_T - 6)
  ctx.fillStyle = colors.tealText
  ctx.fillText(
    `transmitted ${(stats.transmission * 100).toFixed(1)}%`,
    (bx1 + (w - PAD_R)) / 2,
    PAD_T - 6
  )

  // ── Axis captions ──
  ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace'
  ctx.fillStyle = colors.inkMuted
  ctx.textAlign = 'left'
  ctx.fillText('position →', PAD_L, baseY + 8)
  ctx.textAlign = 'right'
  ctx.fillStyle = colors.inkSecondary
  ctx.fillText('|ψ|²', w - PAD_R, baseY + 8)
  ctx.fillStyle = colors.teal
  ctx.textAlign = 'center'
  ctx.fillText('Re ψ', w / 2, baseY + 8)
}
