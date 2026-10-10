'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import WavePacketsLab, { WP_GRID, type PacketStats } from '@/components/viz/WavePacketsLab'
import { VizFrame, Explainer } from '@/components/ui/VizFrame'
import { Segmented, Slider, Toggle, ButtonRow, Stat } from '@/components/ui/Controls'
import { freeSpreadWidth, rectangularBarrierTransmission } from '@/lib/quantum/schrodinger'

type Preset = 'free' | 'barrier' | 'well' | 'step' | 'double'

const PRESETS: { value: Preset; label: string }[] = [
  { value: 'free', label: 'Free' },
  { value: 'barrier', label: 'Barrier' },
  { value: 'well', label: 'Well' },
  { value: 'step', label: 'Step' },
  { value: 'double', label: 'Double' },
]

/**
 * Where the packet starts, and the widest packet allowed.
 *
 * These two numbers are coupled and neither is arbitrary. The grid runs to ±60 and its
 * outer 9% at each end absorbs, so the left absorber begins near x = −49. A packet must
 * start with negligible density both at that absorber (or it is eaten before it has
 * travelled) and at the obstacle around x = 0 (or the "incoming" packet was never
 * entirely incoming). At σ = 5 and x₀ = −28 the density is 5e−5 of peak at the absorber
 * and 6e−8 at the barrier edge — both far below anything the readouts can notice.
 */
const LAUNCH_X = -28
const SIGMA_MAX = 5
/** Brush radius, in the same length units as the grid. */
const BRUSH = 1.1
/** Hard limits on a drawn potential, so a stray drag cannot produce a numerically silly V. */
const V_MIN = -4
const V_MAX = 6

function buildPreset(preset: Preset, height: number, width: number): Float64Array {
  const v = new Float64Array(WP_GRID.n)
  const half = width / 2
  for (let i = 0; i < WP_GRID.n; i++) {
    const x = WP_GRID.x[i]
    switch (preset) {
      case 'barrier':
        v[i] = Math.abs(x) <= half ? height : 0
        break
      case 'well':
        v[i] = Math.abs(x) <= half ? -height : 0
        break
      case 'step':
        v[i] = x >= 0 ? height : 0
        break
      case 'double': {
        // Two barriers with a gap of the same width between them: a resonant cavity.
        const inner = half
        const outer = half + width
        v[i] = Math.abs(x) >= inner && Math.abs(x) <= outer ? height : 0
        break
      }
      default:
        v[i] = 0
    }
  }
  return v
}

const pct = (p: number) => `${(p * 100).toFixed(1)}%`

const EMPTY_STATS: PacketStats = {
  transmitted: 0,
  reflected: 0,
  remaining: 1,
  meanX: LAUNCH_X,
  time: 0,
}

export default function WavePacketsPage() {
  const [preset, setPreset] = useState<Preset>('barrier')
  const [height, setHeight] = useState(1)
  const [featureWidth, setFeatureWidth] = useState(2)
  const [energy, setEnergy] = useState(0.5)
  const [sigma, setSigma] = useState(3)
  const [running, setRunning] = useState(true)
  const [showCurrent, setShowCurrent] = useState(true)
  const [drawing, setDrawing] = useState(false)
  const [resetKey, setResetKey] = useState(0)
  const [version, setVersion] = useState(0)
  const [edited, setEdited] = useState(false)
  const [stats, setStats] = useState<PacketStats>(EMPTY_STATS)

  // The potential is one array, mutated in place by the brush and replaced wholesale by a
  // preset change. `version` is the signal the canvas watches — an array identity would
  // not change on an in-place edit, and copying 1024 doubles per pointermove to force one
  // would be churn for nothing.
  const potentialRef = useRef<Float64Array>(buildPreset('barrier', 1, 2))
  const firstRender = useRef(true)

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    potentialRef.current = buildPreset(preset, height, featureWidth)
    setEdited(false)
    setVersion((v) => v + 1)
  }, [preset, height, featureWidth])

  const k0 = Math.sqrt(2 * energy)
  const packet = useMemo(() => ({ x0: LAUNCH_X, k0, sigma }), [k0, sigma])

  const onStats = useCallback((s: PacketStats) => setStats(s), [])

  const onPaint = useCallback((x: number, target: number) => {
    const v = potentialRef.current
    const clamped = Math.max(V_MIN, Math.min(V_MAX, target))
    for (let i = 0; i < WP_GRID.n; i++) {
      const d = WP_GRID.x[i] - x
      const weight = Math.exp(-(d * d) / (2 * BRUSH * BRUSH))
      if (weight < 0.01) continue
      v[i] = v[i] * (1 - weight) + clamped * weight
    }
    setEdited(true)
    setVersion((n) => n + 1)
  }, [])

  const clearDrawing = () => {
    potentialRef.current = buildPreset(preset, height, featureWidth)
    setEdited(false)
    setVersion((v) => v + 1)
  }

  const tryThis = (nextPreset: Preset, v0: number, w: number, e: number) => {
    setPreset(nextPreset)
    setHeight(v0)
    setFeatureWidth(w)
    setEnergy(e)
    setDrawing(false)
    setRunning(true)
    setResetKey((k) => k + 1)
  }

  /**
   * The barrier the GRID actually holds is a whole number of cells wide, which is not
   * quite the number on the slider. T depends on sin²(k₂·width) above the top and on
   * exp(−2κ·width) below it, so a 2% difference in width is a visible difference in T —
   * quoting the closed form for a barrier slightly wider than the one being simulated
   * would look like an error in the simulation. Count the cells and compare like with
   * like. Any residual gap is the real thing: the packet carries a spread of energies and
   * every one of them transmits at its own rate.
   */
  const effectiveWidth = useMemo(() => {
    let cells = 0
    for (let i = 0; i < WP_GRID.n; i++) {
      if (Math.abs(WP_GRID.x[i]) <= featureWidth / 2) cells++
    }
    return cells * WP_GRID.dx
  }, [featureWidth])

  // Plane-wave transmission for the rectangular barrier, when that is what is on screen.
  const analytic =
    preset === 'barrier' && !edited
      ? rectangularBarrierTransmission(energy, height, effectiveWidth)
      : null
  const analyticLabel =
    analytic === null ? '—' : analytic < 0.001 ? analytic.toExponential(2) : pct(analytic)

  const spread = freeSpreadWidth(sigma, stats.time)

  const controls = (
    <>
      <Segmented<Preset>
        label="Potential"
        value={preset}
        options={PRESETS}
        onChange={(v) => {
          setPreset(v)
          setResetKey((k) => k + 1)
        }}
      />

      {preset !== 'free' ? (
        <>
          <Slider
            label={preset === 'well' ? 'Well depth' : 'Height V₀'}
            value={height}
            min={0.1}
            max={4}
            step={0.05}
            format={(v) => v.toFixed(2)}
            onChange={setHeight}
          />
          <Slider
            label="Feature width"
            value={featureWidth}
            min={0.5}
            max={8}
            step={0.1}
            format={(v) => v.toFixed(1)}
            onChange={setFeatureWidth}
          />
        </>
      ) : null}

      <Slider
        label="Packet energy E"
        value={energy}
        min={0.05}
        max={4}
        step={0.05}
        format={(v) => v.toFixed(2)}
        onChange={setEnergy}
        hint="Sets the momentum: k = √(2E)"
      />
      <Slider
        label="Packet width σ"
        value={sigma}
        min={0.8}
        max={SIGMA_MAX}
        step={0.1}
        format={(v) => v.toFixed(1)}
        onChange={setSigma}
        hint="Narrow packets carry a wide spread of energies"
      />

      <ButtonRow>
        <button type="button" className="btn-primary" onClick={() => setRunning((r) => !r)}>
          {running ? 'Pause' : 'Play'}
        </button>
        <button type="button" className="btn-ghost" onClick={() => setResetKey((k) => k + 1)}>
          Relaunch
        </button>
      </ButtonRow>

      <Toggle
        label="Show probability current"
        checked={showCurrent}
        onChange={setShowCurrent}
        hint="Which way probability is actually flowing"
      />
      <Toggle
        label="Draw the potential"
        checked={drawing}
        onChange={setDrawing}
        hint="Drag on the canvas, or focus it and use the arrow keys"
      />
      {edited ? (
        <ButtonRow>
          <button type="button" className="btn-ghost" onClick={clearDrawing}>
            Clear drawing
          </button>
        </ButtonRow>
      ) : null}

      <div className="grid grid-cols-2 gap-2">
        <Stat label="Transmitted" value={pct(stats.transmitted)} accent="teal" />
        <Stat label="Reflected" value={pct(stats.reflected)} accent="rose" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Plane-wave T" value={analyticLabel} accent="amber" />
        <Stat label="Free-spread σ(t)" value={spread.toFixed(2)} accent="sky" />
      </div>

      <div>
        <span className="mb-1.5 block text-[13px] font-semibold text-ink-secondary">Try this</span>
        <ButtonRow>
          <button
            type="button"
            className="btn-ghost text-xs"
            onClick={() => tryThis('barrier', 1.5, 1.5, 0.5)}
          >
            Tunnel through
          </button>
          <button
            type="button"
            className="btn-ghost text-xs"
            onClick={() => tryThis('barrier', 1, 2, 1.6)}
          >
            Reflect above it
          </button>
          <button
            type="button"
            className="btn-ghost text-xs"
            onClick={() => tryThis('well', 1.2, 3, 0.35)}
          >
            Bounce off a hole
          </button>
        </ButtonRow>
      </div>

      <p className="text-[11px] leading-relaxed text-ink-muted">
        Split-step Fourier propagator on a {WP_GRID.n}-point grid, ħ = m = 1. The edges absorb
        outgoing waves, so probability on the grid falls while the transmitted and reflected
        fractions stay meaningful.
      </p>
    </>
  )

  return (
    <VizFrame
      title="Wave Packets and Scattering"
      tagline="Launch a particle at an obstacle and watch what a wave does about it: spread, split, leak through, and bounce off things that should not stop it."
      level="Intermediate"
      canvas={
        <div className="p-2">
          <WavePacketsLab
            potential={potentialRef.current}
            potentialVersion={version}
            packet={packet}
            running={running}
            resetKey={resetKey}
            showCurrent={showCurrent}
            drawing={drawing}
            onPaint={onPaint}
            onStats={onStats}
          />
          <p className="px-3 pb-2 pt-1 text-[11px] leading-relaxed text-ink-muted">
            Violet is |ψ|², amber is the potential, the dashed sky line is the packet&rsquo;s mean
            energy, and the faint teal wiggle is Re ψ — the thing that oscillates when the particle
            is allowed and decays when it is not.
          </p>
        </div>
      }
      controls={controls}
    >
      <Explainer title="Start here">
        <p>
          This is a sandbox rather than a demonstration. Pick an obstacle, choose how much energy to
          throw at it, and press play. Three things are worth watching, in this order: the packet
          getting wider even when nothing is in its way, the moment it meets the obstacle and
          becomes two packets, and the current strip underneath, where the reflected part shows up
          as flow that has changed direction.
        </p>
        <p>
          You can also draw. Turn on <strong>Draw the potential</strong> and drag a shape onto the
          canvas — or focus the canvas and use the arrow keys, left and right to move the cursor, up
          and down to raise and lower the ground under it. Anything you draw is solved exactly the
          same way as the presets.
        </p>
      </Explainer>

      <Explainer title="It falls apart on its own">
        <p>
          Choose <em>Free</em>, with nothing in the way, and the packet still changes: it flattens
          and widens as it goes. A packet is a bundle of momenta, and a bundle of momenta is a
          bundle of speeds, so the fast components run ahead of the slow ones and the parcel comes
          apart. The width follows σ(t) = σ₀√(1 + (ħt/2mσ₀²)²), which the{' '}
          <em>Free-spread σ(t)</em> readout is tracking live.
        </p>
        <p>
          Now make σ small. The packet you localised hardest is the one that disintegrates fastest,
          because pinning down position costs you a wide spread in momentum. This is the
          uncertainty principle showing up not as an inequality on a page but as a rate: localise
          an electron to an atom&rsquo;s width and it smears across a millimetre in under a
          microsecond.
        </p>
      </Explainer>

      <Explainer title="What just happened: reflection where there should be none">
        <p>
          Press <strong>Reflect above it</strong>. The dashed energy line now sits well above the
          top of the amber block — this particle has more than enough energy to walk over the
          obstacle, and classically it would, without slowing down. Close to a fifth of it comes
          back. (It exceeds the plane-wave reflection 1 − T beside it, and should: that number is
          for a single sharp energy, while a real packet brings a spread of them, and the slower
          components in the spread reflect much more readily than the average.)
        </p>
        <p>
          Nothing was blocking it. What reflects a quantum particle is not a wall but a{' '}
          <em>change</em>: the wavelength on top of the barrier is longer than the wavelength
          outside it, and any abrupt change in wavelength scatters a wave, exactly as light
          partially reflects off a pane of glass it is perfectly able to pass through. Widen the
          barrier slowly and the reflection oscillates, dropping to zero whenever the barrier
          happens to be a whole number of half-wavelengths wide and the two internal reflections
          cancel. That is an anti-reflective coating, and it is also how a resonant tunnelling
          diode works — try the <em>Double</em> barrier and hunt for the energy where the pair
          becomes transparent.
        </p>
      </Explainer>

      <Explainer title="Reading the current">
        <p>
          The strip under the main panel is j(x), the probability current: how much probability is
          flowing past each point, and which way. Sky is rightward, rose is leftward. Before the
          collision it is a single sky-coloured hump riding along with the packet. Afterwards there
          are two, of opposite colour, moving apart.
        </p>
        <p>
          It is worth watching inside a barrier that the particle is tunnelling through. The density
          there decays exponentially, but the current does not vanish — it is small, flat and
          steady, because in steady state whatever flows in one side has to flow out the other.
          Probability is conserved, and j is the thing that does the conserving: ∂|ψ|²/∂t + ∂j/∂x =
          0 is the same statement as charge conservation in a wire.
        </p>
      </Explainer>

      <Explainer title="A hole can reflect too">
        <p>
          Press <strong>Bounce off a hole</strong>. The obstacle is now a <em>well</em> — a place
          where the particle would speed up, not slow down — and some of it still comes back. Once
          you accept that reflection is caused by a change in wavelength rather than by an
          obstruction, a downward step is as good a mirror as an upward one.
        </p>
        <p>
          This is why neutrons reflect off the surface of a material, why an abrupt change in
          impedance sends a signal echoing back down a cable, and why the sudden drop in potential
          at the edge of a nucleus produces the resonances that make some isotopes swallow neutrons
          far more eagerly than their size alone would suggest.
        </p>
      </Explainer>
    </VizFrame>
  )
}
