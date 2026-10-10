'use client'

import { useEffect, useRef } from 'react'
import {
  CLASSICAL_BOUND,
  PAIR_LABELS,
  SETTING_PAIRS,
  TSIRELSON_BOUND,
  advanceRun,
  createRun,
  lhvCorrelators,
  quantumCorrelators,
  summarize,
  type ChshRun,
  type ChshSettings,
  type LhvStrategy,
  type TallyStats,
} from '@/lib/viz/chsh'
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
 * BellTestLab — two experiments run side by side on the same trials.
 *
 * Top: |S| against the number of pairs measured, with a ±1σ band around each
 * estimate. The dashed amber line at 2 is Bell's bound; the dashed teal line at
 * 2√2 is Tsirelson's. The violet curve is the quantum experiment; the rose curve
 * is a local hidden-variable source running the same protocol, trial for trial.
 *
 * Middle: where S actually comes from — the four measured correlators, quantum
 * against classical, with the exact theory value marked as a tick on each bar.
 *
 * Bottom: the raw data, last 64 pairs. Every column is one entangled pair (or one
 * classical pair); a filled cell means the two detectors agreed.
 *
 * All physics is in lib/viz/chsh.ts and unit-tested there. This file draws.
 * Colours are resolved from CSS custom properties at runtime and re-read on theme
 * change, per ADR-0007; nothing here hardcodes a hex value.
 */

export type BellLabStats = {
  trials: number
  quantum: TallyStats
  classical: TallyStats
  /** Mean of the per-pair CHSH witness over the classical source's hidden states. */
  witnessMean: number
  witnessMaxAbs: number
  done: boolean
}

type Props = {
  settings: ChshSettings
  strategy: LhvStrategy
  targetTrials: number
  running: boolean
  /** Bump to discard the run and start over. */
  runKey: number
  onStats?: (s: BellLabStats) => void
  className?: string
}

/** How often stats are pushed up to the page, in milliseconds. */
const EMIT_MS = 120
/** Chart points per completed run. */
const CHART_POINTS = 140
/** Aim to finish any run in roughly this many animation frames. */
const TARGET_FRAMES = 220

export default function BellTestLab({
  settings,
  strategy,
  targetTrials,
  running,
  runKey,
  onStats,
  className = '',
}: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const sizeRef = useRef({ w: 0, h: 0 })
  const loopRef = useRef<FrameLoop | null>(null)

  const propsRef = useRef({ settings, strategy, targetTrials, running })
  propsRef.current = { settings, strategy, targetTrials, running }
  const onStatsRef = useRef(onStats)
  onStatsRef.current = onStats

  // A generation counter is the single source of "this run is stale". Changing
  // any physical input bumps it; the frame callback notices and rebuilds.
  const generationRef = useRef(0)
  const builtRef = useRef(-1)
  const runRef = useRef<ChshRun | null>(null)
  const randRef = useRef<() => number>(() => 0)

  useEffect(() => {
    generationRef.current += 1
    loopRef.current?.start()
  }, [settings, strategy, targetTrials, runKey])

  // `running` alone must not discard the accumulated statistics — pausing and
  // resuming a Bell test does not reset the counters.
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

    const resetRun = (): void => {
      const live = propsRef.current
      const gen = generationRef.current
      const seed =
        (gen * 2246822519) ^
        Math.round(live.settings.a * 1013) ^
        Math.round(live.settings.aPrime * 7919) ^
        Math.round(live.settings.b * 104729) ^
        Math.round(live.settings.bPrime * 15485863)
      runRef.current = createRun(
        live.strategy,
        live.settings,
        Math.max(1, Math.floor(live.targetTrials / CHART_POINTS))
      )
      randRef.current = mulberry32(seed >>> 0)
      builtRef.current = gen
      lastEmit = 0
    }

    const emit = (run: ChshRun, done: boolean): void => {
      onStatsRef.current?.({
        trials: run.trials,
        quantum: summarize(run.quantum),
        classical: summarize(run.classical),
        witnessMean: run.trials > 0 ? run.witnessSum / run.trials : 0,
        witnessMaxAbs: run.witnessMaxAbs,
        done,
      })
    }

    const onFrame = (now: number): boolean => {
      if (builtRef.current !== generationRef.current) resetRun()
      const live = propsRef.current
      const run = runRef.current
      if (!run) return false

      const remaining = live.targetTrials - run.trials
      let more = false
      if (remaining > 0 && live.running) {
        // Under prefers-reduced-motion the statistics are still the content:
        // finish the whole experiment in one quiet batch rather than animating
        // a curve creeping across the canvas.
        const batch = reduceMotion
          ? remaining
          : Math.min(remaining, Math.max(40, Math.ceil(live.targetTrials / TARGET_FRAMES)))
        advanceRun(run, randRef.current, batch)
        more = run.trials < live.targetTrials
      }

      const done = run.trials >= live.targetTrials
      if (now - lastEmit > EMIT_MS || !more) {
        lastEmit = now
        emit(run, done)
      }

      const { w, h } = sizeRef.current
      if (w > 0 && h > 0) render(ctx, run, live.targetTrials, w, h, colors)
      return more
    }

    const loop = createFrameLoop(window, document, domIntersectionWatcher(wrap), onFrame)
    loopRef.current = loop

    const repaint = (): void => {
      const { w, h } = sizeRef.current
      const run = runRef.current
      if (run && w > 0 && h > 0) {
        render(ctx, run, propsRef.current.targetTrials, w, h, colors)
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

  return (
    <div ref={wrapRef} className={`relative w-full ${className}`} style={{ height: 460 }}>
      <canvas
        ref={canvasRef}
        className="block h-full w-full"
        role="img"
        aria-label={
          `A CHSH Bell test over up to ${targetTrials.toLocaleString('en-US')} measured pairs, with ` +
          `Alice's analyzers at ${settings.a}° and ${settings.aPrime}° and Bob's at ` +
          `${settings.b}° and ${settings.bPrime}°. A chart plots the CHSH statistic |S| for the ` +
          `entangled source and for a local hidden-variable source against the number of pairs, ` +
          `with the classical bound of 2 and the quantum bound of 2.828 drawn as dashed lines, ` +
          `then a bar chart of the four measured correlators against their theory values, then ` +
          `a strip of the most recent pairs. Every number in this chart is printed beside it.`
        }
      />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Drawing
// ─────────────────────────────────────────────────────────────────────────────

const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace'
/** Top of the |S| axis. Comfortably above 2√2 without wasting vertical space. */
const S_MAX = 3.1

function render(
  ctx: CanvasRenderingContext2D,
  run: ChshRun,
  targetTrials: number,
  w: number,
  h: number,
  colors: VizColors
): void {
  ctx.clearRect(0, 0, w, h)

  const stripH = 46
  const barsH = 116
  const gap = 14
  const chartTop = 24
  const chartBottom = h - stripH - barsH - gap * 2
  const chartLeft = 46
  const chartRight = w - 12
  const cw = chartRight - chartLeft
  const ch = chartBottom - chartTop
  if (cw <= 20 || ch <= 20) return

  drawConvergence(ctx, run, targetTrials, chartLeft, chartTop, cw, ch, colors)
  drawCorrelators(ctx, run, chartLeft, chartBottom + gap, cw, barsH, colors)
  drawStrip(ctx, run, chartLeft, h - stripH, cw, stripH, colors)
}

function drawConvergence(
  ctx: CanvasRenderingContext2D,
  run: ChshRun,
  targetTrials: number,
  x0: number,
  y0: number,
  cw: number,
  ch: number,
  colors: VizColors
): void {
  const xOf = (trials: number) => x0 + (Math.min(trials, targetTrials) / targetTrials) * cw
  const yOf = (s: number) => y0 + ch - (Math.max(0, Math.min(S_MAX, s)) / S_MAX) * ch

  ctx.strokeStyle = colors.line
  ctx.lineWidth = 1
  ctx.strokeRect(x0, y0, cw, ch)

  // ── Axis ticks every 0.5 in |S| ──
  ctx.font = `10px ${MONO}`
  ctx.fillStyle = colors.inkMuted
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  for (let s = 0; s <= 3; s += 0.5) {
    const y = yOf(s)
    if (s > 0) {
      ctx.strokeStyle = withAlpha(colors.ink, 0.05)
      ctx.beginPath()
      ctx.moveTo(x0, y)
      ctx.lineTo(x0 + cw, y)
      ctx.stroke()
    }
    ctx.fillText(s.toFixed(1), x0 - 6, y)
  }

  // ── The two bounds ──
  const bound = (value: number, color: string, label: string, align: 'left' | 'right'): void => {
    const y = yOf(value)
    ctx.save()
    ctx.setLineDash([5, 4])
    ctx.strokeStyle = withAlpha(color, 0.85)
    ctx.lineWidth = 1.25
    ctx.beginPath()
    ctx.moveTo(x0, y)
    ctx.lineTo(x0 + cw, y)
    ctx.stroke()
    ctx.restore()
    ctx.fillStyle = color
    ctx.textAlign = align
    ctx.textBaseline = 'bottom'
    ctx.fillText(label, align === 'left' ? x0 + 6 : x0 + cw - 6, y - 3)
  }
  bound(TSIRELSON_BOUND, colors.tealText, '2√2 — quantum limit', 'left')
  bound(CLASSICAL_BOUND, colors.amberText, 'S = 2 — every local theory stops here', 'left')

  // ── ±1σ bands, then the running estimates ──
  const band = (key: 'quantum' | 'classical', color: string): void => {
    if (run.samples.length < 2) return
    ctx.fillStyle = withAlpha(color, 0.16)
    ctx.beginPath()
    for (let i = 0; i < run.samples.length; i++) {
      const s = run.samples[i]
      const v = key === 'quantum' ? s.quantum + s.quantumSe : s.classical + s.classicalSe
      const p = xOf(s.trials)
      if (i === 0) ctx.moveTo(p, yOf(v))
      else ctx.lineTo(p, yOf(v))
    }
    for (let i = run.samples.length - 1; i >= 0; i--) {
      const s = run.samples[i]
      const v = key === 'quantum' ? s.quantum - s.quantumSe : s.classical - s.classicalSe
      ctx.lineTo(xOf(s.trials), yOf(v))
    }
    ctx.closePath()
    ctx.fill()
  }

  const series = (key: 'quantum' | 'classical', color: string, live: number): void => {
    ctx.strokeStyle = color
    ctx.lineWidth = 2
    ctx.lineJoin = 'round'
    ctx.beginPath()
    let started = false
    for (const s of run.samples) {
      const v = key === 'quantum' ? s.quantum : s.classical
      const px = xOf(s.trials)
      const py = yOf(v)
      if (!started) {
        ctx.moveTo(px, py)
        started = true
      } else ctx.lineTo(px, py)
    }
    if (run.trials > 0) {
      const px = xOf(run.trials)
      const py = yOf(live)
      if (started) ctx.lineTo(px, py)
      else ctx.moveTo(px, py)
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(px, py, 3.5, 0, Math.PI * 2)
      ctx.fillStyle = color
      ctx.fill()
    } else if (started) ctx.stroke()
  }

  const q = summarize(run.quantum)
  const c = summarize(run.classical)
  band('quantum', colors.violet)
  band('classical', colors.rose)
  series('classical', colors.rose, c.sAbs)
  series('quantum', colors.violet, q.sAbs)

  // ── Legend and trial counter ──
  ctx.font = `10px ${MONO}`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  let lx = x0
  for (const [label, color] of [
    ['— entangled pairs', colors.violetText],
    ['— hidden variables', colors.roseText],
  ] as const) {
    ctx.fillStyle = color
    ctx.fillText(label, lx, y0 - 12)
    lx += ctx.measureText(label).width + 16
  }
  ctx.fillStyle = colors.inkMuted
  ctx.textAlign = 'right'
  ctx.fillText(
    `${run.trials.toLocaleString('en-US')} / ${targetTrials.toLocaleString('en-US')} pairs`,
    x0 + cw,
    y0 - 12
  )
}

function drawCorrelators(
  ctx: CanvasRenderingContext2D,
  run: ChshRun,
  x0: number,
  y0: number,
  cw: number,
  hh: number,
  colors: VizColors
): void {
  const q = summarize(run.quantum)
  const c = summarize(run.classical)
  const qTheory = quantumCorrelators(run.settings)
  const cTheory = lhvCorrelators(run.strategy, run.settings)

  const labelH = 14
  const plotTop = y0 + labelH
  const plotH = hh - labelH - 12
  const mid = plotTop + plotH / 2
  const half = plotH / 2

  ctx.font = `10px ${MONO}`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillStyle = colors.inkMuted
  ctx.fillText('the four correlators E = ⟨A·B⟩ that S is built from', x0, y0)
  ctx.textAlign = 'right'
  ctx.fillText('tick = exact theory', x0 + cw, y0)

  // The E = 0 line (bright, because sign is the thing to read) and the ±1 rails.
  ctx.lineWidth = 1
  for (const v of [1, 0, -1]) {
    ctx.strokeStyle = withAlpha(colors.ink, v === 0 ? 0.18 : 0.07)
    ctx.beginPath()
    ctx.moveTo(x0, mid - v * half)
    ctx.lineTo(x0 + cw, mid - v * half)
    ctx.stroke()
  }

  const groupW = cw / 4
  ctx.textBaseline = 'middle'
  for (let i = 0; i < 4; i++) {
    const key = SETTING_PAIRS[i]
    const gx = x0 + i * groupW
    const barW = Math.min(20, groupW / 3.4)
    const cx = gx + groupW / 2

    const bar = (offset: number, value: number, theory: number, color: string): void => {
      const bx = cx + offset - barW / 2
      const top = value >= 0 ? mid - value * half : mid
      ctx.fillStyle = withAlpha(color, 0.75)
      ctx.fillRect(bx, top, barW, Math.abs(value) * half)
      // Theory tick: a short bright rule across the bar at the exact value.
      ctx.strokeStyle = color
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(bx - 3, mid - theory * half)
      ctx.lineTo(bx + barW + 3, mid - theory * half)
      ctx.stroke()
    }

    bar(-barW * 0.65, q.perPair[i].e, qTheory[key], colors.violet)
    bar(barW * 0.65, c.perPair[i].e, cTheory[key], colors.rose)

    ctx.fillStyle = colors.inkMuted
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillText(PAIR_LABELS[key], cx, plotTop + plotH + 2)
  }
}

function drawStrip(
  ctx: CanvasRenderingContext2D,
  run: ChshRun,
  x0: number,
  y0: number,
  cw: number,
  hh: number,
  colors: VizColors
): void {
  ctx.font = `9px ${MONO}`
  ctx.fillStyle = colors.inkMuted
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillText('last 64 pairs — filled = the two detectors agreed', x0, y0)

  const rowTop = y0 + 13
  const cell = Math.max(3, Math.min(9, cw / 64 - 2))
  const pitch = cell + 2
  const rows: ['quantumAgree' | 'classicalAgree', string][] = [
    ['quantumAgree', colors.violet],
    ['classicalAgree', colors.rose],
  ]

  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  for (let r = 0; r < rows.length; r++) {
    const y = rowTop + r * (cell + 3)
    ctx.fillStyle = colors.inkMuted
    ctx.fillText(r === 0 ? 'Q' : 'C', x0 - 6, y + cell / 2)
    for (let i = 0; i < run.recent.length; i++) {
      const t = run.recent[i]
      const agreed = t[rows[r][0]]
      const x = x0 + i * pitch
      if (agreed) {
        ctx.fillStyle = withAlpha(rows[r][1], 0.9)
        ctx.fillRect(x, y, cell, cell)
      } else {
        ctx.strokeStyle = withAlpha(rows[r][1], 0.45)
        ctx.lineWidth = 1
        ctx.strokeRect(x + 0.5, y + 0.5, cell - 1, cell - 1)
      }
    }
  }
}
