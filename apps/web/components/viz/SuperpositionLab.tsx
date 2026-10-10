'use client'

import { useEffect, useRef } from 'react'
import { cArg, formatKet } from '@/lib/quantum'
import type { StateVector } from '@/lib/quantum'

/**
 * Amplitude-bar display for a statevector.
 *
 * One bar per basis state, height = probability. With `showPhase` off this is a
 * single-series chart in one hue; with it on, each bar is tinted by the phase of
 * its amplitude and gains a small dial underneath, because a tint alone is not a
 * readable encoding of an angle.
 */

const BAR_GAP = 2
const BAR_RADIUS = 4
const EASE_MS = 350

const PAD_X = 16
const PAD_TOP = 22
const AXIS_LABEL_H = 20
const DIAL_H = 34

const FALLBACK_VIOLET = '#a99dff'
const FALLBACK_TEAL = '#4edbca'
const FALLBACK_INK_SECONDARY = '#8fa3c8'
const FALLBACK_INK_MUTED = '#7d8cb0'
const FALLBACK_TEAL_LIGHT = '#8ae8da'
const FALLBACK_LINE_STRONG = 'rgba(255, 255, 255, 0.13)'
const FALLBACK_SURFACE_2 = '#141a2c'

/** Phase angle (radians) -> a colour on the hue wheel, anchored so 0 reads violet. */
function phaseColor(angle: number, alpha = 1): string {
  const deg = ((((angle * 180) / Math.PI + 249) % 360) + 360) % 360
  return `hsla(${deg.toFixed(1)}, 72%, 66%, ${alpha})`
}

/** `#a99dff` -> `124, 106, 249`. Falls back to the literal string for non-hex input. */
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

type Colors = {
  violet: string
  teal: string
  tealLight: string
  inkSecondary: string
  inkMuted: string
  line: string
  track: string
  fadedViolet: string
  collapseRing: string
  dialTrack: string
  dialTrackFaded: string
}

/** Resolve every colour this component needs from the current theme's CSS custom properties. */
function readColors(el: HTMLElement): Colors {
  const css = window.getComputedStyle(el)
  const violet = css.getPropertyValue('--q-violet').trim() || FALLBACK_VIOLET
  const teal = css.getPropertyValue('--q-teal').trim() || FALLBACK_TEAL
  const tealLight = css.getPropertyValue('--q-teal-text').trim() || FALLBACK_TEAL_LIGHT
  const inkSecondary = css.getPropertyValue('--ink-secondary').trim() || FALLBACK_INK_SECONDARY
  const inkMuted = css.getPropertyValue('--ink-muted').trim() || FALLBACK_INK_MUTED
  const line = css.getPropertyValue('--line-strong').trim() || FALLBACK_LINE_STRONG
  const surface2 = css.getPropertyValue('--surface-2').trim() || FALLBACK_SURFACE_2
  return {
    violet,
    teal,
    tealLight,
    inkSecondary,
    inkMuted,
    line,
    track: withAlpha(surface2, 0.6),
    fadedViolet: withAlpha(violet, 0.24),
    collapseRing: withAlpha(teal, 0.85),
    dialTrack: withAlpha(inkSecondary, 0.32),
    dialTrackFaded: withAlpha(inkMuted, 0.55),
  }
}

function roundedTopRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const rad = Math.max(0, Math.min(r, w / 2, h))
  ctx.beginPath()
  ctx.moveTo(x, y + h)
  ctx.lineTo(x, y + rad)
  ctx.quadraticCurveTo(x, y, x + rad, y)
  ctx.lineTo(x + w - rad, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad)
  ctx.lineTo(x + w, y + h)
  ctx.closePath()
}

export default function SuperpositionLab({
  state,
  showPhase,
  collapsedTo = null,
  className = '',
}: {
  state: StateVector
  showPhase: boolean
  collapsedTo?: number | null
  className?: string
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  /** Previously drawn bar heights (probability units) eased toward the targets. */
  const drawnRef = useRef<number[]>([])
  const rafRef = useRef<number | null>(null)
  const sizeRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 })
  const scheduleRef = useRef<() => void>(() => {})

  // Latest props, so the animation loop never reads a stale state.
  const propsRef = useRef({ state, showPhase, collapsedTo })
  propsRef.current = { state, showPhase, collapsedTo }

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

    let lastTime = 0

    const draw = (now: number): void => {
      rafRef.current = null
      const { state: sv, showPhase: phaseOn, collapsedTo: hit } = propsRef.current
      const { w, h } = sizeRef.current
      if (w <= 0 || h <= 0) return

      const dt = lastTime === 0 ? 16 : Math.min(now - lastTime, 120)
      lastTime = now

      const targets = sv.probabilities()
      const dim = targets.length

      let drawn = drawnRef.current
      if (drawn.length !== dim) {
        drawn = reduceMotion ? targets.slice() : new Array<number>(dim).fill(0)
        drawnRef.current = drawn
      }

      let settled = true
      if (reduceMotion) {
        for (let i = 0; i < dim; i++) drawn[i] = targets[i]
      } else {
        const k = 1 - Math.pow(0.001, dt / EASE_MS)
        for (let i = 0; i < dim; i++) {
          const diff = targets[i] - drawn[i]
          if (Math.abs(diff) < 0.0004) {
            drawn[i] = targets[i]
          } else {
            drawn[i] += diff * k
            settled = false
          }
        }
      }

      // ── Geometry ──
      const dialRoom = phaseOn ? DIAL_H : 0
      const baseY = h - AXIS_LABEL_H - dialRoom
      const plotH = Math.max(10, baseY - PAD_TOP)
      const plotW = Math.max(10, w - PAD_X * 2)
      const slot = plotW / dim
      const barW = Math.max(1, slot - BAR_GAP)
      const highlighted = typeof hit === 'number'

      ctx.clearRect(0, 0, w, h)

      for (let i = 0; i < dim; i++) {
        const p = Math.max(0, Math.min(1, drawn[i]))
        const barH = p * plotH
        const x = PAD_X + i * slot + BAR_GAP / 2
        const y = baseY - barH
        const isHit = hit === i
        const faded = highlighted && !isHit
        const amp = sv.amplitude(i)
        const angle = cArg(amp)

        // Recessive track so empty slots still read as basis states.
        ctx.fillStyle = colors.track
        roundedTopRect(ctx, x, PAD_TOP, barW, plotH, BAR_RADIUS)
        ctx.fill()

        if (isHit) {
          ctx.fillStyle = colors.teal
        } else if (phaseOn && p > 1e-9) {
          ctx.fillStyle = phaseColor(angle, faded ? 0.24 : 1)
        } else {
          ctx.fillStyle = faded ? colors.fadedViolet : colors.violet
        }

        if (barH > 0.5) {
          roundedTopRect(ctx, x, y, barW, barH, BAR_RADIUS)
          ctx.fill()
        }

        if (isHit) {
          const ringH = Math.max(barH, 8)
          ctx.strokeStyle = colors.collapseRing
          ctx.lineWidth = 2
          roundedTopRect(ctx, x - 3, baseY - ringH - 3, barW + 6, ringH + 3, BAR_RADIUS + 2)
          ctx.stroke()
        }

        // ── Percentage above the bar, only when the bar is wide enough ──
        ctx.font = '600 10px ui-monospace, SFMono-Regular, Menlo, monospace'
        ctx.textAlign = 'center'
        const pctText = `${(p * 100).toFixed(p >= 0.9995 ? 0 : 1)}%`
        if (p > 0.002 && ctx.measureText(pctText).width + 4 <= barW) {
          ctx.fillStyle = isHit ? colors.tealLight : faded ? colors.inkMuted : colors.inkSecondary
          ctx.textBaseline = 'bottom'
          ctx.fillText(pctText, x + barW / 2, Math.max(y - 4, 11))
        }

        // ── Basis label below the baseline ──
        ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace'
        const ket = formatKet(i, sv.numQubits)
        if (ctx.measureText(ket).width <= slot + 2) {
          ctx.fillStyle = isHit ? colors.tealLight : faded ? colors.inkMuted : colors.inkSecondary
          ctx.textBaseline = 'top'
          ctx.fillText(ket, x + barW / 2, baseY + 5)
        }

        // ── Phase dial ──
        if (phaseOn) {
          const cx = x + barW / 2
          const cy = baseY + AXIS_LABEL_H + DIAL_H / 2 - 5
          const r = Math.min(11, barW / 2, DIAL_H / 2 - 4)
          if (r >= 3) {
            ctx.strokeStyle = faded ? colors.dialTrackFaded : colors.dialTrack
            ctx.lineWidth = 1
            ctx.beginPath()
            ctx.arc(cx, cy, r, 0, Math.PI * 2)
            ctx.stroke()
            if (p > 1e-9) {
              // Canvas y grows downward, so negate the angle to draw it as maths.
              ctx.strokeStyle = isHit ? colors.tealLight : phaseColor(angle, faded ? 0.3 : 1)
              ctx.lineWidth = 1.75
              ctx.beginPath()
              ctx.moveTo(cx, cy)
              ctx.lineTo(cx + Math.cos(-angle) * r, cy + Math.sin(-angle) * r)
              ctx.stroke()
            }
          }
        }
      }

      // Baseline last, so it sits crisply over the tracks.
      ctx.strokeStyle = colors.line
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(PAD_X, baseY + 0.5)
      ctx.lineTo(w - PAD_X, baseY + 0.5)
      ctx.stroke()

      if (!settled && shouldRun()) {
        rafRef.current = window.requestAnimationFrame(draw)
      } else {
        rafRef.current = null
        lastTime = 0
      }
    }

    // ── Frame-loop gating: pause while off-screen or the page/tab is hidden ──
    let pageVisible = typeof document === 'undefined' || !document.hidden
    let onScreen = true
    const shouldRun = () => pageVisible && onScreen

    const startLoop = (): void => {
      if (rafRef.current === null && shouldRun()) {
        rafRef.current = window.requestAnimationFrame(draw)
      }
    }
    const stopLoop = (): void => {
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
    scheduleRef.current = startLoop

    const onVisibilityChange = (): void => {
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

    // Re-read the theme's colours whenever <html>'s class changes, and repaint once
    // immediately so a toggle is reflected even while the easing loop is idle.
    const themeObserver =
      typeof MutationObserver === 'function'
        ? new MutationObserver(() => {
            colors = readColors(wrap)
            // Only repaint immediately while visible; an off-screen/hidden canvas
            // picks up the refreshed `colors` on its next natural draw instead of
            // waking the loop just to paint somewhere nobody can see.
            if (shouldRun()) draw(performance.now())
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
      startLoop()
    }

    const observer = new ResizeObserver(resize)
    observer.observe(wrap)
    resize()

    return () => {
      observer.disconnect()
      document.removeEventListener('visibilitychange', onVisibilityChange)
      visibilityObserver?.disconnect()
      themeObserver?.disconnect()
      scheduleRef.current = () => {}
      stopLoop()
    }
  }, [])

  // Any prop change re-enters the easing loop until the new heights are reached.
  useEffect(() => {
    scheduleRef.current()
  }, [state, showPhase, collapsedTo])

  return (
    <div ref={wrapRef} className={`relative h-[340px] min-h-[320px] w-full ${className}`}>
      <canvas
        ref={canvasRef}
        className="block h-full w-full"
        role="img"
        aria-label={describeState(state, collapsedTo ?? null)}
      />
    </div>
  )
}

/** Plain-language summary of the state, for screen readers. */
function describeState(state: StateVector, collapsedTo: number | null): string {
  if (collapsedTo !== null) {
    return `Measured: the state collapsed to ${formatKet(
      collapsedTo,
      state.numQubits
    )}, now at 100 percent probability.`
  }
  const probs = state.probabilities()
  const nonZero = probs.filter((p) => p > 1e-9).length
  const top = probs
    .map((p, i) => ({ p, i }))
    .filter((d) => d.p > 0.001)
    .sort((a, b) => b.p - a.p)
    .slice(0, 4)
    .map((d) => `${formatKet(d.i, state.numQubits)} at ${(d.p * 100).toFixed(1)} percent`)
  return `Probability bars for the ${state.dim} basis states of ${state.numQubits} qubit${
    state.numQubits === 1 ? '' : 's'
  }. ${nonZero} of them have non-zero probability. Largest: ${top.join(', ')}.`
}
