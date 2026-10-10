/**
 * Shared canvas plumbing for the /workbench/noise charts: theme colours read
 * from the CSS custom properties (so both themes work and a hex never leaks
 * in), device-pixel-ratio sizing, and the axes both charts draw.
 */

export interface ChartColors {
  violet: string
  teal: string
  amber: string
  rose: string
  sky: string
  ink: string
  inkSecondary: string
  inkMuted: string
  line: string
  surface: string
}

const FALLBACK: ChartColors = {
  violet: '#a99dff',
  teal: '#4edbca',
  amber: '#f2a96a',
  rose: '#e57969',
  sky: '#6283c8',
  ink: '#eef2ff',
  inkSecondary: '#8fa3c8',
  inkMuted: '#7d8cb0',
  line: 'rgba(255,255,255,0.07)',
  surface: '#0d1120',
}

export function readChartColors(el: HTMLElement): ChartColors {
  const css = window.getComputedStyle(el)
  const get = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback
  return {
    violet: get('--q-violet', FALLBACK.violet),
    teal: get('--q-teal', FALLBACK.teal),
    amber: get('--q-amber', FALLBACK.amber),
    rose: get('--q-rose', FALLBACK.rose),
    sky: get('--q-sky', FALLBACK.sky),
    ink: get('--ink', FALLBACK.ink),
    inkSecondary: get('--ink-secondary', FALLBACK.inkSecondary),
    inkMuted: get('--ink-muted', FALLBACK.inkMuted),
    line: get('--line-strong', FALLBACK.line),
    surface: get('--surface', FALLBACK.surface),
  }
}

/** Size the backing store to the CSS box × DPR; returns the CSS-pixel size. */
export function fitCanvas(canvas: HTMLCanvasElement): { width: number; height: number; ctx: CanvasRenderingContext2D | null } {
  const rect = canvas.getBoundingClientRect()
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const width = Math.max(1, Math.round(rect.width))
  const height = Math.max(1, Math.round(rect.height))
  if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
    canvas.width = width * dpr
    canvas.height = height * dpr
  }
  const ctx = canvas.getContext('2d')
  if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  return { width, height, ctx }
}

export interface Frame {
  left: number
  right: number
  top: number
  bottom: number
  x: (v: number) => number
  y: (v: number) => number
}

/** A linear plot frame with margins, returning the data→pixel maps. */
export function makeFrame(
  width: number,
  height: number,
  xRange: [number, number],
  yRange: [number, number],
  margin = { left: 44, right: 16, top: 14, bottom: 30 }
): Frame {
  const left = margin.left
  const right = width - margin.right
  const top = margin.top
  const bottom = height - margin.bottom
  const sx = (right - left) / (xRange[1] - xRange[0] || 1)
  const sy = (bottom - top) / (yRange[1] - yRange[0] || 1)
  return {
    left, right, top, bottom,
    x: (v) => left + (v - xRange[0]) * sx,
    y: (v) => bottom - (v - yRange[0]) * sy,
  }
}

export function drawAxes(
  ctx: CanvasRenderingContext2D,
  f: Frame,
  colors: ChartColors,
  opts: { xTicks: number[]; yTicks: number[]; xLabel: string; yLabel: string; xFormat?: (v: number) => string; yFormat?: (v: number) => string }
): void {
  ctx.save()
  ctx.font = '11px ui-sans-serif, system-ui, sans-serif'
  ctx.lineWidth = 1
  ctx.strokeStyle = colors.line
  ctx.fillStyle = colors.inkMuted
  // Gridlines + tick labels.
  for (const t of opts.yTicks) {
    const y = Math.round(f.y(t)) + 0.5
    ctx.beginPath(); ctx.moveTo(f.left, y); ctx.lineTo(f.right, y); ctx.stroke()
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle'
    ctx.fillText(opts.yFormat ? opts.yFormat(t) : String(t), f.left - 6, y)
  }
  for (const t of opts.xTicks) {
    const x = Math.round(f.x(t)) + 0.5
    ctx.beginPath(); ctx.moveTo(x, f.top); ctx.lineTo(x, f.bottom); ctx.stroke()
    ctx.textAlign = 'center'; ctx.textBaseline = 'top'
    ctx.fillText(opts.xFormat ? opts.xFormat(t) : String(t), x, f.bottom + 5)
  }
  // Axis labels.
  ctx.fillStyle = colors.inkSecondary
  ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'
  ctx.fillText(opts.xLabel, f.right, f.bottom - 4)
  ctx.textAlign = 'left'; ctx.textBaseline = 'top'
  ctx.fillText(opts.yLabel, f.left + 4, f.top)
  ctx.restore()
}

export function drawErrorBar(ctx: CanvasRenderingContext2D, x: number, y: number, halfHeightPx: number, color: string): void {
  if (!(halfHeightPx > 0.5)) return
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(x, y - halfHeightPx); ctx.lineTo(x, y + halfHeightPx)
  ctx.moveTo(x - 4, y - halfHeightPx); ctx.lineTo(x + 4, y - halfHeightPx)
  ctx.moveTo(x - 4, y + halfHeightPx); ctx.lineTo(x + 4, y + halfHeightPx)
  ctx.stroke()
  ctx.restore()
}

export function drawDot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string, hollow = false, bg?: string): void {
  ctx.save()
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  if (hollow) {
    ctx.fillStyle = bg ?? 'transparent'
    ctx.fill()
    ctx.lineWidth = 2
    ctx.strokeStyle = fill
    ctx.stroke()
  } else {
    ctx.fillStyle = fill
    ctx.fill()
  }
  ctx.restore()
}

/** Clamp to a symmetric range for the y axis, with a little headroom. */
export function niceRange(values: number[], floor: number, ceil: number): [number, number] {
  let lo = Infinity, hi = -Infinity
  for (const v of values) {
    if (!Number.isFinite(v)) continue
    lo = Math.min(lo, v); hi = Math.max(hi, v)
  }
  if (!Number.isFinite(lo)) return [floor, ceil]
  const pad = Math.max(0.05, (hi - lo) * 0.15)
  return [Math.max(floor, lo - pad), Math.min(ceil, hi + pad)]
}
