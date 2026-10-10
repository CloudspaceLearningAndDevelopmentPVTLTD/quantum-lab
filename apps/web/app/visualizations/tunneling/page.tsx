'use client'

import { useCallback, useState } from 'react'
import TunnelingLab, { ENERGY_SCALE } from '@/components/viz/TunnelingLab'
import { VizFrame, Explainer } from '@/components/ui/VizFrame'
import { Slider, ButtonRow, Stat } from '@/components/ui/Controls'

const pct = (p: number) => `${(p * 100).toFixed(1)}%`

export default function TunnelingPage() {
  const [barrierHeight, setBarrierHeight] = useState(4)
  const [barrierWidth, setBarrierWidth] = useState(20)
  const [particleEnergy, setParticleEnergy] = useState(2)
  const [packetWidth, setPacketWidth] = useState(30)
  const [running, setRunning] = useState(true)
  const [resetKey, setResetKey] = useState(0)
  const [stats, setStats] = useState<{ transmission: number; reflection: number }>({
    transmission: 0,
    reflection: 0,
  })

  const onStats = useCallback((s: { transmission: number; reflection: number }) => {
    setStats((prev) =>
      Math.abs(prev.transmission - s.transmission) < 1e-5 &&
      Math.abs(prev.reflection - s.reflection) < 1e-5
        ? prev
        : s
    )
  }, [])

  const reset = () => setResetKey((k) => k + 1)

  // Exact plane-wave transmission through a rectangular barrier of height v and width w,
  // in the solver's lattice units (ħ = m = dx = 1; see ENERGY_SCALE). Below the barrier
  // the wave decays with κ = √(2(v−e)) and T = 1 / (1 + v² sinh²(κw) / (4e(v−e))); above it
  // oscillates with k = √(2(e−v)) and T = 1 / (1 + v² sin²(kw) / (4e(e−v))), so transmission
  // is NOT simply 1 above the barrier — there are resonances and partial reflection. At
  // e = v both limits reduce to T = 1 / (1 + v w² / 2). The thick-barrier shorthand
  // exp(−2κw) that used to sit here drops the prefactor and undercounts by ~4× at the
  // default settings.
  const v = barrierHeight * ENERGY_SCALE
  const e = particleEnergy * ENERGY_SCALE
  const w = barrierWidth
  let analytic: number
  if (e < v) {
    const kappa = Math.sqrt(2 * (v - e))
    analytic = 1 / (1 + (v * v * Math.sinh(kappa * w) ** 2) / (4 * e * (v - e)))
  } else if (e > v) {
    const k = Math.sqrt(2 * (e - v))
    analytic = 1 / (1 + (v * v * Math.sin(k * w) ** 2) / (4 * e * (e - v)))
  } else {
    analytic = 1 / (1 + (v * w * w) / 2)
  }
  const analyticLabel = analytic < 0.001 ? analytic.toExponential(2) : pct(analytic)

  const controls = (
    <>
      <Slider
        label="Barrier height V₀"
        value={barrierHeight}
        min={0.5}
        max={8}
        step={0.1}
        format={(v) => v.toFixed(1)}
        onChange={setBarrierHeight}
        hint="The wall the particle cannot classically climb"
      />
      <Slider
        label="Barrier width"
        value={barrierWidth}
        min={4}
        max={80}
        step={1}
        format={(v) => `${v.toFixed(0)} pts`}
        onChange={setBarrierWidth}
        hint="Thicker walls block exponentially more"
      />
      <Slider
        label="Particle energy E"
        value={particleEnergy}
        min={0.5}
        max={6}
        step={0.1}
        format={(v) => v.toFixed(1)}
        onChange={setParticleEnergy}
      />
      <Slider
        label="Packet width σ"
        value={packetWidth}
        min={10}
        max={60}
        step={1}
        format={(v) => v.toFixed(0)}
        onChange={setPacketWidth}
        hint="Narrower packets have a wider spread of energies"
      />

      <ButtonRow>
        <button type="button" className="btn-primary" onClick={() => setRunning((r) => !r)}>
          {running ? 'Pause' : 'Play'}
        </button>
        <button type="button" className="btn-ghost" onClick={reset}>
          Reset
        </button>
      </ButtonRow>

      <div className="grid grid-cols-2 gap-2">
        <Stat label="Transmitted" value={pct(stats.transmission)} accent="teal" />
        <Stat label="Reflected" value={pct(stats.reflection)} accent="rose" />
      </div>
      <Stat label="Plane-wave T (exact)" value={analyticLabel} accent="amber" />

      <p className="text-[11px] leading-relaxed text-ink-muted">
        The simulation solves the time-dependent Schrödinger equation on a 600-point grid in real
        time.
      </p>
    </>
  )

  return (
    <VizFrame
      title="Quantum Tunneling"
      tagline="A particle without enough energy to climb the wall — that gets through anyway."
      level="Intermediate"
      canvas={
        <div className="p-2">
          <TunnelingLab
            barrierHeight={barrierHeight}
            barrierWidth={barrierWidth}
            particleEnergy={particleEnergy}
            packetWidth={packetWidth}
            running={running}
            resetKey={resetKey}
            onStats={onStats}
          />
          <p className="px-3 pb-2 pt-1 text-[11px] text-ink-muted">
            Violet is the probability density |ψ|². The faint teal line is the real part of ψ — watch
            it decay, not stop, inside the amber barrier.
          </p>
        </div>
      }
      controls={controls}
    >
      <Explainer title="Classically impossible">
        <p>
          Roll a ball at a hill taller than its energy and it always comes back. There is no version
          of that story where the ball turns up on the far side — it simply does not have what it
          takes to reach the top, and everything after that is downhill in the wrong direction.
        </p>
        <p>
          Set the energy below the barrier height and watch. The dashed sky line sits below the top
          of the amber block, so by every classical account nothing should ever reach the right-hand
          side. Some of the wave appears there anyway. The particle was never a ball.
        </p>
      </Explainer>

      <Explainer title="The wave doesn't stop at the wall">
        <p>
          Inside the barrier the wave does not vanish. It stops oscillating and starts decaying —
          exponentially, at a rate set by how far the energy falls short of the top. That is the
          whole mechanism, and you can see it in the faint teal curve as it crosses the amber block.
        </p>
        <p>
          If the wall is thin enough, there is still amplitude left when you reach the other side,
          and that leftover amplitude is a real probability of finding the particle there. Widen the
          barrier and watch transmission collapse exponentially — a modest change in width costs
          orders of magnitude. Compare the measured number with the exact plane-wave transmission as
          you go. The measurement sits somewhat higher (roughly 10% against 7% at the default
          settings) because a finite wave packet carries a spread of energies, and the components
          above the mean tunnel far more easily than the ones below it. Widen the packet σ — which
          narrows its energy spread — and the gap closes.
        </p>
      </Explainer>

      <Explainer title="This runs the world">
        <p>
          Tunnelling is not a curiosity. It is how a scanning tunnelling microscope images single
          atoms: hold a sharp tip a fraction of a nanometre above a surface and the current that
          leaks across the gap is so violently sensitive to distance that individual atoms stand out
          as hills.
        </p>
        <p>
          It is also how electrons leak out of flash memory cells, which is why an SSD left
          unpowered for years eventually forgets, and how protons in the Sun&rsquo;s core fuse at
          temperatures far too low to overcome their electrical repulsion. Without tunnelling, stars
          would not shine.
        </p>
      </Explainer>
    </VizFrame>
  )
}
