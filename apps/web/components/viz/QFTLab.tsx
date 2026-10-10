'use client'

import { useEffect, useRef } from 'react'
import { cArg, formatKet } from '@/lib/quantum'
import type { StateVector } from '@/lib/quantum'

/**
 * QFTLab — magnitude bars plus a phase dial under every basis state.
 *
 * After a QFT the magnitudes are flat and uninformative: everything the
 * transform computed lives in the phases. So the dials are not decoration here,
 * they are the data. The bar tint repeats the same angle as a hue so the ramp is
 * visible at a glance, and the dial hand gives the precise, readable value.
 */

const BAR_GAP = 3
const EASE_MS = 380

const PAD_X = 16
const PAD_TOP = 26
const AXIS_LABEL_H = 18
const DIAL_H = 40

const FALLBACK_INK = '#eef2ff'
const FALLBACK_INK_SECONDARY = '#8fa3c8'
const FALLBACK_INK_MUTED = '#7d8cb0'
const FALLBACK_LINE_STRONG = 'rgba(255, 255, 255, 0.13)'
const FALLBACK_SURFACE_2 = '#141a2c'

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

type Colors = {
  ink: string
  inkSecondary: string
  inkMuted: string
  line: string
  track: string
  dialTrack: string
}

/** Resolve every colour this component needs from the current theme's CSS custom properties. */
function readColors(el: HTMLElement): Colors {
  const css = window.getComputedStyle(el)
  const ink = css.getPropertyValue('--ink').trim() || FALLBACK_INK
  const inkSecondary = css.getPropertyValue('--ink-secondary').trim() || FALLBACK_INK_SECONDARY
  const inkMuted = css.getPropertyValue('--ink-muted').trim() || FALLBACK_INK_MUTED
  const line = css.getPropertyValue('--line-strong').trim() || FALLBACK_LINE_STRONG
  const surface2 = css.getPropertyValue('--surface-2').trim() || FALLBACK_SURFACE_2
  return {
    ink,
    inkSecondary,
    inkMuted,
    line,
    track: withAlpha(surface2, 0.6),
    dialTrack: withAlpha(inkSecondary, 0.3),
  }
}

/** Phase angle (radians) -> hue, anchored so phase 0 reads as the app's violet. */
function phaseColor(angle: number, alpha = 1): string {
  const deg = ((((angle * 180) / Math.PI + 249) % 360) + 360) % 360
  return `hsla(${deg.toFixed(1)}, 72%, 66%, ${alpha})`
}

/** Shortest signed distance from `from` to `to` on the phase circle. */
function angleDelta(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  return d
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

export default function QFTLab({
  state,
  title,
  className = '',
}: {
  state: StateVector
  title: string
  className?: string
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const heightsRef = useRef<number[]>([])
  const anglesRef = useRef<number[]>([])
  const rafRef = useRef<number | null>(null)
  const sizeRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 })
  const scheduleRef = useRef<() => void>(() => {})

  const propsRef = useRef({ state, title })
  propsRef.current = { state, title }

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
      const { state: sv, title: caption } = propsRef.current
      const { w, h } = sizeRef.current
      if (w <= 0 || h <= 0) return

      const dt = lastTime === 0 ? 16 : Math.min(now - lastTime, 120)
      lastTime = now

      const dim = sv.dim
      const targetH = sv.probabilities()
      const targetA = Array.from({ length: dim }, (_, i) => cArg(sv.amplitude(i)))

      let drawnH = heightsRef.current
      let drawnA = anglesRef.current
      if (drawnH.length !== dim || drawnA.length !== dim) {
        drawnH = reduceMotion ? targetH.slice() : new Array<number>(dim).fill(0)
        drawnA = targetA.slice()
        heightsRef.current = drawnH
        anglesRef.current = drawnA
      }

      let settled = true
      if (reduceMotion) {
        for (let i = 0; i < dim; i++) {
          drawnH[i] = targetH[i]
          drawnA[i] = targetA[i]
        }
      } else {
        const k = 1 - Math.pow(0.001, dt / EASE_MS)
        for (let i = 0; i < dim; i++) {
          const dh = targetH[i] - drawnH[i]
          if (Math.abs(dh) < 0.0004) drawnH[i] = targetH[i]
          else {
            drawnH[i] += dh * k
            settled = false
          }
          const da = angleDelta(drawnA[i], targetA[i])
          if (Math.abs(da) < 0.004) drawnA[i] = targetA[i]
          else {
            drawnA[i] += da * k
            settled = false
          }
        }
      }

      // ── Geometry ──
      const baseY = h - AXIS_LABEL_H - DIAL_H
      const plotH = Math.max(10, baseY - PAD_TOP)
      const plotW = Math.max(10, w - PAD_X * 2)
      const slot = plotW / dim
      const barW = Math.max(1, slot - BAR_GAP)

      ctx.clearRect(0, 0, w, h)

      for (let i = 0; i < dim; i++) {
        const p = Math.max(0, Math.min(1, drawnH[i]))
        const barH = p * plotH
        const x = PAD_X + i * slot + BAR_GAP / 2
        const y = baseY - barH
        const angle = drawnA[i]
        const live = targetH[i] > 1e-9

        ctx.fillStyle = colors.track
        roundedTopRect(ctx, x, PAD_TOP, barW, plotH, 4)
        ctx.fill()

        if (barH > 0.5) {
          ctx.fillStyle = phaseColor(angle, live ? 1 : 0.25)
          roundedTopRect(ctx, x, y, barW, barH, 4)
          ctx.fill()
        }

        // Basis label under the baseline.
        ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'top'
        const ket = formatKet(i, sv.numQubits)
        if (ctx.measureText(ket).width <= slot + 2) {
          ctx.fillStyle = live ? colors.inkSecondary : colors.inkMuted
          ctx.fillText(ket, x + barW / 2, baseY + 4)
        }

        // ── Phase dial: a circle with a hand at arg(amplitude) ──
        const cx = x + barW / 2
        const cy = baseY + AXIS_LABEL_H + DIAL_H / 2 - 4
        const r = Math.min(13, barW / 2, DIAL_H / 2 - 4)
        if (r >= 3) {
          ctx.strokeStyle = colors.dialTrack
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.arc(cx, cy, r, 0, Math.PI * 2)
          ctx.stroke()
          if (live) {
            // Canvas y grows downward, so negate the angle to draw it as maths.
            ctx.strokeStyle = phaseColor(angle, 1)
            ctx.lineWidth = 1.9
            ctx.beginPath()
            ctx.moveTo(cx, cy)
            ctx.lineTo(cx + Math.cos(-angle) * r, cy + Math.sin(-angle) * r)
            ctx.stroke()
          }
        }
      }

      ctx.strokeStyle = colors.line
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(PAD_X, Math.round(baseY) + 0.5)
      ctx.lineTo(w - PAD_X, Math.round(baseY) + 0.5)
      ctx.stroke()

      ctx.font = '600 12px ui-sans-serif, system-ui, sans-serif'
      ctx.fillStyle = colors.ink
      ctx.textAlign = 'left'
      ctx.textBaseline = 'top'
      ctx.fillText(caption, PAD_X, 8)

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

    // Re-read the theme's colours whenever <html>'s class changes, and repaint
    // immediately while visible so a toggle is reflected even mid-idle loop.
    const themeObserver =
      typeof MutationObserver === 'function'
        ? new MutationObserver(() => {
            colors = readColors(wrap)
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

  useEffect(() => {
    scheduleRef.current()
  }, [state, title])

  return (
    <div ref={wrapRef} className={`relative h-[340px] min-h-[320px] w-full ${className}`}>
      <canvas ref={canvasRef} className="block h-full w-full" role="img" aria-label={describe(state, title)} />
    </div>
  )
}

function describe(state: StateVector, title: string): string {
  const probs = state.probabilities()
  const live = probs.filter((p) => p > 1e-9).length
  const first = probs
    .map((p, i) => ({ p, i }))
    .filter((d) => d.p > 1e-9)
    .slice(0, 4)
    .map(
      (d) =>
        `${formatKet(d.i, state.numQubits)} magnitude ${(d.p * 100).toFixed(1)} percent, phase ${(
          cArg(state.amplitude(d.i)) / Math.PI
        ).toFixed(2)} pi`
    )
  return `${title}. ${live} of ${state.dim} basis states carry amplitude. ${first.join('; ')}.`
}
