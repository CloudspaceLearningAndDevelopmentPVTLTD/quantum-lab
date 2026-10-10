'use client'

import { useEffect, useRef } from 'react'
import type { Eigenstate, Grid } from '@/lib/quantum/schrodinger'
import { readVizColors, withAlpha, type VizColors } from './theme'
import { watchThemeChange } from './frameLoop'

/**
 * BoundStatesLab — the textbook level diagram, drawn from a real eigensolve.
 *
 * Nothing here animates: the picture is a static answer to a static question, so there is
 * no frame loop to gate and prefers-reduced-motion is satisfied by construction. The
 * canvas repaints when the props change, when it is resized, and when the theme flips.
 *
 * The eigenstates arrive as a prop rather than being solved here, because the page around
 * this canvas quotes the same numbers (energies, level spacings, the probability outside
 * the walls) and two solves would be two chances to disagree.
 */

const PAD_L = 52
const PAD_R = 18
const PAD_T = 22
const PAD_B = 34

type Props = {
  grid: Grid
  potential: Float64Array
  states: Eigenstate[]
  /** Index into `states` of the level being inspected. */
  level: number
  /** Draw |ψ|² instead of ψ. */
  showDensity: boolean
  /** x positions to mark with a dashed vertical: the walls of a box, or the classical
   * turning points of the selected level. */
  markers: number[]
  /** Label of the lowest level: 1 for a box (n = 1, 2, 3…), 0 for the oscillator. */
  levelBase?: number
  /**
   * Window of x to draw, when the grid is deliberately wider than the interesting part.
   * A harmonic oscillator needs a grid out to ±12 for its tails to die, but everything
   * worth looking at happens within a few units of the origin; without this the whole
   * picture is a thin spike in the middle of an empty canvas. Defaults to the full grid.
   */
  xRange?: [number, number]
  /** Bottom of the energy axis. Below the well floor, so the floor is visible. */
  energyFloor: number
  /** Top of the energy axis. */
  energyCeiling: number
  onPickLevel?: (index: number) => void
  className?: string
}

export default function BoundStatesLab({
  grid,
  potential,
  states,
  level,
  showDensity,
  markers,
  levelBase = 1,
  xRange,
  energyFloor,
  energyCeiling,
  onPickLevel,
  className = '',
}: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const sizeRef = useRef({ w: 0, h: 0 })
  const colorsRef = useRef<VizColors | null>(null)

  // Latest props for the paint function, which is referenced by observers created once.
  const propsRef = useRef({
    grid,
    potential,
    states,
    level,
    showDensity,
    markers,
    levelBase,
    xRange,
    energyFloor,
    energyCeiling,
  })
  propsRef.current = {
    grid,
    potential,
    states,
    level,
    showDensity,
    markers,
    levelBase,
    xRange,
    energyFloor,
    energyCeiling,
  }

  const onPickRef = useRef(onPickLevel)
  onPickRef.current = onPickLevel

  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    colorsRef.current = readVizColors(wrap)

    const paint = () => {
      const { w, h } = sizeRef.current
      const colors = colorsRef.current
      if (w > 0 && h > 0 && colors) render(ctx, propsRef.current, w, h, colors)
    }

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
      paint()
    }

    const observer = new ResizeObserver(resize)
    observer.observe(wrap)
    resize()

    const stopTheme = watchThemeChange(() => {
      colorsRef.current = readVizColors(wrap)
      paint()
    })

    // A click anywhere near a level line selects it. This is a convenience on top of the
    // keyboard-operable level picker in the controls rail, never the only way in.
    const onClick = (event: MouseEvent) => {
      const pick = onPickRef.current
      const p = propsRef.current
      if (!pick || p.states.length === 0) return
      const rect = canvas.getBoundingClientRect()
      const y = event.clientY - rect.top
      const { h } = sizeRef.current
      const baseY = h - PAD_B
      const plotH = Math.max(10, baseY - PAD_T)
      const span = p.energyCeiling - p.energyFloor || 1
      const yOf = (e: number) => baseY - ((e - p.energyFloor) / span) * plotH
      let best = 0
      let bestDistance = Infinity
      for (let i = 0; i < p.states.length; i++) {
        const d = Math.abs(yOf(p.states[i].energy) - y)
        if (d < bestDistance) {
          bestDistance = d
          best = i
        }
      }
      if (bestDistance < 28) pick(best)
    }
    canvas.addEventListener('click', onClick)

    return () => {
      observer.disconnect()
      stopTheme()
      canvas.removeEventListener('click', onClick)
    }
  }, [])

  // Repaint on any prop change.
  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return
    const ctx = canvas.getContext('2d')
    const { w, h } = sizeRef.current
    const colors = colorsRef.current
    if (ctx && colors && w > 0 && h > 0) render(ctx, propsRef.current, w, h, colors)
  })

  const state = states[level]
  const label = state
    ? `Energy level diagram. Level ${level + levelBase} of ${states.length} selected, energy ` +
      `${state.energy.toFixed(3)}, with ${state.nodes} node${state.nodes === 1 ? '' : 's'}. ` +
      `The ${showDensity ? 'probability density' : 'wavefunction'} is drawn on its level line.`
    : 'Energy level diagram. This well holds no bound states.'

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

type RenderProps = {
  grid: Grid
  potential: Float64Array
  states: Eigenstate[]
  level: number
  showDensity: boolean
  markers: number[]
  levelBase: number
  xRange?: [number, number]
  energyFloor: number
  energyCeiling: number
}

function render(
  ctx: CanvasRenderingContext2D,
  p: RenderProps,
  w: number,
  h: number,
  colors: VizColors
): void {
  const { grid, potential, states, level, showDensity } = p
  const plotW = Math.max(10, w - PAD_L - PAD_R)
  const baseY = h - PAD_B
  const plotH = Math.max(10, baseY - PAD_T)
  const span = p.energyCeiling - p.energyFloor || 1

  const x0 = Math.max(grid.x[0], p.xRange ? p.xRange[0] : grid.x[0])
  const x1 = Math.min(grid.x[grid.n - 1], p.xRange ? p.xRange[1] : grid.x[grid.n - 1])
  const xOf = (x: number) => PAD_L + ((x - x0) / (x1 - x0)) * plotW
  const yOf = (e: number) => baseY - ((e - p.energyFloor) / span) * plotH

  // Draw only the visible slice of the grid, rather than drawing all of it and relying on
  // a clip: a path with thousands of off-canvas points is both slower and a hazard for the
  // fill rules below.
  const iStart = Math.max(0, Math.floor((x0 - grid.x[0]) / grid.dx))
  const iEnd = Math.min(grid.n - 1, Math.ceil((x1 - grid.x[0]) / grid.dx))

  ctx.clearRect(0, 0, w, h)
  ctx.font = '600 11px ui-monospace, SFMono-Regular, Menlo, monospace'

  const selected = states[level]

  // ── Classically forbidden region for the selected level ──────────────────────
  // Everywhere V(x) > E the particle has negative kinetic energy, which is exactly
  // where classical mechanics says it cannot be. Tinting it makes the leak visible as
  // wavefunction drawn on top of a region that is supposed to be off limits.
  if (selected) {
    ctx.fillStyle = withAlpha(colors.rose, 0.07)
    let runStart = -1
    for (let i = iStart; i <= iEnd; i++) {
      const forbidden = potential[i] > selected.energy
      if (forbidden && runStart < 0) runStart = i
      if ((!forbidden || i === iEnd) && runStart >= 0) {
        const end = forbidden ? i : i - 1
        ctx.fillRect(xOf(grid.x[runStart]), PAD_T, xOf(grid.x[end]) - xOf(grid.x[runStart]), plotH)
        runStart = -1
      }
    }
  }

  // ── Potential ────────────────────────────────────────────────────────────────
  ctx.strokeStyle = colors.amber
  ctx.lineWidth = 2
  ctx.beginPath()
  let started = false
  for (let i = iStart; i <= iEnd; i++) {
    // Above the top of the frame the curve leaves the picture. Ending the subpath draws
    // that honestly; clamping to the ceiling instead would paint a flat lid across the
    // top of every parabola.
    if (potential[i] > p.energyCeiling) {
      started = false
      continue
    }
    const px = xOf(grid.x[i])
    const py = yOf(potential[i])
    if (!started) {
      ctx.moveTo(px, py)
      started = true
    } else {
      ctx.lineTo(px, py)
    }
  }
  ctx.stroke()

  // Dashed verticals: the walls of a box, or the classical turning points of the level
  // being inspected. Drawn to the top of the frame so an infinite well reads as infinite.
  ctx.save()
  ctx.setLineDash([3, 3])
  ctx.strokeStyle = withAlpha(colors.amber, 0.45)
  ctx.lineWidth = 1
  ctx.beginPath()
  for (const marker of p.markers) {
    const mx = xOf(marker)
    if (mx < PAD_L - 1 || mx > w - PAD_R + 1) continue
    ctx.moveTo(mx, PAD_T)
    ctx.lineTo(mx, baseY)
  }
  ctx.stroke()
  ctx.restore()

  // ── Energy levels ────────────────────────────────────────────────────────────
  for (let i = 0; i < states.length; i++) {
    const y = yOf(states[i].energy)
    if (y < PAD_T - 2 || y > baseY + 2) continue
    const isSelected = i === level
    ctx.strokeStyle = isSelected ? colors.violet : withAlpha(colors.inkSecondary, 0.3)
    ctx.lineWidth = isSelected ? 2 : 1
    ctx.beginPath()
    ctx.moveTo(PAD_L, y + 0.5)
    ctx.lineTo(w - PAD_R, y + 0.5)
    ctx.stroke()

    ctx.fillStyle = isSelected ? colors.violetText : colors.inkMuted
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    ctx.fillText(`n=${i + p.levelBase}`, PAD_L - 8, y)
  }

  // ── The selected state, drawn on its own level line ───────────────────────────
  if (selected) {
    const y0 = yOf(selected.energy)
    const amplitudeH = plotH * 0.15

    if (showDensity) {
      let peak = 0
      for (let i = 0; i < grid.n; i++) peak = Math.max(peak, selected.psi[i] * selected.psi[i])
      const scale = peak > 0 ? amplitudeH / peak : 0
      ctx.beginPath()
      ctx.moveTo(xOf(grid.x[iStart]), y0)
      for (let i = iStart; i <= iEnd; i++) {
        ctx.lineTo(xOf(grid.x[i]), y0 - selected.psi[i] * selected.psi[i] * scale)
      }
      ctx.lineTo(xOf(grid.x[iEnd]), y0)
      ctx.closePath()
      ctx.fillStyle = withAlpha(colors.violet, 0.4)
      ctx.fill()
      ctx.strokeStyle = colors.violet
      ctx.lineWidth = 1.75
      ctx.stroke()
    } else {
      let peak = 0
      for (let i = 0; i < grid.n; i++) peak = Math.max(peak, Math.abs(selected.psi[i]))
      const scale = peak > 0 ? amplitudeH / peak : 0
      ctx.beginPath()
      for (let i = iStart; i <= iEnd; i++) {
        const py = y0 - selected.psi[i] * scale
        if (i === iStart) ctx.moveTo(xOf(grid.x[i]), py)
        else ctx.lineTo(xOf(grid.x[i]), py)
      }
      ctx.strokeStyle = colors.violet
      ctx.lineWidth = 1.9
      ctx.stroke()

      // Mark the nodes: the places the wavefunction is exactly zero, which is where the
      // particle is never found and the reason the levels are where they are.
      ctx.fillStyle = colors.tealText
      for (let i = Math.max(1, iStart); i <= iEnd; i++) {
        const a = selected.psi[i - 1]
        const b = selected.psi[i]
        if (a === 0 || (a > 0) === (b > 0)) continue
        if (Math.abs(a) < peak * 1e-3 && Math.abs(b) < peak * 1e-3) continue
        ctx.beginPath()
        ctx.arc(xOf(grid.x[i]), y0, 2.5, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    ctx.fillStyle = colors.violetText
    ctx.textAlign = 'left'
    ctx.textBaseline = 'bottom'
    ctx.fillText(`E = ${formatEnergy(selected.energy)}`, PAD_L + 6, y0 - amplitudeH - 5)
  }

  // ── Axis captions ────────────────────────────────────────────────────────────
  ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace'
  ctx.fillStyle = colors.inkMuted
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillText('position x →', PAD_L, baseY + 8)
  ctx.textAlign = 'right'
  ctx.fillText(showDensity ? '|ψ|² on its level' : 'ψ on its level', w - PAD_R, baseY + 8)

  ctx.save()
  ctx.translate(13, PAD_T + plotH / 2)
  ctx.rotate(-Math.PI / 2)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = colors.inkSecondary
  ctx.fillText('energy', 0, 0)
  ctx.restore()
}

function formatEnergy(e: number): number | string {
  const abs = Math.abs(e)
  if (abs >= 100) return e.toFixed(0)
  if (abs >= 10) return e.toFixed(2)
  return e.toFixed(3)
}
