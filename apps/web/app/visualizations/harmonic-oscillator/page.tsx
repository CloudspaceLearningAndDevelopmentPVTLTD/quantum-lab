'use client'

import Link from 'next/link'
import { useCallback, useMemo, useState } from 'react'
import BoundStatesLab from '@/components/viz/BoundStatesLab'
import CoherentStateLab, { type CoherentStats } from '@/components/viz/CoherentStateLab'
import { VizFrame, Explainer } from '@/components/ui/VizFrame'
import { Segmented, Slider, Toggle, ButtonRow, Stat } from '@/components/ui/Controls'
import { centeredGrid, harmonicPotential, solveStationary } from '@/lib/quantum/schrodinger'

/**
 * One grid serves both modes. 1024 is a power of two because the split-step propagator
 * behind the coherent state needs an FFT, and ±12 leaves the parabola's walls far above
 * anything on screen so the periodic boundary never sees amplitude.
 */
const GRID = centeredGrid(1024, 12)
const LEVELS = 8

type Mode = 'levels' | 'coherent'

const EMPTY_STATS: CoherentStats = {
  time: 0,
  meanX: 0,
  classicalX: 0,
  spread: 0,
  groundWidth: 0,
  periods: 0,
}

export default function HarmonicOscillatorPage() {
  const [mode, setMode] = useState<Mode>('levels')
  const [omega, setOmega] = useState(1)
  const [level, setLevel] = useState(0)
  const [showDensity, setShowDensity] = useState(false)
  const [displacement, setDisplacement] = useState(3)
  const [widthRatio, setWidthRatio] = useState(1)
  const [running, setRunning] = useState(true)
  const [resetKey, setResetKey] = useState(0)
  const [stepRequest, setStepRequest] = useState(0)
  const [stats, setStats] = useState<CoherentStats>(EMPTY_STATS)

  const potential = useMemo(() => harmonicPotential(GRID, omega), [omega])
  const states = useMemo(() => solveStationary(GRID, potential, LEVELS), [potential])

  const index = Math.min(level, states.length - 1)
  const selected = states[index]

  const onStats = useCallback((s: CoherentStats) => setStats(s), [])

  // The classical turning points of the selected level: where a marble of that energy
  // would run out of speed and come back.
  const turning = selected ? Math.sqrt(2 * selected.energy) / omega : 0

  // The grid runs to ±12 so the tails of the highest level die before the boundary, but at
  // ω = 3 everything interesting lives inside ±2.5. Draw only as much x as the top level
  // needs, or the picture is a spike in the middle of an empty canvas.
  const topTurning = Math.sqrt(2 * (states[LEVELS - 1]?.energy ?? omega * 8)) / omega
  const view = Math.min(12, topTurning * 1.55)

  // The gap below the selected level, or the first gap when the ground state is selected.
  // For a harmonic oscillator every one of these is ħω — that is the point of the readout.
  const spacing =
    index > 0 && selected
      ? selected.energy - states[index - 1].energy
      : states.length > 1
        ? states[1].energy - states[0].energy
        : omega

  const controls = (
    <>
      <Segmented<Mode>
        label="View"
        value={mode}
        options={[
          { value: 'levels', label: 'Energy levels' },
          { value: 'coherent', label: 'Coherent state' },
        ]}
        onChange={setMode}
      />

      <Slider
        label="Frequency ω"
        value={omega}
        min={0.4}
        max={3}
        step={0.05}
        format={(v) => v.toFixed(2)}
        onChange={setOmega}
        hint="Stiffer spring, wider rungs"
      />

      {mode === 'levels' ? (
        <>
          <Segmented
            label="Level n"
            value={String(index)}
            options={states.map((_, i) => ({ value: String(i), label: `${i}` }))}
            onChange={(v) => setLevel(Number(v))}
          />
          <Toggle
            label="Show |ψ|² instead of ψ"
            checked={showDensity}
            onChange={setShowDensity}
            hint="Where the particle is actually found"
          />
          <div className="grid grid-cols-2 gap-2">
            <Stat
              label="Energy"
              value={selected ? selected.energy.toFixed(4) : '—'}
              accent="violet"
            />
            <Stat label="(n + ½)ω" value={((index + 0.5) * omega).toFixed(4)} accent="teal" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Gap to n−1" value={spacing.toFixed(4)} accent="sky" />
            <Stat label="Nodes" value={selected ? String(selected.nodes) : '—'} accent="amber" />
          </div>
        </>
      ) : (
        <>
          <Slider
            label="Release point a"
            value={displacement}
            min={0.5}
            max={5}
            step={0.1}
            format={(v) => v.toFixed(1)}
            onChange={setDisplacement}
            hint="Pull it aside and let go"
          />
          <Slider
            label="Packet width σ / σ₀"
            value={widthRatio}
            min={0.5}
            max={2.5}
            step={0.05}
            format={(v) => `${v.toFixed(2)}×`}
            onChange={setWidthRatio}
            hint="1.00 is the coherent state — the one that never spreads"
          />

          <ButtonRow>
            <button type="button" className="btn-primary" onClick={() => setRunning((r) => !r)}>
              {running ? 'Pause' : 'Play'}
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setStepRequest((s) => s + 1)}
            >
              Step ¹⁄₁₆ period
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setResetKey((k) => k + 1)}
            >
              Reset
            </button>
          </ButtonRow>

          <div className="grid grid-cols-2 gap-2">
            <Stat label="⟨x⟩ quantum" value={stats.meanX.toFixed(3)} accent="violet" />
            <Stat label="a·cos(ωt)" value={stats.classicalX.toFixed(3)} accent="teal" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Stat
              label="Disagreement"
              value={Math.abs(stats.meanX - stats.classicalX).toExponential(1)}
              accent="rose"
            />
            <Stat
              label="σ / σ₀ now"
              value={
                stats.groundWidth > 0 ? `${(stats.spread / stats.groundWidth).toFixed(2)}×` : '—'
              }
              accent="sky"
            />
          </div>
          <Stat label="Periods elapsed" value={stats.periods.toFixed(2)} accent="amber" />
        </>
      )}

      <p className="text-[11px] leading-relaxed text-ink-muted">
        {mode === 'levels'
          ? `Levels from a finite-difference eigensolve on a ${GRID.n}-point grid, ħ = m = 1.`
          : 'Evolved with a split-step Fourier propagator that conserves probability to twelve decimal places. Step works while paused, and is the whole story if you prefer no animation.'}
      </p>
    </>
  )

  return (
    <VizFrame
      title="The Quantum Harmonic Oscillator"
      tagline="A ladder of evenly spaced rungs, a ground state that will not sit still, and one particular packet that behaves exactly like a marble in a bowl."
      level="Intermediate"
      canvas={
        <div className="p-2">
          {mode === 'levels' ? (
            <>
              <BoundStatesLab
                grid={GRID}
                potential={potential}
                states={states}
                level={index}
                showDensity={showDensity}
                markers={[-turning, turning]}
                levelBase={0}
                xRange={[-view, view]}
                energyFloor={0}
                energyCeiling={(states[LEVELS - 1]?.energy ?? omega * 8) * 1.14}
                onPickLevel={setLevel}
              />
              <p className="px-3 pb-2 pt-1 text-[11px] leading-relaxed text-ink-muted">
                Amber is the parabola V = ½ω²x²; the dashed lines are the classical turning points
                for the selected level. Notice the wavefunction is still there beyond them.
              </p>
            </>
          ) : (
            <>
              <CoherentStateLab
                grid={GRID}
                potential={potential}
                omega={omega}
                displacement={displacement}
                widthRatio={widthRatio}
                running={running}
                resetKey={resetKey}
                stepRequest={stepRequest}
                onStats={onStats}
              />
              <p className="px-3 pb-2 pt-1 text-[11px] leading-relaxed text-ink-muted">
                Violet is |ψ|² and the violet dot is its mean position. The teal ring is where
                Newton says the particle is. Below, both plotted against time — one curve, drawn
                twice.
              </p>
            </>
          )}
        </div>
      }
      controls={controls}
    >
      <Explainer title="Start here">
        <p>
          Almost every potential looks like a parabola if you zoom in far enough on its minimum, so
          this one problem stands in for molecular bonds, crystal lattices, the electromagnetic
          field and the mirrors of a gravitational-wave detector. Solving it once buys all of them.
        </p>
        <p>
          Move <strong>ω</strong> and watch the rungs of the ladder move apart together, never
          bunching or fanning. Then switch to <strong>Coherent state</strong>, pull the packet aside
          and release it — and watch a quantum object trace a cosine.
        </p>
      </Explainer>

      <Explainer title="Every rung the same height">
        <p>
          The box gave levels going as n². Here they go as n + ½, so every gap is exactly ħω — the{' '}
          <em>Gap to n−1</em> readout does not budge as you climb. That evenness is why a vibrating
          molecule absorbs one sharp frequency rather than a spread of them, and why the energy in a
          light field comes in identical lumps we call photons. Identical rungs, identical quanta.
        </p>
        <p>
          The ½ is the other half of the sentence. The lowest state is not at zero, it is at ½ħω,
          and no amount of cooling removes it. A particle sitting exactly at the bottom of the bowl
          would have both a definite position and a definite momentum, which the uncertainty
          principle forbids, so the ground state is the cheapest compromise between the two —
          spread out enough to keep momentum modest, localised enough to keep potential energy
          modest. Zero-point motion is not leftover heat. It is the price of the compromise.
        </p>
      </Explainer>

      <Explainer title="What just happened: the packet that behaves">
        <p>
          Set the width to exactly 1.00× and release the packet. It slides down, sweeps through the
          middle, climbs the far wall and comes back — and it does not spread. Every other packet
          this site shows you falls apart as it moves; this one keeps its shape forever. That is the{' '}
          <em>coherent state</em>, and it is as close as quantum mechanics gets to handing you a
          classical particle.
        </p>
        <p>
          Now drag the width away from 1.00×. The centre still tracks the cosine perfectly — the{' '}
          <em>Disagreement</em> readout stays at the level of round-off — but the packet now
          breathes, fattening and thinning twice per period. That split is worth holding onto: in a
          parabola, ⟨x⟩ obeys Newton&rsquo;s equation exactly, for <em>any</em> state whatsoever,
          because the force is linear and averaging a linear function commutes with everything.
          Classical mechanics survives in the average. The shape is where the quantum stays.
        </p>
      </Explainer>

      <Explainer title="Where this runs">
        <p>
          The bending mode of CO₂ — the two oxygens flexing about the carbon — oscillates at about
          2×10¹³ Hz, and the evenly spaced ladder of that oscillator is what an infrared
          spectrometer reads out at 15 µm. That rung spacing sits right on the peak of the thermal
          radiation a 290 K Earth emits, which is most of the reason CO₂ is a greenhouse gas. Cool a
          crystal and the
          zero-point motion is what remains; it is measurable in neutron scattering and it is why
          helium will not freeze under its own vapour pressure at any temperature.
        </p>
        <p>
          The coherent state is not an idealisation either. It is exactly the state of the
          electromagnetic field that a laser produces, which is why laser light behaves so much like
          a classical wave while still arriving as photons. Squeeze it — the same thing you do here
          by dragging the width off 1.00× — and you can trade uncertainty in one quadrature for
          another. LIGO does precisely that to hear black holes more clearly.
        </p>
      </Explainer>

      <Explainer title="Go further: the same packet, drawn over position and momentum at once">
        <p>
          Everything on this page is a function of x alone; the momentum you only see indirectly, as
          the packet&rsquo;s speed. The{' '}
          <Link
            href="/visualizations/wigner-function"
            className="text-q-teal-text underline-offset-2 hover:underline"
          >
            phase-space page
          </Link>{' '}
          draws the coherent state you just released as a landscape over x <em>and</em> p together —
          a single round bump that circles the origin once per period, and whose shape is the reason
          it never spreads. It is the starting state there. Squeeze it and the bump becomes an
          ellipse; give it one photon instead and the landscape dips below zero, which no
          probability distribution is allowed to do.
        </p>
      </Explainer>
    </VizFrame>
  )
}
