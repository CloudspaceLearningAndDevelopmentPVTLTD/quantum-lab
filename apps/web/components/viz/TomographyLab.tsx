'use client'

import { useCallback, useEffect, useRef } from 'react'
import { readVizColors, withAlpha, mixColors, type VizColors } from './theme'
import { watchThemeChange } from './frameLoop'
import type { DensityMatrix, SingleQubitEstimate, Vec3 } from '@/lib/quantum/tomography'

/**
 * TomographyLab — the five static charts on /visualizations/state-tomography.
 *
 * None of these animate, so there is no frame loop: each chart repaints when
 * its data changes, when its container resizes, or when the theme class on
 * <html> flips. Every canvas is `role="img"` with an aria-label that states
 * the numbers it shows, and the page prints the same numbers in tables, so a
 * reader who cannot see the canvas loses nothing. prefers-reduced-motion is
 * moot here — nothing moves — but the sampling on the page is also gated so
 * that repeated experiments are a button press, never a timer.
 */

const SANS = '12px ui-sans-serif, system-ui, sans-serif'
const MONO = '11px ui-monospace, SFMono-Regular, Menlo, monospace'

type Draw = (ctx: CanvasRenderingContext2D, w: number, h: number, colors: VizColors) => void

/** Shared canvas plumbing: DPR scaling, resize, and theme repaint. */
function useChartCanvas(draw: Draw, height: number) {
  const ref = useRef<HTMLCanvasElement | null>(null)
  const drawRef = useRef(draw)
  drawRef.current = draw

  const paint = useCallback(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const w = Math.max(1, canvas.clientWidth)
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(height * dpr)
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, height)
    drawRef.current(ctx, w, height, readVizColors(canvas))
  }, [height])

  useEffect(() => {
    paint()
  }, [paint, draw])

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => paint()) : null
    ro?.observe(canvas)
    const unwatch = watchThemeChange(paint)
    return () => {
      ro?.disconnect()
      unwatch()
    }
  }, [paint])

  return ref
}

function Chart({
  draw,
  height,
  label,
  className = '',
}: {
  draw: Draw
  height: number
  label: string
  className?: string
}) {
  const ref = useChartCanvas(draw, height)
  return (
    <canvas
      ref={ref}
      role="img"
      aria-label={label}
      className={`block w-full ${className}`}
      style={{ height }}
    />
  )
}

const fmt = (v: number, d = 3) => (Number.isFinite(v) ? v.toFixed(d) : '—')

// ─────────────────────────────────────────────────────────────────────────────
// 1. Bloch components with error bars
// ─────────────────────────────────────────────────────────────────────────────

export function BlochComponentsChart({
  truth,
  estimate,
  showTruth,
}: {
  truth: Vec3
  estimate: SingleQubitEstimate | null
  showTruth: boolean
}) {
  const draw = useCallback<Draw>(
    (ctx, w, h, col) => {
      const padL = 36
      const padR = 12
      const padT = 18
      const padB = 28
      const plotW = w - padL - padR
      const plotH = h - padT - padB
      const yOf = (v: number) => padT + ((1 - v) / 2) * plotH

      // Grid: −1, −0.5, 0, 0.5, 1
      ctx.font = MONO
      ctx.textAlign = 'right'
      ctx.textBaseline = 'middle'
      for (const v of [-1, -0.5, 0, 0.5, 1]) {
        const y = yOf(v)
        ctx.strokeStyle = v === 0 ? col.lineStrong : col.line
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(padL, y)
        ctx.lineTo(w - padR, y)
        ctx.stroke()
        ctx.fillStyle = col.inkMuted
        ctx.fillText(v.toFixed(1), padL - 6, y)
      }

      const labels = ['⟨X⟩', '⟨Y⟩', '⟨Z⟩']
      const slot = plotW / 3
      const barW = Math.min(56, slot * 0.36)
      for (let i = 0; i < 3; i++) {
        const cx = padL + slot * (i + 0.5)
        // Axis label
        ctx.font = SANS
        ctx.textAlign = 'center'
        ctx.textBaseline = 'alphabetic'
        ctx.fillStyle = col.inkSecondary
        ctx.fillText(labels[i], cx, h - 8)

        // Estimate bar
        if (estimate) {
          const v = estimate.vector[i]
          const se = estimate.stderr[i]
          const y0 = yOf(0)
          const y1 = yOf(v)
          ctx.fillStyle = withAlpha(col.teal, 0.55)
          ctx.fillRect(cx - barW / 2, Math.min(y0, y1), barW, Math.abs(y1 - y0))
          ctx.strokeStyle = col.teal
          ctx.lineWidth = 1.5
          ctx.strokeRect(cx - barW / 2, Math.min(y0, y1), barW, Math.abs(y1 - y0))
          // Error bar ±1σ
          const yLo = yOf(Math.max(-1.15, v - se))
          const yHi = yOf(Math.min(1.15, v + se))
          ctx.strokeStyle = col.ink
          ctx.lineWidth = 1.5
          ctx.beginPath()
          ctx.moveTo(cx, yHi)
          ctx.lineTo(cx, yLo)
          ctx.moveTo(cx - 6, yHi)
          ctx.lineTo(cx + 6, yHi)
          ctx.moveTo(cx - 6, yLo)
          ctx.lineTo(cx + 6, yLo)
          ctx.stroke()
          ctx.font = MONO
          ctx.fillStyle = col.tealText
          ctx.textAlign = 'center'
          ctx.textBaseline = v >= 0 ? 'bottom' : 'top'
          ctx.fillText(`${v >= 0 ? '+' : ''}${v.toFixed(3)}`, cx + barW / 2 + 22, v >= 0 ? y1 - 2 : y1 + 2)
        }

        // Truth marker: a violet line across the slot
        if (showTruth) {
          const y = yOf(truth[i])
          ctx.strokeStyle = col.violet
          ctx.lineWidth = 2
          ctx.setLineDash([5, 3])
          ctx.beginPath()
          ctx.moveTo(cx - slot * 0.4, y)
          ctx.lineTo(cx + slot * 0.4, y)
          ctx.stroke()
          ctx.setLineDash([])
        }
      }

      // Legend
      ctx.font = SANS
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = col.teal
      ctx.fillRect(padL, 4, 10, 10)
      ctx.fillStyle = col.inkSecondary
      ctx.fillText('estimate ± 1σ', padL + 14, 9)
      if (showTruth) {
        ctx.strokeStyle = col.violet
        ctx.lineWidth = 2
        ctx.setLineDash([5, 3])
        ctx.beginPath()
        ctx.moveTo(padL + 120, 9)
        ctx.lineTo(padL + 140, 9)
        ctx.stroke()
        ctx.setLineDash([])
        ctx.fillStyle = col.inkSecondary
        ctx.fillText('true value', padL + 146, 9)
      }
    },
    [truth, estimate, showTruth]
  )

  const label = estimate
    ? `Bloch vector estimate: X ${fmt(estimate.vector[0])} ± ${fmt(estimate.stderr[0])}, Y ${fmt(estimate.vector[1])} ± ${fmt(estimate.stderr[1])}, Z ${fmt(estimate.vector[2])} ± ${fmt(estimate.stderr[2])}, length ${fmt(estimate.length)}.${
        showTruth ? ` True values X ${fmt(truth[0])}, Y ${fmt(truth[1])}, Z ${fmt(truth[2])}.` : ' True values hidden.'
      }`
    : 'No estimate yet.'

  return <Chart draw={draw} height={230} label={label} />
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Convergence: error vs N on log-log axes
// ─────────────────────────────────────────────────────────────────────────────

export interface SweepPoint {
  n: number
  rms: number
}

export function ConvergenceChart({
  points,
  reference,
  referenceLabel,
}: {
  points: readonly SweepPoint[]
  /** Analytic RMS at N: the 1/√N line. */
  reference: (n: number) => number
  referenceLabel: string
}) {
  const draw = useCallback<Draw>(
    (ctx, w, h, col) => {
      const padL = 44
      const padR = 14
      const padT = 14
      const padB = 30
      const plotW = w - padL - padR
      const plotH = h - padT - padB
      const nMin = 10
      const nMax = 100_000
      const eMin = 0.003
      const eMax = 2
      const xOf = (n: number) => padL + ((Math.log10(n) - Math.log10(nMin)) / (Math.log10(nMax) - Math.log10(nMin))) * plotW
      const yOf = (e: number) =>
        padT + ((Math.log10(eMax) - Math.log10(Math.max(eMin, e))) / (Math.log10(eMax) - Math.log10(eMin))) * plotH

      ctx.font = MONO
      ctx.lineWidth = 1
      for (const n of [10, 100, 1000, 10_000, 100_000]) {
        const x = xOf(n)
        ctx.strokeStyle = col.line
        ctx.beginPath()
        ctx.moveTo(x, padT)
        ctx.lineTo(x, padT + plotH)
        ctx.stroke()
        ctx.fillStyle = col.inkMuted
        ctx.textAlign = 'center'
        ctx.textBaseline = 'top'
        ctx.fillText(n >= 1000 ? `${n / 1000}k` : String(n), x, padT + plotH + 6)
      }
      for (const e of [0.01, 0.1, 1]) {
        const y = yOf(e)
        ctx.strokeStyle = col.line
        ctx.beginPath()
        ctx.moveTo(padL, y)
        ctx.lineTo(padL + plotW, y)
        ctx.stroke()
        ctx.fillStyle = col.inkMuted
        ctx.textAlign = 'right'
        ctx.textBaseline = 'middle'
        ctx.fillText(e.toString(), padL - 6, y)
      }
      ctx.font = SANS
      ctx.fillStyle = col.inkSecondary
      ctx.textAlign = 'center'
      ctx.textBaseline = 'alphabetic'
      ctx.fillText('shots per axis, N', padL + plotW / 2, h - 4)
      ctx.save()
      ctx.translate(10, padT + plotH / 2)
      ctx.rotate(-Math.PI / 2)
      ctx.fillText('RMS error of r', 0, 0)
      ctx.restore()

      // Reference 1/√N
      ctx.strokeStyle = col.violet
      ctx.lineWidth = 2
      ctx.setLineDash([6, 4])
      ctx.beginPath()
      let first = true
      for (let k = 0; k <= 60; k++) {
        const n = nMin * Math.pow(nMax / nMin, k / 60)
        const x = xOf(n)
        const y = yOf(reference(n))
        if (first) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
        first = false
      }
      ctx.stroke()
      ctx.setLineDash([])

      // Points
      for (const p of points) {
        const x = xOf(p.n)
        const y = yOf(p.rms)
        ctx.fillStyle = col.teal
        ctx.beginPath()
        ctx.arc(x, y, 4, 0, Math.PI * 2)
        ctx.fill()
        ctx.strokeStyle = col.surface2
        ctx.lineWidth = 1
        ctx.stroke()
      }

      // Legend
      ctx.font = SANS
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.strokeStyle = col.violet
      ctx.lineWidth = 2
      ctx.setLineDash([6, 4])
      ctx.beginPath()
      ctx.moveTo(padL + 8, padT + 8)
      ctx.lineTo(padL + 30, padT + 8)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.fillStyle = col.inkSecondary
      ctx.fillText(referenceLabel, padL + 36, padT + 8)
      ctx.fillStyle = col.teal
      ctx.beginPath()
      ctx.arc(padL + 19, padT + 24, 4, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = col.inkSecondary
      ctx.fillText('measured RMS error, 8 experiments per N', padL + 36, padT + 24)
    },
    [points, reference, referenceLabel]
  )

  const label =
    points.length === 0
      ? 'Convergence plot, empty until you run a sweep. Dashed line is the analytic 1 over root N reference.'
      : `Convergence plot. ${points.map((p) => `N ${p.n}: RMS error ${fmt(p.rms)} (analytic ${fmt(reference(p.n))})`).join('; ')}.`

  return <Chart draw={draw} height={220} label={label} />
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Density-matrix heat map (real part, with imaginary part as text)
// ─────────────────────────────────────────────────────────────────────────────

const KET = ['|00⟩', '|01⟩', '|10⟩', '|11⟩']

export function DensityMatrixChart({ rho, title }: { rho: DensityMatrix; title: string }) {
  const size = 188
  const draw = useCallback<Draw>(
    (ctx, w, h, col) => {
      const padL = 34
      const padT = 30
      const cell = Math.min((w - padL - 4) / 4, (h - padT - 4) / 4)
      ctx.font = SANS
      ctx.fillStyle = col.ink
      ctx.textAlign = 'left'
      ctx.textBaseline = 'top'
      ctx.fillText(title, 2, 2)
      ctx.font = MONO
      ctx.fillStyle = col.inkMuted
      for (let i = 0; i < 4; i++) {
        ctx.textAlign = 'center'
        ctx.textBaseline = 'bottom'
        ctx.fillText(KET[i], padL + cell * (i + 0.5), padT - 2)
        ctx.textAlign = 'right'
        ctx.textBaseline = 'middle'
        ctx.fillText(KET[i], padL - 3, padT + cell * (i + 0.5))
      }
      for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) {
          const { re, im } = rho.data[i * 4 + j]
          const t = Math.max(-1, Math.min(1, re))
          const color = t >= 0 ? mixColors(col.surface2, col.teal, t) : mixColors(col.surface2, col.rose, -t)
          const x = padL + cell * j
          const y = padT + cell * i
          ctx.fillStyle = color
          ctx.fillRect(x, y, cell, cell)
          ctx.strokeStyle = col.line
          ctx.lineWidth = 1
          ctx.strokeRect(x + 0.5, y + 0.5, cell - 1, cell - 1)
          ctx.fillStyle = Math.abs(t) > 0.45 ? '#ffffff' : col.ink
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.font = MONO
          ctx.fillText(re.toFixed(2), x + cell / 2, y + cell / 2 - (Math.abs(im) > 0.005 ? 6 : 0))
          if (Math.abs(im) > 0.005) {
            ctx.fillStyle = Math.abs(t) > 0.45 ? 'rgba(255,255,255,0.8)' : col.inkMuted
            ctx.fillText(`${im >= 0 ? '+' : '−'}${Math.abs(im).toFixed(2)}i`, x + cell / 2, y + cell / 2 + 7)
          }
        }
      }
    },
    [rho, title]
  )
  const diag = [0, 5, 10, 15].map((k, i) => `${KET[i]} ${rho.data[k].re.toFixed(3)}`).join(', ')
  return (
    <div style={{ width: size, flex: '0 0 auto' }}>
      <Chart draw={draw} height={size} label={`${title}: density matrix, diagonal ${diag}. Teal cells are positive real parts, rose negative.`} />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Eigenvalue strips: before and after the maximum-likelihood fix
// ─────────────────────────────────────────────────────────────────────────────

export function EigenvalueChart({
  linear,
  mle,
  truth,
}: {
  linear: readonly number[]
  mle: readonly number[]
  truth: readonly number[]
}) {
  const draw = useCallback<Draw>(
    (ctx, w, h, col) => {
      const rows: { name: string; values: readonly number[]; color: string }[] = [
        { name: 'true state', values: truth, color: col.violet },
        { name: 'linear inversion', values: linear, color: col.sky },
        { name: 'after MLE fix', values: mle, color: col.teal },
      ]
      const padL = 110
      const padR = 12
      const rowH = (h - 16) / rows.length
      const plotW = w - padL - padR
      const vMin = -0.35
      const vMax = 1.05
      const xOf = (v: number) => padL + ((v - vMin) / (vMax - vMin)) * plotW
      ctx.font = MONO
      for (const v of [-0.25, 0, 0.25, 0.5, 0.75, 1]) {
        const x = xOf(v)
        ctx.strokeStyle = v === 0 ? col.lineStrong : col.line
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(x, 8)
        ctx.lineTo(x, h - 8)
        ctx.stroke()
        ctx.fillStyle = col.inkMuted
        ctx.textAlign = 'center'
        ctx.textBaseline = 'top'
        ctx.fillText(v.toFixed(2), x, h - 8)
      }
      rows.forEach((row, r) => {
        const yc = 8 + rowH * r + rowH / 2 - 4
        ctx.font = SANS
        ctx.fillStyle = col.inkSecondary
        ctx.textAlign = 'right'
        ctx.textBaseline = 'middle'
        ctx.fillText(row.name, padL - 8, yc)
        const barH = Math.min(10, rowH / 5)
        row.values.forEach((v, k) => {
          const y = yc - (row.values.length * barH) / 2 + k * barH
          const x0 = xOf(0)
          const x1 = xOf(v)
          ctx.fillStyle = v < -1e-6 ? col.rose : row.color
          ctx.fillRect(Math.min(x0, x1), y, Math.max(1, Math.abs(x1 - x0)), barH - 1)
        })
      })
    },
    [linear, mle, truth]
  )
  const list = (v: readonly number[]) => v.map((x) => x.toFixed(3)).join(', ')
  return (
    <Chart
      draw={draw}
      height={150}
      label={`Eigenvalues. True state: ${list(truth)}. Linear inversion: ${list(linear)}${linear.some((x) => x < -1e-6) ? ' (negative values in rose are unphysical)' : ''}. After the maximum-likelihood fix: ${list(mle)}.`}
    />
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Clone fidelity against the probe angle
// ─────────────────────────────────────────────────────────────────────────────

export interface FidelityCurvePoint {
  thetaDeg: number
  joint: number
  copy: number
}

export function CloneFidelityChart({
  curve,
  bound,
  markerDeg,
}: {
  curve: readonly FidelityCurvePoint[]
  bound: (thetaDeg: number) => number
  markerDeg: number
}) {
  const draw = useCallback<Draw>(
    (ctx, w, h, col) => {
      const padL = 40
      const padR = 12
      const padT = 12
      const padB = 28
      const plotW = w - padL - padR
      const plotH = h - padT - padB
      const xOf = (deg: number) => padL + (deg / 180) * plotW
      const yOf = (f: number) => padT + (1 - Math.max(0, Math.min(1, f))) * plotH

      ctx.font = MONO
      ctx.lineWidth = 1
      for (const f of [0, 0.25, 0.5, 0.75, 1]) {
        const y = yOf(f)
        ctx.strokeStyle = col.line
        ctx.beginPath()
        ctx.moveTo(padL, y)
        ctx.lineTo(padL + plotW, y)
        ctx.stroke()
        ctx.fillStyle = col.inkMuted
        ctx.textAlign = 'right'
        ctx.textBaseline = 'middle'
        ctx.fillText(f.toFixed(2), padL - 6, y)
      }
      for (const deg of [0, 45, 90, 135, 180]) {
        const x = xOf(deg)
        ctx.strokeStyle = col.line
        ctx.beginPath()
        ctx.moveTo(x, padT)
        ctx.lineTo(x, padT + plotH)
        ctx.stroke()
        ctx.fillStyle = col.inkMuted
        ctx.textAlign = 'center'
        ctx.textBaseline = 'top'
        ctx.fillText(deg === 0 ? '|0⟩' : deg === 180 ? '|1⟩' : deg === 90 ? '90° (|+⟩)' : `${deg}°`, x, padT + plotH + 6)
      }

      // 5/6 universal line
      ctx.strokeStyle = col.amber
      ctx.setLineDash([2, 3])
      ctx.beginPath()
      ctx.moveTo(padL, yOf(5 / 6))
      ctx.lineTo(padL + plotW, yOf(5 / 6))
      ctx.stroke()
      ctx.setLineDash([])

      // Bound
      ctx.strokeStyle = col.violet
      ctx.lineWidth = 2
      ctx.setLineDash([6, 4])
      ctx.beginPath()
      for (let d = 0; d <= 180; d += 2) {
        const x = xOf(d)
        const y = yOf(bound(d))
        if (d === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()
      ctx.setLineDash([])

      const line = (key: 'joint' | 'copy', color: string) => {
        ctx.strokeStyle = color
        ctx.lineWidth = 2
        ctx.beginPath()
        curve.forEach((p, i) => {
          const x = xOf(p.thetaDeg)
          const y = yOf(p[key])
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        })
        ctx.stroke()
      }
      line('copy', col.sky)
      line('joint', col.teal)

      // Marker
      const mx = xOf(markerDeg)
      ctx.strokeStyle = col.ink
      ctx.lineWidth = 1
      ctx.setLineDash([3, 3])
      ctx.beginPath()
      ctx.moveTo(mx, padT)
      ctx.lineTo(mx, padT + plotH)
      ctx.stroke()
      ctx.setLineDash([])

      // Legend
      ctx.font = SANS
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      const items: [string, string, number[]][] = [
        [col.teal, 'joint: both outputs = |ψ⟩|ψ⟩', []],
        [col.sky, 'the copy alone', []],
        [col.violet, 'ceiling for any |0⟩,|1⟩-perfect cloner', [6, 4]],
        [col.amber, '5/6 universal', [2, 3]],
      ]
      items.forEach(([color, text, dash], i) => {
        const y = padT + 10 + i * 15
        ctx.strokeStyle = color
        ctx.lineWidth = 2
        ctx.setLineDash(dash)
        ctx.beginPath()
        ctx.moveTo(padL + 8, y)
        ctx.lineTo(padL + 28, y)
        ctx.stroke()
        ctx.setLineDash([])
        ctx.fillStyle = col.inkSecondary
        ctx.fillText(text, padL + 34, y)
      })
    },
    [curve, bound, markerDeg]
  )
  const at = curve.reduce((best, p) => (Math.abs(p.thetaDeg - markerDeg) < Math.abs(best.thetaDeg - markerDeg) ? p : best), curve[0])
  return (
    <Chart
      draw={draw}
      height={230}
      label={`Clone fidelity against the input angle from |0⟩ to |1⟩. At ${markerDeg.toFixed(0)}°: joint ${fmt(at?.joint ?? NaN)}, copy alone ${fmt(at?.copy ?? NaN)}, ceiling for a basis-perfect cloner ${fmt(bound(markerDeg))}, universal cloner 0.833.`}
    />
  )
}
