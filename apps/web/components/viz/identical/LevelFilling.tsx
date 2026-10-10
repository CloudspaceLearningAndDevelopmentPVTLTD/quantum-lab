'use client'

import type { ReactNode } from 'react'

/**
 * LevelFilling — the ladder of a box's levels with N particles dropped into their ground
 * state. Bosons stack in level 1; spin-polarised fermions take one level each; spin-½
 * fermions pair up, two per level.
 *
 * Plain SVG: a dozen lines and at most a few dozen circles, no long paths, and nothing
 * animates. Energies come in already computed so the page's readouts and this picture
 * cannot disagree.
 */

type Props = {
  /** Level energies in units of E₁, ascending. */
  energies: number[]
  /** Particles on each level, same length as `energies`. */
  occupation: number[]
  /** Pair the dots as ↑↓ when two share a level. */
  spinHalf: boolean
  accent: 'teal' | 'rose'
}

const W = 360
const H = 230
const PAD_T = 18
const PAD_B = 22
const LEFT = 58
const RIGHT = 20

export default function LevelFilling({ energies, occupation, spinHalf, accent }: Props) {
  const top = Math.max(1, energies[energies.length - 1] ?? 1)
  const plotH = H - PAD_T - PAD_B
  const yOf = (e: number) => H - PAD_B - (e / top) * plotH
  const lineX0 = LEFT
  const lineX1 = W - RIGHT
  const mid = (lineX0 + lineX1) / 2
  const colour = accent === 'teal' ? 'var(--q-teal)' : 'var(--q-rose)'
  const total = occupation.reduce((s, k) => s + k, 0)

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-auto w-full"
      role="img"
      aria-label={`Energy ladder with ${total} particle${total === 1 ? '' : 's'}. ${describe(occupation, spinHalf)}`}
    >
      {/* Well floor and walls, faint. */}
      <line x1={lineX0} y1={H - PAD_B + 0.5} x2={lineX1} y2={H - PAD_B + 0.5} stroke="var(--line-strong)" />
      {energies.map((e, k) => {
        const y = yOf(e)
        const count = occupation[k] ?? 0
        const dots: ReactNode[] = []
        const r = 6
        const gap = spinHalf ? 18 : 15
        const start = mid - ((count - 1) * gap) / 2
        for (let i = 0; i < count; i++) {
          const cx = start + i * gap
          dots.push(
            <g key={i}>
              <circle cx={cx} cy={y} r={r} fill={colour} opacity={0.92} />
              {spinHalf ? (
                <text
                  x={cx}
                  y={y + 0.5}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize="9"
                  fontWeight="700"
                  fill="var(--surface-2)"
                >
                  {i % 2 === 0 ? '↑' : '↓'}
                </text>
              ) : null}
            </g>
          )
        }
        return (
          <g key={k}>
            <line
              x1={lineX0}
              y1={y}
              x2={lineX1}
              y2={y}
              stroke={count > 0 ? colour : 'var(--line-strong)'}
              strokeWidth={count > 0 ? 1.5 : 1}
              opacity={count > 0 ? 0.9 : 1}
            />
            <text
              x={LEFT - 8}
              y={y}
              textAnchor="end"
              dominantBaseline="middle"
              fontSize="10"
              fontFamily="ui-monospace, monospace"
              fill="var(--ink-muted)"
            >
              n={k + 1} · {e.toFixed(0)}E₁
            </text>
            {dots}
          </g>
        )
      })}
    </svg>
  )
}

function describe(occupation: number[], spinHalf: boolean): string {
  const parts: string[] = []
  occupation.forEach((count, k) => {
    if (count > 0) parts.push(`level ${k + 1} holds ${count}${spinHalf && count === 2 ? ' (spin up and spin down)' : ''}`)
  })
  return parts.length ? parts.join(', ') + '.' : 'Every level is empty.'
}
