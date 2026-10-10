'use client'

import { useEffect, useRef } from 'react'
import { mulberry32 } from '@/lib/quantum'
import {
  DEFAULT_CARTOON,
  HISTORY_DT,
  HISTORY_LENGTH,
  SLAB_LEFT,
  SLAB_RIGHT,
  STRAY_LANE,
  columnX,
  createCartoon,
  levelCounts,
  resetCartoon,
  stepCartoon,
  type CartoonCounts,
  type CartoonParams,
  type CartoonState,
  type Scheme,
} from '@/lib/viz/laserCartoon'
import { readVizColors, withAlpha, type VizColors } from './theme'
import {
  createFrameLoop,
  domIntersectionWatcher,
  prefersReducedMotion,
  watchThemeChange,
  type FrameLoop,
} from './frameLoop'

/**
 * LaserLab — the cavity cartoon: 42 atoms between two mirrors, pumped from
 * above, with photons drawn one at a time.
 *
 * Every event on this canvas is a Bernoulli trial made in
 * lib/viz/laserCartoon.ts, which laserCartoon.test.ts checks for the things
 * that matter: no mode below inversion, a sharp take-off above it, the
 * inversion clamping once light builds up, and a two-level medium that never
 * gets there. The canvas only decides where to put the dots.
 *
 * Reduced motion: the model still runs (the counts are the content) but is
 * advanced in half-second batches and painted twice a second, so nothing
 * glides across the screen.
 *
 * ACCESSIBILITY: no pointer interaction here — every control is a form
 * control in the page's rail. The canvas describes its current state, and the
 * page prints the same counts as text beside it.
 */

export const CARTOON_HEIGHT = 300
const HISTORY_H = 58
const REDUCED_BATCH_MS = 500
const EMIT_MS = 150

export type CartoonSample = {
  photons: number
  n1: number
  n2: number
  n3: number
  counts: CartoonCounts
}

type Props = {
  scheme: Scheme
  /** Pump rate per ground atom in units of the spontaneous rate. */
  pumpRatio: number
  running: boolean
  /** Bump to clear the atoms, photons and counters. */
  resetKey: number
  onSample?: (s: CartoonSample) => void
  className?: string
}

export default function LaserLab({
  scheme,
  pumpRatio,
  running,
  resetKey,
  onSample,
  className = '',
}: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const loopRef = useRef<FrameLoop | null>(null)

  const propsRef = useRef({ scheme, pumpRatio, running })
  propsRef.current = { scheme, pumpRatio, running }
  const onSampleRef = useRef(onSample)
  onSampleRef.current = onSample

  const resetGenRef = useRef(0)

  useEffect(() => {
    resetGenRef.current += 1
    loopRef.current?.start()
  }, [resetKey, scheme])

  useEffect(() => {
    loopRef.current?.start()
  }, [running, pumpRatio])

  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const reduceMotion = prefersReducedMotion()
    let colors = readVizColors(wrap)
    let width = 0

    const params = (): CartoonParams => ({
      ...DEFAULT_CARTOON,
      scheme: propsRef.current.scheme,
      pumpRatio: propsRef.current.pumpRatio,
    })

    let rand = mulberry32(0x1a5e2b3c)
    const state: CartoonState = createCartoon(params())
    let builtGen = -1
    let lastNow = 0
    let lastBatch = 0
    let lastEmit = 0

    const reset = () => {
      builtGen = resetGenRef.current
      rand = mulberry32(0x1a5e2b3c ^ (builtGen * 0x9e3779b1))
      resetCartoon(state, params())
    }

    const emit = () => {
      const lv = levelCounts(state)
      onSampleRef.current?.({
        photons: state.photons.length,
        n1: lv.n1,
        n2: lv.n2,
        n3: lv.n3,
        counts: { ...state.counts },
      })
    }

    const onFrame = (now: number): boolean => {
      if (builtGen !== resetGenRef.current) reset()
      const live = propsRef.current
      const dt = lastNow === 0 ? 0 : Math.min(0.05, (now - lastNow) / 1000)
      lastNow = now
      const p = params()

      let more = false
      if (live.running) {
        if (reduceMotion) {
          if (now - lastBatch > REDUCED_BATCH_MS) {
            lastBatch = now
            for (let i = 0; i < 30; i++) stepCartoon(state, p, 1 / 60, rand)
            paint()
          }
        } else {
          if (dt > 0) stepCartoon(state, p, dt, rand)
          paint()
        }
        more = true
      } else {
        paint()
      }

      if (now - lastEmit > EMIT_MS) {
        lastEmit = now
        emit()
      }
      return more
    }

    const paint = () => {
      if (width <= 0) return
      drawCavity(ctx, width, CARTOON_HEIGHT, state, params(), colors, reduceMotion)
    }

    const loop = createFrameLoop(window, document, domIntersectionWatcher(wrap), onFrame)
    loopRef.current = loop

    const stopTheme = watchThemeChange(() => {
      colors = readVizColors(wrap)
      paint()
    })

    const resize = () => {
      const rect = wrap.getBoundingClientRect()
      width = Math.max(1, Math.round(rect.width))
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(CARTOON_HEIGHT * dpr)
      canvas.style.width = `${width}px`
      canvas.style.height = `${CARTOON_HEIGHT}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      if (builtGen !== resetGenRef.current) reset()
      paint()
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
    // Built once; live props are read through propsRef, like the other labs.
  }, [])

  return (
    <div ref={wrapRef} className={`w-full ${className}`}>
      <canvas
        ref={canvasRef}
        className="block w-full"
        style={{ height: CARTOON_HEIGHT }}
        role="img"
        aria-label={describeCavity(scheme, pumpRatio)}
      />
    </div>
  )
}

// ────────────────────────────────────────────────────────────
// Painting
// ────────────────────────────────────────────────────────────

const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace'

type Geometry = {
  w: number
  /** Pixel x of the back mirror and the output mirror. */
  mirrorL: number
  mirrorR: number
  axisY: number
  /** Vertical half-extent of the beam lanes. */
  laneSpread: number
  slabX: number
  slabW: number
  slabY: number
  slabH: number
  atomR: number
  /** Top of the history strip. */
  histY: number
  histH: number
}

function geometry(w: number, h: number, p: CartoonParams): Geometry {
  const histH = HISTORY_H
  const cavityH = h - histH - 8
  const mirrorL = Math.max(18, w * 0.05)
  const outputSpace = Math.max(48, w * 0.14)
  const mirrorR = w - outputSpace
  const axisY = 30 + (cavityH - 30) * 0.5
  const laneSpread = Math.min(46, cavityH * 0.2)
  const slabX = mirrorL + SLAB_LEFT * (mirrorR - mirrorL)
  const slabW = (SLAB_RIGHT - SLAB_LEFT) * (mirrorR - mirrorL)
  const slabH = laneSpread * 2 + 22
  const atomR = Math.max(3.5, Math.min(6, (slabW / p.cols) * 0.22))
  return {
    w,
    mirrorL,
    mirrorR,
    axisY,
    laneSpread,
    slabX,
    slabW,
    slabY: axisY - slabH / 2,
    slabH,
    atomR,
    histY: h - histH,
    histH,
  }
}

function drawCavity(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  s: CartoonState,
  p: CartoonParams,
  c: VizColors,
  reduceMotion: boolean
) {
  ctx.clearRect(0, 0, w, h)
  const G = geometry(w, h, p)
  const cavityPx = G.mirrorR - G.mirrorL
  const X = (x: number) => G.mirrorL + x * cavityPx
  const Y = (lane: number) => G.axisY + lane * G.laneSpread
  // Strays are in cavity lengths on both axes; keep a lane's worth of offset
  // lined up with the lane it left from.
  const SY = (y: number) => G.axisY + (y / STRAY_LANE) * G.laneSpread
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  // ── Pump lamp ──
  const pumpAlpha = Math.min(1, 0.12 + 0.2 * p.pumpRatio)
  ctx.font = `600 9px ${MONO}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.fillStyle = c.amberText
  ctx.fillText(
    p.scheme === 'three' ? `PUMP  ${p.pumpRatio.toFixed(2)} × A₂₁  →  level 3` : `PUMP  ${p.pumpRatio.toFixed(2)} × A₂₁  →  level 2 (and back)`,
    G.slabX + G.slabW / 2,
    6
  )
  const arrows = Math.max(3, Math.round(G.slabW / 34))
  for (let i = 0; i < arrows; i++) {
    const ax = G.slabX + ((i + 0.5) / arrows) * G.slabW
    ctx.beginPath()
    ctx.moveTo(ax, 20)
    ctx.lineTo(ax, G.slabY - 4)
    ctx.strokeStyle = withAlpha(c.amber, pumpAlpha)
    ctx.lineWidth = 1.5
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(ax - 3, G.slabY - 9)
    ctx.lineTo(ax, G.slabY - 4)
    ctx.lineTo(ax + 3, G.slabY - 9)
    ctx.stroke()
  }

  // ── Slab ──
  roundRect(ctx, G.slabX, G.slabY, G.slabW, G.slabH, 6)
  ctx.fillStyle = withAlpha(c.rose, 0.06)
  ctx.fill()
  ctx.strokeStyle = withAlpha(c.rose, 0.35)
  ctx.lineWidth = 1
  ctx.stroke()

  // ── Beam axis (faint) ──
  ctx.beginPath()
  ctx.moveTo(G.mirrorL, G.axisY)
  ctx.lineTo(G.mirrorR, G.axisY)
  ctx.strokeStyle = withAlpha(c.inkMuted, 0.18)
  ctx.lineWidth = 1
  ctx.setLineDash([2, 5])
  ctx.stroke()
  ctx.setLineDash([])

  // ── Mirrors ──
  const mirrorH = G.laneSpread * 2 + 30
  ctx.beginPath()
  ctx.moveTo(G.mirrorL, G.axisY - mirrorH / 2)
  ctx.lineTo(G.mirrorL, G.axisY + mirrorH / 2)
  ctx.strokeStyle = c.sky
  ctx.lineWidth = 5
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(G.mirrorR, G.axisY - mirrorH / 2)
  ctx.lineTo(G.mirrorR, G.axisY + mirrorH / 2)
  ctx.strokeStyle = withAlpha(c.sky, 0.75)
  ctx.lineWidth = 2.5
  ctx.stroke()
  ctx.font = `8px ${MONO}`
  ctx.fillStyle = c.inkMuted
  ctx.textBaseline = 'top'
  ctx.textAlign = 'center'
  ctx.fillText('R = 100%', G.mirrorL, G.axisY + mirrorH / 2 + 4)
  ctx.fillText(`T = ${(p.mirrorTransmission * 100).toFixed(0)}%`, G.mirrorR, G.axisY + mirrorH / 2 + 4)

  // ── Strays: spontaneous, output, and (two-level) pump photons ──
  for (const st of s.strays) {
    const k = Math.max(0, 1 - st.age / 1.4)
    if (st.kind === 'output') {
      drawWave(ctx, X(st.x), SY(st.y), 1, 0, withAlpha(c.rose, 0.85 * k))
    } else {
      const px = X(st.x)
      const py = SY(st.y)
      ctx.beginPath()
      ctx.arc(px, py, 2.2, 0, Math.PI * 2)
      ctx.fillStyle = withAlpha(st.kind === 'pump' ? c.amber : c.rose, 0.7 * k)
      ctx.fill()
    }
  }

  // ── Mode photons ──
  for (const ph of s.photons) {
    drawWave(ctx, X(ph.x), Y(ph.lane), ph.dir, ph.phase, withAlpha(c.rose, 0.85))
  }

  // ── Atoms (over the photons so their state reads) ──
  for (let i = 0; i < s.atoms.length; i++) {
    const col = Math.floor(i / p.rows)
    const row = i % p.rows
    const ax = X(columnX(col, p.cols))
    const ay = Y(p.rows <= 1 ? 0 : ((row + 0.5) / p.rows) * 2 - 1)
    const lv = s.atoms[i].level
    ctx.beginPath()
    ctx.arc(ax, ay, G.atomR, 0, Math.PI * 2)
    if (lv === 1) {
      ctx.fillStyle = withAlpha(c.surface2, 0.95)
      ctx.fill()
      ctx.strokeStyle = withAlpha(c.inkMuted, 0.7)
      ctx.lineWidth = 1
      ctx.stroke()
    } else if (lv === 2) {
      ctx.fillStyle = c.rose
      ctx.fill()
    } else {
      ctx.fillStyle = c.amber
      ctx.fill()
    }
  }

  // ── Counters ──
  const lv = levelCounts(s)
  ctx.font = `9px ${MONO}`
  ctx.textBaseline = 'top'
  ctx.textAlign = 'left'
  ctx.fillStyle = c.inkSecondary
  const lines = [
    `mode photons ${s.photons.length}${s.counts.overflow > 0 ? ` (+${s.counts.overflow} not drawn)` : ''}`,
    `ground ${lv.n1} · upper ${lv.n2}${p.scheme === 'three' ? ` · pump band ${lv.n3}` : ''}`,
  ]
  lines.forEach((t, i) => ctx.fillText(t, 8, 6 + i * 12))
  ctx.textAlign = 'right'
  const right = [
    `cloned ${s.counts.stimulated}`,
    `absorbed ${s.counts.absorbed}`,
    `out ${s.counts.output}`,
  ]
  right.forEach((t, i) => ctx.fillText(t, w - 8, 6 + i * 12))
  ctx.textAlign = 'center'
  ctx.fillStyle = c.inkMuted
  ctx.fillText('output', (G.mirrorR + w) / 2, G.axisY + mirrorH / 2 + 4)
  if (reduceMotion) {
    ctx.textAlign = 'left'
    ctx.fillText('reduced motion: updates twice a second', 8, 6 + 2 * 12)
  }

  // ── History strip ──
  drawHistory(ctx, G, s, c)
}

function drawWave(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  dir: 1 | -1,
  phase: number,
  color: string
) {
  const len = 14
  const amp = 2.6
  ctx.beginPath()
  for (let i = 0; i <= 10; i++) {
    const t = i / 10
    const px = x - dir * len * (1 - t)
    const py = y + amp * Math.sin(phase + t * Math.PI * 3)
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.strokeStyle = color
  ctx.lineWidth = 1.5
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(x, y, 1.6, 0, Math.PI * 2)
  ctx.fillStyle = color
  ctx.fill()
}

function drawHistory(ctx: CanvasRenderingContext2D, G: Geometry, s: CartoonState, c: VizColors) {
  const padL = 40
  const padR = 8
  const top = G.histY + 12
  const bottom = G.histY + G.histH - 4
  const plotW = Math.max(10, G.w - padL - padR)
  const plotH = bottom - top
  const hist = s.history
  const max = Math.max(10, ...hist)

  ctx.strokeStyle = withAlpha(c.inkMuted, 0.25)
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(padL, bottom)
  ctx.lineTo(padL + plotW, bottom)
  ctx.stroke()
  ctx.font = `8px ${MONO}`
  ctx.fillStyle = c.inkMuted
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  ctx.fillText(`${max}`, padL - 4, top)
  ctx.fillText('0', padL - 4, bottom)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillText(`mode photons, last ${(HISTORY_LENGTH * HISTORY_DT).toFixed(0)} s`, padL + 2, G.histY)

  if (hist.length < 2) return
  ctx.beginPath()
  for (let i = 0; i < hist.length; i++) {
    const px = padL + plotW * (1 - (hist.length - 1 - i) / (HISTORY_LENGTH - 1))
    const py = bottom - (hist[i] / max) * plotH
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.strokeStyle = withAlpha(c.rose, 0.9)
  ctx.lineWidth = 1.5
  ctx.stroke()
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

// ────────────────────────────────────────────────────────────
// Accessible description
// ────────────────────────────────────────────────────────────

export function describeCavity(scheme: Scheme, pumpRatio: number): string {
  const n = DEFAULT_CARTOON.cols * DEFAULT_CARTOON.rows
  const levels =
    scheme === 'three'
      ? 'Pump light lifts ground atoms to a short-lived pump band, which drops them into the upper laser level.'
      : 'Pump light acts on the laser transition itself, lifting ground atoms and knocking excited ones back down at the same rate.'
  return (
    `A laser cavity: a fully reflecting back mirror on the left, a partly transmitting output mirror on the right, and a slab of ${n} atoms between them, pumped from above at ${pumpRatio.toFixed(2)} times the spontaneous decay rate. ${levels} ` +
    `Excited atoms emit in random directions; a photon that happens to travel along the axis bounces between the mirrors, and each time it passes an excited atom it may leave a second, identical photon beside it, or be absorbed by a ground-state atom. ` +
    `A strip below the cavity plots the number of photons in the mode over the last thirty seconds. Live counts are printed beside the figure.`
  )
}
