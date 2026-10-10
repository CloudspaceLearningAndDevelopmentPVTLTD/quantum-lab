'use client'

import { useEffect, useRef } from 'react'
import {
  analyticLogicalRate,
  runDuelShot,
  trainPerceptron,
  type DuelShot,
  type Perceptron,
} from './qec/decoderDuel'
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
 * QECDuelLab — the decoder duel, animated.
 *
 * Top: a live chart of each decoder's running logical error rate as shots
 * accumulate — majority vote in teal, the trained perceptron in violet — with the
 * exact optimal rate (which majority attains; see qec/decoderDuel.ts) as a dashed
 * amber ceiling⁠-⁠floor line. Bottom: the syndrome trace — the last few dozen
 * shots as columns of parity bits, which is the ONLY input either decoder ever
 * sees, with each contestant's verdict marked under every column.
 *
 * The perceptron is trained here, in this component, on the visitor's machine,
 * every time d or p changes: seeded streaming SGD in qec/decoderDuel.ts, a few
 * hundred milliseconds. Nothing is pre-baked — the training time shown in the
 * stats is a real measurement of that call.
 *
 * Colours are resolved from CSS custom properties at runtime and re-read on theme
 * change, per ADR-0007; nothing here hardcodes a hex value.
 */

/** Shots per animation frame. Big enough that the estimate visibly firms up. */
const SHOTS_PER_FRAME = 300
const EMIT_MS = 200
/** Columns kept in the syndrome trace. */
const TRACE_LEN = 36
/** Chart samples: one running-rate point roughly per this many shots. */
const SAMPLE_EVERY = 600

export type DuelLabStats = {
  shots: number
  majorityFailures: number
  netFailures: number
  /** Wall-clock milliseconds the in-browser training run took. */
  trainMs: number
  done: boolean
}

type Props = {
  d: number
  /** Physical bit-flip rate. */
  p: number
  /** Shots to run before the duel stops. */
  targetShots: number
  /** Bump to retrain and rerun from scratch. */
  runKey: number
  onStats?: (s: DuelLabStats) => void
  className?: string
}

type Run = {
  net: Perceptron
  rand: () => number
  trainMs: number
  shots: number
  majorityFailures: number
  netFailures: number
  trace: DuelShot[]
  samples: { shots: number; maj: number; net: number }[]
  nextSample: number
}

export default function QECDuelLab({ d, p, targetShots, runKey, onStats, className = '' }: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const sizeRef = useRef({ w: 0, h: 0 })
  const loopRef = useRef<FrameLoop | null>(null)

  const propsRef = useRef({ d, p, targetShots })
  propsRef.current = { d, p, targetShots }
  const onStatsRef = useRef(onStats)
  onStatsRef.current = onStats

  const generationRef = useRef(0)
  const builtRef = useRef(-1)
  const runRef = useRef<Run | null>(null)

  useEffect(() => {
    generationRef.current += 1
    loopRef.current?.start()
  }, [d, p, targetShots, runKey])

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
      // Seed mixes the config and the run counter so "Rerun" genuinely resamples
      // while d/p/runKey alone fully determine the stream.
      const seed = (gen * 2246822519) ^ (live.d * 668265263) ^ Math.round(live.p * 1e6)
      const t0 = performance.now()
      const net = trainPerceptron(live.d, live.p, seed ^ 0x9e3779b9)
      const trainMs = performance.now() - t0
      runRef.current = {
        net,
        rand: mulberry32(seed),
        trainMs,
        shots: 0,
        majorityFailures: 0,
        netFailures: 0,
        trace: [],
        samples: [],
        nextSample: SAMPLE_EVERY,
      }
      builtRef.current = gen
      lastEmit = 0
    }

    const onFrame = (now: number): boolean => {
      if (builtRef.current !== generationRef.current) resetRun()
      const live = propsRef.current
      const run = runRef.current
      if (!run) return false

      let more = false
      if (run.shots < live.targetShots) {
        // Under prefers-reduced-motion the statistics are still the content:
        // finish the whole duel in one quiet batch instead of animating it.
        const batch = Math.min(
          reduceMotion ? live.targetShots : SHOTS_PER_FRAME,
          live.targetShots - run.shots
        )
        for (let i = 0; i < batch; i++) {
          const shot = runDuelShot(live.d, live.p, run.net, run.rand)
          run.shots++
          if (shot.majorityFail) run.majorityFailures++
          if (shot.netFail) run.netFailures++
          run.trace.push(shot)
          if (run.trace.length > TRACE_LEN) run.trace.shift()
          if (run.shots >= run.nextSample) {
            run.samples.push({
              shots: run.shots,
              maj: run.majorityFailures / run.shots,
              net: run.netFailures / run.shots,
            })
            run.nextSample += SAMPLE_EVERY
          }
        }
        more = run.shots < live.targetShots
      }

      if (now - lastEmit > EMIT_MS || !more) {
        lastEmit = now
        onStatsRef.current?.({
          shots: run.shots,
          majorityFailures: run.majorityFailures,
          netFailures: run.netFailures,
          trainMs: run.trainMs,
          done: run.shots >= live.targetShots,
        })
      }

      const { w, h } = sizeRef.current
      if (w > 0 && h > 0) render(ctx, live.d, live.p, live.targetShots, run, w, h, colors)
      return more
    }

    const loop = createFrameLoop(window, document, domIntersectionWatcher(wrap), onFrame)
    loopRef.current = loop

    const repaint = (): void => {
      const { w, h } = sizeRef.current
      const live = propsRef.current
      const run = runRef.current
      if (run && w > 0 && h > 0) render(ctx, live.d, live.p, live.targetShots, run, w, h, colors)
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
    <div ref={wrapRef} className={`relative w-full ${className}`} style={{ height: 440 }}>
      <canvas
        ref={canvasRef}
        className="block h-full w-full"
        role="img"
        aria-label={
          `Decoder duel on a distance-${d} repetition code at ${(p * 100).toFixed(1)}% ` +
          `bit-flip rate: a chart of the running logical error rate for majority-vote and ` +
          `a browser-trained neural decoder, over up to ${targetShots.toLocaleString('en-US')} shots, ` +
          `with the optimal rate drawn as a dashed line, and a trace of the recent syndromes ` +
          `both decoders were shown. The live numbers are printed beside this chart.`
        }
      />
    </div>
  )
}

function render(
  ctx: CanvasRenderingContext2D,
  d: number,
  p: number,
  targetShots: number,
  run: Run,
  w: number,
  h: number,
  colors: VizColors
): void {
  ctx.clearRect(0, 0, w, h)

  const traceRows = d - 1 + 2
  const traceH = Math.min(150, traceRows * 18 + 34)
  const pad = { left: 52, right: 16, top: 26, bottom: 18 }
  const chartTop = pad.top
  const chartBottom = h - traceH - pad.bottom - 12
  const chartLeft = pad.left
  const chartRight = w - pad.right
  const cw = chartRight - chartLeft
  const ch = chartBottom - chartTop
  if (cw <= 10 || ch <= 10) return

  const optimal = analyticLogicalRate(d, p)
  const majRate = run.shots > 0 ? run.majorityFailures / run.shots : 0
  const netRate = run.shots > 0 ? run.netFailures / run.shots : 0
  let yMax = Math.max(optimal * 2, majRate, netRate, 0.002)
  for (const s of run.samples) yMax = Math.max(yMax, s.maj, s.net)
  yMax *= 1.15

  const xOf = (shots: number) => chartLeft + (shots / targetShots) * cw
  const yOf = (rate: number) => chartBottom - (Math.min(rate, yMax) / yMax) * ch

  // ── Frame and gridlines ──
  ctx.strokeStyle = colors.line
  ctx.lineWidth = 1
  ctx.strokeRect(chartLeft, chartTop, cw, ch)
  ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace'
  ctx.fillStyle = colors.inkMuted
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  for (let i = 0; i <= 4; i++) {
    const rate = (yMax * i) / 4
    const y = yOf(rate)
    if (i > 0 && i < 4) {
      ctx.strokeStyle = withAlpha(colors.ink, 0.06)
      ctx.beginPath()
      ctx.moveTo(chartLeft, y)
      ctx.lineTo(chartRight, y)
      ctx.stroke()
    }
    ctx.fillText(`${(rate * 100).toFixed(rate < 0.01 ? 2 : 1)}%`, chartLeft - 6, y)
  }
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.fillText(`${run.shots.toLocaleString('en-US')} / ${targetShots.toLocaleString('en-US')} shots`, chartLeft + cw / 2, chartBottom + 4)

  // ── The optimal rate: dashed amber. Majority converges onto this line. ──
  ctx.save()
  ctx.setLineDash([5, 4])
  ctx.strokeStyle = withAlpha(colors.amber, 0.8)
  ctx.lineWidth = 1.25
  ctx.beginPath()
  ctx.moveTo(chartLeft, yOf(optimal))
  ctx.lineTo(chartRight, yOf(optimal))
  ctx.stroke()
  ctx.restore()

  // ── Running-rate lines ──
  const drawSeries = (key: 'maj' | 'net', last: number, color: string): void => {
    ctx.strokeStyle = color
    ctx.lineWidth = 2
    ctx.lineJoin = 'round'
    ctx.beginPath()
    let started = false
    for (const s of run.samples) {
      const x = xOf(s.shots)
      const y = yOf(s[key])
      if (!started) {
        ctx.moveTo(x, y)
        started = true
      } else ctx.lineTo(x, y)
    }
    if (run.shots > 0) {
      const x = xOf(run.shots)
      const y = yOf(last)
      if (!started) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(x, y, 3, 0, Math.PI * 2)
      ctx.fillStyle = color
      ctx.fill()
    } else ctx.stroke()
  }
  drawSeries('maj', majRate, colors.teal)
  drawSeries('net', netRate, colors.violet)

  // ── Legend ──
  ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  let lx = chartLeft + 8
  const legend: [string, string][] = [
    ['majority vote', colors.tealText],
    ['trained net', colors.violetText],
    ['optimal (exact)', colors.amberText],
  ]
  for (const [label, color] of legend) {
    ctx.fillStyle = color
    ctx.fillText(`— ${label}`, lx, chartTop - 12)
    lx += ctx.measureText(`— ${label}`).width + 16
  }

  // ── Syndrome trace ──
  const traceTop = h - traceH
  const cols = TRACE_LEN
  const cell = Math.min(14, (w - pad.left - pad.right) / cols - 2)
  const gap = 2
  const pitch = cell + gap
  const tx0 = chartLeft
  ctx.font = '9px ui-monospace, SFMono-Regular, Menlo, monospace'
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = colors.inkMuted
  for (let rIdx = 0; rIdx < d - 1; rIdx++) {
    ctx.fillText(`s${rIdx}`, tx0 - 5, traceTop + 14 + rIdx * pitch + cell / 2)
  }
  ctx.fillText('MV', tx0 - 5, traceTop + 14 + (d - 1) * pitch + cell / 2)
  ctx.fillText('NN', tx0 - 5, traceTop + 14 + d * pitch + cell / 2)
  ctx.textAlign = 'left'
  ctx.fillText('what the decoders saw (latest shots) — dot = verdict: filled ok, ✕ logical error', tx0, traceTop + 2)

  for (let c = 0; c < run.trace.length; c++) {
    const shot = run.trace[c]
    const x = tx0 + c * pitch
    for (let rIdx = 0; rIdx < d - 1; rIdx++) {
      const y = traceTop + 14 + rIdx * pitch
      const lit = shot.syndrome[rIdx] === 1
      ctx.fillStyle = lit ? withAlpha(colors.sky, 0.85) : withAlpha(colors.ink, 0.07)
      ctx.fillRect(x, y, cell, cell)
    }
    const verdict = (row: number, fail: boolean, color: string): void => {
      const y = traceTop + 14 + row * pitch
      const cxm = x + cell / 2
      const cym = y + cell / 2
      if (fail) {
        ctx.strokeStyle = colors.rose
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.moveTo(cxm - 3, cym - 3)
        ctx.lineTo(cxm + 3, cym + 3)
        ctx.moveTo(cxm + 3, cym - 3)
        ctx.lineTo(cxm - 3, cym + 3)
        ctx.stroke()
      } else {
        ctx.fillStyle = withAlpha(color, 0.9)
        ctx.beginPath()
        ctx.arc(cxm, cym, 2.5, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    verdict(d - 1, shot.majorityFail, colors.teal)
    verdict(d, shot.netFail, colors.violet)
  }
}
