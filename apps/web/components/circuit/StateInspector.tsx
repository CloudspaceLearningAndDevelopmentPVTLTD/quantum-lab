'use client'

import { useMemo, useState } from 'react'
import { formatComplex, formatKet, type StateVector } from '@/lib/quantum'
import PhaseDiskStrip from './PhaseDiskStrip'
import QSphere from './QSphere'

const MAX_ROWS = 16
const EPS = 1e-9

interface Row {
  index: number
  ket: string
  amp: string
  prob: number
}

/** Two views of the same statevector: exact table, or the Q-sphere picture. */
type StateView = 'amplitudes' | 'qsphere'

export default function StateInspector({ state }: { state: StateVector }) {
  const [view, setView] = useState<StateView>('amplitudes')
  const { rows, hiddenCount } = useMemo(() => {
    const all: Row[] = Array.from({ length: state.dim }, (_, i) => ({
      index: i,
      ket: formatKet(i, state.numQubits),
      amp: formatComplex(state.amplitude(i)),
      prob: state.probability(i),
    }))

    // Drop numerically-zero rows once the table would otherwise be long.
    const visible = state.dim > 8 ? all.filter((r) => r.prob >= EPS) : all

    if (visible.length <= MAX_ROWS) {
      return { rows: visible, hiddenCount: all.length - visible.length }
    }
    const top = [...visible].sort((a, b) => b.prob - a.prob).slice(0, MAX_ROWS)
    top.sort((a, b) => a.index - b.index)
    return { rows: top, hiddenCount: all.length - top.length }
  }, [state])

  const qubits = useMemo(
    () =>
      Array.from({ length: state.numQubits }, (_, q) => ({
        q,
        p1: state.qubitProbability(q),
        entropy: state.entanglementEntropy(q),
      })),
    [state]
  )

  return (
    <div className="space-y-5">
      {/* Renders nothing above 8 qubits — see the cutoff note in PhaseDiskStrip.
          Not wrapped in a <section> so a hidden strip leaves no stray gap. */}
      <PhaseDiskStrip state={state} />
      <section>
        <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-ink-muted">Per-qubit</h3>
        <ul className="space-y-2">
          {qubits.map(({ q, p1, entropy }) => {
            const separable = entropy < 0.01
            return (
              <li key={q} className="flex items-center gap-3">
                <span className="w-8 shrink-0 font-mono text-xs text-ink-secondary">q{q}</span>
                <span className="w-16 shrink-0 font-mono text-xs text-ink">
                  {(p1 * 100).toFixed(1)}%
                </span>
                <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-3">
                  <span
                    className="block h-full rounded-full transition-[width] duration-300"
                    style={{ width: `${Math.min(100, p1 * 100)}%`, background: 'var(--q-teal)' }}
                  />
                </span>
                <span
                  className="pill shrink-0"
                  style={{
                    color: separable ? 'var(--q-teal-text)' : 'var(--q-violet-text)',
                    background: separable ? 'rgb(var(--q-teal-rgb) / 0.12)' : 'rgb(var(--q-violet-rgb) / 0.14)',
                  }}
                  title={`Entanglement entropy ${entropy.toFixed(2)} bits`}
                >
                  {separable ? 'separable' : 'entangled'} · {entropy.toFixed(2)}
                </span>
              </li>
            )
          })}
        </ul>
        <p className="mt-2 text-[11px] text-ink-muted">
          P(1) is the chance this qubit reads 1; entropy is 0 when it stands alone and 1 when it is
          maximally entangled with the rest.
        </p>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">State</h3>
          {/* Two views of the same vector: the exact table, or the Q-sphere
              picture. A toggle rather than side-by-side — the inspector
              column is narrow and both at once would shrink each below use. */}
          <div role="tablist" aria-label="State view" className="flex gap-1">
            {(
              [
                ['amplitudes', 'Amplitudes'],
                ['qsphere', 'Q-sphere'],
              ] as const
            ).map(([id, text]) => (
              <button
                key={id}
                role="tab"
                type="button"
                aria-selected={view === id}
                onClick={() => setView(id)}
                className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold transition-colors"
                style={
                  view === id
                    ? { color: 'var(--q-violet-text)', background: 'rgb(var(--q-violet-rgb) / 0.14)' }
                    : { color: 'var(--ink-muted)' }
                }
              >
                {text}
              </button>
            ))}
          </div>
        </div>
        {view === 'qsphere' ? <QSphere state={state} /> : null}
        <div
          className="max-h-64 overflow-y-auto rounded-lg border border-line"
          hidden={view !== 'amplitudes'}
        >
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-surface-2">
              <tr className="border-b border-line text-[10px] uppercase tracking-wider text-ink-muted">
                <th className="px-3 py-2 text-left font-bold">State</th>
                <th className="px-3 py-2 text-right font-bold">Amplitude</th>
                <th className="px-3 py-2 text-right font-bold">Prob.</th>
                <th className="w-24 px-3 py-2 text-left font-bold">&nbsp;</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.index} className="border-b border-line last:border-0">
                  <td className="px-3 py-1.5 font-mono text-q-violet-text">{r.ket}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-ink-secondary">{r.amp}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-ink-secondary">
                    {(r.prob * 100).toFixed(1)}%
                  </td>
                  <td className="px-3 py-1.5">
                    <span className="block h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
                      <span
                        className="block h-full rounded-full"
                        style={{
                          width: `${Math.min(100, r.prob * 100)}%`,
                          background: 'var(--q-violet)',
                        }}
                      />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {view === 'amplitudes' && hiddenCount > 0 ? (
          <p className="mt-2 text-[11px] text-ink-muted">
            {hiddenCount} more state{hiddenCount === 1 ? '' : 's'} with smaller amplitudes not shown.
          </p>
        ) : null}
      </section>
    </div>
  )
}
