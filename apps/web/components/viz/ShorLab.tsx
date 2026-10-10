'use client'

import { useEffect, useMemo, useRef } from 'react'
import {
  attemptFactor,
  expectedPeaks,
  periodFromMeasurement,
  sampleCounting,
  type PeriodFinding,
} from './shor/period'
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
 * ShorLab — the period-finding half of Shor's algorithm, drawn as two stacked panels.
 *
 * TOP    f(x) = a^x mod N, the classical periodic function. Every x is a dot at its
 *        residue; the dots that survived the work-register measurement are filled and
 *        joined, so the arithmetic progression x₀, x₀+r, x₀+2r … is visible directly.
 * BOTTOM |amplitude|² over the counting register after the QFT — the comb at multiples
 *        of 2^n/r — with sampled measurements accumulating on top of it.
 *
 * The spectrum is computed once per (N, a, work-measurement) in shor/period.ts and
 * handed here as data. What this component's frame loop actually does is (a) ease the
 * bars from flat to their computed heights, and (b) when sampling is on, draw real
 * Born-rule measurements from that distribution and run each one through continued
 * fractions — that arithmetic is the per-frame work, not decoration.
 *
 * Rendering approximation, stated because it is one: at n = 12 the spectrum has 4096
 * bins and the canvas has ~700 px, so bins are bucketed per pixel and the bucket's
 * MAXIMUM is drawn. Max, not mean: the comb teeth are one bin wide, and averaging
 * would erase the very structure the page exists to show. The numbers in the table
 * beside the canvas are per-bin and exact.
 */

/** Shots drawn per animation frame while sampling. */
const SHOTS_PER_FRAME = 3
/** Emit stats to React at ~5 Hz, not once per frame. */
const EMIT_MS = 200
const EASE_MS = 420

const PAD_L = 46
const PAD_R = 14
const PAD_T = 22
const GAP = 30
const AXIS_H = 22

export type ShotStats = {
  /** Measurements drawn so far. */
  total: number
  /** Shots whose continued-fraction step returned a valid period. */
  recovered: number
  /** Shots that went all the way to a non-trivial factor pair. */
  factored: number
  lastC: number | null
  lastR: number | null
  lastFactors: [number, number] | null
}

const ZERO_STATS: ShotStats = {
  total: 0,
  recovered: 0,
  factored: 0,
  lastC: null,
  lastR: null,
  lastFactors: null,
}

type Props = {
  finding: PeriodFinding
  /** When true the loop keeps drawing measurements from the spectrum. */
  sampling: boolean
  /** Bump to clear the accumulated shots and reseed. */
  resetKey: number
  onShots?: (s: ShotStats) => void
  className?: string
}

export default function ShorLab({
  finding,
  sampling,
  resetKey,
  onShots,
  className = '',
}: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const sizeRef = useRef({ w: 0, h: 0 })
  const loopRef = useRef<FrameLoop | null>(null)

  // Live props for a loop that is created once and must not close over stale values.
  const propsRef = useRef({ finding, sampling })
  propsRef.current = { finding, sampling }
  const onShotsRef = useRef(onShots)
  onShotsRef.current = onShots

  // Per-run mutable state. `generation` is bumped by the effect below whenever the
  // run changes; the loop notices and clears rather than mixing shots from two runs.
  const generationRef = useRef(0)
  const builtRef = useRef(-1)
  const histRef = useRef<Uint32Array>(new Uint32Array(0))
  const statsRef = useRef<ShotStats>(ZERO_STATS)
  const easeRef = useRef(0)

  useEffect(() => {
    generationRef.current += 1
    loopRef.current?.start()
  }, [finding, resetKey])

  useEffect(() => {
    loopRef.current?.start()
  }, [sampling])

  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const reduceMotion = prefersReducedMotion()
    let colors = readVizColors(wrap)
    let rand = mulberry32(1)
    let lastTime = 0
    let lastEmit = 0

    const resetRun = (): void => {
      const pf = propsRef.current.finding
      histRef.current = new Uint32Array(pf.sizes.M)
      statsRef.current = ZERO_STATS
      easeRef.current = reduceMotion ? 1 : 0
      // Seeded per generation so a reset gives a genuinely different run while the
      // same reset gives the same run twice — reproducible, not frozen.
      rand = mulberry32(0x9e3779b9 ^ (generationRef.current * 2654435761))
      builtRef.current = generationRef.current
      lastEmit = 0
    }

    const onFrame = (now: number): boolean => {
      if (builtRef.current !== generationRef.current) resetRun()
      const pf = propsRef.current.finding
      const dt = lastTime === 0 ? 16 : Math.min(now - lastTime, 120)
      lastTime = now

      let more = false

      if (easeRef.current < 1) {
        easeRef.current = Math.min(1, easeRef.current + dt / EASE_MS)
        if (easeRef.current < 1) more = true
      }

      if (propsRef.current.sampling && !reduceMotion) {
        const hist = histRef.current
        const s = { ...statsRef.current }
        for (let i = 0; i < SHOTS_PER_FRAME; i++) {
          const c = sampleCounting(pf.spectrum, rand)
          hist[c] += 1
          s.total += 1
          s.lastC = c
          const r = periodFromMeasurement(c, pf.sizes.counting, pf.N, pf.a)
          s.lastR = r
          s.lastFactors = null
          if (r !== null) {
            s.recovered += 1
            const attempt = attemptFactor(pf.a, r, pf.N)
            if (attempt.ok) {
              s.factored += 1
              s.lastFactors = attempt.factors
            }
          }
        }
        statsRef.current = s
        more = true
      }

      if (now - lastEmit > EMIT_MS) {
        lastEmit = now
        onShotsRef.current?.(statsRef.current)
      }

      const { w, h } = sizeRef.current
      if (w > 0 && h > 0) {
        render(ctx, pf, histRef.current, easeRef.current, w, h, colors)
      }
      return more
    }

    const loop = createFrameLoop(window, document, domIntersectionWatcher(wrap), onFrame)
    loopRef.current = loop

    const repaint = (): void => {
      const { w, h } = sizeRef.current
      if (w > 0 && h > 0) {
        render(ctx, propsRef.current.finding, histRef.current, easeRef.current, w, h, colors)
      }
    }

    // Repaint on theme change even while the loop is paused off-screen.
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

  // describe() sorts the whole 4096-bin spectrum. React re-renders this component at
  // 5 Hz while sampling, so recomputing the label on every render would be ~1 ms of
  // sorting per frame for a string almost nobody reads more than once.
  const label = useMemo(() => describe(finding), [finding])

  return (
    <div ref={wrapRef} className={`relative w-full ${className}`} style={{ height: 460 }}>
      <canvas ref={canvasRef} className="block h-full w-full" role="img" aria-label={label} />
    </div>
  )
}

/**
 * The accessible name. It describes what the canvas shows RIGHT NOW — the base, the
 * measured work value, the spacing of the surviving comb and where the spectrum's
 * peaks are — because "a chart of the quantum Fourier transform" tells a screen
 * reader user nothing they could not have guessed from the heading.
 */
function describe(pf: PeriodFinding): string {
  const step =
    pf.survivors.length > 1 ? pf.survivors[1] - pf.survivors[0] : null
  const top = Array.from(pf.spectrum)
    .map((p, y) => ({ p, y }))
    .sort((u, v) => v.p - u.p)
    .slice(0, 4)
    .map((d) => `${d.y} at ${(d.p * 100).toFixed(1)} percent`)
  return (
    `Period finding for N equals ${pf.N} with base a equals ${pf.a}. ` +
    `Top panel: the classical function a to the x mod N. ` +
    `The work register measured ${pf.measuredWork}, leaving ${pf.survivors.length} values of x` +
    (step === null ? '' : ` spaced ${step} apart`) +
    `. Bottom panel: after the quantum Fourier transform over ${pf.sizes.M} basis states, ` +
    `the largest measurement probabilities are at ${top.join(', ')}. ` +
    `The true order of a mod N is ${pf.trueOrder ?? 'undefined'}.`
  )
}

function render(
  ctx: CanvasRenderingContext2D,
  pf: PeriodFinding,
  hist: Uint32Array,
  ease: number,
  w: number,
  h: number,
  colors: VizColors
): void {
  ctx.clearRect(0, 0, w, h)
  const plotW = Math.max(20, w - PAD_L - PAD_R)
  const bodyH = h - PAD_T - GAP - AXIS_H * 2
  const topH = Math.max(40, bodyH * 0.4)
  const botH = Math.max(40, bodyH - topH)
  const topY = PAD_T
  const botY = PAD_T + topH + AXIS_H + GAP

  const mono = '10px ui-monospace, SFMono-Regular, Menlo, monospace'
  const monoBold = '600 11px ui-monospace, SFMono-Regular, Menlo, monospace'

  // ── Top panel: the classical function ────────────────────────────────────────
  // Only the first stretch of x is drawn: at n = 12 there are 4096 points and the
  // period is under 60, so showing them all would be a solid band. The window is the
  // smaller of 96 x-values and whatever fits at 4 px each.
  // Named xWindow, not `window`: a local called `window` here would shadow the
  // global one for the whole function body.
  const xWindow = Math.min(pf.sizes.M, Math.max(24, Math.min(96, Math.floor(plotW / 4))))
  const xStep = plotW / xWindow
  const yOfResidue = (v: number) => topY + topH - (v / Math.max(1, pf.N - 1)) * (topH - 6) - 3

  ctx.fillStyle = colors.inkMuted
  ctx.font = mono
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  ctx.fillText(`${pf.N - 1}`, PAD_L - 6, yOfResidue(pf.N - 1))
  ctx.fillText('0', PAD_L - 6, yOfResidue(0))

  ctx.strokeStyle = withAlpha(colors.inkSecondary, 0.14)
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(PAD_L, Math.round(topY + topH) + 0.5)
  ctx.lineTo(PAD_L + plotW, Math.round(topY + topH) + 0.5)
  ctx.stroke()

  // Faint dots for every x in the window, filled dots for the survivors.
  const survivorSet = new Set(pf.survivors)
  for (let x = 0; x < xWindow; x++) {
    const cx = PAD_L + (x + 0.5) * xStep
    const cy = yOfResidue(pf.f[x])
    const isSurvivor = survivorSet.has(x)
    ctx.beginPath()
    ctx.arc(cx, cy, isSurvivor ? 3.2 : 1.6, 0, Math.PI * 2)
    ctx.fillStyle = isSurvivor ? colors.teal : withAlpha(colors.inkSecondary, 0.34)
    ctx.fill()
  }
  // A line joining the survivors makes the constant step read as a step.
  const inWindow = pf.survivors.filter((x) => x < xWindow)
  if (inWindow.length > 1) {
    ctx.strokeStyle = withAlpha(colors.teal, 0.5)
    ctx.lineWidth = 1.25
    ctx.beginPath()
    inWindow.forEach((x, i) => {
      const cx = PAD_L + (x + 0.5) * xStep
      const cy = yOfResidue(pf.f[x])
      if (i === 0) ctx.moveTo(cx, cy)
      else ctx.lineTo(cx, cy)
    })
    ctx.stroke()
  }

  ctx.font = monoBold
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillStyle = colors.inkSecondary
  ctx.fillText(`CLASSICAL   f(x) = ${pf.a}^x mod ${pf.N}`, PAD_L, topY - 14)
  ctx.font = mono
  ctx.fillStyle = colors.tealText
  ctx.textAlign = 'left'
  ctx.fillText(
    `work register measured ${pf.measuredWork} — ${pf.survivors.length} of ${pf.sizes.M} x values survive`,
    PAD_L,
    topY + topH + 5
  )
  ctx.textAlign = 'right'
  ctx.fillStyle = colors.inkMuted
  ctx.fillText(`x = 0 … ${xWindow - 1}`, PAD_L + plotW, topY + topH + 5)

  // ── Bottom panel: the QFT spectrum ───────────────────────────────────────────
  const M = pf.sizes.M
  const cols = Math.max(1, Math.min(M, Math.floor(plotW)))
  const colW = plotW / cols
  // Bucket maxima. See the note at the top of the file: max, not mean.
  const bucket = new Float64Array(cols)
  const bucketHist = new Float64Array(cols)
  for (let y = 0; y < M; y++) {
    const col = Math.min(cols - 1, Math.floor((y / M) * cols))
    if (pf.spectrum[y] > bucket[col]) bucket[col] = pf.spectrum[y]
    if (hist.length === M && hist[y] > bucketHist[col]) bucketHist[col] = hist[y]
  }
  let peak = 0
  for (const v of bucket) if (v > peak) peak = v
  if (peak <= 0) peak = 1
  let histPeak = 0
  for (const v of bucketHist) if (v > histPeak) histPeak = v

  const baseY = botY + botH

  // Expected peak positions, drawn behind the bars as a reference comb.
  if (pf.trueOrder !== null) {
    ctx.save()
    ctx.setLineDash([3, 4])
    ctx.strokeStyle = withAlpha(colors.amber, 0.55)
    ctx.lineWidth = 1
    ctx.beginPath()
    for (const y of expectedPeaks(pf.sizes.counting, pf.trueOrder)) {
      const px = PAD_L + (y / M) * plotW
      ctx.moveTo(px + 0.5, botY)
      ctx.lineTo(px + 0.5, baseY)
    }
    ctx.stroke()
    ctx.restore()
  }

  ctx.fillStyle = colors.violet
  for (let col = 0; col < cols; col++) {
    const barH = (bucket[col] / peak) * (botH - 4) * ease
    if (barH < 0.4) continue
    ctx.fillRect(PAD_L + col * colW, baseY - barH, Math.max(1, colW - 0.4), barH)
  }

  // Sampled shots, as an outline over the exact distribution.
  if (histPeak > 0) {
    ctx.strokeStyle = colors.skyText
    ctx.lineWidth = 1.25
    ctx.beginPath()
    for (let col = 0; col < cols; col++) {
      const y = baseY - (bucketHist[col] / histPeak) * (botH - 4)
      const px = PAD_L + col * colW + colW / 2
      if (col === 0) ctx.moveTo(px, y)
      else ctx.lineTo(px, y)
    }
    ctx.stroke()
  }

  ctx.strokeStyle = withAlpha(colors.inkSecondary, 0.14)
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(PAD_L, Math.round(baseY) + 0.5)
  ctx.lineTo(PAD_L + plotW, Math.round(baseY) + 0.5)
  ctx.stroke()

  ctx.font = monoBold
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillStyle = colors.violetText
  ctx.fillText(`QUANTUM   after the QFT over ${M} states`, PAD_L, botY - 14)

  ctx.font = mono
  ctx.fillStyle = colors.inkMuted
  ctx.textAlign = 'left'
  ctx.fillText('c = 0', PAD_L, baseY + 5)
  ctx.textAlign = 'right'
  ctx.fillText(`${M - 1}`, PAD_L + plotW, baseY + 5)
  ctx.textAlign = 'center'
  if (pf.trueOrder !== null) {
    ctx.fillStyle = colors.amberText
    ctx.fillText(
      `dashed: multiples of ${M}/${pf.trueOrder} = ${(M / pf.trueOrder).toFixed(2)}`,
      PAD_L + plotW / 2,
      baseY + 5
    )
  }
  ctx.textAlign = 'right'
  ctx.fillStyle = colors.inkMuted
  ctx.textBaseline = 'middle'
  ctx.fillText(`${(peak * 100).toFixed(1)}%`, PAD_L - 6, botY + 6)
}
