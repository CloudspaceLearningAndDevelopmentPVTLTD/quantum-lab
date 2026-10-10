'use client'

import Link from 'next/link'
import { useState } from 'react'
import type { Circuit } from '@/lib/quantum'
import { fromQasm } from '@/lib/quantum'
import { compareCircuits, EQUIVALENCE_MAX_QUBITS, type EquivalenceResult } from '@/lib/workbench/verify'

/**
 * /workbench/equivalence — is this circuit the same unitary as that one?
 *
 * Plain QASM in, compareCircuits() out. No editor, no MCP tool, no stored
 * record — paste two circuits, get a fidelity and a verdict. The same
 * circuitUnitary()/processFidelity() the spec-based verifier in
 * lib/workbench/verify.ts uses, just pointed at a second circuit instead of
 * a UnitaryTarget spec.
 */

const DEFAULT_A = 'qubit[1] q;\nh q[0];\nh q[0];\n'
const DEFAULT_B = 'qubit[1] q;\n'

function parseQasm(source: string): { circuit: Circuit | null; error: string | null } {
  if (source.trim().length === 0) return { circuit: null, error: 'Paste some OpenQASM.' }
  try {
    const circuit = fromQasm(source)
    if (circuit.ops.length === 0 && !/qubit/.test(source)) {
      return { circuit: null, error: 'That does not look like OpenQASM. Check the syntax and try again.' }
    }
    return { circuit, error: null }
  } catch {
    return { circuit: null, error: 'That does not look like OpenQASM. Check the syntax and try again.' }
  }
}

function CircuitInput({
  label,
  value,
  onChange,
  error,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  error: string | null
}) {
  return (
    <div>
      <label className="mb-1.5 block text-[13px] font-semibold text-ink-secondary" htmlFor={`qasm-${label}`}>
        {label}
      </label>
      <textarea
        id={`qasm-${label}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={10}
        spellCheck={false}
        aria-label={`OpenQASM source for circuit ${label}`}
        className="w-full rounded-lg border border-line bg-surface-2 p-3 font-mono text-[13px] text-ink"
      />
      {error ? (
        <p className="mt-2 text-xs text-q-rose-text" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}

export default function EquivalencePage() {
  const [qasmA, setQasmA] = useState(DEFAULT_A)
  const [qasmB, setQasmB] = useState(DEFAULT_B)
  const [errorA, setErrorA] = useState<string | null>(null)
  const [errorB, setErrorB] = useState<string | null>(null)
  const [result, setResult] = useState<EquivalenceResult | null>(null)

  const handleCheck = () => {
    const a = parseQasm(qasmA)
    const b = parseQasm(qasmB)
    setErrorA(a.error)
    setErrorB(b.error)
    setResult(null)
    if (!a.circuit || !b.circuit) return
    setResult(compareCircuits(a.circuit, b.circuit))
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
      <Link
        href="/workbench"
        className="focus-ring mb-6 inline-flex items-center gap-1.5 rounded text-sm text-ink-muted transition-colors hover:text-ink-secondary"
      >
        <span aria-hidden>←</span> Workbench
      </Link>

      <header className="mb-8 max-w-3xl">
        <span className="pill border border-q-sky/30 bg-q-sky/15 text-q-sky-text">measure</span>
        <h1 className="mt-3 text-3xl font-extrabold tracking-tight md:text-4xl">Circuit Equivalence Checker</h1>
        <p className="mt-2 text-[15px] text-ink-secondary">
          Paste two circuits as OpenQASM 3. Each is turned into its unitary matrix (one simulation per basis
          state) and compared with the phase-invariant process fidelity |Tr(V†U)|²/d² — the same measure the
          spec-based verifier uses for a <code className="font-mono">unitary</code> target, here applied
          circuit-to-circuit. Global phase is ignored: two circuits that differ only by an overall e^{'{'}iφ{'}'}{' '}
          are equivalent. Both circuits must have the same qubit count and be at most{' '}
          {EQUIVALENCE_MAX_QUBITS} qubits wide — this is a dense 2^n × 2^n computation, not a symbolic prover.
        </p>
      </header>

      <div className="card p-5">
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <CircuitInput label="A" value={qasmA} onChange={setQasmA} error={errorA} />
          <CircuitInput label="B" value={qasmB} onChange={setQasmB} error={errorB} />
        </div>

        <div className="mt-5 flex items-center gap-3">
          <button type="button" onClick={handleCheck} className="btn btn-primary">
            Check equivalence
          </button>
        </div>

        {result ? (
          <div className="mt-6 border-t border-line pt-5">
            <div className="flex flex-wrap items-center gap-3">
              <span
                className={`pill text-base font-bold ${
                  result.equivalent
                    ? 'border-q-teal/60 bg-q-teal/15 text-q-teal-text'
                    : 'border-q-rose/60 bg-q-rose/15 text-q-rose-text'
                }`}
                role="status"
              >
                {result.equivalent ? 'Equivalent ✓' : 'Not equivalent ✗'}
              </span>
              <span className="text-sm text-ink-secondary">
                fidelity <span className="font-mono text-ink">{result.fidelity.toFixed(6)}</span>
              </span>
            </div>
            {result.note ? <p className="mt-3 text-sm text-ink-secondary">{result.note}</p> : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}
