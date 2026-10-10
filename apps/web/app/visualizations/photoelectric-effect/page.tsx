'use client'

import { useMemo, useState } from 'react'
import PhotoelectricLab from '@/components/viz/PhotoelectricLab'
import PhotoelectricSlopePlot from '@/components/viz/PhotoelectricSlopePlot'
import { VizFrame, Explainer } from '@/components/ui/VizFrame'
import { Slider, Segmented, ButtonRow, Stat } from '@/components/ui/Controls'
import {
  METALS,
  fitStoppingLine,
  metalById,
  photonEnergyEv,
  readout,
  thresholdFrequencyHz,
  wavelengthNmFromFrequencyHz,
} from '@/lib/viz/photoelectric'
import { ELEMENTARY_CHARGE_C, PLANCK_J_S } from '@/lib/viz/physicalConstants'
import { bandOf } from '@/lib/viz/spectralColor'

/** Frequency is carried in units of 10¹⁴ Hz, which is the scale the axis is drawn in. */
const F_MIN_UNITS = 3
const F_MAX_UNITS = 20

const METAL_OPTIONS = METALS.map((m) => ({
  value: m.id,
  label: `${m.symbol} · ${m.workFunctionEv.toFixed(2)}`,
}))

export default function PhotoelectricEffectPage() {
  const [metalId, setMetalId] = useState('sodium')
  const [fUnits, setFUnits] = useState(8)
  const [intensity, setIntensity] = useState(0.5)
  const [retardingVoltageV, setRetardingVoltageV] = useState(0)
  const [running, setRunning] = useState(true)

  const metal = metalById(metalId)
  const frequencyHz = fUnits * 1e14

  const r = useMemo(
    () =>
      readout({
        frequencyHz,
        workFunctionEv: metal.workFunctionEv,
        intensity,
        retardingVoltageV,
      }),
    [frequencyHz, metal.workFunctionEv, intensity, retardingVoltageV]
  )

  /**
   * Planck's constant, fitted from the plotted points rather than quoted. The sample
   * frequencies are the ones the graph actually draws, so the number below is what a
   * reader with a ruler would get off the same line.
   */
  const fitted = useMemo(() => {
    const f0 = thresholdFrequencyHz(metal.workFunctionEv)
    const samples = Array.from({ length: 24 }, (_, i) => f0 * 1.02 + ((20e14 - f0) * i) / 23)
    const fit = fitStoppingLine(metal.workFunctionEv, samples)
    if (!fit) return null
    return { ...fit, planckJs: fit.slopeVPerHz * ELEMENTARY_CHARGE_C }
  }, [metal.workFunctionEv])

  const band = bandOf(r.wavelengthNm)
  const thresholdUnits = thresholdFrequencyHz(metal.workFunctionEv) / 1e14

  const controls = (
    <>
      <Segmented
        label="Cathode metal (work function, eV)"
        value={metalId}
        options={METAL_OPTIONS}
        onChange={(v) => setMetalId(v)}
      />

      <Slider
        label="Light frequency"
        value={fUnits}
        min={F_MIN_UNITS}
        max={F_MAX_UNITS}
        step={0.05}
        onChange={setFUnits}
        format={(v) =>
          `${v.toFixed(2)}×10¹⁴ Hz · ${wavelengthNmFromFrequencyHz(v * 1e14).toFixed(0)} nm · ${photonEnergyEv(v * 1e14).toFixed(2)} eV`
        }
        hint={`${band} light. ${metal.name} needs ${thresholdUnits.toFixed(2)}×10¹⁴ Hz to emit anything.`}
      />

      <Slider
        label="Beam intensity"
        value={intensity}
        min={0}
        max={1}
        step={0.01}
        onChange={setIntensity}
        format={(v) => `${Math.round(v * 100)}%`}
        hint="More photons per second. Not more energy per photon — that is the whole surprise."
      />

      <Slider
        label="Retarding voltage"
        value={retardingVoltageV}
        min={0}
        max={7}
        step={0.05}
        onChange={setRetardingVoltageV}
        format={(v) => `−${v.toFixed(2)} V`}
        hint="Pushes the electrons back. Raise it until the current dies."
      />

      <ButtonRow>
        <button
          type="button"
          className="btn-primary focus-ring"
          onClick={() => setRunning((v) => !v)}
        >
          {running ? 'Pause' : 'Play'}
        </button>
        <button
          type="button"
          className="btn-ghost focus-ring"
          onClick={() => setFUnits(Math.min(F_MAX_UNITS, Math.max(F_MIN_UNITS, thresholdUnits)))}
        >
          Go to threshold
        </button>
        <button
          type="button"
          className="btn-ghost focus-ring"
          onClick={() => setRetardingVoltageV(Math.min(7, Math.round(r.stoppingVoltageV * 20) / 20))}
        >
          Apply stopping voltage
        </button>
        <button
          type="button"
          className="btn-ghost focus-ring"
          onClick={() => {
            setFUnits(8)
            setIntensity(0.5)
            setRetardingVoltageV(0)
          }}
        >
          Reset
        </button>
      </ButtonRow>

      <div className="grid grid-cols-2 gap-2">
        <Stat label="Photon energy hf" value={`${r.photonEnergyEv.toFixed(2)} eV`} accent="amber" />
        <Stat label="Work function φ" value={`${r.workFunctionEv.toFixed(2)} eV`} accent="violet" />
        <Stat
          label="KE max"
          value={r.emits ? `${r.maxKineticEnergyEv.toFixed(2)} eV` : 'none'}
          accent="teal"
        />
        <Stat
          label="Stopping voltage"
          value={r.emits ? `${r.stoppingVoltageV.toFixed(2)} V` : '0 V'}
          accent="rose"
        />
        <Stat label="Threshold λ" value={`${r.thresholdWavelengthNm.toFixed(0)} nm`} accent="sky" />
        <Stat label="Photocurrent" value={`${Math.round(r.currentFraction * 100)}%`} accent="teal" />
      </div>

      <p className="text-[11px] leading-relaxed text-ink-muted">
        Electron speeds in the tube are real: each one launches with a share of KE max and
        loses energy climbing against the retarding voltage, so the slow ones turn back.
      </p>
    </>
  )

  return (
    <VizFrame
      title="The Photoelectric Effect"
      tagline="Turn the lamp up as far as you like. Below a certain colour, not one electron comes out."
      level="Beginner"
      canvas={
        <div className="p-2">
          <PhotoelectricLab
            readout={r}
            intensity={intensity}
            retardingVoltageV={retardingVoltageV}
            metalLabel={`${metal.name} (${metal.symbol})`}
            running={running}
          />
          <p className="px-3 pb-2 pt-1 text-[11px] text-ink-muted">
            Each dot in the beam is one photon. Blue dots are electrons that got across; rose ones
            are electrons the retarding field turned back before they reached the collector.
          </p>
        </div>
      }
      controls={controls}
    >
      <Explainer title="What to try first">
        <p>
          Start on sodium with the beam at half power. Drag the frequency slider down towards the
          red end and watch the current fall to nothing at 5.51×10¹⁴ Hz — 544 nm, a yellow-green.
          Now turn the intensity to 100%. Nothing comes back. Not a trickle, not a delayed trickle:
          nothing.
        </p>
        <p>
          Then push the frequency back up and raise the retarding voltage until the current dies
          again. Note the voltage. Double the intensity and find it again. It has not moved.
        </p>
      </Explainer>

      <div className="card mb-4 p-6">
        <h2 className="mb-1 text-lg font-bold">Read Planck&rsquo;s constant off the slope</h2>
        <p className="mb-3 text-[15px] leading-relaxed text-ink-secondary">
          Stopping voltage against frequency, for all four metals. Four parallel lines: changing
          the metal slides the line sideways without ever tilting it.
        </p>
        <div className="overflow-x-auto">
          <div className="min-w-[420px]">
            <PhotoelectricSlopePlot activeMetal={metal} frequencyHz={frequencyHz} />
          </div>
        </div>
        {fitted ? (
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Stat
              label="Slope ΔV/Δf"
              value={`${(fitted.slopeVPerHz * 1e15).toFixed(3)}×10⁻¹⁵ V·s`}
              accent="amber"
            />
            <Stat
              label="× e = h"
              value={`${(fitted.planckJs * 1e34).toFixed(3)}×10⁻³⁴ J·s`}
              accent="violet"
            />
            <Stat
              label="Accepted h"
              value={`${(PLANCK_J_S * 1e34).toFixed(3)}×10⁻³⁴ J·s`}
              accent="teal"
            />
          </div>
        ) : null}
        <p className="mt-3 text-[13px] leading-relaxed text-ink-muted">
          The slope figure is a least-squares fit to the plotted points, not a constant typed in —
          but be clear about what that proves. These points were generated from Einstein&rsquo;s
          equation, so recovering h from them is a check on the arithmetic, not on nature. What is
          remarkable is that Robert Millikan, measuring real photocurrents from real alkali metals
          between 1912 and 1916 in an effort to disprove the photon, got the same slope to within
          about one percent of today&rsquo;s value (his 6.57×10⁻²⁷ erg·s against 6.626) — and said
          so in print while still calling the theory
          &ldquo;untenable&rdquo;.
        </p>
      </div>

      <Explainer title="Why this broke classical physics">
        <p>
          Light was a wave, and a wave carries energy in proportion to its amplitude. Shine a
          brighter beam on a metal and each electron should soak up energy faster, so it should
          leave sooner and leave faster. Shine a dim beam and the electrons should still come — you
          would just have to wait while they accumulated enough energy. Frequency should not enter
          into it at all.
        </p>
        <p>
          Every one of those predictions is wrong. Brightness changes how many electrons come out
          and not how fast they move. Frequency changes how fast they move and not how many. And
          below a threshold frequency the wait is not long, it is infinite: the metal sits there in
          a blaze of light and emits nothing.
        </p>
      </Explainer>

      <Explainer title="One photon, one electron">
        <p>
          Einstein&rsquo;s 1905 answer was that light arrives in indivisible lumps of energy hf,
          and that an electron absorbs one whole lump or none. Freeing it from the metal costs a
          fixed toll — the work function φ, a property of the surface — and whatever is left over
          becomes kinetic energy:
        </p>
        <p className="font-mono text-[15px] text-q-amber-text">KE_max = hf − φ</p>
        <p>
          Intensity does not appear in that equation. It sets the number of lumps arriving per
          second, which sets the number of electrons leaving per second — the current — and nothing
          else. If one lump is too small to pay the toll, a million of them per second are still
          each too small, because they cannot pool their energy. That is the threshold, and it is
          the sentence a wave cannot say.
        </p>
      </Explainer>

      <Explainer title="What the stopping voltage measures">
        <p>
          Make the collector negative and it pushes the electrons back. An electron with 1.5 eV of
          kinetic energy can climb 1.5 volts and no further, so as you raise the retarding voltage
          you cut off slower and slower electrons until, at exactly V_stop, even the fastest one
          falls short. The current reaches zero, and eV_stop = KE_max.
        </p>
        <p>
          That is why the graph above is the experiment&rsquo;s payoff rather than a decoration.
          Plot V_stop against f and you get a straight line of slope h/e, the same slope for sodium
          and for platinum — a constant of nature falling out of a voltmeter reading. The metal you
          chose changes only where the line crosses the axis, at f₀ = φ/h.
        </p>
      </Explainer>

      <Explainer title="Where you have already used it">
        <p>
          The photomultiplier tubes that count individual photons in particle detectors are
          photoelectric cells with an amplifier bolted on. So is the light meter that decides your
          phone camera&rsquo;s exposure, and so are the sensors in the automatic doors you walked
          through this week.
        </p>
        <p>
          The same energy accounting explains why ultraviolet light burns skin and radio waves from
          a transmitter a thousand times more powerful do not. Damage is done one photon at a time,
          and a photon that cannot pay the ionisation toll cannot pay it in bulk either. Einstein
          got his Nobel Prize for this paper, not for relativity.
        </p>
      </Explainer>
    </VizFrame>
  )
}
