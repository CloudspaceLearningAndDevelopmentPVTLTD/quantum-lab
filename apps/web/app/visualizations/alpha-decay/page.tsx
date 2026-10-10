'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import AlphaDecayLab from '@/components/viz/AlphaDecayLab'
import StmLab, { formatCurrent, stmCurrentNa, surfaceHeight } from '@/components/viz/StmLab'
import GeigerNuttallPlot, { type GnPoint } from '@/components/viz/GeigerNuttallPlot'
import { VizFrame, Explainer } from '@/components/ui/VizFrame'
import { Segmented, ButtonRow, Slider, Stat } from '@/components/ui/Controls'
import {
  DEFAULT_R0,
  DEFAULT_WELL_DEPTH,
  DISPLAY_G_SCALE,
  NUCLIDES,
  buildDisplayModel,
  formatHalfLife,
  geigerNuttallX,
  nuclideById,
  predictDecay,
  stmCurrentRatio,
  stmKappa,
  type DisplayModel,
} from '@/lib/quantum/alphaDecay'

/**
 * /visualizations/alpha-decay — the Gamow model, with real nuclei.
 *
 * The page owns the choice of nucleus, the two knobs the model has (Q, which the reader may
 * override to see the sensitivity, and r₀), and the list of nuclides added to the
 * Geiger–Nuttall plot. Every number it shows comes from lib/quantum/alphaDecay.ts, whose
 * tests hold the model against the measured half-lives; the wavefunction on the canvas is
 * the scaled Schrödinger solution described there.
 */

const Q_MIN = 3
const Q_MAX = 12

const sci = (v: number) => {
  if (!Number.isFinite(v)) return '—'
  const e = Math.floor(Math.log10(Math.abs(v)))
  const m = v / 10 ** e
  return `${m.toFixed(2)} × 10^${e}`
}

export default function AlphaDecayPage() {
  const [nuclideId, setNuclideId] = useState('U-238')
  const [qOverride, setQOverride] = useState<number | null>(null)
  const [r0, setR0] = useState(DEFAULT_R0)
  const [plotted, setPlotted] = useState<string[]>(['U-238'])

  // STM section.
  const [tipX, setTipX] = useState(6.25)
  const [tipZ, setTipZ] = useState(5)
  const [phi, setPhi] = useState(4.5)

  const nuclide = nuclideById(nuclideId) ?? NUCLIDES[0]
  const q = qOverride ?? nuclide.q
  const qIsReal = qOverride === null || Math.abs(qOverride - nuclide.q) < 1e-9

  const gamow = useMemo(
    () => predictDecay({ Z: nuclide.Z, A: nuclide.A, q, r0 }),
    [nuclide, q, r0]
  )

  // The drawn wavefunction depends only on (R/b, G). It costs a few milliseconds; a short
  // debounce keeps a fast slider drag from queueing dozens of rebuilds.
  const x = gamow.R / gamow.b
  const [model, setModel] = useState<DisplayModel | null>(() => buildDisplayModel(x, gamow.G))
  useEffect(() => {
    const handle = window.setTimeout(() => setModel(buildDisplayModel(x, gamow.G)), 40)
    return () => window.clearTimeout(handle)
  }, [x, gamow.G])

  const pickNuclide = (id: string) => {
    setNuclideId(id)
    setQOverride(null)
  }

  const addToPlot = () =>
    setPlotted((p) => (p.includes(nuclide.id) ? p : [...p, nuclide.id]))
  const plotAll = () => setPlotted(NUCLIDES.map((n) => n.id))
  const clearPlot = () => setPlotted([])

  const points: GnPoint[] = useMemo(
    () =>
      plotted
        .map((id) => nuclideById(id))
        .filter((n): n is NonNullable<typeof n> => Boolean(n))
        .map((n) => {
          const pred = predictDecay({ Z: n.Z, A: n.A, q: n.q, r0 })
          return {
            id: n.id,
            x: geigerNuttallX(n.Z - 2, n.q),
            measured: Math.log10(n.halfLifeS),
            predicted: Math.log10(pred.halfLifeS),
            measuredLabel: formatHalfLife(n.halfLifeS),
            predictedLabel: formatHalfLife(pred.halfLifeS),
          }
        }),
    [plotted, r0]
  )

  const ratio = gamow.halfLifeS / nuclide.halfLifeS
  const onTipMove = useCallback((next: { x: number; z: number }) => {
    setTipX(next.x)
    setTipZ(next.z)
  }, [])
  const kappa = stmKappa(phi)
  const current = stmCurrentNa(tipX, tipZ, phi)
  const currentUp = stmCurrentNa(tipX, tipZ + 1, phi)
  const gap = Math.max(0, tipZ - surfaceHeight(tipX))

  const nuclideOptions = NUCLIDES.map((n) => ({ value: n.id, label: n.id }))

  const controls = (
    <>
      <Segmented label="Nucleus" value={nuclide.id} options={nuclideOptions} onChange={pickNuclide} />
      <p className="-mt-3 text-[11px] leading-relaxed text-ink-muted">
        {nuclide.element}-{nuclide.A} → {nuclide.A - 4} daughter, Z = {nuclide.Z - 2}. Measured
        half-life {nuclide.halfLifeLabel}; real Q = {nuclide.q.toFixed(3)} MeV.
      </p>

      <Slider
        label="Alpha energy Q"
        value={q}
        min={Q_MIN}
        max={Q_MAX}
        step={0.05}
        onChange={(v) => setQOverride(Math.round(v * 100) / 100)}
        format={(v) => `${v.toFixed(2)} MeV${qIsReal ? ' · real' : ' · what-if'}`}
        hint="Slide away from the real value to see how violently the half-life responds. Picking a nucleus resets it."
      />

      <Slider
        label="Radius parameter r₀"
        value={r0}
        min={1}
        max={1.5}
        step={0.01}
        onChange={setR0}
        format={(v) => `${v.toFixed(2)} fm · R = ${gamow.R.toFixed(2)} fm`}
        hint="R = r₀(A_d^⅓ + 4^⅓). The model's one fitted number; 1.1 fm is the default."
      />

      <ButtonRow>
        <button type="button" className="btn-primary focus-ring" onClick={addToPlot}>
          Add to plot
        </button>
        <button type="button" className="btn-ghost focus-ring" onClick={plotAll}>
          Plot all nine
        </button>
        <button type="button" className="btn-ghost focus-ring" onClick={clearPlot}>
          Clear plot
        </button>
        {!qIsReal ? (
          <button type="button" className="btn-ghost focus-ring" onClick={() => setQOverride(null)}>
            Reset Q
          </button>
        ) : null}
      </ButtonRow>

      <div className="grid grid-cols-2 gap-2">
        <Stat label="Turning point b" value={`${gamow.b.toFixed(1)} fm`} accent="rose" />
        <Stat label="Barrier at R" value={`${gamow.barrierTop.toFixed(1)} MeV`} accent="amber" />
        <Stat label="Gamow exponent G" value={gamow.G.toFixed(1)} accent="violet" />
        <Stat label="T = e^−G" value={sci(gamow.transmission)} accent="violet" />
        <Stat label="Assaults / s" value={sci(gamow.frequency)} accent="sky" />
        <Stat label="λ = f·T" value={`${sci(gamow.decayConstant)} /s`} accent="sky" />
        <Stat label="Predicted t½" value={formatHalfLife(gamow.halfLifeS)} accent="teal" />
        <Stat
          label="Measured t½"
          value={qIsReal ? formatHalfLife(nuclide.halfLifeS) : 'n/a (what-if Q)'}
          accent="teal"
        />
      </div>

      {qIsReal ? (
        <p className="text-[11px] leading-relaxed text-ink-muted">
          Predicted ÷ measured = {ratio >= 1 ? ratio.toFixed(1) : ratio.toFixed(2)}. The model is
          expected to land within a factor of ten; anything closer is partly luck in r₀.
        </p>
      ) : (
        <p className="text-[11px] leading-relaxed text-ink-muted">
          A hypothetical Q. No nucleus has this value, so there is no measured half-life to
          compare against — the point is to watch T and t½ move.
        </p>
      )}
    </>
  )

  return (
    <VizFrame
      title="Alpha Decay: Tunneling with a Half-life"
      tagline="An alpha particle rattles against a wall it cannot climb ten billion billion times a second. Once in 10³⁹ tries it is simply on the other side — and that one number is uranium's four-billion-year half-life."
      level="Intermediate"
      canvas={
        <div className="p-2">
          <AlphaDecayLab
            Zd={gamow.Zd}
            R={gamow.R}
            b={gamow.b}
            q={q}
            wellDepth={DEFAULT_WELL_DEPTH}
            model={model}
            nuclideLabel={nuclide.id}
          />
          <p className="px-3 pb-2 pt-1 text-[11px] leading-relaxed text-ink-muted">
            Amber is the potential the alpha sees: a well {DEFAULT_WELL_DEPTH} MeV deep out to the
            nuclear radius R, then the daughter&rsquo;s Coulomb repulsion falling as 1/r. The dashed
            sky line is Q; it meets the barrier again at b. Violet is the wavefunction, drawn about
            the Q line: oscillating inside, dying through the barrier, small and oscillating again
            beyond b. It is the exact stationary solution of the same Schrödinger engine as the
            tunneling and bound-state pages — for a barrier of this shape with its exponent divided
            by {DISPLAY_G_SCALE}. At full strength the outside amplitude would be e^−G/2 ≈{' '}
            {sci(Math.exp(-gamow.G / 2))} of the inside, which is not a line a screen can draw.
          </p>
        </div>
      }
      controls={controls}
    >
      <div className="card mb-6 p-6">
        <h2 className="section-label mb-1">The Geiger–Nuttall line</h2>
        <p className="mb-4 text-[13px] text-ink-secondary">
          Add nuclides with the button in the controls. Each one drops two markers at the same
          horizontal position: the measured half-life (filled) and what the Gamow model predicts
          (hollow). From the second point on, a least-squares line is drawn through the measured
          ones.
        </p>
        <GeigerNuttallPlot points={points} activeId={nuclide.id} />
        {points.length > 0 ? (
          <div className="-mx-2 mt-4 overflow-x-auto px-2">
            <table className="w-full min-w-[560px] border-collapse text-left text-sm">
              <caption className="sr-only">
                Each plotted nuclide with its Q value, Geiger–Nuttall abscissa, measured half-life
                and the Gamow prediction.
              </caption>
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-wider text-ink-muted">
                  <th scope="col" className="py-2 pr-3 font-bold">Nuclide</th>
                  <th scope="col" className="py-2 pr-3 text-right font-bold">Q (MeV)</th>
                  <th scope="col" className="py-2 pr-3 text-right font-bold">Z_d/√Q</th>
                  <th scope="col" className="py-2 pr-3 text-right font-bold">G</th>
                  <th scope="col" className="py-2 pr-3 text-right font-bold">Measured t½</th>
                  <th scope="col" className="py-2 pr-3 text-right font-bold">Predicted t½</th>
                  <th scope="col" className="py-2 text-right font-bold">Pred ÷ meas</th>
                </tr>
              </thead>
              <tbody className="font-mono text-[13px]">
                {points.map((p) => {
                  const n = nuclideById(p.id)!
                  const pred = predictDecay({ Z: n.Z, A: n.A, q: n.q, r0 })
                  const rr = pred.halfLifeS / n.halfLifeS
                  return (
                    <tr key={p.id} className={`border-b border-line ${p.id === nuclide.id ? 'bg-surface-2' : ''}`}>
                      <th scope="row" className="py-2 pr-3 text-left font-sans font-semibold text-ink">
                        {p.id}
                      </th>
                      <td className="py-2 pr-3 text-right text-ink-secondary">{n.q.toFixed(3)}</td>
                      <td className="py-2 pr-3 text-right text-ink-secondary">{p.x.toFixed(2)}</td>
                      <td className="py-2 pr-3 text-right text-q-violet-text">{pred.G.toFixed(1)}</td>
                      <td className="py-2 pr-3 text-right text-q-teal-text">{p.measuredLabel}</td>
                      <td className="py-2 pr-3 text-right text-q-amber-text">{p.predictedLabel}</td>
                      <td className="py-2 text-right text-ink">{rr >= 1 ? rr.toFixed(1) : rr.toFixed(2)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      <div className="card mb-6 p-6">
        <h2 className="section-label mb-1">The same exponential, at the other end of the scale</h2>
        <p className="mb-4 text-[13px] text-ink-secondary">
          A scanning tunnelling microscope is a metal tip held a few ångström above a surface. No
          electron has the energy to cross the vacuum gap — the work function φ is the wall — so
          the current is pure tunnelling, I ∝ e^−2κd. Drag the tip, or use the sliders, and watch
          the meter: it is logarithmic, and it has to be.
        </p>
        <StmLab x={tipX} z={tipZ} workFunctionEv={phi} onMove={onTipMove} />
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Slider
            label="Tip height z"
            value={tipZ}
            min={0.5}
            max={10}
            step={0.1}
            onChange={setTipZ}
            format={(v) => `${v.toFixed(1)} Å`}
            hint="Above the mean surface plane. One ångström is about one atomic radius."
          />
          <Slider
            label="Tip position x"
            value={tipX}
            min={0}
            max={20}
            step={0.1}
            onChange={setTipX}
            format={(v) => `${v.toFixed(1)} Å`}
            hint="Atoms sit every 2.5 Å; the surface is 0.3 Å taller over each one."
          />
          <Slider
            label="Work function φ"
            value={phi}
            min={2}
            max={6}
            step={0.05}
            onChange={setPhi}
            format={(v) => `${v.toFixed(2)} eV`}
            hint="4–5 eV for most metals. Sets κ = √(2mₑφ)/ħ."
          />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="κ" value={`${kappa.toFixed(3)} Å⁻¹`} accent="violet" />
          <Stat label="Gap d" value={`${gap.toFixed(2)} Å`} accent="rose" />
          <Stat label="Current" value={formatCurrent(current)} accent="teal" />
          <Stat label="Per ångström" value={`×${stmCurrentRatio(1, phi).toFixed(1)}`} accent="amber" />
        </div>
        <p className="mt-3 text-[13px] leading-relaxed text-ink-secondary">
          Raise the tip by exactly 1 Å from where it is now and the current falls from{' '}
          <strong className="text-ink">{formatCurrent(current)}</strong> to{' '}
          <strong className="text-ink">{formatCurrent(currentUp)}</strong> — a factor of e^2κ ≈{' '}
          {stmCurrentRatio(1, phi).toFixed(1)}. That is the whole trick of the instrument: a feedback
          loop holds the current constant, so the tip height traces the surface to a hundredth of an
          ångström, and the atoms appear as bumps in the scan strip at the bottom of the picture.
        </p>
      </div>

      <Explainer title="What you are looking at">
        <p>
          George Gamow&rsquo;s 1928 picture, which is still the picture. Inside the nucleus an alpha
          particle — two protons, two neutrons, already assembled — moves in a well about 35 MeV
          deep. At the surface the strong force lets go and the only thing left is electrostatics:
          the daughter&rsquo;s {gamow.Zd} protons pushing on the alpha&rsquo;s two, a barrier that
          is {gamow.barrierTop.toFixed(0)} MeV high at the surface and falls as 1/r.
        </p>
        <p>
          The alpha comes out with {q.toFixed(2)} MeV. That is far below the top of the barrier, so
          classically it is trapped forever. Quantum mechanically the wavefunction does not stop at
          the wall; it decays through it, and by the time the barrier has fallen back to Q — at b ={' '}
          {gamow.b.toFixed(0)} fm, several nuclear radii out — a little of it is left. Everything past
          b is a free alpha leaving.
        </p>
      </Explainer>

      <Explainer title="Three numbers make a half-life">
        <p>
          <strong className="text-ink">The exponent.</strong> Transmission through a slowly varying
          barrier is T = e^−G with G = (2/ħ)∫√(2μ(V − Q)) dr from R to b — the WKB integral, the
          same one the tunneling page uses for its rectangular wall, except that for a 1/r barrier
          it can be done in closed form. For {nuclide.id} at this Q it is G = {gamow.G.toFixed(1)},
          so T = {sci(gamow.transmission)}.
        </p>
        <p>
          <strong className="text-ink">The attempt rate.</strong> Inside the well the alpha has
          Q + 35 MeV of kinetic energy and crosses a nucleus {(2 * gamow.R).toFixed(0)} fm across in
          about 10⁻²¹ s, so it hits the wall f ≈ {sci(gamow.frequency)} times a second.
        </p>
        <p>
          <strong className="text-ink">The product.</strong> λ = f·T is the chance per second of
          escape, and t½ = ln 2/λ = {formatHalfLife(gamow.halfLifeS)}. Nothing in the chain is
          adjusted to hit the answer; the only free number is r₀, and it is the same for every
          nucleus on the page.
        </p>
      </Explainer>

      <Explainer title="Why the plot is a straight line">
        <p>
          In 1911 Hans Geiger and John Nuttall noticed that plotting the logarithm of the decay rate
          against the alpha&rsquo;s range in air gave a straight line — and had no idea why. Gamow&rsquo;s
          integral is the why. Because b ∝ Z/Q, the exponent is very nearly G ∝ Z/√Q with a
          correction from the nuclear radius, so log t½ against Z/√Q is close to linear with a slope
          the model predicts.
        </p>
        <p>
          Plot all nine and look at the spread: 14 billion years at the top, 300 nanoseconds at the
          bottom — 24 orders of magnitude — from Q values that differ by barely a factor of two.
          Then drag the Q slider on any nucleus and watch T fly. Half a percent more energy takes
          a third off radium&rsquo;s 1,600 years.
        </p>
        <p>
          The hollow markers are the model. They sit close to the filled ones and they sit on a
          line of the same slope, which is the real test: the model does not merely fit, it
          explains the form of the law.
        </p>
      </Explainer>

      <Explainer title="Where it misses, and why that is interesting">
        <p>
          Select Po-210. The model predicts a half-life about six times shorter than the measured
          138 days — the worst miss on the page, and it is not a numerical accident. Polonium-210
          has 126 neutrons, a closed shell, and an alpha particle is much less likely to be
          preformed inside a nucleus that has just filled one. The real decay rate is the Gamow
          rate times a &ldquo;preformation factor&rdquo; that the simple model sets to 1; near shell
          closures it can be 1/30.
        </p>
        <p>
          The other misses are the radius. Slide r₀ and every prediction moves together: one
          femtometre on R is nearly two orders of magnitude on t½, because R sits at the steepest
          part of the integral. That is why nuclear physicists quote alpha-decay
          half-lives as a way of <em>measuring</em> nuclear radii, rather than the other way round.
        </p>
      </Explainer>

      <Explainer title="What is and isn't real here">
        <p>
          The Q values and half-lives are the measured ones (AME2020 and Nubase 2020). The barrier
          on the canvas is drawn in real MeV and femtometres from the daughter&rsquo;s charge. G, T,
          f and the predicted half-lives are the Gamow model with no extra factors, and
          <code className="mx-1 rounded bg-surface-3 px-1 py-0.5 text-[12px]">
            lib/quantum/alphaDecay.test.ts
          </code>
          holds them against the measured values (within 10×, order preserved), holds the WKB
          integral against the exact rectangular-barrier result, and holds the STM decay constant
          against κ worked out by hand from the electron mass.
        </p>
        <p>
          The wavefunction is the one honest simplification: it is the true solution of the
          Schrödinger equation for a barrier of this shape, but with the exponent divided by{' '}
          {DISPLAY_G_SCALE}. A real alpha wavefunction is 10⁻¹⁹ of its interior size once it gets
          out, and a curve like that would draw as a flat line. The well depth of 35 MeV is a
          typical value, not a measurement; it only enters the assault frequency, where a factor of
          two is invisible next to an exponent of 90.
        </p>
      </Explainer>
    </VizFrame>
  )
}
