'use client'

import { useEffect, useRef } from 'react'
import { formatKet } from '@/lib/quantum'
import type { StateVector } from '@/lib/quantum'

/**
 * GroverLab — signed amplitude bars for Grover's search.
 *
 * Unlike a probability chart, this draws amplitudes with their SIGN: bars grow
 * upward from a centre line when the amplitude is positive and downward when it
 * is negative. That is the whole point of the display — the oracle does not make
 * the marked amplitude bigger, it makes it negative, and the diffusion step then
 * reflects every amplitude about their mean (drawn as the dashed amber line),
 * converting that sign flip into height.
 */

const BAR_GAP = 3
const EASE_MS = 400

const PAD_X = 18
const PAD_TOP = 26
const LABEL_STRIP_H = 22

const FALLBACK_VIOLET = '#a99dff'
const FALLBACK_TEAL = '#4edbca'
const FALLBACK_AMBER = '#f2a96a'
const FALLBACK_INK = '#eef2ff'
const FALLBACK_INK_SECONDARY = '#8fa3c8'
const FALLBACK_INK_MUTED = '#7d8cb0'
const FALLBACK_TEAL_LIGHT = '#8ae8da'
const FALLBACK_AMBER_LIGHT = '#fac294'

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
  violet: string
  teal: string
  amber: string
  ink: string
  inkSecondary: string
  inkMuted: string
  tealLight: string
  amberLight: string
  axisLine: string
  track: string
}

/** Resolve every colour this component needs from the current theme's CSS custom properties. */
function readColors(el: HTMLElement): Colors {
  const css = window.getComputedStyle(el)
  const violet = css.getPropertyValue('--q-violet').trim() || FALLBACK_VIOLET
  const teal = css.getPropertyValue('--q-teal').trim() || FALLBACK_TEAL
  const amber = css.getPropertyValue('--q-amber').trim() || FALLBACK_AMBER
  const ink = css.getPropertyValue('--ink').trim() || FALLBACK_INK
  const inkSecondary = css.getPropertyValue('--ink-secondary').trim() || FALLBACK_INK_SECONDARY
  const inkMuted = css.getPropertyValue('--ink-muted').trim() || FALLBACK_INK_MUTED
  const tealLight = css.getPropertyValue('--q-teal-text').trim() || FALLBACK_TEAL_LIGHT
  const amberLight = css.getPropertyValue('--q-amber-text').trim() || FALLBACK_AMBER_LIGHT
  return {
    violet,
    teal,
    amber,
    ink,
    inkSecondary,
    inkMuted,
    tealLight,
    amberLight,
    axisLine: withAlpha(inkSecondary, 0.28),
    track: withAlpha(inkSecondary, 0.05),
  }
}

/** Signed amplitudes (real part carries the sign for every state Grover builds). */
function signedAmplitudes(sv: StateVector): number[] {
  const out: number[] = new Array<number>(sv.dim)
  for (let i = 0; i < sv.dim; i++) {
    const a = sv.amplitude(i)
    const mag = Math.hypot(a.re, a.im)
    // Grover keeps every amplitude real; the sign is the sign of the real part.
    out[i] = a.re < 0 ? -mag : mag
  }
  return out
}

function roundedRectFromCentre(
  ctx: CanvasRenderingContext2D,
  x: number,
  centreY: number,
  w: number,
  signedH: number,
  r: number
): void {
  const h = Math.abs(signedH)
  const up = signedH >= 0
  const rad = Math.max(0, Math.min(r, w / 2, h))
  const top = up ? centreY - h : centreY
  ctx.beginPath()
  if (up) {
    ctx.moveTo(x, top + h)
    ctx.lineTo(x, top + rad)
    ctx.quadraticCurveTo(x, top, x + rad, top)
    ctx.lineTo(x + w - rad, top)
    ctx.quadraticCurveTo(x + w, top, x + w, top + rad)
    ctx.lineTo(x + w, top + h)
  } else {
    ctx.moveTo(x, top)
    ctx.lineTo(x, top + h - rad)
    ctx.quadraticCurveTo(x, top + h, x + rad, top + h)
    ctx.lineTo(x + w - rad, top + h)
    ctx.quadraticCurveTo(x + w, top + h, x + w, top + h - rad)
    ctx.lineTo(x + w, top)
  }
  ctx.closePath()
}

export default function GroverLab({
  state,
  marked,
  phase,
  className = '',
}: {
  state: StateVector
  marked: number
  phase: string
  className?: string
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  /** Currently drawn signed amplitudes, eased toward the target each frame. */
  const drawnRef = useRef<number[]>([])
  const rafRef = useRef<number | null>(null)
  const sizeRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 })
  const scheduleRef = useRef<() => void>(() => {})

  const propsRef = useRef({ state, marked, phase })
  propsRef.current = { state, marked, phase }

  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const reduceMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    // Canvas cannot read CSS custom properties, so resolve them here and again
    // whenever the theme class on <html> changes.
    let colors = readColors(wrap)

    let lastTime = 0

    const draw = (now: number): void => {
      rafRef.current = null
      const { state: sv, marked: hit, phase: phaseText } = propsRef.current
      const { w, h } = sizeRef.current
      if (w <= 0 || h <= 0) return

      const dt = lastTime === 0 ? 16 : Math.min(now - lastTime, 120)
      lastTime = now

      const targets = signedAmplitudes(sv)
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
          if (Math.abs(diff) < 0.0006) {
            drawn[i] = targets[i]
          } else {
            drawn[i] += diff * k
            settled = false
          }
        }
      }

      // ── Geometry ──
      const plotTop = PAD_TOP
      const plotBottom = h - LABEL_STRIP_H
      const centreY = (plotTop + plotBottom) / 2
      const halfH = Math.max(8, (plotBottom - plotTop) / 2 - 6)
      const plotW = Math.max(10, w - PAD_X * 2)
      const slot = plotW / dim
      const barW = Math.max(1, slot - BAR_GAP)

      let mean = 0
      for (let i = 0; i < dim; i++) mean += drawn[i]
      mean /= dim

      ctx.clearRect(0, 0, w, h)

      // Recessive full-height tracks so empty slots still read as basis states.
      for (let i = 0; i < dim; i++) {
        const x = PAD_X + i * slot + BAR_GAP / 2
        ctx.fillStyle = colors.track
        ctx.fillRect(x, centreY - halfH, barW, halfH * 2)
      }

      // ── Bars ──
      for (let i = 0; i < dim; i++) {
        const amp = Math.max(-1, Math.min(1, drawn[i]))
        const barH = amp * halfH
        const x = PAD_X + i * slot + BAR_GAP / 2
        ctx.fillStyle = i === hit ? colors.teal : colors.violet
        if (Math.abs(barH) > 0.5) {
          roundedRectFromCentre(ctx, x, centreY, barW, barH, 4)
          ctx.fill()
        }

        // Amplitude value above/below the bar tip, when there is room for it.
        ctx.font = '600 10px ui-monospace, SFMono-Regular, Menlo, monospace'
        ctx.textAlign = 'center'
        const valueText = amp.toFixed(2)
        if (ctx.measureText(valueText).width + 4 <= barW) {
          ctx.fillStyle = i === hit ? colors.tealLight : colors.inkSecondary
          if (amp >= 0) {
            ctx.textBaseline = 'bottom'
            ctx.fillText(valueText, x + barW / 2, Math.max(centreY - barH - 4, plotTop + 10))
          } else {
            ctx.textBaseline = 'top'
            ctx.fillText(valueText, x + barW / 2, Math.min(centreY - barH + 4, plotBottom - 10))
          }
        }

        // Basis label in the bottom strip.
        ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace'
        const ket = formatKet(i, sv.numQubits)
        if (ctx.measureText(ket).width <= slot + 2) {
          ctx.fillStyle = i === hit ? colors.tealLight : colors.inkMuted
          ctx.textBaseline = 'top'
          ctx.fillText(ket, x + barW / 2, plotBottom + 5)
        }
      }

      // ── Centre line (amplitude zero) ──
      ctx.strokeStyle = colors.axisLine
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(PAD_X, Math.round(centreY) + 0.5)
      ctx.lineTo(w - PAD_X, Math.round(centreY) + 0.5)
      ctx.stroke()

      // ── Mean amplitude: the line the diffusion step reflects about ──
      const meanY = centreY - Math.max(-1, Math.min(1, mean)) * halfH
      ctx.save()
      ctx.setLineDash([5, 4])
      ctx.strokeStyle = colors.amber
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(PAD_X, meanY)
      ctx.lineTo(w - PAD_X, meanY)
      ctx.stroke()
      ctx.restore()

      ctx.font = '600 10px ui-sans-serif, system-ui, sans-serif'
      ctx.fillStyle = colors.amberLight
      ctx.textAlign = 'right'
      ctx.textBaseline = mean >= 0 ? 'bottom' : 'top'
      ctx.fillText(`mean ${mean.toFixed(3)}`, w - PAD_X, mean >= 0 ? meanY - 3 : meanY + 3)

      // ── Phase caption ──
      ctx.font = '600 12px ui-sans-serif, system-ui, sans-serif'
      ctx.fillStyle = colors.ink
      ctx.textAlign = 'left'
      ctx.textBaseline = 'top'
      ctx.fillText(phaseText, PAD_X, 8)

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

  // Any prop change re-enters the easing loop until the new bars are reached.
  useEffect(() => {
    scheduleRef.current()
  }, [state, marked, phase])

  return (
    <div ref={wrapRef} className={`relative h-[360px] min-h-[340px] w-full ${className}`}>
      <canvas ref={canvasRef} className="block h-full w-full" role="img" aria-label={describe(state, marked, phase)} />
    </div>
  )
}

/** Plain-language summary for screen readers. */
function describe(state: StateVector, marked: number, phase: string): string {
  const amps = signedAmplitudes(state)
  const mean = amps.reduce((a, b) => a + b, 0) / amps.length
  const markedAmp = amps[marked] ?? 0
  return (
    `Signed amplitude bars for ${state.numQubits} qubits. Current phase: ${phase}. ` +
    `The marked state ${formatKet(marked, state.numQubits)} has amplitude ${markedAmp.toFixed(3)}, ` +
    `probability ${(markedAmp * markedAmp * 100).toFixed(1)} percent. ` +
    `The mean amplitude across all ${amps.length} states is ${mean.toFixed(3)}.`
  )
}
