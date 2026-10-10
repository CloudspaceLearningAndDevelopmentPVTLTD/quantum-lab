'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { lazyViz } from '@/components/viz/LazyViz'
import { DensityMatrixView } from '@/components/viz/DensityMatrixView'
import { VizFrame, Explainer } from '@/components/ui/VizFrame'
import { Segmented, ButtonRow, Slider, Stat } from '@/components/ui/Controls'
import { StateVector } from '@/lib/quantum'
import {
  blochState,
  blochVector,
  densityFromState,
  dephase,
  mixture,
  pairState,
  partialTrace,
  pauliMeasurement,
  purity,
  qubitEntropyBits,
  trace,
  type DensityMatrix,
  type PairPreset,
  type PauliBasis,
} from '@/lib/quantum/densityMatrix'

/**
 * /visualizations/density-matrix — mixed states, named.
 *
 * The decoherence page shows the Bloch arrow retracting into the sphere. This
 * page puts the object that arrow is a picture of — ρ — on screen as numbers
 * beside the same ball, and walks through the three things students most
 * often fail to connect: purity is the arrow's length, a 50/50 mixture and a
 * 50/50 superposition are different states with the same z statistics, and
 * one half of an entangled pair is mixed even though the pair is pure.
 *
 * Every number here comes from lib/quantum/densityMatrix.ts, whose tests pin
 * Tr ρ = 1, Hermiticity, Tr ρ² ∈ {1, ½}, Tr_B(Bell) = I/2 and |r| = √(2 Tr ρ² − 1)
 * against hand-derived values. The states themselves are built with the same
 * gate engine as the circuit simulator.
 */

// Same three.js ball the decoherence page uses; deferred for the same reason
// (see the MEASURED note in app/visualizations/decoherence/page.tsx).
const DecoherenceLab = lazyViz<{
  x: number
  y: number
  z: number
  purity: number
  className?: string
}>(() => import('@/components/viz/DecoherenceLab'))

type Scene = 'build' | 'compare' | 'trace'

const SCENES: { value: Scene; label: string }[] = [
  { value: 'build', label: 'Pure → mixed' },
  { value: 'compare', label: 'Mixture vs superposition' },
  { value: 'trace', label: 'Partial trace' },
]

const PAIR_OPTIONS: { value: PairPreset; label: string }[] = [
  { value: 'phi-plus', label: 'Bell Φ⁺' },
  { value: 'psi-minus', label: 'Bell Ψ⁻' },
  { value: 'product', label: '|+⟩|0⟩' },
  { value: 'tunable', label: 'cos α|00⟩ + sin α|11⟩' },
]

const BASIS_OPTIONS: { value: PauliBasis; label: string }[] = [
  { value: 'z', label: 'Z (|0⟩,|1⟩)' },
  { value: 'x', label: 'X (|+⟩,|−⟩)' },
  { value: 'y', label: 'Y (|i⟩,|−i⟩)' },
]

const formatPi = (v: number) => `${(v / Math.PI).toFixed(2)}π`
const pct = (p: number) => `${(p * 100).toFixed(1)}%`
const f3 = (v: number) => v.toFixed(3)

/** The four numbers the page repeats for every single-qubit ρ. */
function QubitStats({ m, label }: { m: DensityMatrix; label?: string }) {
  const p = purity(m)
  const r = blochVector(m)
  const len = Math.hypot(...r)
  return (
    <div className="grid grid-cols-2 gap-2" role="group" aria-label={label ?? 'Density matrix readouts'}>
      <Stat label="Tr ρ" value={f3(trace(m).re)} accent="sky" />
      <Stat label="Purity Tr ρ²" value={f3(p)} accent="rose" />
      <Stat label="|r| = √(2Trρ² − 1)" value={f3(len)} accent="violet" />
      <Stat label="Entropy S(ρ)" value={`${f3(qubitEntropyBits(m))} bit`} accent="teal" />
    </div>
  )
}

function CoinFlipMixture(): DensityMatrix {
  return mixture([
    { weight: 1, state: new StateVector(1) },
    { weight: 1, state: new StateVector(1).applySingle('X', 0) },
  ])
}

export default function DensityMatrixPage() {
  const [scene, setScene] = useState<Scene>('build')

  // Scene 1 — build a pure state, then dephase it.
  const [theta, setTheta] = useState(Math.PI / 2)
  const [phi, setPhi] = useState(Math.PI / 4)
  const [lambda, setLambda] = useState(0)

  // Scene 2 — superposition phase, measurement basis, which state the ball shows.
  const [superPhi, setSuperPhi] = useState(0)
  const [basis, setBasis] = useState<PauliBasis>('z')
  const [ballShows, setBallShows] = useState<'superposition' | 'mixture'>('superposition')

  // Scene 3 — the pair, the tunable angle, and which half to discard.
  const [pair, setPair] = useState<PairPreset>('phi-plus')
  const [alpha, setAlpha] = useState(Math.PI / 4)
  const [discard, setDiscard] = useState<'0' | '1'>('1')

  const built = useMemo(() => dephase(densityFromState(blochState(theta, phi)), lambda), [theta, phi, lambda])

  const superposition = useMemo(() => densityFromState(blochState(Math.PI / 2, superPhi)), [superPhi])
  const coinFlip = useMemo(CoinFlipMixture, [])
  const superStats = useMemo(() => pauliMeasurement(superposition, basis), [superposition, basis])
  const mixStats = useMemo(() => pauliMeasurement(coinFlip, basis), [coinFlip, basis])

  const whole = useMemo(() => densityFromState(pairState(pair, alpha)), [pair, alpha])
  const part = useMemo(() => partialTrace(whole, [discard === '0' ? 0 : 1]), [whole, discard])
  const keptQubit = discard === '0' ? 1 : 0

  // Whatever the ball shows this scene.
  const shown: DensityMatrix =
    scene === 'build' ? built : scene === 'compare' ? (ballShows === 'superposition' ? superposition : coinFlip) : part
  const [bx, by, bz] = blochVector(shown)
  const shownPurity = purity(shown)

  const controls = (
    <>
      <Segmented<Scene> label="Scene" value={scene} options={SCENES} onChange={setScene} />

      {scene === 'build' ? (
        <>
          <Slider label="θ (polar angle)" value={theta} min={0} max={Math.PI} step={0.01} format={formatPi} onChange={setTheta} />
          <Slider label="φ (phase)" value={phi} min={0} max={2 * Math.PI} step={0.01} format={formatPi} onChange={setPhi} />
          <Slider
            label="Coherence lost, λ"
            value={lambda}
            min={0}
            max={1}
            step={0.01}
            format={(v) => `${(v * 100).toFixed(0)}%`}
            onChange={setLambda}
            hint="Multiplies the off-diagonal entries by 1 − λ and leaves the diagonal alone. 100% is a complete dephasing."
          />
          <ButtonRow>
            <button
              type="button"
              className="btn-ghost focus-ring"
              onClick={() => {
                setTheta(Math.PI / 2)
                setPhi(0)
                setLambda(0)
              }}
            >
              |+⟩
            </button>
            <button
              type="button"
              className="btn-ghost focus-ring"
              onClick={() => {
                setTheta(Math.PI / 2)
                setPhi(0)
                setLambda(1)
              }}
            >
              |+⟩, fully dephased
            </button>
            <button
              type="button"
              className="btn-ghost focus-ring"
              onClick={() => {
                setTheta(Math.PI / 3)
                setPhi(Math.PI / 4)
                setLambda(0.5)
              }}
            >
              Half-way
            </button>
          </ButtonRow>
          <QubitStats m={built} />
        </>
      ) : null}

      {scene === 'compare' ? (
        <>
          <Slider
            label="Superposition phase φ"
            value={superPhi}
            min={0}
            max={2 * Math.PI}
            step={0.01}
            format={formatPi}
            onChange={setSuperPhi}
            hint="The pure state is (|0⟩ + e^(iφ)|1⟩)/√2. The mixture is 50% |0⟩, 50% |1⟩ and has no phase to set."
          />
          <Segmented<PauliBasis> label="Measure along" value={basis} options={BASIS_OPTIONS} onChange={setBasis} />
          <Segmented<'superposition' | 'mixture'>
            label="Ball shows"
            value={ballShows}
            options={[
              { value: 'superposition', label: 'Superposition' },
              { value: 'mixture', label: 'Mixture' },
            ]}
            onChange={setBallShows}
          />
          <div className="grid grid-cols-2 gap-2" role="group" aria-label="Measurement outcome probabilities">
            <Stat label={`Superposition P(+${basis})`} value={pct(superStats.plus)} accent="violet" />
            <Stat label={`Mixture P(+${basis})`} value={pct(mixStats.plus)} accent="rose" />
            <Stat label="Superposition Tr ρ²" value={f3(purity(superposition))} accent="violet" />
            <Stat label="Mixture Tr ρ²" value={f3(purity(coinFlip))} accent="rose" />
          </div>
        </>
      ) : null}

      {scene === 'trace' ? (
        <>
          <Segmented<PairPreset> label="Two-qubit state" value={pair} options={PAIR_OPTIONS} onChange={setPair} />
          {pair === 'tunable' ? (
            <Slider
              label="α"
              value={alpha}
              min={0}
              max={Math.PI / 2}
              step={0.01}
              format={formatPi}
              onChange={setAlpha}
              hint="0 is the product state |00⟩; π/4 is the Bell state Φ⁺; π/2 is |11⟩."
            />
          ) : null}
          <Segmented<'0' | '1'>
            label="Trace out"
            value={discard}
            options={[
              { value: '1', label: 'qubit 1 (keep 0)' },
              { value: '0', label: 'qubit 0 (keep 1)' },
            ]}
            onChange={setDiscard}
          />
          <div className="grid grid-cols-2 gap-2" role="group" aria-label="Whole versus part">
            <Stat label="Whole: Tr ρ²" value={f3(purity(whole))} accent="sky" />
            <Stat label={`Part (qubit ${keptQubit}): Tr ρ²`} value={f3(purity(part))} accent="rose" />
            <Stat label="Part: |r|" value={f3(Math.hypot(bx, by, bz))} accent="violet" />
            <Stat label="Part: entropy" value={`${f3(qubitEntropyBits(part))} bit`} accent="teal" />
          </div>
        </>
      ) : null}
    </>
  )

  const canvasCaption =
    scene === 'build'
      ? 'The arrow is the Bloch vector of ρ. Slide λ up and watch the teal off-diagonal cells fade while the arrow sinks toward the z axis — the diagonal never changes, so neither does P(0).'
      : scene === 'compare'
        ? 'Two density matrices with the same diagonal. Only one of them has anything off the diagonal, and only that one has an arrow that reaches the surface.'
        : 'Left: the whole pair, pure. Right: what is left after you throw one qubit away. For a Bell state the arrow vanishes into the centre.'

  return (
    <VizFrame
      title="Mixed States and the Density Matrix"
      tagline="A qubit you are not sure about is not a shorter arrow by analogy. It is a matrix, the arrow is its length, and one half of an entangled pair is the most uncertain qubit there is."
      level="Advanced"
      canvas={
        <div className="p-2">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <DecoherenceLab x={bx} y={by} z={bz} purity={shownPurity} />
            <div className="flex flex-col justify-center gap-4 p-2 sm:p-3">
              {scene === 'build' ? (
                <DensityMatrixView
                  matrix={built}
                  title="ρ"
                  caption="Diagonal (violet): populations, P(0) and P(1). Off-diagonal (teal): coherences — the phase, and the only part dephasing touches."
                />
              ) : null}
              {scene === 'compare' ? (
                <>
                  <DensityMatrixView
                    matrix={superposition}
                    title="ρ = |ψ⟩⟨ψ|, superposition"
                    caption="Off-diagonal entries of magnitude ½ carry the phase φ."
                    compact
                  />
                  <DensityMatrixView
                    matrix={coinFlip}
                    title="ρ = ½|0⟩⟨0| + ½|1⟩⟨1|, mixture"
                    caption="Same diagonal, nothing off it. This is I/2 — the centre of the ball."
                    compact
                  />
                </>
              ) : null}
              {scene === 'trace' ? (
                <>
                  <DensityMatrixView
                    matrix={whole}
                    title="ρ_AB, the whole pair"
                    caption="Rows and columns are |q1 q0⟩. Pure: Tr ρ² = 1."
                    compact
                  />
                  <DensityMatrixView
                    matrix={part}
                    title={`ρ_${keptQubit} = Tr_${discard} ρ_AB`}
                    caption={`Sum the ${discard === '1' ? 'blocks' : 'entries'} that agree on qubit ${discard}'s value. What survives is the state of qubit ${keptQubit} alone.`}
                    compact
                  />
                </>
              ) : null}
              <p className="font-mono text-[11px] text-ink-muted">
                r = ({bx.toFixed(2)}, {by.toFixed(2)}, {bz.toFixed(2)}) · |r| = {Math.hypot(bx, by, bz).toFixed(3)}
              </p>
            </div>
          </div>
          <p className="px-3 pb-2 pt-2 text-[11px] leading-relaxed text-ink-muted">
            {canvasCaption} Drag the ball to rotate, scroll to zoom. Cell tint tracks |ρᵢⱼ|.
          </p>
        </div>
      }
      controls={controls}
    >
      <Explainer title="What the matrix is">
        <p>
          A statevector |ψ⟩ describes a qubit you know everything about. The density matrix
          ρ = Σ pᵢ |ψᵢ⟩⟨ψᵢ| describes the case where you do not: the qubit is |ψ₁⟩ with probability
          p₁, |ψ₂⟩ with probability p₂, and so on. For a single pure state it collapses to
          ρ = |ψ⟩⟨ψ| and says nothing the ket did not.
        </p>
        <p>
          Read it like this. The diagonal is the populations — ρ₀₀ is P(0), ρ₁₁ is P(1), and they
          sum to 1 because Tr ρ = 1 for any state. The off-diagonal is the coherence, ρ₀₁ = ρ₁₀*.
          For |ψ⟩ = cos(θ/2)|0⟩ + e^(iφ)sin(θ/2)|1⟩ it is ½ sin θ e^(−iφ): it carries the phase, and
          it is the part that interferes. ρ is always Hermitian and never has a negative eigenvalue.
          The tests in <code className="rounded bg-surface-3 px-1 py-0.5 text-[12px]">lib/quantum/densityMatrix.test.ts</code>{' '}
          check the first two for every state this page can produce.
        </p>
      </Explainer>

      <Explainer title="Purity is the length of the arrow">
        <p>
          For one qubit, ρ = (I + r·σ)/2 where r is exactly the Bloch vector. Squaring and taking the
          trace gives Tr ρ² = (1 + |r|²)/2, so |r| = √(2 Tr ρ² − 1). A pure state has Tr ρ² = 1 and
          sits on the surface. The maximally mixed state I/2 has Tr ρ² = ½ and sits at the centre,
          with no arrow at all. Everything in between is inside the ball.
        </p>
        <p>
          In the first scene, drag λ from 0 to 100% and watch three things move together: the teal
          cells go to zero, the purity readout falls from 1 toward ½, and the arrow drops onto the
          z axis. The diagonal does not move, so P(0) is the same before and after. That is what the
          arrow on the{' '}
          <Link href="/visualizations/decoherence" className="focus-ring rounded text-q-violet-text underline decoration-q-violet/40 underline-offset-2">
            decoherence page
          </Link>{' '}
          was doing: T2 shrinks ρ₀₁ by e^(−t/T2), and this page is the same picture with the numbers
          showing.
        </p>
      </Explainer>

      <Explainer title="Same statistics, different states">
        <p>
          Set the second scene to measure along Z. The superposition (|0⟩ + |1⟩)/√2 gives 50/50. So
          does a coin flip between |0⟩ and |1⟩. Looking only at Z, you cannot tell them apart, and
          people conclude from this that a superposition &ldquo;is just&rdquo; a state you do not
          know yet.
        </p>
        <p>
          Now measure along X. The superposition gives |+⟩ with certainty; the mixture is still
          50/50 — and is 50/50 along Y, and along every other axis, because I/2 has no direction.
          Turn the phase φ and the superposition&rsquo;s X and Y statistics trade places while the
          mixture&rsquo;s do nothing. The two matrices share a diagonal; the whole difference is
          the off-diagonal. A superposition is a definite state with a definite phase. A mixture is
          ignorance, and ignorance has no phase.
        </p>
        <p>
          One thing worth knowing and not visible here: I/2 is also 50% |+⟩ and 50% |−⟩, and 50% of
          any other antipodal pair. The decomposition of a mixed state into pure states is not
          unique, and no measurement can recover which one &ldquo;really&rdquo; happened. ρ is the
          whole story.
        </p>
      </Explainer>

      <Explainer title="The whole is pure, the part is mixed">
        <p>
          The third scene starts with the Bell state Φ⁺ = (|00⟩ + |11⟩)/√2, which is pure — its 4×4
          ρ has Tr ρ² = 1. Now suppose you hold one qubit and lose the other. What is the state of
          the qubit you have? Take the partial trace: sum over the outcomes of the qubit you gave
          up, which is what the smaller matrix on the right does to the larger one on the left.
        </p>
        <p>
          The answer is I/2, the maximally mixed state. Not approximately — exactly, and for either
          qubit. The arrow disappears into the centre of the ball, the purity reads 0.500, and the
          entropy reads one full bit. The pair as a whole has zero entropy and each half has the
          maximum a qubit can have. That is what entanglement is, said in terms of ρ: information
          that lives in the correlations and in neither part.
        </p>
        <p>
          Compare with |+⟩|0⟩. It is also pure, but trace out either qubit and what remains is still
          pure — the arrow stays on the surface. Then pick cos α|00⟩ + sin α|11⟩ and drag α from 0
          to π/4. The reduced purity runs from 1 down to ½ following cos⁴α + sin⁴α, and the arrow
          slides down the z axis into the centre. How mixed a part is measures how entangled the
          whole was.
        </p>
      </Explainer>

      <Explainer title="What this page does not do">
        <p>
          Nothing here evolves in time. The dephasing slider applies a channel once; the rates,
          T1, T2 and the bound T2 ≤ 2T1 are on the decoherence page. There is no amplitude damping
          in the first scene either, so the diagonal never changes there — a real qubit&rsquo;s
          would. Measurement updates ρ in a way this page does not show (it reports probabilities,
          not post-measurement states), the entropy readout is for one qubit only, and the two-qubit
          states are fixed presets rather than anything you can build gate by gate — the{' '}
          <Link href="/simulator" className="focus-ring rounded text-q-violet-text underline decoration-q-violet/40 underline-offset-2">
            simulator
          </Link>{' '}
          is for that.
        </p>
      </Explainer>
    </VizFrame>
  )
}
