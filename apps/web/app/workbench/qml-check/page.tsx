'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import QmlSurfaces, { MODEL_LABEL } from '@/components/workbench/QmlSurfaces'
import { useQmlSession } from '@/components/workbench/useQmlSession'
import { Segmented, Slider, ButtonRow, Stat } from '@/components/ui/Controls'
import { Explainer } from '@/components/ui/VizFrame'
import {
  COMPARISON_DEFAULT,
  HIDDEN_CIRCUIT,
  MODEL_IDS,
  makeDataset,
  splitDataset,
  vqcParamCount,
  type ComparisonConfig,
  type DatasetId,
  type ModelId,
  type ModelReport,
} from '@/lib/workbench/qml'

/**
 * /workbench/qml-check — QML Reality Check.
 *
 * The page owns the configuration and the prose. Every number in the table
 * comes back from lib/workbench/qmlSession.ts running in a Web Worker
 * (components/workbench/useQmlSession.ts), which trains the three models in
 * lib/workbench/qml.ts to the budget the reader set and reports what it
 * measured — nothing here is extrapolated, smoothed or typed in.
 */

const DATASETS: { value: DatasetId; label: string }[] = [
  { value: 'moons', label: 'Moons' },
  { value: 'circles', label: 'Circles' },
  { value: 'quantum', label: 'Quantum-made' },
]

const DATASET_BLURB: Record<DatasetId, string> = {
  moons:
    'Two interleaved half-circles with Gaussian noise — scikit-learn’s make_moons. A cubic polynomial separates it; a straight line does not.',
  circles:
    'A ring inside a ring. The radius is a quadratic feature, so a polynomial fit is exact and any straight line is at chance.',
  quantum: `Inputs are uniform on the square; each label is the sign of ⟨Z⟩ from a hidden ${HIDDEN_CIRCUIT.numQubits}-qubit, ${HIDDEN_CIRCUIT.layers}-layer circuit of the same family as the classifier, thresholded at its median. The labelling function is in the VQC’s hypothesis class by construction.`,
}

const fmtInt = (n: number) => n.toLocaleString('en-US')
const fmtBig = (n: number) => {
  if (!Number.isFinite(n)) return '—'
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} G`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)} k`
  return fmtInt(Math.round(n))
}
const pct = (v: number | undefined) =>
  v === undefined || Number.isNaN(v) ? '—' : `${(v * 100).toFixed(1)}%`

/** Shots per circuit evaluation assumed when translating evaluations into hardware shots. */
const SHOTS_PER_EVAL = 1000

export default function QmlCheckPage() {
  const [dataset, setDataset] = useState<DatasetId>('moons')
  const [numQubits, setNumQubits] = useState<2 | 3 | 4>(2)
  const [layers, setLayers] = useState(3)
  const [steps, setSteps] = useState(COMPARISON_DEFAULT.vqcOptions.maxSteps)
  const [mlpBoost, setMlpBoost] = useState<1 | 5>(1)
  const [budgetSec, setBudgetSec] = useState(30)
  const [seed, setSeed] = useState(COMPARISON_DEFAULT.seed)
  const { state, start, stop } = useQmlSession()

  const config: ComparisonConfig = useMemo(
    () => ({
      ...COMPARISON_DEFAULT,
      dataset,
      seed,
      vqc: { ...COMPARISON_DEFAULT.vqc, numQubits, layers },
      vqcOptions: { ...COMPARISON_DEFAULT.vqcOptions, maxSteps: steps },
      mlp: { ...COMPARISON_DEFAULT.mlp, maxSteps: steps * mlpBoost },
    }),
    [dataset, seed, numQubits, layers, steps, mlpBoost],
  )

  // The same deterministic rows the worker trains on, for the canvases.
  const split = useMemo(() => splitDataset(makeDataset(config.dataset, config.seed, config.size)), [
    config.dataset,
    config.seed,
    config.size,
  ])

  const running = state.status === 'running'
  const elapsedSec = state.elapsedMs / 1000
  const vqcParams = vqcParamCount(config.vqc) + 2

  // A live status line for screen readers, throttled to whole seconds.
  const liveRef = useRef('')
  const [live, setLive] = useState('')
  useEffect(() => {
    const line = running
      ? `Training ${state.active ? MODEL_LABEL[state.active].toLowerCase() : ''}, ${Math.floor(elapsedSec)} seconds of ${budgetSec}.`
      : state.status === 'finished'
        ? 'Training finished.'
        : state.status === 'stopped'
          ? 'Training stopped before every budget was spent.'
          : ''
    if (line !== liveRef.current) {
      liveRef.current = line
      setLive(line)
    }
  }, [running, state.active, state.status, elapsedSec, budgetSec])

  const r = state.reports
  const verdict = useMemo(() => verdictFor(dataset, r), [dataset, r])

  const controls = (
    <>
      <Segmented<DatasetId> label="Dataset" value={dataset} options={DATASETS} onChange={setDataset} />
      <p className="-mt-3 text-[11px] leading-relaxed text-ink-muted">{DATASET_BLURB[dataset]}</p>

      <Segmented<'2' | '3' | '4'>
        label="Qubits in the classifier"
        value={String(numQubits) as '2' | '3' | '4'}
        options={[
          { value: '2', label: '2' },
          { value: '3', label: '3' },
          { value: '4', label: '4' },
        ]}
        onChange={(v) => setNumQubits(Number(v) as 2 | 3 | 4)}
      />
      <Segmented<'1' | '2' | '3' | '4'>
        label="Circuit layers (each re-uploads the data)"
        value={String(layers) as '1' | '2' | '3' | '4'}
        options={[1, 2, 3, 4].map((v) => ({ value: String(v) as '1' | '2' | '3' | '4', label: String(v) }))}
        onChange={(v) => setLayers(Number(v))}
      />
      <Slider
        label="Optimiser steps"
        value={steps}
        min={100}
        max={1200}
        step={50}
        format={(v) => fmtInt(v)}
        onChange={(v) => setSteps(Math.round(v))}
        hint={`The VQC and the MLP each get this many Adam steps, batches of 32. The VQC spends the first ${config.vqcOptions.restarts * config.vqcOptions.restartSteps} racing ${config.vqcOptions.restarts} random starts. Logistic regression is solved by Newton's method and needs about six.`}
      />
      <Segmented<'1' | '5'>
        label="MLP step budget"
        value={String(mlpBoost) as '1' | '5'}
        options={[
          { value: '1', label: 'Same as VQC' },
          { value: '5', label: '5× the VQC' },
        ]}
        onChange={(v) => setMlpBoost(v === '5' ? 5 : 1)}
      />
      <Slider
        label="Time budget"
        value={budgetSec}
        min={5}
        max={90}
        step={5}
        format={(v) => `${v} s`}
        onChange={(v) => setBudgetSec(Math.round(v))}
        hint="Whichever runs out first — steps or seconds — ends the run. A model that was cut off says so in the table."
      />
      <Slider
        label="Seed"
        value={seed}
        min={1}
        max={99}
        step={1}
        format={(v) => String(v)}
        onChange={(v) => setSeed(Math.round(v))}
        hint="Fixes the noise, the split, the initial angles and the batch order. Seed 7 is the one the tests pin."
      />

      <ButtonRow>
        <button
          type="button"
          className="btn-primary focus-ring"
          onClick={() => start(config, budgetSec * 1000)}
          disabled={running}
          aria-disabled={running}
        >
          {state.status === 'idle' ? 'Train all three' : 'Train again'}
        </button>
        <button type="button" className="btn-ghost focus-ring" onClick={stop} disabled={!running} aria-disabled={!running}>
          Stop
        </button>
      </ButtonRow>

      <div className="grid grid-cols-2 gap-2">
        <Stat label="Elapsed" value={running || state.status !== 'idle' ? `${elapsedSec.toFixed(1)} s / ${budgetSec} s` : '—'} accent="amber" />
        <Stat label="VQC parameters" value={String(vqcParams)} accent="teal" />
        <Stat label="Training rows" value={fmtInt(split.nTrain)} accent="sky" />
        <Stat label="Held-out rows" value={fmtInt(split.nTest)} accent="violet" />
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3"
        role="progressbar"
        aria-label="Time budget used"
        aria-valuemin={0}
        aria-valuemax={budgetSec}
        aria-valuenow={Math.min(budgetSec, Math.round(elapsedSec))}
      >
        <div
          className="h-full rounded-full bg-q-teal"
          style={{ width: `${Math.min(100, (100 * elapsedSec) / budgetSec)}%` }}
        />
      </div>
      <p className="text-[11px] leading-relaxed text-ink-muted">
        {state.inWorker === false
          ? 'Running on the main thread in short slices — this browser could not start a Web Worker. Still bounded and still stoppable.'
          : 'Training runs in a Web Worker; the page stays responsive and Stop takes effect within a slice.'}
      </p>
      <p className="sr-only" aria-live="polite">
        {live}
      </p>
    </>
  )

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
      <Link
        href="/workbench"
        className="focus-ring mb-6 inline-flex items-center gap-1.5 rounded text-sm text-ink-muted transition-colors hover:text-ink-secondary"
      >
        <span aria-hidden>←</span> Workbench
      </Link>

      <div className="mb-8">
        <span className="pill border border-q-teal/30 bg-q-teal/15 text-q-teal-text">measure</span>
        <h1 className="mt-3 text-3xl font-extrabold tracking-tight md:text-4xl">QML Reality Check</h1>
        <p className="mt-2 max-w-2xl text-[15px] text-ink-secondary">
          A variational quantum classifier against a properly fitted logistic regression and a
          small MLP, on the same held-out rows, with the training bill for each. On classical toy
          data the quantum model loses. On data a quantum circuit made, it wins — and the reason
          it wins is the whole point.
        </p>
      </div>

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <section className="card overflow-hidden" role="region" aria-labelledby="qml-surfaces-title" tabIndex={-1}>
          <h2 id="qml-surfaces-title" className="sr-only">
            Decision surfaces
          </h2>
          <QmlSurfaces split={split} grids={state.grids} reports={state.reports} active={state.active} />
          <p className="px-4 pb-3 text-[11px] leading-relaxed text-ink-muted">
            Each square is the standardised feature plane, ±2.2 standard deviations. Teal predicts
            the positive class, violet the negative; deeper colour is a more confident model.
            Filled dots are the {fmtInt(split.nTrain)} training rows, rings are the {fmtInt(split.nTest)}{' '}
            held-out rows no optimiser sees. The surfaces redraw as the worker reports progress.
          </p>
        </section>

        <aside className="card p-4 sm:p-5" aria-labelledby="qml-controls-title">
          <h2 id="qml-controls-title" className="section-label mb-4">
            Controls
          </h2>
          <div className="flex flex-col gap-5">{controls}</div>
        </aside>
      </div>

      <div className="mt-10 max-w-3xl">
        <div className="card mb-6 p-6">
          <h2 className="section-label mb-1">The honest table</h2>
          <p className="mb-3 text-[13px] text-ink-secondary">
            {state.status === 'idle'
              ? 'Nothing has been trained yet. Pick a dataset and press Train.'
              : verdict}
          </p>
          <div className="-mx-2 overflow-x-auto px-2">
            <table className="w-full min-w-[720px] border-collapse text-left text-sm">
              <caption className="sr-only">
                Held-out and training accuracy, final loss, steps taken and training cost for each of the three models.
              </caption>
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-wider text-ink-muted">
                  <th scope="col" className="py-2 pr-3 font-bold">Model</th>
                  <th scope="col" className="py-2 pr-3 text-right font-bold">Params</th>
                  <th scope="col" className="py-2 pr-3 text-right font-bold">Held-out</th>
                  <th scope="col" className="py-2 pr-3 text-right font-bold">Train</th>
                  <th scope="col" className="py-2 pr-3 text-right font-bold">Loss</th>
                  <th scope="col" className="py-2 pr-3 text-right font-bold">Steps</th>
                  <th scope="col" className="py-2 pr-3 text-right font-bold">Circuit evals</th>
                  <th scope="col" className="py-2 text-right font-bold">Flops</th>
                </tr>
              </thead>
              <tbody className="font-mono text-[13px]">
                {MODEL_IDS.map((m) => {
                  const rep = r[m]
                  const cut = rep && !rep.done && state.status !== 'running'
                  return (
                    <tr key={m} className="border-b border-line">
                      <th scope="row" className="py-2 pr-3 text-left font-sans font-semibold text-ink">
                        {MODEL_LABEL[m]}
                        {cut ? <span className="ml-2 text-[11px] font-normal text-q-amber-text">cut off by budget</span> : null}
                      </th>
                      <td className="py-2 pr-3 text-right text-ink-secondary">{rep ? rep.params : m === 'vqc' ? vqcParams : '—'}</td>
                      <td className="py-2 pr-3 text-right text-q-teal-text">{pct(rep?.testAcc)}</td>
                      <td className="py-2 pr-3 text-right text-ink">{pct(rep?.trainAcc)}</td>
                      <td className="py-2 pr-3 text-right text-ink-secondary">{rep && Number.isFinite(rep.loss) ? rep.loss.toFixed(3) : '—'}</td>
                      <td className="py-2 pr-3 text-right text-ink-secondary">{rep ? `${fmtInt(rep.step)} / ${fmtInt(rep.budgetSteps)}` : '—'}</td>
                      <td className="py-2 pr-3 text-right text-q-violet-text">{rep ? fmtInt(rep.cost.circuitEvals) : '—'}</td>
                      <td className="py-2 text-right text-q-sky-text">{rep ? fmtBig(rep.cost.flops) : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[12px] leading-relaxed text-ink-muted">
            Circuit evaluations are end-to-end runs of the quantum circuit during training — the
            forward pass plus two parameter-shift evaluations per angle per row, plus every step of
            the discarded random starts. At {fmtInt(SHOTS_PER_EVAL)} shots each, the VQC row is{' '}
            {r.vqc ? fmtBig(r.vqc.cost.circuitEvals * SHOTS_PER_EVAL) : '—'} hardware shots. Flops
            are what the classical processor did: for the two baselines, the model; for the VQC, the
            statevector simulator that stood in for a quantum computer. Scoring the held-out rows and
            painting the surfaces is not counted.
          </p>
        </div>

        <Explainer title="What this tool does">
          <p>
            It builds one dataset of 300 rows from the seed, holds out 90 of them, standardises the
            features on the training rows only, and trains three classifiers on the remaining 210:
            an L2-regularised logistic regression on cubic polynomial features (solved exactly by
            Newton&rsquo;s method — a fair baseline is not an under-trained one), a 2→16→1 tanh
            network with Adam, and a variational quantum classifier with angle encoding, data
            re-uploading on every layer, RY–RZ trainable rotations, a CNOT ladder and a ⟨Z⟩ readout,
            trained by Adam on parameter-shift gradients. The circuit is simulated exactly with the
            same statevector engine as the{' '}
            <Link href="/simulator" className="focus-ring rounded text-q-violet-text underline-offset-2 hover:underline">
              circuit simulator
            </Link>
            .
          </p>
          <p>
            Accuracy is reported on the held-out rows. Cost is reported in the currency each model
            actually spends: circuit evaluations for the quantum model, floating-point operations
            for the classical ones, and both for the simulated VQC so you can see what your laptop
            paid to pretend.
          </p>
        </Explainer>

        <Explainer title="Run these three, in this order">
          <p>
            <strong className="text-ink">Moons.</strong> Train with the defaults. Logistic
            regression finishes in a handful of Newton steps and lands near 97–100% held-out. The
            MLP matches it. The VQC gets to the low-to-mid 90s, at roughly half a million circuit
            evaluations, and its decision surface wobbles where the polynomial&rsquo;s is smooth.
            It works; it is simply not better, and it cost a thousand times more evaluations.
          </p>
          <p>
            <strong className="text-ink">Circles.</strong> Same story. The radius is a quadratic
            feature, so the polynomial fit is essentially exact. Watch the VQC surface: with one or
            two layers it cannot draw a closed ring at all, because a rotation-encoded circuit is a
            Fourier series in each feature whose frequencies the encoding fixes.
          </p>
          <p>
            <strong className="text-ink">Quantum-made.</strong> Now the gap inverts. Logistic
            regression stalls in the 60s and 70s; the MLP, given the same step budget, sits in the
            70s and 80s; the VQC crosses 90%. Then switch the MLP to five times the steps and watch
            it close most of the distance. Set the classifier to one layer and watch the VQC
            collapse to the classical numbers.
          </p>
        </Explainer>

        <Explainer title="What just happened on the quantum-made set">
          <p>
            The labels were produced by measuring a fixed 2-qubit, 3-layer circuit on the encoded
            input. That function is a sum of sines and cosines of the two features with frequencies
            up to three — a bumpy, periodic surface. A cubic polynomial cannot follow it. A small
            network can, but only by spending many steps placing tanh bumps where the ripples are.
            The VQC contains the function exactly, because it is the same kind of circuit, so its
            job is only to find the right angles — and even that takes several random starts,
            because the loss landscape of a periodic model is full of local minima.
          </p>
          <p>
            That is the honest shape of the one advantage the field has actually demonstrated:
            when the data was made by a quantum process, a quantum model of matching structure is
            the natural hypothesis class. Nothing about that transfers to a spreadsheet.
          </p>
        </Explainer>

        <Explainer title="The 2026 evidence, stated plainly">
          <p>
            <strong className="text-ink">No accepted advantage on classical data.</strong> There
            is exactly one proven exponential separation for a learning problem — a quantum kernel
            on labels reverse-engineered from the discrete logarithm (Liu, Arunachalam &amp; Temme
            2021) — and it has not been extended to any natural dataset. Head-to-head experiments at
            simulable scale show quantum models roughly matching, and typically trailing, tuned
            classical baselines, which is what this page reproduces.
          </p>
          <p>
            <strong className="text-ink">Dequantisation.</strong> Several claimed exponential
            speed-ups — recommendation systems, low-rank linear algebra — were answered by classical
            algorithms with matching data-access assumptions (Tang 2018 onward). When the classical
            side is granted the same sampling access the quantum algorithm assumed, the exponent
            usually disappears.
          </p>
          <p>
            <strong className="text-ink">Data loading.</strong> Angle encoding, used here, is
            linear in the number of features and cheap; amplitude encoding stores 2ⁿ numbers in n
            qubits but costs exponential depth to prepare and O(1/ε²) shots to read one number back.
            Every serious proposal has to say where its data comes from.
          </p>
          <p>
            <strong className="text-ink">Barren plateaus.</strong> Gradients of a sufficiently
            expressive circuit concentrate exponentially around zero in the qubit count (McClean et
            al. 2018), and the escape routes — shallow, structured, locally measured circuits — tend
            to be classically simulable. At 2–4 qubits this page is nowhere near a plateau; to see
            one form, open the{' '}
            <Link href="/visualizations/vqe" className="focus-ring rounded text-q-violet-text underline-offset-2 hover:underline">
              VQE and barren plateau simulation
            </Link>{' '}
            and raise the qubit count. The full argument, with the kernel view and a reading
            checklist for QML claims, is the{' '}
            <Link href="/learn/quantum-machine-learning" className="focus-ring rounded text-q-violet-text underline-offset-2 hover:underline">
              Quantum Machine Learning lesson
            </Link>
            .
          </p>
        </Explainer>

        <Explainer title="What this tool does not do">
          <p>
            It does not run on quantum hardware, and it does not model shot noise: every ⟨Z⟩ is
            exact, so the VQC here is a best case. It does not model gate noise, which on real
            devices flattens gradients further. It does not tune the classical baselines beyond
            sensible fixed settings — a serious classical benchmark would cross-validate, and would
            do even better. It has two features and at most four qubits, so it says nothing about
            scaling; it cannot exhibit a barren plateau, and it cannot show what a 50-qubit model
            would do. It is a controlled, reproducible, small-scale check of the claim structure —
            which is what most published QML comparisons are too.
          </p>
        </Explainer>
      </div>
    </div>
  )
}

/** One sentence about the result on screen, from the numbers alone. */
function verdictFor(dataset: DatasetId, r: Partial<Record<ModelId, ModelReport>>): string {
  const q = r.vqc
  const lr = r.logreg
  const mlp = r.mlp
  if (!q || !lr || !mlp || Number.isNaN(q.testAcc) || Number.isNaN(lr.testAcc)) {
    return 'Training in progress — the rows fill in as each model reports.'
  }
  const bestClassical = Math.max(lr.testAcc, mlp.testAcc)
  const gap = q.testAcc - bestClassical
  const pts = `${Math.abs(gap * 100).toFixed(1)} points`
  const evals = q.cost.circuitEvals.toLocaleString('en-US')
  if (gap > 0.02) {
    return dataset === 'quantum'
      ? `The VQC beat the best classical baseline by ${pts} on the held-out rows, at ${evals} circuit evaluations. This is the quantum-made set: the labelling function is in the circuit's hypothesis class, so this is the win the 2026 evidence allows — and only this one.`
      : `The VQC came out ${pts} ahead on this run. On classical toy data that is within seed-to-seed noise on 90 held-out rows; try another seed, and note the ${evals} circuit evaluations it cost.`
  }
  if (gap < -0.02) {
    return dataset === 'quantum'
      ? `A classical baseline beat the VQC by ${pts} this time. On the quantum-made set that usually means the VQC's random starts all landed in a poor local minimum, or the circuit has too few layers to contain the hidden function — check the layer count and try another seed.`
      : `The classical baseline won by ${pts} on the held-out rows, and did it in flops rather than ${evals} circuit evaluations. That is the expected result on classical data.`
  }
  return `A dead heat within ${pts} — but look at the cost columns: the VQC spent ${evals} circuit evaluations to tie a model that finished in microseconds.`
}
