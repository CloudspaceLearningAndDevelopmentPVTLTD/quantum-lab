'use client'

import { useCallback, useMemo, useState } from 'react'
import LaserLab, { type CartoonSample } from '@/components/viz/LaserLab'
import LaserCharts, { PUMP_MAX } from '@/components/viz/LaserCharts'
import { VizFrame, Explainer } from '@/components/ui/VizFrame'
import { Segmented, ButtonRow, Slider, Stat } from '@/components/ui/Controls'
import {
  GAIN_MEDIA,
  absorbedPumpPowerW,
  einsteinBFromA,
  emissionCrossSectionM2,
  frequencyHz,
  inversionPumpRate,
  lasingThresholdPumpRate,
  mediumById,
  outputPowerW,
  paramsForMedium,
  thermalOccupation,
  threeLevelSteadyState,
  thresholdInversion,
  twoLevelSteadyState,
} from '@/lib/quantum/laser'
import type { Scheme } from '@/lib/viz/laserCartoon'

/**
 * /visualizations/lasers — how a laser works.
 *
 * Two things on this page, sharing one pump slider:
 *
 *   - the cartoon (LaserLab): a few dozen atoms in a cavity, every event a
 *     coin toss at the stated rate, so the reader can watch a photon clone
 *     itself and watch the clones die below inversion;
 *   - the numbers (LaserCharts and the stats): the exact steady state of the
 *     three-level rate equations for a real medium, with the stimulated rate
 *     derived from the Einstein B coefficient, which is derived from A.
 *
 * The pump slider is in units of A₂₁ on both, so "just past 1" means the
 * same thing in the cartoon as in the ruby numbers: atoms are being lifted
 * faster than they fall.
 */

type MediumId = 'ruby' | 'erbium'

const sup = (e: number): string =>
  String(e)
    .split('')
    .map((ch) => (ch === '-' ? '⁻' : '⁰¹²³⁴⁵⁶⁷⁸⁹'[Number(ch)]))
    .join('')

/** 2.7 × 10¹³, or a plain number below 1,000. */
function sci(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return '—'
  if (n === 0) return '0'
  if (Math.abs(n) < 1000 && Math.abs(n) >= 0.01) return n.toFixed(n < 10 ? 2 : 0)
  const e = Math.floor(Math.log10(Math.abs(n)))
  const m = n / 10 ** e
  return `${m.toFixed(digits)} × 10${sup(e)}`
}

function power(w: number): string {
  if (!Number.isFinite(w)) return '—'
  if (w < 1e-6) return `${(w * 1e9).toFixed(1)} nW`
  if (w < 1e-3) return `${(w * 1e6).toFixed(1)} µW`
  if (w < 1) return `${(w * 1e3).toFixed(1)} mW`
  if (w < 1e3) return `${w.toFixed(0)} W`
  return `${(w / 1e3).toFixed(2)} kW`
}

function ns(s: number): string {
  const v = s * 1e9
  return v < 1 ? `${v.toFixed(2)} ns` : v < 10 ? `${v.toFixed(1)} ns` : `${v.toFixed(0)} ns`
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`

export default function LasersPage() {
  const [mediumId, setMediumId] = useState<MediumId>('ruby')
  const [scheme, setScheme] = useState<Scheme>('three')
  const [pumpRatio, setPumpRatio] = useState(0.5)
  /** log₁₀ of the cavity photon lifetime in nanoseconds. */
  const [logTauNs, setLogTauNs] = useState(1)
  const [running, setRunning] = useState(true)
  const [resetKey, setResetKey] = useState(0)
  const [sample, setSample] = useState<CartoonSample | null>(null)

  const onSample = useCallback((s: CartoonSample) => setSample(s), [])

  const medium = mediumById(mediumId)
  const tauC = 10 ** logTauNs * 1e-9
  const params = useMemo(() => paramsForMedium(medium, tauC), [medium, tauC])
  const A = params.A21
  const W = pumpRatio * A
  const nu = frequencyHz(medium.wavelengthM)
  const pumpNu = frequencyHz(medium.pumpWavelengthM)

  const Wi = inversionPumpRate(params)
  const Wth = lasingThresholdPumpRate(params)
  const D = thresholdInversion(params)
  const B21 = einsteinBFromA(A, nu)
  const sigma = emissionCrossSectionM2(A, medium.wavelengthM, medium.linewidthHz)

  const state = useMemo(() => {
    if (scheme === 'three') return threeLevelSteadyState(params, W)
    const s = twoLevelSteadyState({ A21: params.A21, K: params.K, tauC: params.tauC, N: params.N }, W)
    return { ...s, N3: 0 }
  }, [params, W, scheme])

  const inversion = state.N2 - state.N1
  const pOut = outputPowerW(state.n, nu, tauC)
  const pPump = absorbedPumpPowerW(W, state.N1, state.N3, pumpNu)
  const thState = Number.isFinite(Wth) ? threeLevelSteadyState(params, Wth) : null
  const pPumpTh = thState ? absorbedPumpPowerW(Wth, thState.N1, thState.N3, pumpNu) : Infinity
  const above = scheme === 'three' && Number.isFinite(Wth) && W >= Wth

  const controls = (
    <>
      <Segmented<MediumId>
        label="Gain medium"
        value={mediumId}
        options={GAIN_MEDIA.map((m) => ({ value: m.id as MediumId, label: m.id === 'ruby' ? 'Ruby' : 'Er:glass' }))}
        onChange={setMediumId}
      />
      <Segmented<Scheme>
        label="Level scheme"
        value={scheme}
        options={[
          { value: 'three', label: 'Three-level' },
          { value: 'two', label: 'Two-level' },
        ]}
        onChange={(v) => setScheme(v)}
      />
      <Slider
        label="Pump rate"
        value={pumpRatio}
        min={0}
        max={PUMP_MAX}
        step={0.05}
        onChange={setPumpRatio}
        format={(v) => `${v.toFixed(2)} × A₂₁`}
        hint={`How fast each ground atom is lifted, in units of the spontaneous decay rate A₂₁ = ${A.toFixed(0)} s⁻¹. Inversion needs more than 1.`}
      />
      <Slider
        label="Cavity photon lifetime"
        value={logTauNs}
        min={-1}
        max={2}
        step={0.05}
        onChange={setLogTauNs}
        format={() => ns(tauC)}
        hint="How long a photon survives between the mirrors before it is lost. Shorter means a lossier cavity and a higher threshold inversion."
      />
      <ButtonRow>
        <button type="button" className="btn-primary focus-ring" onClick={() => setRunning((r) => !r)}>
          {running ? 'Pause cartoon' : 'Run cartoon'}
        </button>
        <button type="button" className="btn-ghost focus-ring" onClick={() => setResetKey((k) => k + 1)}>
          Reset cartoon
        </button>
      </ButtonRow>
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Upper level N₂ / N" value={pct(state.N2 / params.N)} accent="rose" />
        <Stat
          label="Inversion ΔN / ΔN_th"
          value={scheme === 'three' ? (inversion / D).toFixed(inversion / D > 0.9 ? 4 : 2) : inversion < 0 ? 'negative' : '0'}
          accent="teal"
        />
        <Stat label="Photons in mode" value={sci(state.n)} accent="amber" />
        <Stat label="Output power" value={power(pOut)} accent="sky" />
      </div>
      <p className="text-[11px] leading-relaxed text-ink-muted">
        {scheme === 'three'
          ? above
            ? 'Above threshold. The inversion is pinned at ΔN_th and every extra pump photon becomes, on average, one more photon in the mode.'
            : Number.isFinite(Wth)
              ? `Below threshold. Lasing starts at ${(Wth / A).toFixed(3)} × A₂₁ for this cavity; the mode holds only spontaneous light.`
              : `This cavity is too lossy: it would need ΔN_th = ${sci(D)} atoms inverted and the medium only has ${sci(params.N)}.`
          : 'Two-level medium. Pump light lifts atoms and knocks them back down with the same coefficient, so N₂ never passes N₁.'}
      </p>
    </>
  )

  return (
    <VizFrame
      title="How a Laser Works"
      tagline="Pump atoms into an excited state faster than they fall, put a mirror at each end, and one stray photon becomes a beam of identical copies. Take one level away and it can never happen."
      level="Intermediate"
      canvas={
        <div className="p-2">
          <LaserLab
            scheme={scheme}
            pumpRatio={pumpRatio}
            running={running}
            resetKey={resetKey}
            onSample={onSample}
          />
          <p className="px-3 pb-3 pt-1 text-[11px] leading-relaxed text-ink-muted">
            The cartoon: 42 atoms between a full mirror and a 20% output mirror. Hollow atoms are in
            the ground level, rose ones in the upper laser level, amber ones in the pump band. Rose
            dots are spontaneous photons leaving in whatever direction they chose; rose wave-trains
            are photons in the cavity mode, and a new one appears beside an existing one each time an
            excited atom is stimulated. Every event is a coin toss at the rate the sliders set.
          </p>
          <LaserCharts params={params} scheme={scheme} pumpRatio={pumpRatio} className="px-1 pb-2" />
          <p className="px-3 pb-2 pt-1 text-[11px] leading-relaxed text-ink-muted">
            The charts: the exact steady state of the rate equations for {medium.name.toLowerCase()} in
            a cavity with the photon lifetime you set — {sci(params.N)} ions, not 42. The amber line
            is the current pump. The dashed rose curve is what the upper level would do with no
            mirrors; the solid one is what it does once the mode fills and clamps it.
          </p>
        </div>
      }
      controls={controls}
    >
      <div className="card mb-6 p-6">
        <h2 className="section-label mb-3">This cavity, in numbers</h2>
        <div className="-mx-2 overflow-x-auto px-2">
          <table className="w-full min-w-[560px] border-collapse text-left text-sm">
            <caption className="sr-only">
              Derived quantities for the chosen medium and cavity: Einstein coefficients, threshold
              inversion, threshold pump rate and the powers involved.
            </caption>
            <thead>
              <tr className="border-b border-line text-[11px] uppercase tracking-wider text-ink-muted">
                <th scope="col" className="py-2 pr-3 font-bold">Quantity</th>
                <th scope="col" className="py-2 pr-3 text-right font-bold">Value</th>
                <th scope="col" className="py-2 font-bold">Where it comes from</th>
              </tr>
            </thead>
            <tbody className="font-mono text-[13px]">
              <Row k="A₂₁" v={`${A.toFixed(0)} s⁻¹`} from={`1 / τ₂, with τ₂ = ${(medium.upperLifetimeS * 1e3).toFixed(0)} ms`} />
              <Row k="B₂₁ = B₁₂" v={`${sci(B21)} m³ J⁻¹ s⁻²`} from="A₂₁ · c³ / (8πhν³)" />
              <Row k="σ (emission)" v={`${sci(sigma)} m²`} from="B · hν / (c Δν), the same as λ²A / (8πΔν)" />
              <Row k="K per photon" v={`${sci(params.K)} s⁻¹`} from="σc / V — stimulated rate per atom per cavity photon" />
              <Row k="ΔN_th" v={`${sci(D)} atoms (${pct(D / params.N)} of N)`} from="1 / (K τ_c): gain equals loss" />
              <Row k="Inversion pump" v={`${(Wi / A).toFixed(4)} × A₂₁`} from="effective pump rate R = A₂₁ — atoms lifted as fast as they fall" />
              <Row
                k="Lasing threshold"
                v={Number.isFinite(Wth) ? `${(Wth / A).toFixed(4)} × A₂₁` : 'unreachable'}
                from="R_th = A(N + ΔN_th) / (N − ΔN_th), fast pump band"
              />
              <Row k="Pump power at threshold" v={power(pPumpTh)} from="W · N₁ · hν_pump, absorbed" />
              <Row k="Pump power now" v={power(pPump)} from="same, at the current pump rate" />
              <Row k="Output now" v={power(pOut)} from="n · hν / τ_c, if every loss is the output mirror" />
              <Row k="Thermal n̄ at 300 K" v={sci(thermalOccupation(nu, 300), 1)} from="1 / (e^{hν/kT} − 1): stimulated ÷ spontaneous in sunlight-ish light" />
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[13px] text-ink-secondary">{medium.note}</p>
        {sample ? (
          <p className="mt-2 text-[13px] text-ink-secondary">
            Cartoon right now: {sample.photons} photons in the mode, {sample.n1} ground / {sample.n2} upper
            {scheme === 'three' ? ` / ${sample.n3} pump band` : ''}; {sample.counts.stimulated} cloned,{' '}
            {sample.counts.absorbed} absorbed, {sample.counts.output} out through the mirror,{' '}
            {sample.counts.seeded} of {sample.counts.spontaneous} spontaneous photons happened to point down the axis
            {sample.counts.overflow > 0 ? `, ${sample.counts.overflow} clones not drawn (500-photon budget)` : ''}.
          </p>
        ) : null}
      </div>

      <Explainer title="Run these, in this order">
        <p>
          <strong className="text-ink">Pump up to 0.9.</strong> Atoms turn rose and fall back, spitting
          dots in every direction. Now and then one leaves along the axis and starts bouncing. Watch
          it: it passes more hollow atoms than rose ones, and a hollow atom absorbs it with the same
          probability a rose one would clone it. It dies within a few trips. The photon panel on the
          right is flat.
        </p>
        <p>
          <strong className="text-ink">Cross 1.0.</strong> Now more atoms are up than down. The next
          axial photon leaves a copy behind, the copy leaves copies, and in a second or two the strip
          chart takes off. The wave-trains all have the same phase — the clone inherits it — which is
          what makes the output a beam rather than a glow.
        </p>
        <p>
          <strong className="text-ink">Push to 3.</strong> The upper population in the chart stops
          climbing the moment threshold is passed, while the photon number keeps rising in a straight
          line. In the cartoon, count rose against hollow: the lead stays at a couple of atoms no
          matter how hard you pump, because every extra excitation is stripped by the light it helps
          create.
        </p>
        <p>
          <strong className="text-ink">Switch to two-level and pump to 4.</strong> Nothing. The amber
          dots going up and down are pump photons knocking excited atoms back to the ground — the
          same coefficient that lifts them. The best the pump can do is a dead heat.
        </p>
      </Explainer>

      <Explainer title="What just happened">
        <p>
          A photon passing an atom in the upper level can stimulate it to emit a second photon into
          the same mode: same direction, same frequency, same phase. A photon passing an atom in the
          lower level can be absorbed. Einstein showed in 1917 that the coefficients for those two
          processes are equal (B₁₂ = B₂₁ for non-degenerate levels), so the net gain per pass is
          proportional to N₂ − N₁. Unless more atoms are up than down, light is absorbed on
          average — which is the normal state of every material you have ever seen.
        </p>
        <p>
          Population inversion is that abnormal state. Making it needs atoms lifted faster than they
          decay, and a place to park them that the pump cannot empty. Then a cavity turns gain into
          a threshold: light builds up when gain per round trip beats the mirror loss, and the
          inversion needed for that is ΔN_th = 1/(Kτ_c). Above threshold the light itself pins the
          inversion at exactly that value — this is gain clamping — and every further pump photon
          becomes an output photon. That is why the photon panel is a straight line: its slope is
          fixed by the cavity, not by the medium.
        </p>
      </Explainer>

      <Explainer title="Einstein's three coefficients">
        <p>
          A₂₁ is the spontaneous rate: an excited atom alone in the dark decays at A₂₁ per second, in
          a random direction with a random phase. B₁₂ρ and B₂₁ρ are the absorption and stimulated
          emission rates in light of spectral energy density ρ. Einstein got the two relations between
          them by demanding that atoms in a thermal cavity settle into the Boltzmann populations
          while the light settles onto Planck&rsquo;s curve. That only works if g₁B₁₂ = g₂B₂₁ and
          A₂₁/B₂₁ = 8πhν³/c³ — the coefficients are not independent, and this page never types B in:
          it takes A from the lifetime and derives B from it.
        </p>
        <p>
          The ν³ tells you why the first lasers were optical rather than X-ray and why masers came
          first: at fixed B, spontaneous emission grows as the cube of the frequency, and spontaneous
          emission is loss — it goes everywhere except into the mode. The table&rsquo;s last row is
          the stimulated-to-spontaneous ratio for this transition in a 300 K thermal field: around
          10⁻³⁰. Nothing in nature has enough photons in one mode for stimulated emission to matter.
          A cavity is how you build that number up by hand.
        </p>
      </Explainer>

      <Explainer title="Why two levels cannot lase">
        <p>
          Pump a two-level atom optically and you are driving the same transition you hope to get
          gain on. Absorption lifts atoms at rate W per ground atom; stimulated emission by the same
          pump light drops them at rate W per excited atom. In steady state W(N₁ − N₂) = A₂₁N₂, so
          N₂/N = W/(2W + A₂₁): it approaches one half and never reaches it. At best the medium goes
          transparent to its own pump. There is no inversion and the photon panel stays flat.
        </p>
        <p>
          The fix is a third level: pump into a band that decays quickly and irreversibly to the
          upper laser level, faster than the pump can drive it back. The upper level then fills
          without the pump being able to empty it. Ruby&rsquo;s pump bands decay in nanoseconds into a
          level that lives for three milliseconds — that ratio is the whole design.
        </p>
      </Explainer>

      <Explainer title="The three-level tax">
        <p>
          In ruby the lower laser level is the ground state, so inversion means more than half of all
          the chromium ions are excited at once. The threshold in the table is a hair above the
          inversion pump rate whatever you do to the mirrors: the cavity asks for ΔN_th of a few
          10¹⁶, the medium has 10¹⁹, and lifting the first 8 × 10¹⁸ is the real cost. For the
          cubic centimetre of ruby modelled here that is close to a kilowatt absorbed, continuously. Maiman
          did it in 1960 with a flashlamp pulse; making ruby run continuously took a water-cooled arc
          lamp and was rarely worth it.
        </p>
        <p>
          A four-level laser (Nd:YAG, helium-neon, most diode lasers) puts the lower laser level
          above the ground state, so it is empty until the laser fills it: inversion starts with the
          first excited atom and the threshold is set by ΔN_th alone. Shorten the cavity lifetime on
          this page and watch the three-level threshold barely move until the cavity is so lossy that
          ΔN_th passes N — at which point it vanishes altogether.
        </p>
      </Explainer>

      <Explainer title="What is and isn't real here">
        <p>
          The rate equations are the standard single-mode laser rate equations, solved exactly for
          their steady state with the stimulated rate per photon K = σc/V derived from the Einstein B
          coefficient. They are tested in
          <code className="mx-1 rounded bg-surface-3 px-1 py-0.5 text-[12px]">lib/quantum/laser.test.ts</code>
          against Einstein&rsquo;s detailed-balance argument with a Planck field, the textbook
          cross-section formula, the analytic three-level threshold, the analytic slope above it, and
          a direct integration of the differential equations. The two-level result is checked the
          same way.
        </p>
        <p>
          Simplified: one cavity mode at line centre, a top-hat lineshape of width Δν, no refractive
          index, no non-radiative decay from the upper level, and every cavity loss counted as
          output. The ruby cross-section that comes out is about eight times the measured
          2.5 × 10⁻²⁴ m² (a real Lorentzian line and a refractive index of 1.76 account for most of
          the gap), which shifts ΔN_th by the same factor and changes nothing qualitative. Erbium in glass is
          quasi-three-level in reality (its lower level is a thermally spread manifold) and is
          treated here as the ideal case.
        </p>
        <p>
          The cartoon is the same physics with 42 atoms and probabilities chosen to be watchable —
          absorption and stimulated emission share one probability per pass, spontaneous photons
          are emitted isotropically, and the mode only ever holds photons that got there by those two
          routes. Its threshold is roughly two atoms of inversion and it clamps there; the chart&rsquo;s
          is 10¹⁶. It is not drawn from the chart, and the numbers it prints are its own.
        </p>
      </Explainer>
    </VizFrame>
  )
}

function Row({ k, v, from }: { k: string; v: string; from: string }) {
  return (
    <tr className="border-b border-line">
      <th scope="row" className="py-2 pr-3 text-left font-sans font-semibold text-ink">
        {k}
      </th>
      <td className="py-2 pr-3 text-right text-q-rose-text">{v}</td>
      <td className="py-2 font-sans text-[12px] text-ink-muted">{from}</td>
    </tr>
  )
}
