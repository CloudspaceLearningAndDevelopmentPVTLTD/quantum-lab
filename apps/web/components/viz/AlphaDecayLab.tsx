'use client'

import { useEffect, useRef } from 'react'
import type { DisplayModel } from '@/lib/quantum/alphaDecay'
import { coulombPotential } from '@/lib/quantum/alphaDecay'
import { readVizColors, withAlpha, type VizColors } from './theme'
import { watchThemeChange } from './frameLoop'

/**
 * AlphaDecayLab — the Gamow picture: a square well, a 1/r Coulomb barrier, the alpha's
 * energy Q cutting across it, and the quasi-bound wavefunction leaking out.
 *
 * The axes are REAL: femtometres along the bottom, MeV up the side, the barrier drawn from
 * coulombPotential() for the daughter's Z and the well floor at −wellDepth. The wavefunction
 * is the display model's — the same shape and the same R/b, computed by the ħ = m = 1
 * engine, with its exponent scaled down so the leak is visible (see lib/quantum/alphaDecay.ts).
 * Its own r axis is in units of R, so it is stretched onto the fm axis by R_fm.
 *
 * Nothing animates: the picture is a static answer to a static question, so there is no
 * frame loop to gate and prefers-reduced-motion is satisfied by construction.
 */

const PAD_L = 50
const PAD_R = 16
const PAD_T = 20
const PAD_B = 34

type Props = {
  /** Daughter proton number, for the barrier. */
  Zd: number
  /** Nuclear radius, fm. */
  R: number
  /** Turning point, fm. */
  b: number
  /** Alpha energy, MeV. */
  q: number
  /** Well depth, MeV (drawn as the floor). */
  wellDepth: number
  /** The scaled wavefunction, or null while it is being built. */
  model: DisplayModel | null
  nuclideLabel: string
  className?: string
}

export default function AlphaDecayLab({
  Zd,
  R,
  b,
  q,
  wellDepth,
  model,
  nuclideLabel,
  className = '',
}: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const sizeRef = useRef({ w: 0, h: 0 })
  const colorsRef = useRef<VizColors | null>(null)
  const propsRef = useRef({ Zd, R, b, q, wellDepth, model })
  propsRef.current = { Zd, R, b, q, wellDepth, model }
  const paintRef = useRef<() => void>(() => {})

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
      if (w > 0 && h > 0 && colors) draw(ctx, propsRef.current, w, h, colors)
    }
    paintRef.current = paint

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
    return () => {
      observer.disconnect()
      stopTheme()
      paintRef.current = () => {}
    }
  }, [])

  // Repaint whenever the physics changes.
  useEffect(() => {
    paintRef.current()
  }, [Zd, R, b, q, wellDepth, model])

  const label =
    `${nuclideLabel}: a nuclear well ${wellDepth.toFixed(0)} MeV deep out to ${R.toFixed(1)} fm, ` +
    `then a Coulomb barrier ${coulombPotential(Zd, R).toFixed(0)} MeV high at the surface falling as 1/r. ` +
    `The alpha's energy of ${q.toFixed(2)} MeV meets the barrier again at ${b.toFixed(0)} fm. ` +
    `The wavefunction oscillates inside the well, decays through the barrier and emerges outside with a small amplitude.`

  return (
    <div ref={wrapRef} className={`relative w-full ${className}`} style={{ height: 400 }}>
      <canvas ref={canvasRef} className="block h-full w-full" role="img" aria-label={label} />
    </div>
  )
}

export type AlphaScene = {
  Zd: number
  R: number
  b: number
  q: number
  wellDepth: number
  model: DisplayModel | null
}

/** The whole render path, exported so it can run against a stub context in node. */
export function draw(
  ctx: CanvasRenderingContext2D,
  p: AlphaScene,
  w: number,
  h: number,
  colors: VizColors
): void {
  const plotW = Math.max(10, w - PAD_L - PAD_R)
  const plotH = Math.max(10, h - PAD_T - PAD_B)
  const bottom = h - PAD_B

  // r axis: 0 to the model's grid length (in R units) if there is one, else 2.2b.
  const rMax = p.model ? (p.model.grid.x[p.model.grid.n - 1] + p.model.grid.dx) * p.R : 2.2 * p.b
  const xOf = (rFm: number) => PAD_L + (rFm / rMax) * plotW

  // Energy axis: from a little under the well floor to a little over the barrier top.
  const barrierTop = coulombPotential(p.Zd, p.R)
  const eMin = -p.wellDepth * 1.12
  const eMax = barrierTop * 1.18
  const yOf = (e: number) => bottom - ((e - eMin) / (eMax - eMin)) * plotH

  ctx.clearRect(0, 0, w, h)

  // ── Grid lines and axes ──
  ctx.strokeStyle = withAlpha(colors.inkSecondary, 0.14)
  ctx.lineWidth = 1
  const zeroY = yOf(0)
  ctx.beginPath()
  ctx.moveTo(PAD_L, Math.round(zeroY) + 0.5)
  ctx.lineTo(w - PAD_R, Math.round(zeroY) + 0.5)
  ctx.stroke()

  ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace'
  ctx.fillStyle = colors.inkMuted
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  const ticks = [-p.wellDepth, 0, Math.round(barrierTop / 10) * 10]
  for (const e of ticks) {
    const y = yOf(e)
    ctx.fillText(`${e.toFixed(0)}`, PAD_L - 6, y)
    ctx.beginPath()
    ctx.moveTo(PAD_L - 3, Math.round(y) + 0.5)
    ctx.lineTo(PAD_L, Math.round(y) + 0.5)
    ctx.stroke()
  }
  ctx.save()
  ctx.translate(12, PAD_T + plotH / 2)
  ctx.rotate(-Math.PI / 2)
  ctx.textAlign = 'center'
  ctx.fillText('energy (MeV)', 0, 0)
  ctx.restore()

  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  const rStep = rMax > 120 ? 40 : rMax > 60 ? 20 : 10
  for (let r = 0; r <= rMax; r += rStep) {
    ctx.fillText(`${r}`, xOf(r), bottom + 6)
  }
  ctx.textAlign = 'right'
  ctx.fillText('r (fm)', w - PAD_R, bottom + 18)

  // ── Potential: well floor, wall, Coulomb tail ──
  const shade = withAlpha(colors.amber, 0.14)
  ctx.fillStyle = shade
  ctx.beginPath()
  ctx.moveTo(xOf(p.R), bottom)
  ctx.lineTo(xOf(p.R), yOf(barrierTop))
  const steps = 200
  for (let i = 1; i <= steps; i++) {
    const r = p.R + ((rMax - p.R) * i) / steps
    ctx.lineTo(xOf(r), yOf(coulombPotential(p.Zd, r)))
  }
  ctx.lineTo(xOf(rMax), bottom)
  ctx.closePath()
  ctx.fill()

  ctx.strokeStyle = colors.amber
  ctx.lineWidth = 1.75
  ctx.beginPath()
  ctx.moveTo(xOf(0), yOf(-p.wellDepth))
  ctx.lineTo(xOf(p.R), yOf(-p.wellDepth))
  ctx.lineTo(xOf(p.R), yOf(barrierTop))
  for (let i = 1; i <= steps; i++) {
    const r = p.R + ((rMax - p.R) * i) / steps
    ctx.lineTo(xOf(r), yOf(coulombPotential(p.Zd, r)))
  }
  ctx.stroke()

  // ── Q line, from the well out to the turning point and faintly beyond ──
  const qy = yOf(p.q)
  ctx.save()
  ctx.strokeStyle = colors.sky
  ctx.lineWidth = 1.25
  ctx.setLineDash([5, 4])
  ctx.beginPath()
  ctx.moveTo(xOf(0), Math.round(qy) + 0.5)
  ctx.lineTo(w - PAD_R, Math.round(qy) + 0.5)
  ctx.stroke()
  ctx.restore()

  // Turning point marker.
  ctx.save()
  ctx.strokeStyle = withAlpha(colors.rose, 0.7)
  ctx.setLineDash([2, 3])
  ctx.beginPath()
  ctx.moveTo(Math.round(xOf(p.b)) + 0.5, qy)
  ctx.lineTo(Math.round(xOf(p.b)) + 0.5, bottom)
  ctx.stroke()
  ctx.restore()

  // ── The wavefunction, on its own scale around the Q line ──
  const m = p.model
  if (m) {
    const amp = Math.min(plotH * 0.22, (qy - PAD_T) * 0.9, (bottom - qy) * 0.9)
    ctx.strokeStyle = colors.violet
    ctx.lineWidth = 1.75
    ctx.beginPath()
    for (let i = 0; i < m.grid.n; i++) {
      const x = xOf(m.grid.x[i] * p.R)
      const y = qy - m.psi[i] * amp
      if (i === 0) ctx.moveTo(xOf(0), qy)
      ctx.lineTo(x, y)
    }
    ctx.stroke()

    // Fill under the interior half-wave so the "inside" reads as a lump.
    ctx.fillStyle = withAlpha(colors.violet, 0.18)
    ctx.beginPath()
    ctx.moveTo(xOf(0), qy)
    for (let i = 0; i < m.grid.n && m.grid.x[i] <= m.R; i++) {
      ctx.lineTo(xOf(m.grid.x[i] * p.R), qy - m.psi[i] * amp)
    }
    ctx.lineTo(xOf(p.R), qy)
    ctx.closePath()
    ctx.fill()
  }

  // ── Labels ──
  ctx.font = '600 11px ui-monospace, SFMono-Regular, Menlo, monospace'
  ctx.textBaseline = 'bottom'
  ctx.textAlign = 'left'
  ctx.fillStyle = colors.amberText
  ctx.fillText(`V(R) = ${barrierTop.toFixed(1)} MeV`, xOf(p.R) + 6, yOf(barrierTop) - 4)
  ctx.fillStyle = colors.skyText
  ctx.textAlign = 'right'
  ctx.fillText(`Q = ${p.q.toFixed(2)} MeV`, w - PAD_R - 2, qy - 4)
  ctx.fillStyle = colors.roseText
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.fillText(`b = ${p.b.toFixed(0)} fm`, xOf(p.b), qy + 6)
  ctx.fillStyle = colors.amberText
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillText(`R = ${p.R.toFixed(1)} fm`, xOf(p.R) + 6, yOf(-p.wellDepth) - 14)
  if (m) {
    ctx.fillStyle = colors.violetText
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.fillText('ψ (scaled barrier)', PAD_L + 4, PAD_T)
  }
}
