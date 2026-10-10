'use client'

import Link from 'next/link'
import { useState } from 'react'
import {
  correctnessSuite,
  performanceSuite,
  type CorrectnessResult,
  type PerformanceResult,
} from '@/lib/bench/simulatorBenchmark'

/**
 * /workbench/simulator-benchmark — a real, honest correctness-and-performance
 * benchmark for the statevector engine in lib/quantum.ts.
 *
 * Matches the /benchmark page's honesty convention: no placeholder numbers,
 * ever. Until the reader presses the button there is no benchmark data, so
 * the page says exactly that instead of showing something that looks like a
 * result. Both suites run client-side, in this browser, so the timings are
 * real for whatever machine is actually viewing the page — a benchmark run
 * on our server would only describe our server, not the reader's device.
 */

interface Results {
  correctness: CorrectnessResult[]
  performance: PerformanceResult[]
}

const PERFORMANCE_MAX_QUBITS = 16

function fmtMs(ms: number): string {
  return ms < 1 ? `${ms.toFixed(3)} ms` : `${ms.toFixed(1)} ms`
}

function fmtRate(gatesPerSecond: number): string {
  return `${Math.round(gatesPerSecond).toLocaleString('en-US')} gates/s`
}

function fmtDeviation(d: number): string {
  return d === 0 ? '0' : d.toExponential(3)
}

function CorrectnessTable({ rows }: { rows: CorrectnessResult[] }) {
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full min-w-[28rem] text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-ink-muted">
            <th className="py-2 pr-4 font-semibold">Circuit</th>
            <th className="py-2 pr-4 font-semibold">Max deviation</th>
            <th className="py-2 font-semibold">Result</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name} className="border-b border-line last:border-b-0">
              <td className="py-2 pr-4 text-ink">{r.name}</td>
              <td className="py-2 pr-4 font-mono text-xs text-ink-secondary">
                {fmtDeviation(r.maxDeviation)}
              </td>
              <td className="py-2">
                <span
                  className={
                    r.passed
                      ? 'pill border border-q-teal/30 bg-q-teal/15 text-q-teal-text'
                      : 'pill border border-q-rose/30 bg-q-rose/15 text-q-rose-text'
                  }
                >
                  {r.passed ? 'Pass' : 'Fail'}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function PerformanceTable({ rows }: { rows: PerformanceResult[] }) {
  const maxMs = Math.max(...rows.map((r) => r.ms), 1e-6)
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full min-w-[32rem] text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-ink-muted">
            <th className="py-2 pr-4 font-semibold">Qubits</th>
            <th className="py-2 pr-4 font-semibold">Gates</th>
            <th className="py-2 pr-4 font-semibold">Time</th>
            <th className="py-2 font-semibold">Throughput</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.qubits} className="border-b border-line last:border-b-0">
              <td className="py-2 pr-4 font-mono text-xs text-ink">{r.qubits}</td>
              <td className="py-2 pr-4 text-ink-secondary">{r.gates}</td>
              <td className="py-2 pr-4">
                <div className="flex items-center gap-2">
                  <div className="h-2 flex-1 min-w-[3rem] rounded-full bg-surface-2">
                    <div
                      className="h-2 rounded-full bg-q-sky"
                      style={{ width: `${Math.max((r.ms / maxMs) * 100, 2)}%` }}
                    />
                  </div>
                  <span className="whitespace-nowrap font-mono text-xs text-ink-secondary">
                    {fmtMs(r.ms)}
                  </span>
                </div>
              </td>
              <td className="py-2 font-mono text-xs text-ink-secondary">{fmtRate(r.gatesPerSecond)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function SimulatorBenchmarkPage() {
  const [results, setResults] = useState<Results | null>(null)
  const [running, setRunning] = useState(false)

  const run = () => {
    setRunning(true)
    // A macrotask so the "Running…" state actually paints before the
    // (synchronous, potentially seconds-long at 16 qubits) suites block.
    setTimeout(() => {
      const correctness = correctnessSuite()
      const perf = performanceSuite(PERFORMANCE_MAX_QUBITS)
      setResults({ correctness, performance: perf })
      setRunning(false)
    }, 0)
  }

  const allPassed = results ? results.correctness.every((r) => r.passed) : null

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-10">
      <Link
        href="/workbench"
        className="focus-ring mb-6 inline-flex items-center gap-1.5 rounded text-sm text-ink-muted transition-colors hover:text-ink-secondary"
      >
        <span aria-hidden>←</span> Workbench
      </Link>

      <header>
        <span className="section-label">Benchmark</span>
        <h1 className="section-title mt-2">Simulator correctness & performance</h1>
        <p className="section-desc mt-3 max-w-2xl">
          Every number below is measured, not estimated. Correctness runs five circuits with an
          exact, hand-derivable closed-form final state (Bell, GHZ-3, GHZ-5, a 4-qubit QFT of
          |0000⟩, and the Grover preset) through the real simulator and reports the actual
          deviation from that closed form. Performance times the real simulator on a synthetic
          circuit at each qubit count, in this browser, on this machine — a run on our server
          would only describe our server.
        </p>
      </header>

      <div className="mt-6">
        <button
          type="button"
          onClick={run}
          disabled={running}
          className="focus-ring rounded-lg border border-line bg-surface px-4 py-2 text-sm font-semibold text-ink transition-colors hover:bg-surface-2 disabled:opacity-60"
        >
          {running ? 'Running…' : 'Run benchmark'}
        </button>
        {results ? (
          <span className="ml-3 text-xs text-ink-muted">
            {allPassed ? 'All correctness checks passed.' : 'One or more correctness checks failed.'}
          </span>
        ) : null}
      </div>

      <section className="mt-8">
        <h2 className="text-base font-bold text-ink">Correctness</h2>
        {results === null ? (
          <p className="mt-2 text-sm text-ink-secondary">no data yet — click Run benchmark</p>
        ) : (
          <CorrectnessTable rows={results.correctness} />
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-base font-bold text-ink">Performance</h2>
        {results === null ? (
          <p className="mt-2 text-sm text-ink-secondary">no data yet — click Run benchmark</p>
        ) : (
          <PerformanceTable rows={results.performance} />
        )}
      </section>
    </div>
  )
}
