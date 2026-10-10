'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import PhaseEstimationLab from '@/components/viz/PhaseEstimationLab'
import { VizFrame, Explainer } from '@/components/ui/VizFrame'
import { Segmented, ButtonRow, Stat, Slider, Toggle } from '@/components/ui/Controls'
import {
  MAX_COUNTING_QUBITS,
  analyticProbability,
  binaryFraction,
  circleDistance,
  confidenceOverhead,
  countingProbabilities,
  kickbackAngle,
  probabilityWithin,
  qpeEstimate,
  qpeStages,
  qubitsForPrecision,
} from '@/lib/viz/phaseEstimation'

const pct = (p: number) => `${(p * 100).toFixed(1)}%`

/** Phases worth having a button for: exactly representable, never representable, and famous. */
const PHASE_PRESETS: { value: string; label: string; phi: number; note: string }[] = [
  {
    value: 'quarter',
    label: '1/4',
    phi: 0.25,
    note: 'Exactly 0.01 in binary — two counting qubits already read it with certainty.',
  },
  {
    value: 'eleven-sixteenths',
    label: '11/16',
    phi: 11 / 16,
    note: 'Exactly 0.1011 in binary — certain from four qubits up, noisy below.',
  },
  {
    value: 'third',
    label: '1/3',
    phi: 1 / 3,
    note: '0.010101… forever. No number of qubits ever makes this exact, which is the normal case.',
  },
  {
    value: 'golden',
    label: '1/φ',
    phi: 0.6180339887498949,
    note: 'The golden ratio’s fractional part — irrational, so the peak always smears a little.',
  },
]

/** How many outcomes the probability table lists. */
const TABLE_ROWS = 6

export default function PhaseEstimationPage() {
  const [t, setT] = useState(5)
  const [preset, setPreset] = useState('third')
  const [customPhi, setCustomPhi] = useState(1 / 3)
  const [useCustom, setUseCustom] = useState(false)
  const [stage, setStage] = useState(0)
  const [targetBits, setTargetBits] = useState(4)
  const [epsilon, setEpsilon] = useState(0.1)

  const phi = useCustom ? customPhi : (PHASE_PRESETS.find((p) => p.value === preset)?.phi ?? 1 / 3)

  const stages = useMemo(() => qpeStages(t, phi), [t, phi])
  // Changing t changes how many stages there are, so the walkthrough restarts.
  // Changing φ deliberately does NOT: dragging the phase while parked on the
  // final stage is how the precision story is meant to be read, and snapping
  // back to stage 1 on every slider tick would make that impossible.
  useEffect(() => {
    setStage(0)
  }, [t])
  const safeStage = Math.min(stage, stages.length - 1)
  const current = stages[safeStage]

  const probabilities = useMemo(
    () => countingProbabilities(current.state, t),
    [current, t]
  )
  const appliedPowers = useMemo(
    () => stages.slice(0, safeStage + 1).filter((s) => s.id === 'kickback').length,
    [stages, safeStage]
  )

  const estimate = useMemo(() => qpeEstimate(t, phi), [t, phi])
  const dim = 1 << t
  const resolution = 1 / dim
  const atEnd = safeStage === stages.length - 1

  // The precision/confidence trade-off, computed from the closed form rather
  // than sampled — the numbers below are exact.
  const requiredQubits = qubitsForPrecision(targetBits, epsilon)
  const overhead = confidenceOverhead(epsilon)
  const achieved = probabilityWithin(t, phi, 2 ** -targetBits)

  const rows = useMemo(() => {
    const indexed = Array.from({ length: dim }, (_, y) => ({
      y,
      p: analyticProbability(t, phi, y),
    }))
    indexed.sort((a, b) => b.p - a.p)
    return indexed.slice(0, TABLE_ROWS)
  }, [dim, t, phi])

  /**
   * A slider rather than a segmented control: at t = 10 there are 13 stages, and
   * 13 buttons in a 300px rail wrap into five rows of unlabelled numbers. The
   * slider stays one row, arrow-keys through the circuit, and its readout names
   * the stage — which the numbers never did.
   */
  const stageLabel =
    current.id === 'kickback' ? `controlled-U^${2 ** (current.power ?? 0)}` : current.title

  const presetNote = PHASE_PRESETS.find((p) => p.value === preset)?.note ?? ''

  const controls = (
    <>
      <Slider
        label="Counting qubits t"
        value={t}
        min={2}
        max={MAX_COUNTING_QUBITS}
        step={1}
        onChange={(v) => setT(Math.round(v))}
        format={(v) => `${Math.round(v)} → ${1 << Math.round(v)} outcomes`}
        hint="Each qubit halves the spacing of the grid the answer is snapped to."
      />

      <Segmented
        label="Phase φ to estimate"
        value={preset}
        options={PHASE_PRESETS.map((p) => ({ value: p.value, label: p.label }))}
        onChange={(v) => {
          setPreset(v)
          setUseCustom(false)
        }}
      />

      <Toggle
        label="Set φ by hand instead"
        checked={useCustom}
        onChange={setUseCustom}
        hint="Drag it across a grid point and watch the peak split in two."
      />

      {useCustom ? (
        <Slider
          label="φ"
          value={customPhi}
          min={0}
          max={0.999}
          step={0.001}
          onChange={setCustomPhi}
          format={(v) => v.toFixed(3)}
        />
      ) : null}

      <Slider
        label="Stage"
        value={safeStage}
        min={0}
        max={stages.length - 1}
        step={1}
        onChange={(v) => setStage(Math.round(v))}
        format={() => `${safeStage + 1}/${stages.length} · ${stageLabel}`}
        hint="Arrow keys walk the circuit one gate layer at a time."
      />

      <ButtonRow>
        <button
          type="button"
          className="btn-primary focus-ring"
          onClick={() => setStage((s) => Math.min(s + 1, stages.length - 1))}
          disabled={atEnd}
        >
          Next stage
        </button>
        <button
          type="button"
          className="btn-ghost focus-ring"
          onClick={() => setStage((s) => Math.max(0, s - 1))}
          disabled={safeStage === 0}
        >
          Back
        </button>
        <button
          type="button"
          className="btn-ghost focus-ring"
          onClick={() => setStage(stages.length - 1)}
        >
          Run it
        </button>
      </ButtonRow>

      <div className="grid grid-cols-2 gap-2">
        <Stat label="True φ" value={phi.toFixed(6)} accent="teal" />
        <Stat label="Best estimate" value={estimate.phi.toFixed(6)} accent="amber" />
        <Stat label="Reads out as" value={binaryFraction(estimate.y, t)} accent="violet" />
        <Stat label="Resolution" value={`2⁻${t} = ${resolution.toFixed(6)}`} accent="sky" />
        <Stat label="P(best outcome)" value={pct(estimate.probability)} accent="amber" />
        <Stat label="P(within one bin)" value={pct(estimate.bracketProbability)} accent="teal" />
      </div>

      <p className="text-[11px] leading-relaxed text-ink-muted">
        {useCustom
          ? 'A φ set by hand almost never lands on the 2⁻ᵗ grid — which is why the peak has shoulders.'
          : presetNote}
      </p>
    </>
  )

  return (
    <VizFrame
      title="Quantum Phase Estimation"
      tagline="An eigenvalue you cannot measure, written into a register of qubits as a phase — then read back out as a binary number by running the Fourier transform backwards."
      level="Advanced"
      canvas={
        <div className="p-2">
          <PhaseEstimationLab
            t={t}
            phi={phi}
            appliedPowers={appliedPowers}
            probabilities={probabilities}
            caption={`${safeStage + 1}/${stages.length} · ${current.title}`}
            showTarget={atEnd}
          />
          <p className="px-3 pb-2 pt-1 text-[11px] leading-relaxed text-ink-muted">
            Top: one dial per counting qubit, turning by 2πφ·2ʲ as its controlled-U power runs.
            Bottom: what a measurement would give. Step through and notice the bottom panel does
            not move at all until the very last stage.
          </p>
        </div>
      }
      controls={controls}
    >
      <section className="card mb-4 p-6">
        <h2 className="mb-1 text-lg font-bold">
          Stage {safeStage + 1} of {stages.length}: {current.title}
        </h2>
        <p className="text-[15px] leading-relaxed text-ink-secondary">{current.detail}</p>
        {appliedPowers > 0 ? (
          <p className="mt-3 text-[13px] text-ink-muted">
            Counting qubit {appliedPowers - 1} now holds a relative phase of{' '}
            <span className="font-mono text-q-amber-text">
              {(kickbackAngle(phi, appliedPowers - 1) / (2 * Math.PI)).toFixed(4)}
            </span>{' '}
            of a full turn — that is 2<sup>{appliedPowers - 1}</sup>·φ with the whole turns thrown
            away, which is exactly what a phase can hold.
          </p>
        ) : null}
      </section>

      <Explainer title="What you are manipulating">
        <p>
          U here is the simplest operator with a phase to find: it multiplies |1⟩ by e<sup>2πiφ</sup>{' '}
          and leaves |0⟩ alone. The bottom qubit is prepared in that eigenstate and never changes
          again — U does nothing to it except put a number in front of it, and a number in front of
          a state is invisible to every measurement you can make on that state alone.
        </p>
        <p>
          So the phase is moved somewhere it can be read. Each counting qubit controls a different
          power of U: qubit 0 applies it once, qubit 1 twice, qubit 2 four times. Drag the qubit
          count and step through the stages. Watch the dials fan out — and watch the probability
          panel below them stay perfectly flat until the inverse QFT runs.
        </p>
      </Explainer>

      <Explainer title="Why the answer arrives in binary">
        <p>
          Controlled-U<sup>2ʲ</sup> leaves qubit j holding the phase 2π·2<sup>j</sup>φ, wrapped
          into one turn. Wrapping is not a loss here, it is the mechanism: qubit 0 holds φ itself,
          which pins down the coarsest bit; qubit {t - 1} holds 2<sup>{t - 1}</sup>φ, which for this
          φ has already gone {Math.floor(2 ** (t - 1) * (((phi % 1) + 1) % 1))} whole turns round
          and kept only what was left over — so a change in φ far too small to move qubit 0 moves
          that hand a long way. Coarse to fine, one qubit per binary place.
        </p>
        <p>
          Together the register holds Σ<sub>y</sub> e<sup>2πiφy</sup>|y⟩ — a phase ramp whose slope
          is 2<sup>t</sup>φ. That is precisely the state{' '}
          <Link href="/visualizations/qft" className="focus-ring text-q-teal-text underline">
            the quantum Fourier transform
          </Link>{' '}
          produces from |2<sup>t</sup>φ⟩, so running the transform backwards turns the ramp into
          that number. The QFT page shows the forward direction with every phase dial laid bare;
          this page is what feeds it.
        </p>
      </Explainer>

      <Explainer title="What just happened">
        <p>
          {estimate.exact ? (
            <>
              φ = {phi.toFixed(6)} is exactly {binaryFraction(estimate.y, t)} in binary, so 2
              <sup>{t}</sup>φ = {estimate.y} is an integer and the interference is perfect: one
              outcome takes {pct(estimate.probability)} of the probability and every other
              amplitude cancels exactly. One shot, one exact answer.
            </>
          ) : (
            <>
              φ = {phi.toFixed(6)} is not a multiple of 2<sup>−{t}</sup>, so there is no outcome
              that is right. The best available answer, {binaryFraction(estimate.y, t)} ={' '}
              {estimate.phi.toFixed(6)}, comes up {pct(estimate.probability)} of the time and the
              two outcomes straddling the true value take {pct(estimate.bracketProbability)}{' '}
              between them. The error is {estimate.error.toFixed(6)}, below the{' '}
              {resolution.toFixed(6)} the grid can resolve.
            </>
          )}
        </p>
        <p>
          The floor under that number is a theorem, not a measurement: the nearest outcome is
          measured with probability at least 4/π² ≈ 40.5%, and the two nearest together at least
          8/π² ≈ 81.1%, no matter what φ is or how many qubits you use. Drag φ across a grid point
          and watch a single spike split into two shoulders that still sum past that bound.
        </p>
      </Explainer>

      <section className="card mb-4 p-6">
        <h2 className="mb-1 text-lg font-bold">The most likely measurements</h2>
        <p className="mb-4 text-[13px] text-ink-secondary">
          Exact probabilities from the closed form sin²(πε)/(4ᵗ·sin²(πε/2ᵗ)), which the test suite
          pins the simulator against. ε is how far 2ᵗφ sits from that outcome.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">
              The {TABLE_ROWS} highest-probability outcomes of measuring the counting register for
              φ = {phi.toFixed(6)} with {t} counting qubits.
            </caption>
            <thead>
              <tr className="border-b border-line text-[11px] uppercase tracking-wider text-ink-muted">
                <th className="py-2 text-left font-bold" scope="col">
                  Measured y
                </th>
                <th className="py-2 text-right font-bold" scope="col">
                  Binary
                </th>
                <th className="py-2 text-right font-bold" scope="col">
                  y / 2<sup>t</sup>
                </th>
                <th className="py-2 text-right font-bold" scope="col">
                  Error
                </th>
                <th className="py-2 text-right font-bold" scope="col">
                  Probability
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.y}
                  className={`border-b border-line last:border-0 ${
                    row.y === estimate.y ? 'bg-q-amber/10' : ''
                  }`}
                >
                  <td className="py-2 font-mono text-q-violet-text">{row.y}</td>
                  <td className="py-2 text-right font-mono text-ink-muted">
                    {binaryFraction(row.y, t)}
                  </td>
                  <td className="py-2 text-right font-mono text-ink-secondary">
                    {(row.y / dim).toFixed(6)}
                  </td>
                  <td className="py-2 text-right font-mono text-ink-muted">
                    {circleDistance(row.y / dim, (((phi % 1) + 1) % 1)).toFixed(6)}
                  </td>
                  <td
                    className={`py-2 text-right font-mono ${
                      row.y === estimate.y ? 'text-q-amber-text' : 'text-ink-secondary'
                    }`}
                  >
                    {pct(row.p)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <Explainer title="Precision and confidence are bought separately">
        <p>
          Adding a counting qubit halves the spacing of the grid: t qubits resolve φ to 2
          <sup>−t</sup>, full stop. But being <em>near</em> the right answer most of the time and
          being near it <em>reliably</em> are different purchases, and the second one is
          surprisingly cheap.
        </p>

        <div className="my-4 rounded-lg border border-line bg-surface-2 p-4">
          <Slider
            label="Bits of φ you want"
            value={targetBits}
            min={1}
            max={16}
            step={1}
            onChange={(v) => setTargetBits(Math.round(v))}
            format={(v) => `${Math.round(v)} bits · accuracy 2⁻${Math.round(v)}`}
          />
          <Slider
            label="Failure probability you will accept"
            value={epsilon}
            min={0.001}
            max={0.5}
            step={0.001}
            onChange={setEpsilon}
            format={(v) => `${(v * 100).toFixed(1)}%`}
            hint="Ten times more confidence costs about 3 more qubits, not ten times as many."
          />
          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Stat label="Qubits for precision" value={`${targetBits}`} accent="sky" />
            <Stat label="Extra for confidence" value={`+${overhead}`} accent="amber" />
            <Stat label="Total t needed" value={`${requiredQubits}`} accent="teal" />
          </div>
          <p className="mt-3 text-center text-sm text-ink-secondary">
            t = n + ⌈log₂(2 + 1/2ε)⌉. At the {t} qubits set above, this run lands within 2
            <sup>−{targetBits}</sup> of φ{' '}
            <strong className="text-q-teal-text">{pct(achieved)}</strong> of the time.
          </p>
        </div>

        <p>
          The second term does not improve the answer at all — it only makes the good answer more
          likely, and it grows logarithmically in the confidence you demand. That asymmetry is why
          phase estimation is usable in practice: you pay linearly for the digits you need and
          almost nothing for certainty about them.
        </p>
      </Explainer>

      <Explainer title="Where this sits in the arc">
        <p>
          <Link href="/visualizations/qft" className="focus-ring text-q-teal-text underline">
            The quantum Fourier transform
          </Link>{' '}
          on its own computes nothing you can read — it turns a number into a phase ramp whose
          amplitudes are all the same size. Phase estimation is the missing half: it builds a ramp
          out of something you actually want to know, an eigenvalue, and then uses the inverse
          transform to convert it back into a number a measurement can return.
        </p>
        <p>
          <Link href="/visualizations/shor" className="focus-ring text-q-teal-text underline">
            Shor&rsquo;s algorithm
          </Link>{' '}
          is this page with one substitution. Take U to be multiplication by a modulo N. Its
          eigenvalues are e<sup>2πi·s/r</sup>, where r is the period you are hunting, so estimating
          the phase gives you s/r — and the continued-fraction step on Shor&rsquo;s page is what
          pulls r out of that fraction. The counting register there is sized 2
          <sup>t</sup> ≥ N² for exactly the reason this page&rsquo;s precision slider shows:
          without enough bits, two different periods produce estimates you cannot tell apart.
        </p>
        <p>
          The same machine turns up wherever a physical quantity is an eigenvalue. Estimating
          molecular ground-state energies is phase estimation on the time-evolution operator
          e<sup>−iHt</sup>, which is why{' '}
          <Link href="/visualizations/vqe" className="focus-ring text-q-teal-text underline">
            VQE
          </Link>{' '}
          exists at all: QPE needs far more coherent gates than today&rsquo;s hardware can hold, so
          the variational method trades the guarantee for a circuit that fits.
        </p>
      </Explainer>

      <Explainer title="What this simulation does not show">
        <p>
          U is a single-qubit phase gate here, so controlled-U<sup>2ʲ</sup> is one gate no matter
          how large the exponent is. That is a genuine special case. For the U inside Shor&rsquo;s
          algorithm, controlled-U<sup>2ʲ</sup> is modular exponentiation — a large arithmetic
          circuit that has to be compiled, and where nearly all the real cost of the algorithm
          lives. The structure of phase estimation is identical; the price of each stage is not.
        </p>
        <p>
          Everything on this page is a real statevector on t + 1 qubits, transformed by an actual
          Hadamard-and-controlled-phase inverse QFT circuit, which is why t stops at{' '}
          {MAX_COUNTING_QUBITS}. The probabilities in the table come from the closed-form
          distribution instead, and the test suite checks the two agree to nine decimal places —
          if they ever stop agreeing, one of them is wrong and the page should not be trusted until
          it is fixed.
        </p>
      </Explainer>
    </VizFrame>
  )
}
