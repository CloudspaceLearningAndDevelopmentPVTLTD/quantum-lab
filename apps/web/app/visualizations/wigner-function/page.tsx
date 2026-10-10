'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { lazyViz } from '@/components/viz/LazyViz'
import type { WignerSurfaceProps } from '@/components/viz/WignerSurface'
import { VizFrame, Explainer } from '@/components/ui/VizFrame'
import { Segmented, Slider, Stat, Toggle } from '@/components/ui/Controls'
import {
  densityMatrixFor,
  fieldStats,
  husimiFunction,
  meanParity,
  meanPhotonNumberOf,
  phaseSpaceGrid,
  suggestedDim,
  suggestedExtent,
  wignerFunction,
  type PhaseSpaceStateKind,
  type PhaseSpaceStateSpec,
} from '@/lib/quantum/phasespace'

/**
 * three.js is 512 kB and nothing can be drawn before the browser hands over a
 * WebGL context, so the surface loads after hydration behind a height-reserving
 * skeleton — same treatment as the Bloch sphere and the hydrogen atom. Module
 * scope, never inside a render: see the note in LazyViz.tsx.
 */
const WignerSurface = lazyViz<WignerSurfaceProps>(() => import('@/components/viz/WignerSurface'), {
  minHeight: 440,
})

/** Grid points per axis: ~5.7 samples per fringe of the widest cat on offer. */
const GRID_N = 97
const BOUND = 1 / Math.PI

type Fn = 'wigner' | 'husimi'

const KIND_OPTIONS: { value: PhaseSpaceStateKind; label: string }[] = [
  { value: 'coherent', label: 'Coherent' },
  { value: 'vacuum', label: 'Vacuum' },
  { value: 'fock', label: 'Fock |n⟩' },
  { value: 'cat', label: 'Cat' },
  { value: 'squeezed', label: 'Squeezed' },
  { value: 'thermal', label: 'Thermal' },
]

const FOCK_OPTIONS = Array.from({ length: 9 }, (_, i) => ({ value: String(i), label: String(i) }))

function stateName(spec: PhaseSpaceStateSpec): string {
  switch (spec.kind) {
    case 'vacuum':
      return 'the vacuum'
    case 'coherent':
      return `a coherent state with |α| = ${spec.alpha.toFixed(2)}`
    case 'fock':
      return `the Fock state |${spec.n}⟩`
    case 'cat':
      return `an ${spec.parity} cat state with α = ${spec.alpha.toFixed(2)}`
    case 'squeezed':
      return `squeezed vacuum with r = ${spec.r.toFixed(2)}`
    case 'thermal':
      return `a thermal state with mean photon number ${spec.nbar.toFixed(2)}`
  }
}

export default function WignerFunctionPage() {
  const [kind, setKind] = useState<PhaseSpaceStateKind>('coherent')
  const [fn, setFn] = useState<Fn>('wigner')
  const [alpha, setAlpha] = useState(1.5)
  const [phase, setPhase] = useState(0)
  const [fock, setFock] = useState(1)
  const [catAlpha, setCatAlpha] = useState(2)
  const [parity, setParity] = useState<'even' | 'odd'>('even')
  const [squeeze, setSqueeze] = useState(0.7)
  const [theta, setTheta] = useState(0)
  const [nbar, setNbar] = useState(1)
  const [contours, setContours] = useState(true)

  const spec = useMemo<PhaseSpaceStateSpec>(() => {
    switch (kind) {
      case 'vacuum':
        return { kind }
      case 'coherent':
        return { kind, alpha, phase }
      case 'fock':
        return { kind, n: fock }
      case 'cat':
        return { kind, alpha: catAlpha, parity }
      case 'squeezed':
        return { kind, r: squeeze, theta }
      case 'thermal':
        return { kind, nbar }
    }
  }, [kind, alpha, phase, fock, catAlpha, parity, squeeze, theta, nbar])

  const rho = useMemo(() => densityMatrixFor(spec, suggestedDim(spec)), [spec])
  const extent = useMemo(() => suggestedExtent(spec), [spec])
  const grid = useMemo(() => phaseSpaceGrid(GRID_N, extent), [extent])
  const wigner = useMemo(() => wignerFunction(rho, grid), [rho, grid])
  const husimi = useMemo(() => (fn === 'husimi' ? husimiFunction(rho, grid) : null), [fn, rho, grid])
  const field = fn === 'husimi' && husimi ? husimi : wigner

  const wStats = useMemo(() => fieldStats(wigner), [wigner])
  const shown = useMemo(() => fieldStats(field), [field])
  const parityValue = meanParity(rho)
  const photons = meanPhotonNumberOf(rho)
  const negative = wStats.negativeVolume > 1e-4

  const label = fn === 'wigner' ? 'W' : 'Q'
  const description =
    `${fn === 'wigner' ? 'Wigner function' : 'Husimi Q function'} of ${stateName(spec)}. ` +
    `Peak ${shown.max.toFixed(3)}, minimum ${shown.min.toFixed(3)}` +
    (fn === 'wigner'
      ? negative
        ? `, dipping below zero — negativity ${wStats.negativeVolume.toFixed(3)}.`
        : ', never below zero.'
      : ', non-negative everywhere.')

  const controls = (
    <>
      <Segmented<PhaseSpaceStateKind> label="State" value={kind} options={KIND_OPTIONS} onChange={setKind} />

      {kind === 'coherent' ? (
        <>
          <Slider
            label="Amplitude |α|"
            value={alpha}
            min={0}
            max={2.5}
            step={0.05}
            format={(v) => v.toFixed(2)}
            onChange={setAlpha}
            hint="Slides the vacuum bump to (√2 Re α, √2 Im α) without changing its shape"
          />
          <Slider
            label="Phase arg α"
            value={phase}
            min={0}
            max={2 * Math.PI}
            step={0.05}
            format={(v) => `${(v / Math.PI).toFixed(2)}π`}
            onChange={setPhase}
            hint="Walks the bump around a circle — this is what an oscillator does in time"
          />
        </>
      ) : null}

      {kind === 'fock' ? (
        <Segmented
          label="Photon number n"
          value={String(fock)}
          options={FOCK_OPTIONS}
          onChange={(v) => setFock(Number(v))}
        />
      ) : null}

      {kind === 'cat' ? (
        <>
          <Slider
            label="Separation α"
            value={catAlpha}
            min={0.5}
            max={2.5}
            step={0.05}
            format={(v) => v.toFixed(2)}
            onChange={setCatAlpha}
            hint="The two lobes sit at x = ±√2 α; the fringes between them get finer as they part"
          />
          <Segmented<'even' | 'odd'>
            label="Parity"
            value={parity}
            options={[
              { value: 'even', label: '|α⟩ + |−α⟩' },
              { value: 'odd', label: '|α⟩ − |−α⟩' },
            ]}
            onChange={setParity}
          />
        </>
      ) : null}

      {kind === 'squeezed' ? (
        <>
          <Slider
            label="Squeezing r"
            value={squeeze}
            min={0}
            max={1.2}
            step={0.05}
            format={(v) => `${v.toFixed(2)} (${(20 * v * Math.LOG10E).toFixed(1)} dB)`}
            onChange={setSqueeze}
            hint="Narrows one quadrature by e⁻ʳ and widens the other by eʳ; the area stays put"
          />
          <Slider
            label="Squeezing angle θ"
            value={theta}
            min={0}
            max={Math.PI}
            step={0.05}
            format={(v) => `${(v / Math.PI).toFixed(2)}π`}
            onChange={setTheta}
            hint="Rotates the ellipse; θ = π squeezes p instead of x"
          />
        </>
      ) : null}

      {kind === 'thermal' ? (
        <Slider
          label="Mean photon number n̄"
          value={nbar}
          min={0}
          max={3}
          step={0.05}
          format={(v) => v.toFixed(2)}
          onChange={setNbar}
          hint="Classical noise: the bump only ever gets wider and lower"
        />
      ) : null}

      <Segmented<Fn>
        label="Function"
        value={fn}
        options={[
          { value: 'wigner', label: 'Wigner W' },
          { value: 'husimi', label: 'Husimi Q' },
        ]}
        onChange={setFn}
      />

      <Toggle
        label="Contours on the floor"
        checked={contours}
        onChange={setContours}
        hint="Rose iso-lines where the function is positive, sky where it is negative"
      />

      <div className="grid grid-cols-2 gap-2">
        <Stat label={`${label}(0, 0)`} value={shown.origin.toFixed(4)} accent="violet" />
        <Stat label="⟨parity⟩ / π" value={(parityValue / Math.PI).toFixed(4)} accent="teal" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Stat label={`min ${label}`} value={shown.min.toFixed(4)} accent={shown.min < -1e-6 ? 'sky' : 'amber'} />
        <Stat label="Negativity ∫|W| − 1" value={wStats.negativeVolume.toFixed(4)} accent={negative ? 'sky' : 'amber'} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Stat label={`∫${label} dx dp`} value={shown.integral.toFixed(4)} accent="rose" />
        <Stat label="⟨n⟩ photons" value={photons.toFixed(3)} accent="violet" />
      </div>

      <p className="text-[11px] leading-relaxed text-ink-muted">
        Computed in a {rho.dim}-level Fock basis on a {GRID_N} × {GRID_N} grid spanning ±{extent.toFixed(1)} in
        both quadratures. Height and colour are drawn to the fixed bound 1/π ≈ 0.318, the largest value any
        Wigner function can reach, so every state is measured with the same ruler.
      </p>
    </>
  )

  return (
    <VizFrame
      title="Phase Space and the Wigner Function"
      tagline="A quantum state drawn as a landscape over position and momentum — and the one thing a landscape of probability is never allowed to do."
      level="Advanced"
      canvas={
        <div className="p-2">
          <WignerSurface
            field={field}
            scale={BOUND}
            label={label}
            showContours={contours}
            description={description}
          />
          <p className="px-3 pb-2 pt-1 text-[11px] leading-relaxed text-ink-muted">
            Height is {label}(x, p); rose is positive, sky is negative, and the translucent sheet is zero. The
            floor carries the same picture flat, the way a textbook prints it. Drag to turn, scroll to zoom.
          </p>
        </div>
      }
      controls={controls}
    >
      <Explainer title="Start here">
        <p>
          A classical particle is a dot in phase space: one position, one momentum. A quantum state cannot be
          a dot, because x and p do not commute, but it can be a <em>landscape</em> — a function W(x, p) whose
          shadow along either axis is exactly the probability distribution you would measure for that variable.
          Integrate over p and you get |ψ(x)|²; integrate over x and you get |φ(p)|². The whole landscape
          integrates to 1, which the <em>∫W</em> readout confirms for every state here.
        </p>
        <p>
          You start on a <strong>coherent state</strong>, the packet that swings without spreading on the{' '}
          <Link href="/visualizations/harmonic-oscillator" className="text-q-teal-text underline-offset-2 hover:underline">
            harmonic-oscillator page
          </Link>
          . Drag <strong>|α|</strong> and watch the vacuum bump slide outward without changing shape; drag the{' '}
          <strong>phase</strong> and it circles the origin — that circle is the oscillation, seen from above.
          Then switch to <strong>Fock |1⟩</strong>.
        </p>
      </Explainer>

      <Explainer title="What just happened: the landscape went below sea level">
        <p>
          The single-photon state has a crater at the origin: W(0, 0) = −1/π, as deep as the bound allows, and
          the <em>min W</em> readout goes sky-blue to say so. No probability distribution can do that — a
          probability is a fraction of trials, and no fraction of trials is negative. That is why W is called a{' '}
          <em>quasi</em>-probability. Its shadows are honest probabilities; the landscape itself is not.
        </p>
        <p>
          The number at the origin is not an accident. W(0, 0) is the mean <em>parity</em> of the state
          divided by π: +1/π for anything with only even photon numbers, −1/π for anything with only odd
          ones, and in between for mixtures. The <em>⟨parity⟩/π</em> readout tracks the origin exactly for every
          state — try the odd cat, the thermal state, and a coherent state as |α| grows and its parity
          washes out.
        </p>
        <p>
          Now pick the <strong>cat</strong> and pull the separation out. Two coherent lobes, and between them a
          washboard of fringes that plunge below zero — interference between “here” and “there”, written into
          phase space. The fringe spacing shrinks as the lobes part, which is precisely why big cats are hard
          to keep alive: the finer the fringes, the less noise it takes to wash them out.
        </p>
      </Explainer>

      <Explainer title="Negativity is the signature of nonclassicality">
        <p>
          The <em>Negativity</em> readout is ∫|W| − 1: how much of the landscape lies below zero, doubled. It
          is exactly zero for the vacuum, for every coherent state, for every squeezed state and for the thermal
          state — all of them are Gaussians, and a theorem of Hudson says the only pure states whose Wigner
          function stays non-negative are Gaussian. Anything else must dip below zero somewhere.
        </p>
        <p>
          That dip is the price of being genuinely quantum. A state whose W is everywhere non-negative can be
          treated as a classical ensemble of phase-space points, and there is a theorem for that too: circuits
          built from such states and Gaussian operations can be simulated efficiently on a classical computer.
          Negativity is where the classical description runs out — it is a <em>resource</em>, in the same
          sense that entanglement is. Squeeze as hard as you like and you get no negativity at all; a single
          photon gives you the maximum.
        </p>
      </Explainer>

      <Explainer title="Switch to Q and watch the negativity vanish">
        <p>
          Toggle <strong>Husimi Q</strong>. Same state, same grid — and every crater fills in. Q is W blurred
          with a Gaussian one vacuum wide, which is enough to smooth away any negative region, so Q is a
          genuine probability distribution: never below zero and never above 1/2π. It is the distribution you
          record if you measure x and p <em>simultaneously</em>, which the uncertainty principle only permits at
          the cost of exactly that much added noise.
        </p>
        <p>
          The lesson is that “the” phase-space distribution of a quantum state does not exist. There is a
          family of them, ordered by how much of the noncommutativity you smear over, and W is the one in the
          middle that gets the marginals right. The fringes of the cat state are still there in Q, faintly; the
          negative ones just cannot show. Toggle back and forth on the cat with the separation at maximum and
          the smoothing is unmistakable.
        </p>
      </Explainer>

      <Explainer title="Where this runs">
        <p>
          Every one of these surfaces has been measured. Quantum-state tomography reconstructs W from
          homodyne data, and the first negative Wigner function of a single photon was published in 2001. Cat
          states with the fringes you see here live in superconducting microwave cavities, where they encode
          logical qubits whose errors are mostly one kind (photon loss) and therefore easier to correct — the
          bosonic-code approach to fault tolerance.
        </p>
        <p>
          Squeezed vacuum is the state LIGO injects to hear black-hole mergers below the vacuum noise floor.
          Its Wigner function is the ellipse on this page: one quadrature quieter than the vacuum, the other
          louder, area unchanged. The function itself is from 1932, decades before anyone imagined measuring
          one: Eugene Wigner introduced it as a bookkeeping device for quantum corrections to thermodynamics,
          and the negativity he could not avoid turned out to be the whole point.
        </p>
      </Explainer>
    </VizFrame>
  )
}
