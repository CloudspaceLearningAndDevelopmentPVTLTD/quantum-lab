'use client'

/**
 * GateOptions — the settings a wave-2 gate needs BEFORE it can be placed.
 *
 *   MCX            how many controls.
 *   UNITARY        the matrix itself, typed in, with the unitarity check.
 *   ADDK / MULK    k, N, the register width, and whether one qubit controls it.
 *   QFT / IQFT     the register width and the control.
 *
 * These are properties of the placement gesture, the same way θ is a property
 * of the palette, so CircuitGrid owns the drafts and renders these editors in
 * the bar above the wires. Every control is a native input or select: the
 * whole editor has to work from the keyboard and read out to a screen reader,
 * and native controls do that for free.
 */

import { useId, useMemo } from 'react'
import { Segmented, Slider, Toggle } from '@/components/ui/Controls'
import { blockLabel, type Complex, type GateName, type GateOp } from '@/lib/quantum'
import { formatComplexEntry, parseComplexEntry, MATRIX_PRESETS, MAX_BLOCK_WIDTH } from '@/lib/quantum/gates-extended'
import {
  blockDraftProblem,
  minWidthFor,
  resolveMatrixDraft,
  type BlockDraft,
  type MatrixDraft,
} from '@/lib/quantum/gate-drafts'

export {
  DEFAULT_BLOCK_DRAFT,
  DEFAULT_MATRIX_DRAFT,
  blockDraftProblem,
  effectiveArity,
  minWidthFor,
  pendingHint,
  resolveMatrixDraft,
  type BlockDraft,
  type MatrixDraft,
  type MatrixResolution,
} from '@/lib/quantum/gate-drafts'

// ────────────────────────────────────────────────────────────
// Editors
// ────────────────────────────────────────────────────────────

const inputClass =
  'focus-ring rounded border border-line bg-surface-3 px-2 py-1 font-mono text-xs text-ink'

export function McxEditor({
  controls,
  numQubits,
  onChange,
}: {
  controls: number
  numQubits: number
  onChange: (n: number) => void
}) {
  const max = Math.max(1, numQubits - 1)
  const value = Math.min(Math.max(1, controls), max)
  return (
    <div className="flex flex-wrap items-center gap-3">
      <label className="flex items-center gap-2 text-xs text-ink-secondary">
        <span className="font-semibold">Controls</span>
        <select value={value} onChange={(e) => onChange(parseInt(e.target.value, 10))} className={inputClass}>
          {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
      </label>
      <span className="text-[11px] text-ink-muted">
        Pick the {value === 1 ? 'control' : `${value} controls`} first, then the target. The target flips only when every control reads 1
        {value === 1 ? ' — that is a CX' : value === 2 ? ' — that is a Toffoli' : ''}.
      </span>
    </div>
  )
}

export function MatrixEditor({
  draft,
  onChange,
}: {
  draft: MatrixDraft
  onChange: (d: MatrixDraft) => void
}) {
  const id = useId()
  const d = draft.qubits === 1 ? 2 : 4
  const verdict = useMemo(() => resolveMatrixDraft(draft), [draft])
  const presets = MATRIX_PRESETS.filter((p) => p.qubits === draft.qubits)

  const setSize = (qubits: '1' | '2') => {
    const n = qubits === '1' ? 1 : 2
    if (n === draft.qubits) return
    const preset = MATRIX_PRESETS.find((p) => p.qubits === n)!
    onChange({ qubits: n, entries: preset.entries.slice(), label: preset.label })
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-48">
          <Segmented
            label="Size"
            value={String(draft.qubits) as '1' | '2'}
            options={[
              { value: '1', label: '2×2 · 1 qubit' },
              { value: '2', label: '4×4 · 2 qubits' },
            ]}
            onChange={setSize}
          />
        </div>
        <label className="flex items-center gap-2 text-xs text-ink-secondary">
          <span className="font-semibold">Label</span>
          <input
            type="text"
            value={draft.label}
            maxLength={8}
            onChange={(e) => onChange({ ...draft, label: e.target.value })}
            className={`${inputClass} w-24`}
            aria-describedby={`${id}-label-hint`}
          />
        </label>
        <span id={`${id}-label-hint`} className="text-[11px] text-ink-muted">What the box on the wire says.</span>
      </div>

      <div role="group" aria-label="Start from a known matrix" className="flex flex-wrap gap-1.5">
        {presets.map((p) => (
          <button
            key={p.id}
            type="button"
            className="btn-ghost focus-ring !px-2.5 !py-1 !text-xs"
            onClick={() => onChange({ ...draft, entries: p.entries.slice(), label: p.label })}
          >
            {p.label}
          </button>
        ))}
        <button
          type="button"
          className="btn-ghost focus-ring !px-2.5 !py-1 !text-xs"
          onClick={() => {
            // Conjugate transpose: swaps row/column and flips the imaginary sign.
            const parsed = draft.entries.map(parseComplexEntry)
            if (parsed.some((z) => z === null)) return
            const next = draft.entries.slice()
            for (let r = 0; r < d; r++) for (let col = 0; col < d; col++) {
              const z = parsed[col * d + r] as Complex
              next[r * d + col] = formatComplexEntry({ re: z.re, im: -z.im })
            }
            onChange({ ...draft, entries: next, label: draft.label.endsWith('†') ? draft.label.slice(0, -1) : `${draft.label}†` })
          }}
          title="Replace the matrix with its conjugate transpose — the inverse gate"
        >
          Take †
        </button>
      </div>

      {/* RESPONSIVE: sixteen inputs are wider than a phone; the grid scrolls
          inside its own box rather than pushing the page sideways. */}
      <div
        role="group"
        aria-label={`Matrix entries, ${d} by ${d}. Row and column index have the first qubit you pick as the least significant bit.`}
        className="grid max-w-full gap-1 overflow-x-auto"
        style={{ gridTemplateColumns: `repeat(${d}, 4.5rem)` }}
      >
        {draft.entries.map((entry, i) => {
          const row = Math.floor(i / d) + 1
          const col = (i % d) + 1
          const bad = parseComplexEntry(entry) === null
          return (
            <input
              key={i}
              type="text"
              value={entry}
              aria-label={`Row ${row}, column ${col}`}
              aria-invalid={bad || undefined}
              spellCheck={false}
              onChange={(e) => {
                const next = draft.entries.slice()
                next[i] = e.target.value
                onChange({ ...draft, entries: next })
              }}
              className={`${inputClass} w-[4.5rem] text-center ${bad ? '!border-q-rose' : ''}`}
            />
          )
        })}
      </div>

      <p className="text-[11px] text-ink-secondary" role="status" aria-live="polite">
        {verdict.ok ? (
          <>
            <span className="font-semibold text-q-teal-text">Unitary.</span>{' '}
            ‖U†U − I‖ = {verdict.error < 1e-15 ? '0' : verdict.error.toExponential(1)}. Place it on{' '}
            {draft.qubits === 1 ? 'a wire' : 'two wires — the first you pick is the low bit of the row and column index (Qiskit’s order)'}.
          </>
        ) : (
          <span className="text-q-rose-text">{verdict.message}</span>
        )}
      </p>
    </div>
  )
}

export function BlockEditor({
  name,
  draft,
  numQubits,
  onChange,
}: {
  name: GateName
  draft: BlockDraft
  numQubits: number
  onChange: (d: BlockDraft) => void
}) {
  const arithmetic = name === 'ADDK' || name === 'MULK'
  const problem = blockDraftProblem(name, draft, numQubits)
  const minWidth = arithmetic ? minWidthFor(draft.modulus) : 1
  const maxWidth = Math.max(minWidth, Math.min(MAX_BLOCK_WIDTH, numQubits - (draft.controlled ? 1 : 0)))
  const widths = Array.from({ length: Math.max(0, maxWidth - minWidth + 1) }, (_, i) => minWidth + i)
  const label = blockLabel({ name, k: draft.k, modulus: draft.modulus })

  const setModulus = (modulus: number) => {
    // Widen the register to fit N; never silently shrink a choice the learner made.
    const width = Math.max(draft.width, minWidthFor(modulus))
    onChange({ ...draft, modulus, width })
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        {arithmetic ? (
          <>
            <label className="flex items-center gap-2 text-xs text-ink-secondary">
              <span className="font-semibold">k</span>
              <input
                type="number"
                step={1}
                value={Number.isFinite(draft.k) ? draft.k : ''}
                onChange={(e) => onChange({ ...draft, k: e.target.value === '' ? NaN : parseInt(e.target.value, 10) })}
                className={`${inputClass} w-20`}
              />
            </label>
            <label className="flex items-center gap-2 text-xs text-ink-secondary">
              <span className="font-semibold">mod N</span>
              <input
                type="number"
                step={1}
                min={1}
                value={Number.isFinite(draft.modulus) ? draft.modulus : ''}
                onChange={(e) => setModulus(e.target.value === '' ? NaN : parseInt(e.target.value, 10))}
                className={`${inputClass} w-20`}
              />
            </label>
          </>
        ) : null}
        <label className="flex items-center gap-2 text-xs text-ink-secondary">
          <span className="font-semibold">Register</span>
          <select
            value={draft.width}
            onChange={(e) => onChange({ ...draft, width: parseInt(e.target.value, 10) })}
            className={inputClass}
            aria-label="Register width in qubits"
          >
            {(widths.length ? widths : [draft.width]).map((w) => (
              <option key={w} value={w}>{w} qubit{w === 1 ? '' : 's'}</option>
            ))}
          </select>
        </label>
        <Toggle
          label="Controlled by one qubit"
          checked={draft.controlled}
          onChange={(controlled) => onChange({ ...draft, controlled })}
        />
      </div>
      <p className="text-[11px] text-ink-secondary" role="status" aria-live="polite">
        {problem ? (
          <span className="text-q-rose-text">{problem}</span>
        ) : (
          <>
            <span className="font-mono font-semibold text-ink">{label}</span> on {draft.width} qubit{draft.width === 1 ? '' : 's'}.{' '}
            {draft.controlled ? 'Pick the control first, then ' : 'Pick '}the register wires from the least significant bit upward.{' '}
            {arithmetic
              ? `Values ${draft.modulus} … ${(1 << draft.width) - 1} pass through unchanged, which is what keeps the block a permutation.`
              : name === 'QFT'
                ? 'A register periodic with period r comes out peaked at multiples of 2^m / r.'
                : 'Undoes the QFT — the readout step of phase estimation and of Shor.'}
          </>
        )}
      </p>
    </div>
  )
}

/** θ/φ/λ rendered in π units — the same format the page's own "Angle θ" slider uses. */
const piLabel = (v: number) => `${(v / Math.PI).toFixed(2)}π`

/**
 * U3's second and third Euler angle. θ itself is not duplicated here — it is
 * already the page-level "Angle θ" slider every hasAngle gate shares (see
 * app/simulator/page.tsx), and U3.hasAngle is true, so that slider appears
 * for U3 exactly as it does for RX/RY/RZ/P. Same range/step/format as that
 * slider, so all three angles behave identically from the keyboard.
 */
export function U3AngleEditor({
  phi,
  lambda,
  onChange,
}: {
  phi: number
  lambda: number
  onChange: (next: { phi: number; lambda: number }) => void
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Slider
        label="φ (phi)"
        value={phi}
        min={-2 * Math.PI}
        max={2 * Math.PI}
        step={Math.PI / 32}
        format={piLabel}
        onChange={(v) => onChange({ phi: v, lambda })}
        hint="U3's second Euler angle."
      />
      <Slider
        label="λ (lambda)"
        value={lambda}
        min={-2 * Math.PI}
        max={2 * Math.PI}
        step={Math.PI / 32}
        format={piLabel}
        onChange={(v) => onChange({ phi, lambda: v })}
        hint="U3's third Euler angle."
      />
    </div>
  )
}

/** Which value POSTSELECT keeps — dropping every branch where the qubit reads the other one. */
export function PostselectEditor({
  value,
  onChange,
}: {
  value: 0 | 1
  onChange: (v: 0 | 1) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="w-40">
        <Segmented
          label="Keep branches where this qubit reads"
          value={String(value) as '0' | '1'}
          options={[
            { value: '0', label: '|0⟩' },
            { value: '1', label: '|1⟩' },
          ]}
          onChange={(v) => onChange(v === '1' ? 1 : 0)}
        />
      </div>
      <span className="text-[11px] text-ink-muted">
        Every other branch is discarded and the rest renormalized — idealized, simulator-only.
      </span>
    </div>
  )
}

export type ExtraControlDraft = NonNullable<GateOp['extraControls']>[number]

/**
 * Zero or more additional control qubits for an ordinary single-qubit gate or
 * a 1-qubit UNITARY (see the doc comment on GateOp.extraControls) — each with
 * its own basis (Z/X/Y) and an anti checkbox, feeding `op.extraControls`.
 * `usedQubits` (the target, plus any other control already picked) is
 * excluded from the qubit picker so a qubit cannot play two roles.
 */
export function ExtraControlsEditor({
  controls,
  numQubits,
  usedQubits,
  onChange,
}: {
  controls: ExtraControlDraft[]
  numQubits: number
  usedQubits: readonly number[]
  onChange: (next: ExtraControlDraft[]) => void
}) {
  const used = new Set(usedQubits)
  const available = Array.from({ length: numQubits }, (_, q) => q).filter((q) => !used.has(q))
  const nextFree = available.find((q) => !controls.some((c) => c.qubit === q))

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="text-[13px] font-semibold text-ink-secondary">Extra controls</span>
        <button
          type="button"
          disabled={nextFree === undefined}
          className="btn-ghost focus-ring !px-2.5 !py-1 !text-xs disabled:cursor-not-allowed disabled:opacity-40"
          onClick={() => {
            if (nextFree === undefined) return
            onChange([...controls, { qubit: nextFree, basis: 'Z', anti: false }])
          }}
        >
          + Add control
        </button>
      </div>
      {controls.length === 0 ? (
        <p className="text-[11px] text-ink-muted">
          None. The gate applies unconditionally, exactly as it always has, unless you add one.
        </p>
      ) : (
        <div className="space-y-1.5">
          {controls.map((ctrl, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 rounded border border-line bg-surface-3 px-2 py-1.5">
              <label className="flex items-center gap-1.5 text-xs text-ink-secondary">
                <span className="font-semibold">Qubit</span>
                <select
                  value={ctrl.qubit}
                  onChange={(e) => {
                    const next = controls.slice()
                    next[i] = { ...ctrl, qubit: parseInt(e.target.value, 10) }
                    onChange(next)
                  }}
                  className={inputClass}
                >
                  {(available.includes(ctrl.qubit) ? available : [ctrl.qubit, ...available]).map((q) => (
                    <option key={q} value={q}>q{q}</option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-1.5 text-xs text-ink-secondary">
                <span className="font-semibold">Basis</span>
                <select
                  value={ctrl.basis ?? 'Z'}
                  onChange={(e) => {
                    const next = controls.slice()
                    next[i] = { ...ctrl, basis: e.target.value as 'X' | 'Y' | 'Z' }
                    onChange(next)
                  }}
                  className={inputClass}
                >
                  <option value="Z">Z — fires on |1⟩</option>
                  <option value="X">X — fires on |+⟩</option>
                  <option value="Y">Y — fires on |+i⟩</option>
                </select>
              </label>
              <Toggle
                label="Anti (fire on the opposite eigenstate)"
                checked={ctrl.anti ?? false}
                onChange={(anti) => {
                  const next = controls.slice()
                  next[i] = { ...ctrl, anti }
                  onChange(next)
                }}
              />
              <button
                type="button"
                className="btn-ghost focus-ring ml-auto !px-2 !py-1 !text-xs"
                onClick={() => onChange(controls.filter((_, j) => j !== i))}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
