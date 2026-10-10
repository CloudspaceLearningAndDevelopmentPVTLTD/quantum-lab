'use client'

/**
 * PhaseDiskStrip — one small SVG disk per qubit, IBM Composer style.
 *
 * Encoding (also stated in the visible caption):
 *  - fill: the shaded inner disc's AREA is P(1), so its radius is R·√p1 —
 *    a half-probability qubit reads as a half-area disc, not a half-radius one.
 *  - needle: a radius line at the relative phase of the |1⟩ component,
 *    0 pointing right (+x), counter-clockwise positive, matching how the
 *    complex plane is drawn everywhere else in the app.
 *  - ring: the outer ring's opacity is the reduced state's purity Tr(ρ²) —
 *    a crisp ring means "this qubit stands alone", a faded one means it is
 *    entangled with the rest and no single-qubit picture fully describes it.
 *
 * Numbers come from lib/quantum-phase.ts (pure math, tested there).
 *
 * Colours are resolved from CSS custom properties at runtime and repainted
 * when the theme class on <html> changes — per ADR-0007. This file lives in
 * components/circuit/, not viz/, but it draws SVG with literal colour strings,
 * so the same rule applies; it uses the shared components/viz/theme.ts reader
 * rather than growing a twelfth private copy of it.
 *
 * The strip hides itself entirely above MAX_DISKS qubits: at 9+ disks each
 * one drops under ~28px in the inspector column and both the needle and the
 * fill become unreadable — a wrong-looking widget teaches worse than none.
 */

import { useEffect, useRef, useState } from 'react'
import { readVizColors, withAlpha, type VizColors } from '@/components/viz/theme'
import { allQubitPhaseInfo } from '@/lib/quantum-phase'
import { type StateVector } from '@/lib/quantum'

/** Disks are unreadable past this many qubits; the strip renders nothing. */
const MAX_DISKS = 8

const SIZE = 48
const CX = SIZE / 2
const R = SIZE / 2 - 4

const fmtPhase = (phase: number) => `${(phase / Math.PI).toFixed(2)}π`

export default function PhaseDiskStrip({ state }: { state: StateVector }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [colors, setColors] = useState<VizColors | null>(null)

  // ADR-0007: resolve tokens off a mounted element, and re-resolve when the
  // theme class on <html> flips — SVG attributes set from JS do not follow CSS.
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    setColors(readVizColors(el))
    const observer = new MutationObserver(() => setColors(readVizColors(el)))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  if (state.numQubits > MAX_DISKS) return null

  const infos = allQubitPhaseInfo(state)
  // Before the first client effect (SSR pass) fall back to the dark-theme
  // values the shared module ships — same degradation path as the labs.
  const violet = colors?.violet ?? '#a99dff'
  const ink = colors?.inkSecondary ?? '#8fa3c8'
  const line = colors?.lineStrong ?? 'rgba(255, 255, 255, 0.13)'

  return (
    <div ref={rootRef}>
      <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-ink-muted">
        Phase disks
      </h3>
      <div className="flex flex-wrap gap-3">
        {infos.map(({ p1, phase, purity }, q) => {
          const fillR = R * Math.sqrt(Math.max(0, Math.min(1, p1)))
          // SVG's y axis points down; negate the sine so positive phase
          // turns the needle counter-clockwise, as on an Argand diagram.
          const nx = CX + R * Math.cos(phase)
          const ny = CX - R * Math.sin(phase)
          const label =
            `Qubit ${q}: probability of 1 ${(p1 * 100).toFixed(1)}%, ` +
            `phase ${fmtPhase(phase)}, purity ${purity.toFixed(2)}`
          return (
            <figure key={q} className="flex flex-col items-center gap-1">
              <svg
                width={SIZE}
                height={SIZE}
                viewBox={`0 0 ${SIZE} ${SIZE}`}
                role="img"
                aria-label={label}
              >
                <title>{label}</title>
                {/* faint full-disc ground so an empty (p1 = 0) disk still reads as a disk */}
                <circle cx={CX} cy={CX} r={R} fill={withAlpha(violet, 0.08)} stroke="none" />
                {/* fill: area ∝ P(1) */}
                <circle cx={CX} cy={CX} r={fillR} fill={withAlpha(violet, 0.55)} stroke="none" />
                {/* needle: phase angle */}
                <line
                  x1={CX}
                  y1={CX}
                  x2={nx}
                  y2={ny}
                  stroke={ink}
                  strokeWidth={1.5}
                  strokeLinecap="round"
                />
                <circle cx={CX} cy={CX} r={1.5} fill={ink} />
                {/* ring: opacity ∝ purity */}
                <circle
                  cx={CX}
                  cy={CX}
                  r={R}
                  fill="none"
                  stroke={violet}
                  strokeWidth={2}
                  opacity={Math.max(0, Math.min(1, purity))}
                />
                {/* hairline so a fully-mixed (invisible-ring) disk keeps its edge */}
                <circle cx={CX} cy={CX} r={R} fill="none" stroke={line} strokeWidth={1} />
              </svg>
              <figcaption className="font-mono text-[10px] text-ink-muted" aria-hidden="true">
                q{q}
              </figcaption>
            </figure>
          )
        })}
      </div>
      <p className="mt-2 text-[11px] text-ink-muted">
        Each disk is one qubit: the filled area is its chance of reading 1, the needle points at
        the phase of its |1⟩ component, and the ring fades as entanglement mixes the qubit.
      </p>
    </div>
  )
}
