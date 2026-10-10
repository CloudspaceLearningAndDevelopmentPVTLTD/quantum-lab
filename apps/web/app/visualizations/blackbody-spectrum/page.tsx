'use client'

import { useMemo, useState } from 'react'
import BlackbodyLab from '@/components/viz/BlackbodyLab'
import { VizFrame, Explainer } from '@/components/ui/VizFrame'
import { Slider, Segmented, Toggle, ButtonRow, Stat } from '@/components/ui/Controls'
import {
  REFERENCE_TEMPERATURES,
  VISIBLE_BAND_NM,
  stefanBoltzmannExitance,
  visibleFraction,
  wienPeakWavelengthNm,
} from '@/lib/viz/blackbody'

/** The slider carries log₁₀(T) so 2.7 K and 12 000 K are both reachable by hand. */
const LOG_MIN = 0.3
const LOG_MAX = 4.1

const PRESET_OPTIONS = REFERENCE_TEMPERATURES.map((t) => ({ value: t.id, label: t.label }))

function formatTemperature(k: number): string {
  if (k < 10) return `${k.toFixed(2)} K`
  if (k < 100) return `${k.toFixed(1)} K`
  return `${Math.round(k).toLocaleString('en-US')} K`
}

function formatWavelength(nm: number): string {
  if (!Number.isFinite(nm)) return '—'
  if (nm < 1000) return `${nm < 10 ? nm.toFixed(1) : Math.round(nm)} nm`
  if (nm < 1e6) return `${(nm / 1000).toFixed(nm < 1e4 ? 2 : 1)} µm`
  return `${(nm / 1e6).toFixed(2)} mm`
}

function formatPower(wPerM2: number): string {
  if (wPerM2 >= 1e9) return `${(wPerM2 / 1e9).toFixed(1)} GW/m²`
  if (wPerM2 >= 1e6) return `${(wPerM2 / 1e6).toFixed(1)} MW/m²`
  if (wPerM2 >= 1e3) return `${(wPerM2 / 1e3).toFixed(1)} kW/m²`
  if (wPerM2 >= 0.01) return `${wPerM2.toFixed(2)} W/m²`
  return `${wPerM2.toExponential(1)} W/m²`
}

function formatFraction(f: number): string {
  if (f <= 0) return '0%'
  if (f < 1e-4) return `${(f * 100).toExponential(1)}%`
  return `${(f * 100).toFixed(f < 0.01 ? 3 : 1)}%`
}

export default function BlackbodySpectrumPage() {
  const [logT, setLogT] = useState(Math.log10(5778))
  const [showClassical, setShowClassical] = useState(true)
  const [logScale, setLogScale] = useState(false)

  const temperatureK = Math.pow(10, logT)

  const stats = useMemo(
    () => ({
      peakNm: wienPeakWavelengthNm(temperatureK),
      totalPower: stefanBoltzmannExitance(temperatureK),
      visible: visibleFraction(temperatureK),
    }),
    [temperatureK]
  )

  // Which preset, if any, the slider is currently sitting on.
  const activePreset =
    REFERENCE_TEMPERATURES.find((t) => Math.abs(Math.log10(t.kelvin) - logT) < 1e-6) ?? null

  const controls = (
    <>
      <Segmented
        label="Reference temperatures"
        value={activePreset?.id ?? ''}
        options={PRESET_OPTIONS}
        onChange={(id) => {
          const preset = REFERENCE_TEMPERATURES.find((t) => t.id === id)
          if (preset) setLogT(Math.log10(preset.kelvin))
        }}
      />

      <Slider
        label="Temperature"
        value={logT}
        min={LOG_MIN}
        max={LOG_MAX}
        step={0.002}
        onChange={setLogT}
        format={() => formatTemperature(temperatureK)}
        hint="Logarithmic, so the microwave background and a blue star are both a drag away."
      />

      <Toggle
        label="Show the classical prediction"
        checked={showClassical}
        onChange={setShowClassical}
        hint="Rayleigh–Jeans, drawn dashed. It runs off the top of the frame and never comes back."
      />

      <Toggle
        label="Logarithmic wavelength axis"
        checked={logScale}
        onChange={setLogScale}
        hint="Compresses the long infrared tail so the whole curve fits at once."
      />

      <ButtonRow>
        <button
          type="button"
          className="btn-ghost focus-ring"
          onClick={() => {
            setLogT(Math.log10(5778))
            setShowClassical(true)
            setLogScale(false)
          }}
        >
          Reset
        </button>
      </ButtonRow>

      <div className="grid grid-cols-2 gap-2">
        <Stat label="Wien peak" value={formatWavelength(stats.peakNm)} accent="amber" />
        <Stat label="Total power σT⁴" value={formatPower(stats.totalPower)} accent="violet" />
        <Stat label="Visible share" value={formatFraction(stats.visible)} accent="teal" />
        <Stat label="Classical total" value="infinite" accent="rose" />
      </div>

      {activePreset ? (
        <p className="text-[11px] leading-relaxed text-ink-muted">{activePreset.note}</p>
      ) : (
        <p className="text-[11px] leading-relaxed text-ink-muted">
          Every warm object radiates this spectrum, you included — at 310 K your peak sits near 9
          µm, which is exactly the band a thermal camera looks in.
        </p>
      )}
    </>
  )

  return (
    <VizFrame
      title="Blackbody Radiation"
      tagline="The classical curve does not overshoot slightly. It goes to infinity — and fixing that took quantising light itself."
      level="Beginner"
      canvas={
        <div className="p-2">
          <BlackbodyLab
            temperatureK={temperatureK}
            showClassical={showClassical}
            logScale={logScale}
          />
          <p className="px-3 pb-2 pt-1 text-[11px] text-ink-muted">
            The violet curve is Planck&rsquo;s law; the dashed rose curve is what classical physics
            predicts. Heights are shown relative to the Planck peak, whose absolute value is printed
            above the plot — the classical curve is clipped at the top of the frame because on a
            linear axis it would be off the screen and off the building.
          </p>
        </div>
      }
      controls={controls}
    >
      <Explainer title="What to try first">
        <p>
          Start at the Sun&rsquo;s 5 778 K. Look at where the two curves sit on the right of the
          plot: in the infrared they lie on top of each other, and the classical theory is not
          merely close, it is correct. Now follow them leftwards towards shorter wavelengths. The
          Planck curve turns over and dives. The classical one keeps climbing, leaves the top of
          the frame, and never comes down.
        </p>
        <p>
          Then drag the temperature. Watch the amber Wien marker slide left as things get hotter,
          and watch the visible share in the panel: 8% at a light-bulb filament&rsquo;s 2 800 K,
          44% at the surface of the Sun, and back down to 39% for Sirius, whose peak has already
          run past the short end of the visible band into the ultraviolet. That share peaks at about
          47%, near 7 000 K — drag across it and see. The Sun sits within a couple of points of the
          best a hot object can do for an eye like yours, which is not a coincidence about the Sun.
        </p>
      </Explainer>

      <Explainer title="Why the classical answer was infinity">
        <p>
          Treat the radiation in a hot cavity as a set of standing waves, give each one the kT of
          energy that classical equipartition demands, and count the waves. Short wavelengths fit
          into the box in far more ways than long ones — the number of modes grows without limit as
          the wavelength shrinks. Every one of them gets its kT.
        </p>
        <p>
          The result is the Rayleigh–Jeans law, 2ckT/λ⁴, and its total energy is the integral of
          that from zero upwards, which does not converge. Classical physics predicts that a warm
          cavity contains infinite energy and that opening it would sterilise the room with
          ultraviolet. Ehrenfest named it the ultraviolet catastrophe. It was not a rounding error;
          it was a theory returning ∞ for a quantity you can measure with a thermometer.
        </p>
      </Explainer>

      <Explainer title="What Planck actually did">
        <p>
          In 1900 Planck found a formula that fitted the measured curve, and then spent two months
          working out what would have to be true for it to come out of the physics. The answer was
          that a cavity wall can only exchange energy with a mode in whole multiples of hf.
        </p>
        <p>
          That single assumption kills the catastrophe by making short wavelengths expensive. A mode
          at short λ has a large hf, so at temperature T the thermal energy available is not enough
          to buy even one quantum, and the mode sits empty instead of collecting its classical kT.
          The exponential in the denominator of Planck&rsquo;s law is that suppression. At long
          wavelengths hf is small compared with kT, quanta are cheap, and the formula collapses back
          into Rayleigh–Jeans exactly — which is why the two curves coincide on the right of the
          plot.
        </p>
        <p>
          Planck called it &ldquo;an act of desperation&rdquo; and spent years trying to derive his
          own result without it. He never could. This is the moment quantum mechanics starts.
        </p>
      </Explainer>

      <Explainer title="Two laws you can read off the plot">
        <p>
          <strong className="text-q-amber-text">Wien&rsquo;s displacement law.</strong> The peak
          sits at λ = b/T with b = 2.898 × 10⁻³ m·K, so double the temperature and the peak halves
          its wavelength. That is the whole of astronomical colour: a star&rsquo;s hue is a
          thermometer reading. Sirius peaks at {formatWavelength(wienPeakWavelengthNm(9940))},
          already ultraviolet, and looks blue-white because we only see the long tail of it.
        </p>
        <p>
          <strong className="text-q-violet-text">Stefan–Boltzmann.</strong> Integrate the whole
          curve and the total power comes to σT⁴ — the fourth power, so a doubling in temperature is
          a sixteen-fold jump in output. Both laws only exist because the integral converges. Try to
          derive a Stefan–Boltzmann constant from the classical curve and you get infinity, which is
          why σ has an h in it: σ = 2π⁵k⁴/15c²h³.
        </p>
      </Explainer>

      <Explainer title="Why your light bulb is a heater">
        <p>
          Set the slider to the 2 800 K of an incandescent filament and read the visible share. Only
          8% of the output lands between {VISIBLE_BAND_NM.min} and {VISIBLE_BAND_NM.max} nm; the
          rest is infrared, which is to say heat. A real bulb does worse still — tungsten is not
          quite a blackbody and the glass absorbs some of what does get out — but the ceiling is set
          by this curve, not by the engineering. You cannot fix it by improving the bulb, because
          the spectrum follows the filament&rsquo;s temperature and tungsten melts at 3 695 K. The
          only way out was to stop using a hot object as a light source at all, which is what an LED
          is.
        </p>
        <p>
          The same curve explains why a thermal camera works in the dark (at 310 K your peak is
          around 9 µm, and the camera is simply an infrared eye), and why the cosmic microwave
          background is the best blackbody ever measured — its spectrum matches Planck&rsquo;s law
          to a few parts in 100 000, at 2.7 K, from radiation that last scattered 13.8 billion years
          ago.
        </p>
      </Explainer>
    </VizFrame>
  )
}
