'use client'

import { useEffect, useRef } from 'react'
import {
  IONIZATION_ENERGY_EV,
  VISIBLE_MAX_NM,
  VISIBLE_MIN_NM,
  energyEv,
  lineName,
  regionOf,
  seriesLimitNm,
  seriesLines,
  transitionEnergyEv,
  transitionWavelengthNm,
} from '@/lib/quantum/hydrogen'
import { wavelengthToCss } from '@/lib/viz/spectralColor'
import { readVizColors, withAlpha, type VizColors } from './theme'
import { watchThemeChange } from './frameLoop'

/**
 * HydrogenSpectrum — the energy ladder and the emission spectrum it produces.
 *
 * Two static canvases rather than one animated one: nothing here moves, so
 * there is no frame loop to gate. They repaint on resize, on a theme change and
 * when the selected transition changes, and that is all.
 *
 * The spectrum plate is dark in BOTH themes on purpose. It is a picture of a
 * physical object — the film in a spectrograph, or the slit of a hand
 * spectroscope pointed at a discharge tube — and emission lines are bright
 * marks on a dark ground. Inverting it for the light theme would turn it into a
 * chart of something that does not look like that.
 */

const PLATE_BG = '#070a12'

export type HydrogenSpectrumProps = {
  /** The upper level of the highlighted transition. */
  nInitial: number
  /** The lower level: also the series being drawn. */
  nFinal: number
  /** Highest level drawn on the ladder. */
  maxN: number
  className?: string
}

/** Device-pixel-correct canvas sizing. Returns the CSS-pixel box. */
function prepareCanvas(canvas: HTMLCanvasElement): { ctx: CanvasRenderingContext2D | null; w: number; h: number } {
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const w = canvas.clientWidth || 1
  const h = canvas.clientHeight || 1
  const pw = Math.round(w * dpr)
  const ph = Math.round(h * dpr)
  if (canvas.width !== pw || canvas.height !== ph) {
    canvas.width = pw
    canvas.height = ph
  }
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
  }
  return { ctx, w, h }
}

/** Colour of a photon: its own colour if you could see it, an accent if not. */
function photonColor(wavelengthNm: number, colors: VizColors): string {
  const region = regionOf(wavelengthNm)
  if (region === 'visible') return wavelengthToCss(wavelengthNm)
  return region === 'ultraviolet' ? colors.violetText : colors.amberText
}

function drawLadder(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  colors: VizColors,
  props: HydrogenSpectrumProps
): void {
  const { nInitial, nFinal, maxN } = props
  const padTop = 16
  const padBottom = 24
  const plotH = h - padTop - padBottom
  const eMin = -IONIZATION_ENERGY_EV
  const yFor = (e: number) => h - padBottom - ((e - eMin) / (0 - eMin)) * plotH

  const left = 34
  const right = w - 74

  ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace'
  ctx.textBaseline = 'middle'

  // Ionisation, at E = 0. Everything below is bound; above it the electron is
  // gone and the spectrum becomes continuous.
  const yLimit = yFor(0)
  ctx.strokeStyle = withAlpha(colors.inkMuted, 0.6)
  ctx.setLineDash([4, 4])
  ctx.beginPath()
  ctx.moveTo(left, yLimit)
  ctx.lineTo(right, yLimit)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.fillStyle = colors.inkMuted
  ctx.textAlign = 'left'
  ctx.fillText('n → ∞   0.00 eV', right + 6, yLimit)

  // The levels pile up against the ionisation limit — E goes as 1/n², so n = 6
  // and n = 8 are a couple of pixels apart on a linear energy axis. That
  // crowding IS the series limit and the axis stays linear to show it, so the
  // labels are thinned instead: a level is only named when there is room for
  // the text, and the two levels in the transition are identified by the arrow
  // annotation rather than by a label wedged into a 3-pixel gap.
  let lastLabelY = Number.POSITIVE_INFINITY
  const LABEL_GAP = 14
  for (let level = 1; level <= maxN; level++) {
    const y = yFor(energyEv(level))
    const active = level === nInitial || level === nFinal
    ctx.strokeStyle = active ? colors.roseText : withAlpha(colors.inkSecondary, 0.55)
    ctx.lineWidth = active ? 2 : 1
    ctx.beginPath()
    ctx.moveTo(left, y)
    ctx.lineTo(right, y)
    ctx.stroke()

    const hasRoom = Math.abs(y - lastLabelY) >= LABEL_GAP && Math.abs(y - yLimit) >= LABEL_GAP
    if (!hasRoom) continue
    lastLabelY = y
    ctx.fillStyle = active ? colors.roseText : colors.inkMuted
    ctx.textAlign = 'right'
    ctx.fillText(`n=${level}`, left - 6, y)
    ctx.textAlign = 'left'
    ctx.fillText(`${energyEv(level).toFixed(2)} eV`, right + 6, y)
  }

  // The transition itself.
  const lambda = transitionWavelengthNm(nInitial, nFinal)
  const color = photonColor(lambda, colors)
  const x = left + (right - left) * 0.46
  const y0 = yFor(energyEv(nInitial))
  const y1 = yFor(energyEv(nFinal))
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = 2.5
  ctx.beginPath()
  ctx.moveTo(x, y0)
  ctx.lineTo(x, y1 - 7)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(x, y1)
  ctx.lineTo(x - 5, y1 - 9)
  ctx.lineTo(x + 5, y1 - 9)
  ctx.closePath()
  ctx.fill()

  const mid = Math.min(Math.max((y0 + y1) / 2, 18), h - 18)
  ctx.font = 'bold 12px ui-sans-serif, system-ui, sans-serif'
  ctx.textAlign = 'left'
  ctx.fillText(`n=${nInitial} → n=${nFinal}`, x + 10, mid - 8)
  ctx.fillText(
    `${lambda.toFixed(1)} nm · ${transitionEnergyEv(nInitial, nFinal).toFixed(2)} eV`,
    x + 10,
    mid + 8
  )
}

function drawSpectrum(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  colors: VizColors,
  props: HydrogenSpectrumProps
): void {
  const { nInitial, nFinal } = props
  const pad = 10
  const plotW = w - pad * 2
  const plateH = h - 42
  const rainbowY = plateH + 4
  const rainbowH = 8

  const xFor = (nm: number) =>
    pad + ((nm - VISIBLE_MIN_NM) / (VISIBLE_MAX_NM - VISIBLE_MIN_NM)) * plotW

  // The plate.
  ctx.fillStyle = PLATE_BG
  ctx.fillRect(pad, 0, plotW, plateH)
  ctx.strokeStyle = colors.lineStrong
  ctx.lineWidth = 1
  ctx.strokeRect(pad + 0.5, 0.5, plotW - 1, plateH - 1)

  // The lines of the selected series that actually land in the visible.
  const lines = seriesLines(nFinal, 40).filter((line) => regionOf(line.wavelengthNm) === 'visible')
  for (const line of lines) {
    const x = xFor(line.wavelengthNm)
    const selected = line.nInitial === nInitial
    const css = wavelengthToCss(line.wavelengthNm)
    // A soft halo, because a real emission line on a plate is not a hairline.
    const glow = ctx.createLinearGradient(x - 9, 0, x + 9, 0)
    glow.addColorStop(0, 'rgba(0,0,0,0)')
    glow.addColorStop(0.5, css)
    glow.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.globalAlpha = selected ? 0.55 : 0.3
    ctx.fillStyle = glow
    ctx.fillRect(x - 9, 4, 18, plateH - 8)
    ctx.globalAlpha = 1
    ctx.fillStyle = css
    ctx.fillRect(x - (selected ? 1.5 : 1), 4, selected ? 3 : 2, plateH - 8)

    if (selected) {
      ctx.font = 'bold 11px ui-sans-serif, system-ui, sans-serif'
      ctx.fillStyle = '#ffffff'
      ctx.textBaseline = 'top'
      const label = `${line.name}  ${line.wavelengthNm.toFixed(1)} nm`
      const tw = ctx.measureText(label).width
      const tx = Math.min(Math.max(x - tw / 2, pad + 4), pad + plotW - tw - 4)
      ctx.fillText(label, tx, 7)
    }
  }

  // The series limit, where the lines pile up and the series ends.
  const limit = seriesLimitNm(nFinal)
  if (limit >= VISIBLE_MIN_NM && limit <= VISIBLE_MAX_NM) {
    const x = xFor(limit)
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'
    ctx.setLineDash([3, 3])
    ctx.beginPath()
    ctx.moveTo(x, 4)
    ctx.lineTo(x, plateH - 4)
    ctx.stroke()
    ctx.setLineDash([])
  }

  // A transition outside the visible has nowhere to go on the plate, which is
  // the honest and slightly startling result: most of hydrogen's spectrum is
  // invisible. Say so at the edge it fell off.
  const selectedNm = transitionWavelengthNm(nInitial, nFinal)
  const region = regionOf(selectedNm)
  if (region !== 'visible') {
    const onLeft = region === 'ultraviolet'
    ctx.fillStyle = onLeft ? colors.violetText : colors.amberText
    ctx.font = 'bold 11px ui-sans-serif, system-ui, sans-serif'
    ctx.textBaseline = 'middle'
    ctx.textAlign = onLeft ? 'left' : 'right'
    const label = `${onLeft ? '←' : '→'} ${selectedNm.toFixed(1)} nm, ${region}`
    ctx.fillText(label, onLeft ? pad + 8 : pad + plotW - 8, plateH / 2)
  }

  // A reference rainbow under the plate, so the line positions mean something.
  for (let x = 0; x < plotW; x++) {
    const nm = VISIBLE_MIN_NM + (x / plotW) * (VISIBLE_MAX_NM - VISIBLE_MIN_NM)
    ctx.fillStyle = wavelengthToCss(nm)
    ctx.fillRect(pad + x, rainbowY, 1, rainbowH)
  }

  ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace'
  ctx.fillStyle = colors.inkMuted
  ctx.textBaseline = 'top'
  ctx.textAlign = 'center'
  for (let nm = 400; nm <= 700; nm += 50) {
    const x = xFor(nm)
    ctx.fillRect(x, rainbowY + rainbowH, 1, 3)
    ctx.fillText(`${nm}`, x, rainbowY + rainbowH + 5)
  }
  ctx.textAlign = 'right'
  ctx.fillText('nm', pad + plotW, rainbowY + rainbowH + 5)
}

/** Set up a canvas that repaints on resize and on a theme change. */
function useStaticCanvas(
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number, colors: VizColors) => void,
  deps: readonly unknown[]
) {
  const ref = useRef<HTMLCanvasElement | null>(null)
  const drawRef = useRef(draw)
  drawRef.current = draw

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const paint = () => {
      const { ctx, w, h } = prepareCanvas(canvas)
      if (!ctx) return
      drawRef.current(ctx, w, h, readVizColors(canvas))
    }
    paint()
    const resizeObserver = new ResizeObserver(paint)
    resizeObserver.observe(canvas)
    const unwatch = watchThemeChange(paint)
    return () => {
      resizeObserver.disconnect()
      unwatch()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return ref
}

export function HydrogenSpectrum({ nInitial, nFinal, maxN, className }: HydrogenSpectrumProps) {
  const props = { nInitial, nFinal, maxN }
  const ladderRef = useStaticCanvas(
    (ctx, w, h, colors) => drawLadder(ctx, w, h, colors, props),
    [nInitial, nFinal, maxN]
  )
  const spectrumRef = useStaticCanvas(
    (ctx, w, h, colors) => drawSpectrum(ctx, w, h, colors, props),
    [nInitial, nFinal, maxN]
  )

  const lambda = transitionWavelengthNm(nInitial, nFinal)
  const name = lineName(nInitial, nFinal)

  return (
    <div className={`grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] ${className ?? ''}`}>
      <figure className="m-0">
        <figcaption className="section-label mb-2">Energy levels</figcaption>
        <canvas
          ref={ladderRef}
          className="block h-[300px] w-full"
          role="img"
          aria-label={`Energy level diagram for hydrogen. Levels n equals 1 to ${maxN}, from ${energyEv(1).toFixed(2)} to ${energyEv(maxN).toFixed(2)} electron volts, with an arrow from n equals ${nInitial} down to n equals ${nFinal} releasing ${transitionEnergyEv(nInitial, nFinal).toFixed(2)} electron volts.`}
        />
      </figure>
      <figure className="m-0">
        <figcaption className="section-label mb-2">What the eye sees</figcaption>
        <canvas
          ref={spectrumRef}
          className="block h-[220px] w-full lg:h-[300px]"
          role="img"
          aria-label={`Emission spectrum plate from 380 to 750 nanometres. The highlighted line${
            name ? ` (${name})` : ''
          } is at ${lambda.toFixed(1)} nanometres, in the ${regionOf(lambda)}.`}
        />
      </figure>
    </div>
  )
}

export default HydrogenSpectrum
