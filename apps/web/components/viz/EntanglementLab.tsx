'use client'

import { useEffect, useRef } from 'react'
import type { StateVector } from '@/lib/quantum'

/**
 * EntanglementLab — 2D canvas picture of a two-qubit state.
 *
 * Two orbs (A = qubit 0, B = qubit 1) show each qubit's marginal P(1) as a
 * rising fill level. The link between them encodes the entanglement entropy:
 * a faint grey dashed thread at 0 bits, morphing continuously into a thick
 * glowing teal beam with pulses running back and forth at 1 bit.
 *
 * The component is purely presentational: when a measurement collapses the
 * state, the caller hands us a new StateVector and the partner orb changes
 * because its marginal really did change.
 */

const FALLBACK_INK = '#eef2ff'
const FALLBACK_INK_SECONDARY = '#8fa3c8'
const FALLBACK_INK_MUTED = '#7d8cb0'
const FALLBACK_TEAL = '#4edbca'
const FALLBACK_TEAL_LIGHT = '#8ae8da'
const FALLBACK_VIOLET = '#a99dff'
const FALLBACK_VIOLET_LIGHT = '#c1bbfe'
const FALLBACK_SURFACE = '#0d1120'
const FALLBACK_SURFACE_2 = '#141a2c'
const FALLBACK_SURFACE_3 = '#1b2338'
const FALLBACK_LINE_STRONG = 'rgba(255, 255, 255, 0.13)'

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

type Colors = {
  ink: string
  inkSecondary: string
  inkMuted: string
  teal: string
  tealLight: string
  violet: string
  violetLight: string
  surface: string
  surface2: string
  surface3: string
  lineStrong: string
}

/** Resolve every colour this component needs from the current theme's CSS custom properties. */
function readColors(el: HTMLElement): Colors {
  const css = window.getComputedStyle(el)
  return {
    ink: css.getPropertyValue('--ink').trim() || FALLBACK_INK,
    inkSecondary: css.getPropertyValue('--ink-secondary').trim() || FALLBACK_INK_SECONDARY,
    inkMuted: css.getPropertyValue('--ink-muted').trim() || FALLBACK_INK_MUTED,
    teal: css.getPropertyValue('--q-teal').trim() || FALLBACK_TEAL,
    tealLight: css.getPropertyValue('--q-teal-text').trim() || FALLBACK_TEAL_LIGHT,
    violet: css.getPropertyValue('--q-violet').trim() || FALLBACK_VIOLET,
    violetLight: css.getPropertyValue('--q-violet-text').trim() || FALLBACK_VIOLET_LIGHT,
    surface: css.getPropertyValue('--surface').trim() || FALLBACK_SURFACE,
    surface2: css.getPropertyValue('--surface-2').trim() || FALLBACK_SURFACE_2,
    surface3: css.getPropertyValue('--surface-3').trim() || FALLBACK_SURFACE_3,
    lineStrong: css.getPropertyValue('--line-strong').trim() || FALLBACK_LINE_STRONG,
  }
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

/** Blend two hex colours in sRGB. */
function mixHex(from: string, to: string, t: number): string {
  const parse = (h: string) => [
    parseInt(h.slice(1, 3), 16),
    parseInt(h.slice(3, 5), 16),
    parseInt(h.slice(5, 7), 16),
  ]
  const [r1, g1, b1] = parse(from)
  const [r2, g2, b2] = parse(to)
  const r = Math.round(lerp(r1, r2, t))
  const g = Math.round(lerp(g1, g2, t))
  const b = Math.round(lerp(b1, b2, t))
  return `rgb(${r}, ${g}, ${b})`
}

interface OrbInput {
  name: string
  p1: number
  measured: 0 | 1 | null
  /** Timestamp (ms, performance.now) of the last measurement, or null. */
  flashAt: number | null
}

/** Everything the render loop needs, refreshed on every React render. */
interface Frame {
  entropy: number
  orbs: [OrbInput, OrbInput]
}

export function EntanglementLab({
  state,
  measuredA,
  measuredB,
  className,
}: {
  state: StateVector
  measuredA: 0 | 1 | null
  measuredB: 0 | 1 | null
  className?: string
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  const pA = state.qubitProbability(0)
  const pB = state.qubitProbability(1)
  const entropy = state.entanglementEntropy(0)

  // Previous measurement values, so a change can trigger the flash ring.
  const prevA = useRef<0 | 1 | null>(measuredA)
  const prevB = useRef<0 | 1 | null>(measuredB)
  const flashA = useRef<number | null>(null)
  const flashB = useRef<number | null>(null)

  const now = typeof performance !== 'undefined' ? performance.now() : 0
  if (prevA.current !== measuredA) {
    prevA.current = measuredA
    flashA.current = measuredA === null ? null : now
  }
  if (prevB.current !== measuredB) {
    prevB.current = measuredB
    flashB.current = measuredB === null ? null : now
  }

  const frameRef = useRef<Frame>({
    entropy,
    orbs: [
      { name: 'A', p1: pA, measured: measuredA, flashAt: flashA.current },
      { name: 'B', p1: pB, measured: measuredB, flashAt: flashB.current },
    ],
  })
  frameRef.current = {
    entropy,
    orbs: [
      { name: 'A', p1: pA, measured: measuredA, flashAt: flashA.current },
      { name: 'B', p1: pB, measured: measuredB, flashAt: flashB.current },
    ],
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const reduceMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    let cssW = canvas.clientWidth || 1
    let cssH = canvas.clientHeight || 1

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      cssW = canvas.clientWidth || 1
      cssH = canvas.clientHeight || 1
      canvas.width = Math.round(cssW * dpr)
      canvas.height = Math.round(cssH * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()

    // Canvas cannot read CSS custom properties directly, so resolve them here and
    // again whenever the theme class on <html> changes.
    let colors = readColors(canvas)

    /** Smoothed fill levels so probabilities glide rather than jump. */
    const shown: [number, number] = [frameRef.current.orbs[0].p1, frameRef.current.orbs[1].p1]

    const drawOrb = (
      orb: OrbInput,
      level: number,
      cx: number,
      cy: number,
      r: number,
      t: number,
      accent: string,
      accentLight: string
    ) => {
      // Shell
      ctx.save()
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.fillStyle = colors.surface2
      ctx.fill()
      ctx.clip()

      // Fill level rising from the bottom of the circle
      const top = cy + r - 2 * r * level
      ctx.fillStyle = accent
      ctx.globalAlpha = orb.measured === null ? 0.55 : 0.8
      ctx.fillRect(cx - r, top, r * 2, cy + r - top)

      // A gentle surface wave on the liquid line
      if (level > 0.001 && level < 0.999) {
        ctx.globalAlpha = 0.95
        ctx.beginPath()
        ctx.moveTo(cx - r, top)
        for (let x = -r; x <= r; x += 3) {
          const wave = reduceMotion ? 0 : Math.sin(x * 0.06 + t * 2.2) * 2.4
          ctx.lineTo(cx + x, top + wave)
        }
        ctx.lineTo(cx + r, cy + r)
        ctx.lineTo(cx - r, cy + r)
        ctx.closePath()
        ctx.fillStyle = accentLight
        ctx.globalAlpha = 0.22
        ctx.fill()
      }
      ctx.restore()

      // Rim
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.strokeStyle = orb.measured === null ? colors.lineStrong : accentLight
      ctx.lineWidth = orb.measured === null ? 1.5 : 2.5
      ctx.stroke()

      // Measured numeral
      if (orb.measured !== null) {
        ctx.fillStyle = orb.measured === 1 ? colors.surface : accentLight
        ctx.font = `bold ${Math.round(r * 1.15)}px ui-monospace, SFMono-Regular, Menlo, monospace`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(String(orb.measured), cx, cy + 1)
      }

      // One-shot expanding ring at the moment of measurement
      if (orb.flashAt !== null) {
        const age = (performance.now() - orb.flashAt) / 620
        if (age >= 0 && age < 1) {
          ctx.save()
          ctx.beginPath()
          ctx.arc(cx, cy, r + age * r * 0.85, 0, Math.PI * 2)
          ctx.strokeStyle = accentLight
          ctx.globalAlpha = (1 - age) * 0.85
          ctx.lineWidth = 4 * (1 - age) + 1
          ctx.stroke()
          ctx.restore()
        }
      }

      // Labels
      ctx.textAlign = 'center'
      ctx.textBaseline = 'alphabetic'
      ctx.fillStyle = colors.ink
      ctx.font = 'bold 15px ui-sans-serif, system-ui, sans-serif'
      ctx.fillText(orb.name, cx, cy - r - 16)

      ctx.fillStyle = colors.inkSecondary
      ctx.font = '12px ui-monospace, SFMono-Regular, Menlo, monospace'
      const readout =
        orb.measured === null
          ? `P(1) = ${(orb.p1 * 100).toFixed(0)}%`
          : `measured ${orb.measured}`
      ctx.fillText(readout, cx, cy + r + 24)
    }

    const draw = (t: number) => {
      const { entropy: e, orbs } = frameRef.current
      const w = cssW
      const h = cssH

      ctx.clearRect(0, 0, w, h)

      const cy = h * 0.47
      const ax = w / 3
      const bx = (w * 2) / 3
      const r = Math.max(28, Math.min(w * 0.11, h * 0.24))

      // Approach the target levels smoothly (instant when motion is reduced).
      for (let i = 0; i < 2; i++) {
        const orb = orbs[i]
        const target: number = orb.measured === null ? orb.p1 : orb.measured
        shown[i] = reduceMotion ? target : lerp(shown[i], target, 0.18)
      }

      // ── Link ────────────────────────────────────────────────
      const x0 = ax + r
      const x1 = bx - r
      const span = Math.max(1, x1 - x0)
      const strength = Math.max(0, Math.min(1, e))

      ctx.save()
      // Glow halo grows with entropy
      if (strength > 0.02) {
        ctx.strokeStyle = colors.teal
        ctx.globalAlpha = 0.1 + strength * 0.22
        ctx.lineWidth = 6 + strength * 22
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(x0, cy)
        ctx.lineTo(x1, cy)
        ctx.stroke()
      }

      // Core line: dashed grey → solid teal beam
      ctx.globalAlpha = 0.4 + strength * 0.6
      ctx.strokeStyle = mixHex(colors.inkMuted, colors.tealLight, strength)
      ctx.lineWidth = lerp(1.2, 6, strength)
      ctx.lineCap = 'round'
      const dashGap = lerp(9, 0.001, strength)
      ctx.setLineDash(strength > 0.985 ? [] : [lerp(5, 60, strength), dashGap])
      ctx.lineDashOffset = reduceMotion ? 0 : -t * 18 * strength
      ctx.beginPath()
      ctx.moveTo(x0, cy)
      ctx.lineTo(x1, cy)
      ctx.stroke()
      ctx.setLineDash([])

      // Pulses travelling back and forth along the beam
      if (strength > 0.05 && !reduceMotion) {
        const pulses = 3
        for (let i = 0; i < pulses; i++) {
          const phase = (t * 0.55 + i / pulses) % 1
          // Triangle wave: 0 → 1 → 0, so pulses bounce between the orbs.
          const u = phase < 0.5 ? phase * 2 : 2 - phase * 2
          const px = x0 + u * span
          const rad = (2 + strength * 5) * (0.6 + 0.4 * Math.sin(phase * Math.PI * 2))
          const grad = ctx.createRadialGradient(px, cy, 0, px, cy, rad * 3)
          grad.addColorStop(0, colors.tealLight)
          grad.addColorStop(1, withAlpha(colors.teal, 0))
          ctx.globalAlpha = strength
          ctx.fillStyle = grad
          ctx.beginPath()
          ctx.arc(px, cy, rad * 3, 0, Math.PI * 2)
          ctx.fill()
        }
      }
      ctx.restore()

      // Entropy caption under the link
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.fillStyle =
        strength > 0.05 ? mixHex(colors.inkMuted, colors.tealLight, strength) : colors.inkMuted
      ctx.font = '12px ui-monospace, SFMono-Regular, Menlo, monospace'
      ctx.fillText(`entanglement ${e.toFixed(2)} bits`, (x0 + x1) / 2, cy + 18)

      // Entropy meter — a thin bar so 0 vs 1 is readable without colour
      const meterW = Math.min(span * 0.8, 150)
      const meterX = (x0 + x1) / 2 - meterW / 2
      const meterY = cy + 40
      ctx.fillStyle = colors.surface3
      ctx.fillRect(meterX, meterY, meterW, 4)
      ctx.fillStyle = mixHex(colors.inkMuted, colors.teal, strength)
      ctx.fillRect(meterX, meterY, meterW * strength, 4)

      // ── Orbs (drawn last so the link passes behind them) ────
      drawOrb(orbs[0], shown[0], ax, cy, r, t, colors.violet, colors.violetLight)
      drawOrb(orbs[1], shown[1], bx, cy, r, t, colors.violet, colors.violetLight)
    }

    let raf = 0
    const start = performance.now()

    const loop = () => {
      draw((performance.now() - start) / 1000)
      raf = requestAnimationFrame(loop)
    }

    // ── Frame-loop gating: pause while off-screen or the page/tab is hidden ──
    let pageVisible = typeof document === 'undefined' || !document.hidden
    let onScreen = true
    const shouldRun = () => pageVisible && onScreen

    const startLoop = (): void => {
      if (raf === 0 && !reduceMotion && shouldRun()) {
        raf = requestAnimationFrame(loop)
      }
    }
    const stopLoop = (): void => {
      if (raf !== 0) {
        cancelAnimationFrame(raf)
        raf = 0
      }
    }

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
    visibilityObserver?.observe(canvas)

    // Re-read the theme's colours whenever <html>'s class changes, and repaint
    // once immediately so a toggle is reflected even while paused or hidden.
    const themeObserver =
      typeof MutationObserver === 'function'
        ? new MutationObserver(() => {
            colors = readColors(canvas)
            if (shouldRun()) draw((performance.now() - start) / 1000)
          })
        : null
    themeObserver?.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })

    const observer = new ResizeObserver(() => {
      resize()
      if (reduceMotion) draw((performance.now() - start) / 1000)
    })
    observer.observe(canvas)

    if (reduceMotion) {
      draw(0)
    } else {
      startLoop()
    }

    // Static mode still needs a redraw when the props change.
    const redrawTimer = reduceMotion
      ? window.setInterval(() => draw((performance.now() - start) / 1000), 200)
      : 0

    return () => {
      stopLoop()
      if (redrawTimer) window.clearInterval(redrawTimer)
      observer.disconnect()
      document.removeEventListener('visibilitychange', onVisibilityChange)
      visibilityObserver?.disconnect()
      themeObserver?.disconnect()
    }
  }, [])

  const describe = (name: string, p: number, m: 0 | 1 | null) =>
    m === null ? `${name} has P(1) = ${(p * 100).toFixed(0)} percent` : `${name} measured ${m}`

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={`Two entangled qubits. ${describe('Qubit A', pA, measuredA)}. ${describe(
        'Qubit B',
        pB,
        measuredB
      )}. Entanglement entropy ${entropy.toFixed(2)} bits.`}
      className={`block w-full min-h-[360px] ${className ?? ''}`}
    />
  )
}

export default EntanglementLab
