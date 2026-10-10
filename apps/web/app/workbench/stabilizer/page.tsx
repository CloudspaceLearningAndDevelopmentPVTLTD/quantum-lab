'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { mulberry32 } from '@/lib/quantum'
import {
  MAX_STABILIZER_QUBITS,
  Tableau,
  clusterChainProgram,
  clusterGridProgram,
  ghzProgram,
  parseCliffordProgram,
  randomBrickwork,
  runCliffordProgram,
  type ProgramRun,
} from '@/lib/quantum/stabilizer'
import { SeriesChart } from '@/components/workbench/SeriesChart'

/**
 * /workbench/stabilizer — Clifford circuits on a stabilizer tableau.
 *
 * The statevector simulator stops at 16 qubits because it stores 2^n
 * amplitudes. This page runs the Clifford subset on lib/quantum/stabilizer.ts,
 * which stores 2n(2n+1) bits, so a thousand-qubit GHZ state is a click. What
 * comes back is what a tableau can give exactly: the stabilizer generators,
 * the entanglement entropy across every cut, and measurement samples.
 */

type PresetId = 'ghz' | 'chain' | 'grid' | 'brickwork' | 'custom'

const PRESETS: { id: PresetId; label: string; blurb: string }[] = [
  {
    id: 'ghz',
    label: 'GHZ state',
    blurb: 'H then a chain of CNOTs. One bit of entanglement across every cut, however long the chain.',
  },
  {
    id: 'chain',
    label: '1D cluster state',
    blurb: '|+⟩ on every qubit, CZ between neighbours. The resource state of measurement-based computing, on a line.',
  },
  {
    id: 'grid',
    label: '2D cluster state',
    blurb: 'The same on a square grid, numbered row by row — so the cut entropy tracks how many bonds the cut severs.',
  },
  {
    id: 'brickwork',
    label: 'Random Clifford brickwork',
    blurb:
      'Uniformly random two-qubit Cliffords, 2n layers deep — long enough for entanglement, which spreads at about a third of a bit per layer, to saturate. Entropy follows the volume law, min(k, n − k), to within a bit or two.',
  },
  {
    id: 'custom',
    label: 'Your circuit (OpenQASM)',
    blurb: 'Clifford gates only: h, s, sdg, x, y, z, sx, cx, cy, cz, swap, reset, measure.',
  },
]

const SIZES = [9, 36, 100, 256, 400, 1024, 2025]
/** A depth-2n brickwork is n(n − 1) gates on 2n rows: cubic, so it gets a lower ceiling. */
const MAX_BRICKWORK = 256
const DEFAULT_QASM =
  'qubit[5] q;\nh q[0];\ncx q[0], q[1];\ncx q[1], q[2];\ns q[2];\ncz q[2], q[3];\nh q[4];\nmeasure q[4];\n'
const SHOWN_GENERATORS = 16
const SHOWN_WIDTH = 64

interface Outcome {
  n: number
  gates: number
  ms: number
  run: ProgramRun
  profile: number[]
  shots: string[]
}

function clip(text: string, width: number): string {
  return text.length > width ? `${text.slice(0, width)}…` : text
}

function bytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} kB`
  return `${(n / 1024 ** 2).toFixed(1)} MB`
}

export default function StabilizerPage() {
  const [preset, setPreset] = useState<PresetId>('ghz')
  const [size, setSize] = useState(100)
  const [qasm, setQasm] = useState(DEFAULT_QASM)
  const [seed, setSeed] = useState(1)
  const [error, setError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [busy, setBusy] = useState(false)

  const sizes = preset === 'brickwork' ? SIZES.filter((n) => n <= MAX_BRICKWORK) : SIZES
  const blurb = PRESETS.find((p) => p.id === preset)!.blurb

  const compute = () => {
    try {
      const rng = mulberry32(seed)
      const started = performance.now()
      let run: ProgramRun
      let gates: number
      if (preset === 'brickwork') {
        run = { tableau: randomBrickwork(size, 2 * size, rng), measurements: [] }
        // Layers alternate between ⌊n/2⌋ and ⌊(n−1)/2⌋ gates, n of each.
        gates = size * (Math.floor(size / 2) + Math.floor((size - 1) / 2))
      } else {
        const program =
          preset === 'ghz'
            ? ghzProgram(size)
            : preset === 'chain'
              ? clusterChainProgram(size)
              : preset === 'grid'
                ? clusterGridProgram(Math.round(Math.sqrt(size)))
                : parseCliffordProgram(qasm)
        run = runCliffordProgram(program, rng)
        gates = program.ops.length
      }
      const profile = run.tableau.entropyProfile()
      const ms = performance.now() - started

      // Each shot measures every qubit of a fresh copy, so shots are independent.
      const shots: string[] = []
      for (let s = 0; s < (run.tableau.n > 400 ? 2 : 6); s++) {
        const copy: Tableau = run.tableau.clone()
        let bits = ''
        for (let q = 0; q < copy.n; q++) bits += copy.measure(q, rng).outcome
        shots.push(bits)
      }
      setOutcome({ n: run.tableau.n, gates, ms, run, profile, shots })
    } catch (e) {
      setOutcome(null)
      setError(e instanceof Error ? e.message : 'That circuit could not be run.')
    }
    setBusy(false)
  }

  // The largest presets take a second or two; yield first so "Running…" paints.
  const handleRun = () => {
    setError(null)
    setBusy(true)
    setTimeout(compute, 20)
  }

  const chart = useMemo(() => {
    if (!outcome) return null
    const step = Math.max(1, Math.ceil(outcome.n / 120))
    const points = outcome.profile.map((y, x) => ({ x, y })).filter((p) => p.x % step === 0 || p.x === outcome.n)
    return [{ label: 'S(qubits 0…k−1), bits', accent: 'sky' as const, points }]
  }, [outcome])

  const tableauBytes = outcome ? 2 * (2 * outcome.n + 1) * Math.ceil(outcome.n / 32) * 4 + 2 * outcome.n + 1 : 0
  const generators = useMemo(() => (outcome ? outcome.run.tableau.stabilizers() : []), [outcome])

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
      <Link
        href="/workbench"
        className="focus-ring mb-6 inline-flex items-center gap-1.5 rounded text-sm text-ink-muted transition-colors hover:text-ink-secondary"
      >
        <span aria-hidden>←</span> Workbench
      </Link>

      <header className="mb-8 max-w-3xl">
        <span className="pill border border-q-teal/30 bg-q-teal/15 text-q-teal-text">run</span>
        <h1 className="mt-3 text-3xl font-extrabold tracking-tight md:text-4xl">Stabilizer Simulator</h1>
        <p className="mt-2 text-[15px] text-ink-secondary">
          A statevector needs 2ⁿ amplitudes, which is why the main simulator stops at 16 qubits. A circuit made only
          of Clifford gates never needs them: its state is pinned down by n Pauli operators, and each gate just
          rewrites that list (the Gottesman–Knill theorem; the tableau algorithm here is Aaronson &amp; Gottesman,
          2004). So this page runs up to {MAX_STABILIZER_QUBITS.toLocaleString('en-US')} qubits in your browser,
          exactly — and refuses a T gate, because no list of Paulis can follow one.
        </p>
      </header>

      <div className="card p-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <label className="text-[13px] font-semibold text-ink-secondary">
            Circuit
            <select
              value={preset}
              onChange={(e) => {
                const next = e.target.value as PresetId
                setPreset(next)
                if (next === 'brickwork' && size > MAX_BRICKWORK) setSize(MAX_BRICKWORK)
              }}
              className="mt-1 block w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink"
            >
              {PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          {preset !== 'custom' ? (
            <label className="text-[13px] font-semibold text-ink-secondary">
              Qubits
              <select
                value={size}
                onChange={(e) => setSize(Number(e.target.value))}
                className="mt-1 block w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink"
              >
                {sizes.map((n) => (
                  <option key={n} value={n}>
                    {preset === 'grid' ? `${Math.sqrt(n)} × ${Math.sqrt(n)} = ${n}` : n}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="text-[13px] font-semibold text-ink-secondary">
            Random seed
            <input
              type="number"
              min={0}
              value={seed}
              onChange={(e) => setSeed(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
              className="mt-1 block w-full rounded-lg border border-line bg-surface-2 px-3 py-2 font-mono text-sm text-ink"
            />
          </label>
        </div>
        <p className="mt-3 text-sm text-ink-secondary">{blurb}</p>

        {preset === 'custom' ? (
          <textarea
            value={qasm}
            onChange={(e) => setQasm(e.target.value)}
            rows={10}
            spellCheck={false}
            aria-label="OpenQASM source, Clifford gates only"
            className="mt-3 w-full rounded-lg border border-line bg-surface-2 p-3 font-mono text-[13px] text-ink"
          />
        ) : null}

        <div className="mt-5">
          <button type="button" onClick={handleRun} disabled={busy} className="btn btn-primary">
            {busy ? 'Running…' : 'Run on the tableau'}
          </button>
        </div>
        {error ? (
          <p className="mt-3 text-sm text-q-rose-text" role="alert">
            {error}
          </p>
        ) : null}
      </div>

      {outcome && chart ? (
        <div className="mt-6 space-y-6">
          <div className="card grid grid-cols-1 gap-4 p-5 sm:grid-cols-4" role="status">
            <div>
              <p className="text-xs text-ink-muted">Qubits</p>
              <p className="font-mono text-2xl font-bold text-ink">{outcome.n.toLocaleString('en-US')}</p>
            </div>
            <div>
              <p className="text-xs text-ink-muted">Operations</p>
              <p className="font-mono text-2xl font-bold text-ink">{outcome.gates.toLocaleString('en-US')}</p>
            </div>
            <div>
              <p className="text-xs text-ink-muted">Run + entropy profile, measured here</p>
              <p className="font-mono text-2xl font-bold text-ink">
                {outcome.ms < 10 ? outcome.ms.toFixed(1) : Math.round(outcome.ms).toLocaleString('en-US')} ms
              </p>
            </div>
            <div>
              <p className="text-xs text-ink-muted">Tableau size</p>
              <p className="font-mono text-2xl font-bold text-ink">{bytes(tableauBytes)}</p>
              <p className="mt-0.5 text-xs text-ink-muted">a statevector would need 2^{outcome.n + 4} bytes</p>
            </div>
          </div>

          <div className="card p-5">
            <h2 className="text-lg font-bold text-ink">Entanglement entropy across every cut</h2>
            <p className="mt-1 text-sm text-ink-secondary">
              S of the first k qubits against the rest, in bits. Exact: for a stabilizer state it is the rank of the
              generators restricted to those k qubits, minus k — one Gaussian elimination gives the whole curve.
            </p>
            <div className="mt-3">
              <SeriesChart
                series={chart}
                xLabel="cut position k"
                yLabel="entropy (bits)"
                ariaLabel="Entanglement entropy of the first k qubits, for every cut position"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="card min-w-0 p-5">
              <h2 className="text-lg font-bold text-ink">Stabilizer generators</h2>
              <p className="mt-1 text-sm text-ink-secondary">
                {outcome.n.toLocaleString('en-US')} Pauli operators with eigenvalue +1 on the final state. Character k
                (after the sign) is the Pauli on qubit k. A generating set, not a canonical one.
              </p>
              <pre className="mt-3 overflow-x-auto rounded-lg border border-line bg-surface-2 p-3 font-mono text-[12px] leading-5 text-ink">
                {generators
                  .slice(0, SHOWN_GENERATORS)
                  .map((g) => clip(g, SHOWN_WIDTH + 1))
                  .join('\n')}
                {generators.length > SHOWN_GENERATORS ? `\n… ${generators.length - SHOWN_GENERATORS} more` : ''}
              </pre>
            </div>

            <div className="card min-w-0 p-5">
              <h2 className="text-lg font-bold text-ink">Measurements</h2>
              {outcome.run.measurements.length > 0 ? (
                <p className="mt-1 text-sm text-ink-secondary">
                  In the circuit:{' '}
                  {outcome.run.measurements.slice(0, 12).map((m, i) => (
                    <span key={i} className="mr-2 whitespace-nowrap font-mono text-ink">
                      q[{m.qubit}] = {m.outcome}
                      <span className="text-ink-muted"> ({m.deterministic ? 'certain' : 'coin flip'})</span>
                    </span>
                  ))}
                  {outcome.run.measurements.length > 12 ? `… ${outcome.run.measurements.length - 12} more` : ''}
                </p>
              ) : null}
              <p className="mt-2 text-sm text-ink-secondary">
                {outcome.shots.length} independent shots of the final state, every qubit measured in Z, qubit 0
                first:
              </p>
              <pre className="mt-3 overflow-x-auto rounded-lg border border-line bg-surface-2 p-3 font-mono text-[12px] leading-5 text-ink">
                {outcome.shots.map((s) => clip(s, SHOWN_WIDTH)).join('\n')}
              </pre>
            </div>
          </div>
        </div>
      ) : null}

      <section className="mt-10 max-w-3xl text-sm text-ink-secondary">
        <h2 className="text-lg font-bold text-ink">What this is not</h2>
        <p className="mt-2">
          Not a faster general simulator. Clifford circuits are exactly the ones a classical computer can follow
          efficiently; add enough T gates and the cost climbs back to exponential. What a tableau is for is everything
          in error correction — syndrome circuits, decoders and thresholds are all Clifford — and large-scale
          entanglement dynamics such as the{' '}
          <Link href="/workbench/entanglement-transition" className="underline hover:text-ink">
            measurement-induced transition
          </Link>
          . To check a code rather than a circuit, use the{' '}
          <Link href="/workbench/code-explorer" className="underline hover:text-ink">
            Stabilizer Code Explorer
          </Link>
          .
        </p>
        <p className="mt-2">
          The engine is cross-checked against this site’s statevector simulator on random circuits up to 6 qubits:
          every generator it reports must stabilize the actual amplitudes, sign included.
        </p>
      </section>
    </div>
  )
}
