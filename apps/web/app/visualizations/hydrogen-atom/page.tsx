'use client'

import { useMemo, useState } from 'react'
import { lazyViz } from '@/components/viz/LazyViz'
import type { AtomModel, AtomRender } from '@/components/viz/HydrogenAtom'
import { HydrogenSpectrum } from '@/components/viz/HydrogenSpectrum'
import { VizFrame, Explainer } from '@/components/ui/VizFrame'
import { Segmented, Stat, Toggle } from '@/components/ui/Controls'
import {
  MAX_N,
  SPECTRAL_SERIES,
  angularNodeCount,
  bohrRadiusOfOrbit,
  energyEv,
  expectedRadius,
  lineName,
  orbitalName,
  radialNodeCount,
  regionOf,
  seriesLines,
  subshellLetter,
  transitionEnergyEv,
  transitionWavelengthNm,
} from '@/lib/quantum/hydrogen'
import { wavelengthToCss } from '@/lib/viz/spectralColor'

/**
 * three.js is 512 kB and nothing can be drawn before the browser hands over a
 * WebGL context anyway, so it loads after hydration behind a height-reserving
 * skeleton — same treatment as the Bloch sphere. Module scope, never inside a
 * render: see the note in LazyViz.tsx.
 */
const HydrogenAtom = lazyViz<{
  model: AtomModel
  n: number
  l: number
  m: number
  detail: number
  cutaway: boolean
  render: AtomRender
}>(() => import('@/components/viz/HydrogenAtom'), { minHeight: 440 })

const RENDER_OPTIONS: { value: AtomRender; label: string }[] = [
  { value: 'cloud', label: 'Density cloud' },
  { value: 'points', label: 'Sampled points' },
]

const MODEL_OPTIONS: { value: AtomModel; label: string }[] = [
  { value: 'bohr', label: 'Bohr 1913' },
  { value: 'schrodinger', label: 'Schrödinger 1926' },
]

const DETAIL_OPTIONS = [
  { value: '12000', label: 'Light' },
  { value: '30000', label: 'Standard' },
  { value: '60000', label: 'Dense' },
]

/** Highest upper level offered in the transition picker. */
const MAX_TRANSITION_N = 8

export default function HydrogenAtomPage() {
  const [model, setModel] = useState<AtomModel>('bohr')
  const [n, setN] = useState(3)
  const [l, setL] = useState(2)
  const [m, setM] = useState(0)
  const [cutaway, setCutaway] = useState(false)
  const [detail, setDetail] = useState('30000')
  const [render, setRender] = useState<AtomRender>('cloud')

  const [nInitial, setNInitial] = useState(3)
  const [nFinal, setNFinal] = useState(2)

  // l ≤ n−1 and |m| ≤ l are not style rules, they are the boundary conditions:
  // clamp rather than offer a state that does not exist.
  const setPrincipal = (next: number) => {
    setN(next)
    const nextL = Math.min(l, next - 1)
    setL(nextL)
    setM(Math.max(-nextL, Math.min(m, nextL)))
  }
  const setAzimuthal = (next: number) => {
    setL(next)
    setM(Math.max(-next, Math.min(m, next)))
  }

  const nOptions = useMemo(
    () => Array.from({ length: MAX_N }, (_, i) => ({ value: String(i + 1), label: String(i + 1) })),
    []
  )
  const lOptions = useMemo(
    () =>
      Array.from({ length: n }, (_, i) => ({
        value: String(i),
        label: `${i} ${subshellLetter(i)}`,
      })),
    [n]
  )
  const mOptions = useMemo(
    () =>
      Array.from({ length: 2 * l + 1 }, (_, i) => ({
        value: String(i - l),
        label: String(i - l),
      })),
    [l]
  )

  const { shell, sub } = orbitalName(n, l, m)
  const lambda = transitionWavelengthNm(nInitial, nFinal)
  const photonEv = transitionEnergyEv(nInitial, nFinal)
  const region = regionOf(lambda)
  const seriesName = SPECTRAL_SERIES.find((s) => s.nFinal === nFinal)
  const balmer = useMemo(() => seriesLines(2, 6), [])

  const controls = (
    <>
      <Segmented<AtomModel>
        label="Model"
        value={model}
        options={MODEL_OPTIONS}
        onChange={setModel}
      />

      <Segmented
        label="Principal quantum number n"
        value={String(n)}
        options={nOptions}
        onChange={(v) => setPrincipal(parseInt(v, 10))}
      />

      {model === 'schrodinger' ? (
        <>
          <Segmented
            label="Angular momentum l"
            value={String(l)}
            options={lOptions}
            onChange={(v) => setAzimuthal(parseInt(v, 10))}
          />
          <Segmented
            label="Magnetic quantum number m"
            value={String(m)}
            options={mOptions}
            onChange={(v) => setM(parseInt(v, 10))}
          />
          <Segmented<AtomRender>
            label="Drawn as"
            value={render}
            options={RENDER_OPTIONS}
            onChange={setRender}
          />
          <Toggle
            label="Cut away the near half"
            checked={cutaway}
            onChange={setCutaway}
            hint="Slices the cloud open so the shells inside it stop hiding behind each other."
          />
          <Segmented
            label={render === 'cloud' ? 'Detail' : 'Point density'}
            value={detail}
            options={DETAIL_OPTIONS}
            onChange={setDetail}
          />
        </>
      ) : (
        <p className="rounded-lg border border-line bg-surface-2 p-3 text-[12px] leading-relaxed text-ink-secondary">
          Bohr&rsquo;s model has no l and no m. One integer fixes the orbit, the energy and the
          picture — which is exactly why it cannot explain why a magnetic field splits the
          lines. Switch to Schrödinger and the other two quantum numbers appear.
        </p>
      )}

      <div className="grid grid-cols-2 gap-2">
        <Stat label="Energy" value={`${energyEv(n).toFixed(2)} eV`} accent="rose" />
        <Stat
          label={model === 'bohr' ? 'Orbit radius' : 'Mean radius ⟨r⟩'}
          value={`${(model === 'bohr' ? bohrRadiusOfOrbit(n) : expectedRadius(n, l)).toFixed(1)} a₀`}
          accent="amber"
        />
        {model === 'schrodinger' ? (
          <>
            <Stat label="Radial nodes" value={`${radialNodeCount(n, l)}`} accent="sky" />
            <Stat label="Angular nodes" value={`${angularNodeCount(l)}`} accent="teal" />
          </>
        ) : (
          <>
            <Stat label="Allowed l values" value="none" accent="sky" />
            <Stat label="Orbit period" value={`∝ n³ = ${n * n * n}`} accent="teal" />
          </>
        )}
      </div>

      <p className="text-[11px] leading-relaxed text-ink-muted">
        {model === 'bohr'
          ? 'Orbits are drawn to scale at rₙ = n²a₀, so the n=6 orbit really is 36 times the n=1 orbit.'
          : render === 'cloud'
            ? 'The cloud is |ψ|² itself, ray-marched voxel by voxel from the exact analytic wavefunction — no fitting, no isosurface. Switch to points to see the same density as individual position samples; a browser without WebGL2 shows the points.'
            : 'Every dot is one sample drawn from |ψ|², computed from the exact analytic wavefunction — no fitting, no isosurface.'}
      </p>
    </>
  )

  return (
    <VizFrame
      title="Models of the Hydrogen Atom"
      tagline="Two pictures of the same atom that predict exactly the same spectrum — and disagree about almost everything else."
      level="Intermediate"
      canvas={
        <div className="p-2">
          <HydrogenAtom
            model={model}
            n={n}
            l={l}
            m={m}
            detail={parseInt(detail, 10)}
            cutaway={cutaway}
            render={render}
          />
          <p className="px-3 pb-2 pt-1 text-[11px] leading-relaxed text-ink-muted">
            {model === 'bohr' ? (
              <>
                The amber dot is the proton; the sky dot is the electron, circling the n={n} orbit.
                Bohr gave the inner electron a shorter path <em>and</em> a faster lap, so the period
                grows as n³. Drag to rotate, scroll to zoom.
              </>
            ) : (
              <>
                Currently showing{' '}
                <strong className="text-q-rose-text">
                  {shell}
                  {sub ? <sub>{sub}</sub> : null}
                </strong>
                {render === 'cloud' ? ' as a density cloud' : ' as sampled points'}. Rose is where ψ
                is positive, sky where it is negative — the boundary between two colours is a node,
                a surface the electron is never found on. Drag to rotate, scroll to zoom.
              </>
            )}
          </p>
        </div>
      }
      controls={controls}
    >
      <Explainer title="Where the quantum numbers stop being algebra">
        <p>
          Start on Bohr and step n from 1 to 6. That is the whole model: circular orbits at
          rₙ = n²a₀, one per allowed energy, and an electron that is somewhere definite at every
          moment. It got the hydrogen spectrum right in 1913, which is why anyone remembers it.
        </p>
        <p>
          Now switch to Schrödinger at the same n. The energy readout does not move. The orbit
          does — it is gone, replaced by a cloud with no edge and, for l &gt; 0, no spherical
          symmetry at all. Then step l and m and watch shapes appear that the Bohr model has no
          vocabulary for.
        </p>
      </Explainer>

      <Explainer title="Reading a shape off three integers">
        <p>
          <strong>n</strong> sets the size and the energy: ⟨r⟩ = ½(3n² − l(l+1)) a₀, so 4s is a
          long way outside 2s. <strong>l</strong> sets the shape — 0 is a sphere, 1 is a dumbbell,
          2 is the four-lobed clover. <strong>m</strong> only turns it: p<sub>x</sub>,
          p<sub>y</sub> and p<sub>z</sub> are one object pointing three different ways, with
          exactly the same energy — until a magnetic field picks out an axis and splits them
          apart, which is where &ldquo;magnetic quantum number&rdquo; got its name.
        </p>
        <p>
          One honesty note about the shapes. The states with a definite m are complex, and |ψ|²
          for them has no dependence on the azimuthal angle at all — every m ≠ 0 orbital would
          render as the same featureless doughnut. What is drawn here are the <em>real</em>
          combinations, the ones chemistry uses. They span the same space, have the same energy
          and the same node count, and they are the version with shapes.
        </p>
        <p>
          The nodes are the give-away, and they are countable. Every orbital has exactly n − 1
          nodal surfaces. l of them are angular (flat planes or cones through the nucleus, where the
          colour flips), and the remaining n − l − 1 are radial (whole spherical shells of zero
          probability). Set n=3, l=0 and turn on the cutaway: three nested shells of density,
          separated by two spherical surfaces the electron is never found on — and no route from
          the innermost shell to the outermost that avoids crossing them. A particle on an orbit
          cannot do that. A standing wave can.
        </p>
      </Explainer>

      <section className="card mb-4 p-6">
        <h2 className="mb-1 text-lg font-bold">The spectrum both models predict</h2>
        <p className="mb-4 text-[15px] leading-relaxed text-ink-secondary">
          Drop the electron from one level to another and the atom emits a photon carrying exactly
          the energy difference. Pick a jump — the arrow shows the drop, and the plate on the right
          shows where that photon lands if the eye can see it at all.
        </p>

        <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Segmented
            label="Falls from n"
            value={String(nInitial)}
            options={Array.from({ length: MAX_TRANSITION_N - 1 }, (_, i) => ({
              value: String(i + 2),
              label: String(i + 2),
            })).filter((o) => parseInt(o.value, 10) > nFinal)}
            onChange={(v) => setNInitial(parseInt(v, 10))}
          />
          <Segmented
            label="Lands on n (the series)"
            value={String(nFinal)}
            options={SPECTRAL_SERIES.map((s) => ({
              value: String(s.nFinal),
              label: `${s.nFinal} · ${s.name}`,
            }))}
            onChange={(v) => {
              const next = parseInt(v, 10)
              setNFinal(next)
              if (nInitial <= next) setNInitial(Math.min(next + 1, MAX_TRANSITION_N))
            }}
          />
        </div>

        <HydrogenSpectrum nInitial={nInitial} nFinal={nFinal} maxN={MAX_TRANSITION_N} />

        <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Line" value={lineName(nInitial, nFinal) ?? `${nInitial}→${nFinal}`} accent="rose" />
          <Stat label="Wavelength" value={`${lambda.toFixed(1)} nm`} accent="violet" />
          <Stat label="Photon energy" value={`${photonEv.toFixed(3)} eV`} accent="amber" />
          <Stat label="Region" value={region} accent="sky" />
        </div>

        {seriesName ? (
          <p className="mt-3 text-[13px] leading-relaxed text-ink-muted">
            <strong className="text-ink-secondary">{seriesName.name} series.</strong>{' '}
            {seriesName.note}
          </p>
        ) : null}
      </section>

      <Explainer title="The four lines in a lab discharge tube">
        <p>
          Point a hand spectroscope at a hydrogen lamp and you see four sharp lines on a black
          field: red, cyan, blue-violet, violet. Those are the Balmer series — every jump that ends
          on n = 2 — and nothing else about hydrogen is visible to the naked eye. Every Lyman line
          (ending on n = 1) is ultraviolet; every Paschen line is infrared.
        </p>
        <div className="-mx-2 overflow-x-auto px-2">
          <table className="w-full min-w-[26rem] border-collapse text-left text-[13px]">
            <caption className="sr-only">
              The Balmer series: transitions ending on n equals 2, with their vacuum wavelengths.
            </caption>
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-ink-muted">
                <th scope="col" className="py-2 pr-3 font-bold">Line</th>
                <th scope="col" className="py-2 pr-3 font-bold">Jump</th>
                <th scope="col" className="py-2 pr-3 font-bold">λ (vacuum)</th>
                <th scope="col" className="py-2 pr-3 font-bold">Photon</th>
                <th scope="col" className="py-2 font-bold">Colour</th>
              </tr>
            </thead>
            <tbody className="font-mono text-ink-secondary">
              {balmer.map((line) => (
                <tr key={line.nInitial} className="border-t border-line">
                  <td className="py-2 pr-3">{line.name}</td>
                  <td className="py-2 pr-3">
                    {line.nInitial} → {line.nFinal}
                  </td>
                  <td className="py-2 pr-3">{line.wavelengthNm.toFixed(2)} nm</td>
                  <td className="py-2 pr-3">{line.photonEv.toFixed(3)} eV</td>
                  <td className="py-2">
                    <span
                      aria-hidden
                      className="inline-block h-3 w-8 rounded-sm border border-line align-middle"
                      style={{ backgroundColor: wavelengthToCss(line.wavelengthNm) }}
                    />
                    <span className="sr-only">
                      {regionOf(line.wavelengthNm)} at {line.wavelengthNm.toFixed(0)} nanometres
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          These are vacuum wavelengths, computed from the Rydberg formula with the reduced-mass
          Rydberg constant for hydrogen. A lab handbook usually quotes them in air, which shortens
          each by about 0.03% — the familiar 656.28 nm for the red line is the same photon as the
          656.47 nm above (NIST&rsquo;s measured vacuum value is 656.46 nm; the last digit is
          fine-structure and QED corrections the Rydberg formula does not know about).
        </p>
      </Explainer>

      <Explainer title="What just happened">
        <p>
          You changed the picture of the atom completely and the spectrum did not move. Both models
          put the energy at −13.6 eV / n², so both predict the Balmer lines to four figures, and
          for thirteen years that was enough to make Bohr&rsquo;s orbits look correct.
        </p>
        <p>
          What broke them was everything the spectrum does <em>not</em> depend on. Bohr had no l,
          so he could not say why lines split in a magnetic field, why some transitions are bright
          and others forbidden, or why the periodic table has the shape it has. Schrödinger&rsquo;s
          version has three quantum numbers instead of one, and the two extra ones are exactly the
          ones that turned out to explain chemistry — while contributing nothing at all to the
          energy of a hydrogen atom.
        </p>
        <p>
          One more thing worth sitting with: nothing on this page is a photograph. The cloud is a
          probability density, so a single measurement returns a single position, and it is only
          the ensemble of many measurements that has the shape you rotated. The Bohr orbit is the
          honest, wrong version of the same information — a definite path that happens to reproduce
          the right energies.
        </p>
      </Explainer>
    </VizFrame>
  )
}
