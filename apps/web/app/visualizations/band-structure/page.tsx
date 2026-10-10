'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import BandStructureLab from '@/components/viz/BandStructureLab'
import { VizFrame, Explainer } from '@/components/ui/VizFrame'
import { Segmented, ButtonRow, Slider, Stat, Toggle } from '@/components/ui/Controls'
import { prefersReducedMotion } from '@/components/viz/frameLoop'
import {
  ENERGY_UNIT_EV,
  LENGTH_UNIT_ANGSTROM,
  ROOM_TEMPERATURE_EV,
  SEMICONDUCTOR_MAX_GAP_EV,
  fillBands,
  findBands,
  freeElectronFolded,
  kronigPenneyCell,
  kronigPenneyFourierComponent,
} from '@/lib/quantum/bands'

/**
 * /visualizations/band-structure — Kronig–Penney into bands.
 *
 * The page owns the crystal (lattice spacing, barrier width and height, electrons per
 * cell) and the prose. Every number on it — band edges, gaps, the Fermi level, the regime
 * label — comes from lib/quantum/bands.ts, whose transfer-matrix discriminant is checked
 * in bands.test.ts against the free parabola, the printed Kronig–Penney condition,
 * first-order perturbation theory and tabulated Mathieu values. The canvas draws what the
 * table below it lists; it does not compute anything of its own.
 *
 * ħ = m = 1 everywhere. The eV figures assume one length unit is LENGTH_UNIT_ANGSTROM.
 */

const MAX_BANDS = 12
/** How long the "switch it on" ramp takes, in ms. */
const RAMP_MS = 1600
/** Under prefers-reduced-motion the ramp runs as this many discrete steps instead. */
const RAMP_STEPS_REDUCED = 5

type PresetId = 'free' | 'weak' | 'tight' | 'custom'

type Preset = { id: PresetId; label: string; period: number; fraction: number; height: number }

const PRESETS: Preset[] = [
  { id: 'free', label: 'Free electron', period: 2, fraction: 0.25, height: 0 },
  { id: 'weak', label: 'Nearly free', period: 2, fraction: 0.25, height: 1.5 },
  { id: 'tight', label: 'Tight binding', period: 2, fraction: 0.3, height: 30 },
]

const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(2) : v.toFixed(3))
const fmtEv = (v: number) => (v >= 10 ? `${v.toFixed(1)} eV` : v >= 0.1 ? `${v.toFixed(2)} eV` : `${(v * 1000).toFixed(0)} meV`)

const REGIME_LABEL = { metal: 'Metal', semiconductor: 'Semiconductor', insulator: 'Insulator' } as const
const REGIME_ACCENT = { metal: 'teal', semiconductor: 'amber', insulator: 'rose' } as const

export default function BandStructurePage() {
  const [period, setPeriod] = useState(2)
  const [fraction, setFraction] = useState(0.25)
  const [height, setHeight] = useState(1.5)
  const [electrons, setElectrons] = useState(2)
  const [showFree, setShowFree] = useState(true)

  // The potential the picture is drawn for. Equal to `height` except during the ramp,
  // when it sweeps from 0 up to it.
  const [displayHeight, setDisplayHeight] = useState(1.5)
  const [ramping, setRamping] = useState(false)
  const rampRef = useRef<{ raf: number | null; timer: ReturnType<typeof setTimeout> | null }>({
    raf: null,
    timer: null,
  })

  const cancelRamp = useCallback(() => {
    const r = rampRef.current
    if (r.raf !== null) cancelAnimationFrame(r.raf)
    if (r.timer !== null) clearTimeout(r.timer)
    r.raf = null
    r.timer = null
    setRamping(false)
  }, [])

  // Any manual change to the barrier ends a ramp and shows the slider's value.
  useEffect(() => {
    cancelRamp()
    setDisplayHeight(height)
  }, [height, period, fraction, cancelRamp])

  useEffect(() => cancelRamp, [cancelRamp])

  const startRamp = () => {
    cancelRamp()
    if (height <= 0) return
    setRamping(true)
    const target = height
    if (prefersReducedMotion()) {
      // Discrete steps, no continuous sweep: the picture changes RAMP_STEPS_REDUCED times.
      let step = 0
      const tick = () => {
        step++
        setDisplayHeight((target * step) / RAMP_STEPS_REDUCED)
        if (step < RAMP_STEPS_REDUCED) {
          rampRef.current.timer = setTimeout(tick, 400)
        } else {
          rampRef.current.timer = null
          setRamping(false)
        }
      }
      setDisplayHeight(0)
      rampRef.current.timer = setTimeout(tick, 400)
      return
    }
    const start = performance.now()
    setDisplayHeight(0)
    const frame = (now: number) => {
      const t = Math.min(1, (now - start) / RAMP_MS)
      // Ease-out: the gaps open fastest at the start, when they are first-order in V₀.
      const eased = 1 - (1 - t) * (1 - t)
      setDisplayHeight(target * eased)
      if (t < 1) {
        rampRef.current.raf = requestAnimationFrame(frame)
      } else {
        rampRef.current.raf = null
        setRamping(false)
      }
    }
    rampRef.current.raf = requestAnimationFrame(frame)
  }

  const barrierWidth = period * fraction

  // The energy window is set by the slider's target, not the ramping value, so the axis
  // stays put while the bands move inside it.
  const energyCeiling = useMemo(() => {
    const fourFreeBands = freeElectronFolded(period, 3, Math.PI / period)
    return Math.max(1.35 * height, fourFreeBands) * 1.04
  }, [period, height])
  const energyFloor = -0.04 * energyCeiling

  const structure = useMemo(
    () =>
      findBands(kronigPenneyCell(period, displayHeight, barrierWidth), {
        maxBands: MAX_BANDS,
        energyMax: energyCeiling,
      }),
    [period, displayHeight, barrierWidth, energyCeiling]
  )
  const { bands } = structure
  const filling = useMemo(() => fillBands(bands, electrons), [bands, electrons])

  const activePreset: PresetId =
    PRESETS.find((p) => p.period === period && p.fraction === fraction && p.height === height)?.id ??
    'custom'

  const applyPreset = (id: PresetId) => {
    const p = PRESETS.find((x) => x.id === id)
    if (!p) return
    setPeriod(p.period)
    setFraction(p.fraction)
    setHeight(p.height)
  }

  const presetOptions = [
    ...PRESETS.map((p) => ({ value: p.id, label: p.label })),
    ...(activePreset === 'custom' ? [{ value: 'custom' as PresetId, label: 'Custom' }] : []),
  ]

  // First-order prediction for the first gap, quoted beside the computed one.
  const firstGap = bands.length > 1 ? bands[1].bottom - bands[0].top : 0
  const firstGapPredicted = 2 * kronigPenneyFourierComponent(1, displayHeight, barrierWidth, period)
  const gapOverKT = filling.gapEv / ROOM_TEMPERATURE_EV

  const controls = (
    <>
      <Segmented<PresetId>
        label="Regimes"
        value={activePreset}
        options={presetOptions}
        onChange={applyPreset}
      />

      <Slider
        label="Lattice spacing a"
        value={period}
        min={1}
        max={4}
        step={0.05}
        format={(v) => `${v.toFixed(2)} · ${(v * LENGTH_UNIT_ANGSTROM).toFixed(1)} Å`}
        onChange={setPeriod}
        hint="Distance between atoms. Every zone-boundary energy scales as 1/a²."
      />

      <Slider
        label="Barrier width b / a"
        value={fraction}
        min={0.05}
        max={0.9}
        step={0.01}
        format={(v) => `${v.toFixed(2)} · b = ${(v * period).toFixed(2)}`}
        onChange={setFraction}
        hint="The fraction of each cell the electron has to tunnel through. At exactly ½ the second gap closes."
      />

      <Slider
        label="Barrier height V₀"
        value={height}
        min={0}
        max={40}
        step={0.1}
        format={(v) => `${v.toFixed(1)} · ${fmtEv(v * ENERGY_UNIT_EV)}`}
        onChange={setHeight}
        hint="0 is the free electron. Push it up and watch the bands flatten into atomic levels."
      />

      <ButtonRow>
        <button
          type="button"
          className="btn-primary focus-ring"
          onClick={ramping ? cancelRamp : startRamp}
          disabled={height <= 0}
          aria-describedby="band-ramp-hint"
        >
          {ramping ? 'Stop' : 'Switch the potential on from zero'}
        </button>
      </ButtonRow>
      <p id="band-ramp-hint" className="-mt-3 text-[11px] leading-relaxed text-ink-muted">
        Drops V₀ to zero and raises it back to {height.toFixed(1)} over about two seconds, so you can
        watch the parabola break into bands. With reduced motion on it steps up in five jumps
        instead. Needs V₀ above zero.
      </p>

      <Toggle
        label="Show the free-electron parabola"
        checked={showFree}
        onChange={setShowFree}
        hint="Dashed sky curve: E = q²/2 folded into the first zone, shifted by the mean potential."
      />

      <Slider
        label="Electrons per cell"
        value={electrons}
        min={1}
        max={8}
        step={1}
        format={(v) => `${v.toFixed(0)}`}
        onChange={setElectrons}
        hint="Each band holds two per cell, spin up and spin down. Odd counts leave a band half full."
      />

      <div className="grid grid-cols-2 gap-2">
        <Stat
          label="This solid is"
          value={filling.overflow ? 'need more bands' : REGIME_LABEL[filling.regime]}
          accent={filling.overflow ? 'violet' : REGIME_ACCENT[filling.regime]}
        />
        <Stat label="Fermi level" value={filling.overflow ? '—' : fmt(filling.fermiEnergy)} accent="amber" />
        <Stat
          label="Gap at E_F"
          value={filling.overflow ? '—' : filling.gap > 1e-9 ? `${fmt(filling.gap)} · ${fmtEv(filling.gapEv)}` : 'none'}
          accent={filling.gap > 1e-9 ? 'rose' : 'teal'}
        />
        <Stat
          label="Gap / k_BT (300 K)"
          value={filling.overflow || filling.gap <= 1e-9 ? '—' : gapOverKT >= 100 ? gapOverKT.toFixed(0) : gapOverKT.toFixed(1)}
          accent="sky"
        />
      </div>

      <p className="text-[11px] leading-relaxed text-ink-muted">
        eV figures take one length unit as {LENGTH_UNIT_ANGSTROM} Å, so one energy unit is{' '}
        {ENERGY_UNIT_EV.toFixed(2)} eV. Metal: a band is partly full, or the filled band touches the
        next. Semiconductor: full bands with a gap up to {SEMICONDUCTOR_MAX_GAP_EV} eV. Insulator:
        wider than that. The last two are a convention, not a phase transition.
      </p>
    </>
  )

  return (
    <VizFrame
      title="Band Structure"
      tagline="A free electron can have any energy. Put it in a row of identical atoms and whole ranges of energy become impossible — and whether the solid conducts depends only on where the electrons run out."
      level="Advanced"
      canvas={
        <div className="p-2">
          <BandStructureLab
            structure={structure}
            filling={filling}
            barrier={{ period, width: barrierWidth, height: displayHeight }}
            showFree={showFree}
            energyFloor={energyFloor}
            energyCeiling={energyCeiling}
          />
          <p className="px-3 pb-2 pt-1 text-[11px] leading-relaxed text-ink-muted">
            Left: energy against wavevector k across the first Brillouin zone, one curve per band —
            teal where the states are occupied, violet where they are empty. Rose shading is a gap:
            no state of any k has that energy. The dashed sky curve is the free-electron parabola
            folded into the zone, the shape every band collapses onto as V₀ goes to zero. Right: the
            same energies drawn across three cells of the actual potential (amber), so each band is a
            stripe of allowed energy over the barriers. The amber dashed line is the Fermi level.
          </p>
        </div>
      }
      controls={controls}
    >
      <div className="card mb-6 p-6">
        <h2 className="section-label mb-3">The bands, edge by edge</h2>
        <div className="-mx-2 overflow-x-auto px-2">
          <table className="w-full min-w-[560px] border-collapse text-left text-sm">
            <caption className="sr-only">
              Every band in the energy window: its bottom, top, width, occupancy, and the gap up to
              the next band, in natural units with ħ = m = 1.
            </caption>
            <thead>
              <tr className="border-b border-line text-[11px] uppercase tracking-wider text-ink-muted">
                <th scope="col" className="py-2 pr-3 font-bold">Band</th>
                <th scope="col" className="py-2 pr-3 text-right font-bold">Bottom</th>
                <th scope="col" className="py-2 pr-3 text-right font-bold">Top</th>
                <th scope="col" className="py-2 pr-3 text-right font-bold">Width</th>
                <th scope="col" className="py-2 pr-3 font-bold">Bottom sits at</th>
                <th scope="col" className="py-2 pr-3 font-bold">Occupancy</th>
                <th scope="col" className="py-2 text-right font-bold">Gap above</th>
              </tr>
            </thead>
            <tbody className="font-mono text-[13px]">
              {bands.map((band, i) => {
                const next = bands[i + 1]
                const gap = next ? next.bottom - band.top : null
                const occupancy =
                  band.index < filling.filledBands
                    ? 'full'
                    : band.index === filling.highestOccupied && filling.partiallyFilled
                      ? 'half'
                      : 'empty'
                return (
                  <tr key={band.index} className="border-b border-line">
                    <th scope="row" className="py-2 pr-3 text-left font-sans font-semibold text-ink">
                      {band.index + 1}
                    </th>
                    <td className="py-2 pr-3 text-right text-ink-secondary">{fmt(band.bottom)}</td>
                    <td className="py-2 pr-3 text-right text-ink-secondary">{fmt(band.top)}</td>
                    <td className="py-2 pr-3 text-right text-q-violet-text">{fmt(band.top - band.bottom)}</td>
                    <td className="py-2 pr-3 text-ink-muted">{band.index % 2 === 0 ? 'k = 0' : 'k = ±π/a'}</td>
                    <td className={`py-2 pr-3 ${occupancy === 'empty' ? 'text-ink-muted' : 'text-q-teal-text'}`}>
                      {occupancy}
                    </td>
                    <td className="py-2 text-right text-q-rose-text">
                      {gap === null ? '…' : gap > 1e-9 ? fmt(gap) : 'closed'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[13px] text-ink-secondary">
          {bands.length === MAX_BANDS
            ? `The lowest ${MAX_BANDS} bands are computed; the window shows the ones that fit. `
            : ''}
          First gap: {fmt(firstGap)}. First-order perturbation theory predicts 2|V₁| ={' '}
          {fmt(firstGapPredicted)} with V₁ = (V₀/π)·sin(πb/a)
          {displayHeight > 0 && firstGapPredicted > 0
            ? `, which is ${Math.abs(firstGap / firstGapPredicted - 1) < 0.05 ? 'within 5%' : `off by ${(100 * Math.abs(firstGap / firstGapPredicted - 1)).toFixed(0)}%`} — ${
                Math.abs(firstGap / firstGapPredicted - 1) < 0.05
                  ? 'the potential is weak enough for the parabola-plus-a-perturbation picture to hold.'
                  : 'the potential is too strong for first order; the bands are closer to atomic levels than to a bent parabola.'
              }`
            : '.'}
        </p>
      </div>

      <Explainer title="What to do">
        <p>
          <strong className="text-ink">Start with the free electron.</strong> Pick the first preset.
          The solid curve lies exactly on the dashed parabola, folded back into the zone at ±π/a
          the way a road map folds. Nothing is forbidden; the bands touch. The table says every
          gap is closed.
        </p>
        <p>
          <strong className="text-ink">Switch the potential on.</strong> Go to &ldquo;Nearly
          free&rdquo; and press the button. The moment V₀ leaves zero, the curve tears at the fold —
          at k = ±π/a first, then at k = 0 for the next band up. The rose gaps open in proportion
          to V₀ while V₀ is small: the table quotes the first-order prediction beside the computed
          number, and for the nearly-free preset they agree to a few percent.
        </p>
        <p>
          <strong className="text-ink">Set b/a to exactly 0.50.</strong> The second gap closes
          again while the first stays open. A rectangular barrier half a cell wide has no second
          Fourier component, and the n-th gap is set by the n-th Fourier component alone — this is
          the sharpest single check that the picture is perturbation theory and not decoration.
        </p>
        <p>
          <strong className="text-ink">Then push V₀ to 30.</strong> The bands stop being bent
          parabolas and flatten into thin lines at the energies of a particle trapped in one
          well. Those are the atomic levels; a band is what one becomes when the atom has
          neighbours to tunnel to. The gap prediction now fails, and the caption says so.
        </p>
        <p>
          <strong className="text-ink">Finally, count electrons.</strong> Back on &ldquo;Nearly
          free&rdquo;, slide the electron count from 1 to 4. Odd numbers make a metal every time:
          the Fermi level cuts through a band, and the teal half of the curve sits under a violet
          half with no gap between them. Two electrons fill band 1 exactly and the label reads
          semiconductor, because the gap above it is about 1.3 eV on this page&rsquo;s scale.
          Now raise V₀ to 6 with the count still at 2. Same electrons, same filling — but the gap
          has grown past 3 eV and the label flips to insulator. The electrons did not change;
          the gap did.
        </p>
      </Explainer>

      <Explainer title="What just happened">
        <p>
          A wave with wavelength exactly twice the lattice spacing — k = π/a — reflects off every
          atom in phase. Bragg reflection. It cannot travel, so it stands, and there are two ways
          to stand: with the crests on the atoms or with the crests between them. Those two
          standing waves feel different potential energies, and the difference between them is
          the gap. Everything in the left panel follows from that one sentence: the tear appears
          at the zone boundary because that is where the reflection is total, and its size is
          twice the Fourier component of V at 2π/a because that is how much the two standing waves
          differ.
        </p>
        <p>
          The right panel is the same information read the other way. Each stripe is a range of
          energy in which an electron can move through the barriers from cell to cell forever;
          each gap is a range in which anything you put in decays within a few cells. The tight-binding
          preset makes the origin plain — the stripes sit at the bound-state energies of one
          well, thickened by a tunnelling rate — and the nearly-free preset makes the other limit
          plain, where they are the parabola with slits cut in it.
        </p>
        <p>
          Conduction needs an empty state a tiny energy above a filled one. Halfway up a band
          there are always some. At the top of a filled band, with a gap above it, there are
          none within reach, and the solid is an insulator — or a semiconductor if the gap is
          small enough that heat or light can bridge it. Odd electron counts give metals; even
          ones give gaps. That the periodic table&rsquo;s alkali metals conduct and its noble-gas
          solids do not is this slider.
        </p>
      </Explainer>

      <Explainer title="How the bands are computed">
        <p>
          The potential is the Kronig–Penney cell: a flat well of width a − b followed by a
          barrier of height V₀ and width b, repeated forever. In each piece the wave is a plain
          cosine or a plain exponential, and carrying ψ and ψ′ across one cell is a 2×2 matrix
          M(E). Bloch&rsquo;s theorem says a crystal state at energy E exists exactly when M(E) has
          an eigenvalue e<sup>ika</sup> of unit size — and since det M = 1, that is the single
          condition cos(ka) = ½ Tr M(E). Bands are where the right-hand side lies in [−1, 1];
          gaps are where it does not; E(k) is that equation solved for E.
        </p>
        <p>
          This is done in
          <code className="mx-1 rounded bg-surface-3 px-1 py-0.5 text-[12px]">lib/quantum/bands.ts</code>
          on top of wave-1&rsquo;s Schrödinger engine, and checked in
          <code className="mx-1 rounded bg-surface-3 px-1 py-0.5 text-[12px]">bands.test.ts</code>
          against the free parabola at V₀ = 0, against the Kronig–Penney condition as printed in
          Kittel, against 2|Vₙ| for weak potentials, against the tabulated Mathieu characteristic
          values for a cosine potential sampled on the engine&rsquo;s grid, and against a
          hard-wall supercell run through the engine&rsquo;s finite-difference solver — which finds
          the same N states per band, plus a surface state in the gap that the infinite crystal
          does not have.
        </p>
      </Explainer>

      <Explainer title="What is and isn't real here">
        <p>
          One dimension, one electron, a rectangular barrier. Real crystals are three-dimensional
          and their gaps can be indirect — the top of the valence band and the bottom of the
          conduction band at different k — which is why silicon is a poor light emitter and
          gallium arsenide is a good one. Nothing here can show that; there is only one k.
        </p>
        <p>
          The electrons do not interact. In a real metal they screen each other and the band
          picture survives as a description of quasiparticles; in some oxides it fails outright
          and a half-filled band insulates (a Mott insulator). The rule &ldquo;odd count means
          metal&rdquo; is the independent-electron rule, and it is what this page computes.
        </p>
        <p>
          The eV scale is a stated convention, one length unit = {LENGTH_UNIT_ANGSTROM} Å, chosen
          so the lattice-spacing slider covers real interatomic distances. The metal /
          semiconductor / insulator labels are exact for the first split — a band is or is not
          partly full — and conventional for the second, which is a line drawn at about{' '}
          {SEMICONDUCTOR_MAX_GAP_EV} eV.
        </p>
      </Explainer>
    </VizFrame>
  )
}
