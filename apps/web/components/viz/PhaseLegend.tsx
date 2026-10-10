/**
 * PhaseLegend — the colour key shared by MatrixHistogram3D and HintonDiagram.
 *
 * `mode="phase"` draws the full ring as a horizontal gradient bar with ticks at
 * 0, π/2, π and 3π/2; `mode="sign"` draws just the two swatches a real matrix
 * needs (+ is the phase-0 colour, − is the phase-π colour). Pure markup + CSS
 * variables, so it needs no effect and renders on the server.
 *
 * Props:
 *   mode       'phase' | 'sign'
 *   className  extra classes on the wrapper
 */

import { phaseHex, phaseRingStops } from './matrixLayout'

const STOPS = phaseRingStops(24)
const GRADIENT = `linear-gradient(90deg, ${STOPS.map(
  (s, k) => `${s.hex} ${((k / (STOPS.length - 1)) * 100).toFixed(1)}%`
).join(', ')})`

const TICKS: { at: number; label: string }[] = [
  { at: 0, label: '0' },
  { at: 0.25, label: 'π/2' },
  { at: 0.5, label: 'π' },
  { at: 0.75, label: '3π/2' },
  { at: 1, label: '2π' },
]

export function PhaseLegend({ mode, className }: { mode: 'phase' | 'sign'; className?: string }) {
  if (mode === 'sign') {
    return (
      <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ink-muted ${className ?? ''}`}>
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block h-3 w-3 rounded-sm"
            style={{ backgroundColor: phaseHex(0) }}
          />
          positive
        </span>
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block h-3 w-3 rounded-sm"
            style={{ backgroundColor: phaseHex(Math.PI) }}
          />
          negative
        </span>
        <span>Size is |value|.</span>
      </div>
    )
  }
  return (
    <div className={`text-[11px] text-ink-muted ${className ?? ''}`}>
      <div className="flex items-center gap-2">
        <span className="shrink-0">phase</span>
        <div className="relative h-3 flex-1 rounded-sm" style={{ background: GRADIENT }} aria-hidden="true" />
      </div>
      <div className="relative ml-[2.6rem] mt-0.5 h-3" aria-hidden="true">
        {TICKS.map((t) => (
          <span
            key={t.label}
            className="absolute -translate-x-1/2 font-mono"
            style={{ left: `${t.at * 100}%` }}
          >
            {t.label}
          </span>
        ))}
      </div>
      <span className="sr-only">Colour is the phase of the entry, from 0 around to 2π. Size is its magnitude.</span>
    </div>
  )
}

export default PhaseLegend
