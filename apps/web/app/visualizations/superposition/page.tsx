'use client'

import { useMemo, useState } from 'react'
import SuperpositionLab from '@/components/viz/SuperpositionLab'
import { VizFrame, Explainer } from '@/components/ui/VizFrame'
import { Slider, Segmented, Toggle, ButtonRow, Stat } from '@/components/ui/Controls'
import { Histogram, HistogramTable } from '@/components/ui/Histogram'
import type { HistogramDatum } from '@/components/ui/Histogram'
import {
  simulate,
  run,
  formatComplex,
  formatKet,
  type Circuit,
  type GateOp,
  type GateName,
  type RunResult,
} from '@/lib/quantum'

type QubitCount = '1' | '2' | '3' | '4'

const GATE_BUTTONS: { name: GateName; label: string; hint: string }[] = [
  { name: 'H', label: 'H', hint: 'Hadamard — split into an even superposition' },
  { name: 'X', label: 'X', hint: 'Bit flip' },
  { name: 'Z', label: 'Z', hint: 'Phase flip on |1⟩' },
  { name: 'S', label: 'S', hint: 'Quarter-turn phase' },
  { name: 'RY', label: 'RY(θ)', hint: 'Tilt by θ — unequal odds' },
]

const formatPi = (v: number) => `${(v / Math.PI).toFixed(2)}π`
const pct = (p: number) => `${(p * 100).toFixed(1)}%`

export default function SuperpositionPage() {
  const [numQubits, setNumQubits] = useState(1)
  const [ops, setOps] = useState<GateOp[]>([{ name: 'H', qubits: [0] }])
  const [targetQubit, setTargetQubit] = useState(0)
  const [theta, setTheta] = useState(Math.PI / 2)
  const [collapsed, setCollapsed] = useState<{ index: number; bits: string } | null>(null)
  const [tally, setTally] = useState<Record<string, number>>({})
  const [showPhase, setShowPhase] = useState(false)
  const [shotResult, setShotResult] = useState<RunResult | null>(null)
  const [showTable, setShowTable] = useState(false)

  const circuit = useMemo<Circuit>(() => ({ numQubits, ops }), [numQubits, ops])
  const state = useMemo(() => simulate(circuit), [circuit])

  const probs = state.probabilities()

  /*
   * A11Y: the facts behind the bars, for components/viz/VizDescription.
   *
   * The canvas is a bitmap — a screen reader gets nothing from it but the
   * static aria-label, which says what the picture IS and never what it is
   * currently DOING. That is the whole content of this page. These are the
   * same numbers the bars encode, handed over as text so the readout and the
   * drawing cannot drift.
   *
   * Only the basis states that actually carry probability are listed, and at
   * most four of them: a 4-qubit register has 16 bars, and reading sixteen
   * values aloud (twelve of them "0.0%") is not an accessible description, it
   * is a denial-of-service on the listener. `spoken` carries prose because a
   * label like "|01⟩" is read as punctuation soup by every major screen
   * reader.
   */
  const vizFacts = useMemo(() => {
    const ACCENTS = ['violet', 'teal', 'amber', 'rose'] as const
    return probs
      .map((p, i) => ({ p, i }))
      .filter((d) => d.p > 0.001)
      .sort((a, b) => b.p - a.p)
      .slice(0, 4)
      .map((d, rank) => ({
        label: formatKet(d.i, state.numQubits),
        value: `${(d.p * 100).toFixed(1)}%`,
        accent: ACCENTS[rank],
        spoken: `${formatKet(d.i, state.numQubits)
          .replace(/[|⟩]/g, '')
          .split('')
          .join(' ')} at ${(d.p * 100).toFixed(1)} percent`,
      }))
  }, [probs, state.numQubits])
  const best = probs.reduce(
    (acc, p, i) => (p > acc.p ? { p, i } : acc),
    { p: -1, i: 0 }
  )

  const tallyData: HistogramDatum[] = Object.entries(tally).map(([label, value]) => ({
    label,
    value,
  }))
  const tallyTotal = tallyData.reduce((a, d) => a + d.value, 0)
  const likelyLabels = probs
    .map((p, i) => ({ p, label: state.label(i) }))
    .filter((d) => d.p > 0.001)
    .map((d) => d.label)

  const shotData: HistogramDatum[] = shotResult
    ? Object.entries(shotResult.counts).map(([label, value]) => ({ label, value }))
    : []

  const changeQubits = (v: QubitCount) => {
    setNumQubits(parseInt(v, 10))
    setOps([])
    setTally({})
    setCollapsed(null)
    setShotResult(null)
    setTargetQubit(0)
  }

  const addGate = (name: GateName) => {
    const op: GateOp = name === 'RY'
      ? { name, qubits: [targetQubit], theta }
      : { name, qubits: [targetQubit] }
    setOps((prev) => [...prev, op])
    setCollapsed(null)
  }

  const undo = () => {
    setOps((prev) => prev.slice(0, -1))
    setCollapsed(null)
  }

  const reset = () => {
    setOps([])
    setTally({})
    setCollapsed(null)
    setShotResult(null)
  }

  const measureOnce = () => {
    const copy = state.clone()
    const bits: string[] = new Array<string>(numQubits).fill('0')
    for (let q = 0; q < numQubits; q++) {
      const outcome = copy.measureQubit(q)
      bits[numQubits - 1 - q] = String(outcome)
    }
    const bitstring = bits.join('')
    const index = parseInt(bitstring, 2)
    setCollapsed({ index, bits: bitstring })
    setTally((prev) => ({ ...prev, [bitstring]: (prev[bitstring] ?? 0) + 1 }))
  }

  const runShots = () => {
    setShotResult(run(circuit, 1000))
  }

  const controls = (
    <>
      <Segmented<QubitCount>
        label="Qubits"
        value={String(numQubits) as QubitCount}
        options={[
          { value: '1', label: '1' },
          { value: '2', label: '2' },
          { value: '3', label: '3' },
          { value: '4', label: '4' },
        ]}
        onChange={changeQubits}
      />

      <Segmented<string>
        label="Target qubit"
        value={String(targetQubit)}
        options={Array.from({ length: numQubits }, (_, q) => ({
          value: String(q),
          label: `q${q}`,
        }))}
        onChange={(v) => setTargetQubit(parseInt(v, 10))}
      />

      <div>
        <span className="mb-1.5 block text-[13px] font-semibold text-ink-secondary">
          Apply a gate
        </span>
        <div className="flex flex-wrap gap-2">
          {GATE_BUTTONS.map((g) => (
            <button
              key={g.name}
              type="button"
              title={g.hint}
              onClick={() => addGate(g.name)}
              className="focus-ring rounded-lg border border-line bg-surface-2 px-3 py-1.5 font-mono text-xs font-bold text-q-violet-text transition-colors hover:border-line-strong hover:bg-surface-3"
            >
              {g.label}
            </button>
          ))}
        </div>
      </div>

      <Slider
        label="θ"
        value={theta}
        min={0}
        max={2 * Math.PI}
        step={0.01}
        format={formatPi}
        onChange={setTheta}
        hint="angle used by the RY button"
      />

      <ButtonRow>
        <button type="button" className="btn-ghost" onClick={undo} disabled={ops.length === 0}>
          Undo
        </button>
        <button type="button" className="btn-ghost" onClick={reset}>
          Reset
        </button>
      </ButtonRow>

      <Toggle
        label="Show phase"
        checked={showPhase}
        onChange={setShowPhase}
        hint="Tint each bar by its amplitude's phase and draw a dial beneath it."
      />

      <ButtonRow>
        <button type="button" className="btn-primary" onClick={measureOnce}>
          Measure once
        </button>
        <button type="button" className="btn-ghost" onClick={runShots}>
          Run 1000 shots
        </button>
      </ButtonRow>

      <div className="grid grid-cols-2 gap-2">
        <Stat label="Gates" value={String(ops.length)} accent="violet" />
        <Stat label="Measurements" value={String(tallyTotal)} accent="sky" />
        <Stat label="Most likely" value={formatKet(best.i, numQubits)} accent="teal" />
        <Stat label="Its probability" value={pct(Math.max(best.p, 0))} accent="amber" />
      </div>
    </>
  )

  const rows = probs.map((p, i) => ({ i, p, amp: state.amplitude(i) }))
  const shownRows = state.dim > 16 ? rows.slice(0, 16) : rows

  return (
    <VizFrame
      title="Superposition & Measurement"
      tagline="Build a quantum state, then find out what measuring it actually does."
      level="Beginner"
      canvas={
        <div className="p-2">
          <SuperpositionLab
            state={state}
            showPhase={showPhase}
            collapsedTo={collapsed ? collapsed.index : null}
          />
          <p className="px-3 pb-2 pt-1 text-[11px] text-ink-muted">
            {collapsed
              ? `Collapsed to |${collapsed.bits}⟩ — the other amplitudes are gone. Add a gate to rebuild a superposition.`
              : 'Bar height is the probability of that outcome. Press “Measure once” to collapse the state.'}
          </p>
        </div>
      }
      controls={controls}
      description={{
        facts: vizFacts,
        summary: collapsed
          ? `Measured. The state collapsed to ${formatKet(collapsed.index, state.numQubits)}, which now has all the probability.`
          : `Probability of each outcome for ${state.numQubits} qubit${state.numQubits === 1 ? '' : 's'}.`,
      }}
    >
      {tallyData.length > 0 ? (
        <section className="card mb-6 p-6">
          {showTable ? (
            <>
              <h2 className="mb-4 text-[13px] font-semibold text-ink-secondary">
                Your measurements
                <span className="ml-2 font-normal text-ink-muted">
                  {tallyTotal.toLocaleString('en-US')} measurements
                </span>
              </h2>
              <HistogramTable data={tallyData} total={tallyTotal} />
            </>
          ) : (
            <Histogram
              title="Your measurements"
              data={tallyData}
              total={tallyTotal}
              unit="measurements"
              highlight={likelyLabels}
            />
          )}
          <div className="mt-4">
            <Toggle label="Show as table" checked={showTable} onChange={setShowTable} />
          </div>
        </section>
      ) : null}

      {shotResult ? (
        <section className="card mb-6 p-6">
          <Histogram
            title="1000 simulated shots"
            data={shotData}
            total={1000}
            highlight={likelyLabels}
          />
        </section>
      ) : null}

      <section className="card mb-6 p-6">
        <h2 className="section-label mb-3">State vector</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-[11px] uppercase tracking-wider text-ink-muted">
              <th className="py-2 text-left font-bold">Basis state</th>
              <th className="py-2 text-right font-bold">Amplitude</th>
              <th className="py-2 text-right font-bold">Probability</th>
            </tr>
          </thead>
          <tbody>
            {shownRows.map((r) => (
              <tr key={r.i} className="border-b border-line last:border-0">
                <td className="py-2 font-mono text-q-violet-text">{formatKet(r.i, numQubits)}</td>
                <td className="py-2 text-right font-mono text-ink-secondary">
                  {formatComplex(r.amp)}
                </td>
                <td className="py-2 text-right text-ink-secondary">{pct(r.p)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {shownRows.length < rows.length ? (
          <p className="mt-3 text-[11px] text-ink-muted">
            Showing the first {shownRows.length} of {rows.length} basis states.
          </p>
        ) : null}
      </section>

      <Explainer title="Superposition is not “secretly one of them”">
        <p>
          The bars above are not a bookkeeping device for ignorance. The state is a genuine weighted
          sum of every basis state at once, and the weights — the amplitudes — are numbers that can
          be negative or complex, not just probabilities between 0 and 1.
        </p>
        <p>
          That is the whole difference. Two amplitudes of{' '}
          <span className="font-mono text-q-violet-text">+0.707</span> and{' '}
          <span className="font-mono text-q-violet-text">−0.707</span> can add up to zero. Two
          probabilities never can — probabilities only ever pile up. Cancellation is the thing a
          quantum computer has that a coin flip does not.
        </p>
      </Explainer>

      <Explainer title="Measurement picks one, and the rest is gone">
        <p>
          When you measure, outcome <span className="font-mono text-q-violet-text">i</span> appears with
          probability <span className="font-mono text-q-violet-text">|amplitude_i|²</span> — exactly the
          bar heights. Nothing about which one you get is stored anywhere beforehand.
        </p>
        <p>
          Afterwards the state <em>is</em> that outcome: one bar at 100%, everything else at zero.
          Press <strong>Measure once</strong> a few times in a row and feel how genuinely random each
          answer is, then press <strong>Run 1000 shots</strong> and watch the distribution the bars
          predicted assemble itself out of that randomness.
        </p>
      </Explainer>

      <Explainer title="Phase is invisible until it isn’t">
        <p>
          Turn on <strong>Show phase</strong>. Two states can have identical bars and completely
          different dials — apply Z or S to a qubit in superposition and the heights do not budge
          while the hands swing. No single measurement in the computational basis can tell those
          states apart — though a different basis can: apply H first and |+⟩ and |−⟩ separate
          deterministically.
        </p>
        <p>
          Now apply H twice to the same qubit. The first H splits |0⟩ into two equal amplitudes; the
          second one makes the |1⟩ contributions arrive with opposite signs, so they cancel and the
          state snaps back to |0⟩ with certainty. That cancellation is only possible because of the
          phase you could not measure — which is why every useful quantum algorithm spends its time
          arranging phases so that wrong answers cancel and right answers add.
        </p>
      </Explainer>
    </VizFrame>
  )
}
