'use client'

import { useMemo, useState } from 'react'
import BoundStatesLab from '@/components/viz/BoundStatesLab'
import { VizFrame, Explainer } from '@/components/ui/VizFrame'
import { Segmented, Slider, Toggle, Stat } from '@/components/ui/Controls'
import {
  boundStates,
  solveStationary,
  squareWellPotential,
  uniformGrid,
  zeroPotential,
  type Eigenstate,
  type Grid,
} from '@/lib/quantum/schrodinger'

/** Grid points. 640 puts the finite-difference error on the levels below 0.1%. */
const N = 640
/** Levels shown for the infinite well. Beyond eight the diagram stops being readable. */
const INFINITE_LEVELS = 8

type Mode = 'infinite' | 'finite'

/**
 * BOTH wells are drawn with the floor at E = 0 and the walls going UP, so the finite well
 * is visibly the infinite well with its walls lowered rather than a different picture with
 * a different zero. squareWellPotential uses the textbook convention (−V₀ inside, 0
 * outside), so every value is raised by V₀ here — a constant shift moves the whole
 * spectrum with it and changes nothing else.
 */
function buildProblem(
  mode: Mode,
  width: number,
  depth: number
): { grid: Grid; potential: Float64Array; states: Eigenstate[]; ceiling: number } {
  if (mode === 'infinite') {
    // Interior points of a hard-wall box, centred on x = 0: the implied walls that
    // solveStationary puts one site outside the grid land exactly on ±width/2.
    const dx = width / (N + 1)
    const grid = uniformGrid(N, dx, -width / 2 + dx)
    const potential = zeroPotential(grid)
    const states = solveStationary(grid, potential, INFINITE_LEVELS)
    const top = states[states.length - 1]?.energy ?? 1
    return { grid, potential, states, ceiling: top * 1.12 }
  }

  // Enough room outside the walls for the slowest-decaying tail (1/κ with κ = √(2V₀))
  // to die before the grid ends — otherwise the box, not the well, sets the answer.
  const margin = Math.min(24, Math.max(2.5, 6 / Math.sqrt(2 * depth)))
  const half = width / 2 + margin
  const dx = (2 * half) / N
  const grid = uniformGrid(N, dx, -half + dx / 2)
  const potential = squareWellPotential(grid, depth, width)
  for (let i = 0; i < potential.length; i++) potential[i] += depth
  // Probe well past the deepest well the sliders can make (⌈w√(2V₀)/π⌉ tops out at 17
  // for width 8 and V₀ 20), so the "bound states" count is the real one, never the
  // number we happened to ask for.
  const states = boundStates(grid, potential, 30, depth)
  return { grid, potential, states, ceiling: depth * 1.28 }
}

const fmt = (v: number) => (Math.abs(v) >= 10 ? v.toFixed(2) : v.toFixed(3))

export default function BoundStatesPage() {
  const [mode, setMode] = useState<Mode>('infinite')
  const [width, setWidth] = useState(4)
  const [depth, setDepth] = useState(6)
  const [level, setLevel] = useState(0)
  const [showDensity, setShowDensity] = useState(false)

  const { grid, potential, states, ceiling } = useMemo(
    () => buildProblem(mode, width, depth),
    [mode, width, depth]
  )

  const index = Math.min(level, Math.max(0, states.length - 1))
  const selected: Eigenstate | undefined = states[index]

  // Probability outside the walls: zero for the infinite well by construction, and the
  // headline number for the finite one.
  const outside = useMemo(() => {
    if (!selected) return 0
    const half = width / 2
    let total = 0
    for (let i = 0; i < grid.n; i++) {
      if (Math.abs(grid.x[i]) > half) total += selected.psi[i] * selected.psi[i] * grid.dx
    }
    return total
  }, [selected, grid, width])

  // The infinite-well answer for the same box, as a reference the finite well is measured
  // against: E_n = n²π²/2L².
  const infiniteReference = ((index + 1) * (index + 1) * Math.PI * Math.PI) / (2 * width * width)

  const levelOptions = states.map((_, i) => ({ value: String(i), label: `${i + 1}` }))

  const controls = (
    <>
      <Segmented<Mode>
        label="Walls"
        value={mode}
        options={[
          { value: 'infinite', label: 'Infinite' },
          { value: 'finite', label: 'Finite' },
        ]}
        onChange={(v) => {
          setMode(v)
          setLevel(0)
        }}
      />

      <Slider
        label="Box width L"
        value={width}
        min={1}
        max={8}
        step={0.1}
        format={(v) => v.toFixed(1)}
        onChange={setWidth}
        hint="Squeeze the box and every level climbs"
      />

      {mode === 'finite' ? (
        <Slider
          label="Wall height V₀"
          value={depth}
          min={0.4}
          max={20}
          step={0.2}
          format={(v) => v.toFixed(1)}
          onChange={setDepth}
          hint="Lower the walls and states escape off the top"
        />
      ) : null}

      {/* A segmented picker while the chips still fit; a slider once a deep well holds a
          dozen or more states. Both are keyboard operable, which the canvas click is not
          meant to replace. */}
      {states.length > 0 && states.length <= 8 ? (
        <Segmented
          label="Level n"
          value={String(index)}
          options={levelOptions}
          onChange={(v) => setLevel(Number(v))}
        />
      ) : states.length > 8 ? (
        <Slider
          label="Level n"
          value={index + 1}
          min={1}
          max={states.length}
          step={1}
          format={(v) => v.toFixed(0)}
          onChange={(v) => setLevel(Math.round(v) - 1)}
        />
      ) : null}

      <Toggle
        label="Show |ψ|² instead of ψ"
        checked={showDensity}
        onChange={setShowDensity}
        hint="Where the particle is actually found"
      />

      <div className="grid grid-cols-2 gap-2">
        <Stat label="Energy" value={selected ? fmt(selected.energy) : '—'} accent="violet" />
        <Stat label="Nodes" value={selected ? String(selected.nodes) : '—'} accent="teal" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Stat
          label="Eₙ / E₁"
          value={selected && states[0] ? (selected.energy / states[0].energy).toFixed(2) : '—'}
          accent="sky"
        />
        {mode === 'finite' ? (
          <Stat label="Bound states" value={String(states.length)} accent="amber" />
        ) : (
          <Stat label="Wavelength λₙ" value={fmt((2 * width) / (index + 1))} accent="amber" />
        )}
      </div>
      <Stat
        label="Probability outside the walls"
        value={`${(outside * 100).toFixed(outside < 0.01 ? 3 : 1)}%`}
        accent="rose"
      />
      {mode === 'finite' ? (
        <Stat
          label="Infinite-wall answer for this box"
          value={fmt(infiniteReference)}
          accent="teal"
        />
      ) : null}

      <p className="text-[11px] leading-relaxed text-ink-muted">
        Levels come from a finite-difference eigensolve on a {N}-point grid, in units where
        ħ = m = 1. Click a level line on the diagram to select it.
      </p>
    </>
  )

  return (
    <VizFrame
      title="Particle in a Box"
      tagline="Trap a particle between two walls and it can only have certain energies. Here is why, and what happens when the walls are not infinitely high."
      level="Beginner"
      canvas={
        <div className="p-2">
          <BoundStatesLab
            grid={grid}
            potential={potential}
            states={states}
            level={index}
            showDensity={showDensity}
            markers={[-width / 2, width / 2]}
            energyFloor={0}
            energyCeiling={ceiling}
            onPickLevel={setLevel}
          />
          <p className="px-3 pb-2 pt-1 text-[11px] leading-relaxed text-ink-muted">
            Amber is the potential; each grey line is an allowed energy. The violet curve is the
            selected state, drawn on top of its own level line — teal dots mark its nodes, and the
            faint rose band is the region a classical particle could never enter.
          </p>
        </div>
      }
      controls={controls}
    >
      <Explainer title="Start here">
        <p>
          A particle confined between two walls is a wave that has to fit. Both ends are pinned at
          zero, so only whole numbers of half-wavelengths survive; everything else interferes with
          itself and cancels. That single constraint is the entire origin of quantized energy —
          there is no extra rule, no postulate about allowed orbits. Fitting is the rule.
        </p>
        <p>
          Drag <strong>Box width</strong> and watch the ladder stretch and compress. Then switch the
          walls to <strong>Finite</strong>, drop <strong>V₀</strong> toward the floor, and watch
          levels fall off the top of the well one at a time while the survivor spills out through
          walls it does not have the energy to cross.
        </p>
      </Explainer>

      <Explainer title="n², and the price of confinement">
        <p>
          With infinite walls the answer is exact: Eₙ = n²π²ħ²/2mL². Two things in that formula do
          real work. The n² means the gaps get wider as you climb — the tenth level is not ten times
          the first, it is a hundred times. And the 1/L² means squeezing costs energy, violently.
          Halve the box and every level quadruples. The <em>Eₙ/E₁</em> readout is showing you the
          n² directly; it stays 4, 9, 16 no matter how you move the width slider.
        </p>
        <p>
          That 1/L² is not a curiosity either. It is why an electron cannot simply fall into the
          nucleus: confining it to a nuclear-sized box would cost more kinetic energy than the
          electrical attraction could ever pay back. Atoms have a size because confinement has a
          price.
        </p>
      </Explainer>

      <Explainer title="What just happened: the wall leaks">
        <p>
          Switch to finite walls and look at the curve just outside the dashed lines. It is not
          zero. The particle has less energy than the wall is tall, so the region beyond it is
          classically forbidden — and the wavefunction is there anyway, decaying exponentially
          rather than stopping. The <em>probability outside the walls</em> readout is the size of
          that impossibility, and lowering V₀ pushes it from a fraction of a percent to tens of
          percent.
        </p>
        <p>
          Two consequences follow immediately. Every level sits <em>lower</em> than the infinite-well
          answer for the same box, because the particle is effectively in a slightly wider box than
          the one you drew. And a well only holds a finite number of states: raise n far enough and
          the level runs off the top of the walls and the particle is free. Count them as you drop
          V₀ — the last one is remarkably stubborn. In one dimension, a well of any depth at all,
          however shallow, always keeps at least one bound state.
        </p>
      </Explainer>

      <Explainer title="Where you have already met this">
        <p>
          A quantum dot is a box: change its diameter by a couple of nanometres and the level
          spacing shifts, which shifts the colour of the light it emits. The same cadmium selenide
          glows red when the dots are big and blue when they are small, with no change of material
          at all — that is 1/L², visible to the naked eye, and it is how quantum-dot displays make
          their primaries.
        </p>
        <p>
          The leaking tail is the other half of the story. Push two of these wells close together
          and their tails overlap; the shared state that results is a chemical bond. Make the
          barrier between them thin and the particle crosses it — which is{' '}
          <a className="focus-ring rounded underline" href="/visualizations/tunneling">
            tunnelling
          </a>
          , the same exponential tail seen from the other side.
        </p>
      </Explainer>
    </VizFrame>
  )
}
