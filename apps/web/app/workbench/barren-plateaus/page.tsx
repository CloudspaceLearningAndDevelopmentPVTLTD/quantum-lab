'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { mulberry32 } from '@/lib/quantum'
import {
  fitDecay,
  gradient,
  randomCircuit,
  summariseGradients,
  type PlateauCost,
  type VariancePoint,
} from '@/lib/workbench/barrenPlateau'
import { SERIES_ACCENTS, SeriesChart } from '@/components/workbench/SeriesChart'

/**
 * /workbench/barren-plateaus — the variance of a gradient, measured.
 *
 * One run sweeps n = 2, 4, … for one (cost, depth) setting and adds a line to
 * the chart; runs accumulate so two settings can be compared on one axis,
 * which is the whole point — the plateau is a statement about how the SAME
 * circuit family behaves under a different cost or depth.
 */

const COSTS: { id: PlateauCost; label: string; formula: string }[] = [
  { id: 'zz', label: 'Two-qubit observable', formula: '⟨Z₀Z₁⟩' },
  { id: 'global', label: 'Global cost', formula: '1 − P(all qubits read 0)' },
  { id: 'local', label: 'Local cost', formula: '1 − average over qubits of P(qubit reads 0)' },
]

type Depth = { kind: 'perQubit'; factor: number } | { kind: 'fixed'; layers: number }

const DEPTHS: { id: string; label: string; depth: Depth }[] = [
  { id: 'deep', label: 'Deep — 6 layers per qubit', depth: { kind: 'perQubit', factor: 6 } },
  { id: 'shallow', label: 'Shallow — 2 layers', depth: { kind: 'fixed', layers: 2 } },
  { id: 'medium', label: 'Fixed — 10 layers', depth: { kind: 'fixed', layers: 10 } },
]

const EXPERIMENTS: { label: string; cost: PlateauCost; depthId: string; note: string }[] = [
  { label: 'McClean 2018: deep circuit', cost: 'zz', depthId: 'deep', note: 'A local observable still plateaus once the circuit is deep enough to scramble.' },
  { label: 'Cerezo 2021: global cost, shallow', cost: 'global', depthId: 'shallow', note: 'A cost that looks at every qubit at once plateaus even at two layers.' },
  { label: 'Cerezo 2021: local cost, shallow', cost: 'local', depthId: 'shallow', note: 'The same shallow circuit with a local cost loses gradient only polynomially — about 1/n² here, from the 1/n in the cost — not exponentially.' },
]

interface Run {
  id: number
  label: string
  points: VariancePoint[]
}

const layersFor = (depth: Depth, n: number) => (depth.kind === 'perQubit' ? depth.factor * n : depth.layers)

export default function BarrenPlateausPage() {
  const [cost, setCost] = useState<PlateauCost>('zz')
  const [depthId, setDepthId] = useState('deep')
  const [maxQubits, setMaxQubits] = useState(8)
  const [samples, setSamples] = useState(100)
  const [seed, setSeed] = useState(1)
  const [runs, setRuns] = useState<Run[]>([])
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState(0)
  const cancel = useRef(false)
  const nextId = useRef(0)

  useEffect(
    () => () => {
      cancel.current = true
    },
    [],
  )

  const handleRun = async () => {
    const depth = DEPTHS.find((d) => d.id === depthId)!
    const costCopy = COSTS.find((c) => c.id === cost)!
    cancel.current = false
    setRunning(true)
    setProgress(0)

    const id = nextId.current++
    const label = `${costCopy.formula} · ${depth.depth.kind === 'perQubit' ? `${depth.depth.factor}n layers` : `${depth.depth.layers} layers`}`
    const sizes: number[] = []
    for (let n = 2; n <= maxQubits; n += 2) sizes.push(n)
    const total = sizes.length * samples
    const rng = mulberry32(seed)
    const points: VariancePoint[] = []
    let done = 0
    let lastYield = performance.now()

    for (const n of sizes) {
      const layers = layersFor(depth.depth, n)
      const gradients: number[] = []
      for (let i = 0; i < samples; i++) {
        gradients.push(gradient(randomCircuit(n, layers, rng), cost))
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
      points.push(summariseGradients(n, layers, gradients))
      const snapshot = [...points]
      setRuns((current) => [...current.filter((r) => r.id !== id), { id, label, points: snapshot }].slice(-5))
    }
    setRunning(false)
  }

  const applyExperiment = (e: (typeof EXPERIMENTS)[number]) => {
    setCost(e.cost)
    setDepthId(e.depthId)
  }

  const series = runs.map((r, i) => ({
    label: r.label,
    accent: SERIES_ACCENTS[i % SERIES_ACCENTS.length],
    points: r.points.map((p) => ({ x: p.n, y: p.variance, err: p.stderr })),
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
        <span className="pill border border-q-amber/30 bg-q-amber/15 text-q-amber-text">measure</span>
        <h1 className="mt-3 text-3xl font-extrabold tracking-tight md:text-4xl">Barren Plateau Explorer</h1>
        <p className="mt-2 text-[15px] text-ink-secondary">
          A variational algorithm trains a parameterised circuit by following the gradient of a cost. The trouble: for
          a randomly initialised circuit the gradient is zero on average, and its variance — how far from zero a
          typical gradient lands — can shrink exponentially with the number of qubits. Then almost every starting
          point is flat, and no number of shots you can afford will show you which way is down. That is a barren
          plateau.
        </p>
        <p className="mt-2 text-[15px] text-ink-secondary">
          This page measures it. Pick a cost and a depth, and it draws random circuits, computes one exact gradient for
          each, and plots the variance against qubit count. Run a second setting and the lines share an axis.
        </p>
      </header>

      <div className="card p-5">
        <p className="text-[13px] font-semibold text-ink-secondary">Reproduce a published result</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {EXPERIMENTS.map((e) => (
            <button
              key={e.label}
              type="button"
              onClick={() => applyExperiment(e)}
              disabled={running}
              aria-pressed={cost === e.cost && depthId === e.depthId}
              className={`btn btn-ghost text-sm ${cost === e.cost && depthId === e.depthId ? 'border-q-amber/60 text-ink' : ''}`}
            >
              {e.label}
            </button>
          ))}
        </div>

        {EXPERIMENTS.filter((e) => e.cost === cost && e.depthId === depthId).map((e) => (
          <p key={e.label} className="mt-2 text-sm text-ink-secondary">
            {e.note}
          </p>
        ))}

        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <label className="text-[13px] font-semibold text-ink-secondary">
            Cost
            <select
              value={cost}
              onChange={(e) => setCost(e.target.value as PlateauCost)}
              disabled={running}
              className="mt-1 block w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink"
            >
              {COSTS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[13px] font-semibold text-ink-secondary">
            Depth
            <select
              value={depthId}
              onChange={(e) => setDepthId(e.target.value)}
              disabled={running}
              className="mt-1 block w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink"
            >
              {DEPTHS.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[13px] font-semibold text-ink-secondary">
            Qubits up to
            <select
              value={maxQubits}
              onChange={(e) => setMaxQubits(Number(e.target.value))}
              disabled={running}
              className="mt-1 block w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink"
            >
              <option value={8}>8</option>
              <option value={10}>10</option>
              <option value={12}>12 (slow when deep)</option>
            </select>
          </label>
          <label className="text-[13px] font-semibold text-ink-secondary">
            Random circuits per point
            <select
              value={samples}
              onChange={(e) => setSamples(Number(e.target.value))}
              disabled={running}
              className="mt-1 block w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink"
            >
              {[50, 100, 200].map((n) => (
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
          Cost: <span className="font-mono">{COSTS.find((c) => c.id === cost)!.formula}</span>. Gradient taken with
          respect to the first rotation angle, by the parameter-shift rule on the exact statevector.
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
            <button type="button" onClick={handleRun} className="btn btn-primary">
              Measure gradient variance
            </button>
          )}
          {runs.length > 0 && !running ? (
            <button type="button" onClick={() => setRuns([])} className="btn btn-ghost">
              Clear chart
            </button>
          ) : null}
          {running ? (
            <span className="text-sm text-ink-secondary" role="status">
              {Math.round(progress * 100)}%
            </span>
          ) : null}
        </div>
      </div>

      {runs.length > 0 ? (
        <div className="card mt-6 p-5">
          <h2 className="text-lg font-bold text-ink">Gradient variance against qubit count</h2>
          <p className="mt-1 text-sm text-ink-secondary">
            Log scale: a straight line going down is exponential decay. Bars are one standard error from the finite
            number of random circuits.
          </p>
          <div className="mt-3">
            <SeriesChart
              series={series}
              yScale="log2"
              xLabel="qubits n"
              yLabel="Var[∂C/∂θ]"
              ariaLabel="Variance of the cost gradient against number of qubits, log scale, one line per setting"
              xTicks={[2, 4, 6, 8, 10, 12].filter((n) => runs.some((r) => r.points.some((p) => p.n === n)))}
            />
          </div>

          <div className="mt-5 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-xs text-ink-muted">
                  <th scope="col" className="py-1 pr-4 font-semibold">Setting</th>
                  <th scope="col" className="py-1 pr-4 font-semibold">Fitted change per added qubit</th>
                  <th scope="col" className="py-1 pr-4 font-semibold">Ratio, first step</th>
                  <th scope="col" className="py-1 pr-4 font-semibold">Ratio, last step</th>
                  <th scope="col" className="py-1 pr-4 font-semibold">Variance at largest n</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => {
                  const fit = fitDecay(r.points)
                  const last = r.points[r.points.length - 1]
                  const step = (i: number) =>
                    r.points.length > i + 1 && r.points[i].variance > 0
                      ? `× ${(r.points[i + 1].variance / r.points[i].variance).toFixed(2)} (n = ${r.points[i].n} → ${r.points[i + 1].n})`
                      : '—'
                  return (
                    <tr key={r.id} className="border-t border-line">
                      <th scope="row" className="py-1.5 pr-4 font-normal text-ink">{r.label}</th>
                      <td className="py-1.5 pr-4 font-mono text-ink">
                        {fit ? `× ${(2 ** fit.slopePerQubit).toFixed(2)}` : '—'}
                      </td>
                      <td className="py-1.5 pr-4 font-mono text-ink">{step(0)}</td>
                      <td className="py-1.5 pr-4 font-mono text-ink">{step(r.points.length - 2)}</td>
                      <td className="py-1.5 pr-4 font-mono text-ink">
                        {last.variance.toExponential(2)} <span className="text-ink-muted">(n = {last.n})</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-ink-muted">
              The fit is a least-squares line through log₂(variance) on {runs[0].points.length} or fewer points — a
              summary of this run, not a measured scaling exponent; × 0.50 would mean the variance halves with every
              qubit. The two ratios are how to tell the kinds of decay apart: exponential decay shrinks by the same
              factor at every step, while polynomial decay (the local cost) shrinks by less each time, its ratio
              climbing toward 1. Each ratio carries the sampling error of two points, so read a difference of 0.1 as
              noise.
            </p>
          </div>
        </div>
      ) : null}

      <section className="mt-10 max-w-3xl text-sm text-ink-secondary">
        <h2 className="text-lg font-bold text-ink">What is being run</h2>
        <p className="mt-2">
          The circuit family is the one in McClean, Boixo, Smelyanskiy, Babbush &amp; Neven, “Barren plateaus in
          quantum neural network training landscapes” (Nat. Commun. 9, 4812, 2018): R<sub>Y</sub>(π/4) on every qubit,
          then layers of one rotation per qubit about a randomly chosen axis by a random angle, each followed by a
          ladder of CZ gates along a line.
        </p>
        <p className="mt-2">
          The global-versus-local comparison is Cerezo, Sone, Volkoff, Cincio &amp; Coles, “Cost function dependent
          barren plateaus in shallow parametrized quantum circuits” (Nat. Commun. 12, 1791, 2021). Their theorem is
          stated for a different layered ansatz; what this page shows is the same effect on the McClean ansatz at small
          n, which is an illustration of the result and not a reproduction of their figures.
        </p>
        <p className="mt-2">
          Limits worth knowing: twelve qubits is far too few to distinguish exponential decay from a steep polynomial
          on the data alone, and a plateau measured without noise says nothing about noise-induced plateaus, which are
          a separate mechanism. For what this means for a real variational run, see the{' '}
          <Link href="/learn/vqe-and-nisq" className="underline hover:text-ink">
            VQE lesson
          </Link>{' '}
          and the{' '}
          <Link href="/workbench/qml-check" className="underline hover:text-ink">
            QML Reality Check
          </Link>
          .
        </p>
      </section>
    </div>
  )
}
