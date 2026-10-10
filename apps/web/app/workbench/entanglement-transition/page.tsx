'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { mulberry32 } from '@/lib/quantum'
import {
  LITERATURE_P_C,
  sampleHybridCircuit,
  summarise,
  type TransitionPoint,
} from '@/lib/workbench/entanglementTransition'
import { SERIES_ACCENTS, SeriesChart } from '@/components/workbench/SeriesChart'

/**
 * /workbench/entanglement-transition — the measurement-induced phase
 * transition, run live.
 *
 * Each point is `samples` independent random Clifford circuits on the
 * stabilizer tableau. The loop yields to the browser between circuits, so the
 * chart fills in as it goes and Stop takes effect at once.
 *
 * The dashed line is a LITERATURE value and is labelled as one. Nothing on
 * this page estimates p_c: at L ≤ 128 with tens of samples, the honest output
 * is the curves and their error bars.
 */

const SIZES = [8, 16, 32, 64, 128]
const RATES = [0, 0.04, 0.08, 0.12, 0.14, 0.16, 0.18, 0.2, 0.24, 0.3, 0.4]
const SAMPLE_CHOICES = [20, 50, 100]

function toCsv(points: TransitionPoint[]): string {
  return ['L,p,samples,mean_half_chain_entropy_bits,stderr']
    .concat(points.map((p) => `${p.L},${p.p},${p.samples},${p.mean.toFixed(6)},${p.stderr.toFixed(6)}`))
    .join('\n')
}

export default function EntanglementTransitionPage() {
  const [sizes, setSizes] = useState<number[]>([8, 16, 32, 64])
  const [samples, setSamples] = useState(20)
  const [seed, setSeed] = useState(1)
  const [points, setPoints] = useState<TransitionPoint[]>([])
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState(0)
  const [copied, setCopied] = useState(false)
  const cancel = useRef(false)

  useEffect(
    () => () => {
      cancel.current = true
    },
    [],
  )

  const toggle = (L: number) =>
    setSizes((current) => (current.includes(L) ? current.filter((x) => x !== L) : [...current, L].sort((a, b) => a - b)))

  const handleRun = async () => {
    cancel.current = false
    setRunning(true)
    setPoints([])
    setProgress(0)
    const rng = mulberry32(seed)
    const total = sizes.length * RATES.length * samples
    let done = 0
    let lastYield = performance.now()
    const collected: TransitionPoint[] = []

    for (const L of sizes) {
      for (const p of RATES) {
        const entropies: number[] = []
        for (let i = 0; i < samples; i++) {
          entropies.push(sampleHybridCircuit(L, p, rng).halfChainEntropy)
          done++
          if (performance.now() - lastYield > 40) {
            setProgress(done / total)
            await new Promise((resolve) => setTimeout(resolve, 0))
            lastYield = performance.now()
            if (cancel.current) {
              setRunning(false)
              return
            }
          }
        }
        collected.push(summarise(L, p, entropies))
        setPoints([...collected])
      }
    }
    setProgress(1)
    setRunning(false)
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(toCsv(points))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  const shownSizes = [...new Set(points.map((p) => p.L))]
  const series = shownSizes.map((L) => ({
    label: `L = ${L}`,
    accent: SERIES_ACCENTS[SIZES.indexOf(L) % SERIES_ACCENTS.length],
    points: points.filter((p) => p.L === L).map((p) => ({ x: p.p, y: p.mean, err: p.stderr })),
  }))

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
      <Link
        href="/workbench"
        className="focus-ring mb-6 inline-flex items-center gap-1.5 rounded text-sm text-ink-muted transition-colors hover:text-ink-secondary"
      >
        <span aria-hidden>←</span> Workbench
      </Link>

      <header className="mb-8 max-w-3xl">
        <span className="pill border border-q-rose/30 bg-q-rose/15 text-q-rose-text">measure</span>
        <h1 className="mt-3 text-3xl font-extrabold tracking-tight md:text-4xl">Measurement-Induced Entanglement Transition</h1>
        <p className="mt-2 text-[15px] text-ink-secondary">
          Take a chain of L qubits. Each time step, scramble neighbouring pairs with random two-qubit gates, then
          measure every qubit with probability p. Gates spread entanglement; measurements cut it. Below a critical p
          the gates win and the entanglement between the two halves of the chain grows with L — a volume law. Above it
          the measurements win and it stops growing — an area law. In between is a genuine phase transition in the
          structure of a quantum state, found in 2018 and still an active research area.
        </p>
        <p className="mt-2 text-[15px] text-ink-secondary">
          This page runs the experiment rather than describing it: random Clifford brickwork, projective Z
          measurements, half-chain entropy averaged over independent circuits. It is the stabilizer-circuit numerics of
          Li, Chen &amp; Fisher, at sizes a browser tab reaches in seconds.
        </p>
      </header>

      <div className="card p-5">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
          <fieldset>
            <legend className="text-[13px] font-semibold text-ink-secondary">Chain lengths L</legend>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
              {SIZES.map((L) => (
                <label key={L} className="flex items-center gap-1.5 text-sm text-ink">
                  <input type="checkbox" checked={sizes.includes(L)} onChange={() => toggle(L)} disabled={running} />
                  {L}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="text-[13px] font-semibold text-ink-secondary">
            Circuits per point
            <select
              value={samples}
              onChange={(e) => setSamples(Number(e.target.value))}
              disabled={running}
              className="mt-1 block w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink"
            >
              {SAMPLE_CHOICES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[13px] font-semibold text-ink-secondary">
            Random seed
            <input
              type="number"
              min={0}
              value={seed}
              disabled={running}
              onChange={(e) => setSeed(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
              className="mt-1 block w-full rounded-lg border border-line bg-surface-2 px-3 py-2 font-mono text-sm text-ink"
            />
          </label>
        </div>
        <p className="mt-3 text-xs text-ink-muted">
          {RATES.length} measurement rates from 0 to {RATES[RATES.length - 1]}, each circuit 2L layers deep from the
          all-zero state, open boundaries. L = 128 at 100 circuits per point takes a few minutes.
        </p>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          {running ? (
            <button
              type="button"
              onClick={() => {
                cancel.current = true
              }}
              className="btn btn-ghost"
            >
              Stop
            </button>
          ) : (
            <button type="button" onClick={handleRun} disabled={sizes.length === 0} className="btn btn-primary">
              Run the experiment
            </button>
          )}
          {running ? (
            <span className="text-sm text-ink-secondary" role="status">
              {Math.round(progress * 100)}% of {(sizes.length * RATES.length * samples).toLocaleString('en-US')} circuits
            </span>
          ) : null}
        </div>
      </div>

      {points.length > 0 ? (
        <div className="card mt-6 p-5">
          <h2 className="text-lg font-bold text-ink">Half-chain entanglement entropy against measurement rate</h2>
          <p className="mt-1 text-sm text-ink-secondary">
            Mean of S(L/2) in bits over the circuits at each point; bars are one standard error. Left of the transition
            the curves fan out with L. Right of it they collapse onto one another.
          </p>
          <div className="mt-3">
            <SeriesChart
              series={series}
              xLabel="measurement probability p per qubit per layer"
              yLabel="S(L/2), bits"
              ariaLabel="Mean half-chain entanglement entropy against measurement rate, one line per chain length"
              refX={{ x: LITERATURE_P_C, label: `p_c ≈ ${LITERATURE_P_C} (literature)` }}
              xTicks={[0, 0.1, 0.2, 0.3, 0.4]}
            />
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button type="button" onClick={handleCopy} disabled={running} className="btn btn-ghost">
              {copied ? 'Copied' : 'Copy data as CSV'}
            </button>
            <span className="text-xs text-ink-muted">
              {points.length} points · seed {seed} · {samples} circuits each
            </span>
          </div>
        </div>
      ) : null}

      <section className="mt-10 max-w-3xl text-sm text-ink-secondary">
        <h2 className="text-lg font-bold text-ink">How to read it, and what it does not show</h2>
        <ul className="mt-2 list-disc space-y-2 pl-5">
          <li>
            <strong className="text-ink">The dashed line is not computed here.</strong> p_c ≈ {LITERATURE_P_C} is the
            value reported for this model from finite-size scaling on chains of hundreds of qubits (Li, Chen &amp; Fisher, Phys. Rev.
            B 100, 134306, 2019). At the sizes on this page the curves separate over a range of p, not at a point;
            extracting a critical rate from them would be reading more into the data than is there.
          </li>
          <li>
            <strong className="text-ink">Why Clifford gates.</strong> A generic random circuit on 64 qubits cannot be
            simulated. A random Clifford circuit can — the state stays a stabilizer state, and its entropy is a matrix
            rank. The transition exists for both; its critical exponents differ between the two.
          </li>
          <li>
            <strong className="text-ink">What the entropy is of.</strong> Each circuit, with its particular measurement
            outcomes, ends in a pure state. S(L/2) is that state’s entanglement, then averaged over circuits. The
            average state — outcomes thrown away — is featureless at every p, which is why this transition hid for so
            long and why observing it on hardware needs post-selection or a decoder.
          </li>
          <li>
            <strong className="text-ink">Simplifications.</strong> Open boundaries rather than periodic, depth 2L, and
            von Neumann entropy only (for stabilizer states every Rényi entropy is the same number).
          </li>
        </ul>
        <p className="mt-3">
          Sources: Li, Chen &amp; Fisher, Phys. Rev. B 98, 205136 (2018); Skinner, Ruhman &amp; Nahum, Phys. Rev. X 9,
          031009 (2019). The engine is the{' '}
          <Link href="/workbench/stabilizer" className="underline hover:text-ink">
            Stabilizer Simulator
          </Link>
          ; its random two-qubit Cliffords are drawn uniformly from all 11,520.
        </p>
      </section>
    </div>
  )
}
