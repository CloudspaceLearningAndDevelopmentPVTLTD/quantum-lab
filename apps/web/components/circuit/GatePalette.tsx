'use client'

import { useMemo } from 'react'
import { BLOCK_GATES, GATE_LIBRARY, GATE_BY_NAME, type GateName, type GateSpec } from '@/lib/quantum'

/**
 * Base hue + light text variant for each categorical colour slot, resolved
 * through CSS custom properties (see docs/THEMING.md) rather than hardcoded
 * hex, so these tiles re-theme for free — inline `style` accepts `var(...)`
 * directly and the browser re-resolves it whenever `<html>`'s class changes.
 */
const HUES: Record<GateSpec['color'], { base: string; light: string }> = {
  violet: { base: 'var(--q-violet)', light: 'var(--q-violet-text)' },
  teal: { base: 'var(--q-teal)', light: 'var(--q-teal-text)' },
  amber: { base: 'var(--q-amber)', light: 'var(--q-amber-text)' },
  rose: { base: 'var(--q-rose)', light: 'var(--q-rose-text)' },
  sky: { base: 'var(--q-sky)', light: 'var(--q-sky-text)' },
  muted: { base: 'var(--ink-muted)', light: 'var(--ink-secondary)' },
}

/**
 * Fade any CSS custom property toward transparent. `color-mix()` works on any
 * `var()` without needing a decomposed channel triple, so it covers tokens
 * like `--ink-muted` that aren't in `CHANNEL_TOKENS`.
 */
function rgba(cssVar: string, alpha: number): string {
  return `color-mix(in srgb, ${cssVar} ${Math.round(alpha * 100)}%, transparent)`
}

interface Group {
  title: string
  gates: GateSpec[]
}

/**
 * Drag-and-drop MIME type for a palette tile dropped onto the circuit grid —
 * must match CircuitGrid.tsx's DRAG_GATE_MIME exactly, since that is the
 * only thing linking the two: this component has no import of, or callback
 * into, CircuitGrid.
 */
const DRAG_GATE_MIME = 'application/x-qubit16-gate'

export default function GatePalette({
  selected,
  onSelect,
  disabled = false,
  extended = false,
}: {
  selected: GateName | null
  onSelect: (g: GateName) => void
  disabled?: boolean
  /**
   * Show the wave-2 set (√X, Fredkin, multi-controlled X, custom matrix,
   * barrier, and the register blocks). Off by default so the onboarding tour
   * and the challenge workbench — whose par counts were verified against the
   * original palette — keep the palette they were written for. The simulator
   * page turns it on.
   */
  extended?: boolean
}) {
  const groups = useMemo<Group[]>(() => {
    const base = GATE_LIBRARY.filter((g) => !g.extended)
    const single = base.filter((g) => g.arity === 1 && g.name !== 'MEASURE')
    const two = base.filter((g) => g.arity === 2)
    const three = base.filter((g) => g.arity === 3)
    const other = base.filter((g) => g.name === 'MEASURE')
    const more = extended
      ? GATE_LIBRARY.filter((g) => g.extended && !BLOCK_GATES.has(g.name))
      : []
    const blocks = extended ? GATE_LIBRARY.filter((g) => g.extended && BLOCK_GATES.has(g.name)) : []
    return [
      { title: 'Single qubit', gates: single },
      { title: 'Two qubit', gates: two },
      { title: 'Three qubit', gates: three },
      { title: 'Other', gates: other },
      { title: 'More gates', gates: more },
      { title: 'Register blocks', gates: blocks },
    ].filter((g) => g.gates.length > 0)
  }, [extended])

  const selectedSpec = selected ? GATE_BY_NAME[selected] : undefined

  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <div key={group.title}>
          {/* A11Y: the group heading was a bare <span>, so the grid of gate
              buttons had no accessible name — a screen reader read twelve
              unrelated toggle buttons. Now the span names the group. */}
          <span
            id={`gate-group-${group.title.replace(/\s+/g, '-').toLowerCase()}`}
            className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-ink-muted"
          >
            {group.title}
          </span>
          <div
            role="group"
            aria-labelledby={`gate-group-${group.title.replace(/\s+/g, '-').toLowerCase()}`}
            className="grid grid-cols-4 gap-1.5"
          >
            {group.gates.map((spec) => {
              const hue = HUES[spec.color]
              const isOn = selected === spec.name
              const isMuted = spec.color === 'muted'
              return (
                <button
                  key={spec.name}
                  type="button"
                  disabled={disabled}
                  title={spec.description}
                  aria-pressed={isOn}
                  aria-label={spec.name === 'BARRIER' ? 'Barrier' : `${spec.label} gate`}
                  onClick={() => onSelect(spec.name)}
                  // Drag-and-drop (an ADDITION alongside the click-to-select
                  // flow above, never a replacement): dropping this tile
                  // straight onto a grid cell in CircuitGrid.tsx is an
                  // alternative to clicking it here and then clicking a
                  // wire. Selecting it here too keeps every other part of
                  // the placement UI (drafts, angle, classical binding) in
                  // sync with whatever gate is being dragged.
                  draggable={!disabled}
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = 'copy'
                    e.dataTransfer.setData(DRAG_GATE_MIME, spec.name)
                    onSelect(spec.name)
                  }}
                  className={`focus-ring flex h-11 items-center justify-center rounded-lg border font-bold transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-30 ${
                    spec.label.length > 3 ? 'text-[11px]' : 'text-[13px]'
                  } ${isOn ? '' : 'hover:brightness-125'}`}
                  style={{
                    /* A11Y (WCAG 1.4.3): the unselected tile used to be
                       `opacity-70`, which faded the LABEL along with the tile.
                       Measured by axe-core on /simulator: --q-rose-text
                       (#f5a193) at 70% over the tinted tile resolved to
                       #ac6579 on #241829 — 3.95:1, under the 4.5:1 that bold
                       13px still requires (it is not WCAG "large text", which
                       starts at 14pt bold). The rose, amber and sky tiles all
                       failed; only violet and teal happened to clear it.

                       These are enabled, clickable buttons whose text is the
                       gate's name, so the 1.4.3 exemption for inactive
                       components does not apply. Selection is therefore
                       expressed through the TILE (a deeper fill plus the inset
                       outline below) instead of by draining its label, which
                       leaves the text at full strength — 7.1:1 for the rose
                       tile — and actually reads as more clearly selected than
                       a 30% opacity difference did. */
                    background: isMuted ? 'var(--surface-3)' : rgba(hue.base, isOn ? 0.24 : 0.12),
                    borderColor: isMuted ? 'var(--line-strong)' : rgba(hue.base, 0.5),
                    color: hue.light,
                    /* A11Y (WCAG 2.4.7): SELECTION is drawn INSIDE the button and
                       FOCUS outside it, and they must not be the same shape.
                       The selected gate used to carry `ring-2 ring-offset-2`
                       while the inline `--tw-ring-color` below overrode
                       `.focus-ring`'s violet — so focusing the already-selected
                       gate changed nothing at all on screen. Measured on
                       /welcome, where H is selected on arrival: the tab stop was
                       invisible. An inset shadow for "chosen", the outer ring
                       for "focused". */
                    // An inline box-shadow would REPLACE the focus ring (Tailwind
                    // paints rings with box-shadow), so selection uses an inset
                    // outline instead — a different CSS property entirely.
                    outline: isOn ? `2px solid ${hue.base}` : undefined,
                    outlineOffset: isOn ? '-3px' : undefined,
                    // Tailwind cannot generate an arbitrary ring colour per gate hue.
                    ['--tw-ring-color' as string]: hue.base,
                  }}
                >
                  {spec.label}
                </button>
              )
            })}
          </div>
        </div>
      ))}

      {/* A11Y: selecting a gate swaps this description in silently. role="status"
          means the choice is confirmed out loud instead of only visually. */}
      <p className="min-h-[2.5rem] text-xs text-ink-secondary" role="status">
        {selectedSpec ? (
          <>
            <span className="font-mono font-bold" style={{ color: HUES[selectedSpec.color].light }}>
              {selectedSpec.label}
            </span>{' '}
            — {selectedSpec.description}
          </>
        ) : (
          'Select a gate to see what it does, then tap a wire — or Tab to a wire and press Enter — to place it.'
        )}
      </p>
    </div>
  )
}
