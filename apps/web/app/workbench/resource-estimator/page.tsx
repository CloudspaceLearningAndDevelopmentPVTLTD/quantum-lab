'use client'

import Link from 'next/link'
import { useState } from 'react'

/**
 * /workbench/resource-estimator — physical qubits and runtime on a
 * fault-tolerant machine, to an order of magnitude.
 *
 * The model is services/api/app/quantum/resources.py, reached through
 * app/api/circuits/resources/route.ts. Its payload carries `estimate_kind`,
 * `disclaimer`, `assumptions` and `caveats` as fields, and the module's own
 * docstring says a client rendering only the headline numbers "is presenting
 * a projection as a measurement". So the caveats render here unconditionally,
 * not behind a toggle, and the headline is shown as a power of ten first.
 *
 * The sweep calls the same endpoint once per physical error rate. It exists
 * because the single most instructive thing about this estimate is how
 * violently it moves as p approaches the threshold — a lesson one number
 * cannot teach.
 */

type Estimate = {
  estimate_kind: string
  disclaimer: string
  code_distance: number
  physical_qubits_per_logical: number
  physical_qubits: number
  runtime_seconds: number
  runtime_human: string
  bottleneck: string
  tiles: { data: number; routing: number; factories: number; total: number }
  magic_states: { modelled: boolean; states_required: number; distillation_levels: number; factories: number }
  caveats: string[]
  circuit?: { algorithm_qubits: number; t_count: number; logical_depth: number; approximations?: string[] }
}

type Hardware = { id: string; label: string; cycle: number }

/** Code-cycle presets. Order-of-magnitude figures, labelled as such in the UI. */
const HARDWARE: Hardware[] = [
  { id: 'sc', label: 'Superconducting (~1 µs cycle)', cycle: 1e-6 },
  { id: 'atom', label: 'Neutral atom (~1 ms cycle)', cycle: 1e-3 },
  { id: 'ion', label: 'Trapped ion (~10 ms cycle)', cycle: 1e-2 },
]

const ERROR_RATES = [1e-4, 3e-4, 1e-3, 2e-3, 5e-3]
const SWEEP_RATES = [1e-4, 2e-4, 5e-4, 1e-3, 2e-3, 3e-3, 5e-3, 7e-3]

function powerOfTen(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '—'
  const exp = Math.round(Math.log10(n))
  return `~10^${exp}`
}

function compact(n: number): string {
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n)
}

async function estimate(body: Record<string, unknown>): Promise<{ ok: true; value: Estimate } | { ok: false; error: string }> {
  try {
    const res = await fetch('/api/circuits/resources', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = (await res.json().catch(() => null)) as (Estimate & { detail?: unknown }) | null
    if (!res.ok || !json) {
      return { ok: false, error: json && typeof json.detail === 'string' ? json.detail : `The estimator answered ${res.status}.` }
    }
    return { ok: true, value: json }
  } catch {
    return { ok: false, error: 'Could not reach the estimator. Check your connection and try again.' }
  }
}

/** Log-log line of physical qubits against physical error rate. One series, so no legend. */
function SweepChart({ points, current }: { points: { p: number; q: number }[]; current: number }) {
  const [hover, setHover] = useState<number | null>(null)
  const W = 560
  const H = 240
  const pad = { l: 56, r: 16, t: 16, b: 40 }
  const xs = points.map((d) => Math.log10(d.p))
  const ys = points.map((d) => Math.log10(d.q))
  const x0 = Math.min(...xs)
  const x1 = Math.max(...xs)
  const y0 = Math.floor(Math.min(...ys))
  const y1 = Math.ceil(Math.max(...ys))
  const sx = (v: number) => pad.l + ((v - x0) / (x1 - x0 || 1)) * (W - pad.l - pad.r)
  const sy = (v: number) => H - pad.b - ((v - y0) / (y1 - y0 || 1)) * (H - pad.t - pad.b)
  const path = points.map((d, i) => `${i ? 'L' : 'M'}${sx(xs[i])},${sy(ys[i])}`).join(' ')
  const yTicks: number[] = []
  for (let e = y0; e <= y1; e++) yTicks.push(e)
  const h = hover === null ? null : points[hover]

  return (
    <figure className="mt-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Physical qubits needed against physical error rate, log-log">
        {yTicks.map((e) => (
          <g key={e}>
            <line x1={pad.l} x2={W - pad.r} y1={sy(e)} y2={sy(e)} stroke="var(--line)" strokeWidth={1} />
            <text x={pad.l - 8} y={sy(e) + 4} textAnchor="end" fontSize={11} fill="var(--ink-muted)">
              10^{e}
            </text>
          </g>
        ))}
        {points.map((d, i) => (
          <text key={d.p} x={sx(xs[i])} y={H - pad.b + 18} textAnchor="middle" fontSize={11} fill="var(--ink-muted)">
            {d.p.toExponential(0)}
          </text>
        ))}
        <text x={(W + pad.l) / 2} y={H - 4} textAnchor="middle" fontSize={11} fill="var(--ink-muted)">
          physical error rate p
        </text>
        <path d={path} fill="none" className="text-q-sky" stroke="currentColor" strokeWidth={2} />
        {points.map((d, i) => (
          <g key={`pt-${d.p}`}>
            <circle
              cx={sx(xs[i])}
              cy={sy(ys[i])}
              r={d.p === current ? 6 : 4}
              className={d.p === current ? 'text-q-amber' : 'text-q-sky'}
              fill="currentColor"
              stroke="var(--surface)"
              strokeWidth={2}
            />
            <circle
              cx={sx(xs[i])}
              cy={sy(ys[i])}
              r={14}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            />
          </g>
        ))}
        {h ? (
          <g pointerEvents="none">
            <rect x={Math.min(sx(Math.log10(h.p)) + 8, W - 150)} y={pad.t} width={140} height={36} rx={6} fill="var(--surface-2)" stroke="var(--line-strong)" />
            <text x={Math.min(sx(Math.log10(h.p)) + 16, W - 142)} y={pad.t + 15} fontSize={11} fill="var(--ink-secondary)">
              p = {h.p.toExponential(0)}
            </text>
            <text x={Math.min(sx(Math.log10(h.p)) + 16, W - 142)} y={pad.t + 29} fontSize={12} fill="var(--ink)">
              {compact(h.q)} physical qubits
            </text>
          </g>
        ) : null}
      </svg>
      <figcaption className="text-xs text-ink-muted">
        Same algorithm, same error budget, only p changes. The amber point is your current setting. Near the 1% threshold the
        code distance — and so the qubit count — runs away.
      </figcaption>
    </figure>
  )
}

export default function ResourceEstimatorPage() {
  const [qasm, setQasm] = useState('')
  const [qubits, setQubits] = useState(100)
  const [tCount, setTCount] = useState(1_000_000)
  const [depth, setDepth] = useState(100_000)
  const [p, setP] = useState(1e-3)
  const [target, setTarget] = useState(1e-2)
  const [hw, setHw] = useState<Hardware>(HARDWARE[0])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<Estimate | null>(null)
  const [sweep, setSweep] = useState<{ p: number; q: number }[] | null>(null)
  // Sweep rates the estimator refused, split by why: `unreachable` means no code distance meets the
  // budget (near threshold, a physics answer); `failed` means the request itself did not come back.
  const [skipped, setSkipped] = useState<{ unreachable: number[]; failed: number[] }>({ unreachable: [], failed: [] })

  const run = async () => {
    setBusy(true)
    setError(null)
    const base: Record<string, unknown> = {
      target_total_error: target,
      code_cycle_seconds: hw.cycle,
    }
    // A pasted circuit supplies the three counts; the number fields only apply without one.
    if (qasm.trim()) base.qasm = qasm
    else Object.assign(base, { algorithm_qubits: qubits, t_count: tCount, logical_depth: depth })

    const main = await estimate({ ...base, physical_error_rate: p })
    if (!main.ok) {
      setError(main.error)
      setResult(null)
      setSweep(null)
      setSkipped({ unreachable: [], failed: [] })
      setBusy(false)
      return
    }
    setResult(main.value)

    const rates = Array.from(new Set([...SWEEP_RATES, p])).sort((a, b) => a - b)
    const points: { p: number; q: number }[] = []
    const unreachable: number[] = []
    const failed: number[] = []
    for (const rate of rates) {
      const r = await estimate({ ...base, physical_error_rate: rate })
      if (r.ok) points.push({ p: rate, q: r.value.physical_qubits })
      else if (r.error.includes('code distance')) unreachable.push(rate)
      else failed.push(rate)
    }
    setSweep(points.length >= 2 ? points : null)
    setSkipped({ unreachable, failed })
    setBusy(false)
  }

  const num = (set: (n: number) => void, min: number) => (e: React.ChangeEvent<HTMLInputElement>) =>
    set(Math.max(min, Math.round(Number(e.target.value) || min)))

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
      <Link
        href="/workbench"
        className="focus-ring mb-6 inline-flex items-center gap-1.5 rounded text-sm text-ink-muted transition-colors hover:text-ink-secondary"
      >
        <span aria-hidden>←</span> Workbench
      </Link>

      <header className="mb-8 max-w-3xl">
        <span className="pill border border-q-violet/30 bg-q-violet/15 text-q-violet-text">measure</span>
        <h1 className="mt-3 text-3xl font-extrabold tracking-tight md:text-4xl">Fault-Tolerant Resource Estimator</h1>
        <p className="mt-2 text-[15px] text-ink-secondary">
          How many physical qubits, and how long, would an algorithm need under surface-code error correction? It is the
          question most algorithm papers end on, and nobody can answer it by running anything — the machine does not
          exist yet. So it is answered by a model: surface-code logical error scaling, lattice-surgery timing and 15-to-1
          magic-state distillation. Read every result as a power of ten.
        </p>
      </header>

      <div className="card p-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <label className="text-[13px] font-semibold text-ink-secondary">
            Logical qubits
            <input type="number" min={1} value={qubits} onChange={num(setQubits, 1)} disabled={!!qasm.trim()}
              className="mt-1 block w-full rounded-lg border border-line bg-surface-2 px-3 py-2 font-mono text-sm text-ink disabled:opacity-50" />
          </label>
          <label className="text-[13px] font-semibold text-ink-secondary">
            T count (non-Clifford gates)
            <input type="number" min={0} value={tCount} onChange={num(setTCount, 0)} disabled={!!qasm.trim()}
              className="mt-1 block w-full rounded-lg border border-line bg-surface-2 px-3 py-2 font-mono text-sm text-ink disabled:opacity-50" />
          </label>
          <label className="text-[13px] font-semibold text-ink-secondary">
            Logical depth
            <input type="number" min={1} value={depth} onChange={num(setDepth, 1)} disabled={!!qasm.trim()}
              className="mt-1 block w-full rounded-lg border border-line bg-surface-2 px-3 py-2 font-mono text-sm text-ink disabled:opacity-50" />
          </label>
          <label className="text-[13px] font-semibold text-ink-secondary">
            Physical error rate
            <select value={p} onChange={(e) => setP(Number(e.target.value))}
              className="mt-1 block w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink">
              {ERROR_RATES.map((r) => (
                <option key={r} value={r}>{r.toExponential(0)}</option>
              ))}
            </select>
          </label>
          <label className="text-[13px] font-semibold text-ink-secondary">
            Total failure budget
            <select value={target} onChange={(e) => setTarget(Number(e.target.value))}
              className="mt-1 block w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink">
              {[1e-1, 1e-2, 1e-3].map((r) => (
                <option key={r} value={r}>{r.toExponential(0)}</option>
              ))}
            </select>
          </label>
          <label className="text-[13px] font-semibold text-ink-secondary">
            Hardware type
            <select value={hw.id} onChange={(e) => setHw(HARDWARE.find((h) => h.id === e.target.value) ?? HARDWARE[0])}
              className="mt-1 block w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink">
              {HARDWARE.map((h) => (
                <option key={h.id} value={h.id}>{h.label}</option>
              ))}
            </select>
          </label>
        </div>

        <details className="mt-4">
          <summary className="cursor-pointer text-[13px] font-semibold text-ink-secondary">
            …or read the counts from a circuit
          </summary>
          <textarea
            value={qasm}
            onChange={(e) => setQasm(e.target.value)}
            rows={8}
            spellCheck={false}
            aria-label="OpenQASM circuit to read logical counts from"
            placeholder={'OPENQASM 3.0;\ninclude "stdgates.inc";\nqubit[3] q;\nh q[0];\nccx q[0], q[1], q[2];\nt q[2];'}
            className="mt-2 w-full rounded-lg border border-line bg-surface-2 p-3 font-mono text-[13px] text-ink"
          />
          <p className="mt-1 text-xs text-ink-muted">
            When a circuit is pasted, its qubit count, T count and depth replace the three number fields.
          </p>
        </details>

        <div className="mt-5">
          <button type="button" onClick={run} disabled={busy} className="btn btn-primary">
            {busy ? 'Estimating…' : 'Estimate resources'}
          </button>
        </div>
        {error ? (
          <p className="mt-4 text-sm text-q-rose-text" role="alert">{error}</p>
        ) : null}
      </div>

      {result ? (
        <section className="mt-6 space-y-5" aria-live="polite">
          <p className="rounded-lg border border-q-amber/40 bg-q-amber/10 p-3 text-sm text-ink-secondary">
            <strong className="text-ink">Order of magnitude only.</strong> {result.disclaimer}
          </p>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
            {[
              { label: 'Physical qubits', big: powerOfTen(result.physical_qubits), small: compact(result.physical_qubits) },
              { label: 'Runtime', big: result.runtime_human, small: `${powerOfTen(result.runtime_seconds)} s` },
              { label: 'Code distance', big: `d = ${result.code_distance}`, small: `${result.physical_qubits_per_logical} physical per logical` },
              { label: 'Bottleneck', big: result.bottleneck, small: `${result.magic_states.factories} factories, ${result.magic_states.distillation_levels} distillation levels` },
            ].map((tile) => (
              <div key={tile.label} className="card p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{tile.label}</div>
                <div className="mt-1 font-mono text-2xl font-bold text-ink">{tile.big}</div>
                <div className="mt-1 text-xs text-ink-muted">{tile.small}</div>
              </div>
            ))}
          </div>

          {result.circuit ? (
            <p className="text-sm text-ink-secondary">
              Read from your circuit: {result.circuit.algorithm_qubits} logical qubits, T count {result.circuit.t_count},
              depth {result.circuit.logical_depth}.
            </p>
          ) : null}

          <div className="card p-5">
            <h2 className="text-base font-bold">Where the qubits go</h2>
            <p className="mt-1 text-sm text-ink-secondary">
              Surface-code tiles: {result.tiles.data} data, {result.tiles.routing} routing, {result.tiles.factories} in
              magic-state factories. {result.tiles.factories > result.tiles.data
                ? 'Most of the machine is making magic states, not holding your data — which is typical, and why T count matters so much.'
                : 'Your data qubits dominate the footprint.'}
            </p>
          </div>

          {sweep || skipped.unreachable.length || skipped.failed.length ? (
            <div className="card p-5">
              <h2 className="text-base font-bold">Physical qubits vs. physical error rate</h2>
              {sweep ? <SweepChart points={sweep} current={p} /> : null}
              {skipped.unreachable.length ? (
                <p className="mt-3 text-xs text-ink-muted">
                  Not plotted: p = {skipped.unreachable.map((r) => r.toExponential(0)).join(', ')}. No code distance up
                  to 101 meets your failure budget there — {skipped.unreachable.length === 1 ? 'this rate sits' : 'these rates sit'}{' '}
                  too close to the ~1% threshold, where error correction stops paying for itself.
                </p>
              ) : null}
              {skipped.failed.length ? (
                <p className="mt-2 text-xs text-ink-muted">
                  Also missing: p = {skipped.failed.map((r) => r.toExponential(0)).join(', ')} — the estimator did not
                  answer. Run it again to fill {skipped.failed.length === 1 ? 'it' : 'them'} in.
                </p>
              ) : null}
              {sweep ? (
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs font-semibold text-ink-secondary">Table view</summary>
                  <table className="mt-2 text-sm">
                    <thead className="text-xs text-ink-muted"><tr><th className="pr-6 text-left">p</th><th className="text-left">physical qubits</th></tr></thead>
                    <tbody>
                      {sweep.map((d) => (
                        <tr key={d.p}><td className="pr-6 font-mono">{d.p.toExponential(0)}</td><td className="font-mono">{compact(d.q)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              ) : null}
            </div>
          ) : null}

          <div className="card p-5">
            <h2 className="text-base font-bold">What this model does not know</h2>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-ink-secondary">
              {result.caveats.map((c) => (
                <li key={c}>{c}</li>
              ))}
              {result.circuit?.approximations?.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <p className="mt-3 text-sm text-ink-secondary">
              The threshold here (1%, circuit-level noise) is not the one in the{' '}
              <Link href="/workbench/decoder-lab" className="text-q-sky-text underline underline-offset-2">Decoder Lab</Link>{' '}
              (phenomenological noise). Both are right for their own noise model.
            </p>
          </div>
        </section>
      ) : null}
    </div>
  )
}
