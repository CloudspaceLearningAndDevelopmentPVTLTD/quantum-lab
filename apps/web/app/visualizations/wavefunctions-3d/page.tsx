'use client'

import { useMemo, useState } from 'react'
import { lazyViz } from '@/components/viz/LazyViz'
import type { VolumeRendererProps } from '@/components/viz/VolumeRenderer'
import { VizFrame, Explainer } from '@/components/ui/VizFrame'
import { Segmented, Slider, Stat, Toggle } from '@/components/ui/Controls'
import {
  type System3D,
  type Vec3,
  type Volume,
  axisNodeCounts,
  boxDegeneratePartners,
  boxVolume,
  hydrogenVolume,
  oscillatorDegeneratePartners,
  oscillatorHalfWidth,
  oscillatorVolume,
  rotorVolume,
} from '@/lib/quantum/schrodinger3d'
import { makeRadialSampler, orbitalName, subshellLetter } from '@/lib/quantum/hydrogen'

/**
 * three.js (and the ray-marching shader) load after hydration behind a
 * height-reserving skeleton, the same way every WebGL page here does it.
 * Module scope, never inside a render — see LazyViz.tsx.
 */
const VolumeRenderer = lazyViz<VolumeRendererProps>(() => import('@/components/viz/VolumeRenderer'), {
  minHeight: 460,
})

type Axis3 = 'x' | 'y' | 'z'
type ColorMode = 'density' | 'phase'
type BoxShape = 'cube' | 'brick'
type OscShape = 'isotropic' | 'squashed'
type RotorBasis = 'complex' | 'real'

const SYSTEM_OPTIONS: { value: System3D; label: string }[] = [
  { value: 'box', label: 'Box' },
  { value: 'oscillator', label: 'Oscillator' },
  { value: 'rotor', label: 'Rigid rotor' },
  { value: 'hydrogen', label: 'Hydrogen' },
]

const BOX_L: Record<BoxShape, Vec3> = { cube: [1, 1, 1], brick: [1, 1, 1.5] }
const OSC_OMEGA: Record<OscShape, Vec3> = { isotropic: [1, 1, 1], squashed: [1, 1, 2] }

/** Quanta per axis offered for the box (1..) and the oscillator (0..). */
const BOX_MAX_N = 4
const OSC_MAX_N = 3
const ROTOR_MAX_L = 4
const HYDROGEN_MAX_N = 4

const RESOLUTION_OPTIONS = [
  { value: '40', label: 'Quick' },
  { value: '56', label: 'Standard' },
  { value: '72', label: 'Fine' },
]

/**
 * A ± stepper for one quantum number. Real buttons, so it is keyboard- and
 * screen-reader-operable; the value is announced as part of the group name.
 */
function Stepper({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  onChange: (v: number) => void
}) {
  return (
    <div
      role="group"
      aria-label={`${label}, currently ${value}`}
      className="flex items-center justify-between gap-2 rounded-lg border border-line bg-surface-2 px-2 py-1"
    >
      <span className="text-[13px] font-semibold text-ink-secondary">{label}</span>
      <span className="flex items-center gap-1">
        <button
          type="button"
          aria-label={`Decrease ${label}`}
          disabled={value <= min}
          onClick={() => onChange(Math.max(min, value - 1))}
          className="focus-ring h-8 w-8 rounded-md text-base font-bold text-ink-muted hover:bg-surface-3 hover:text-ink-secondary disabled:opacity-30"
        >
          −
        </button>
        <span className="w-6 text-center font-mono text-sm font-bold text-q-violet-text" aria-hidden>
          {value}
        </span>
        <button
          type="button"
          aria-label={`Increase ${label}`}
          disabled={value >= max}
          onClick={() => onChange(Math.min(max, value + 1))}
          className="focus-ring h-8 w-8 rounded-md text-base font-bold text-ink-muted hover:bg-surface-3 hover:text-ink-secondary disabled:opacity-30"
        >
          +
        </button>
      </span>
    </div>
  )
}

const fmtTriple = (t: Vec3) => `(${t[0]}, ${t[1]}, ${t[2]})`

export default function Wavefunctions3dPage() {
  const [system, setSystem] = useState<System3D>('box')
  const [boxN, setBoxN] = useState<Vec3>([1, 1, 2])
  const [boxShape, setBoxShape] = useState<BoxShape>('cube')
  const [oscN, setOscN] = useState<Vec3>([1, 0, 0])
  const [oscShape, setOscShape] = useState<OscShape>('isotropic')
  const [rotorL, setRotorL] = useState(2)
  const [rotorM, setRotorM] = useState(1)
  const [rotorBasis, setRotorBasis] = useState<RotorBasis>('complex')
  const [hN, setHN] = useState(3)
  const [hL, setHL] = useState(2)
  const [hM, setHM] = useState(0)

  const [colorMode, setColorMode] = useState<ColorMode>('phase')
  const [threshold, setThreshold] = useState(0.03)
  const [opacity, setOpacity] = useState(1)
  const [clipOn, setClipOn] = useState(false)
  const [clipAxis, setClipAxis] = useState<Axis3>('y')
  const [clipOffset, setClipOffset] = useState(0.5)
  const [resolution, setResolution] = useState('56')

  const res = parseInt(resolution, 10)
  const clip = useMemo(
    () => ({ axis: clipAxis, offset: clipOffset, enabled: clipOn }),
    [clipAxis, clipOffset, clipOn]
  )

  // ── The volume itself ───────────────────────────────────────────────────
  // Each system keeps a FIXED frame while its quantum numbers change, so a
  // step in n reads as a change of shape rather than a change of zoom.
  const volume: Volume = useMemo(() => {
    switch (system) {
      case 'box':
        return boxVolume({ n: boxN, L: BOX_L[boxShape], resolution: res })
      case 'oscillator': {
        const omega = OSC_OMEGA[oscShape]
        return oscillatorVolume({
          n: oscN,
          omega,
          resolution: res,
          halfWidth: [
            oscillatorHalfWidth(OSC_MAX_N, omega[0]),
            oscillatorHalfWidth(OSC_MAX_N, omega[1]),
            oscillatorHalfWidth(OSC_MAX_N, omega[2]),
          ],
        })
      }
      case 'rotor':
        return rotorVolume({ l: rotorL, m: rotorM, basis: rotorBasis, resolution: res })
      default: {
        // Frame every l at a given n on the s orbital's 98% radius — the largest
        // of the shell — so 3s, 3p and 3d are seen at one scale.
        const extent = makeRadialSampler(hN, 0).quantile(0.98)
        return hydrogenVolume({ n: hN, l: hL, m: hM, resolution: res, extent })
      }
    }
  }, [system, boxN, boxShape, oscN, oscShape, rotorL, rotorM, rotorBasis, hN, hL, hM, res])

  // ── Degenerate partners at the current energy ───────────────────────────
  const partners: { label: string; select: () => void; current: boolean }[] = useMemo(() => {
    switch (system) {
      case 'box':
        return boxDegeneratePartners(boxN, BOX_L[boxShape], BOX_MAX_N).map((t) => ({
          label: fmtTriple(t),
          select: () => setBoxN(t),
          current: t.join() === boxN.join(),
        }))
      case 'oscillator':
        return oscillatorDegeneratePartners(oscN, OSC_OMEGA[oscShape], OSC_MAX_N).map((t) => ({
          label: fmtTriple(t),
          select: () => setOscN(t),
          current: t.join() === oscN.join(),
        }))
      case 'rotor':
        return Array.from({ length: 2 * rotorL + 1 }, (_, i) => i - rotorL).map((m) => ({
          label: `m = ${m}`,
          select: () => setRotorM(m),
          current: m === rotorM,
        }))
      default: {
        const out: { label: string; select: () => void; current: boolean }[] = []
        for (let l = 0; l < hN; l++) {
          for (let m = -l; m <= l; m++) {
            const { shell, sub } = orbitalName(hN, l, m)
            out.push({
              label: sub ? `${shell} ${sub}` : shell,
              select: () => {
                setHL(l)
                setHM(m)
              },
              current: l === hL && m === hM,
            })
          }
        }
        return out
      }
    }
  }, [system, boxN, boxShape, oscN, oscShape, rotorL, rotorM, hN, hL, hM])

  const nodes = useMemo(
    () => (system === 'box' || system === 'oscillator' ? axisNodeCounts(volume) : null),
    [system, volume]
  )

  const energyText =
    system === 'hydrogen'
      ? `${volume.energy.toFixed(2)} eV`
      : system === 'box'
        ? `${(volume.energy / (Math.PI * Math.PI)).toFixed(3)} π² ħ²/mL²`
        : system === 'oscillator'
          ? `${volume.energy.toFixed(1)} ħω`
          : `${volume.energy.toFixed(1)} ħ²/I`

  const stateName =
    system === 'box'
      ? `box state ${fmtTriple(boxN)}`
      : system === 'oscillator'
        ? `oscillator state ${fmtTriple(oscN)}`
        : system === 'rotor'
          ? `rotor state l = ${rotorL}, m = ${rotorM} (${rotorBasis} basis)`
          : (() => {
              const { shell, sub } = orbitalName(hN, hL, hM)
              return `hydrogen ${shell}${sub ? ` ${sub}` : ''} orbital`
            })()

  // Hydrogen: keep l ≤ n − 1 and |m| ≤ l as the constraint they are.
  const setPrincipal = (next: number) => {
    setHN(next)
    const nextL = Math.min(hL, next - 1)
    setHL(nextL)
    setHM(Math.max(-nextL, Math.min(hM, nextL)))
  }
  const setAzimuthal = (next: number) => {
    setHL(next)
    setHM(Math.max(-next, Math.min(hM, next)))
  }
  const setRotorLClamped = (next: number) => {
    setRotorL(next)
    setRotorM(Math.max(-next, Math.min(rotorM, next)))
  }

  const setAxisN = (setter: (v: Vec3) => void, current: Vec3, k: number, v: number) => {
    const next: [number, number, number] = [current[0], current[1], current[2]]
    next[k] = v
    setter(next)
  }

  const controls = (
    <>
      <Segmented<System3D> label="System" value={system} options={SYSTEM_OPTIONS} onChange={setSystem} />

      {system === 'box' ? (
        <>
          <Segmented<BoxShape>
            label="Box shape"
            value={boxShape}
            options={[
              { value: 'cube', label: 'Cube 1:1:1' },
              { value: 'brick', label: 'Brick 1:1:1.5' },
            ]}
            onChange={setBoxShape}
          />
          <div className="flex flex-col gap-1.5">
            {(['n x', 'n y', 'n z'] as const).map((lab, k) => (
              <Stepper
                key={lab}
                label={lab}
                value={boxN[k]}
                min={1}
                max={BOX_MAX_N}
                onChange={(v) => setAxisN(setBoxN, boxN, k, v)}
              />
            ))}
          </div>
        </>
      ) : null}

      {system === 'oscillator' ? (
        <>
          <Segmented<OscShape>
            label="Trap"
            value={oscShape}
            options={[
              { value: 'isotropic', label: 'Isotropic ω=(1,1,1)' },
              { value: 'squashed', label: 'Squashed ω=(1,1,2)' },
            ]}
            onChange={setOscShape}
          />
          <div className="flex flex-col gap-1.5">
            {(['n x', 'n y', 'n z'] as const).map((lab, k) => (
              <Stepper
                key={lab}
                label={lab}
                value={oscN[k]}
                min={0}
                max={OSC_MAX_N}
                onChange={(v) => setAxisN(setOscN, oscN, k, v)}
              />
            ))}
          </div>
        </>
      ) : null}

      {system === 'rotor' ? (
        <>
          <div className="flex flex-col gap-1.5">
            <Stepper label="l" value={rotorL} min={0} max={ROTOR_MAX_L} onChange={setRotorLClamped} />
            <Stepper label="m" value={rotorM} min={-rotorL} max={rotorL} onChange={setRotorM} />
          </div>
          <Segmented<RotorBasis>
            label="Basis"
            value={rotorBasis}
            options={[
              { value: 'complex', label: 'Definite m (complex)' },
              { value: 'real', label: 'Real lobes' },
            ]}
            onChange={setRotorBasis}
          />
        </>
      ) : null}

      {system === 'hydrogen' ? (
        <div className="flex flex-col gap-1.5">
          <Stepper label="n" value={hN} min={1} max={HYDROGEN_MAX_N} onChange={setPrincipal} />
          <Stepper label={`l (${subshellLetter(hL)})`} value={hL} min={0} max={hN - 1} onChange={setAzimuthal} />
          <Stepper label="m" value={hM} min={-hL} max={hL} onChange={setHM} />
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-2">
        <Stat label="Energy" value={energyText} accent="rose" />
        <Stat label="Same energy" value={`${partners.length} state${partners.length === 1 ? '' : 's'}`} accent="amber" />
        {nodes ? (
          <Stat label="Nodes along x · y · z" value={nodes.join(' · ')} accent="sky" />
        ) : system === 'rotor' ? (
          <Stat label="Angular nodes" value={`${rotorL}`} accent="sky" />
        ) : (
          <Stat label="Radial · angular nodes" value={`${hN - hL - 1} · ${hL}`} accent="sky" />
        )}
        <Stat label="∫|ψ|² on grid" value={volume.norm.toFixed(3)} accent="teal" />
      </div>

      <div>
        <span className="mb-1.5 block text-[13px] font-semibold text-ink-secondary">
          States sharing this energy
        </span>
        <div className="flex flex-wrap gap-1">
          {partners.map((p) => (
            <button
              key={p.label}
              type="button"
              aria-pressed={p.current}
              onClick={p.select}
              className={`focus-ring min-h-[32px] rounded-md border px-2 py-1 font-mono text-[11px] font-semibold transition-colors ${
                p.current
                  ? 'border-q-violet/40 bg-q-violet/15 text-q-violet-text'
                  : 'border-line bg-surface-2 text-ink-muted hover:text-ink-secondary'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-ink-muted">
          Every button is an eigenstate with exactly the energy above. Click through them: the
          number stays, the shape does not.
        </p>
      </div>

      <Segmented<ColorMode>
        label="Colour"
        value={colorMode}
        options={[
          { value: 'phase', label: 'Sign / phase of ψ' },
          { value: 'density', label: 'Density only' },
        ]}
        onChange={setColorMode}
      />
      <Slider
        label="Transparency floor"
        value={threshold}
        min={0}
        max={0.4}
        step={0.005}
        onChange={setThreshold}
        format={(v) => `${(v * 100).toFixed(1)}% of peak`}
        hint="Density below this fraction of the peak is drawn fully clear. Raise it and the cloud shrinks toward its densest cores — that is what a textbook isosurface does silently."
      />
      <Slider
        label="Cloud opacity"
        value={opacity}
        min={0.15}
        max={3}
        step={0.05}
        onChange={setOpacity}
        format={(v) => `${v.toFixed(2)}×`}
      />

      <Toggle
        label="Slice with a clip plane"
        checked={clipOn}
        onChange={setClipOn}
        hint="Removes the near side so the shells and nodes inside the cloud show. Drag the plane in the view, or press [ and ]."
      />
      {clipOn ? (
        <>
          <Segmented<Axis3>
            label="Plane normal"
            value={clipAxis}
            options={[
              { value: 'x', label: 'x' },
              { value: 'y', label: 'y' },
              { value: 'z', label: 'z' },
            ]}
            onChange={setClipAxis}
          />
          <Slider
            label="Plane position"
            value={clipOffset}
            min={0}
            max={1}
            step={0.01}
            onChange={setClipOffset}
            format={(v) => `${Math.round(v * 100)}%`}
          />
        </>
      ) : null}

      <Segmented label="Grid" value={resolution} options={RESOLUTION_OPTIONS} onChange={setResolution} />
      <p className="text-[11px] leading-relaxed text-ink-muted">
        {res}³ = {(res * res * res).toLocaleString('en-US')} voxels of |ψ|², computed from the analytic
        eigenfunction and ray-marched on the GPU. Coarser grids are faster; finer ones resolve the
        thin nodal surfaces better.
      </p>
    </>
  )

  return (
    <VizFrame
      title="Wavefunctions in Three Dimensions"
      tagline="A probability density has no edge. Every picture with one is a choice somebody made for you — this one draws the density instead."
      level="Advanced"
      canvas={
        <div className="p-2">
          <VolumeRenderer
            volume={volume}
            threshold={threshold}
            opacity={opacity}
            colorMode={colorMode}
            clip={clip}
            onClipChange={setClipOffset}
            ariaLabel={`Probability cloud of the ${stateName}, energy ${energyText}.`}
            minHeight={460}
          />
          <p className="px-3 pb-2 pt-1 text-[11px] leading-relaxed text-ink-muted">
            Showing the <strong className="text-q-violet-text">{stateName}</strong>.{' '}
            {colorMode === 'phase' ? (
              volume.complex ? (
                <>
                  Hue is the phase of ψ, winding {Math.abs(rotorM)} time{Math.abs(rotorM) === 1 ? '' : 's'}{' '}
                  around the z axis; the brightness is |ψ|², which does not depend on the angle at all.
                </>
              ) : (
                <>
                  Rose is where ψ is positive, sky where it is negative; the boundary between them is a
                  node, a surface where the particle is never found.
                </>
              )
            ) : (
              <>Brightness is |ψ|² alone — where a position measurement is likely to land.</>
            )}{' '}
            Drag to rotate, scroll to zoom
            {clipOn ? ', drag the tinted plane to slice deeper' : ''}.
          </p>
        </div>
      }
      controls={controls}
    >
      <Explainer title="Why a cloud and not a surface">
        <p>
          Open any chemistry textbook and the 2p orbital is a pair of glossy lobes with a crisp
          skin. That skin is not in the physics. It is the surface inside which 90% (or 95%, or
          whatever the illustrator chose) of the probability lives, and the wavefunction
          continues smoothly through it and out the other side. Drawing the surface is a decision
          to hide the tail and to hide the fact that the interior is not uniform either.
        </p>
        <p>
          This page ray-marches |ψ|² itself: every voxel glows and absorbs in proportion to how
          likely the particle is to be there, and what reaches your eye along each line of sight
          is the accumulated probability. Nothing is thresholded unless you ask for it — raise
          the <em>transparency floor</em> and watch the isosurface picture reappear as a special
          case, the one that happens when you decide the faint parts do not count.
        </p>
      </Explainer>

      <Explainer title="What to manipulate, and what to watch">
        <p>
          <strong>Step a quantum number.</strong> In the box and the oscillator each axis has its
          own integer, and each integer adds one nodal plane perpendicular to that axis: the
          <em> nodes</em> readout counts them along a line through the cloud. Turn on the sign
          colouring and the planes are where rose meets sky.
        </p>
        <p>
          <strong>Click through the states that share an energy.</strong> The energy readout does
          not change. The shape does, sometimes dramatically: in a cube, (1,1,2), (1,2,1) and
          (2,1,1) are the same object pointing three ways, and (3,3,3) shares its energy with
          (5,1,1) for no symmetry reason at all — 27 = 27 is an accident of arithmetic. Then switch
          the cube to a brick, or the trap to the squashed one, and watch the partner list shrink
          as the symmetry that protected the degeneracy is taken away.
        </p>
        <p>
          <strong>Slice the cloud.</strong> The 3s orbital and the (0,0,2) oscillator state hide
          their structure inside an outer shell. Turn on the clip plane and drag it through the
          cloud — the spherical nodal shells appear as dark gaps the density never crosses.
        </p>
      </Explainer>

      <Explainer title="Degeneracy: one number, many shapes">
        <p>
          The isotropic oscillator at level N = nₓ + nᵧ + n_z holds ½(N+1)(N+2) states: 1, 3, 6,
          10. The hydrogen shell at n holds n² of them (before spin). The rigid rotor at l holds
          2l + 1. In each case the count is a symmetry counting itself — rotations of the trap,
          the extra hidden symmetry of the Coulomb problem, rotations of the sphere — and in each
          case the degenerate states are as different in shape as states get.
        </p>
        <p>
          The rotor makes the sharpest point. In the <em>definite m</em> basis the density has no
          dependence on the angle around z at all: Y₂¹ is a smooth belt, and only the phase (the
          hue) knows it is spinning. Switch to the <em>real lobes</em> basis — the same energy, the
          same l, a different choice of which combinations to draw — and the belt becomes four
          lobes with nodal planes between them. Both pictures are right. Neither is the shape of
          the state, because a degenerate level does not have one.
        </p>
      </Explainer>

      <Explainer title="What just happened">
        <p>
          You have been looking at the {stateName}, with energy {energyText} and{' '}
          {partners.length === 1
            ? 'no degenerate partner — nothing else in this system has that energy.'
            : `${partners.length - 1} other state${partners.length === 2 ? '' : 's'} at exactly the same energy.`}{' '}
          The grid integral of |ψ|² is {volume.norm.toFixed(3)}: the cloud you rotated holds{' '}
          {Math.round(volume.norm * 100)}% of the particle, and the rest is in the tail outside the
          box, faint but not zero — which is exactly the part an isosurface would have thrown away.
        </p>
        <p>
          If the browser could not create a WebGL2 context, the same data was shown as a single
          slice on a 2-D canvas, with the same colours and the same clip position. The nodes are
          just as countable in a slice; only the sense of depth is lost.
        </p>
      </Explainer>
    </VizFrame>
  )
}
