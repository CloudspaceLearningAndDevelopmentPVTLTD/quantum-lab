'use client'

import { useCallback, useMemo, useState } from 'react'
import ElectronDiffractionLab, {
  DETECTOR_HALF_WIDTH_DEG,
  SCAN_MAX_V,
  SCAN_MIN_V,
  type DetectorCounts,
} from '@/components/viz/ElectronDiffractionLab'
import { VizFrame, Explainer } from '@/components/ui/VizFrame'
import { Segmented, ButtonRow, Slider, Stat } from '@/components/ui/Controls'
import {
  CU_K_ALPHA_NM,
  DEFAULT_ELECTRON_MODEL,
  NI_111_ROW_SPACING_NM,
  deBroglieWavelengthNm,
  electronIntensity,
  equivalentBragg,
  peakAngleDegAtVoltage,
  peakVoltageV,
  xrayPowderPeaks,
  type ElectronModel,
} from '@/lib/viz/electronDiffraction'

/**
 * /visualizations/electron-diffraction — Davisson and Germer, 1927.
 *
 * The page owns the voltage, the detector angle and the prose. Every number it
 * prints comes from lib/viz/electronDiffraction.ts, and the counts come back up
 * from the canvas lab, which fires electrons one at a time from the same
 * intensity function the unit tests hold to the 50° / 54 V result.
 */

type PresetId = 'dg1927' | 'gone' | 'second' | 'custom'

type Preset = { id: PresetId; label: string; voltageV: number; detectorDeg: number }

const PRESETS: Preset[] = [
  { id: 'dg1927', label: '1927: 54 V · 50°', voltageV: 54, detectorDeg: 50 },
  { id: 'gone', label: 'No peak: 30 V', voltageV: 30, detectorDeg: 50 },
  { id: 'second', label: '2nd order: 220 V', voltageV: 220, detectorDeg: 50 },
]

const MIN_DETECTOR_DEG = 10
const MAX_DETECTOR_DEG = 90

const nm = (x: number) => `${x.toFixed(4)} nm`
const pct = (p: number) => `${(p * 100).toFixed(1)}%`

export default function ElectronDiffractionPage() {
  const [voltageV, setVoltageV] = useState(54)
  const [detectorDeg, setDetectorDeg] = useState(50)
  const [rows, setRows] = useState(DEFAULT_ELECTRON_MODEL.rows)
  const [running, setRunning] = useState(true)
  const [resetKey, setResetKey] = useState(0)
  const [counts, setCounts] = useState<DetectorCounts>({ fired: 0, clicks: 0 })

  const onCounts = useCallback((c: DetectorCounts) => setCounts(c), [])

  const model: ElectronModel = useMemo(() => ({ ...DEFAULT_ELECTRON_MODEL, rows }), [rows])

  const lambda = deBroglieWavelengthNm(voltageV)
  const peakDeg = peakAngleDegAtVoltage(voltageV)
  const peakV = peakVoltageV(detectorDeg)
  const bragg = equivalentBragg(peakDeg ?? detectorDeg)
  const reading = electronIntensity(detectorDeg, voltageV, model)
  const fullScale = 0.4
  const orders = [1, 2, 3].map((n) => ({
    n,
    angleDeg: peakAngleDegAtVoltage(voltageV, n),
    voltageV: peakVoltageV(detectorDeg, n),
  }))
  const xrayAtElectron = xrayPowderPeaks(lambda)
  const xrayAtCu = xrayPowderPeaks(CU_K_ALPHA_NM)

  const activePreset: PresetId =
    PRESETS.find((p) => p.voltageV === voltageV && p.detectorDeg === detectorDeg)?.id ?? 'custom'

  const applyPreset = (id: PresetId) => {
    const p = PRESETS.find((x) => x.id === id)
    if (!p) return
    setVoltageV(p.voltageV)
    setDetectorDeg(p.detectorDeg)
  }

  const presetOptions = [
    ...PRESETS.map((p) => ({ value: p.id, label: p.label })),
    ...(activePreset === 'custom' ? [{ value: 'custom' as PresetId, label: 'Custom' }] : []),
  ]

  const canAimAtPeak = peakDeg !== null && peakDeg >= MIN_DETECTOR_DEG && peakDeg <= MAX_DETECTOR_DEG
  const canTuneVoltage = Number.isFinite(peakV) && peakV >= SCAN_MIN_V && peakV <= SCAN_MAX_V

  const controls = (
    <>
      <Segmented<PresetId>
        label="Setups"
        value={activePreset}
        options={presetOptions}
        onChange={applyPreset}
      />

      <Slider
        label="Accelerating voltage"
        value={voltageV}
        min={SCAN_MIN_V}
        max={SCAN_MAX_V}
        step={1}
        onChange={(v) => setVoltageV(Math.round(v))}
        format={(v) => `${v.toFixed(0)} V · λ ${deBroglieWavelengthNm(v).toFixed(3)} nm`}
        hint="Sets the electron's momentum, so its wavelength. Below 32 V the wavelength is longer than the row spacing and no peak can form."
      />

      <Slider
        label="Detector angle"
        value={detectorDeg}
        min={MIN_DETECTOR_DEG}
        max={MAX_DETECTOR_DEG}
        step={1}
        onChange={(v) => setDetectorDeg(Math.round(v))}
        format={(v) => `${v.toFixed(0)}° from the beam`}
        hint={`Degrees between the incident beam and the detector. It accepts electrons within ±${DETECTOR_HALF_WIDTH_DEG}°.`}
      />

      <ButtonRow>
        <button
          type="button"
          className="btn-ghost focus-ring"
          disabled={!canAimAtPeak}
          onClick={() => peakDeg !== null && setDetectorDeg(Math.round(peakDeg))}
        >
          Aim detector at the peak
        </button>
        <button
          type="button"
          className="btn-ghost focus-ring"
          disabled={!canTuneVoltage}
          onClick={() => setVoltageV(Math.round(peakV))}
        >
          Tune voltage to the detector
        </button>
      </ButtonRow>

      <Slider
        label="Surface rows scattering together"
        value={rows}
        min={3}
        max={15}
        step={1}
        onChange={(v) => setRows(Math.round(v))}
        format={(v) => `${v.toFixed(0)} rows`}
        hint="How many rows of the surface a 54 eV electron samples before it is absorbed. More rows, sharper peak; the position does not move."
      />

      <ButtonRow>
        <button
          type="button"
          className="btn-primary focus-ring"
          onClick={() => setRunning((r) => !r)}
        >
          {running ? 'Pause beam' : 'Run beam'}
        </button>
        <button
          type="button"
          className="btn-ghost focus-ring"
          onClick={() => setResetKey((k) => k + 1)}
        >
          Reset counts
        </button>
      </ButtonRow>

      <div className="grid grid-cols-2 gap-2">
        <Stat label="de Broglie λ" value={nm(lambda)} accent="violet" />
        <Stat
          label="Peak angle (n = 1)"
          value={peakDeg === null ? 'none' : `${peakDeg.toFixed(1)}°`}
          accent="teal"
        />
        <Stat label="Detector reads" value={pct(Math.min(1, reading / fullScale))} accent="amber" />
        <Stat
          label="Counted at detector"
          value={counts.fired > 0 ? pct(counts.clicks / counts.fired) : '—'}
          accent="sky"
        />
        <Stat
          label="Peak here at"
          value={Number.isFinite(peakV) ? `${peakV.toFixed(0)} V` : '—'}
          accent="rose"
        />
        <Stat
          label="Bragg form"
          value={`d ${bragg.spacingNm.toFixed(3)} nm · φ ${bragg.glancingAngleDeg.toFixed(0)}°`}
          accent="violet"
        />
      </div>

      <p className="text-[11px] leading-relaxed text-ink-muted">
        &ldquo;Detector reads&rdquo; is the exact model intensity at the detector, as a fraction of
        the polar plot&rsquo;s full scale. &ldquo;Counted&rdquo; is the share of fired electrons that
        actually landed in its ±{DETECTOR_HALF_WIDTH_DEG}° aperture — sampled one at a time, so it
        wanders. &ldquo;Bragg form&rdquo; restates the predicted peak as 2d sin φ = λ.
      </p>
    </>
  )

  return (
    <VizFrame
      title="Davisson–Germer: Electron Diffraction"
      tagline="Fire electrons at a nickel crystal and swing a detector around it. At 54 volts a bump appears at 50° — exactly where a wave 0.167 nm long would put it, and de Broglie had written that number down three years earlier."
      level="Intermediate"
      canvas={
        <div className="p-2">
          <ElectronDiffractionLab
            voltageV={voltageV}
            detectorDeg={detectorDeg}
            model={model}
            running={running}
            resetKey={resetKey}
            onCounts={onCounts}
          />
          <p className="px-3 pb-2 pt-1 text-[11px] leading-relaxed text-ink-muted">
            Top: the gun fires straight down onto the crystal; violet dots are single electrons,
            each scattered at an angle drawn from the model, and they turn amber when they are
            headed into the detector&rsquo;s aperture. The violet lobe is the exact scattered
            intensity, the teal tick is where D sin θ = λ says the first-order peak should be.
            Middle: the detector&rsquo;s reading as the voltage is swept, on a √V axis — the
            orders come out evenly spaced. Bottom: X-rays of the same wavelength on the same
            nickel. Changing the voltage or the angle starts a fresh count. With reduced motion
            on, the counts arrive in batches instead of as moving dots.
          </p>
        </div>
      }
      controls={controls}
    >
      <div className="card mb-6 p-6">
        <h2 className="section-label mb-3">Orders at this voltage and this angle</h2>
        <div className="-mx-2 overflow-x-auto px-2">
          <table className="w-full min-w-[480px] border-collapse text-left text-sm">
            <caption className="sr-only">
              For each diffraction order: the angle it appears at for the current voltage, and the
              voltage that brings it onto the current detector angle.
            </caption>
            <thead>
              <tr className="border-b border-line text-[11px] uppercase tracking-wider text-ink-muted">
                <th scope="col" className="py-2 pr-3 font-bold">Order n</th>
                <th scope="col" className="py-2 pr-3 font-bold">Condition</th>
                <th scope="col" className="py-2 pr-3 text-right font-bold">Angle at {voltageV} V</th>
                <th scope="col" className="py-2 text-right font-bold">Voltage for {detectorDeg}°</th>
              </tr>
            </thead>
            <tbody className="font-mono text-[13px]">
              {orders.map((o) => (
                <tr key={o.n} className="border-b border-line">
                  <th scope="row" className="py-2 pr-3 text-left font-sans font-semibold text-ink">
                    {o.n}
                  </th>
                  <td className="py-2 pr-3 text-ink-secondary">
                    sin θ = {o.n} × {lambda.toFixed(3)} / {NI_111_ROW_SPACING_NM.toFixed(3)}
                  </td>
                  <td className="py-2 pr-3 text-right text-q-teal-text">
                    {o.angleDeg === null ? '— (nλ > D)' : `${o.angleDeg.toFixed(1)}°`}
                  </td>
                  <td className="py-2 text-right text-q-rose-text">
                    {Number.isFinite(o.voltageV) ? `${o.voltageV.toFixed(0)} V` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[13px] text-ink-secondary">
          Each order needs four times the voltage of the one before at a fixed angle, because λ
          falls as 1/√V. That is why the middle plot uses a √V axis: on it the orders are equally
          spaced, which is how Davisson and Germer drew their own figure.
        </p>
      </div>

      <div className="card mb-6 p-6">
        <h2 className="section-label mb-3">X-ray lines from the same nickel</h2>
        <div className="-mx-2 overflow-x-auto px-2">
          <table className="w-full min-w-[520px] border-collapse text-left text-sm">
            <caption className="sr-only">
              Nickel powder diffraction lines: plane indices, spacing, and the 2θ angle at the
              electron&rsquo;s wavelength and at copper K-alpha.
            </caption>
            <thead>
              <tr className="border-b border-line text-[11px] uppercase tracking-wider text-ink-muted">
                <th scope="col" className="py-2 pr-3 font-bold">Planes (hkl)</th>
                <th scope="col" className="py-2 pr-3 text-right font-bold">d</th>
                <th scope="col" className="py-2 pr-3 text-right font-bold">2θ at λ = {lambda.toFixed(3)} nm</th>
                <th scope="col" className="py-2 pr-3 text-right font-bold">2θ at Cu Kα</th>
                <th scope="col" className="py-2 text-right font-bold">Relative intensity</th>
              </tr>
            </thead>
            <tbody className="font-mono text-[13px]">
              {xrayAtCu.slice(0, 5).map((p) => {
                const here = xrayAtElectron.find((q) => q.label === p.label)
                return (
                  <tr key={p.label} className="border-b border-line">
                    <th scope="row" className="py-2 pr-3 text-left font-sans font-semibold text-ink">
                      {p.label}
                    </th>
                    <td className="py-2 pr-3 text-right text-ink-secondary">{p.dNm.toFixed(4)} nm</td>
                    <td className="py-2 pr-3 text-right text-q-sky-text">
                      {here ? `${here.twoThetaDeg.toFixed(1)}°` : '— (λ > 2d)'}
                    </td>
                    <td className="py-2 pr-3 text-right text-ink-muted">{p.twoThetaDeg.toFixed(1)}°</td>
                    <td className="py-2 text-right text-ink-muted">{(p.intensity * 100).toFixed(0)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[13px] text-ink-secondary">
          The Cu Kα column is the standard powder card for nickel (44.5°, 51.8°, 76.4°, 92.9°,
          98.4°); the middle column is the same lattice seen with the electron&rsquo;s wavelength.
          Only planes with h, k, l all odd or all even appear — the face-centring cancels the rest.
        </p>
      </div>

      <Explainer title="Run these three, in this order">
        <p>
          <strong className="text-ink">Swing the detector at 54 V.</strong> Start from the 1927
          setup and drag the detector angle from 10° out to 90°. The reading falls away from the
          beam, then climbs to a bump near 50° and drops again. Watch the amber dots: near 50° a
          steady trickle of electrons is heading into the aperture; at 35° or 65° almost none are.
        </p>
        <p>
          <strong className="text-ink">Park the detector at 50° and sweep the voltage.</strong>{' '}
          Come down to 40 V and the bump has slid outward, past the detector; go up to 65 V and it
          has slid inward. It sits on the detector at about 54 V. Keep raising the voltage: near
          220 V a second, weaker bump arrives at the same angle — the second order, at four times
          the voltage.
        </p>
        <p>
          <strong className="text-ink">Drop to 30 V.</strong> The bump is gone from every angle.
          Not weaker — absent. Below 32 V the electron&rsquo;s wavelength is longer than the
          0.216 nm between rows of nickel atoms, and a grating cannot diffract a wave longer than
          its own spacing anywhere but straight back.
        </p>
      </Explainer>

      <Explainer title="What just happened">
        <p>
          A crystal is a ruler with marks a fraction of a nanometre apart. Anything that
          diffracts from it has a wavelength, and the angle of the peak reads that wavelength off
          the ruler: D sin θ = λ. At 54 V the peak at 50° reads 0.165 nm.
        </p>
        <p>
          In 1924 de Broglie had proposed that a particle of momentum p carries a wave of length
          h/p. An electron that has fallen through 54 volts has a definite momentum, and the
          formula gives 0.167 nm — with no adjustable constant in it, only h, the electron&rsquo;s
          mass and charge, and the voltage on the gun. The crystal measured the wavelength of an
          electron, and it came out where de Broglie said it would to about one percent.
        </p>
        <p>
          That is the whole result. The electrons were not asked to do anything wave-like; the
          crystal simply treated them the way it treats X-rays, and the number matched. The same
          year G. P. Thomson fired faster electrons through thin metal foils and photographed the
          rings X-rays would make. Thomson&rsquo;s father had won the Nobel prize for showing the
          electron is a particle; the son shared one with Davisson for showing it is also a wave.
        </p>
      </Explainer>

      <Explainer title="The two formulas on this page">
        <p>
          <strong className="text-ink">λ = h / √(2 m e V).</strong> Kinetic energy eV, momentum
          √(2m·eV), wavelength h over that. In nanometres and volts it collapses to λ ≈ 1.226/√V,
          which is worth memorising: 100 V is 0.123 nm, about the size of an atom, and that is why
          electron microscopes see atoms.
        </p>
        <p>
          <strong className="text-ink">D sin θ = nλ.</strong> The rows of atoms on the (111)
          surface, D = 0.216 nm apart, act as a reflection grating for electrons that only get a
          few layers deep. Textbooks often quote the same peak as Bragg&rsquo;s law, 2d sin φ = λ
          with d = 0.091 nm and φ = 65°. Those are not a different nickel: d = D sin(θ/2) is the
          spacing of the planes that bisect the incoming and outgoing beams, and φ = 90° − θ/2 is
          the glancing angle on them. The &ldquo;Bragg form&rdquo; readout above converts one into
          the other, and the two are the same equation.
        </p>
      </Explainer>

      <Explainer title="Same crystal, X-rays">
        <p>
          The bottom panel is what X-rays of the electron&rsquo;s wavelength do to nickel. It
          looks nothing like the top one: a comb of sharp lines instead of one broad bump. X-rays
          pass through microns of metal, so they diffract from the full three-dimensional lattice,
          every family of planes (111), (200), (220)… adding its own line at 2d sin θ = λ. A
          54 eV electron is stopped within a couple of atomic layers and sees only the surface
          rows — a one-dimensional grating a handful of rows wide, hence one peak, and a wide one.
        </p>
        <p>
          The comparison is the point of the panel, not a claim that the two pictures should
          match. The electrons and the X-rays agree about the size of the ruler; they disagree
          about how much of it they can see.
        </p>
      </Explainer>

      <Explainer title="Nickel, 1927">
        <p>
          Clinton Davisson and Lester Germer were not looking for electron waves. At Bell Labs
          they were mapping how electrons bounce off nickel, and in 1925 a liquid-air bottle burst
          in the lab and oxidised their target. They cleaned it by baking it at high temperature,
          which turned the fine-grained polycrystalline nickel into a handful of large crystals —
          and the smooth scattering curves they had been recording sprouted bumps.
        </p>
        <p>
          It took Davisson a trip to the 1926 Oxford meeting of the British Association, where
          Born was talking about de Broglie&rsquo;s waves and Schrödinger&rsquo;s equation, to
          realise what the bumps were. He and Germer went back, cut a single crystal to expose the
          (111) face, fired electrons straight at it and swung a Faraday cup around the beam —
          the arrangement drawn above — and found the 54 V / 50° peak in early 1927.
        </p>
      </Explainer>

      <Explainer title="What is and isn't real here">
        <p>
          The geometry, the wavelength formula, the row spacing and the grating condition are the
          real experiment&rsquo;s, and the numbers are checked in
          <code className="mx-1 rounded bg-surface-3 px-1 py-0.5 text-[12px]">
            lib/viz/electronDiffraction.test.ts
          </code>
          against de Broglie&rsquo;s 0.167 nm, Davisson and Germer&rsquo;s 50°, 54 V and 2.15 Å,
          and the published Cu Kα powder card for nickel.
        </p>
        <p>
          The <em>shape</em> of the intensity curve is a model: a finite grating of a few rows
          under a falling single-atom scattering amplitude, plus a smooth background. It puts the
          peak in the right place with the right width; it does not reproduce the finer structure
          of the real polar plots, which need multiple scattering and the crystal&rsquo;s inner
          potential. That inner potential is also why the model peak sits at 50.7° while the
          measured one was at 50°: the electron is refracted as it enters the metal, and the 1927
          paper spends a section on exactly that.
        </p>
        <p>
          The X-ray panel is a powder pattern — many small crystals at every orientation — not
          the single crystal above, because that is the form in which nickel&rsquo;s X-ray lines
          are tabulated and checkable. Line positions are exact; the relative heights leave out
          thermal motion and absorption and are only approximate.
        </p>
      </Explainer>
    </VizFrame>
  )
}
