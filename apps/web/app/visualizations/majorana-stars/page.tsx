'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { lazyViz } from '@/components/viz/LazyViz'
import type { MajoranaSphereProps } from '@/components/viz/MajoranaSphere'
import { prefersReducedMotion } from '@/components/viz/frameLoop'
import { VizFrame, Explainer } from '@/components/ui/VizFrame'
import { Segmented, Slider, Stat, Toggle, ButtonRow } from '@/components/ui/Controls'
import { formatComplex } from '@/lib/quantum'
import {
  constellationSpread,
  dickeState,
  ghzState,
  majoranaStars,
  meanSpin,
  normalize,
  rotateState,
  spinBasisState,
  spinCoherentState,
  twistAbout,
  twistPeriod,
  wState,
  type Axis,
  type Complex,
  type Star,
} from '@/lib/quantum/majorana'
import { appendTrails, matchStars, type Trail } from '@/lib/viz/majoranaGeometry'

/**
 * three.js loads after hydration behind a height-reserving skeleton, exactly as
 * the Bloch sphere page does. Module scope on purpose — see LazyViz.tsx.
 */
const MajoranaSphere = lazyViz<MajoranaSphereProps>(() => import('@/components/viz/MajoranaSphere'))

type Family = 'spin' | 'qubits'
type SpinBase = 'coherent' | 'basis' | 'cat'
type QubitPreset = 'ghz' | 'w' | 'dicke' | 'product'
type Animate = 'off' | 'rotate' | 'twist'

const FAMILY_OPTIONS: { value: Family; label: string }[] = [
  { value: 'spin', label: 'Spin j' },
  { value: 'qubits', label: 'Symmetric qubits' },
]
const J_OPTIONS = [1, 2, 3, 4, 5, 6].map((twoJ) => ({
  value: String(twoJ),
  label: twoJ % 2 === 0 ? `${twoJ / 2}` : `${twoJ}/2`,
}))
const N_OPTIONS = [2, 3, 4, 5, 6].map((n) => ({ value: String(n), label: String(n) }))
const SPIN_BASE_OPTIONS: { value: SpinBase; label: string }[] = [
  { value: 'coherent', label: 'Coherent |θ,φ⟩' },
  { value: 'basis', label: '|j, m⟩' },
  { value: 'cat', label: 'Cat (|j,j⟩+|j,−j⟩)' },
]
const QUBIT_PRESET_OPTIONS: { value: QubitPreset; label: string }[] = [
  { value: 'product', label: 'Product' },
  { value: 'ghz', label: 'GHZ' },
  { value: 'w', label: 'W' },
  { value: 'dicke', label: 'Dicke' },
]
const AXIS_OPTIONS: { value: Axis; label: string }[] = [
  { value: 'x', label: 'x' },
  { value: 'y', label: 'y' },
  { value: 'z', label: 'z' },
]
const ANIMATE_OPTIONS: { value: Animate; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'rotate', label: 'Keep rotating' },
  { value: 'twist', label: 'Keep twisting' },
]

const formatPi = (v: number) => `${(v / Math.PI).toFixed(2)}π`
const formatDeg = (rad: number) => `${((rad * 180) / Math.PI).toFixed(0)}°`
const mLabel = (m: number) => (Number.isInteger(m) ? `${m}` : `${m > 0 ? '' : '−'}${Math.abs(m * 2)}/2`)

/** Cat state (|j,j⟩ + |j,−j⟩)/√2: 2j stars in a regular polygon on the equator. */
function catState(twoJ: number): Complex[] {
  return ghzState(twoJ)
}

/** Rate of the "keep going" animations, radians of angle or twist per second. */
const ROTATE_RATE = 0.9
const TWIST_RATE = 0.35

export default function MajoranaStarsPage() {
  const [family, setFamily] = useState<Family>('spin')
  const [twoJ, setTwoJ] = useState(4)
  const [spinBase, setSpinBase] = useState<SpinBase>('coherent')
  const [m, setM] = useState(1)
  const [numQubits, setNumQubits] = useState(3)
  const [qubitPreset, setQubitPreset] = useState<QubitPreset>('ghz')
  const [theta, setTheta] = useState(Math.PI / 2)
  const [phi, setPhi] = useState(0)

  const [twistAxis, setTwistAxis] = useState<Axis>('z')
  const [chi, setChi] = useState(0)
  const [rotAxis, setRotAxis] = useState<Axis>('y')
  const [angle, setAngle] = useState(0)

  const [animate, setAnimate] = useState<Animate>('off')
  const [reduceMotion, setReduceMotion] = useState(false)
  const [showTrails, setShowTrails] = useState(true)
  const [showHull, setShowHull] = useState(true)
  const [showMean, setShowMean] = useState(true)

  // The spin on show: j from the picker, or n/2 from the qubit count.
  const activeTwoJ = family === 'spin' ? twoJ : numQubits
  const j = activeTwoJ / 2
  // One full period of the twist; the slider spans it and the animation wraps at it.
  const chiPeriod = twistPeriod(activeTwoJ)
  useEffect(() => {
    if (chi > chiPeriod) setChi(chi % chiPeriod)
  }, [chi, chiPeriod])

  // Keep m inside the multiplet when j changes.
  const mOptions = useMemo(
    () => Array.from({ length: activeTwoJ + 1 }, (_, k) => ({ value: String(j - k), label: mLabel(j - k) })),
    [activeTwoJ, j]
  )
  useEffect(() => {
    if (Math.abs(m) > j || !Number.isInteger(m - j)) setM(j)
  }, [j, m])

  // ── The state: base → twist → rotate ─────────────────────────────────────
  const base = useMemo<Complex[]>(() => {
    if (family === 'spin') {
      if (spinBase === 'coherent') return spinCoherentState(twoJ, theta, phi)
      if (spinBase === 'cat') return catState(twoJ)
      const safeM = Math.abs(m) <= j && Number.isInteger(m - j) ? m : j
      return spinBasisState(twoJ, safeM)
    }
    if (qubitPreset === 'ghz') return ghzState(numQubits)
    if (qubitPreset === 'w') return wState(numQubits)
    if (qubitPreset === 'dicke') return dickeState(numQubits, Math.floor(numQubits / 2))
    return spinCoherentState(numQubits, theta, phi)
  }, [family, spinBase, twoJ, theta, phi, m, j, qubitPreset, numQubits])

  const psi = useMemo(() => {
    const twisted = chi === 0 ? base : twistAbout(base, twistAxis, chi)
    const rotated = angle === 0 ? twisted : rotateState(twisted, rotAxis, angle)
    return normalize(rotated)
  }, [base, chi, twistAxis, angle, rotAxis])

  // Stars, in an order that follows each star from frame to frame.
  const prevStarsRef = useRef<Star[]>([])
  const stars = useMemo(() => {
    const raw = majoranaStars(psi)
    const matched = matchStars(prevStarsRef.current, raw)
    prevStarsRef.current = matched
    return matched
  }, [psi])

  const mean = useMemo(() => meanSpin(psi), [psi])
  const meanLength = Math.hypot(mean.x, mean.y, mean.z) / j
  const meanUnit = useMemo(() => ({ x: mean.x / j, y: mean.y / j, z: mean.z / j }), [mean, j])
  const spread = useMemo(() => constellationSpread(stars), [stars])

  // ── Trails ────────────────────────────────────────────────────────────────
  const [trails, setTrails] = useState<Trail[]>([])
  useEffect(() => {
    setTrails((prev) => appendTrails(prev, stars))
  }, [stars])
  const clearTrails = useCallback(() => setTrails(stars.map((s) => [{ x: s.x, y: s.y, z: s.z }])), [stars])

  // ── Animation: advance the angle or the twist while the picker says so ────
  // Under prefers-reduced-motion the picker is not offered at all: every change
  // to the constellation is then one the reader made with a slider.
  useEffect(() => {
    if (prefersReducedMotion()) {
      setReduceMotion(true)
      setAnimate('off')
    }
  }, [])
  useEffect(() => {
    if (animate === 'off' || reduceMotion) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      if (animate === 'rotate') setAngle((a) => (a + ROTATE_RATE * dt) % (2 * Math.PI))
      else setChi((c) => (c + TWIST_RATE * dt) % chiPeriod)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [animate, reduceMotion, chiPeriod])

  const reset = () => {
    setAnimate('off')
    setChi(0)
    setAngle(0)
    setTrails([])
  }

  const usesAngles = (family === 'spin' && spinBase === 'coherent') || (family === 'qubits' && qubitPreset === 'product')

  const stateLabel =
    family === 'spin'
      ? spinBase === 'coherent'
        ? `spin-${J_OPTIONS[twoJ - 1].label} coherent state`
        : spinBase === 'cat'
          ? `spin-${J_OPTIONS[twoJ - 1].label} cat state`
          : `|${J_OPTIONS[twoJ - 1].label}, ${mLabel(m)}⟩`
      : `${numQubits}-qubit ${qubitPreset === 'dicke' ? `Dicke (${Math.floor(numQubits / 2)} excitations)` : qubitPreset === 'product' ? 'product' : qubitPreset.toUpperCase()} state`

  const controls = (
    <>
      <Segmented<Family> label="What kind of state" value={family} options={FAMILY_OPTIONS} onChange={setFamily} />

      {family === 'spin' ? (
        <>
          <Segmented
            label="Spin j"
            value={String(twoJ)}
            options={J_OPTIONS}
            onChange={(v) => {
              setTwoJ(Number(v))
              setTrails([])
            }}
          />
          <Segmented<SpinBase> label="Starting state" value={spinBase} options={SPIN_BASE_OPTIONS} onChange={setSpinBase} />
          {spinBase === 'basis' ? (
            <Segmented label="m" value={String(m)} options={mOptions} onChange={(v) => setM(Number(v))} />
          ) : null}
        </>
      ) : (
        <>
          <Segmented
            label="Qubits n (so j = n/2)"
            value={String(numQubits)}
            options={N_OPTIONS}
            onChange={(v) => {
              setNumQubits(Number(v))
              setTrails([])
            }}
          />
          <Segmented<QubitPreset>
            label="Starting state"
            value={qubitPreset}
            options={QUBIT_PRESET_OPTIONS.filter((o) => o.value !== 'w' || numQubits >= 3)}
            onChange={setQubitPreset}
          />
        </>
      )}

      {usesAngles ? (
        <>
          <Slider
            label="θ (polar)"
            value={theta}
            min={0}
            max={Math.PI}
            step={0.01}
            format={formatPi}
            onChange={setTheta}
            hint="Where all the stars start, stacked on one point."
          />
          <Slider label="φ (azimuth)" value={phi} min={0} max={2 * Math.PI} step={0.01} format={formatPi} onChange={setPhi} />
        </>
      ) : null}

      <div className="border-t border-line pt-3">
        <Segmented<Axis> label="Twist about" value={twistAxis} options={AXIS_OPTIONS} onChange={setTwistAxis} />
        <Slider
          label={`Twist χ (one-axis twisting, e^{−iχJ${twistAxis}²})`}
          value={Math.min(chi, chiPeriod)}
          min={0}
          max={chiPeriod}
          step={0.005}
          format={formatPi}
          onChange={setChi}
          hint={`Not a rotation. Watch the stars separate — unless j = ½, where nothing can move. The slider spans one full period (${formatPi(chiPeriod)} for this j).`}
        />
      </div>

      <div className="border-t border-line pt-3">
        <Segmented<Axis> label="Then rotate about" value={rotAxis} options={AXIS_OPTIONS} onChange={setRotAxis} />
        <Slider
          label="Rotation angle"
          value={angle}
          min={0}
          max={2 * Math.PI}
          step={0.01}
          format={formatPi}
          onChange={setAngle}
          hint="An SU(2) rotation. The constellation turns as one rigid body."
        />
      </div>

      {reduceMotion ? null : (
        <Segmented<Animate> label="Animate" value={animate} options={ANIMATE_OPTIONS} onChange={setAnimate} />
      )}

      <ButtonRow>
        <button type="button" className="btn-ghost focus-ring" onClick={clearTrails}>
          Clear trails
        </button>
        <button type="button" className="btn-ghost focus-ring" onClick={reset}>
          Reset
        </button>
      </ButtonRow>

      <Toggle label="Show trails" checked={showTrails} onChange={setShowTrails} />
      <Toggle label="Show convex hull" checked={showHull} onChange={setShowHull} hint="The shape the constellation makes." />
      <Toggle label="Show ⟨J⟩ arrow" checked={showMean} onChange={setShowMean} hint="The big spin's own Bloch vector, scaled by 1/j." />

      <div className="grid grid-cols-2 gap-2">
        <Stat label="Stars (2j)" value={String(activeTwoJ)} accent="amber" />
        <Stat label="|⟨J⟩| / j" value={meanLength.toFixed(3)} accent="violet" />
        <Stat label="Spread" value={formatDeg(spread)} accent="sky" />
        <Stat label="Amplitudes" value={String(activeTwoJ + 1)} accent="teal" />
      </div>
    </>
  )

  return (
    <VizFrame
      title="Majorana Stars"
      tagline="A single qubit is one point on the Bloch sphere. A bigger spin is several — and the difference between a rotation and everything else is whether those points move together."
      level="Advanced"
      canvas={
        <div className="p-2">
          <MajoranaSphere
            stars={stars}
            trails={showTrails ? trails : undefined}
            showHull={showHull}
            meanSpin={showMean ? meanUnit : null}
          />
          <p className="px-3 pb-2 pt-1 text-[11px] text-ink-muted">
            Drag or use the arrow keys to rotate the view. Scroll or press + / − to zoom. Amber dots are the
            stars; far-side stars are dimmed; the violet arrow is ⟨J⟩/j.
          </p>
        </div>
      }
      controls={controls}
    >
      <div className="mb-6">
        <h2 className="section-label mb-2">State on show: {stateLabel}</h2>
        <pre className="code-block">
          {psi
            .map((amp, k) => `(${formatComplex(amp)})|${J_OPTIONS[activeTwoJ - 1].label}, ${mLabel(j - k)}⟩`)
            .join(' + ')}
        </pre>
        <table className="mt-3 w-full text-left text-[13px]">
          <caption className="sr-only">Star positions</caption>
          <thead>
            <tr className="text-[10px] font-bold uppercase tracking-wider text-ink-muted">
              <th className="py-1 pr-3">Star</th>
              <th className="py-1 pr-3">θ</th>
              <th className="py-1 pr-3">φ</th>
              <th className="py-1">Bloch (x, y, z)</th>
            </tr>
          </thead>
          <tbody className="font-mono text-ink-secondary">
            {stars.map((s, i) => (
              <tr key={i} className="border-t border-line">
                <td className="py-1 pr-3">{i + 1}</td>
                <td className="py-1 pr-3">{formatPi(s.theta)}</td>
                <td className="py-1 pr-3">{formatPi(s.phi)}</td>
                <td className="py-1">
                  ({s.x.toFixed(2)}, {s.y.toFixed(2)}, {s.z.toFixed(2)})
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Explainer title="Why more than one point">
        <p>
          On the <Link href="/visualizations/bloch-sphere" className="text-q-sky-text underline-offset-2 hover:underline">Bloch sphere</Link>{' '}
          a qubit is one arrow: two real numbers (θ, φ) for a state with two complex amplitudes, once you drop
          the norm and the global phase. A spin-j state has 2j+1 amplitudes — the readout above lists them — so
          it needs 4j real numbers, and one arrow cannot hold them. Two angles per point, 2j points: that is
          exactly the count. Majorana noticed in 1932 that the state itself does the bookkeeping. Write the 2j+1
          amplitudes as the coefficients of a polynomial of degree 2j; its 2j roots, dropped onto the sphere by
          stereographic projection, are the stars you see.
        </p>
        <p>
          Every star is a legitimate Bloch vector. For the symmetric states of n qubits — GHZ, W, Dicke, or
          n copies of the same qubit — the picture is literal: the state is the symmetrised product of n single
          qubits, and the stars are those n qubits&rsquo; Bloch vectors. Pick <em>Symmetric qubits</em> and{' '}
          <em>Product</em>: all the stars sit stacked on one point, because the qubits really are all in the same
          state. Pick GHZ: they spread into a regular polygon on the equator. Pick W: n−1 at |0⟩ and one at |1⟩
          — the W state is, in spin language, simply |n/2, n/2−1⟩.
        </p>
      </Explainer>

      <Explainer title="Rotations move the stars together; nothing else does">
        <p>
          Drag the <em>Rotation angle</em> slider. Whatever shape the constellation has, it turns as a rigid body
          — the hull keeps its shape, the pairwise angles between stars never change, and the trails are
          concentric circles about the axis you chose. That is what an SU(2) rotation is: the same physical
          rotation applied to every one of the 2j underlying qubits at once. The single-qubit Bloch sphere only
          ever shows you this case, which is why it makes every operation look like a rotation.
        </p>
        <p>
          Now set the rotation back to zero and drag <em>Twist χ</em> instead. This applies e^{'{'}−iχJ_z²{'}'},
          the one-axis-twisting interaction that squeezes spin in atomic clocks and, on qubits, is a pairwise
          Z⊗Z coupling — an entangling operation. The stars do not turn; they <em>separate</em>. A tiny χ already
          scatters a stacked coherent state into a ring, while the ⟨J⟩ arrow has barely shortened: most of the
          state is still pointing where it was, but the constellation announces immediately that the state has
          left the set of &ldquo;n identical qubits&rdquo;. Keep going and the arrow shrinks toward zero as the
          stars spread over the whole sphere. That shrinking is the honest measure of how far from classical the
          state has gone, and a single arrow was never going to show you the rest.
        </p>
        <p>
          Try the twist at j = ½. Nothing happens: J_z² is a constant there, so the twist is a global phase. One
          qubit has no room to squeeze. The moment a second point appears on the sphere, it does.
        </p>
        <p>
          Keep the twist going and the stars come back. For a half-integer j the constellation returns to its
          starting shape at χ = π; for an integer j the trip takes 2π, but halfway, at χ = π, the phases
          e^{'{'}−iπm²{'}'} = (−1)^m are exactly a rotation by π about z: a stacked coherent state that was
          scattered over the sphere re-collapses to a single point on the far side. Halfway to that, at χ = π/2, it
          passes through a cat state — the coherent state superposed with its own π-rotated twin — whose stars
          form a regular ring in the plane perpendicular to the original direction, just as GHZ&rsquo;s do. The
          slider spans exactly one period, so what you see at its right-hand end is the start again.
        </p>
      </Explainer>

      <Explainer title="Reading a constellation">
        <p>
          <strong className="text-ink">All stars on one point</strong> — a spin coherent state, the closest a
          big spin gets to a classical arrow; |⟨J⟩| = j exactly, and the hull collapses to nothing. For qubits
          this is a product state: no entanglement at all.
        </p>
        <p>
          <strong className="text-ink">Stars split between the poles</strong> — the |j, m⟩ states: j+m at the
          top, j−m at the bottom. The hull is a single line through the centre of the sphere.
        </p>
        <p>
          <strong className="text-ink">A regular polygon on the equator</strong> — the cat / GHZ family. ⟨J⟩
          vanishes: the amplitudes sit at m = ±j, which no single J± step connects, so there is no direction
          the spin &ldquo;points&rdquo;, only a shape. States whose
          stars are spread as evenly as possible over the sphere (Platonic solids, for the right j) are the
          most non-classical spin states there are, and the ones best suited to sensing rotations about every
          axis at once.
        </p>
        <p>
          The polynomial&rsquo;s roots are found numerically, and a root that appears 2j times over is
          inherently harder to pin down than 2j separate roots — so a coherent state&rsquo;s stacked stars may
          sit a fraction of a degree apart at j = 3. That is a property of polynomials, not of the physics, and
          it disappears the instant the stars actually separate.
        </p>
      </Explainer>
    </VizFrame>
  )
}
