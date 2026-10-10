'use client'

import Link from 'next/link'
import { useState } from 'react'

/**
 * /workbench/device-advisor — "which machine, and what will it cost?"
 *
 * Paste a circuit, get every device we reach ranked for it. The model lives in
 * services/api/app/quantum/recommend.py and is reached through
 * app/api/hardware/recommend/route.ts. This page adds no arithmetic of its own:
 * it renders the ranking and, just as prominently, the response's own
 * disclaimer, its `ignores` list and each row's calibration provenance. A
 * projected success probability shown without those is a projection presented
 * as a measurement, which is the one thing this platform does not do.
 */

const DEFAULT_QASM = `OPENQASM 3.0;
include "stdgates.inc";
qubit[3] q;
bit[3] c;
h q[0];
cx q[0], q[1];
cx q[1], q[2];
c = measure q;
`

type Objective = 'min_cost_per_successful_shot' | 'max_success_probability'

type Row = {
  backend: string
  vendor: string
  device_qubits: number | null
  rank: number | null
  unrankable_reason: string | null
  projection?: {
    estimated_success_probability: number | null
    gate_survival?: number | null
    coherence_survival?: number | null
  } | null
  inputs?: {
    transpiled_depth?: number
    one_qubit_gates?: number
    two_qubit_gates?: number
    transpile_notes?: string | null
    median_2q_error?: number | null
  } | null
  cost?: {
    estimated_total?: number | null
    is_free?: boolean
    priced?: boolean
    note?: string
    cost_per_successful_shot?: number | null
  } | null
  queue_depth?: number | null
  calibration_source?: string
  calibration_note?: string
}

type Recommendation = {
  objective: Objective
  objective_description: string
  disclaimer: string
  model: { name: string; formula: string; ignores: string[] }
  ranked: Row[]
  unrankable: Row[]
}

const SOURCE_STYLE: Record<string, string> = {
  live: 'border-q-teal/50 bg-q-teal/15 text-q-teal-text',
  static: 'border-q-amber/50 bg-q-amber/15 text-q-amber-text',
  unavailable: 'border-q-rose/50 bg-q-rose/15 text-q-rose-text',
}

function pct(p: number | null | undefined): string {
  return typeof p === 'number' ? `${(p * 100).toFixed(1)}%` : '—'
}

function usd(v: number | null | undefined, free?: boolean): string {
  if (free) return 'free'
  if (typeof v !== 'number') return '—'
  if (v === 0) return '$0.00'
  return v < 0.01 ? `$${v.toExponential(2)}` : `$${v.toFixed(2)}`
}

export default function DeviceAdvisorPage() {
  const [qasm, setQasm] = useState(DEFAULT_QASM)
  const [shots, setShots] = useState(1024)
  const [objective, setObjective] = useState<Objective>('min_cost_per_successful_shot')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<Recommendation | null>(null)

  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/hardware/recommend', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ qasm, shots, objective }),
      })
      const body = (await res.json().catch(() => null)) as (Recommendation & { detail?: unknown }) | null
      if (!res.ok || !body) {
        const detail = body && typeof body.detail === 'string' ? body.detail : `The ranking service answered ${res.status}.`
        setError(detail)
        setResult(null)
      } else {
        setResult(body)
      }
    } catch {
      setError('Could not reach the ranking service. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
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
        <span className="pill border border-q-amber/30 bg-q-amber/15 text-q-amber-text">measure</span>
        <h1 className="mt-3 text-3xl font-extrabold tracking-tight md:text-4xl">Device Advisor</h1>
        <p className="mt-2 text-[15px] text-ink-secondary">
          Every vendor console can tell you how its own machine is calibrated. None can tell you whether your
          circuit would come back cleaner, or cheaper per usable shot, on somebody else&rsquo;s. Paste a circuit
          and every device qubit16 reaches — IBM, IonQ, Rigetti, Quantinuum — is transpiled to its native gates,
          projected against its calibration, and priced. Nothing is submitted and nothing is spent.
        </p>
      </header>

      <div className="card p-5">
        <label htmlFor="advisor-qasm" className="mb-1.5 block text-[13px] font-semibold text-ink-secondary">
          Circuit (OpenQASM 2 or 3)
        </label>
        <textarea
          id="advisor-qasm"
          value={qasm}
          onChange={(e) => setQasm(e.target.value)}
          rows={10}
          spellCheck={false}
          className="w-full rounded-lg border border-line bg-surface-2 p-3 font-mono text-[13px] text-ink"
        />

        <div className="mt-4 flex flex-wrap items-end gap-4">
          <label className="text-[13px] font-semibold text-ink-secondary">
            Shots
            <input
              type="number"
              min={1}
              max={20000}
              value={shots}
              onChange={(e) => setShots(Math.max(1, Math.min(20000, Math.round(Number(e.target.value) || 1))))}
              className="mt-1 block w-28 rounded-lg border border-line bg-surface-2 px-3 py-2 font-mono text-sm text-ink"
            />
          </label>
          <label className="text-[13px] font-semibold text-ink-secondary">
            Rank by
            <select
              value={objective}
              onChange={(e) => setObjective(e.target.value as Objective)}
              className="mt-1 block w-full max-w-full rounded-lg sm:w-auto border border-line bg-surface-2 px-3 py-2 text-sm text-ink"
            >
              <option value="min_cost_per_successful_shot">Lowest cost per surviving shot</option>
              <option value="max_success_probability">Highest projected success, ignore price</option>
            </select>
          </label>
          <button type="button" onClick={run} disabled={busy} className="btn btn-primary">
            {busy ? 'Ranking…' : 'Rank devices'}
          </button>
        </div>

        {error ? (
          <p className="mt-4 text-sm text-q-rose-text" role="alert">
            {error}
          </p>
        ) : null}
      </div>

      {result ? (
        <section className="mt-6 space-y-5" aria-live="polite">
          <p className="rounded-lg border border-q-amber/40 bg-q-amber/10 p-3 text-sm text-ink-secondary">
            <strong className="text-ink">Projection, not measurement.</strong> {result.disclaimer}
          </p>

          <div className="card overflow-x-auto p-0">
            <table className="w-full min-w-[760px] text-left text-sm">
              <caption className="sr-only">Devices ranked for this circuit</caption>
              <thead className="border-b border-line text-[12px] uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="px-4 py-3">#</th>
                  <th className="px-4 py-3">Device</th>
                  <th className="px-4 py-3">Projected success</th>
                  <th className="px-4 py-3">2q gates / depth</th>
                  <th className="px-4 py-3">Est. cost</th>
                  <th className="px-4 py-3">$ / surviving shot</th>
                  <th className="px-4 py-3">Calibration</th>
                </tr>
              </thead>
              <tbody>
                {result.ranked.map((row) => (
                  <tr key={row.backend} className="border-b border-line/60 align-top last:border-0">
                    <td className="px-4 py-3 font-mono text-ink-muted">{row.rank}</td>
                    <td className="px-4 py-3">
                      <div className="font-mono text-ink">{row.backend}</div>
                      <div className="text-xs text-ink-muted">
                        {row.vendor}
                        {row.device_qubits ? ` · ${row.device_qubits} qubits` : ''}
                        {typeof row.queue_depth === 'number' ? ` · queue ${row.queue_depth}` : ''}
                      </div>
                      {row.inputs?.transpile_notes ? (
                        <div className="mt-1 max-w-xs text-xs text-ink-muted">{row.inputs.transpile_notes}</div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 font-mono text-ink">
                      ≈ {pct(row.projection?.estimated_success_probability)}
                    </td>
                    <td className="px-4 py-3 font-mono text-ink-secondary">
                      {row.inputs?.two_qubit_gates ?? '—'} / {row.inputs?.transpiled_depth ?? '—'}
                    </td>
                    <td className="px-4 py-3 font-mono text-ink-secondary" title={row.cost?.note}>
                      {usd(row.cost?.estimated_total, row.cost?.is_free)}
                    </td>
                    <td className="px-4 py-3 font-mono text-ink-secondary">
                      {row.cost?.is_free ? 'free' : usd(row.cost?.cost_per_successful_shot)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`pill border text-xs ${SOURCE_STYLE[row.calibration_source ?? 'unavailable'] ?? SOURCE_STYLE.unavailable}`}
                        title={row.calibration_note}
                      >
                        {row.calibration_source ?? 'unknown'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-ink-muted">
            <span className="font-semibold">live</span> = read from the vendor at listing time ·{' '}
            <span className="font-semibold">static</span> = the vendor&rsquo;s published typical values, never a
            measurement of the machine you would run on. {result.objective_description}
          </p>

          {result.unrankable.length > 0 ? (
            <div className="card p-5">
              <h2 className="text-base font-bold">Not ranked, and why</h2>
              <p className="mt-1 text-sm text-ink-secondary">
                Refusing to rank is an answer. These devices are left out rather than given an invented score.
              </p>
              <ul className="mt-3 space-y-2 text-sm">
                {result.unrankable.map((row) => (
                  <li key={row.backend}>
                    <span className="font-mono text-ink">{row.backend}</span>{' '}
                    <span className="text-ink-secondary">— {row.unrankable_reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <details className="card p-5">
            <summary className="cursor-pointer text-base font-bold">What the model ignores</summary>
            <p className="mt-3 font-mono text-sm text-ink">{result.model.formula}</p>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-ink-secondary">
              {result.model.ignores.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </details>

          <p className="text-sm text-ink-secondary">
            Ready to spend? Take the circuit to{' '}
            <Link href="/hardware" className="text-q-sky-text underline underline-offset-2">
              Run on hardware
            </Link>{' '}
            for an exact per-device quote and a transpile preview before you submit. The same ranking is served to
            scripts at <code className="font-mono">POST /api/hardware/recommend</code>.
          </p>
        </section>
      ) : null}
    </div>
  )
}
