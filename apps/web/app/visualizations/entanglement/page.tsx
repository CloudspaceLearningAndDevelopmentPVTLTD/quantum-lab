'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import EntanglementLab from '@/components/viz/EntanglementLab'
import StateAsMatrix from '@/components/viz/StateAsMatrix'
import { VizFrame, Explainer } from '@/components/ui/VizFrame'
import { Slider, Segmented, Toggle, ButtonRow, Stat } from '@/components/ui/Controls'
import { Histogram, HistogramTable } from '@/components/ui/Histogram'
import type { HistogramDatum } from '@/components/ui/Histogram'
import { StateVector, simulate, formatKet } from '@/lib/quantum'
import type { Circuit } from '@/lib/quantum'

type Preparation = 'product' | 'bell' | 'partial'

const PREP_OPTIONS: { value: Preparation; label: string }[] = [
  { value: 'product', label: 'Product state' },
  { value: 'bell', label: 'Bell state Φ+' },
  { value: 'partial', label: 'Partially entangled' },
]

const PAIRS = 500
const JOINT_KEYS = ['00', '01', '10', '11'] as const

function circuitFor(prep: Preparation, theta: number): Circuit {
  switch (prep) {
    case 'product':
      // H on each qubit separately: |+⟩⊗|+⟩, so all four outcomes are equally
      // likely and the qubits stay independent. (H on qubit 0 alone would pin
      // B to |0⟩ and only ever show |00⟩ and |10⟩.)
      return {
        numQubits: 2,
        ops: [
          { name: 'H', qubits: [0] },
          { name: 'H', qubits: [1] },
        ],
      }
    case 'bell':
      return { numQubits: 2, ops: [{ name: 'H', qubits: [0] }, { name: 'CX', qubits: [0, 1] }] }
    case 'partial':
      return {
        numQubits: 2,
        ops: [
          { name: 'RY', qubits: [0], theta },
          { name: 'CX', qubits: [0, 1] },
        ],
      }
  }
}

const formatPi = (v: number) => `${(v / Math.PI).toFixed(2)}π`
const pct = (p: number) => `${(p * 100).toFixed(1)}%`

export default function EntanglementPage() {
  const [preparation, setPreparation] = useState<Preparation>('bell')
  const [theta, setTheta] = useState(Math.PI / 2)
  const [live, setLive] = useState<StateVector>(() => simulate(circuitFor('bell', Math.PI / 2)))
  const [measuredA, setMeasuredA] = useState<0 | 1 | null>(null)
  const [measuredB, setMeasuredB] = useState<0 | 1 | null>(null)
  const [tally, setTally] = useState<Record<string, number> | null>(null)
  const [asTable, setAsTable] = useState(false)

  const circuit = useMemo(() => circuitFor(preparation, theta), [preparation, theta])
  const ideal = useMemo(() => simulate(circuit), [circuit])

  /** Rebuild the working state from the current circuit and clear collapses. */
  const prepare = useCallback(() => {
    setLive(simulate(circuit))
    setMeasuredA(null)
    setMeasuredB(null)
  }, [circuit])

  // Re-prepare whenever the circuit definition changes (preparation or θ).
  useEffect(() => {
    prepare()
  }, [prepare])

  const measure = (q: 0 | 1) => {
    const next = live.clone()
    const bit = next.measureQubit(q)
    if (q === 0) setMeasuredA(bit)
    else setMeasuredB(bit)
    setLive(next)
  }

  const runPairs = () => {
    const counts: Record<string, number> = { '00': 0, '01': 0, '10': 0, '11': 0 }
    for (let i = 0; i < PAIRS; i++) {
      const sv = simulate(circuit)
      const a = sv.measureQubit(0)
      const b = sv.measureQubit(1)
      const key = `${b}${a}`
      counts[key] = (counts[key] ?? 0) + 1
    }
    setTally(counts)
  }

  const reset = () => {
    setTally(null)
    prepare()
  }

  const entropy = live.entanglementEntropy(0)

  const correlation = useMemo(() => {
    if (!tally) return null
    const p = (k: string) => (tally[k] ?? 0) / PAIRS
    return p('00') + p('11') - (p('01') + p('10'))
  }, [tally])

  const histData: HistogramDatum[] = useMemo(
    () => (tally ? JOINT_KEYS.map((k) => ({ label: k, value: tally[k] ?? 0 })) : []),
    [tally]
  )

  const highlight = useMemo(
    () =>
      ideal
        .probabilities()
        .map((prob, i) => ({ prob, label: ideal.label(i) }))
        .filter((d) => d.prob > 1e-9)
        .map((d) => d.label),
    [ideal]
  )

  const controls = (
    <>
      <Segmented<Preparation>
        label="Preparation"
        value={preparation}
        options={PREP_OPTIONS}
        onChange={setPreparation}
      />

      {preparation === 'partial' ? (
        <Slider
          label="θ"
          value={theta}
          min={0}
          max={Math.PI}
          step={0.01}
          format={formatPi}
          onChange={setTheta}
          hint="θ = π/2 gives maximum entanglement."
        />
      ) : null}

      <ButtonRow>
        <button
          type="button"
          className="btn-primary focus-ring"
          onClick={() => measure(0)}
          disabled={measuredA !== null}
        >
          Measure A
        </button>
        <button
          type="button"
          className="btn-primary focus-ring"
          onClick={() => measure(1)}
          disabled={measuredB !== null}
        >
          Measure B
        </button>
        <button type="button" className="btn-ghost focus-ring" onClick={reset}>
          Reset
        </button>
      </ButtonRow>

      <ButtonRow>
        <button type="button" className="btn-ghost focus-ring" onClick={runPairs}>
          Run {PAIRS} pairs
        </button>
      </ButtonRow>

      <div className="grid grid-cols-2 gap-2">
        <Stat label="Entanglement" value={`${entropy.toFixed(2)} bits`} accent="teal" />
        <Stat label="Correlation" value={correlation === null ? '—' : correlation.toFixed(2)} accent="amber" />
        <Stat label="P(A=1)" value={pct(live.qubitProbability(0))} accent="violet" />
        <Stat label="P(B=1)" value={pct(live.qubitProbability(1))} accent="sky" />
      </div>
    </>
  )

  return (
    <VizFrame
      title="Entanglement"
      tagline="Two qubits, one shared state — and results that match more often than any independent pair could."
      level="Intermediate"
      canvas={
        <div className="p-2">
          <EntanglementLab state={live} measuredA={measuredA} measuredB={measuredB} />
          <p className="px-3 pb-2 pt-1 text-[11px] text-ink-muted">
            Measure one orb and watch the other. The beam between them is the entanglement.
          </p>
        </div>
      }
      controls={controls}
    >
      {tally ? (
        <div className="card mb-6 p-6">
          {asTable ? (
            <>
              <h2 className="mb-4 text-[13px] font-semibold text-ink-secondary">
                Joint outcomes over {PAIRS} pairs
              </h2>
              <HistogramTable data={histData} total={PAIRS} />
            </>
          ) : (
            <Histogram
              title={`Joint outcomes over ${PAIRS} pairs`}
              data={histData}
              total={PAIRS}
              unit="pairs"
              highlight={highlight}
            />
          )}
          <div className="mt-4">
            <Toggle
              label="Show as a table"
              checked={asTable}
              onChange={setAsTable}
              hint="Same numbers, no colour needed."
            />
          </div>
        </div>
      ) : null}

      <div className="mb-6">
        <h2 className="section-label mb-2">State amplitudes</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-[11px] uppercase tracking-wider text-ink-muted">
              <th className="py-2 text-left font-bold">Basis state</th>
              <th className="py-2 text-right font-bold">Probability</th>
            </tr>
          </thead>
          <tbody>
            {live.probabilities().map((p, i) => (
              <tr key={i} className="border-b border-line last:border-0">
                <td className="py-2 font-mono text-q-violet-text">{formatKet(i, live.numQubits)}</td>
                <td className="py-2 text-right text-ink-secondary">{pct(p)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <StateAsMatrix state={live} />

      <Explainer title="Correlated, not connected">
        <p>
          For the Bell state you only ever see 00 or 11. Yet look at P(A=1) on its own: it is 50%, a
          perfectly fair coin. Nothing about A alone reveals that B exists.
        </p>
        <p>
          That is why entanglement cannot send a message: the correlation is only visible once the
          two result lists are brought together and compared.
        </p>
      </Explainer>

      <Explainer title="Entropy measures how entangled">
        <p>
          A single qubit pulled out of an entangled pair has no state of its own. Its Bloch vector
          shrinks to zero length and its entropy rises to 1 bit.
        </p>
        <p>
          Drag θ on the partial preparation and watch the number sweep from 0 to 1 and back.
        </p>
      </Explainer>

      <Explainer title="Why the product state is different">
        <p>
          With H on each qubit separately, the two qubits are independent — all four outcomes
          appear equally, and knowing A tells you nothing about B. The link goes dark, and the
          joint outcomes spread across all four possibilities instead of two. Compare the
          histograms.
        </p>
      </Explainer>

      <Explainer title="Matching outcomes are not yet proof">
        <p>
          Everything above measures both qubits along the same axis, and a pair of gloves posted to
          opposite ends of the country would pass that test too — always matching, nothing spooky.
          The step that rules the gloves out is to measure the two halves along <em>different</em>{' '}
          axes, combine four such correlations into one number S, and check it against the ceiling
          that any pre-agreed plan is arithmetically stuck below.
        </p>
        <p>
          <Link
            href="/visualizations/bell-test"
            className="focus-ring text-q-teal-text underline decoration-q-teal/40 underline-offset-2"
          >
            The Bell Test
          </Link>{' '}
          runs that experiment: it races this entangled source against a real local hidden-variable
          simulation over the same trials, and you can watch the classical rival stall at exactly 2
          while the quantum one keeps climbing to 2√2.
        </p>
      </Explainer>
    </VizFrame>
  )
}
