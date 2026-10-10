'use client'

import { useEffect, useRef } from 'react'
import type { PhotoelectricReadout } from '@/lib/viz/photoelectric'
import { bandOf, beamCss } from '@/lib/viz/spectralColor'
import { readVizColors, withAlpha, type VizColors } from './theme'
import {
  createFrameLoop,
  domIntersectionWatcher,
  prefersReducedMotion,
  watchThemeChange,
  type FrameLoop,
} from './frameLoop'
import { mulberry32 } from '@/lib/quantum'

/**
 * PhotoelectricLab — Lenard's photocell, drawn on a canvas and actually simulated.
 *
 * Light of one frequency falls on the cathode; each photon that lands frees at most
 * one electron; the freed electrons drift across the gap against a retarding voltage
 * applied to the collector. What is on screen is not a loop of animation cells:
 *
 *   • The photon ARRIVAL RATE is proportional to intensity and nothing else, which is
 *     why brighter light means more electrons and never faster ones.
 *   • An electron is emitted only when hf > φ. Below threshold the photons still land,
 *     and the cathode stays dark, at any intensity — that is the whole point of the
 *     page and it is enforced here by the same `readout.emits` flag the numbers use.
 *   • Each electron carries a kinetic energy drawn uniformly from 0 … KE_max, and
 *     crosses the uniform retarding field with KE(u) = E₀ − V·u where u is the
 *     fraction of the gap covered. Speed goes as √KE, so an electron slows visibly as
 *     it climbs the potential hill, and one with E₀ < V turns round mid-flight and
 *     falls back. The fraction that gets across therefore EMERGES from the motion
 *     rather than being drawn to match the number in the panel.
 *
 * The uniform 0…KE_max energy spread is the same idealisation documented in
 * lib/viz/photoelectric.ts; the stopping voltage — the one thing Einstein's equation
 * predicts about this curve — does not depend on it.
 */

const PAD_L = 16
const PAD_R = 16
const PAD_T = 54
const PAD_B = 58
/** Photons per second striking the cathode at full intensity. */
const MAX_PHOTON_RATE = 30
/** Seconds a photon takes to travel the drawn beam. */
const PHOTON_FLIGHT_S = 0.5
/** Gap crossings per second for an electron carrying the full KE_max. */
const ELECTRON_SPEED = 1.05
const MAX_PHOTONS = 90
const MAX_ELECTRONS = 200

type Photon = { t: number; offset: number }
/** u is the fraction of the gap crossed; dir is +1 outbound, −1 falling back. */
type Electron = { u: number; dir: number; energyEv: number; lane: number }

export type Sim = {
  photons: Photon[]
  electrons: Electron[]
  photonBudget: number
  rand: () => number
}

type Props = {
  readout: PhotoelectricReadout
  /** Beam intensity as a fraction of the lamp's maximum, 0…1. */
  intensity: number
  /** Retarding voltage on the collector, volts. */
  retardingVoltageV: number
  metalLabel: string
  running: boolean
  className?: string
}

function emptySim(seed: number): Sim {
  return { photons: [], electrons: [], photonBudget: 0, rand: mulberry32(seed) }
}

/**
 * A deterministic still for prefers-reduced-motion: photons spaced along the beam and
 * electrons at the positions a spread of launch energies would have reached, including
 * the ones already turned back by the field.
 */
export function staticSim(readout: PhotoelectricReadout, intensity: number, stopV: number): Sim {
  const sim = emptySim(12345)
  const photonCount = Math.max(2, Math.round(9 * Math.max(0.05, intensity)))
  for (let i = 0; i < photonCount; i++) {
    sim.photons.push({ t: (i + 0.5) / photonCount, offset: (i % 3) - 1 })
  }
  if (!readout.emits) return sim
  const n = Math.max(3, Math.round(16 * Math.max(0.08, intensity)))
  for (let i = 0; i < n; i++) {
    const energy = (readout.maxKineticEnergyEv * (i + 0.5)) / n
    // Where a launch at this energy ends up: across if it can pay the retarding
    // voltage, otherwise stalled at the turning point u = E₀/V.
    const turn = stopV > 0 && energy < stopV ? energy / stopV : 1
    sim.electrons.push({
      u: Math.min(0.96, turn * (0.35 + 0.6 * ((i * 7) % 11) / 11)),
      dir: energy < stopV ? -1 : 1,
      energyEv: energy,
      lane: ((i * 5) % 9) / 8,
    })
  }
  return sim
}

export default function PhotoelectricLab({
  readout,
  intensity,
  retardingVoltageV,
  metalLabel,
  running,
  className = '',
}: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const sizeRef = useRef({ w: 0, h: 0 })
  const loopRef = useRef<FrameLoop | null>(null)
  // Seeded with staticSim's populated snapshot, not emptySim: the live loop below
  // deliberately never wipes the tube on a control change (see the comment on
  // `rebuild`), which is the right call for continuity but means an empty seed
  // stays visibly empty for whatever it takes MAX_PHOTON_RATE to fill it back up —
  // ~1-2s of a first-time visitor looking at a blank tube before anything is
  // there to see. Seeding once, at mount, with the same snapshot the
  // reduced-motion still already uses costs nothing (advance() treats a seeded
  // photon/electron exactly like one it spawned itself) and the tube looks
  // correct from the very first frame instead of building up from nothing.
  const simRef = useRef<Sim>(staticSim(readout, intensity, retardingVoltageV))

  const propsRef = useRef({ readout, intensity, retardingVoltageV, metalLabel, running })
  propsRef.current = { readout, intensity, retardingVoltageV, metalLabel, running }

  // Bumped whenever the physics changes, so the reduced-motion still is rebuilt and
  // the live simulation drops electrons launched under the previous settings.
  const generationRef = useRef(0)
  const builtRef = useRef(-1)
  useEffect(() => {
    generationRef.current += 1
    loopRef.current?.start()
  }, [readout, intensity, retardingVoltageV])

  useEffect(() => {
    loopRef.current?.start()
  }, [running])

  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const reduceMotion = prefersReducedMotion()
    let colors = readVizColors(wrap)
    let lastTime = 0

    /**
     * Note what this does NOT do when the simulation is live: it does not clear the
     * tube. Dragging a slider changes what happens next — the arrival rate of new
     * photons, the energy the next electron launches with, the field the electrons
     * already in flight are climbing — and an electron mid-crossing is not re-launched
     * because the reader moved the intensity control. Wiping the sim on every control
     * change would also empty the tube on every frame of a drag, which looks broken.
     * Only the reduced-motion still is rebuilt, because a still has no continuity to
     * preserve.
     */
    const rebuild = (): void => {
      builtRef.current = generationRef.current
      if (!reduceMotion) return
      const p = propsRef.current
      simRef.current = staticSim(p.readout, p.intensity, p.retardingVoltageV)
      lastTime = 0
    }

    const advance = (sim: Sim, dt: number): void => {
      const p = propsRef.current
      const { readout: r } = p
      const stop = p.retardingVoltageV

      // Photons in flight.
      for (const photon of sim.photons) photon.t += dt / PHOTON_FLIGHT_S
      let landed = 0
      sim.photons = sim.photons.filter((photon) => {
        if (photon.t < 1) return true
        landed += 1
        return false
      })

      // Every landed photon frees one electron, but only above threshold.
      if (r.emits && r.maxKineticEnergyEv > 0) {
        for (let i = 0; i < landed && sim.electrons.length < MAX_ELECTRONS; i++) {
          sim.electrons.push({
            u: 0,
            dir: 1,
            energyEv: sim.rand() * r.maxKineticEnergyEv,
            lane: sim.rand(),
          })
        }
      }

      // New photons: rate ∝ intensity, and only intensity.
      sim.photonBudget += dt * MAX_PHOTON_RATE * Math.max(0, Math.min(1, p.intensity))
      while (sim.photonBudget >= 1) {
        sim.photonBudget -= 1
        if (sim.photons.length < MAX_PHOTONS) {
          sim.photons.push({ t: 0, offset: sim.rand() * 2 - 1 })
        }
      }

      // Electrons crossing the gap against the retarding field.
      const scale = Math.max(r.maxKineticEnergyEv, 0.15)
      sim.electrons = sim.electrons.filter((e) => {
        const ke = e.energyEv - stop * e.u
        if (ke <= 0 && e.dir > 0) e.dir = -1
        const speed = ELECTRON_SPEED * Math.sqrt(Math.max(ke, 0.02 * scale) / scale)
        e.u += e.dir * speed * dt
        return e.u > -0.02 && e.u < 1.02
      })
    }

    const onFrame = (now: number): boolean => {
      if (builtRef.current !== generationRef.current) rebuild()
      const sim = simRef.current
      const p = propsRef.current
      const dt = lastTime === 0 ? 0.016 : Math.min((now - lastTime) / 1000, 0.06)
      lastTime = now

      if (!reduceMotion && p.running) advance(sim, dt)

      const { w, h } = sizeRef.current
      if (w > 0 && h > 0) renderPhotoelectricScene(ctx, sim, p, w, h, colors)
      return !reduceMotion && p.running
    }

    const loop = createFrameLoop(window, document, domIntersectionWatcher(wrap), onFrame)
    loopRef.current = loop

    const repaint = (): void => {
      const { w, h } = sizeRef.current
      if (w > 0 && h > 0) renderPhotoelectricScene(ctx, simRef.current, propsRef.current, w, h, colors)
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
      if (builtRef.current !== generationRef.current) rebuild()
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
    <div ref={wrapRef} className={`relative w-full ${className}`} style={{ height: 360 }}>
      <canvas
        ref={canvasRef}
        className="block h-full w-full"
        role="img"
        aria-label={describe(readout, intensity, retardingVoltageV, metalLabel)}
      />
    </div>
  )
}

/** The accessible name: the state of the experiment right now, in words. */
function describe(
  r: PhotoelectricReadout,
  intensity: number,
  retardingVoltageV: number,
  metalLabel: string
): string {
  const light =
    `${r.wavelengthNm.toFixed(0)} nanometre ${bandOf(r.wavelengthNm)} light at ` +
    `${Math.round(intensity * 100)} percent intensity, photons of ${r.photonEnergyEv.toFixed(2)} ` +
    `electron-volts, falling on a ${metalLabel} cathode of work function ` +
    `${r.workFunctionEv.toFixed(2)} electron-volts.`
  if (!r.emits) {
    return `${light} No electrons are emitted: each photon falls short of the work function, and turning the lamp up adds more such photons rather than more energetic ones.`
  }
  return (
    `${light} Electrons leave with up to ${r.maxKineticEnergyEv.toFixed(2)} electron-volts and ` +
    `cross the tube against a retarding voltage of ${retardingVoltageV.toFixed(2)} volts, ` +
    `giving a photocurrent of ${Math.round(r.currentFraction * 100)} percent of the saturation ` +
    `value. The current would stop entirely at ${r.stoppingVoltageV.toFixed(2)} volts.`
  )
}

export function renderPhotoelectricScene(
  ctx: CanvasRenderingContext2D,
  sim: Sim,
  props: {
    readout: PhotoelectricReadout
    intensity: number
    retardingVoltageV: number
    metalLabel: string
  },
  w: number,
  h: number,
  colors: VizColors
): void {
  const { readout: r, intensity, retardingVoltageV, metalLabel } = props
  ctx.clearRect(0, 0, w, h)

  const x0 = PAD_L
  const x1 = w - PAD_R
  const y0 = PAD_T
  const y1 = h - PAD_B
  const cathodeX = x0 + Math.max(56, (x1 - x0) * 0.16)
  const anodeX = x1 - Math.max(56, (x1 - x0) * 0.16)
  const plateTop = y0 + 16
  const plateBottom = y1 - 16
  const gap = Math.max(20, anodeX - cathodeX)
  const midY = (plateTop + plateBottom) / 2

  const mono = (size: number, weight = '600') =>
    `${weight} ${size}px ui-monospace, SFMono-Regular, Menlo, monospace`

  // ── Tube ──
  ctx.strokeStyle = colors.lineStrong
  ctx.lineWidth = 1
  ctx.fillStyle = withAlpha(colors.surface2, 0.55)
  roundRect(ctx, x0 + 0.5, y0 + 0.5, x1 - x0 - 1, y1 - y0 - 1, 10)
  ctx.fill()
  ctx.stroke()

  // ── Light beam ──
  const beam = beamCss(r.wavelengthNm, 0.55 + 0.45 * intensity)
  const band = bandOf(r.wavelengthNm)
  const beamStart = { x: x0 + 6, y: y0 - 40 }
  const beamEnd = { x: cathodeX - 5, y: midY }
  const dx = beamEnd.x - beamStart.x
  const dy = beamEnd.y - beamStart.y
  const len = Math.hypot(dx, dy) || 1
  const nx = -dy / len
  const ny = dx / len

  ctx.save()
  ctx.strokeStyle = beam
  ctx.globalAlpha = 0.16 + 0.24 * intensity
  ctx.lineWidth = 16
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(beamStart.x, beamStart.y)
  ctx.lineTo(beamEnd.x, beamEnd.y)
  ctx.stroke()
  ctx.restore()

  // Photons in flight, as discrete packets — the whole quarrel with the wave picture.
  ctx.fillStyle = beam
  for (const photon of sim.photons) {
    const t = Math.max(0, Math.min(1, photon.t))
    const px = beamStart.x + dx * t + nx * photon.offset * 5
    const py = beamStart.y + dy * t + ny * photon.offset * 5
    ctx.beginPath()
    ctx.arc(px, py, 2.6, 0, Math.PI * 2)
    ctx.fill()
  }

  ctx.font = mono(11)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillStyle = colors.inkSecondary
  const bandTag = band === 'visible' ? 'visible' : band === 'ultraviolet' ? 'UV' : 'IR'
  ctx.fillText(
    `${r.wavelengthNm.toFixed(0)} nm · ${bandTag} · ${r.photonEnergyEv.toFixed(2)} eV per photon`,
    x0 + 2,
    8
  )
  ctx.fillStyle = colors.inkMuted
  ctx.font = mono(10, '400')
  ctx.fillText(`intensity ${Math.round(intensity * 100)}% — photons per second, not eV`, x0 + 2, 24)

  // ── Cathode ──
  const cathodeLit = withAlpha(colors.amber, 0.5)
  ctx.fillStyle = r.emits ? cathodeLit : withAlpha(colors.inkMuted, 0.45)
  ctx.fillRect(cathodeX - 4, plateTop, 8, plateBottom - plateTop)
  ctx.font = mono(11)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'bottom'
  ctx.fillStyle = colors.inkSecondary
  ctx.fillText(metalLabel, cathodeX, plateTop - 4)
  ctx.textBaseline = 'top'
  ctx.font = mono(10, '400')
  ctx.fillStyle = colors.inkMuted
  ctx.fillText(`φ = ${r.workFunctionEv.toFixed(2)} eV`, cathodeX, plateBottom + 5)

  // ── Collector ──
  ctx.fillStyle = withAlpha(colors.teal, 0.5)
  ctx.fillRect(anodeX - 4, plateTop, 8, plateBottom - plateTop)
  ctx.textBaseline = 'bottom'
  ctx.font = mono(11)
  ctx.fillStyle = colors.inkSecondary
  ctx.fillText('collector', anodeX, plateTop - 4)
  ctx.textBaseline = 'top'
  ctx.font = mono(10, '400')
  ctx.fillStyle = retardingVoltageV > 0 ? colors.roseText : colors.inkMuted
  ctx.fillText(
    retardingVoltageV > 0 ? `−${retardingVoltageV.toFixed(2)} V` : 'no retarding V',
    anodeX,
    plateBottom + 5
  )

  // ── Retarding field ──
  if (retardingVoltageV > 0) {
    ctx.save()
    ctx.strokeStyle = withAlpha(colors.rose, 0.35)
    ctx.lineWidth = 1.25
    for (let row = 0; row < 3; row++) {
      const y = plateTop + ((row + 1) * (plateBottom - plateTop)) / 4
      for (let i = 0; i < 5; i++) {
        const cx = cathodeX + ((i + 0.5) * gap) / 5
        ctx.beginPath()
        ctx.moveTo(cx + 5, y - 4)
        ctx.lineTo(cx - 4, y)
        ctx.lineTo(cx + 5, y + 4)
        ctx.stroke()
      }
    }
    ctx.restore()
  }

  // ── Electrons ──
  const laneTop = plateTop + 10
  const laneHeight = Math.max(10, plateBottom - plateTop - 20)
  for (const e of sim.electrons) {
    const ex = cathodeX + 6 + e.u * (gap - 12)
    const ey = laneTop + e.lane * laneHeight
    const ke = Math.max(0, e.energyEv - retardingVoltageV * e.u)
    const hot = r.maxKineticEnergyEv > 0 ? ke / r.maxKineticEnergyEv : 0
    ctx.beginPath()
    ctx.fillStyle = withAlpha(colors.sky, 0.22)
    ctx.arc(ex, ey, 6, 0, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.fillStyle = e.dir < 0 ? colors.roseText : colors.skyText
    ctx.arc(ex, ey, 2.4 + 1.4 * hot, 0, Math.PI * 2)
    ctx.fill()
  }

  // ── The headline in the middle of the tube ──
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  if (!r.emits) {
    ctx.font = mono(12)
    ctx.fillStyle = colors.roseText
    ctx.fillText('no electrons — at any intensity', (cathodeX + anodeX) / 2, y0 + 24)
    ctx.font = mono(10, '400')
    ctx.fillStyle = colors.inkMuted
    ctx.fillText(
      `hf = ${r.photonEnergyEv.toFixed(2)} eV < φ = ${r.workFunctionEv.toFixed(2)} eV`,
      (cathodeX + anodeX) / 2,
      y0 + 40
    )
  } else {
    ctx.font = mono(10, '400')
    ctx.fillStyle = colors.inkMuted
    ctx.fillText(
      `KE_max = hf − φ = ${r.maxKineticEnergyEv.toFixed(2)} eV`,
      (cathodeX + anodeX) / 2,
      y0 + 8
    )
  }

  // ── Ammeter ──
  const barY = y1 + 20
  const barH = 10
  ctx.fillStyle = withAlpha(colors.inkMuted, 0.18)
  roundRect(ctx, x0, barY, x1 - x0, barH, 5)
  ctx.fill()
  const fillW = Math.max(0, Math.min(1, r.currentFraction)) * (x1 - x0)
  if (fillW > 1) {
    ctx.fillStyle = colors.teal
    roundRect(ctx, x0, barY, fillW, barH, 5)
    ctx.fill()
  }
  ctx.font = mono(10, '400')
  ctx.textBaseline = 'top'
  ctx.textAlign = 'left'
  ctx.fillStyle = colors.inkMuted
  ctx.fillText('photocurrent (share of saturation)', x0, barY + barH + 5)
  ctx.textAlign = 'right'
  ctx.fillStyle = r.currentFraction > 0 ? colors.tealText : colors.roseText
  ctx.font = mono(11)
  ctx.fillText(`${(r.currentFraction * 100).toFixed(0)}%`, x1, barY + barH + 4)
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  // Same guard as SternGerlachLab.roundRect: a non-positive box or a
  // negative radius makes arcTo throw, and that throw reaches the route's
  // error boundary. Draw nothing instead; the next resize repaints.
  ctx.beginPath()
  if (!(w > 0 && h > 0)) return
  const radius = Math.max(0, Math.min(r, w / 2, h / 2))
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}
