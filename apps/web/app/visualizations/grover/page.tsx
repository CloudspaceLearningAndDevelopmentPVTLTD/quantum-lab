'use client'

import { useEffect, useMemo, useState } from 'react'
import GroverLab from '@/components/viz/GroverLab'
import { VizFrame, Explainer } from '@/components/ui/VizFrame'
import { Segmented, ButtonRow, Stat, Slider } from '@/components/ui/Controls'
import { Histogram } from '@/components/ui/Histogram'
import type { HistogramDatum } from '@/components/ui/Histogram'
import { StateVector, formatKet } from '@/lib/quantum'

type QubitCount = '2' | '3'

/**
 * Format a count for display: plain integers up to 999,999, then scientific
 * notation. The point of this section is the CROSSOVER — N/2 classical checks
 * vs the ⌊(π/4)√N⌋ Grover formula this same page already uses for the live
 * 2-3 qubit demo above — so the numbers have to stay readable out past a
 * billion, where the gap actually becomes dramatic, not just at toy sizes.
 */
export function formatCount(n: number): string {
  if (n < 1_000_000) return Math.round(n).toLocaleString('en-US')
  return n.toExponential(2).replace('e+', ' × 10^')
}

/**
 * QuantumAdvantageScale — the same √N vs N/2 formula the live demo above uses
 * at 2-3 qubits, extended out to realistic search-space sizes with a slider.
 * Deliberately NOT a claim about wall-clock time or real hardware speed —
 * this platform runs a classical statevector simulator, so a "Grover ran in X
 * seconds" claim here would be fabricated. What IS real and worth showing:
 * the QUERY COUNT gap is a mathematical fact about the algorithm, provable
 * and checkable at small N against the interactive demo above, and it is the
 * actual basis for every real quantum-advantage claim in the literature.
 */
function QuantumAdvantageScale() {
  const [log2N, setLog2N] = useState(20)
  const n = Math.pow(2, log2N)
  const classicalWorst = n
  const classicalAvg = n / 2
  const quantum = Math.floor((Math.PI / 4) * Math.sqrt(n))
  const speedup = classicalAvg / quantum

  return (
    <Explainer title="Quantum advantage at scale">
      <p>
        The 2-3 qubit demo above is small enough to watch step by step, but the formula
        driving it — ⌊(π/4)√N⌋ Grover iterations against up to N classical checks — holds at
        any size. Drag the slider to see where the gap actually becomes dramatic.
      </p>

      <div className="my-4 rounded-lg border border-line bg-surface-2 p-4">
        <Slider
          label="Search space size"
          value={log2N}
          min={4}
          max={50}
          step={1}
          onChange={setLog2N}
          format={() => `2^${log2N} = ${formatCount(n)} items`}
          hint="A real search problem this size — 2^50 is roughly a petabyte of individually-checkable records."
        />

        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Stat label="Classical (worst case)" value={formatCount(classicalWorst)} accent="rose" />
          <Stat label="Classical (average)" value={formatCount(classicalAvg)} accent="sky" />
          <Stat label="Grover (this algorithm)" value={formatCount(quantum)} accent="teal" />
        </div>

        <p className="mt-3 text-center text-sm text-ink-secondary">
          <strong className="text-q-teal-text">{formatCount(speedup)}×</strong> fewer queries
          than an average-case classical search, at this size.
        </p>
      </div>

      <p>
        This is a query-count comparison, not a wall-clock benchmark — Qubit16&rsquo;s simulator
        runs on an ordinary CPU, so it cannot demonstrate real quantum hardware speed, and no
        page on this site claims it does. What the formula above describes is the actual,
        provable basis for Grover&rsquo;s speedup: the quadratic gap between N and √N is a
        mathematical property of the algorithm, not a hardware claim, and you can verify it
        yourself at small N by counting the steps in the live demo above.
      </p>
    </Explainer>
  )
}

const QUBIT_OPTIONS: { value: QubitCount; label: string }[] = [
  { value: '2', label: '2 qubits · 4 items' },
  { value: '3', label: '3 qubits · 8 items' },
]

/** Multi-controlled Z across all n qubits: controls 0..n-2, target n-1. */
function multiControlledZ(sv: StateVector, n: number): void {
  if (n === 1) {
    sv.applySingle('Z', 0)
    return
  }
  const controls = Array.from({ length: n - 1 }, (_, i) => i)
  sv.applyControlled('Z', controls, n - 1)
}

/** Phase-flip the marked basis state and nothing else. */
function oracle(sv: StateVector, n: number, marked: number): void {
  for (let q = 0; q < n; q++) if (((marked >> q) & 1) === 0) sv.applySingle('X', q)
  multiControlledZ(sv, n)
  for (let q = 0; q < n; q++) if (((marked >> q) & 1) === 0) sv.applySingle('X', q)
}

/** Grover diffusion: reflect every amplitude about their mean. */
function diffusion(sv: StateVector, n: number): void {
  for (let q = 0; q < n; q++) sv.applySingle('H', q)
  for (let q = 0; q < n; q++) sv.applySingle('X', q)
  multiControlledZ(sv, n)
  for (let q = 0; q < n; q++) sv.applySingle('X', q)
  for (let q = 0; q < n; q++) sv.applySingle('H', q)
  // The gate sequence H·X·MCZ·X·H implements I − 2|s⟩⟨s|, which is the
  // NEGATIVE of the reflection about the mean, 2|s⟩⟨s| − I. The two differ
  // only by a global phase, so probabilities are identical either way — but
  // this page draws SIGNED amplitudes, and the copy promises the marked bar
  // is "thrown far above" the mean. Without this sign flip the marked bar
  // plunges negative instead. Negate every (re, im) entry so the picture
  // matches the textbook reflection.
  for (let i = 0; i < sv.data.length; i++) sv.data[i] = -sv.data[i]
}

/**
 * Rebuild the state from scratch for the given step.
 * step 0 = initialised; odd steps end after an oracle, even steps after a diffusion.
 */
function groverStateAt(n: number, marked: number, step: number): StateVector {
  const sv = new StateVector(n)
  for (let q = 0; q < n; q++) sv.applySingle('H', q)
  for (let s = 1; s <= step; s++) {
    if (s % 2 === 1) oracle(sv, n, marked)
    else diffusion(sv, n)
  }
  return sv
}

function phaseLabel(n: number, marked: number, step: number): string {
  if (step === 0) return 'initialised: equal superposition over every candidate'
  if (step % 2 === 1) return `oracle: flipping the sign of ${formatKet(marked, n)}`
  return 'diffusion: reflecting every amplitude about the mean'
}

const pct = (p: number) => `${(p * 100).toFixed(1)}%`

export default function GroverPage() {
  const [qubitChoice, setQubitChoice] = useState<QubitCount>('2')
  const [marked, setMarked] = useState(3)
  const [step, setStep] = useState(0)

  const numQubits = qubitChoice === '2' ? 2 : 3
  const dim = 1 << numQubits
  const optimal = Math.floor((Math.PI / 4) * Math.sqrt(2 ** numQubits))

  // Keep the marked state inside range when the qubit count shrinks.
  useEffect(() => {
    setMarked((m) => (m < dim ? m : dim - 1))
    setStep(0)
  }, [dim])

  const state = useMemo(
    () => groverStateAt(numQubits, Math.min(marked, dim - 1), step),
    [numQubits, marked, dim, step]
  )

  const markedIndex = Math.min(marked, dim - 1)
  const phase = phaseLabel(numQubits, markedIndex, step)
  const iteration = Math.floor(step / 2)
  const markedProb = state.probability(markedIndex)

  const markedOptions = useMemo(
    () =>
      Array.from({ length: dim }, (_, i) => ({
        value: String(i),
        label: formatKet(i, numQubits),
      })),
    [dim, numQubits]
  )

  const histData: HistogramDatum[] = useMemo(
    () =>
      state.probabilities().map((p, i) => ({
        label: state.label(i),
        value: Math.round(p * 1000),
      })),
    [state]
  )

  const controls = (
    <>
      <Segmented<QubitCount>
        label="Search space"
        value={qubitChoice}
        options={QUBIT_OPTIONS}
        onChange={setQubitChoice}
      />

      <Segmented
        label="Marked item"
        value={String(markedIndex)}
        options={markedOptions}
        onChange={(v) => {
          setMarked(parseInt(v, 10))
          setStep(0)
        }}
      />

      <ButtonRow>
        <button type="button" className="btn-primary focus-ring" onClick={() => setStep((s) => s + 1)}>
          Step
        </button>
        <button
          type="button"
          className="btn-ghost focus-ring"
          onClick={() => setStep(optimal * 2)}
        >
          Run to optimum
        </button>
        <button type="button" className="btn-ghost focus-ring" onClick={() => setStep(0)}>
          Reset
        </button>
      </ButtonRow>

      <div className="grid grid-cols-2 gap-2">
        <Stat label="P(marked)" value={pct(markedProb)} accent="teal" />
        <Stat label="Iteration" value={`${iteration}`} accent="violet" />
        <Stat label="Optimal" value={`${optimal}`} accent="amber" />
        <Stat label="Classical avg" value={`${dim / 2} checks`} accent="sky" />
      </div>
    </>
  )

  return (
    <VizFrame
      title="Grover's Search"
      tagline="Find one item in an unsorted list of N in about √N steps — by making the wrong answers cancel each other out."
      level="Intermediate"
      canvas={
        <div className="p-2">
          <GroverLab state={state} marked={markedIndex} phase={phase} />
          <p className="px-3 pb-2 pt-1 text-[11px] text-ink-muted">
            Bars are amplitudes, not probabilities — they can go negative. The dashed amber line is
            the mean the diffusion step reflects about.
          </p>
        </div>
      }
      controls={controls}
    >
      <div className="card mb-6 p-6">
        <Histogram
          title="Measurement probabilities right now"
          data={histData}
          total={1000}
          unit="per 1000 shots"
          highlight={[state.label(markedIndex)]}
        />
      </div>

      <Explainer title="Searching without looking">
        <p>
          An unsorted list of N items takes about N/2 checks classically: there is nothing to
          exploit, so you look at entries one at a time until one matches. Grover finds the marked
          item in roughly √N steps instead — for a million items, about a thousand.
        </p>
        <p>
          It does not do this by being clever about the list. It does it by putting every candidate
          into superposition at once and then arranging for the wrong answers to interfere
          destructively while the right one survives.
        </p>
      </Explainer>

      <Explainer title="The two moves">
        <p>
          The oracle flips the <em>sign</em> of the marked amplitude. Press Step once and watch: the
          marked bar goes negative, and nothing gets taller. Measured at that moment, the state is
          exactly as useless as it was before — every outcome is still equally likely.
        </p>
        <p>
          The diffusion step then reflects every amplitude about their mean. Because the marked
          amplitude sits far below the mean, reflecting it throws it far above. Step through and
          watch the amber mean line: after the sign flip the mean drops slightly, and the reflection
          converts that asymmetry into height on exactly one bar.
        </p>
      </Explainer>

      <Explainer title="Why you can overshoot">
        <p>
          Keep pressing Step past the optimum and the probability of the marked state goes back{' '}
          <em>down</em>. Grover is a rotation in a two-dimensional plane — one axis is the marked
          state, the other is everything else — and each iteration turns the state by a fixed angle
          toward the answer.
        </p>
        <p>
          Run it too long and you rotate straight past. That is why the iteration count matters, and
          why the optimal number is ⌊(π/4)√N⌋ = {optimal} here rather than &ldquo;as many as you can
          afford&rdquo;.
        </p>
      </Explainer>

      <QuantumAdvantageScale />
    </VizFrame>
  )
}
