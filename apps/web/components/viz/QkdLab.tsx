'use client'

import { useEffect, useRef } from 'react'
import {
  BASIS_LABEL,
  CLASSICAL_BOUND,
  E91_ANGLE_LABELS,
  QBER_ABORT,
  TSIRELSON_BOUND,
  advanceBb84,
  advanceE91,
  bb84Stats,
  createBb84Run,
  createE91Run,
  e91Stats,
  expectedBb84Qber,
  expectedE91S,
  type Bb84Params,
  type Bb84Qubit,
  type Bb84Run,
  type Bb84Stats,
  type E91Pair,
  type E91Params,
  type E91Run,
  type E91Stats,
} from '@/lib/viz/qkd'
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
 * QkdLab — BB84 or E91, one qubit at a time, on one canvas.
 *
 * Top: the channel. Alice on the left, Bob on the right, Eve in between (drawn
 * faded until she intercepts something). Photons fly across it coloured by the
 * basis they were prepared in — violet for rectilinear "+", teal for diagonal
 * "×" — and a rose ring marks the ones Eve grabbed. In E91 the source sits in
 * the middle and sends one half of each pair each way.
 *
 * Middle: the security parameter against the number of qubits sent. For BB84
 * that is the QBER with the 11% abort line; for E91 it is |S| with Bell's bound
 * at 2 and Tsirelson's at 2√2. The dotted line is the hand-derived expectation
 * for the current Eve setting; the band is ±1σ on the measured value.
 *
 * Bottom: the raw data — the last forty qubits or pairs, one column each.
 *
 * All physics is in lib/viz/qkd.ts and unit-tested there. This file draws.
 * Colours are resolved from CSS custom properties at runtime and re-read on
 * theme change; nothing here hardcodes a hex value.
 */

export type Protocol = 'bb84' | 'e91'

export type QkdLabStats =
  | { protocol: 'bb84'; stats: Bb84Stats; ledger: Bb84Qubit[]; done: boolean }
  | { protocol: 'e91'; stats: E91Stats; grid: number[]; done: boolean }

type Props = {
  protocol: Protocol
  bb84: Bb84Params
  e91: E91Params
  /** Qubits (BB84) or pairs (E91) to send in this run. */
  target: number
  running: boolean
  /** Bump to discard the run and start over. */
  runKey: number
  onStats?: (s: QkdLabStats) => void
  className?: string
}

const EMIT_MS = 120
const CHART_POINTS = 120
const TARGET_FRAMES = 240
/** Seconds for a photon to cross the channel. */
const FLIGHT_SECONDS = 1.1
const MAX_FLYERS = 14

export type Flyer = { t: number; basis: 0 | 1; intercepted: boolean; noisy: boolean; pair: boolean }

export default function QkdLab({
  protocol,
  bb84,
  e91,
  target,
  running,
  runKey,
  onStats,
  className = '',
}: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const sizeRef = useRef({ w: 0, h: 0 })
  const loopRef = useRef<FrameLoop | null>(null)

  const propsRef = useRef({ protocol, bb84, e91, target, running })
  propsRef.current = { protocol, bb84, e91, target, running }
  const onStatsRef = useRef(onStats)
  onStatsRef.current = onStats

  const generationRef = useRef(0)
  const builtRef = useRef(-1)
  const bb84RunRef = useRef<Bb84Run | null>(null)
  const e91RunRef = useRef<E91Run | null>(null)
  const randRef = useRef<() => number>(() => 0)
  const flyersRef = useRef<Flyer[]>([])

  useEffect(() => {
    generationRef.current += 1
    loopRef.current?.start()
  }, [protocol, bb84, e91, target, runKey])

  useEffect(() => {
    if (running) loopRef.current?.start()
  }, [running])

  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const reduceMotion = prefersReducedMotion()
    let colors = readVizColors(wrap)
    let lastEmit = 0
    let lastNow = 0

    const resetRun = (): void => {
      const live = propsRef.current
      const gen = generationRef.current
      const seed =
        (gen * 2246822519) ^
        Math.round(live.bb84.interceptFraction * 1013) ^
        Math.round(live.bb84.channelNoise * 7919) ^
        Math.round(live.e91.interceptFraction * 104729) ^
        (live.protocol === 'bb84' ? 17 : 91)
      const every = Math.max(1, Math.floor(live.target / CHART_POINTS))
      bb84RunRef.current = createBb84Run(live.bb84, every)
      e91RunRef.current = createE91Run(live.e91, every)
      randRef.current = mulberry32(seed >>> 0)
      flyersRef.current = []
      builtRef.current = gen
      lastEmit = 0
    }

    const emit = (done: boolean): void => {
      const live = propsRef.current
      if (live.protocol === 'bb84') {
        const run = bb84RunRef.current
        if (run) onStatsRef.current?.({ protocol: 'bb84', stats: bb84Stats(run), ledger: run.ledger.slice(), done })
      } else {
        const run = e91RunRef.current
        if (run) onStatsRef.current?.({ protocol: 'e91', stats: e91Stats(run), grid: run.grid.slice(), done })
      }
    }

    const sentSoFar = (): number =>
      propsRef.current.protocol === 'bb84'
        ? (bb84RunRef.current?.sent ?? 0)
        : (e91RunRef.current?.sent ?? 0)

    const spawnFlyers = (before: number): void => {
      if (reduceMotion) return
      const live = propsRef.current
      const flyers = flyersRef.current
      if (live.protocol === 'bb84') {
        const run = bb84RunRef.current
        if (!run) return
        const fresh = Math.min(2, run.sent - before, run.recent.length)
        for (let i = run.recent.length - fresh; i < run.recent.length; i++) {
          const q = run.recent[i]
          if (flyers.length >= MAX_FLYERS) break
          flyers.push({ t: 0, basis: q.aliceBasis, intercepted: q.eve !== null, noisy: q.noise !== null, pair: false })
        }
      } else {
        const run = e91RunRef.current
        if (!run) return
        const fresh = Math.min(2, run.sent - before, run.recent.length)
        for (let i = run.recent.length - fresh; i < run.recent.length; i++) {
          const p = run.recent[i]
          if (flyers.length >= MAX_FLYERS) break
          flyers.push({ t: 0, basis: 0, intercepted: p.eveAxis !== null, noisy: false, pair: true })
        }
      }
    }

    const onFrame = (now: number): boolean => {
      if (builtRef.current !== generationRef.current) resetRun()
      const live = propsRef.current
      const dt = lastNow > 0 ? Math.min(0.05, (now - lastNow) / 1000) : 0
      lastNow = now

      const before = sentSoFar()
      const remaining = live.target - before
      let more = false
      if (remaining > 0 && live.running) {
        // Under prefers-reduced-motion the statistics are still the content:
        // finish the whole run in one quiet batch rather than animating photons.
        const batch = reduceMotion
          ? remaining
          : Math.min(remaining, Math.max(4, Math.ceil(live.target / TARGET_FRAMES)))
        if (live.protocol === 'bb84' && bb84RunRef.current) advanceBb84(bb84RunRef.current, randRef.current, batch)
        if (live.protocol === 'e91' && e91RunRef.current) advanceE91(e91RunRef.current, randRef.current, batch)
        spawnFlyers(before)
        more = sentSoFar() < live.target
      }

      // Let photons already in the air land after the run stops or pauses.
      const flyers = flyersRef.current
      for (const f of flyers) f.t += dt / FLIGHT_SECONDS
      flyersRef.current = flyers.filter((f) => f.t < 1)
      if (flyersRef.current.length > 0) more = true

      const done = sentSoFar() >= live.target
      if (now - lastEmit > EMIT_MS || !more) {
        lastEmit = now
        emit(done)
      }

      const { w, h } = sizeRef.current
      if (w > 0 && h > 0) paint(ctx, w, h, colors)
      return more
    }

    const paint = (c: CanvasRenderingContext2D, w: number, h: number, col: VizColors): void => {
      const live = propsRef.current
      if (live.protocol === 'bb84') {
        const run = bb84RunRef.current
        if (run) renderBb84(c, run, live.target, flyersRef.current, w, h, col)
      } else {
        const run = e91RunRef.current
        if (run) renderE91(c, run, live.target, flyersRef.current, w, h, col)
      }
    }

    const loop = createFrameLoop(window, document, domIntersectionWatcher(wrap), onFrame)
    loopRef.current = loop

    const repaint = (): void => {
      const { w, h } = sizeRef.current
      if (w > 0 && h > 0) paint(ctx, w, h, colors)
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
      if (builtRef.current !== generationRef.current) resetRun()
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

  const label =
    protocol === 'bb84'
      ? `BB84 key exchange over up to ${target.toLocaleString('en-US')} qubits, with Eve intercepting ` +
        `${Math.round(bb84.interceptFraction * 100)}% of them and a channel error of ` +
        `${(bb84.channelNoise * 100).toFixed(1)}%. Photons fly from Alice past Eve to Bob; a chart ` +
        `plots the quantum bit error rate against qubits sent, with the 11% abort threshold as a ` +
        `dashed line; a strip shows the last forty qubits. Every number is printed beside the chart.`
      : `E91 key exchange over up to ${target.toLocaleString('en-US')} entangled pairs, with Eve ` +
        `intercepting ${Math.round(e91.interceptFraction * 100)}% of Bob's qubits. A source in the ` +
        `middle sends one qubit each to Alice and Bob; a chart plots the CHSH statistic |S| against ` +
        `pairs measured, with Bell's bound of 2 and the quantum maximum of 2.828 as dashed lines; a ` +
        `strip shows the last forty pairs. Every number is printed beside the chart.`

  return (
    <div ref={wrapRef} className={`relative w-full ${className}`} style={{ height: 480 }}>
      <canvas ref={canvasRef} className="block h-full w-full" role="img" aria-label={label} />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Drawing
// ─────────────────────────────────────────────────────────────────────────────

const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace'
const SANS = 'ui-sans-serif, system-ui, sans-serif'

type Layout = {
  channel: { y: number; h: number }
  chart: { x: number; y: number; w: number; h: number }
  strip: { y: number; h: number }
}

function layoutFor(w: number, h: number): Layout {
  const channelH = 118
  const stripH = 118
  const gap = 14
  const chartY = channelH + gap
  const chartH = h - channelH - stripH - gap * 2
  return {
    channel: { y: 0, h: channelH },
    chart: { x: 44, y: chartY + 8, w: w - 44 - 14, h: chartH - 22 },
    strip: { y: h - stripH, h: stripH },
  }
}

function clear(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.clearRect(0, 0, w, h)
}

function party(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  name: string,
  accent: string,
  col: VizColors,
  faded = false
): void {
  ctx.save()
  ctx.globalAlpha = faded ? 0.35 : 1
  ctx.fillStyle = withAlpha(accent, 0.16)
  ctx.strokeStyle = accent
  ctx.lineWidth = 1.5
  const r = 22
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = col.ink
  ctx.font = `bold 12px ${SANS}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(name, x, y)
  ctx.restore()
}

function dashedLine(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): void {
  ctx.save()
  ctx.setLineDash([5, 5])
  ctx.beginPath()
  ctx.moveTo(x0, y0)
  ctx.lineTo(x1, y1)
  ctx.stroke()
  ctx.restore()
}

function basisColor(basis: 0 | 1, col: VizColors): string {
  return basis === 0 ? col.violet : col.teal
}

/** A photon: a dot in the basis colour, with a rose ring if Eve had her hands on it. */
function photon(ctx: CanvasRenderingContext2D, x: number, y: number, f: Flyer, col: VizColors): void {
  ctx.beginPath()
  ctx.arc(x, y, 5, 0, Math.PI * 2)
  ctx.fillStyle = f.pair ? col.sky : basisColor(f.basis, col)
  ctx.fill()
  if (f.intercepted && f.t > 0.5) {
    ctx.beginPath()
    ctx.arc(x, y, 8.5, 0, Math.PI * 2)
    ctx.strokeStyle = col.rose
    ctx.lineWidth = 1.5
    ctx.stroke()
  }
  if (f.noisy && f.t > 0.62) {
    ctx.fillStyle = col.amber
    ctx.font = `bold 10px ${MONO}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'bottom'
    ctx.fillText('~', x, y - 8)
  }
}

// ── BB84 ─────────────────────────────────────────────────────────────────────

export function renderBb84(
  ctx: CanvasRenderingContext2D,
  run: Bb84Run,
  target: number,
  flyers: Flyer[],
  w: number,
  h: number,
  col: VizColors
): void {
  clear(ctx, w, h)
  const L = layoutFor(w, h)
  const stats = bb84Stats(run)

  // ── Channel ──
  const cy = L.channel.y + 58
  const ax = 40
  const bx = w - 40
  const ex = (ax + bx) / 2
  const eveActive = run.params.interceptFraction > 0

  ctx.strokeStyle = col.lineStrong
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(ax + 24, cy)
  ctx.lineTo(bx - 24, cy)
  ctx.stroke()

  party(ctx, ax, cy, 'Alice', col.violet, col)
  party(ctx, bx, cy, 'Bob', col.sky, col)
  party(ctx, ex, cy, 'Eve', col.rose, col, !eveActive)

  ctx.font = `11px ${SANS}`
  ctx.fillStyle = col.inkMuted
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.fillText('prepares', ax, cy + 28)
  ctx.fillText('measures', bx, cy + 28)
  ctx.fillText(
    eveActive ? `intercepts ${Math.round(run.params.interceptFraction * 100)}%` : 'not listening',
    ex,
    cy + 28
  )
  ctx.textAlign = 'left'
  ctx.fillStyle = col.inkSecondary
  ctx.font = `bold 11px ${SANS}`
  ctx.fillText('BB84', 10, 8)
  ctx.textAlign = 'right'
  ctx.fillStyle = col.inkMuted
  ctx.font = `11px ${MONO}`
  ctx.fillText(`${run.sent.toLocaleString('en-US')} / ${target.toLocaleString('en-US')} sent`, w - 10, 8)

  for (const f of flyers) {
    const x = ax + 24 + (bx - ax - 48) * f.t
    photon(ctx, x, cy, f, col)
  }

  // ── QBER chart ──
  const C = L.chart
  const yMax = 0.4
  const yOf = (q: number) => C.y + C.h - (Math.min(yMax, q) / yMax) * C.h
  const xOf = (sent: number) => C.x + (sent / Math.max(1, target)) * C.w

  ctx.strokeStyle = col.line
  ctx.lineWidth = 1
  ctx.font = `10px ${MONO}`
  ctx.fillStyle = col.inkMuted
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  for (const tick of [0, 0.1, 0.2, 0.3, 0.4]) {
    const y = yOf(tick)
    ctx.beginPath()
    ctx.moveTo(C.x, y)
    ctx.lineTo(C.x + C.w, y)
    ctx.stroke()
    ctx.fillText(`${Math.round(tick * 100)}%`, C.x - 6, y)
  }
  ctx.textAlign = 'left'
  ctx.textBaseline = 'bottom'
  ctx.fillStyle = col.inkSecondary
  ctx.font = `bold 11px ${SANS}`
  ctx.fillText('QBER on the sifted key', C.x, C.y - 2)

  // Abort threshold.
  ctx.strokeStyle = col.amber
  ctx.lineWidth = 1.5
  dashedLine(ctx, C.x, yOf(QBER_ABORT), C.x + C.w, yOf(QBER_ABORT))
  ctx.fillStyle = col.amberText
  ctx.font = `10px ${MONO}`
  ctx.textAlign = 'right'
  ctx.textBaseline = 'bottom'
  ctx.fillText('11% abort', C.x + C.w - 2, yOf(QBER_ABORT) - 2)

  // Expectation for the current attack.
  const expected = expectedBb84Qber(run.params)
  ctx.strokeStyle = withAlpha(col.rose, 0.7)
  ctx.lineWidth = 1
  ctx.save()
  ctx.setLineDash([2, 4])
  ctx.beginPath()
  ctx.moveTo(C.x, yOf(expected))
  ctx.lineTo(C.x + C.w, yOf(expected))
  ctx.stroke()
  ctx.restore()
  if (expected > 0.005) {
    ctx.fillStyle = col.roseText
    ctx.textAlign = 'left'
    ctx.textBaseline = expected > QBER_ABORT ? 'bottom' : 'top'
    ctx.fillText(`expected ${(expected * 100).toFixed(1)}%`, C.x + 4, yOf(expected) + (expected > QBER_ABORT ? -2 : 2))
  }

  // ±1σ band, then the measured curve.
  const s = run.samples
  if (s.length > 1) {
    ctx.beginPath()
    for (let i = 0; i < s.length; i++) ctx.lineTo(xOf(s[i].sent), yOf(s[i].qber + s[i].se))
    for (let i = s.length - 1; i >= 0; i--) ctx.lineTo(xOf(s[i].sent), yOf(Math.max(0, s[i].qber - s[i].se)))
    ctx.closePath()
    ctx.fillStyle = withAlpha(col.violet, 0.14)
    ctx.fill()
    ctx.beginPath()
    for (let i = 0; i < s.length; i++) ctx.lineTo(xOf(s[i].sent), yOf(s[i].qber))
    ctx.strokeStyle = col.violet
    ctx.lineWidth = 2
    ctx.stroke()
  }
  if (run.sifted > 0) {
    const x = xOf(run.sent)
    const y = yOf(stats.qber)
    ctx.beginPath()
    ctx.arc(x, y, 4, 0, Math.PI * 2)
    ctx.fillStyle = stats.qber > QBER_ABORT ? col.rose : col.violet
    ctx.fill()
    ctx.fillStyle = col.ink
    ctx.font = `bold 11px ${MONO}`
    ctx.textAlign = x > C.x + C.w - 60 ? 'right' : 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(`${(stats.qber * 100).toFixed(1)}%`, x + (x > C.x + C.w - 60 ? -8 : 8), y)
  }

  // ── Raw data strip ──
  renderBb84Strip(ctx, run.recent, L.strip.y, L.strip.h, w, col)
}

function renderBb84Strip(
  ctx: CanvasRenderingContext2D,
  recent: Bb84Qubit[],
  y0: number,
  h: number,
  w: number,
  col: VizColors
): void {
  const labelW = 44
  const n = 40
  const cellW = (w - labelW - 8) / n
  const rows = ['Alice', 'Eve', 'Bob', 'kept'] as const
  const rowH = (h - 18) / rows.length
  ctx.font = `bold 11px ${SANS}`
  ctx.fillStyle = col.inkSecondary
  ctx.textAlign = 'left'
  ctx.textBaseline = 'bottom'
  ctx.fillText('last 40 qubits · basis and bit', 10, y0 + 14)

  ctx.font = `10px ${SANS}`
  ctx.textBaseline = 'middle'
  rows.forEach((name, r) => {
    ctx.fillStyle = col.inkMuted
    ctx.textAlign = 'left'
    ctx.fillText(name, 10, y0 + 18 + rowH * (r + 0.5))
  })

  const start = n - recent.length
  ctx.textAlign = 'center'
  for (let i = 0; i < recent.length; i++) {
    const q = recent[i]
    const x = labelW + (start + i) * cellW + cellW / 2
    const cell = (r: number) => y0 + 18 + rowH * (r + 0.5)
    ctx.font = `bold 11px ${MONO}`
    ctx.fillStyle = basisColor(q.aliceBasis, col)
    ctx.fillText(`${BASIS_LABEL[q.aliceBasis]}${q.aliceBit}`, x, cell(0))
    if (q.eve) {
      ctx.fillStyle = col.rose
      ctx.fillText(`${BASIS_LABEL[q.eve.basis]}${q.eve.bit}`, x, cell(1))
    } else {
      ctx.fillStyle = col.line
      ctx.fillText('·', x, cell(1))
    }
    ctx.fillStyle = basisColor(q.bobBasis, col)
    ctx.fillText(`${BASIS_LABEL[q.bobBasis]}${q.bobBit}`, x, cell(2))
    const cy = cell(3)
    const size = Math.min(cellW - 2, rowH - 4)
    if (q.sifted) {
      ctx.fillStyle = q.error ? col.rose : col.teal
      ctx.fillRect(x - size / 2, cy - size / 2, size, size)
      if (q.error) {
        ctx.fillStyle = col.ink
        ctx.font = `bold 9px ${MONO}`
        ctx.fillText('!', x, cy)
      }
    } else {
      ctx.strokeStyle = col.line
      ctx.lineWidth = 1
      ctx.strokeRect(x - size / 2, cy - size / 2, size, size)
    }
  }
}

// ── E91 ──────────────────────────────────────────────────────────────────────

export function renderE91(
  ctx: CanvasRenderingContext2D,
  run: E91Run,
  target: number,
  flyers: Flyer[],
  w: number,
  h: number,
  col: VizColors
): void {
  clear(ctx, w, h)
  const L = layoutFor(w, h)
  const stats = e91Stats(run)

  // ── Channel: source in the middle, Eve on Bob's arm ──
  const cy = L.channel.y + 58
  const ax = 40
  const bx = w - 40
  const sx = (ax + bx) / 2
  const ex = sx + (bx - sx) / 2
  const eveActive = run.params.interceptFraction > 0

  ctx.strokeStyle = col.lineStrong
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(ax + 24, cy)
  ctx.lineTo(bx - 24, cy)
  ctx.stroke()

  party(ctx, ax, cy, 'Alice', col.violet, col)
  party(ctx, bx, cy, 'Bob', col.sky, col)
  party(ctx, sx, cy, 'source', col.teal, col)
  party(ctx, ex, cy, 'Eve', col.rose, col, !eveActive)

  ctx.font = `11px ${SANS}`
  ctx.fillStyle = col.inkMuted
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.fillText('0° · 45° · 90°', ax, cy + 28)
  ctx.fillText('45° · 90° · 135°', bx, cy + 28)
  ctx.fillText('singlet pairs', sx, cy + 28)
  ctx.fillText(
    eveActive ? `intercepts ${Math.round(run.params.interceptFraction * 100)}%` : 'not listening',
    ex,
    cy + 28
  )
  ctx.textAlign = 'left'
  ctx.fillStyle = col.inkSecondary
  ctx.font = `bold 11px ${SANS}`
  ctx.fillText('E91', 10, 8)
  ctx.textAlign = 'right'
  ctx.fillStyle = col.inkMuted
  ctx.font = `11px ${MONO}`
  ctx.fillText(`${run.sent.toLocaleString('en-US')} / ${target.toLocaleString('en-US')} pairs`, w - 10, 8)

  for (const f of flyers) {
    // Each pair is two photons leaving the source in opposite directions.
    const left = sx - 24 - (sx - ax - 48) * f.t
    const right = sx + 24 + (bx - sx - 48) * f.t
    photon(ctx, left, cy, { ...f, intercepted: false }, col)
    photon(ctx, right, cy, f, col)
  }

  // ── |S| chart ──
  const C = L.chart
  const yMax = 3.1
  const yOf = (s: number) => C.y + C.h - (Math.min(yMax, Math.max(0, s)) / yMax) * C.h
  const xOf = (sent: number) => C.x + (sent / Math.max(1, target)) * C.w

  ctx.strokeStyle = col.line
  ctx.lineWidth = 1
  ctx.font = `10px ${MONO}`
  ctx.fillStyle = col.inkMuted
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  for (const tick of [0, 1, 2, 3]) {
    const y = yOf(tick)
    ctx.beginPath()
    ctx.moveTo(C.x, y)
    ctx.lineTo(C.x + C.w, y)
    ctx.stroke()
    ctx.fillText(`${tick}`, C.x - 6, y)
  }
  ctx.textAlign = 'left'
  ctx.textBaseline = 'bottom'
  ctx.fillStyle = col.inkSecondary
  ctx.font = `bold 11px ${SANS}`
  ctx.fillText('CHSH |S| from the mismatched runs', C.x, C.y - 2)

  ctx.lineWidth = 1.5
  ctx.strokeStyle = col.amber
  dashedLine(ctx, C.x, yOf(CLASSICAL_BOUND), C.x + C.w, yOf(CLASSICAL_BOUND))
  ctx.strokeStyle = col.teal
  dashedLine(ctx, C.x, yOf(TSIRELSON_BOUND), C.x + C.w, yOf(TSIRELSON_BOUND))
  ctx.font = `10px ${MONO}`
  ctx.textAlign = 'right'
  ctx.textBaseline = 'bottom'
  ctx.fillStyle = col.amberText
  ctx.fillText('Bell bound 2', C.x + C.w - 2, yOf(CLASSICAL_BOUND) - 2)
  ctx.fillStyle = col.tealText
  ctx.fillText('2√2 = 2.828', C.x + C.w - 2, yOf(TSIRELSON_BOUND) - 2)

  const expected = expectedE91S(run.params.interceptFraction)
  if (run.params.interceptFraction > 0) {
    ctx.strokeStyle = withAlpha(col.rose, 0.7)
    ctx.lineWidth = 1
    ctx.save()
    ctx.setLineDash([2, 4])
    ctx.beginPath()
    ctx.moveTo(C.x, yOf(expected))
    ctx.lineTo(C.x + C.w, yOf(expected))
    ctx.stroke()
    ctx.restore()
    ctx.fillStyle = col.roseText
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.fillText(`expected ${expected.toFixed(2)}`, C.x + 4, yOf(expected) + 2)
  }

  const s = run.samples
  if (s.length > 1) {
    ctx.beginPath()
    for (let i = 0; i < s.length; i++) ctx.lineTo(xOf(s[i].sent), yOf(s[i].sAbs + s[i].se))
    for (let i = s.length - 1; i >= 0; i--) ctx.lineTo(xOf(s[i].sent), yOf(s[i].sAbs - s[i].se))
    ctx.closePath()
    ctx.fillStyle = withAlpha(col.violet, 0.14)
    ctx.fill()
    ctx.beginPath()
    for (let i = 0; i < s.length; i++) ctx.lineTo(xOf(s[i].sent), yOf(s[i].sAbs))
    ctx.strokeStyle = col.violet
    ctx.lineWidth = 2
    ctx.stroke()
  }
  const chshPairs = run.tally.counts.reduce((a, b) => a + b, 0)
  if (chshPairs > 0) {
    const x = xOf(run.sent)
    const y = yOf(stats.chsh.sAbs)
    ctx.beginPath()
    ctx.arc(x, y, 4, 0, Math.PI * 2)
    ctx.fillStyle = stats.chsh.sAbs <= CLASSICAL_BOUND ? col.rose : col.violet
    ctx.fill()
    ctx.fillStyle = col.ink
    ctx.font = `bold 11px ${MONO}`
    ctx.textAlign = x > C.x + C.w - 60 ? 'right' : 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(stats.chsh.sAbs.toFixed(2), x + (x > C.x + C.w - 60 ? -8 : 8), y)
  }

  renderE91Strip(ctx, run.recent, L.strip.y, L.strip.h, w, col)
}

function renderE91Strip(
  ctx: CanvasRenderingContext2D,
  recent: E91Pair[],
  y0: number,
  h: number,
  w: number,
  col: VizColors
): void {
  const labelW = 44
  const n = 40
  const cellW = (w - labelW - 8) / n
  const rows = ['Alice', 'Bob', 'Eve', 'used'] as const
  const rowH = (h - 18) / rows.length
  ctx.font = `bold 11px ${SANS}`
  ctx.fillStyle = col.inkSecondary
  ctx.textAlign = 'left'
  ctx.textBaseline = 'bottom'
  ctx.fillText('last 40 pairs · axis and outcome · teal = key, amber = CHSH', 10, y0 + 14)

  ctx.font = `10px ${SANS}`
  ctx.textBaseline = 'middle'
  rows.forEach((name, r) => {
    ctx.fillStyle = col.inkMuted
    ctx.textAlign = 'left'
    ctx.fillText(name, 10, y0 + 18 + rowH * (r + 0.5))
  })

  const start = n - recent.length
  ctx.textAlign = 'center'
  const short = (deg: string) => deg.replace('°', '')
  for (let i = 0; i < recent.length; i++) {
    const p = recent[i]
    const x = labelW + (start + i) * cellW + cellW / 2
    const cell = (r: number) => y0 + 18 + rowH * (r + 0.5)
    ctx.font = `bold 10px ${MONO}`
    ctx.fillStyle = col.violet
    ctx.fillText(`${short(E91_ANGLE_LABELS.alice[p.ai])}${p.a > 0 ? '↑' : '↓'}`, x, cell(0))
    ctx.fillStyle = col.sky
    ctx.fillText(`${short(E91_ANGLE_LABELS.bob[p.bi])}${p.b > 0 ? '↑' : '↓'}`, x, cell(1))
    if (p.eveAxis !== null) {
      ctx.fillStyle = col.rose
      ctx.fillText(short(E91_ANGLE_LABELS.bob[p.eveAxis]), x, cell(2))
    } else {
      ctx.fillStyle = col.line
      ctx.fillText('·', x, cell(2))
    }
    const cy = cell(3)
    const size = Math.min(cellW - 2, rowH - 4)
    if (p.role === 'key') {
      const error = p.a === p.b
      ctx.fillStyle = error ? col.rose : col.teal
      ctx.fillRect(x - size / 2, cy - size / 2, size, size)
      if (error) {
        ctx.fillStyle = col.ink
        ctx.font = `bold 9px ${MONO}`
        ctx.fillText('!', x, cy)
      }
    } else if (p.role === 'chsh') {
      ctx.fillStyle = col.amber
      ctx.fillRect(x - size / 2, cy - size / 2, size, size)
    } else {
      ctx.strokeStyle = col.line
      ctx.lineWidth = 1
      ctx.strokeRect(x - size / 2, cy - size / 2, size, size)
    }
  }
}
