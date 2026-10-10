'use client'

import { ELEMENT_NAMES, ELEMENT_SYMBOLS, tablePosition } from '@/lib/quantum/identicalParticles'

/**
 * PeriodicTableMini — the first four rows (Z = 1 … 36) as a keyboard-operable grid of
 * buttons. Picking an element sets Z on the page; the page renders the configuration.
 *
 * Eighteen columns need about 560px, so the grid lives in its own horizontally scrolling
 * box rather than shrinking the cells below a usable tap size.
 */

type Props = {
  z: number
  onPick: (z: number) => void
}

const ROWS = 4
const COLS = 18

/** Cell fill by block: s (columns 1–2 and He), p (13–18), d (3–12). */
function blockOf(z: number): 's' | 'p' | 'd' {
  const { column } = tablePosition(z)
  if (z === 2 || column <= 2) return 's'
  if (column >= 13) return 'p'
  return 'd'
}

const BLOCK_CLASS: Record<'s' | 'p' | 'd', string> = {
  s: 'border-q-violet/40 bg-q-violet/10 text-q-violet-text',
  p: 'border-q-teal/40 bg-q-teal/10 text-q-teal-text',
  d: 'border-q-amber/40 bg-q-amber/10 text-q-amber-text',
}

export default function PeriodicTableMini({ z, onPick }: Props) {
  const cells = new Map<string, number>()
  for (let k = 1; k <= 36; k++) {
    const { row, column } = tablePosition(k)
    cells.set(`${row}:${column}`, k)
  }

  return (
    <div className="-mx-2 overflow-x-auto px-2 pb-1">
      <div
        role="group"
        aria-label="Periodic table, first four rows. Pick an element to show its electron configuration."
        className="grid min-w-[560px] gap-[3px]"
        style={{ gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: ROWS * COLS }, (_, idx) => {
          const row = Math.floor(idx / COLS) + 1
          const column = (idx % COLS) + 1
          const k = cells.get(`${row}:${column}`)
          if (!k) return <div key={idx} aria-hidden />
          const active = k === z
          return (
            <button
              key={idx}
              type="button"
              aria-pressed={active}
              aria-label={`${ELEMENT_NAMES[k - 1]}, atomic number ${k}`}
              onClick={() => onPick(k)}
              className={`focus-ring flex h-9 flex-col items-center justify-center rounded border text-[11px] font-bold leading-none transition-colors ${
                BLOCK_CLASS[blockOf(k)]
              } ${active ? 'ring-2 ring-q-rose ring-offset-1 ring-offset-surface-2' : 'hover:brightness-110'}`}
            >
              <span aria-hidden className="text-[8px] font-semibold opacity-70">
                {k}
              </span>
              <span aria-hidden>{ELEMENT_SYMBOLS[k - 1]}</span>
            </button>
          )
        })}
      </div>
      <p className="mt-2 text-[11px] text-ink-muted">
        Violet cells are s-block (two per row), amber d-block (ten), teal p-block (six). The row
        lengths 2, 8, 8, 18 are the subshell capacities 2, 2+6, 2+6, 2+10+6 — read off the Pauli
        principle, nothing else.
      </p>
    </div>
  )
}
