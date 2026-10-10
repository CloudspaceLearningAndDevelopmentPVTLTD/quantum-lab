'use client'

import { useEffect, useRef, useState } from 'react'
import { readVizColors, withAlpha, type VizColors } from '@/components/viz/theme'
import { watchThemeChange } from '@/components/viz/frameLoop'
import { NOMINAL_TRUTH, type StepRecord } from '@/lib/workbench/calibration'

/**
 * CalibrationChart — three stacked panels on one canvas.
 *
 *   1. X-gate fidelity per step for the agent, the scheduled sweep and the
 *      untouched pulse. Teal ticks along the floor mark the steps on which
 *      the scheduled controller paid for a full sweep.
 *   2. The qubit's hidden frequency (rose, dashed, faint) against the drive
 *      frequency each controller has chosen.
 *   3. The qubit's hidden Rabi rate against the Rabi rate each controller's
 *      pulse IMPLIES — 500/(amplitude × duration), the rate at which its
 *      current pulse would be an exact π. When a controller is calibrated its
 *      line sits on the dashed one.
 *
 * The dashed lines are the truth the reader is allowed to see and the
 * controllers are not; they come from the record's `truth` field, which no
 * controller ever receives.
 *
 * Redraws are coalesced to one requestAnimationFrame per batch of records, so
 * the cost is one full repaint per ~33 ms of run, not per step. There is no
 * animation here to reduce: the canvas only changes when the data does.
 */

const FID_H = 210
const SMALL_H = 118
const GAP = 26
const ML = 56
const MR = 14
const MT = 10
const MB = 24
export const CHART_HEIGHT = MT + FID_H + GAP + SMALL_H + GAP + SMALL_H + MB

const impliedRabiRate = (p: { amplitude: number; duration: number }) => 500 / (p.amplitude * p.duration)

export function CalibrationChart({
  records,
  budget,
  className,
}: {
  records: StepRecord[]
  budget: number
  className?: string
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const colorsRef = useRef<VizColors | null>(null)
  const [width, setWidth] = useState(720)
  const [themeTick, setThemeTick] = useState(0)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    if (typeof ResizeObserver !== 'function') {
      setWidth(el.clientWidth || 720)
      return
    }
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width
      if (w && w > 0) setWidth(Math.round(w))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => watchThemeChange(() => setThemeTick((t) => t + 1)), [])

  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return
    let handle: number | null = null
    const draw = () => {
      handle = null
      const dpr = typeof window !== 'undefined' ? Math.min(2, window.devicePixelRatio || 1) : 1
      const w = width
      const h = CHART_HEIGHT
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr)
        canvas.height = Math.round(h * dpr)
      }
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      colorsRef.current = readVizColors(wrap)
      paint(ctx, w, h, records, budget, colorsRef.current)
    }
    if (typeof requestAnimationFrame === 'function') {
      handle = requestAnimationFrame(draw)
    } else {
      draw()
    }
    return () => {
      if (handle !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(handle)
    }
  }, [records, budget, width, themeTick])

  const last = records[records.length - 1]
  const pct = (v: number) => `${(v * 100).toFixed(2)}%`
  const label = last
    ? `Calibration trace after ${last.step + 1} of ${budget} steps. Agent fidelity ${pct(last.agent.fidelity)}, scheduled sweep ${pct(last.scheduled.fidelity)}, untouched pulse ${pct(last.fixed.fidelity)}. Hidden qubit frequency ${last.truth.frequency.toFixed(2)} MHz; agent drive ${last.agent.pulse.frequency.toFixed(2)} MHz, scheduled drive ${last.scheduled.pulse.frequency.toFixed(2)} MHz.`
    : `Calibration trace, empty. Press Run to start a ${budget}-step run.`

  return (
    <div ref={wrapRef} className={className}>
      <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 px-1 text-[11px] text-ink-muted" aria-hidden>
        <Legend swatch="bg-q-violet" text="RL agent" />
        <Legend swatch="bg-q-teal" text="Scheduled sweep" />
        <Legend swatch="bg-ink-muted" opacity={0.55} text="Never recalibrated" />
        <Legend swatch="bg-q-rose" opacity={0.6} text="Hidden truth (reader only)" />
      </div>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={label}
        style={{ width: `${width}px`, height: `${CHART_HEIGHT}px`, display: 'block' }}
      />
    </div>
  )
}

function Legend({ swatch, text, opacity }: { swatch: string; text: string; opacity?: number }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block h-[3px] w-4 rounded-full ${swatch}`} style={{ opacity }} />
      {text}
    </span>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Painting
// ─────────────────────────────────────────────────────────────────────────────

type Panel = { top: number; height: number; yMin: number; yMax: number }

function niceStep(range: number, target: number): number {
  const raw = range / target
  const mag = 10 ** Math.floor(Math.log10(raw))
  for (const m of [1, 2, 2.5, 5, 10]) if (m * mag >= raw) return m * mag
  return 10 * mag
}

function paint(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  records: StepRecord[],
  budget: number,
  c: VizColors
) {
  ctx.clearRect(0, 0, w, h)
  const plotW = Math.max(40, w - ML - MR)
  const xOf = (step: number) => ML + (plotW * step) / Math.max(1, budget - 1)

  // ── Ranges ──────────────────────────────────────────────────────────────
  let fMin = 1
  let fAbs = 1
  let kDev = 0.05
  for (const r of records) {
    fMin = Math.min(fMin, r.agent.fidelity, r.scheduled.fidelity, r.fixed.fidelity)
    fAbs = Math.max(
      fAbs,
      Math.abs(r.truth.frequency),
      Math.abs(r.agent.pulse.frequency),
      Math.abs(r.scheduled.pulse.frequency)
    )
    for (const k of [r.truth.rabiRate, impliedRabiRate(r.agent.pulse), impliedRabiRate(r.scheduled.pulse)]) {
      kDev = Math.max(kDev, Math.abs(k / NOMINAL_TRUTH.rabiRate - 1))
    }
  }
  // Fidelity floor: at least 3% of headroom, snapped to a 1% grid, never above 0.97.
  const floor = Math.max(0.5, Math.min(0.97, Math.floor((fMin - 0.005) * 100) / 100))
  const fid: Panel = { top: MT, height: FID_H, yMin: floor, yMax: 1 }
  const freq: Panel = { top: MT + FID_H + GAP, height: SMALL_H, yMin: -fAbs * 1.15, yMax: fAbs * 1.15 }
  const rabi: Panel = {
    top: MT + FID_H + GAP + SMALL_H + GAP,
    height: SMALL_H,
    yMin: NOMINAL_TRUTH.rabiRate * (1 - kDev * 1.25),
    yMax: NOMINAL_TRUTH.rabiRate * (1 + kDev * 1.25),
  }
  const yOf = (p: Panel, v: number) =>
    p.top + p.height - ((Math.min(p.yMax, Math.max(p.yMin, v)) - p.yMin) / (p.yMax - p.yMin)) * p.height

  // ── Frames, grids, axis labels ───────────────────────────────────────────
  ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace'
  ctx.textBaseline = 'middle'
  const drawPanel = (p: Panel, title: string, fmt: (v: number) => string, ticks: number) => {
    ctx.fillStyle = withAlpha(c.surface2, 0.5)
    ctx.fillRect(ML, p.top, plotW, p.height)
    ctx.strokeStyle = c.line
    ctx.lineWidth = 1
    ctx.strokeRect(ML + 0.5, p.top + 0.5, plotW - 1, p.height - 1)
    const step = niceStep(p.yMax - p.yMin, ticks)
    const first = Math.ceil(p.yMin / step) * step
    ctx.textAlign = 'right'
    for (let v = first; v <= p.yMax + 1e-9; v += step) {
      const y = Math.round(yOf(p, v)) + 0.5
      ctx.strokeStyle = c.line
      ctx.beginPath()
      ctx.moveTo(ML, y)
      ctx.lineTo(ML + plotW, y)
      ctx.stroke()
      ctx.fillStyle = c.inkMuted
      ctx.fillText(fmt(v), ML - 6, y)
    }
    ctx.textAlign = 'left'
    ctx.fillStyle = c.inkSecondary
    ctx.font = 'bold 11px ui-sans-serif, system-ui, sans-serif'
    ctx.fillText(title, ML + 8, p.top + 11)
    ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace'
  }
  drawPanel(fid, 'X-gate fidelity', (v) => `${(v * 100).toFixed(v >= 0.995 ? 1 : 0)}%`, 4)
  drawPanel(freq, 'Qubit frequency offset (MHz)', (v) => v.toFixed(1), 3)
  drawPanel(rabi, 'Rabi rate (MHz per unit amplitude)', (v) => v.toFixed(1), 3)

  // x axis: step numbers under the last panel.
  ctx.textAlign = 'center'
  ctx.fillStyle = c.inkMuted
  const xStep = niceStep(budget, 6)
  for (let s = 0; s <= budget; s += xStep) {
    const x = xOf(Math.min(s, budget - 1))
    ctx.fillText(String(s), x, rabi.top + rabi.height + 12)
  }
  ctx.textAlign = 'left'
  ctx.fillText('step', ML + plotW - 28, rabi.top + rabi.height + 12)

  if (records.length === 0) {
    ctx.fillStyle = c.inkMuted
    ctx.font = '13px ui-sans-serif, system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('Press Run. The trace draws as the controllers work.', ML + plotW / 2, fid.top + fid.height / 2)
    return
  }

  // ── Series ──────────────────────────────────────────────────────────────
  const line = (
    p: Panel,
    pick: (r: StepRecord) => number,
    color: string,
    width: number,
    dash: number[] = []
  ) => {
    ctx.save()
    ctx.beginPath()
    ctx.rect(ML, p.top, plotW, p.height)
    ctx.clip()
    ctx.strokeStyle = color
    ctx.lineWidth = width
    ctx.lineJoin = 'round'
    ctx.setLineDash(dash)
    ctx.beginPath()
    for (let i = 0; i < records.length; i++) {
      const r = records[i]
      const x = xOf(r.step)
      const y = yOf(p, pick(r))
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
    ctx.restore()
  }

  // Sweep ticks first so the lines sit on top of them.
  ctx.strokeStyle = withAlpha(c.teal, 0.7)
  ctx.lineWidth = 1
  for (const r of records) {
    if (r.scheduled.spent > 0) {
      const x = Math.round(xOf(r.step)) + 0.5
      ctx.beginPath()
      ctx.moveTo(x, fid.top + fid.height - 8)
      ctx.lineTo(x, fid.top + fid.height - 1)
      ctx.stroke()
    }
  }

  line(fid, (r) => r.fixed.fidelity, withAlpha(c.inkMuted, 0.55), 1.25)
  line(fid, (r) => r.scheduled.fidelity, c.teal, 1.75)
  line(fid, (r) => r.agent.fidelity, c.violet, 1.75)

  line(freq, (r) => r.truth.frequency, withAlpha(c.rose, 0.6), 1.5, [4, 4])
  line(freq, (r) => r.scheduled.pulse.frequency, c.teal, 1.5)
  line(freq, (r) => r.agent.pulse.frequency, c.violet, 1.5)

  line(rabi, (r) => r.truth.rabiRate, withAlpha(c.rose, 0.6), 1.5, [4, 4])
  line(rabi, (r) => impliedRabiRate(r.scheduled.pulse), c.teal, 1.5)
  line(rabi, (r) => impliedRabiRate(r.agent.pulse), c.violet, 1.5)

  // Latest-value markers at the right end of each fidelity line.
  const last = records[records.length - 1]
  const dot = (p: Panel, v: number, color: string) => {
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(xOf(last.step), yOf(p, v), 3, 0, Math.PI * 2)
    ctx.fill()
  }
  dot(fid, last.scheduled.fidelity, c.teal)
  dot(fid, last.agent.fidelity, c.violet)
}
