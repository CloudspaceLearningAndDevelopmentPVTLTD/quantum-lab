'use client'

import { useEffect, useRef } from 'react'
import {
  VISIBLE_BAND_NM,
  planckExitancePerNm,
  plotRangeNm,
  rayleighJeansExitancePerNm,
  wienPeakWavelengthNm,
} from '@/lib/viz/blackbody'
import { wavelengthToCss } from '@/lib/viz/spectralColor'
import { readVizColors, withAlpha, type VizColors } from './theme'
import {
  createFrameLoop,
  domIntersectionWatcher,
  prefersReducedMotion,
  watchThemeChange,
  type FrameLoop,
} from './frameLoop'

/**
 * BlackbodyLab — the Planck curve and the classical prediction it replaced, on one
 * pair of axes.
 *
 * Both curves are sampled directly from lib/viz/blackbody.ts at the temperature on
 * screen; nothing here is a stylised shape. The y axis is normalised to the Planck
 * peak, with the absolute peak value printed beside it, because the two curves differ
 * by twenty orders of magnitude at the left edge and no linear axis can hold that.
 * Rayleigh–Jeans is therefore drawn CLIPPED at the top of the frame — the flat run
 * along the ceiling is the ultraviolet catastrophe, not a rendering artefact, and it
 * is labelled as heading to infinity rather than quietly cropped.
 *
 * The wavelength window follows the temperature (Wien peak / 8 to peak × 6), so the
 * shape stays legible from the 2.7 K microwave background out to a blue star. The only
 * animation is the temperature easing between settings, in log space so a jump from
 * 2.7 K to 5778 K reads as a smooth sweep rather than a snap at the end; under
 * prefers-reduced-motion the ease is skipped entirely and the curve is redrawn once.
 */

const PAD_L = 54
const PAD_R = 20
const PAD_T = 30
const PAD_B = 46
/** Samples across the plot. Enough that the Planck peak is smooth at any width. */
const SAMPLES = 420
/** Head-room above the Planck peak, in units of that peak. */
const Y_MAX = 1.18

type Props = {
  temperatureK: number
  showClassical: boolean
  logScale: boolean
  className?: string
}

export default function BlackbodyLab({
  temperatureK,
  showClassical,
  logScale,
  className = '',
}: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const sizeRef = useRef({ w: 0, h: 0 })
  const loopRef = useRef<FrameLoop | null>(null)
  /** The temperature actually on screen, eased in log space towards the prop. */
  const displayLogRef = useRef(Math.log(Math.max(1e-3, temperatureK)))

  const propsRef = useRef({ temperatureK, showClassical, logScale })
  propsRef.current = { temperatureK, showClassical, logScale }

  useEffect(() => {
    loopRef.current?.start()
  }, [temperatureK, showClassical, logScale])

  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const reduceMotion = prefersReducedMotion()
    let colors = readVizColors(wrap)
    let lastTime = 0

    const onFrame = (now: number): boolean => {
      const p = propsRef.current
      const target = Math.log(Math.max(1e-3, p.temperatureK))
      const dt = lastTime === 0 ? 0.016 : Math.min((now - lastTime) / 1000, 0.05)
      lastTime = now

      let more = false
      if (reduceMotion) {
        displayLogRef.current = target
      } else {
        const diff = target - displayLogRef.current
        if (Math.abs(diff) < 1e-4) {
          displayLogRef.current = target
        } else {
          displayLogRef.current += diff * Math.min(1, dt * 7)
          more = true
        }
      }

      const { w, h } = sizeRef.current
      if (w > 0 && h > 0) {
        renderBlackbodyPlot(ctx, Math.exp(displayLogRef.current), p, w, h, colors)
      }
      return more
    }

    const loop = createFrameLoop(window, document, domIntersectionWatcher(wrap), onFrame)
    loopRef.current = loop

    const repaint = (): void => {
      const { w, h } = sizeRef.current
      if (w > 0 && h > 0) {
        renderBlackbodyPlot(ctx, Math.exp(displayLogRef.current), propsRef.current, w, h, colors)
      }
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

  return (
    <div ref={wrapRef} className={`relative w-full ${className}`} style={{ height: 420 }}>
      <canvas
        ref={canvasRef}
        className="block h-full w-full"
        role="img"
        aria-label={describe(temperatureK, showClassical)}
      />
    </div>
  )
}

function describe(temperatureK: number, showClassical: boolean): string {
  const peak = wienPeakWavelengthNm(temperatureK)
  const where =
    peak < VISIBLE_BAND_NM.min
      ? 'in the ultraviolet, past the short edge of vision'
      : peak > VISIBLE_BAND_NM.max
        ? 'in the infrared, past the long edge of vision'
        : 'inside the visible band'
  const classical = showClassical
    ? ' The classical Rayleigh–Jeans curve is drawn alongside it: the two agree at long wavelengths and then the classical one climbs off the top of the frame towards infinity as the wavelength shortens.'
    : ''
  return (
    `Spectral exitance against wavelength for a blackbody at ${formatTemperature(temperatureK)}. ` +
    `The Planck curve rises to a single peak at ${formatWavelength(peak)}, ${where}, and falls ` +
    `away on both sides.${classical}`
  )
}

function formatTemperature(k: number): string {
  if (k < 10) return `${k.toFixed(1)} kelvin`
  return `${Math.round(k).toLocaleString('en-US')} kelvin`
}

/** A wavelength in the unit a reader would actually use for it. */
export function formatWavelength(nm: number): string {
  if (!Number.isFinite(nm)) return '—'
  if (nm < 1) return `${nm.toPrecision(2)} nm`
  if (nm < 1000) return `${nm < 10 ? nm.toFixed(1) : Math.round(nm)} nm`
  if (nm < 1e6) return `${(nm / 1000).toFixed(nm < 1e4 ? 2 : 1)} µm`
  return `${(nm / 1e6).toFixed(2)} mm`
}

function linearTicks(min: number, max: number, target = 6): number[] {
  const raw = (max - min) / target
  if (!(raw > 0)) return [min]
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const norm = raw / mag
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag
  const out: number[] = []
  for (let v = Math.ceil(min / step) * step; v <= max; v += step) out.push(v)
  return out
}

function logTicks(min: number, max: number): number[] {
  const out: number[] = []
  for (let d = Math.floor(Math.log10(min)); d <= Math.ceil(Math.log10(max)); d++) {
    for (const m of [1, 2, 5]) {
      const v = m * Math.pow(10, d)
      if (v >= min && v <= max) out.push(v)
    }
  }
  return out
}

export function renderBlackbodyPlot(
  ctx: CanvasRenderingContext2D,
  temperatureK: number,
  props: { showClassical: boolean; logScale: boolean },
  w: number,
  h: number,
  colors: VizColors
): void {
  const { showClassical, logScale } = props
  ctx.clearRect(0, 0, w, h)

  const plotW = Math.max(20, w - PAD_L - PAD_R)
  const plotH = Math.max(20, h - PAD_T - PAD_B)
  const baseY = PAD_T + plotH
  const mono = (size: number, weight = '600') =>
    `${weight} ${size}px ui-monospace, SFMono-Regular, Menlo, monospace`

  const { fromNm, toNm } = plotRangeNm(temperatureK)
  const logFrom = Math.log(fromNm)
  const logTo = Math.log(toNm)
  const xOf = (nm: number): number =>
    logScale
      ? PAD_L + ((Math.log(nm) - logFrom) / (logTo - logFrom)) * plotW
      : PAD_L + ((nm - fromNm) / (toNm - fromNm)) * plotW
  const nmAt = (i: number): number => {
    const t = i / (SAMPLES - 1)
    return logScale ? Math.exp(logFrom + (logTo - logFrom) * t) : fromNm + (toNm - fromNm) * t
  }

  const peakNm = wienPeakWavelengthNm(temperatureK)
  const peakValue = planckExitancePerNm(peakNm, temperatureK)
  const scale = peakValue > 0 ? peakValue : 1
  const yOf = (relative: number): number => baseY - Math.min(relative, Y_MAX) * (plotH / Y_MAX)

  // ── Grid and axes ──
  ctx.strokeStyle = withAlpha(colors.inkMuted, 0.12)
  ctx.lineWidth = 1
  ctx.font = mono(10, '400')
  ctx.fillStyle = colors.inkMuted
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  const ticks = logScale ? logTicks(fromNm, toNm) : linearTicks(fromNm, toNm)
  for (const nm of ticks) {
    const x = Math.round(xOf(nm)) + 0.5
    if (x < PAD_L - 1 || x > PAD_L + plotW + 1) continue
    ctx.beginPath()
    ctx.moveTo(x, PAD_T)
    ctx.lineTo(x, baseY)
    ctx.stroke()
    ctx.fillText(formatWavelength(nm), x, baseY + 7)
  }
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  for (const rel of [0, 0.25, 0.5, 0.75, 1]) {
    const y = Math.round(yOf(rel)) + 0.5
    ctx.beginPath()
    ctx.moveTo(PAD_L, y)
    ctx.lineTo(PAD_L + plotW, y)
    ctx.stroke()
    ctx.fillText(rel.toFixed(2), PAD_L - 8, y)
  }

  // ── Visible band, shaded with its own colours ──
  const bandFrom = Math.max(fromNm, VISIBLE_BAND_NM.min)
  const bandTo = Math.min(toNm, VISIBLE_BAND_NM.max)
  if (bandTo > bandFrom) {
    const steps = 40
    for (let i = 0; i < steps; i++) {
      const a = bandFrom + ((bandTo - bandFrom) * i) / steps
      const b = bandFrom + ((bandTo - bandFrom) * (i + 1)) / steps
      const xa = xOf(a)
      const xb = xOf(b)
      ctx.fillStyle = wavelengthToCss((a + b) / 2, 1)
      ctx.globalAlpha = 0.16
      ctx.fillRect(xa, PAD_T, Math.max(0.8, xb - xa + 0.6), plotH)
    }
    ctx.globalAlpha = 1
    ctx.font = mono(10, '400')
    ctx.fillStyle = colors.inkSecondary
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    if (xOf(bandTo) - xOf(bandFrom) > 52) {
      ctx.fillText('visible', (xOf(bandFrom) + xOf(bandTo)) / 2, PAD_T + 4)
    }
  } else {
    ctx.font = mono(10, '400')
    ctx.fillStyle = colors.inkMuted
    ctx.textBaseline = 'top'
    const offLeft = VISIBLE_BAND_NM.max < fromNm
    ctx.textAlign = offLeft ? 'left' : 'right'
    ctx.fillText(
      offLeft ? '← visible band, far off-scale' : 'visible band, far off-scale →',
      offLeft ? PAD_L + 4 : PAD_L + plotW - 4,
      PAD_T + 4
    )
  }

  // ── Rayleigh–Jeans, clipped at the ceiling ──
  if (showClassical) {
    ctx.save()
    ctx.beginPath()
    ctx.rect(PAD_L, PAD_T - 2, plotW, plotH + 2)
    ctx.clip()
    ctx.setLineDash([5, 4])
    ctx.strokeStyle = colors.rose
    ctx.lineWidth = 1.75
    ctx.beginPath()
    let exitX: number | null = null
    for (let i = 0; i < SAMPLES; i++) {
      const nm = nmAt(i)
      const rel = rayleighJeansExitancePerNm(nm, temperatureK) / scale
      const x = xOf(nm)
      const y = yOf(rel)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
      if (exitX === null && rel <= Y_MAX) exitX = x
    }
    ctx.stroke()
    ctx.restore()

    ctx.font = mono(10)
    ctx.fillStyle = colors.roseText
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    const labelX = Math.min(PAD_L + plotW - 150, (exitX ?? PAD_L) + 6)
    ctx.fillText('Rayleigh–Jeans → ∞', Math.max(PAD_L + 4, labelX), PAD_T + 18)
  }

  // ── Planck ──
  ctx.beginPath()
  ctx.moveTo(PAD_L, baseY)
  for (let i = 0; i < SAMPLES; i++) {
    const nm = nmAt(i)
    ctx.lineTo(xOf(nm), yOf(planckExitancePerNm(nm, temperatureK) / scale))
  }
  ctx.lineTo(PAD_L + plotW, baseY)
  ctx.closePath()
  ctx.fillStyle = withAlpha(colors.violet, 0.3)
  ctx.fill()

  ctx.beginPath()
  for (let i = 0; i < SAMPLES; i++) {
    const nm = nmAt(i)
    const x = xOf(nm)
    const y = yOf(planckExitancePerNm(nm, temperatureK) / scale)
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.strokeStyle = colors.violet
  ctx.lineWidth = 2
  ctx.stroke()

  // ── Wien peak ──
  const px = xOf(peakNm)
  if (px > PAD_L && px < PAD_L + plotW) {
    ctx.save()
    ctx.setLineDash([4, 4])
    ctx.strokeStyle = withAlpha(colors.amber, 0.8)
    ctx.lineWidth = 1.25
    ctx.beginPath()
    ctx.moveTo(px, yOf(1))
    ctx.lineTo(px, baseY)
    ctx.stroke()
    ctx.restore()

    ctx.beginPath()
    ctx.arc(px, yOf(1), 4, 0, Math.PI * 2)
    ctx.fillStyle = colors.amber
    ctx.fill()

    ctx.font = mono(11)
    ctx.fillStyle = colors.amberText
    ctx.textBaseline = 'bottom'
    ctx.textAlign = px > PAD_L + plotW * 0.62 ? 'right' : 'left'
    const dx = px > PAD_L + plotW * 0.62 ? -8 : 8
    ctx.fillText(`Wien peak ${formatWavelength(peakNm)}`, px + dx, yOf(1) - 7)
  }

  // ── Captions ──
  ctx.font = mono(11)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillStyle = colors.violetText
  ctx.fillText(`Planck · ${formatTemperature(temperatureK)}`, PAD_L, 8)
  ctx.font = mono(10, '400')
  ctx.fillStyle = colors.inkMuted
  ctx.textAlign = 'right'
  ctx.fillText(`peak = ${peakValue.toExponential(2)} W·m⁻²·nm⁻¹`, PAD_L + plotW, 9)
  ctx.textAlign = 'left'
  ctx.fillText('wavelength →', PAD_L, baseY + 24)
  ctx.textAlign = 'right'
  ctx.fillText(
    logScale ? 'log wavelength · exitance ÷ peak' : 'exitance ÷ peak',
    PAD_L + plotW,
    baseY + 24
  )
}
