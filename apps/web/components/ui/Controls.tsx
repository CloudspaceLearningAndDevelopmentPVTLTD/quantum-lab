'use client'

import { useId, type ReactNode } from 'react'
import { noteVizInteraction } from '@/lib/analytics/emitters'

/**
 * These controls are the shared seam every visualization page's physics runs
 * through, so 'viz.interacted' — read by /coach, /insights and journey.ts,
 * previously never emitted — is noted here once instead of in ten pages. The
 * emitter itself decides whether the note counts: it debounces past a drag,
 * fires at most once per page visit, and ignores non-/visualizations pages
 * (the simulator reuses these same components). Event handlers only run in a
 * browser, so reading `window.location` here is SSR-safe.
 */
function noteInteraction(): void {
  noteVizInteraction(typeof window === 'undefined' ? null : window.location.pathname)
}

/** Labelled range slider with a live value readout. */
export function Slider({
  label,
  value,
  min,
  max,
  step = 0.01,
  onChange,
  format,
  hint,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  onChange: (v: number) => void
  format?: (v: number) => string
  hint?: string
}) {
  const display = format ? format(value) : value.toFixed(2)
  const hintId = useId()
  return (
    <label className="block">
      <span className="mb-1.5 flex items-baseline justify-between">
        <span className="text-[13px] font-semibold text-ink-secondary">{label}</span>
        <span className="font-mono text-xs text-q-violet-text">{display}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => {
          noteInteraction()
          onChange(parseFloat(e.target.value))
        }}
        // A11Y: the hint sits inside the <label>, so it was concatenated into
        // the slider's accessible NAME ("Noise 0.0% Simulates decoherence on
        // real hardware") and re-read on every arrow press. Point at it as a
        // description instead, and give the raw number a spoken form — the
        // formatted readout is the only thing sighted users see.
        aria-describedby={hint ? hintId : undefined}
        aria-valuetext={display}
        // RESPONSIVE: `.slider` (app/globals.css) gives this a 44px hit box
        // while the painted track stays 6px. The old `h-1.5` made the whole
        // control 6px tall, which is not grabbable with a finger — this is the
        // control behind the physics on every visualization page.
        className="slider focus-ring"
      />
      {hint ? (
        <span id={hintId} className="mt-1 block text-[11px] text-ink-muted">
          {hint}
        </span>
      ) : null}
    </label>
  )
}

/** Segmented control for picking one option from a small set. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label?: string
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  const labelId = useId()
  return (
    <div>
      {label ? (
        // A11Y: this span looked like a label but was associated with nothing,
        // so role="group" below had no accessible name — "Shots" was invisible
        // to a screen reader and the buttons read as bare "256 / 1024 / 4096".
        <span id={labelId} className="mb-1.5 block text-[13px] font-semibold text-ink-secondary">
          {label}
        </span>
      ) : null}
      <div
        role="group"
        aria-labelledby={label ? labelId : undefined}
        // RESPONSIVE: `flex-wrap` + a min basis. The Bloch sphere's preset row
        // has six options; at 390px the card leaves 294px, so six equal
        // segments were 45px wide and their labels (|+i⟩, |−i⟩) collapsed.
        // They now wrap onto two rows at full size instead.
        className="flex flex-wrap gap-1 rounded-lg border border-line bg-surface-2 p-1"
      >
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            aria-pressed={value === opt.value}
            onClick={() => {
              noteInteraction()
              onChange(opt.value)
            }}
            // min-h-[38px] + the wrapper's p-1 = a 44px row on touch.
            className={`focus-ring min-h-[38px] min-w-[4.5rem] flex-1 rounded-md px-2 py-1.5 text-xs font-semibold transition-colors ${
              value === opt.value
                ? 'text-white'
                : 'text-ink-muted hover:bg-surface-3 hover:text-ink-secondary'
            }`}
            style={value === opt.value ? { backgroundColor: 'var(--q-violet-strong)' } : undefined}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  )
}

/** Checkbox with a label and optional hint. */
export function Toggle({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
  hint?: string
}) {
  return (
    // RESPONSIVE: clicking a <label> activates its control, so the whole row is
    // the target — min-h-[44px] makes that row a legal tap target even when the
    // label is one short word. The box itself goes 16px → 20px, the smallest
    // size that is comfortably hittable when someone aims at the box rather
    // than the text.
    <label className="flex min-h-[44px] cursor-pointer items-start gap-2.5 py-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => {
          noteInteraction()
          onChange(e.target.checked)
        }}
        className="focus-ring mt-0.5 h-5 w-5 shrink-0 cursor-pointer rounded border-line bg-surface-3 accent-q-violet"
      />
      <span>
        <span className="text-[13px] font-semibold text-ink-secondary">{label}</span>
        {hint ? <span className="mt-0.5 block text-[11px] text-ink-muted">{hint}</span> : null}
      </span>
    </label>
  )
}

/** A row of action buttons. */
export function ButtonRow({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-2">{children}</div>
}

/** Small read-only stat, used for live values beside a canvas. */
export function Stat({
  label,
  value,
  accent = 'violet',
}: {
  label: string
  value: string
  accent?: 'violet' | 'teal' | 'amber' | 'rose' | 'sky'
}) {
  const colors: Record<string, string> = {
    violet: 'text-q-violet-text',
    teal: 'text-q-teal-text',
    amber: 'text-q-amber-text',
    rose: 'text-q-rose-text',
    sky: 'text-q-sky-text',
  }
  return (
    <div className="rounded-lg border border-line bg-surface-2 px-3 py-2">
      <div className="text-[10px] font-bold uppercase tracking-wider text-ink-muted">{label}</div>
      <div className={`font-mono text-sm font-bold ${colors[accent]}`}>{value}</div>
    </div>
  )
}
