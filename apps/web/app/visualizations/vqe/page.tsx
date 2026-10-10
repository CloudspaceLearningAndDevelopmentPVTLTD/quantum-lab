'use client'

import { useCallback, useMemo, useState } from 'react'
import VQELab, { BARREN_WIDTHS, LANDSCAPE_SIZE, type VQEStats } from '@/components/viz/VQELab'
import { barrenLayers, groundStateEnergy, type Ising } from '@/components/viz/vqe/landscape'
import { VizFrame, Explainer } from '@/components/ui/VizFrame'
import { Segmented, Slider, ButtonRow, Stat } from '@/components/ui/Controls'

const QUBITS = [4, 6, 8] as const
const LAYERS = [1, 2, 3, 4] as const

const EMPTY_STATS: VQEStats = {
  optimiser: { theta: 0, phi: 0, energy: NaN, step: 0, converged: false },
  landscapeProgress: 0,
  landscapeMin: NaN,
  barren: BARREN_WIDTHS.map((n) => ({ n, variance: 0, samples: 0 })),
}

export default function VQEPage() {
  const [n, setN] = useState<number>(6)
  const [layers, setLayers] = useState<number>(3)
  const [h, setH] = useState(1)
  const [startTheta, setStartTheta] = useState(1.9)
  const [startPhi, setStartPhi] = useState(2.4)
  const [optimising, setOptimising] = useState(false)
  const [barrenRunning, setBarrenRunning] = useState(false)
  const [resetKey, setResetKey] = useState(0)
  const [stats, setStats] = useState<VQEStats>(EMPTY_STATS)

  const model: Ising = useMemo(() => ({ n, J: 1, h }), [n, h])

  // The exact answer, by Lanczos. Memoised because it is the only expensive thing on
  // this page that is NOT incremental — at n = 8 it diagonalises a 256-dimensional
  // Krylov problem once and then never again for that (n, J, h).
  const exact = useMemo(() => groundStateEnergy(model), [model])

  const onStats = useCallback((s: VQEStats) => setStats(s), [])

  const onPick = useCallback((theta: number, phi: number) => {
    setStartTheta(theta)
    setStartPhi(phi)
    setOptimising(false)
  }, [])

  const restart = () => setResetKey((k) => k + 1)

  const energy = stats.optimiser.energy
  const gap = Number.isFinite(energy) ? energy - exact : NaN
  const relative = Number.isFinite(gap) ? Math.abs(gap / exact) : NaN

  const controls = (
    <>
      <Segmented
        label="Chain length"
        value={String(n)}
        options={QUBITS.map((v) => ({ value: String(v), label: `${v} qubits` }))}
        onChange={(v) => {
          setN(Number(v))
          restart()
        }}
      />
      <Segmented
        label="Ansatz layers"
        value={String(layers)}
        options={LAYERS.map((v) => ({ value: String(v), label: String(v) }))}
        onChange={(v) => {
          setLayers(Number(v))
          restart()
        }}
      />
      <Slider
        label="Transverse field h"
        value={h}
        min={0.1}
        max={2}
        step={0.1}
        format={(v) => v.toFixed(1)}
        onChange={setH}
        hint="J is fixed at 1. h ≈ 1 is the quantum critical point, where the ground state is most entangled"
      />

      {/* Keyboard route to the same thing a click on the map does. */}
      <Slider
        label="Start θ₀"
        value={startTheta}
        min={0}
        max={2 * Math.PI}
        step={0.05}
        format={(v) => `${(v / Math.PI).toFixed(2)}π`}
        onChange={(v) => {
          setStartTheta(v)
          setOptimising(false)
        }}
      />
      <Slider
        label="Start φ₀"
        value={startPhi}
        min={0}
        max={2 * Math.PI}
        step={0.05}
        format={(v) => `${(v / Math.PI).toFixed(2)}π`}
        onChange={(v) => {
          setStartPhi(v)
          setOptimising(false)
        }}
      />

      <ButtonRow>
        <button type="button" className="btn-primary" onClick={() => setOptimising((o) => !o)}>
          {optimising ? 'Pause optimiser' : 'Run optimiser'}
        </button>
        <button
          type="button"
          className="btn-ghost"
          onClick={() => {
            setOptimising(false)
            restart()
          }}
        >
          Restart
        </button>
      </ButtonRow>

      <div className="grid grid-cols-2 gap-2">
        <Stat
          label="Variational E"
          value={Number.isFinite(energy) ? energy.toFixed(4) : '—'}
          accent="violet"
        />
        <Stat label="Exact ground E" value={exact.toFixed(4)} accent="teal" />
        <Stat
          label="Gap"
          value={Number.isFinite(gap) ? gap.toFixed(4) : '—'}
          accent={Number.isFinite(relative) && relative < 0.01 ? 'teal' : 'amber'}
        />
        <Stat label="Steps" value={String(stats.optimiser.step)} accent="sky" />
      </div>

      <div className="border-t border-line pt-4">
        <ButtonRow>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => setBarrenRunning((b) => !b)}
          >
            {barrenRunning ? 'Stop gradient sampling' : 'Sample gradients (barren plateau)'}
          </button>
        </ButtonRow>
        <p className="mt-2 text-[11px] leading-relaxed text-ink-muted">
          Samples ∂E/∂θ per site at random parameters, by the parameter-shift rule, on a
          separate independent-parameter RY–CZ–RX ansatz of depth 2n. Watch the bars fall
          as the width goes up.
        </p>
      </div>

      <p className="text-[11px] leading-relaxed text-ink-muted">
        Landscape: {LANDSCAPE_SIZE}×{LANDSCAPE_SIZE} = {LANDSCAPE_SIZE * LANDSCAPE_SIZE}{' '}
        statevector simulations, {Math.round(stats.landscapeProgress * 100)}% computed.
      </p>
    </>
  )

  return (
    <VizFrame
      title="VQE and the Barren Plateau"
      tagline="A quantum computer that only prepares states, and a classical optimiser that has to find them in the dark."
      level="Advanced"
      canvas={
        <div className="p-2">
          <VQELab
            model={model}
            layers={layers}
            startTheta={startTheta}
            startPhi={startPhi}
            optimising={optimising}
            barrenRunning={barrenRunning}
            resetKey={resetKey}
            onPick={onPick}
            onStats={onStats}
          />
          <p className="px-3 pb-2 pt-1 text-[11px] leading-relaxed text-ink-muted">
            Every cell of the map is a full statevector simulation of the ansatz at that
            (θ, φ) and an exact expectation value of H — teal is low energy, amber high.
            Click anywhere on the map to move the starting point, or use the θ₀ and φ₀
            sliders. The white trail is gradient descent; it turns red when it stops.
          </p>
        </div>
      }
      controls={controls}
    >
      {/* A11Y: the bar chart is the only place the barren-plateau numbers appear on
          the canvas, and they are drawn as bar heights on a log axis. Here they are
          digits. */}
      <section className="card mb-4 p-6">
        <h2 className="mb-1 text-lg font-bold">Gradient variance against qubit count</h2>
        <p className="mb-4 text-[13px] text-ink-secondary">
          {stats.barren[0]?.samples
            ? `${stats.barren[0].samples.toLocaleString('en-US')} random parameter vectors sampled per width, gradients taken by the parameter-shift rule.`
            : 'Press “Sample gradients” in the controls to start measuring. Nothing here is precomputed.'}
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">
              Variance of the per-site energy gradient at random parameters, against the
              number of qubits, with the circuit depth used for each.
            </caption>
            <thead>
              <tr className="border-b border-line text-[11px] uppercase tracking-wider text-ink-muted">
                <th className="py-2 text-left font-bold" scope="col">
                  Qubits
                </th>
                <th className="py-2 text-right font-bold" scope="col">
                  Ansatz depth
                </th>
                <th className="py-2 text-right font-bold" scope="col">
                  Var[∂E/∂θ] per site
                </th>
                <th className="py-2 text-right font-bold" scope="col">
                  Typical |gradient|
                </th>
                <th className="py-2 text-right font-bold" scope="col">
                  vs 2 qubits
                </th>
              </tr>
            </thead>
            <tbody>
              {stats.barren.map((row) => {
                const base = stats.barren[0]?.variance ?? 0
                return (
                  <tr key={row.n} className="border-b border-line last:border-0">
                    <td className="py-2 font-mono text-q-violet-text">{row.n}</td>
                    <td className="py-2 text-right font-mono text-ink-muted">
                      {barrenLayers(row.n)} layers
                    </td>
                    <td className="py-2 text-right font-mono text-ink-secondary">
                      {row.variance > 0 ? row.variance.toExponential(2) : '—'}
                    </td>
                    <td className="py-2 text-right font-mono text-ink-secondary">
                      {row.variance > 0 ? Math.sqrt(row.variance).toExponential(2) : '—'}
                    </td>
                    <td className="py-2 text-right font-mono text-ink-muted">
                      {row.variance > 0 && base > 0 ? `${(base / row.variance).toFixed(1)}× smaller` : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      <Explainer title="What VQE actually is">
        <p>
          Almost nothing a near-term quantum computer can do is useful on its own. VQE is
          the honest workaround: use the quantum machine for the one thing it is good at —
          preparing a state that would be exponentially expensive to write down — and let
          a classical optimiser do the searching.
        </p>
        <p>
          The loop is: pick parameters, ask the quantum computer to prepare
          |ψ(θ, φ)⟩ and measure ⟨H⟩, hand that one number to a classical optimiser, get
          new parameters, repeat. The variational principle guarantees ⟨H⟩ ≥ E₀ for every
          possible parameter setting, so lower is always better and you never have to
          wonder whether you have overshot.
        </p>
        <p>
          The map is that guarantee made visible. Every cell is a real state preparation
          and a real expectation value of H = −Σ Z<sub>i</sub>Z<sub>i+1</sub> − h Σ
          X<sub>i</sub>. Nowhere on it does the energy dip below the exact ground state
          energy of {exact.toFixed(4)}, and the best cell on the grid is{' '}
          {Number.isFinite(stats.landscapeMin) ? stats.landscapeMin.toFixed(4) : '—'}.
        </p>
      </Explainer>

      <Explainer title="The landscape is not a bowl">
        <p>
          Start the optimiser from a few different points. It will not always reach the
          same place. Gradient descent goes downhill, and downhill is a purely local
          instruction — a shallow basin next to a deep one traps it just as effectively as
          a deep one does.
        </p>
        <p>
          Turn the layer count down to 1 and watch the whole map flatten out: a
          single-layer ansatz simply cannot express the ground state of a coupled chain,
          so even a perfect optimiser lands well short. Turn it up and the minimum
          deepens, but the landscape gets more corrugated. That trade — expressive enough
          to contain the answer, simple enough to be searchable — is the design problem at
          the centre of the whole field.
        </p>
        <p>
          A real VQE gives every gate its own parameter, which for this circuit would be{' '}
          {2 * n * layers} of them. The two shared angles here exist so the landscape can
          be drawn at all. The corrugation you see in two dimensions is the shadow of a
          much worse problem in {2 * n * layers}.
        </p>
      </Explainer>

      <Explainer title="The barren plateau">
        <p>
          Now the part that makes VQE hard in a way no better optimiser can fix. Press
          &ldquo;Sample gradients&rdquo;. For a random parameter setting of a deep
          hardware-efficient circuit, the gradient is not just small — its{' '}
          <em>variance</em> falls roughly exponentially with the number of qubits, by a
          factor near two for every qubit added. By 10 qubits the per-site variance is
          about two and a half orders of magnitude below the 2-qubit value.
        </p>
        <p>
          The consequence is brutal. If a gradient component is of order 10⁻⁴, you need
          about 10⁸ measurement shots to tell it apart from zero, because shot noise on an
          expectation value falls only as 1/√shots. The landscape is not merely hard to
          search; at scale it is <em>flat to within your ability to measure it</em>, in
          almost every direction, from almost every random starting point. There is
          nothing for the optimiser to follow.
        </p>
        <p>
          This is measured here, not asserted: the gradients are taken with the
          parameter-shift rule, which is exact rather than a finite difference, on random
          parameter vectors of an independent-parameter ansatz whose depth scales with its
          width. The number reported is per site, because H is extensive and a raw ∂E/∂θ
          carries a factor of n that has nothing to do with the plateau — but the effect
          does not depend on that choice. Measured both ways from 2 to 10 qubits, the raw
          extensive variance falls about 25× (≈ ×0.65 per qubit) and the per-site variance
          about 600× (≈ ×0.44 per qubit). Both are exponential; the normalisation moves
          the number, it does not create the decay.
        </p>
        <p>
          One detail that turned out to decide whether any of this was visible here: the
          choice of ansatz. An earlier variant of this page used only RY rotations and CZ
          gates, which keeps every amplitude real. Sampled over n = 2 to 10 qubits at depth
          2n, that circuit&rsquo;s gradient variance did not concentrate — the raw variance
          fell roughly as n⁻¹, a power law rather than a plateau, and only the per-site
          division made the bars look like they collapsed. That is an empirical finding
          about this particular circuit family at these depths, not a loophole: real-valued
          circuits are not exempt from barren plateaus in general, and orthogonal
          2-designs give the same exponential decay of gradient variance as unitary ones.
          Adding the RX sublayer is what produced the exponential decay measured on this
          page, and the module&rsquo;s tests now fail if it is removed.
        </p>
        <p>
          Ways out are an active research area: shallow and problem-informed ansätze,
          clever initialisation that starts you somewhere non-random, local rather than
          global cost functions, and layerwise training. None of them is a general
          solution, and no amount of classical optimiser cleverness helps — the
          information is not there to be found.
        </p>
      </Explainer>

      <Explainer title="What this simulation does and does not include">
        <p>
          Every energy on this page is an exact expectation value computed from a full
          statevector. A real device estimates that number from a finite number of shots,
          so it gets it wrong by roughly 1/√shots — and then the optimiser has to
          differentiate through that noise. Add realistic gate errors on top and the
          effective landscape is rougher than the one drawn here, not smoother.
        </p>
        <p>
          The Ising chain is also a model with a known answer: it is exactly solvable, and
          the exact energy in the controls comes from a Lanczos diagonalisation running in
          your browser. VQE is aimed at Hamiltonians where that is not possible — molecular
          electronic structure, mainly. The reason to demonstrate it on a solvable model is
          precisely that you can see how far off the variational answer is, which for a
          real target you could not.
        </p>
      </Explainer>
    </VizFrame>
  )
}
