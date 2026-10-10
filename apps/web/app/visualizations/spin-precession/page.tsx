'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import SpinPrecessionLab, { type SpinStats } from '@/components/viz/SpinPrecessionLab'
import { VizFrame, Explainer } from '@/components/ui/VizFrame'
import { Segmented, Slider, ButtonRow, Stat, Toggle } from '@/components/ui/Controls'
import { prefersReducedMotion } from '@/components/viz/frameLoop'
import {
  RF_PHASE_RX,
  RF_PHASE_RY,
  SPIN_SPECIES,
  equivalentGateLabel,
  gammaRadPerSecPerTesla,
  generalizedRabiFrequency,
  larmorFrequencyHz,
  maxTransitionProbability,
  speciesById,
  type SpinSpecies,
} from '@/lib/viz/spinPrecession'

/**
 * /visualizations/spin-precession
 *
 * The existing Bloch-sphere page is a map of states. This one puts a field on
 * that map and lets it move, because everything a single-qubit gate does is a
 * spin turning in a magnetic field — the same equation, whether the hardware is
 * an MRI scanner or a transmon.
 *
 * Two modes rather than one wall of sliders: precession first (a static field,
 * and the discovery that it can tilt a spin's phase but never flip it), then
 * the resonant drive (an RF field, Rabi oscillation, and the identification of
 * a π pulse with the X gate). The mode switch also keeps the physics honest —
 * a resonant drive is only defined against a field along z, so the tilt control
 * and the RF controls are never live at the same time.
 */

const B0_REFERENCE_T = 1.5
/** Screen seconds per Larmor turn at the reference field. Mirrors the lab. */
const LAB_SCREEN_PERIOD = 1.35
/** Screen seconds per Rabi cycle in the rotating view. Mirrors the lab. */
const ROTATING_SCREEN_PERIOD = 3.2

type Mode = 'precession' | 'drive'

const MODE_OPTIONS: { value: Mode; label: string }[] = [
  { value: 'precession', label: 'Static field' },
  { value: 'drive', label: 'RF drive' },
]

const FRAME_OPTIONS: { value: 'lab' | 'rotating'; label: string }[] = [
  { value: 'lab', label: 'Lab frame' },
  { value: 'rotating', label: 'Rotating frame' },
]

const PHASE_OPTIONS: { value: 'x' | 'y'; label: string }[] = [
  { value: 'x', label: 'x pulse → RX' },
  { value: 'y', label: 'y pulse → RY' },
]

const SPECIES_OPTIONS = SPIN_SPECIES.map((s) => ({ value: s.id, label: s.label }))

/** Frequency in Hz as a readable string with the right SI prefix. */
function formatFrequency(hz: number): string {
  const abs = Math.abs(hz)
  if (abs >= 1e9) return `${(hz / 1e9).toFixed(3)} GHz`
  if (abs >= 1e6) return `${(hz / 1e6).toFixed(3)} MHz`
  if (abs >= 1e3) return `${(hz / 1e3).toFixed(2)} kHz`
  return `${hz.toFixed(1)} Hz`
}

/** A duration in seconds as a readable string. */
function formatTime(seconds: number): string {
  const abs = Math.abs(seconds)
  if (abs < 1e-9) return `${(seconds * 1e12).toFixed(2)} ps`
  if (abs < 1e-6) return `${(seconds * 1e9).toFixed(2)} ns`
  if (abs < 1e-3) return `${(seconds * 1e6).toFixed(2)} µs`
  if (abs < 1) return `${(seconds * 1e3).toFixed(2)} ms`
  return `${seconds.toFixed(2)} s`
}

/** Field in tesla, shown in mT once it drops below a tenth of a tesla. */
function formatField(tesla: number): string {
  return tesla < 0.1 ? `${(tesla * 1000).toFixed(1)} mT` : `${tesla.toFixed(3)} T`
}

const pct = (p: number) => `${(p * 100).toFixed(1)}%`

export default function SpinPrecessionPage() {
  const [mode, setMode] = useState<Mode>('precession')
  const [speciesId, setSpeciesId] = useState<SpinSpecies['id']>('proton')
  const [b0Tesla, setB0Tesla] = useState(1.5)
  const [tiltDeg, setTiltDeg] = useState(35)
  const [b1Percent, setB1Percent] = useState(12)
  const [detuningRatio, setDetuningRatio] = useState(0)
  const [phaseChoice, setPhaseChoice] = useState<'x' | 'y'>('x')
  const [frame, setFrame] = useState<'lab' | 'rotating'>('lab')
  const [showCone, setShowCone] = useState(true)
  const [running, setRunning] = useState(true)
  const [resetKey, setResetKey] = useState(0)
  const [pulse, setPulse] = useState<{ angle: number } | null>(null)
  const [stats, setStats] = useState<SpinStats>({
    v: [0, 0, 1],
    probabilityOne: 0,
    cone: 0,
    simTime: 0,
    driveTime: 0,
    pulseActive: false,
  })

  const onStats = useCallback((s: SpinStats) => setStats(s), [])

  // A11Y: a page whose whole content is a moving arrow should not start moving
  // for someone who has asked their system for less motion. Done in an effect
  // rather than in the useState initialiser because the server has no
  // matchMedia — initialising from it there would render "Pause" on the server
  // and "Play" on the client, which is a hydration mismatch. Every control
  // still works either way; Play is one keypress away.
  useEffect(() => {
    if (prefersReducedMotion()) setRunning(false)
  }, [])

  const species = speciesById(speciesId)
  const gamma = gammaRadPerSecPerTesla(species)
  const driving = mode === 'drive'
  const b1Ratio = b1Percent / 100
  const b1Tesla = b1Ratio * b0Tesla
  const drivePhase = phaseChoice === 'x' ? RF_PHASE_RX : RF_PHASE_RY

  const f0 = larmorFrequencyHz(gamma, b0Tesla)
  const omega0 = 2 * Math.PI * f0
  const omega1 = gamma * b1Tesla
  const detuning = detuningRatio * omega1
  const omegaGeneralized = generalizedRabiFrequency(omega1, detuning)
  const maxFlip = maxTransitionProbability(omega1, detuning)

  const reset = () => {
    setResetKey((k) => k + 1)
    setPulse(null)
  }

  const changeMode = (next: Mode) => {
    setMode(next)
    setFrame(next === 'drive' ? 'rotating' : 'lab')
    setResetKey((k) => k + 1)
    setPulse(null)
  }

  /**
   * How much real time one second of screen time stands for.
   *
   * A proton at 1.5 T turns 64 million times a second, so the animation runs on
   * a compressed clock. Saying so — with the number — is the difference between
   * a teaching tool and a screensaver.
   */
  const compression = useMemo(() => {
    if (frame === 'rotating' && omegaGeneralized > 0) {
      const realPeriod = (2 * Math.PI) / omegaGeneralized
      return realPeriod / ROTATING_SCREEN_PERIOD
    }
    const b0Units = b0Tesla / B0_REFERENCE_T
    const screenPeriod = LAB_SCREEN_PERIOD / Math.max(1e-6, b0Units)
    return f0 > 0 ? 1 / f0 / screenPeriod : 0
  }, [frame, omegaGeneralized, b0Tesla, f0])

  // The lab keeps time in dimensionless units where ω₀(sim) = B₀/B₀(reference).
  // A simulated interval Δτ turns the spin through ω₀(sim)·Δτ radians, and the
  // real interval that turns it through the same angle is Δτ·ω₀(sim)/ω₀(real).
  // Getting this backwards would put a plausible but wrong pulse length under
  // the gate readout, which is the one number on this page a reader might
  // actually take away and use.
  const b0Units = b0Tesla / B0_REFERENCE_T
  const realDriveSeconds = omega0 > 0 ? (stats.driveTime * b0Units) / omega0 : 0
  const gateLabel = equivalentGateLabel(omega1, realDriveSeconds, drivePhase)

  const controls = (
    <>
      <Segmented<Mode> label="What is on" value={mode} options={MODE_OPTIONS} onChange={changeMode} />

      <Segmented<SpinSpecies['id']>
        label="Spin"
        value={speciesId}
        options={SPECIES_OPTIONS}
        onChange={(v) => {
          setSpeciesId(v)
          reset()
        }}
      />

      <Slider
        label="Static field B₀"
        value={b0Tesla}
        min={0.3}
        max={3}
        step={0.05}
        format={(v) => `${v.toFixed(2)} T`}
        onChange={setB0Tesla}
        hint="A clinical MRI scanner is 1.5 or 3 T. Watch the arrow speed up."
      />

      {!driving ? (
        <>
          <Slider
            label="Field tilt from |0⟩"
            value={tiltDeg}
            min={0}
            max={90}
            step={1}
            format={(v) => `${v.toFixed(0)}°`}
            onChange={setTiltDeg}
            hint="Tips the precession axis. The cone half-angle never changes on its own."
          />
          <Toggle
            label="Show the precession cone"
            checked={showCone}
            onChange={setShowCone}
            hint="The dashed circle is the path the spin is locked onto."
          />
        </>
      ) : (
        <>
          <Segmented<'lab' | 'rotating'>
            label="Point of view"
            value={frame}
            options={FRAME_OPTIONS}
            onChange={setFrame}
          />
          <Slider
            label="RF amplitude B₁"
            value={b1Percent}
            min={2}
            max={25}
            step={0.5}
            format={(v) => `${formatField((v / 100) * b0Tesla)} · ${v.toFixed(1)}% of B₀`}
            onChange={setB1Percent}
            hint="Exaggerated: a real scanner uses a millionth of this, and takes as many turns."
          />
          <Slider
            label="Detuning Δ"
            value={detuningRatio}
            min={-3}
            max={3}
            step={0.05}
            format={(v) => `${v.toFixed(2)} × ω₁ · ${formatFrequency((v * omega1) / (2 * Math.PI))}`}
            onChange={setDetuningRatio}
            hint="How far the drive frequency misses the Larmor frequency."
          />
          <Segmented<'x' | 'y'>
            label="RF phase"
            value={phaseChoice}
            options={PHASE_OPTIONS}
            onChange={setPhaseChoice}
          />
        </>
      )}

      <ButtonRow>
        <button type="button" className="btn-primary focus-ring" onClick={() => setRunning((r) => !r)}>
          {running ? 'Pause' : 'Play'}
        </button>
        {driving ? (
          <>
            <button
              type="button"
              className="btn-ghost focus-ring"
              onClick={() => setPulse({ angle: Math.PI / 2 })}
            >
              π/2 pulse
            </button>
            <button
              type="button"
              className="btn-ghost focus-ring"
              onClick={() => setPulse({ angle: Math.PI })}
            >
              π pulse
            </button>
          </>
        ) : null}
        <button type="button" className="btn-ghost focus-ring" onClick={reset}>
          Reset
        </button>
      </ButtonRow>

      <div className="grid grid-cols-2 gap-2">
        <Stat label="Larmor f₀" value={formatFrequency(f0)} accent="sky" />
        <Stat label="1 s on screen" value={formatTime(compression)} accent="violet" />
        {driving ? (
          <>
            <Stat label="Rabi f₁" value={formatFrequency(omega1 / (2 * Math.PI))} accent="teal" />
            <Stat label="Max flip" value={pct(maxFlip)} accent="amber" />
            <Stat label="P(|1⟩) now" value={pct(stats.probabilityOne)} accent="rose" />
            <Stat label="Pulse so far" value={gateLabel} accent="violet" />
          </>
        ) : (
          <>
            <Stat
              label="Cone half-angle"
              value={`${((stats.cone * 180) / Math.PI).toFixed(1)}°`}
              accent="amber"
            />
            <Stat label="P(|1⟩)" value={pct(stats.probabilityOne)} accent="rose" />
            <Stat label="One turn takes" value={formatTime(f0 > 0 ? 1 / f0 : 0)} accent="teal" />
            <Stat label="γ / 2π" value={`${species.gammaMHzPerT.toFixed(2)} MHz/T`} accent="violet" />
          </>
        )}
      </div>

      <p className="text-[11px] leading-relaxed text-ink-muted">
        {species.label} — {species.note}. The simulation integrates dv/dt = γ(v × B) directly, with
        the full time-dependent RF field and no rotating-wave approximation.
      </p>
    </>
  )

  return (
    <VizFrame
      title="Spin Precession and Rabi Flopping"
      tagline="Put a magnetic field on the Bloch sphere and the arrow starts to turn. Add a resonant radio wave and you have an X gate."
      level="Intermediate"
      canvas={
        <div className="p-2">
          <SpinPrecessionLab
            b0={b0Tesla / B0_REFERENCE_T}
            tilt={driving ? 0 : (tiltDeg * Math.PI) / 180}
            b1Ratio={b1Ratio}
            detuningRatio={detuningRatio}
            drivePhase={drivePhase}
            driveOn={driving}
            frame={frame}
            showCone={showCone}
            running={running}
            resetKey={resetKey}
            pulse={pulse}
            onStats={onStats}
          />
          <p className="px-3 pb-2 pt-1 text-[11px] text-ink-muted">
            Violet is the spin, amber is the field it precesses about, and the dashed circle is the
            cone it is locked onto. On the right, the simulated population sits underneath the
            dashed closed-form Rabi curve — two different routes to the same number.
          </p>
        </div>
      }
      controls={controls}
    >
      <Explainer title="A field makes a spin turn, not fall over">
        <p>
          Drop a spinning top and it does not topple; it precesses, tracing a slow cone about the
          vertical. A spin in a magnetic field does exactly the same thing, for exactly the same
          reason — the field applies a torque perpendicular to the spin, so the spin moves sideways
          rather than toward the field.
        </p>
        <p>
          Start on <strong>Static field</strong>, tilt the field, and watch the cone. The half-angle
          never changes, no matter how long you wait or how strong you make B₀. A static field can
          rotate a spin around forever and never flip it — which is worth sitting with, because it
          is the reason single-qubit control needs a second, much weaker field.
        </p>
        <p>
          What B₀ <em>does</em> control is the speed: ω₀ = γB₀, the Larmor frequency, linear in the
          field and independent of everything else. Drag B₀ from 0.3 T to 3 T and the arrow speeds up
          by a factor of ten. At 1.5 T a proton turns 63.87 million times a second, which is why the
          animation runs on a compressed clock and says so in the readout.
        </p>
      </Explainer>

      <Explainer title="Why an MRI scanner is tuned to 64 MHz">
        <p>
          The whole of magnetic resonance imaging is in that one number. Put a body in a 1.5 T
          magnet, and every hydrogen nucleus in it precesses at 63.87 MHz — an FM radio frequency.
          Broadcast at that frequency and the protons absorb; broadcast a hundred kilohertz off and
          they largely ignore you.
        </p>
        <p>
          Switch the species to ¹³C and the frequency drops by a factor of four in the same field,
          which is why an NMR spectrometer has a separate channel for every nucleus. Switch to the
          electron and it jumps by 658×, into the microwave band — which is why electron-spin
          qubits are driven by the same hardware that runs a Wi-Fi router, and nuclear ones by
          something closer to a shortwave transmitter.
        </p>
        <p>
          Because ω₀ is strictly proportional to B, adding a deliberate spatial gradient to the
          magnet makes the resonant frequency a position label. That is the entire idea behind
          imaging: the scanner is not measuring where the signal came from, it is measuring what
          frequency it came back at.
        </p>
      </Explainer>

      <Explainer title="The trick: hit it at exactly the right frequency">
        <p>
          Switch to <strong>RF drive</strong>. A second, much weaker field B₁ now rotates in the
          plane, going round at the drive frequency. Off resonance it is useless — it pushes the
          spin one way, the spin precesses out from under it, and the next push cancels the last.
        </p>
        <p>
          On resonance the pushes line up. Every turn the spin makes, the drive is exactly where it
          needs to be, and the tiny nudges accumulate into a full flip. Set the detuning to zero and
          watch the population climb all the way to 1; then detune by one Rabi frequency and watch
          the ceiling drop to exactly 50%, however long you drive. The formula for that ceiling is
          ω₁²/(ω₁² + Δ²), and it is drawn dashed over the simulated curve on the right.
        </p>
        <p>
          Notice which way the trade goes: detuning makes the oscillation <em>faster</em> (the
          generalised Rabi frequency is √(ω₁² + Δ²)) and <em>shallower</em> at the same time. That
          combination is the reason a real pulse has to be calibrated in both amplitude and
          frequency, and the reason a miscalibrated gate leaks population instead of simply doing
          nothing.
        </p>
      </Explainer>

      <Explainer title="This is the RX gate — not an analogy for it">
        <p>
          Flip the point of view to <strong>Rotating frame</strong>. The fast precession disappears,
          because you are now turning with the drive, and what is left is a static field pointing
          along x. The spin just rotates about it, steadily, at ω₁ = γB₁.
        </p>
        <p>
          A rotation about a fixed axis by an angle proportional to elapsed time is precisely what{' '}
          <code className="rounded bg-surface-3 px-1 py-0.5 font-mono text-[13px]">RX(θ)</code> means
          in the{' '}
          <Link href="/simulator" className="focus-ring rounded text-q-violet-text underline decoration-dotted underline-offset-2">
            circuit simulator
          </Link>
          . Drive for θ/ω₁ seconds and you have applied RX(θ). Press <strong>π pulse</strong> and the
          spin lands on |1⟩: that is the X gate. Press <strong>π/2 pulse</strong> and it stops on the
          equator, in an equal superposition — the gate the simulator calls √X.
        </p>
        <p>
          The RF phase control is where the other axes come from. Shift the drive by 90° and the
          static field in the rotating frame points along y instead, so the same pulse now
          implements RY. And with the drive off entirely, free precession about B₀ is a rotation
          about z at ω₀ — an RZ gate that costs nothing but time, which is why real hardware often
          implements RZ by relabelling the phase of every later pulse instead of doing anything at
          all.
        </p>
      </Explainer>

      <Explainer title="What the numbers on screen are not">
        <p>
          Two honest caveats. First, B₁ here runs to a quarter of B₀; a real scanner uses something
          like a millionth, so a real 90° pulse takes hundreds of thousands of precession turns
          rather than four. The exaggeration is what makes the nutation visible in one screen; the
          physics is otherwise unmodified, and every frequency in the readouts is the true value for
          the fields shown.
        </p>
        <p>
          Second, this is one perfectly isolated spin. Nothing here decays. A real spin loses its
          transverse phase in milliseconds (T₂) and returns to alignment in seconds (T₁), and it is
          that decay — not the precession — that carries the contrast in an MRI image. The{' '}
          <Link href="/visualizations/decoherence" className="focus-ring rounded text-q-violet-text underline decoration-dotted underline-offset-2">
            decoherence visualization
          </Link>{' '}
          is where that part lives.
        </p>
      </Explainer>
    </VizFrame>
  )
}
