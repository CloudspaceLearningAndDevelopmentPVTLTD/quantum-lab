'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { lazyViz } from '@/components/viz/LazyViz'
import { VizFrame, Explainer } from '@/components/ui/VizFrame'
import { Slider, ButtonRow, Stat } from '@/components/ui/Controls'

/**
 * MEASURED: this route was 853.1 kB of route chunks (1.84x the 463.9 kB median),
 * 512.2 kB of which is the shared-with-bloch-sphere three.js chunk `9d78c252-*.js`
 * in the initial payload. Deferred behind a height-reserving skeleton; see
 * docs/PERFORMANCE.md. Module scope on purpose — see the note in LazyViz.tsx.
 */
const DecoherenceLab = lazyViz<{
  x: number
  y: number
  z: number
  purity: number
  className?: string
}>(() => import('@/components/viz/DecoherenceLab'))

const DEFAULT_THETA = Math.PI / 2
const DEFAULT_PHI = Math.PI / 4
const DEFAULT_T1 = 1
const DEFAULT_T2 = 0.4

const formatPi = (v: number) => `${(v / Math.PI).toFixed(2)}π`
const pct = (p: number) => `${(p * 100).toFixed(1)}%`

export default function DecoherencePage() {
  const [theta, setTheta] = useState(DEFAULT_THETA)
  const [phi, setPhi] = useState(DEFAULT_PHI)
  const [t, setT] = useState(0)
  const [t1, setT1] = useState(DEFAULT_T1)
  const [t2, setT2] = useState(DEFAULT_T2)
  const [running, setRunning] = useState(false)

  // Auto-play advances t here in the page, so the canvas stays a pure renderer.
  const rafRef = useRef<number | null>(null)
  useEffect(() => {
    if (!running) return
    let last = performance.now()
    const loop = (now: number) => {
      const dt = Math.min(now - last, 100) / 1000
      last = now
      setT((prev) => (prev + dt * 0.35) % 1)
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [running])

  // Guard the rates so a zero slider value cannot divide by zero.
  const safeT1 = Math.max(t1, 1e-3)
  const safeT2 = Math.max(t2, 1e-3)

  const x0 = Math.sin(theta) * Math.cos(phi)
  const y0 = Math.sin(theta) * Math.sin(phi)
  const z0 = Math.cos(theta)

  // Dephasing collapses the transverse plane; amplitude damping drags z toward |0⟩.
  const x = x0 * Math.exp(-t / safeT2)
  const y = y0 * Math.exp(-t / safeT2)
  const z = 1 + (z0 - 1) * Math.exp(-t / safeT1)

  const magnitude = Math.sqrt(x * x + y * y + z * z)
  const purity = (1 + magnitude * magnitude) / 2
  const coherence = Math.sqrt(x * x + y * y)
  const p0 = (1 + z) / 2

  const impossible = t2 > 2 * t1

  const reset = () => {
    setRunning(false)
    setT(0)
    setTheta(DEFAULT_THETA)
    setPhi(DEFAULT_PHI)
    setT1(DEFAULT_T1)
    setT2(DEFAULT_T2)
  }

  const controls = (
    <>
      <Slider label="θ (initial)" value={theta} min={0} max={Math.PI} step={0.01} format={formatPi} onChange={setTheta} />
      <Slider
        label="φ (initial)"
        value={phi}
        min={0}
        max={Math.PI * 2}
        step={0.01}
        format={formatPi}
        onChange={setPhi}
      />
      <Slider
        label="Time t"
        value={t}
        min={0}
        max={1}
        step={0.005}
        onChange={(v) => {
          setRunning(false)
          setT(v)
        }}
        hint="In units where T1 and T2 are set below."
      />
      <Slider label="T1 (energy relaxation)" value={t1} min={0.05} max={2} step={0.01} onChange={setT1} />
      <Slider label="T2 (dephasing)" value={t2} min={0.05} max={2} step={0.01} onChange={setT2} />

      {impossible ? (
        <p className="pill border border-q-amber/30 bg-q-amber/15 text-q-amber-text">
          T2 &gt; 2·T1 is physically impossible
        </p>
      ) : null}

      <ButtonRow>
        <button type="button" className="btn-primary focus-ring" onClick={() => setRunning((r) => !r)}>
          {running ? 'Pause' : 'Play'}
        </button>
        <button type="button" className="btn-ghost focus-ring" onClick={reset}>
          Reset
        </button>
      </ButtonRow>

      <div className="grid grid-cols-2 gap-2">
        <Stat label="Vector length" value={magnitude.toFixed(3)} accent="violet" />
        <Stat label="Purity" value={purity.toFixed(3)} accent="rose" />
        <Stat label="P(0)" value={pct(p0)} accent="teal" />
        <Stat label="Coherence" value={coherence.toFixed(3)} accent="sky" />
      </div>
    </>
  )

  return (
    <VizFrame
      title="Decoherence"
      tagline="A qubit does not get the wrong answer when it decoheres. It stops having an answer — and the arrow retracts into the sphere."
      level="Intermediate"
      canvas={
        <div className="p-2">
          <DecoherenceLab x={x} y={y} z={z} purity={purity} />
          <p className="px-3 pb-2 pt-1 text-[11px] text-ink-muted">
            The arrow is shorter than the radius whenever the state is mixed. The translucent ball is
            everything the qubit no longer knows about itself. Drag to rotate, scroll to zoom.
          </p>
        </div>
      }
      controls={controls}
    >
      <p className="mb-6 text-[13px] text-ink-secondary">
        Real hardware always satisfies T2 ≤ 2·T1: dephasing cannot be slower than the dephasing that
        energy loss alone already causes. The sliders let you break that bound so you can see what
        each channel does in isolation, but a device with T2 &gt; 2·T1 does not exist.
      </p>

      <Explainer title="Decoherence is not noise added to a signal">
        <p>
          It is tempting to picture decoherence as a wrong bit sneaking in — the qubit was 0 and the
          environment flipped it to 1. For <em>dephasing</em> (T2), that is not what happens. The
          qubit does not acquire a wrong value; it stops having a definite value at all.
        </p>
        <p>
          Watch the arrow with T1 set long and T2 short. It does not swing to a different point on
          the surface, it <em>retracts toward the centre</em>. A vector at the surface is a definite
          quantum state with a definite phase. A vector at the centre is a coin flip: 50/50 in every
          basis, with no phase information left to interfere with anything.
        </p>
        <p>
          <em>Energy relaxation</em> (T1) is the exception, and it really does produce a wrong value.
          A qubit prepared in |1⟩ leaks its energy to the environment and ends up in |0⟩ — a definite,
          wrong answer. Start the arrow at the south pole with T2 long and T1 short: it shrinks
          through the centre and re-emerges pointing at the north pole, a pure state again, just not
          the one you prepared.
        </p>
      </Explainer>

      <Explainer title="T1 and T2">
        <p>
          T1 is energy relaxation. The qubit dumps its excitation into the environment and settles
          toward |0⟩, which is why the arrow drifts up toward the north pole no matter where it
          started. The z component follows 1 + (z₀ − 1)·e^(−t/T1).
        </p>
        <p>
          T2 is dephasing. The phase gets scrambled by whatever the environment is doing, so the
          horizontal component shrinks: x and y both decay as e^(−t/T2), collapsing the state onto
          the vertical axis. Set T2 to 0.1 and T1 to 2 and watch the arrow fall flat onto the polar
          axis long before it gets anywhere near the pole. That collapse is the loss of
          interference — the thing that makes a quantum computer quantum.
        </p>
      </Explainer>

      <Explainer title="Why quantum computers are hard">
        <p>
          Every gate takes time, and T2 is running against you the whole time. The number of gates
          you can apply before the state is mush is roughly T2 divided by the gate time. On today&apos;s
          superconducting hardware that is a few thousand — enough for interesting demos, nowhere
          near enough for Shor&apos;s algorithm on a real key.
        </p>
        <p>
          That single ratio is why error correction exists. Adding more qubits does not extend T2; it
          just gives you more things that are all decohering at once. You need many physical qubits
          encoding one logical qubit, with errors detected and corrected faster than they accumulate
          — which is why useful machines are counted in millions of physical qubits rather than
          hundreds.
        </p>
      </Explainer>

      <Explainer title="Name what you just watched">
        <p>
          The retracting arrow has a name: the purity readout above is Tr ρ², where ρ is the
          qubit&rsquo;s density matrix, and the arrow&rsquo;s length is exactly √(2 Tr ρ² − 1). What
          T2 does to the arrow is shrink the off-diagonal entries of a 2×2 matrix while leaving the
          diagonal alone. The{' '}
          <Link
            href="/visualizations/density-matrix"
            className="focus-ring rounded text-q-violet-text underline decoration-q-violet/40 underline-offset-2"
          >
            density matrix page
          </Link>{' '}
          puts that matrix on screen next to the same ball, shows why a 50/50 mixture and a 50/50
          superposition are different states, and traces out half a Bell pair to get the maximally
          mixed state at the centre of the sphere.
        </p>
      </Explainer>
    </VizFrame>
  )
}
