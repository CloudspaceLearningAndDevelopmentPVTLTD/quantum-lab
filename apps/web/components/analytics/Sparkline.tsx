'use client'

/**
 * Sparkline — a word-sized trend line for a stat tile.
 *
 * Deliberately minimal: no axes, no grid, no labels, no tooltip. A sparkline is
 * shape-only context for the number beside it, so it is `aria-hidden` and the
 * parent tile is responsible for communicating the value in text. Hand-built
 * SVG; the app ships no charting dependency.
 */

import { useId } from 'react'

/** The five categorical hues, in the fixed order. Never cycled, never extended. */
export type Accent = 'violet' | 'teal' | 'amber' | 'rose' | 'sky'

export const ACCENT_ORDER: readonly Accent[] = ['violet', 'teal', 'amber', 'rose', 'sky'] as const

/**
 * Named *_HEX for history; the values are CSS custom-property references, not
 * literal hexes. They are only ever handed to SVG paint attributes and inline
 * `background`, both of which accept var(), so a theme switch re-paints every
 * chart with no JS. The literal dark-theme hexes that used to live here
 * measured ~2:1 on a white surface once the light theme shipped.
 *
 * Do NOT concatenate an alpha suffix onto these (the old `${hex}20` trick) —
 * use a separate stopOpacity / fillOpacity, as the components below do.
 */
export const ACCENT_HEX: Record<Accent, string> = {
  violet: 'var(--q-violet)',
  teal: 'var(--q-teal)',
  amber: 'var(--q-amber)',
  rose: 'var(--q-rose)',
  sky: 'var(--q-sky)',
}

/** Light variants — used for text keys, where the base hue is too dark to read. */
export const ACCENT_LIGHT_HEX: Record<Accent, string> = {
  violet: 'var(--q-violet-text)',
  teal: 'var(--q-teal-text)',
  amber: 'var(--q-amber-text)',
  rose: 'var(--q-rose-text)',
  sky: 'var(--q-sky-text)',
}

export interface SparklineProps {
  data: number[]
  width?: number
  height?: number
  accent?: Accent
  showArea?: boolean
}

export function Sparkline({
  data,
  width = 96,
  height = 28,
  accent = 'violet',
  showArea = false,
}: SparklineProps) {
  const gradientId = useId()
  const stroke = ACCENT_HEX[accent]

  // No data at all — reserve the space so tiles don't jump, but draw nothing.
  if (data.length === 0) {
    return <svg width={width} height={height} aria-hidden="true" focusable="false" />
  }

  const pad = 3
  const innerW = Math.max(1, width - pad * 2)
  const innerH = Math.max(1, height - pad * 2)

  const min = Math.min(...data)
  const max = Math.max(...data)
  // A flat series (including the single-point case) sits on the vertical middle
  // rather than dividing by a zero range.
  const range = max - min
  const y = (v: number): number => (range === 0 ? pad + innerH / 2 : pad + innerH - ((v - min) / range) * innerH)
  // One point has no horizontal extent — pin it to the right edge, where the
  // "latest value" dot always lives.
  const x = (i: number): number => (data.length === 1 ? pad + innerW : pad + (i / (data.length - 1)) * innerW)

  const points = data.map((v, i) => `${x(i).toFixed(2)},${y(v).toFixed(2)}`)
  const linePath = `M${points.join(' L')}`
  const areaPath = `${linePath} L${(pad + innerW).toFixed(2)},${(pad + innerH).toFixed(2)} L${pad.toFixed(2)},${(pad + innerH).toFixed(2)} Z`

  const lastX = x(data.length - 1)
  const lastY = y(data[data.length - 1])

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
      focusable="false"
      className="overflow-visible"
    >
      {showArea ? (
        <>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={0.18} />
              <stop offset="100%" stopColor={stroke} stopOpacity={0.01} />
            </linearGradient>
          </defs>
          <path d={areaPath} fill={`url(#${gradientId})`} />
        </>
      ) : null}

      {data.length > 1 ? (
        <path
          d={linePath}
          fill="none"
          stroke={stroke}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}

      {/* End dot with a 2px surface ring, so it stays legible over the line. */}
      <circle cx={lastX} cy={lastY} r={3} fill={stroke} stroke="var(--surface)" strokeWidth={2} />
    </svg>
  )
}

export default Sparkline
