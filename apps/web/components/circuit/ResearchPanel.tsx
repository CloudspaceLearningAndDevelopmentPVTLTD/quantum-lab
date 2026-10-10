'use client'

/**
 * Research tools on the simulator: exact Pauli expectation values and the
 * exact final statevector as a file.
 *
 * Both answer "what number did the simulator actually compute?" without
 * sampling noise and without re-running anything elsewhere. The maths lives in
 * lib/quantum/pauli.ts (unit-tested, and cross-checked against Qiskit's
 * SparsePauliOp to ~1e-16 up to 16 qubits); this file is only input and output.
 */

import { useMemo, useState } from 'react'
import { ButtonRow } from '@/components/ui/Controls'
import { downloadBlob } from '@/components/circuit/ExportPanel'
import { hasClassicalControl, type Circuit, type StateVector } from '@/lib/quantum'
import {
  formatTerm,
  parsePauliSum,
  pauliSumExpectation,
  statevectorCsv,
  statevectorJson,
} from '@/lib/quantum/pauli'

export interface ResearchPanelProps {
  circuit: Circuit
  /** The full-circuit state (the last frame), not a stepped one. */
  state: StateVector
  qasm: string
  className?: string
}

const BRANCH_NOTE =
  'This circuit measures mid-circuit or uses classical control, so the state is ONE sampled measurement branch, not an average.'

export default function ResearchPanel({ circuit, state, qasm, className = '' }: ResearchPanelProps) {
  const [text, setText] = useState('Z0')
  const dynamic = useMemo(() => hasClassicalControl(circuit), [circuit])

  const result = useMemo(() => {
    const parsed = parsePauliSum(text, state.numQubits)
    if (!parsed.ok) return { error: parsed.error } as const
    const { value, perTerm } = pauliSumExpectation(state, parsed.terms)
    return { value, rows: parsed.terms.map((t, k) => ({ term: formatTerm(t), value: perTerm[k] })) } as const
  }, [text, state])

  return (
    <section className={`card p-5 ${className}`} aria-labelledby="research-tools-heading">
      <h2 id="research-tools-heading" className="mb-1 text-[11px] font-bold uppercase tracking-wider text-ink-muted">
        Research tools — exact, no sampling
      </h2>
      {dynamic ? <p className="mb-3 text-[12px] text-q-amber-text">{BRANCH_NOTE}</p> : null}

      <label htmlFor="pauli-input" className="mt-2 block text-sm font-semibold text-ink">
        Expectation value ⟨ψ|H|ψ⟩
      </label>
      <p className="mt-1 text-[12px] text-ink-muted">
        Pauli sum, e.g. <code>Z0 Z1</code>, <code>0.5*X0X1 − 0.3*Y2</code>, or a full label like{' '}
        <code>{'Z'.padEnd(Math.min(state.numQubits, 4), 'I')}</code> (rightmost letter = qubit 0, Qiskit order).
      </p>
      <input
        id="pauli-input"
        className="focus-ring mt-2 w-full rounded-lg border border-line bg-surface px-3 py-2 font-mono text-[16px] sm:text-sm"
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        aria-describedby="pauli-result"
      />
      <div id="pauli-result" aria-live="polite" className="mt-2 text-sm">
        {'error' in result ? (
          <p className="text-q-rose-text">{result.error}</p>
        ) : (
          <>
            <p className="font-mono text-ink">
              ⟨H⟩ = <strong>{fmt(result.value)}</strong>
            </p>
            {result.rows.length > 1 ? (
              <ul className="mt-1 max-h-40 overflow-y-auto font-mono text-[12px] text-ink-secondary">
                {result.rows.map((r, k) => (
                  <li key={k}>
                    ⟨{r.term.split('·')[1]}⟩ = {fmt(r.value)}{' '}
                    <span className="text-ink-muted">(×{r.term.split('·')[0]})</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        )}
      </div>

      <p className="mt-5 text-sm font-semibold text-ink">Final statevector</p>
      <p className="mt-1 text-[12px] text-ink-muted">
        All {state.dim.toLocaleString('en-US')} amplitudes at full double precision, with the bit-order convention
        written into the file. Loads directly into NumPy, pandas or Qiskit&rsquo;s <code>Statevector</code>.
      </p>
      <div className="mt-2">
      <ButtonRow>
        <button
          type="button"
          className="btn-ghost focus-ring"
          onClick={() => downloadBlob(statevectorCsv(state), `statevector-${state.numQubits}q.csv`, 'text/csv')}
        >
          Download CSV
        </button>
        <button
          type="button"
          className="btn-ghost focus-ring"
          onClick={() =>
            downloadBlob(
              statevectorJson(state, qasm, dynamic ? BRANCH_NOTE : undefined),
              `statevector-${state.numQubits}q.json`,
              'application/json',
            )
          }
        >
          Download JSON
        </button>
      </ButtonRow>
      </div>
    </section>
  )
}

/** Fixed precision for display; the downloads keep every digit. */
function fmt(x: number): string {
  const v = Math.abs(x) < 5e-13 ? 0 : x
  return v.toFixed(10).replace(/0+$/, '').replace(/\.$/, '.0')
}
