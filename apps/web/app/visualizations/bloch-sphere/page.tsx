'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { lazyViz } from '@/components/viz/LazyViz'
import { VizFrame, Explainer } from '@/components/ui/VizFrame'
import { Slider, Segmented, Stat } from '@/components/ui/Controls'
import { StateVector, formatComplex } from '@/lib/quantum'

/**
 * MEASURED: this route was 864.0 kB of route chunks (1.86x the 463.9 kB median),
 * 512.2 kB of which is the three.js chunk `9d78c252-*.js` sitting in the initial
 * payload. Loading it after hydration behind a height-reserving skeleton drops the
 * route's First Load JS to the site median; see docs/PERFORMANCE.md.
 * Module scope on purpose — see the note in LazyViz.tsx.
 */
const BlochSphere = lazyViz<{ theta: number; phi: number; className?: string }>(
  () => import('@/components/viz/BlochSphere')
)

type PresetId = '0' | '1' | '+' | '-' | '+i' | '-i' | 'custom'

const PRESETS: { value: PresetId; label: string; theta: number; phi: number }[] = [
  { value: '0', label: '|0⟩', theta: 0, phi: 0 },
  { value: '1', label: '|1⟩', theta: Math.PI, phi: 0 },
  { value: '+', label: '|+⟩', theta: Math.PI / 2, phi: 0 },
  { value: '-', label: '|−⟩', theta: Math.PI / 2, phi: Math.PI },
  { value: '+i', label: '|+i⟩', theta: Math.PI / 2, phi: Math.PI / 2 },
  { value: '-i', label: '|−i⟩', theta: Math.PI / 2, phi: (3 * Math.PI) / 2 },
]

const formatPi = (v: number) => `${(v / Math.PI).toFixed(2)}π`
const pct = (p: number) => `${(p * 100).toFixed(1)}%`

export default function BlochSpherePage() {
  const [theta, setTheta] = useState(Math.PI / 3)
  const [phi, setPhi] = useState(Math.PI / 4)
  const [preset, setPreset] = useState<PresetId>('custom')

  const sv = useMemo(() => {
    const s = new StateVector(1)
    s.applySingle('RY', 0, theta)
    // P(φ) rather than RZ(φ): both put the Bloch vector at the same point, but
    // RZ(φ) = e^{−iφ/2}·P(φ) carries a global phase that would leak into the
    // printed amplitudes below. With P the readout is the textbook form
    // cos(θ/2)|0⟩ + e^{iφ} sin(θ/2)|1⟩, with a real, non-negative |0⟩ amplitude.
    s.applySingle('P', 0, phi)
    return s
  }, [theta, phi])

  const bloch = sv.blochVector(0)
  const alpha = sv.amplitude(0)
  const beta = sv.amplitude(1)

  const onPreset = (v: PresetId) => {
    const p = PRESETS.find((item) => item.value === v)
    if (!p) return
    setTheta(p.theta)
    setPhi(p.phi)
    setPreset(v)
  }

  const controls = (
    <>
      <Slider
        label="θ (polar)"
        value={theta}
        min={0}
        max={Math.PI}
        step={0.01}
        format={formatPi}
        onChange={(v) => {
          setTheta(v)
          setPreset('custom')
        }}
        hint="Tilts the vector from the |0⟩ pole toward |1⟩."
      />
      <Slider
        label="φ (azimuth)"
        value={phi}
        min={0}
        max={2 * Math.PI}
        step={0.01}
        format={formatPi}
        onChange={(v) => {
          setPhi(v)
          setPreset('custom')
        }}
        hint="Spins the vector around the vertical axis."
      />

      <Segmented<PresetId>
        label="Preset states"
        value={preset}
        options={PRESETS.map((p) => ({ value: p.value, label: p.label }))}
        onChange={onPreset}
      />

      <div className="grid grid-cols-2 gap-2">
        <Stat label="P(0)" value={pct(sv.probability(0))} accent="teal" />
        <Stat label="P(1)" value={pct(sv.probability(1))} accent="rose" />
        <Stat label="Bloch x" value={bloch.x.toFixed(3)} accent="sky" />
        <Stat label="Bloch y" value={bloch.y.toFixed(3)} accent="amber" />
        <Stat label="Bloch z" value={bloch.z.toFixed(3)} accent="violet" />
      </div>
    </>
  )

  return (
    <VizFrame
      title="The Bloch Sphere"
      tagline="Every possible state of a single qubit is one point on this globe — the poles are the classical bits, and everything between them is superposition."
      level="Beginner"
      canvas={
        <div className="p-2">
          <BlochSphere theta={theta} phi={phi} />
          <p className="px-3 pb-2 pt-1 text-[11px] text-ink-muted">
            Drag to rotate the view. Scroll to zoom.
          </p>
        </div>
      }
      controls={controls}
    >
      <div className="mb-6">
        <h2 className="section-label mb-2">State vector</h2>
        <pre className="code-block">
          {`|ψ⟩ = (${formatComplex(alpha)})|0⟩ + (${formatComplex(beta)})|1⟩`}
        </pre>
      </div>

      <Explainer title="What the sphere shows">
        <p>
          A single qubit is not just &ldquo;0 or 1&rdquo;. Every pure state it can be in corresponds
          to exactly one point on the <em>surface</em> of this sphere, and every point on the surface
          is a legal state. That is the whole space — nothing more, nothing less.
        </p>
        <p>
          The two poles are the only two things a measurement can ever hand you: the top is |0⟩ and
          the bottom is |1⟩. Everything else on the surface is a blend of the two, and pointing the
          arrow there does not mean the qubit is &ldquo;secretly&rdquo; 0 or 1 — it means that when
          you measure, the answer is genuinely decided at that moment, with odds set by how far the
          arrow leans toward each pole.
        </p>
      </Explainer>

      <Explainer title="Latitude is probability, longitude is phase">
        <p>
          The polar angle θ is the only thing that sets the measurement odds:{' '}
          <span className="font-mono text-q-violet-text">P(0) = cos²(θ/2)</span> and{' '}
          <span className="font-mono text-q-rose-text">P(1) = sin²(θ/2)</span>. At the equator
          (θ = 0.50π) both are exactly 50%.
        </p>
        <p>
          The azimuthal angle φ is the relative phase between |0⟩ and |1⟩. Drag the φ slider and
          watch the two probability readouts: they do not move at all. Spinning around the vertical
          axis changes the state — |+⟩ and |−⟩ are different states — but it changes nothing you can
          see in a single measurement in the computational basis.
        </p>
      </Explainer>

      <Explainer title="Why phase matters anyway">
        <p>
          If one measurement cannot see φ, why track it? Because phase is what makes interference
          work. Take |+⟩ (φ = 0) and |−⟩ (φ = π): identical 50/50 outcomes, opposite sides of the
          equator. Apply one more Hadamard and they separate perfectly — |+⟩ becomes |0⟩ and |−⟩
          becomes |1⟩, each with certainty. The phase you could not measure directly has been turned
          into an outcome you can. Every quantum algorithm worth running is built on that trick:
          arrange the phases so wrong answers cancel and right answers add.
        </p>
        <p>
          One caveat about the picture: the surface only holds <em>pure</em> single-qubit states. If
          a qubit is entangled with another one, its own state is mixed and its arrow sits{' '}
          <em>inside</em> the sphere, shortened toward the centre. A maximally entangled qubit — half
          of a Bell pair — has an arrow of length zero, sitting exactly at the origin. It has no
          state of its own at all; all of the information lives in the correlation with its partner.
        </p>
        <p>
          And one more: this sphere is the whole space only for a <em>single</em> qubit. A spin-1, or the
          symmetric states of several qubits, has more amplitudes than one arrow can hold — and it turns out the
          right picture is not a bigger sphere but <em>more points on this one</em>. See{' '}
          <Link href="/visualizations/majorana-stars" className="text-q-sky-text underline-offset-2 hover:underline">
            Majorana stars
          </Link>
          , where a rotation moves all the points together and a squeeze pulls them apart.
        </p>
      </Explainer>
    </VizFrame>
  )
}
