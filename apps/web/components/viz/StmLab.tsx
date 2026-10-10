'use client'

import { useEffect, useRef } from 'react'
import { stmKappa } from '@/lib/quantum/alphaDecay'
import { readVizColors, withAlpha, type VizColors } from './theme'
import { watchThemeChange } from './frameLoop'

/**
 * StmLab — a tip above a corrugated surface, and the current that tunnels across the gap.
 *
 * I = I_REF · e^{−2κ(d − D_REF)}, with κ from the work function and d the local gap between
 * the tip apex and the surface underneath it. The reference current is a typical set-point
 * (1 nA at a 5 Å gap) so the numbers read as real STM numbers. The strip at the bottom is
 * what a constant-height scan across the surface would record: the atoms show up as bumps
 * in log-current, because 0.3 Å of corrugation is a factor of ~2 in current.
 *
 * Dragging the tip with a pointer is a convenience; the sliders in the controls are the
 * keyboard route and drive the same props. No animation, so nothing to gate for
 * prefers-reduced-motion.
 */

/** Surface atoms every this many ångström. */
export const STM_LATTICE_A = 2.5
/** Peak-to-trough corrugation, Å. */
export const STM_CORRUGATION_A = 0.3
/** Reference set-point: this current at D_REF. */
export const STM_I_REF_NA = 1
export const STM_D_REF_A = 5
export const STM_X_MAX_A = 20
export const STM_Z_MAX_A = 10
export const STM_Z_MIN_A = 0.5

/** Height of the surface at x (Å), about a mean plane at 0. */
export function surfaceHeight(xA: number): number {
  return (STM_CORRUGATION_A / 2) * Math.cos((2 * Math.PI * xA) / STM_LATTICE_A)
}

/** Current in nA for tip height z above the mean plane at position x. */
export function stmCurrentNa(xA: number, zA: number, workFunctionEv: number): number {
  const gap = Math.max(0, zA - surfaceHeight(xA))
  return STM_I_REF_NA * Math.exp(-2 * stmKappa(workFunctionEv) * (gap - STM_D_REF_A))
}

export function formatCurrent(nA: number): string {
  if (nA >= 1000) return `${(nA / 1000).toPrecision(3)} μA`
  if (nA >= 1) return `${nA.toPrecision(3)} nA`
  if (nA >= 1e-3) return `${(nA * 1e3).toPrecision(3)} pA`
  if (nA >= 1e-6) return `${(nA * 1e6).toPrecision(3)} fA`
  return `${nA.toExponential(2)} nA`
}

const PAD_L = 44
const PAD_R = 88
const PAD_T = 16
const PAD_B = 22
const TRACE_H = 64

type Props = {
  /** Tip position along the surface, Å. */
  x: number
  /** Tip height above the mean surface plane, Å. */
  z: number
  workFunctionEv: number
  onMove: (next: { x: number; z: number }) => void
  className?: string
}

export default function StmLab({ x, z, workFunctionEv, onMove, className = '' }: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const sizeRef = useRef({ w: 0, h: 0 })
  const colorsRef = useRef<VizColors | null>(null)
  const propsRef = useRef({ x, z, workFunctionEv })
  propsRef.current = { x, z, workFunctionEv }
  const onMoveRef = useRef(onMove)
  onMoveRef.current = onMove
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

    // Pointer drag: anywhere on the picture moves the tip there.
    let dragging = false
    const toModel = (ev: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      const { w, h } = sizeRef.current
      const geo = geometry(w, h)
      const xA = ((ev.clientX - rect.left - PAD_L) / geo.plotW) * STM_X_MAX_A
      const zA = ((geo.surfaceY - (ev.clientY - rect.top)) / geo.plotH) * STM_Z_MAX_A
      return {
        x: Math.max(0, Math.min(STM_X_MAX_A, xA)),
        z: Math.max(STM_Z_MIN_A, Math.min(STM_Z_MAX_A, zA)),
      }
    }
    const onDown = (ev: PointerEvent) => {
      dragging = true
      canvas.setPointerCapture(ev.pointerId)
      onMoveRef.current(toModel(ev))
      ev.preventDefault()
    }
    const onMovePointer = (ev: PointerEvent) => {
      if (!dragging) return
      onMoveRef.current(toModel(ev))
    }
    const onUp = (ev: PointerEvent) => {
      dragging = false
      if (canvas.hasPointerCapture(ev.pointerId)) canvas.releasePointerCapture(ev.pointerId)
    }
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMovePointer)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointercancel', onUp)

    return () => {
      observer.disconnect()
      stopTheme()
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMovePointer)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onUp)
      paintRef.current = () => {}
    }
  }, [])

  useEffect(() => {
    paintRef.current()
  }, [x, z, workFunctionEv])

  const current = stmCurrentNa(x, z, workFunctionEv)
  const label =
    `Scanning tunnelling microscope. Tip ${z.toFixed(1)} ångström above the surface at position ${x.toFixed(1)} ångström; ` +
    `work function ${workFunctionEv.toFixed(2)} eV; tunnelling current ${formatCurrent(current)}. ` +
    `Drag the tip with a pointer, or use the sliders below.`

  return (
    <div ref={wrapRef} className={`relative w-full ${className}`} style={{ height: 320 }}>
      <canvas
        ref={canvasRef}
        className="block h-full w-full cursor-grab touch-none active:cursor-grabbing"
        role="img"
        aria-label={label}
      />
    </div>
  )
}

function geometry(w: number, h: number) {
  const plotW = Math.max(10, w - PAD_L - PAD_R)
  const surfaceY = h - PAD_B - TRACE_H - 14
  const plotH = Math.max(10, surfaceY - PAD_T)
  return { plotW, plotH, surfaceY }
}

/** The whole render path, exported so it can run against a stub context in node. */
export function draw(
  ctx: CanvasRenderingContext2D,
  p: { x: number; z: number; workFunctionEv: number },
  w: number,
  h: number,
  colors: VizColors
): void {
  const { plotW, plotH, surfaceY } = geometry(w, h)
  const xOf = (xA: number) => PAD_L + (xA / STM_X_MAX_A) * plotW
  const yOf = (zA: number) => surfaceY - (zA / STM_Z_MAX_A) * plotH
  const kappa = stmKappa(p.workFunctionEv)

  ctx.clearRect(0, 0, w, h)

  // ── Height ticks ──
  ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace'
  ctx.fillStyle = colors.inkMuted
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  ctx.strokeStyle = withAlpha(colors.inkSecondary, 0.12)
  ctx.lineWidth = 1
  for (let zA = 0; zA <= STM_Z_MAX_A; zA += 2) {
    const y = Math.round(yOf(zA)) + 0.5
    ctx.fillText(`${zA} Å`, PAD_L - 6, y)
    ctx.beginPath()
    ctx.moveTo(PAD_L, y)
    ctx.lineTo(PAD_L + plotW, y)
    ctx.stroke()
  }

  // ── Surface: filled body plus atoms as bumps ──
  ctx.fillStyle = withAlpha(colors.teal, 0.16)
  ctx.beginPath()
  ctx.moveTo(xOf(0), surfaceY + 24)
  const steps = 240
  for (let i = 0; i <= steps; i++) {
    const xA = (STM_X_MAX_A * i) / steps
    ctx.lineTo(xOf(xA), yOf(surfaceHeight(xA)))
  }
  ctx.lineTo(xOf(STM_X_MAX_A), surfaceY + 24)
  ctx.closePath()
  ctx.fill()
  ctx.strokeStyle = colors.teal
  ctx.lineWidth = 1.5
  ctx.beginPath()
  for (let i = 0; i <= steps; i++) {
    const xA = (STM_X_MAX_A * i) / steps
    const px = xOf(xA)
    const py = yOf(surfaceHeight(xA))
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.stroke()
  // Atom cores.
  ctx.fillStyle = withAlpha(colors.teal, 0.5)
  for (let xA = 0; xA <= STM_X_MAX_A; xA += STM_LATTICE_A) {
    ctx.beginPath()
    ctx.arc(xOf(xA), yOf(-0.9), (plotW / STM_X_MAX_A) * 0.9, 0, Math.PI * 2)
    ctx.fill()
  }

  // ── Electron cloud leaking off the surface, shading by e^{−2κz} ──
  const gapGrad = ctx.createLinearGradient(0, yOf(0), 0, yOf(2.5))
  gapGrad.addColorStop(0, withAlpha(colors.violet, 0.28))
  gapGrad.addColorStop(1, withAlpha(colors.violet, 0))
  ctx.fillStyle = gapGrad
  ctx.fillRect(PAD_L, yOf(2.5), plotW, yOf(0) - yOf(2.5) + 2)

  // ── Tip ──
  const tipX = xOf(p.x)
  const tipY = yOf(p.z)
  const tipHalf = (plotW / STM_X_MAX_A) * 1.6
  ctx.fillStyle = withAlpha(colors.amber, 0.25)
  ctx.strokeStyle = colors.amber
  ctx.lineWidth = 1.75
  ctx.beginPath()
  ctx.moveTo(tipX, tipY)
  ctx.lineTo(tipX - tipHalf, Math.max(PAD_T, tipY - plotH * 0.45))
  ctx.lineTo(tipX - tipHalf, PAD_T - 4)
  ctx.lineTo(tipX + tipHalf, PAD_T - 4)
  ctx.lineTo(tipX + tipHalf, Math.max(PAD_T, tipY - plotH * 0.45))
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  // Apex atom.
  ctx.fillStyle = colors.amber
  ctx.beginPath()
  ctx.arc(tipX, tipY, 3.5, 0, Math.PI * 2)
  ctx.fill()

  // Gap bracket.
  const gap = Math.max(0, p.z - surfaceHeight(p.x))
  ctx.save()
  ctx.strokeStyle = withAlpha(colors.rose, 0.8)
  ctx.setLineDash([2, 3])
  ctx.beginPath()
  ctx.moveTo(tipX + 0.5, tipY)
  ctx.lineTo(tipX + 0.5, yOf(surfaceHeight(p.x)))
  ctx.stroke()
  ctx.restore()
  ctx.fillStyle = colors.roseText
  ctx.font = '600 11px ui-monospace, SFMono-Regular, Menlo, monospace'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(`d = ${gap.toFixed(2)} Å`, tipX + 8, (tipY + yOf(surfaceHeight(p.x))) / 2)

  // ── Current meter, log scale, on the right ──
  const current = stmCurrentNa(p.x, p.z, p.workFunctionEv)
  const meterX = w - PAD_R + 22
  const meterW = 14
  const meterTop = PAD_T
  const meterBottom = surfaceY
  const logMin = -6 // 1 fA
  const logMax = 3 // 1 μA
  const frac = Math.max(0, Math.min(1, (Math.log10(current) - logMin) / (logMax - logMin)))
  ctx.fillStyle = withAlpha(colors.inkSecondary, 0.1)
  ctx.fillRect(meterX, meterTop, meterW, meterBottom - meterTop)
  ctx.fillStyle = colors.violet
  const fillH = (meterBottom - meterTop) * frac
  ctx.fillRect(meterX, meterBottom - fillH, meterW, fillH)
  ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace'
  ctx.fillStyle = colors.inkMuted
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  for (const [lg, name] of [
    [3, '1 μA'],
    [0, '1 nA'],
    [-3, '1 pA'],
    [-6, '1 fA'],
  ] as const) {
    const y = meterBottom - ((lg - logMin) / (logMax - logMin)) * (meterBottom - meterTop)
    ctx.fillText(name, meterX + meterW + 4, y)
  }
  ctx.fillStyle = colors.violetText
  ctx.font = '600 11px ui-monospace, SFMono-Regular, Menlo, monospace'
  ctx.textAlign = 'right'
  ctx.textBaseline = 'bottom'
  ctx.fillText(`I = ${formatCurrent(current)}`, meterX - 6, meterTop + 12)

  // ── Constant-height trace along the bottom ──
  const traceTop = surfaceY + 30
  const traceBottom = traceTop + TRACE_H - 12
  ctx.fillStyle = colors.inkMuted
  ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'bottom'
  ctx.fillText(`log current along a scan at this height (κ = ${kappa.toFixed(2)} Å⁻¹)`, PAD_L, traceTop - 3)
  // Range: the current at the deepest and shallowest points of the corrugation.
  const iHigh = stmCurrentNa(0, p.z, p.workFunctionEv) // over an atom → smallest gap
  const iLow = stmCurrentNa(STM_LATTICE_A / 2, p.z, p.workFunctionEv)
  const lgHigh = Math.log10(iHigh)
  const lgLow = Math.log10(iLow)
  const span = Math.max(0.5, lgHigh - lgLow)
  ctx.strokeStyle = withAlpha(colors.inkSecondary, 0.12)
  ctx.beginPath()
  ctx.moveTo(PAD_L, traceBottom + 0.5)
  ctx.lineTo(PAD_L + plotW, traceBottom + 0.5)
  ctx.stroke()
  ctx.strokeStyle = colors.violet
  ctx.lineWidth = 1.75
  ctx.beginPath()
  for (let i = 0; i <= steps; i++) {
    const xA = (STM_X_MAX_A * i) / steps
    const lg = Math.log10(stmCurrentNa(xA, p.z, p.workFunctionEv))
    const y = traceBottom - ((lg - lgLow) / span) * (traceBottom - traceTop)
    if (i === 0) ctx.moveTo(xOf(xA), y)
    else ctx.lineTo(xOf(xA), y)
  }
  ctx.stroke()
  // Where the tip is now.
  const lgNow = Math.log10(current)
  ctx.fillStyle = colors.amber
  ctx.beginPath()
  ctx.arc(xOf(p.x), traceBottom - ((lgNow - lgLow) / span) * (traceBottom - traceTop), 4, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = colors.inkMuted
  ctx.textAlign = 'right'
  ctx.textBaseline = 'top'
  ctx.fillText(`×${(iHigh / iLow).toFixed(1)} atom to hollow`, PAD_L + plotW, traceBottom + 4)
  ctx.textAlign = 'left'
  ctx.fillText('x (Å) →', PAD_L, traceBottom + 4)
}
