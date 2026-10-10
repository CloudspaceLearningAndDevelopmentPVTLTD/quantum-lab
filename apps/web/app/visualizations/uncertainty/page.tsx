'use client'

import { useCallback, useState } from 'react'
import Link from 'next/link'
import UncertaintyLab, { type UncertaintyStats } from '@/components/viz/UncertaintyLab'
import { VizFrame, Explainer } from '@/components/ui/VizFrame'
import { Segmented, Slider, ButtonRow, Stat } from '@/components/ui/Controls'
import { prefersReducedMotion } from '@/components/viz/frameLoop'
import { UNCERTAINTY_FLOOR, chirpedGaussianProduct, type PacketShape } from '@/lib/viz/uncertainty'

/**
 * /visualizations/uncertainty
 *
 * Heisenberg's relation is usually delivered as a rule to memorise, sometimes
 * with a story about a photon knocking an electron off course — which is a
 * story about measurement disturbance, a different (and also real) phenomenon,
 * and not what σx·σp ≥ ħ/2 is about at all.
 *
 * What it IS about: a wavefunction and its Fourier transform are one object
 * seen twice, and no function can be narrow in both pictures. This page shows
 * both pictures of the same array at once, measures both widths the same way,
 * and puts their product against the floor live. The Gaussian sits exactly on
 * the floor; everything else sits above it; and a released packet climbs away
 * from it and never comes back. None of that is asserted anywhere in the code
 * — see lib/viz/uncertainty.ts and its tests.
 */

const SHAPE_OPTIONS: { value: PacketShape; label: string }[] = [
  { value: 'gaussian', label: 'Gaussian' },
  { value: 'tophat', label: 'Top hat' },
  { value: 'triangle', label: 'Triangle' },
  { value: 'twoBumps', label: 'Two bumps' },
  { value: 'hermite1', label: 'Oscillator n=1' },
  { value: 'hermite2', label: 'Oscillator n=2' },
]

/** What each shape is worth against the bound, for the payoff copy. */
const SHAPE_NOTE: Record<PacketShape, string> = {
  gaussian: 'The only shape that touches the floor. Squeeze it however you like — the product does not move.',
  tophat: 'Two hard edges. A discontinuous slope means Fourier tails that never really end, so σp is formally infinite — the number shown is only as large as the momentum cutoff of the grid lets it be.',
  triangle: 'Continuous, but with a kink at the top and two at the base. Better than a box, still well above the floor.',
  twoBumps: 'Wide in position and fringed in momentum at the same time — the double slit, seen as a width problem.',
  hermite1: 'The first excited state of a harmonic oscillator. Its product is exactly 3/2 ħ, which is the same statement as E₁ = 3/2 ħω.',
  hermite2: 'The second excited state, at exactly 5/2 ħ. The ladder of oscillator energies IS a ladder of uncertainty products.',
}

export default function UncertaintyPage() {
  const [shape, setShape] = useState<PacketShape>('gaussian')
  const [width, setWidth] = useState(1.2)
  const [chirp, setChirp] = useState(0)
  const [k0, setK0] = useState(0)
  const [evolving, setEvolving] = useState(false)
  const [resetKey, setResetKey] = useState(0)
  const [stats, setStats] = useState<UncertaintyStats>({
    sigmaX: 0,
    sigmaP: 0,
    product: 0,
    ratio: 1,
    meanP: 0,
    t: 0,
    warning: null,
  })

  const onStats = useCallback((s: UncertaintyStats) => setStats(s), [])

  const release = () => {
    // A11Y: under reduced motion, one press advances the packet by a short,
    // bounded burst and stops, instead of starting an animation that runs until
    // it is stopped. Press again to advance again — the reader controls every
    // bit of movement on the page.
    if (prefersReducedMotion()) {
      setEvolving(true)
      window.setTimeout(() => setEvolving(false), 350)
      return
    }
    setEvolving((e) => !e)
  }

  const reset = () => {
    setEvolving(false)
    setResetKey((k) => k + 1)
  }

  const analyticGaussian = shape === 'gaussian' ? chirpedGaussianProduct(width, chirp) : null
  const saturated = stats.ratio < 1.005

  const controls = (
    <>
      <Segmented<PacketShape>
        label="Shape of the packet"
        value={shape}
        options={SHAPE_OPTIONS}
        onChange={(v) => {
          setShape(v)
          reset()
        }}
      />

      <Slider
        label="Squeeze in position"
        value={width}
        min={0.25}
        max={4}
        step={0.01}
        format={(v) => `w = ${v.toFixed(2)}`}
        onChange={(v) => {
          setWidth(v)
          setEvolving(false)
        }}
        hint="Narrow it and watch the momentum panel below widen by the same factor."
      />

      <Slider
        label="Quadratic phase (chirp)"
        value={chirp}
        min={0}
        max={2}
        step={0.01}
        format={(v) => `c = ${v.toFixed(2)}`}
        onChange={(v) => {
          setChirp(v)
          setEvolving(false)
        }}
        hint="Leaves |ψ(x)|² untouched and still costs momentum spread. Phase is not free."
      />

      <Slider
        label="Give it a push"
        value={k0}
        min={-8}
        max={8}
        step={0.1}
        format={(v) => `k₀ = ${v.toFixed(1)}`}
        onChange={(v) => {
          setK0(v)
          setEvolving(false)
        }}
        hint="Shifts the momentum distribution sideways. Neither width changes."
      />

      <ButtonRow>
        <button type="button" className="btn-primary focus-ring" onClick={release}>
          {evolving ? 'Freeze' : 'Release it'}
        </button>
        <button type="button" className="btn-ghost focus-ring" onClick={reset}>
          Back to t = 0
        </button>
      </ButtonRow>

      <div className="grid grid-cols-2 gap-2">
        <Stat label="σx" value={stats.sigmaX.toFixed(4)} accent="violet" />
        <Stat label="σp" value={stats.sigmaP.toFixed(4)} accent="teal" />
        <Stat label="σx · σp" value={stats.product.toFixed(4)} accent={saturated ? 'teal' : 'amber'} />
        <Stat label="× the ħ/2 floor" value={`${stats.ratio.toFixed(3)}×`} accent={saturated ? 'teal' : 'amber'} />
      </div>

      {analyticGaussian !== null ? (
        <div className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-[11px] leading-relaxed text-ink-muted">
          Closed form for this shape: ħ√(¼ + c²w⁴) ={' '}
          <span className="font-mono text-q-violet-text">{analyticGaussian.toFixed(4)}</span>. The
          measured value above is the Fourier transform of the plotted array, computed independently.
        </div>
      ) : null}

      {stats.warning ? (
        <p className="rounded-lg border border-q-rose/30 bg-q-rose/10 px-3 py-2 text-[11px] leading-relaxed text-q-rose-text">
          {stats.warning}
        </p>
      ) : null}

      <p className="text-[11px] leading-relaxed text-ink-muted">
        ħ = 1 and m = 1, so the floor is exactly 0.5 and p = k. Widths are second moments of the two
        plotted densities — the same formula for both, with no shape treated specially.
      </p>
    </>
  )

  return (
    <VizFrame
      title="Uncertainty as a Fourier Trade-off"
      tagline="Not a rule about what you are allowed to know. A theorem about what a wave can be: narrow here means wide there."
      level="Intermediate"
      canvas={
        <div className="p-2">
          <UncertaintyLab
            shape={shape}
            width={width}
            k0={k0}
            chirp={chirp}
            evolving={evolving}
            resetKey={resetKey}
            onStats={onStats}
          />
          <p className="px-3 pb-2 pt-1 text-[11px] text-ink-muted">
            {SHAPE_NOTE[shape]}
          </p>
        </div>
      }
      controls={controls}
    >
      <Explainer title="One object, two pictures">
        <p>
          The two panels are not two measurements of two things. They are the same array of complex
          numbers, drawn twice: the lower panel is the discrete Fourier transform of the upper one,
          recomputed every frame. A quantum state does not have a position distribution and,
          separately, a momentum distribution. It has an amplitude, and those are its two views.
        </p>
        <p>
          Drag <strong>Squeeze in position</strong> down and watch. As the violet bump narrows, the
          teal one widens — and not vaguely: halve σx and σp exactly doubles. That reciprocity is
          not quantum mechanics. It is a property of Fourier transforms that a radio engineer would
          recognise instantly: a shorter pulse occupies more bandwidth, which is why a fast data
          link needs a wide channel and a narrow filter rings.
        </p>
      </Explainer>

      <Explainer title="What quantum mechanics adds">
        <p>
          The bridge is de Broglie&rsquo;s p = ħk. Momentum <em>is</em> the Fourier variable
          conjugate to position, so the engineer&rsquo;s bandwidth theorem becomes a statement about
          momentum, and the constant that shows up in front is ħ.
        </p>
        <p>
          That is the whole derivation. σx·σp ≥ ħ/2 is a width theorem multiplied by a conversion
          factor. Nothing in it mentions a measuring device bumping into a particle, which is why
          the relation constrains a state that nobody is looking at, and why it holds just as firmly
          for a photon in a fibre as for an electron in an atom.
        </p>
      </Explainer>

      <Explainer title="The Gaussian sits exactly on the floor">
        <p>
          With <strong>Gaussian</strong> selected, drag the width slider from one end to the other
          and watch the bar at the bottom of the canvas. σx and σp both change by large factors.
          Their product does not move: {UNCERTAINTY_FLOOR.toFixed(1)}, to four decimal places, at
          every width.
        </p>
        <p>
          Now switch to <strong>Top hat</strong>. It is a perfectly reasonable-looking packet — a
          particle confined to a region, nothing pathological — and its product is several times the
          floor. In truth it is unbounded: for a hard-edged packet the momentum tails fall off only
          as 1/p, so ⟨p²⟩ diverges and σp is infinite. The figure on screen is finite only because
          the grid has a momentum cutoff — refine the grid and the number keeps climbing. The
          reason is visible in the momentum panel: hard edges have Fourier tails that decay slowly,
          and those far tails dominate ⟨p²⟩ even though they carry almost no probability. Sharpness
          is expensive, and it is expensive far away from where the sharpness is.
        </p>
        <p>
          The Gaussian is the unique shape that reaches the bound, and that fact quietly runs a lot
          of physics: it is why the ground state of any harmonic trap is Gaussian, why a laser&rsquo;s
          transverse mode is Gaussian, and why &ldquo;minimum-uncertainty state&rdquo; and
          &ldquo;coherent state&rdquo; are the same words.
        </p>
      </Explainer>

      <Explainer title="Phase costs you, even when the picture does not change">
        <p>
          Turn up <strong>Quadratic phase</strong> and keep your eye on the upper panel.{' '}
          <em>Nothing happens to it.</em> |ψ(x)|² is untouched — the packet is exactly as wide as it
          was, in exactly the same place. But the momentum panel spreads out and the product climbs
          off the floor.
        </p>
        <p>
          The faint grey line inside the position panel is the real part of ψ, and that is where the
          chirp is hiding: the oscillation gets tighter toward the edges. Momentum is the rate at
          which phase winds, so a phase that winds at different rates in different places is a
          packet carrying a spread of momenta. Two states can look identical on a probability plot
          and still be different states with different physics.
        </p>
        <p>
          Contrast that with <strong>Give it a push</strong>. A uniform phase winding e^(ik₀x) slides
          the whole momentum distribution sideways and changes neither width. Uniform winding is
          motion; non-uniform winding is spread.
        </p>
      </Explainer>

      <Explainer title="Let go, and the floor recedes">
        <p>
          Set a Gaussian with no chirp, confirm the bar is sitting on the floor, and press{' '}
          <strong>Release it</strong>. The packet evolves as a free particle — each momentum
          component simply accumulates its own phase, which is exact, not a time-stepping
          approximation.
        </p>
        <p>
          Two things happen at once. The momentum panel does not move at all, because a free
          particle conserves momentum and nothing is there to change the distribution. And the
          position panel spreads, following σx(t) = σ₀√(1 + (ħt/2mσ₀²)²), because the fast components
          run ahead and the slow ones fall behind. So the product grows, and a minimum-uncertainty
          state stops being one the instant you stop holding it.
        </p>
        <p>
          What is actually building up is the chirp you added by hand a moment ago. Free evolution
          generates quadratic phase all on its own — which is why the tightest packet spreads
          fastest, and why an electron microscope&rsquo;s resolution and an optical fibre&rsquo;s
          bandwidth are limited by the same equation.
        </p>
      </Explainer>

      <Explainer title="Where you have already seen this">
        <p>
          The oscillator shapes make the connection to energy explicit. Select{' '}
          <strong>Oscillator n=1</strong>: the product is exactly 1.5, and{' '}
          <strong>n=2</strong> gives exactly 2.5. Those are the same numbers as the harmonic
          oscillator&rsquo;s energy levels, (n + ½)ħω, because for a harmonic trap the energy simply
          <em>is</em> a weighted sum of ⟨x²⟩ and ⟨p²⟩. The ladder of energies and the ladder of
          uncertainty products are one ladder.
        </p>
        <p>
          It also explains the ground state that nobody can turn off. A particle in a box cannot sit
          still at the bottom, because being localised at all forces a momentum spread, and a
          momentum spread is kinetic energy. That zero-point energy is what the{' '}
          <Link
            href="/visualizations/tunneling"
            className="focus-ring rounded text-q-violet-text underline decoration-dotted underline-offset-2"
          >
            tunnelling page
          </Link>{' '}
          leans on when a particle turns up somewhere it has no business being, and what the{' '}
          <Link
            href="/visualizations/double-slit"
            className="focus-ring rounded text-q-violet-text underline decoration-dotted underline-offset-2"
          >
            double slit
          </Link>{' '}
          is doing when a narrower slit produces a wider pattern. Try <strong>Two bumps</strong> here
          and compare the momentum panel with the fringes on that page — they are the same
          calculation.
        </p>
      </Explainer>
    </VizFrame>
  )
}
