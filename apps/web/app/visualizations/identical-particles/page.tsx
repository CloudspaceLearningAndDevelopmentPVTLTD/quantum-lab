'use client'

import { useMemo, useState } from 'react'
import IdenticalParticlesLab from '@/components/viz/IdenticalParticlesLab'
import LevelFilling from '@/components/viz/identical/LevelFilling'
import PeriodicTableMini from '@/components/viz/identical/PeriodicTableMini'
import { VizFrame, Explainer } from '@/components/ui/VizFrame'
import { Segmented, ButtonRow, Slider, Stat, Toggle } from '@/components/ui/Controls'
import {
  ELEMENT_NAMES,
  ELEMENT_SYMBOLS,
  electronConfiguration,
  formatConfiguration,
  groundStateOccupation,
  meanSquareSeparation,
  samplePairs,
  separationDistribution,
  shellPopulation,
  twoBodyAmplitude,
  twoBodyNorm,
  wellOrbitals,
  type Statistics,
} from '@/lib/quantum/identicalParticles'

/**
 * /visualizations/identical-particles — exchange symmetry, made visible.
 *
 * The page owns three small pieces of state — which statistics, which two orbitals, how
 * many particles — and every number it displays comes from lib/quantum/identicalParticles.ts
 * on top of the wave-1 Schrödinger engine. The heat map is |ψ(x₁,x₂)|² for the state the
 * controls describe; the level diagram and the periodic table are the same Pauli principle
 * applied to N particles and then to Z electrons.
 */

/** Grid points for the orbitals. 128 puts the levels within 0.3% of n²E₁ and gives a 128² heat map. */
const N = 128
/** Box width. Everything is quoted in units of L and E₁ = π²/2L², so the value is cosmetic. */
const L = 1
/** Levels solved. The filling diagram needs eight for eight spin-polarised fermions. */
const LEVELS = 8
const MAX_ORBITAL = 4
const DROP = 400

type FillMode = 'boson' | 'fermion-polarised' | 'fermion-spin'

export default function IdenticalParticlesPage() {
  const [statistics, setStatistics] = useState<Statistics>('fermion')
  const [orbitalA, setOrbitalA] = useState(1)
  const [orbitalB, setOrbitalB] = useState(2)
  const [showReference, setShowReference] = useState(true)
  // Sampled pairs are tagged with the amplitude they were drawn from, so a new state
  // shows a blank scatter without an effect that resets state after render.
  const [sampled, setSampled] = useState<{ of: Float64Array | null; pairs: Array<[number, number]> }>({
    of: null,
    pairs: [],
  })

  const [count, setCount] = useState(4)
  const [fillMode, setFillMode] = useState<FillMode>('fermion-polarised')

  const [z, setZ] = useState(11)

  // One eigensolve for the whole page. The orbitals never change: the controls pick
  // which two to combine, not what the well looks like.
  const { grid, states } = useMemo(() => wellOrbitals(N, L, LEVELS), [])
  const e1 = states[0].energy

  const sameOrbital = orbitalA === orbitalB
  const psi = useMemo(
    () => twoBodyAmplitude(states[orbitalA - 1].psi, states[orbitalB - 1].psi, statistics, sameOrbital),
    [states, orbitalA, orbitalB, statistics, sameOrbital]
  )
  const reference = useMemo(
    () => twoBodyAmplitude(states[orbitalA - 1].psi, states[orbitalB - 1].psi, 'distinguishable', sameOrbital),
    [states, orbitalA, orbitalB, sameOrbital]
  )

  const samples = sampled.of === psi ? sampled.pairs : []

  const numbers = useMemo(() => {
    if (!psi) return null
    const { density } = separationDistribution(psi, grid)
    const refSep = reference ? separationDistribution(reference, grid).density[grid.n - 1] : 0
    return {
      norm: twoBodyNorm(psi, grid.dx),
      meanSq: meanSquareSeparation(psi, grid),
      refMeanSq: reference ? meanSquareSeparation(reference, grid) : 0,
      atZero: density[grid.n - 1],
      refAtZero: refSep,
    }
  }, [psi, reference, grid])

  const pairEnergy = (states[orbitalA - 1].energy + states[orbitalB - 1].energy) / e1

  // ── Level filling ───────────────────────────────────────────────────────────
  const ladder = useMemo(() => states.map((s) => s.energy / e1), [states, e1])
  const fill = useMemo(() => {
    const stats: Statistics = fillMode === 'boson' ? 'boson' : 'fermion'
    const spin = fillMode === 'fermion-spin' ? 2 : 1
    return groundStateOccupation(stats, count, ladder, spin)
  }, [fillMode, count, ladder])
  const bosonEnergy = count * ladder[0]
  const topLevel = fill.occupation.reduce((top, k, i) => (k > 0 ? i + 1 : top), 0)

  // ── Periodic table ──────────────────────────────────────────────────────────
  const config = useMemo(() => electronConfiguration(z), [z])
  const shells = useMemo(() => shellPopulation(config), [config])
  const configText = formatConfiguration(config)
  const isException = z === 24 || z === 29

  const dropPairs = () => {
    if (!psi) return
    setSampled({ of: psi, pairs: samples.concat(samplePairs(psi, grid, DROP)) })
  }

  const controls = (
    <>
      <Segmented<Statistics>
        label="What the two particles are"
        value={statistics}
        options={[
          { value: 'distinguishable', label: 'Distinguishable' },
          { value: 'boson', label: 'Bosons' },
          { value: 'fermion', label: 'Fermions' },
        ]}
        onChange={setStatistics}
      />

      <Slider
        label="Orbital a"
        value={orbitalA}
        min={1}
        max={MAX_ORBITAL}
        step={1}
        onChange={(v) => setOrbitalA(Math.round(v))}
        format={(v) => `n = ${v.toFixed(0)} · E = ${(v * v).toFixed(0)}E₁`}
        hint="One of the two box states the pair is built from."
      />
      <Slider
        label="Orbital b"
        value={orbitalB}
        min={1}
        max={MAX_ORBITAL}
        step={1}
        onChange={(v) => setOrbitalB(Math.round(v))}
        format={(v) => `n = ${v.toFixed(0)} · E = ${(v * v).toFixed(0)}E₁`}
        hint="Set it equal to a and see which statistics still has a state."
      />

      <Toggle
        label="Show the no-exchange reference"
        checked={showReference}
        onChange={setShowReference}
        hint="Dashed curve: the same two orbitals with no symmetry imposed."
      />

      <ButtonRow>
        <button type="button" className="btn-primary focus-ring" onClick={dropPairs} disabled={!psi}>
          Drop {DROP} pairs
        </button>
        <button
          type="button"
          className="btn-ghost focus-ring"
          onClick={() => setSampled({ of: psi, pairs: [] })}
          disabled={samples.length === 0}
        >
          Clear dots
        </button>
      </ButtonRow>

      <div className="grid grid-cols-2 gap-2">
        <Stat
          label="⟨(x₁ − x₂)²⟩ / L²"
          value={numbers ? numbers.meanSq.toFixed(4) : '—'}
          accent={statistics === 'fermion' ? 'rose' : statistics === 'boson' ? 'teal' : 'violet'}
        />
        <Stat label="No exchange" value={numbers ? numbers.refMeanSq.toFixed(4) : '—'} accent="sky" />
        <Stat label="P(x₁ = x₂)" value={numbers ? numbers.atZero.toFixed(3) : '—'} accent="amber" />
        <Stat label="No exchange" value={numbers ? numbers.refAtZero.toFixed(3) : '—'} accent="sky" />
        <Stat label="Energy" value={psi ? `${pairEnergy.toFixed(2)} E₁` : 'no state'} accent="violet" />
        <Stat label="Norm" value={numbers ? numbers.norm.toFixed(6) : '—'} accent="teal" />
      </div>

      <p className="text-[11px] leading-relaxed text-ink-muted">
        The two &ldquo;no exchange&rdquo; boxes are the same quantities for the plain product state
        with no symmetry imposed. Every number here is computed from the same 128 × 128 amplitude
        the heat map paints; the energy is the sum of the two orbital energies from the solver, in
        units of its own E₁.
      </p>
    </>
  )

  return (
    <VizFrame
      title="Fermions and Bosons"
      tagline="Two particles that cannot be told apart do not get separate wavefunctions. They share one — and whether it changes sign when you swap them decides whether they crowd together or refuse to touch."
      level="Advanced"
      canvas={
        <div className="p-2">
          <IdenticalParticlesLab
            grid={grid}
            psi={psi}
            reference={reference}
            statistics={statistics}
            orbitalA={orbitalA}
            orbitalB={orbitalB}
            samples={samples}
            showReference={showReference}
          />
          <p className="px-3 pb-2 pt-1 text-[11px] leading-relaxed text-ink-muted">
            Left: |ψ(x₁, x₂)|² for the two particles, particle 1 across and particle 2 up, brighter
            where the pair is more likely to be found. The dashed diagonal is x₁ = x₂ — both
            particles at the same place. Right: the probability of each separation x₁ − x₂, with
            the no-exchange product state dashed for comparison. &ldquo;Drop pairs&rdquo; draws
            positions sampled from the density, so you can see the hole as an absence rather than
            a colour. Nothing on this canvas animates.
          </p>
        </div>
      }
      controls={controls}
    >
      <Explainer title="Run these, in this order">
        <p>
          <strong className="text-ink">Distinguishable, orbitals 1 and 2.</strong> Particle 1 in
          the ground state, particle 2 in the first excited state, and no symmetry demanded. The
          heat map is a plain product: a single bump across, two bumps up. Note the value of
          P(x₁ = x₂) and the mean square separation — they are the baseline.
        </p>
        <p>
          <strong className="text-ink">Fermions.</strong> Same two orbitals. The dashed diagonal is
          now a dark trench: |ψ|² is exactly zero wherever x₁ = x₂, and P(x₁ = x₂) reads 0.000. Drop
          a few hundred pairs and the dots keep clear of the diagonal on their own. The mean square
          separation climbs to 0.168 L² from a baseline of 0.103.
        </p>
        <p>
          <strong className="text-ink">Bosons.</strong> Same two orbitals again. The diagonal is
          now the <em>brightest</em> line on the map, P(x₁ = x₂) is the largest it will get, and the
          separation collapses to 0.038 L². Then set orbital b equal to orbital a: the boson state
          is still there — it is the plain product φ₁(x₁)φ₁(x₂) — and the fermion state is gone.
        </p>
      </Explainer>

      <Explainer title="What just happened">
        <p>
          Nothing pushed the fermions apart and nothing pulled the bosons together. There is no
          force in this simulation at all: the box has hard walls and the two particles do not
          interact. The only thing that changed between the three pictures was a sign.
        </p>
        <p>
          If two particles are genuinely identical, swapping them cannot change anything you can
          measure, so |ψ(x₂, x₁)|² must equal |ψ(x₁, x₂)|². That leaves two ways for ψ itself to
          respond to the swap: stay the same, or flip sign. Nature uses both. Particles whose
          wavefunction stays the same are bosons; particles whose wavefunction flips are fermions.
          A wavefunction that flips sign under x₁ ↔ x₂ has no choice about what to do at x₁ = x₂:
          there, the swap does nothing, so ψ = −ψ, so ψ = 0. That is the trench. Nobody put it
          there. It is what antisymmetry <em>means</em>, evaluated on the diagonal.
        </p>
        <p>
          The symmetric case is the mirror image of the same arithmetic. On the diagonal the two
          products are equal, so adding them instead of subtracting gives √2 times a single
          product and twice its density — exactly the factor by which P(x₁ = x₂) exceeds the
          no-exchange reference in the controls. Bosons bunch for the same reason
          fermions avoid each other: interference between &ldquo;particle 1 here, particle 2
          there&rdquo; and the swapped alternative, which for identical particles are not two
          histories but one.
        </p>
      </Explainer>

      <Explainer title="The only formula on this page">
        <p>
          Take two box orbitals φ_a and φ_b. Distinguishable particles get the product
          φ_a(x₁)·φ_b(x₂). Identical particles get one of
        </p>
        <p className="rounded-lg bg-surface-2 px-4 py-3 text-center font-mono text-[14px] text-ink">
          ψ±(x₁, x₂) = [ φ_a(x₁) φ_b(x₂) ± φ_b(x₁) φ_a(x₂) ] / √2
        </p>
        <p>
          with + for bosons and − for fermions. Swap x₁ and x₂ and the two terms trade places,
          which multiplies the whole thing by ±1: that is the symmetry, and the test file checks
          it holds bit for bit. Set a = b and the minus sign kills ψ₋ identically — two fermions
          cannot occupy the same orbital, which is the Pauli exclusion principle before any mention
          of spin. The energy is E_a + E_b either way; symmetrising costs nothing and changes no
          energy. What it changes is <em>where</em> the particles are.
        </p>
        <p>
          The number in the controls quantifies it. For non-interacting particles,
          ⟨(x₁ − x₂)²⟩ is the distinguishable value ∓ 2|⟨a|x|b⟩|², where ⟨a|x|b⟩ is the position
          matrix element between the two orbitals. For orbitals 1 and 2 of a box it is −16L/9π²,
          which makes the shift 0.065 L² in each direction — the 0.038 and 0.168 you just watched.
          Griffiths calls this the exchange force, and warns in the same breath that it is not a
          force. Move to orbitals 1 and 3 and the effect vanishes: ⟨1|x|3⟩ = 0 by symmetry, so both
          curves fall on top of the reference even though the trench is still there.
        </p>
      </Explainer>

      <div className="card mb-4 p-6">
        <h2 className="mb-1 text-lg font-bold">Filling the well</h2>
        <p className="mb-4 text-[15px] leading-relaxed text-ink-secondary">
          Now put more than two particles in. Bosons all sit in the lowest level. Fermions cannot,
          so they stack — one per level if their spins are all the same, two per level if spin up
          and spin down count as different states. The total energy is the sum of the occupied
          levels, and the ladder is the solver&rsquo;s, in units of its own E₁.
        </p>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-[minmax(0,1fr)_260px]">
          <div className="rounded-lg border border-line bg-surface-2 p-2">
            <LevelFilling
              energies={ladder}
              occupation={fill.occupation}
              spinHalf={fillMode === 'fermion-spin'}
              accent={fillMode === 'boson' ? 'teal' : 'rose'}
            />
          </div>
          <div className="flex flex-col gap-4">
            <Segmented<FillMode>
              label="Statistics"
              value={fillMode}
              options={[
                { value: 'boson', label: 'Bosons' },
                { value: 'fermion-polarised', label: 'Fermions, one spin' },
                { value: 'fermion-spin', label: 'Fermions, spin ½' },
              ]}
              onChange={setFillMode}
            />
            <Slider
              label="Particles"
              value={count}
              min={1}
              max={LEVELS}
              step={1}
              onChange={(v) => setCount(Math.round(v))}
              format={(v) => v.toFixed(0)}
            />
            <div className="grid grid-cols-2 gap-2">
              <Stat
                label="Ground-state energy"
                value={`${fill.energy.toFixed(2)} E₁`}
                accent={fillMode === 'boson' ? 'teal' : 'rose'}
              />
              <Stat label="If they were bosons" value={`${bosonEnergy.toFixed(2)} E₁`} accent="sky" />
              <Stat label="Highest level used" value={`n = ${topLevel}`} accent="amber" />
              <Stat label="Per particle" value={`${(fill.energy / count).toFixed(2)} E₁`} accent="violet" />
            </div>
          </div>
        </div>
        <p className="mt-4 text-[15px] leading-relaxed text-ink-secondary">
          Two spin-polarised fermions cost E₁ + E₂ = 5E₁ where two bosons cost 2E₁ — the test file
          pins both. Eight of them cost 1 + 4 + ⋯ + 64 = 204E₁, over 25E₁ each, and the top of the
          stack keeps climbing as N². That climb is the Fermi energy, and the pressure it exerts is
          what holds a white dwarf up against its own gravity with no fusion running. Turn the
          particles into bosons and the whole stack drops into level 1, which is the seed of a
          Bose–Einstein condensate: not a new force, the same minus sign switched off.
        </p>
      </div>

      <div className="card mb-4 p-6">
        <h2 className="mb-1 text-lg font-bold">Why the periodic table has its shape</h2>
        <p className="mb-4 text-[15px] leading-relaxed text-ink-secondary">
          Electrons are spin-½ fermions, and an atom&rsquo;s levels are the hydrogen-like
          subshells: s holds 2, p holds 6, d holds 10, f holds 14. Fill Z electrons in from the
          bottom, two per orbital with opposite spins, and the row lengths of the table fall out.
          Pick an element.
        </p>
        <PeriodicTableMini z={z} onPick={setZ} />
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_240px]">
          <div>
            <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-2xl font-extrabold text-ink">{ELEMENT_SYMBOLS[z - 1]}</span>
              <span className="text-[15px] text-ink-secondary">
                {ELEMENT_NAMES[z - 1]} · Z = {z}
              </span>
            </div>
            <p className="font-mono text-[15px] text-q-rose-text" aria-live="polite">
              {configText}
            </p>
            <Slider
              label="Atomic number Z"
              value={z}
              min={1}
              max={36}
              step={1}
              onChange={(v) => setZ(Math.round(v))}
              format={(v) => `${v.toFixed(0)} · ${ELEMENT_SYMBOLS[Math.round(v) - 1]}`}
            />
            {isException ? (
              <p className="mt-2 text-[13px] text-ink-secondary">
                {ELEMENT_NAMES[z - 1]} is one of the two atoms below krypton that break the
                filling rule: a half-filled or full 3d shell is worth more than a full 4s, so one
                electron moves. The rule predicts 4s² 3d{z === 24 ? '⁴' : '⁹'}; the atom does
                4s¹ 3d{z === 24 ? '⁵' : '¹⁰'}. The page shows the real one.
              </p>
            ) : null}
          </div>
          <div>
            <h3 className="section-label mb-2">Electrons per shell</h3>
            <ul className="space-y-2">
              {shells.map((filled, i) => {
                const n = i + 1
                const capacity = 2 * n * n
                return (
                  <li key={n} className="text-[12px]">
                    <div className="mb-0.5 flex justify-between font-mono text-ink-secondary">
                      <span>n = {n}</span>
                      <span>
                        {filled} / {capacity}
                      </span>
                    </div>
                    <div
                      className="h-2 w-full overflow-hidden rounded bg-surface-3"
                      role="meter"
                      aria-valuemin={0}
                      aria-valuemax={capacity}
                      aria-valuenow={filled}
                      aria-label={`Shell ${n}: ${filled} of ${capacity} electrons`}
                    >
                      <div
                        className="h-full rounded bg-q-rose"
                        style={{ width: `${(100 * filled) / capacity}%` }}
                      />
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
        </div>
        <p className="mt-4 text-[15px] leading-relaxed text-ink-secondary">
          Helium closes the first row at two because 1s holds two and nothing else is anywhere
          near. Neon closes the second at ten: 2s and 2p together hold eight more. The third row is
          <em> also</em> eight wide, not eighteen, because 4s fills before 3d — step from argon to
          potassium and watch the configuration grow a 4s¹ while 3d stays empty. The ten d
          electrons arrive in the fourth row instead, which is why that row is 18 wide and why the
          transition metals sit where they sit. Every one of those numbers is a subshell capacity
          2(2l + 1), and the 2 in it is the same &ldquo;two per orbital, then no more&rdquo; the
          level diagram above was built on.
        </p>
      </div>

      <Explainer title="What is and isn't real here">
        <p>
          The heat map is exact for what it claims: two non-interacting particles in a 1-D box,
          orbitals from the same finite-difference solver that runs /visualizations/bound-states,
          symmetrised by hand. Real electrons repel each other, and the symmetrised product is then
          the starting point of a calculation, not its end. The trench on the diagonal survives
          interactions — it is forced by antisymmetry alone — while the precise numbers do not.
        </p>
        <p>
          &ldquo;Fermions&rdquo; on the canvas means spin-polarised fermions, or spinless ones: the
          spatial wavefunction has to carry the whole minus sign. Two electrons with opposite spins
          can share a spatial orbital because the sign lives in the spin part instead, which is why
          the filling section offers a spin-½ mode and why helium&rsquo;s ground state is 1s².
        </p>
        <p>
          The periodic-table section applies the Madelung filling order and a two-entry exception
          table. That is a rule that summarises measured atoms, not a solution of any Schrödinger
          equation; below krypton it is right for 34 of 36 elements and the page corrects the other
          two. Above krypton the exceptions multiply, which is why the picker stops at 36.
        </p>
        <p>
          The physics is checked, not eyeballed:
          <code className="mx-1 break-all rounded bg-surface-3 px-1 py-0.5 text-[12px]">
            lib/quantum/identicalParticles.test.ts
          </code>
          asserts that the antisymmetric state is zero on the diagonal, that both states are
          normalised, that exchange gives exactly ±ψ, that the two-particle energies are E₁ + E₂
          and 2E₁, and that ⟨(x₁ − x₂)²⟩ lands on the closed-form exchange-force values — all
          against textbook numbers, never against the code&rsquo;s own output.
        </p>
      </Explainer>
    </VizFrame>
  )
}
