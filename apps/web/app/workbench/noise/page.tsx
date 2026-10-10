'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Segmented, ButtonRow, Slider, Stat, Toggle } from '@/components/ui/Controls'
import { Explainer } from '@/components/ui/VizFrame'
import ZneChart from '@/components/workbench/ZneChart'
import FidelityChart, { type FidelityPoint } from '@/components/workbench/FidelityChart'
import { toQasm, type Circuit } from '@/lib/quantum'
import {
  circuitDepth,
  createNoisySampler,
  observableLabel,
  type NoiseModel,
  type Observable,
} from '@/lib/quantum/noise'
import {
  LearnedExtrapolator,
  mitigationJob,
  postProcess,
  type ExtrapolationMethod,
  type JobProgress,
  type MitigationReport,
} from '@/lib/workbench/mitigation'
import { PRESETS, PRESET_BY_ID, gateCount, type PresetId } from '@/lib/workbench/noiseCircuits'

/**
 * /workbench/noise — noise sandbox and mitigation.
 *
 * Every number on this page comes from two modules the tests pin down:
 * lib/quantum/noise.ts (trajectory noise on the ordinary statevector engine)
 * and lib/workbench/mitigation.ts (readout inversion, gate folding, the fits,
 * the bootstrap bars). The page owns the choices and the prose, and the three
 * jobs that must not freeze the tab: the mitigation run, the depth scan, and
 * training the learned extrapolator. Each is a generator or a step function
 * driven from requestAnimationFrame in ~12 ms slices with a visible budget.
 */

type ShotChoice = '256' | '1024' | '4096'
const SHOTS: { value: ShotChoice; label: string }[] = [
  { value: '256', label: '256' },
  { value: '1024', label: '1,024' },
  { value: '4096', label: '4,096' },
]

const METHODS: { value: ExtrapolationMethod; label: string }[] = [
  { value: 'linear', label: 'Linear' },
  { value: 'quadratic', label: 'Quadratic' },
  { value: 'exponential', label: 'Exponential' },
  { value: 'learned', label: 'Learned' },
]

const TRAIN_BUDGET = 600
const SCAN_SHOTS = 400
const SLICE_MS = 12

/** Per-frame slice: keep calling `step` until the budget of one frame is used up. */
function useSlicedJob() {
  const rafRef = useRef<number | null>(null)
  const cancel = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
  }, [])
  /** `step` returns true when finished. `onFrame` is called after each slice. */
  const start = useCallback(
    (step: () => boolean, onFrame: () => void, onDone: () => void) => {
      cancel()
      const tick = () => {
        const t0 = performance.now()
        let done = false
        while (!done && performance.now() - t0 < SLICE_MS) done = step()
        onFrame()
        if (done) {
          rafRef.current = null
          onDone()
        } else {
          rafRef.current = requestAnimationFrame(tick)
        }
      }
      rafRef.current = requestAnimationFrame(tick)
    },
    [cancel]
  )
  useEffect(() => cancel, [cancel])
  // One stable object: the page's effects list the job as a dependency.
  return useMemo(() => ({ start, cancel, isRunning: () => rafRef.current !== null }), [start, cancel])
}

const fmt = (v: number, d = 3) => (Number.isFinite(v) ? v.toFixed(d) : '—')
const pm = (v: number, e: number) => `${fmt(v)} ± ${fmt(e)}`

export default function NoiseWorkbenchPage() {
  // ── Circuit + observable ──
  const [presetId, setPresetId] = useState<PresetId>('bell')
  const preset = PRESET_BY_ID[presetId]
  const [depth, setDepth] = useState(preset.defaultDepth)
  const [obsId, setObsId] = useState(preset.observables[0].id)

  const choosePreset = (id: PresetId) => {
    const p = PRESET_BY_ID[id]
    setPresetId(id)
    setDepth(p.defaultDepth)
    setObsId(p.observables[0].id)
  }
  const obsEntry = preset.observables.find((o) => o.id === obsId) ?? preset.observables[0]
  const obs: Observable = obsEntry.obs
  const circuit: Circuit = useMemo(() => preset.build(depth), [preset, depth])
  const obsLabel = observableLabel(obs, circuit.numQubits)

  // ── Noise model ──
  const [p1, setP1] = useState(0.01)
  const [p2, setP2] = useState(0.03)
  const [t1On, setT1On] = useState(true)
  const [t1, setT1] = useState(40)
  const [t2, setT2] = useState(25)
  const [r10, setR10] = useState(0.02)
  const [r01, setR01] = useState(0.05)
  const [shotChoice, setShotChoice] = useState<ShotChoice>('1024')
  const [seed, setSeed] = useState(1)
  const shots = Number(shotChoice)

  const model: NoiseModel = useMemo(
    () => ({
      depolarising1: p1,
      depolarising2: p2,
      t1: t1On ? t1 : Infinity,
      t2: t1On ? Math.min(t2, 2 * t1) : Infinity,
      readout: { p1given0: r10, p0given1: r01 },
    }),
    [p1, p2, t1On, t1, t2, r10, r01]
  )

  // ── Extrapolation method + the learned extrapolator ──
  const [method, setMethod] = useState<ExtrapolationMethod>('linear')
  const learnedRef = useRef<LearnedExtrapolator | null>(null)
  if (learnedRef.current === null) learnedRef.current = new LearnedExtrapolator({ seed: 7, budget: TRAIN_BUDGET })
  const [trainStatus, setTrainStatus] = useState(() => learnedRef.current!.status())
  const [trainVersion, setTrainVersion] = useState(0)
  const trainer = useSlicedJob()

  const startTraining = () => {
    const ex = learnedRef.current!
    if (ex.status().done) return
    trainer.start(
      () => ex.trainSteps(4).done,
      () => setTrainStatus(ex.status()),
      () => setTrainVersion((v) => v + 1)
    )
  }
  const stopTraining = () => {
    trainer.cancel()
    setTrainStatus(learnedRef.current!.status())
    setTrainVersion((v) => v + 1)
  }
  const resetTraining = () => {
    trainer.cancel()
    learnedRef.current = new LearnedExtrapolator({ seed: 7, budget: TRAIN_BUDGET })
    setTrainStatus(learnedRef.current.status())
    setTrainVersion((v) => v + 1)
  }

  // ── The mitigation run (calibration + three folded circuits) ──
  const [report, setReport] = useState<MitigationReport | null>(null)
  const [progress, setProgress] = useState<JobProgress | null>(null)
  const [runError, setRunError] = useState<string | null>(null)
  const runner = useSlicedJob()

  useEffect(() => {
    // Any change to what is being measured restarts the run. The method and the
    // learned net are NOT dependencies: those are refits of the same counts.
    setRunError(null)
    setReport(null)
    let job: Generator<JobProgress, MitigationReport, void>
    try {
      job = mitigationJob(circuit, obs, model, {
        shots,
        seed,
        method: 'linear',
        bootstrap: 40,
      }, 64)
    } catch (e) {
      setRunError(e instanceof Error ? e.message : String(e))
      return
    }
    let latest: JobProgress | null = null
    let result: MitigationReport | null = null
    runner.start(
      () => {
        try {
          const r = job.next()
          if (r.done) { result = r.value; return true }
          latest = r.value
          return false
        } catch (e) {
          setRunError(e instanceof Error ? e.message : String(e))
          return true
        }
      },
      () => { if (latest) setProgress(latest) },
      () => {
        setProgress(null)
        if (result) setReport(result)
      }
    )
    return () => runner.cancel()
  }, [circuit, obs, model, shots, seed, runner])

  // Refit under the chosen method whenever it, or the learned net, changes.
  const refit = useMemo((): { report: MitigationReport | null; error: string | null } => {
    if (!report) return { report: null, error: null }
    try {
      return { report: postProcess(report.raw, method, learnedRef.current), error: null }
    } catch (e) {
      return { report, error: e instanceof Error ? e.message : String(e) }
    }
    // trainVersion is the signal that learnedRef.current's weights changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report, method, trainVersion])
  const fitted = refit.report
  const shownError = runError ?? refit.error

  // ── Fidelity vs depth scan ──
  const [scan, setScan] = useState<FidelityPoint[]>([])
  const [scanning, setScanning] = useState(false)
  const scanner = useSlicedJob()
  const scanMax = preset.maxDepth
  const scanRef = useRef<FidelityPoint[]>([])

  const startScan = () => {
    scanner.cancel()
    scanRef.current = []
    setScan([])
    setScanning(true)
    let d = preset.minDepth
    let sampler = createNoisySampler(preset.build(d), model, SCAN_SHOTS, seed)
    scanner.start(
      () => {
        if (!sampler.step(32)) return false
        const c = preset.build(d)
        scanRef.current = [...scanRef.current, { depth: d, fidelity: sampler.result().fidelity, gates: gateCount(c) }]
        d += 1
        if (d > scanMax) return true
        sampler = createNoisySampler(preset.build(d), model, SCAN_SHOTS, seed + d)
        return false
      },
      () => setScan(scanRef.current),
      () => setScanning(false)
    )
  }
  const stopScan = () => { scanner.cancel(); setScanning(false) }
  // A scan belongs to one circuit family and one noise model; drop it when either changes.
  useEffect(() => { scanner.cancel(); setScanning(false); setScan([]) }, [presetId, model, scanner])

  const gatesPerBlock = useMemo(() => {
    const c1 = preset.build(preset.minDepth)
    const c2 = preset.hasDepth && preset.maxDepth > preset.minDepth ? preset.build(preset.minDepth + 1) : null
    return c2 ? gateCount(c2) - gateCount(c1) : gateCount(c1)
  }, [preset])
  const reference = useCallback(
    (d: number) => {
      // Every gate fails independently with its depolarising rate, and nothing
      // cancels: (1−p1)^{n1·d} · (1−p2)^{n2·d}. Idle decay is left out on purpose.
      const c = preset.build(Math.max(preset.minDepth, Math.round(d)))
      const n1 = c.ops.filter((o) => o.qubits.length === 1 && o.name !== 'BARRIER' && o.name !== 'MEASURE').length
      const n2 = c.ops.filter((o) => o.qubits.length > 1).length
      return (1 - p1) ** n1 * (1 - p2) ** n2
    },
    [preset, p1, p2]
  )

  const total = fitted ? fitted.raw.runs.length + 2 : 5
  const gates = gateCount(circuit)
  const layers = circuitDepth(circuit)
  const trainPct = Math.round((trainStatus.step / trainStatus.budget) * 100)
  const learnedUntrained = method === 'learned' && trainStatus.step < trainStatus.budget

  const controls = (
    <>
      <Segmented<PresetId>
        label="Circuit"
        value={presetId}
        options={PRESETS.map((p) => ({ value: p.id, label: p.label }))}
        onChange={choosePreset}
      />
      <p className="text-[11px] leading-relaxed text-ink-muted">{preset.blurb}</p>

      {preset.hasDepth ? (
        <Slider
          label={presetId === 'idle' ? 'Idle steps' : 'Repeated blocks'}
          value={depth}
          min={preset.minDepth}
          max={preset.maxDepth}
          step={1}
          onChange={(v) => setDepth(Math.round(v))}
          format={(v) => `${v} · ${gates} gates · ${layers} layers`}
        />
      ) : null}

      <Segmented<string>
        label="Observable"
        value={obsEntry.id}
        options={preset.observables.map((o) => ({ value: o.id, label: o.label }))}
        onChange={setObsId}
      />

      <div role="group" aria-label="Gate noise" className="rounded-lg border border-line bg-surface-2 p-3">
        <span className="mb-2 block text-[13px] font-bold text-ink" aria-hidden>Gate noise</span>
        <Slider
          label="1-qubit depolarising"
          value={p1}
          min={0}
          max={0.1}
          step={0.001}
          onChange={setP1}
          format={(v) => `${(v * 100).toFixed(1)}%`}
          hint="After every single-qubit gate: X, Y or Z with this total probability."
        />
        <div className="mt-3">
          <Slider
            label="2-qubit depolarising"
            value={p2}
            min={0}
            max={0.2}
            step={0.001}
            onChange={setP2}
            format={(v) => `${(v * 100).toFixed(1)}%`}
            hint="After every CX / CZ: one of the 15 two-qubit Paulis."
          />
        </div>
      </div>

      <div role="group" aria-label="Idle decoherence" className="rounded-lg border border-line bg-surface-2 p-3">
        <span className="mb-1 block text-[13px] font-bold text-ink" aria-hidden>Idle decoherence</span>
        <Toggle
          label="T1 / T2 on idle qubits"
          checked={t1On}
          onChange={setT1On}
          hint="A qubit with no gate in a layer idles one step. Gates are instantaneous; their error is the depolarising above."
        />
        {t1On ? (
          <>
            <Slider
              label="T1"
              value={t1}
              min={2}
              max={200}
              step={1}
              onChange={(v) => { setT1(v); if (t2 > 2 * v) setT2(2 * v) }}
              format={(v) => `${v} steps`}
              hint="Relaxation |1⟩ → |0⟩: per idle step P(jump) = 1 − e^(−1/T1)."
            />
            <div className="mt-3">
              <Slider
                label="T2"
                value={Math.min(t2, 2 * t1)}
                min={1}
                max={2 * t1}
                step={1}
                onChange={setT2}
                format={(v) => `${v} steps`}
                hint="Dephasing. Cannot exceed 2·T1; the slider's range follows T1."
              />
            </div>
          </>
        ) : null}
      </div>

      <div role="group" aria-label="Readout error" className="rounded-lg border border-line bg-surface-2 p-3">
        <span className="mb-2 block text-[13px] font-bold text-ink" aria-hidden>Readout error</span>
        <Slider
          label="P(read 1 | true 0)"
          value={r10}
          min={0}
          max={0.2}
          step={0.005}
          onChange={setR10}
          format={(v) => `${(v * 100).toFixed(1)}%`}
        />
        <div className="mt-3">
          <Slider
            label="P(read 0 | true 1)"
            value={r01}
            min={0}
            max={0.2}
            step={0.005}
            onChange={setR01}
            format={(v) => `${(v * 100).toFixed(1)}%`}
            hint="Usually the larger one on hardware: a |1⟩ can relax during the readout pulse."
          />
        </div>
      </div>

      <Segmented<ShotChoice>
        label="Shots per circuit"
        value={shotChoice}
        options={SHOTS}
        onChange={setShotChoice}
      />
      <Slider
        label="Seed"
        value={seed}
        min={1}
        max={99}
        step={1}
        onChange={(v) => setSeed(Math.round(v))}
        format={(v) => String(v)}
        hint="Same seed, same trajectories. Change it to see how much is shot noise."
      />
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
        <span className="pill border border-q-rose/30 bg-q-rose/15 text-q-rose-text">measure</span>
        <h1 className="mt-3 text-3xl font-extrabold tracking-tight md:text-4xl">Noise Sandbox and Mitigation</h1>
        <p className="mt-2 max-w-2xl text-[15px] text-ink-secondary">
          Pick a circuit and an observable, dial in a noise model, and watch the ideal value, the
          noisy value and two mitigated estimates — with the error bar mitigation costs you.
        </p>
      </div>

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <section className="flex flex-col gap-5" aria-labelledby="noise-results">
          <h2 id="noise-results" className="sr-only">Results</h2>

          {/* Headline numbers */}
          <div className="card p-4 sm:p-5">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="section-label">{obsLabel} · {preset.label}</h3>
              <span className="font-mono text-[11px] text-ink-muted" aria-live="polite">
                {progress
                  ? `${progress.phase} · ${Math.round((progress.done / progress.total) * 100)}%`
                  : fitted
                    ? `${total} circuits × ${shots.toLocaleString('en-US')} shots`
                    : shownError ?? '—'}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <Stat label="Ideal" value={fitted ? fmt(fitted.ideal) : '—'} accent="teal" />
              <Stat label="Noisy (raw)" value={fitted ? pm(fitted.noisy, fitted.noisyStderr) : '—'} accent="rose" />
              <Stat label="Readout-mitigated" value={fitted ? pm(fitted.readoutMitigated, fitted.readoutStderr) : '—'} accent="amber" />
              <Stat label={`ZNE · ${method}`} value={fitted ? pm(fitted.zne, fitted.zneStderr) : '—'} accent="violet" />
            </div>
            {shownError ? (
              <p role="alert" className="mt-3 text-[13px] text-q-rose-text">{shownError}</p>
            ) : null}
            {learnedUntrained ? (
              <p className="mt-3 text-[13px] text-q-amber-text">
                The learned extrapolator has trained {trainStatus.step} of {trainStatus.budget} steps. Its
                estimate is not meaningful until training finishes — press Train below.
              </p>
            ) : null}
            {presetId === 'idle' ? (
              <p className="mt-3 text-[13px] text-ink-secondary">
                Folding multiplies gates, not idle time. On this probe ZNE has one X gate to fold and
                nothing else to extrapolate — the three points sit on top of each other. That is not a
                bug in ZNE; it is the class of error it cannot see.
              </p>
            ) : null}
          </div>

          {/* ZNE curve */}
          <div className="card overflow-hidden">
            <div className="p-2">
              <ZneChart report={fitted} observableLabel={obsLabel} />
            </div>
            <div className="border-t border-line px-4 py-3">
              <Segmented<ExtrapolationMethod>
                label="Extrapolation"
                value={method}
                options={METHODS}
                onChange={setMethod}
              />
              <p className="mt-2 text-[11px] leading-relaxed text-ink-muted">
                Hollow rose: what the device reports at each fold scale. Amber: the same counts after
                readout inversion, ± one bootstrap standard error. Violet: the fit through the amber
                points, run back to λ = 0. The dashed line is the exact statevector answer, which a real
                device never shows you.
              </p>
            </div>
          </div>

          {/* Learned extrapolator training */}
          <div className="card p-4 sm:p-5" role="group" aria-labelledby="train-label">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <h3 id="train-label" className="section-label">Learned extrapolator</h3>
              <span className="font-mono text-[11px] text-ink-muted" aria-live="polite">
                {trainStatus.step} / {trainStatus.budget} steps · loss {fmt(trainStatus.loss, 4)}
              </span>
            </div>
            <div
              role="progressbar"
              aria-label="Training progress"
              aria-valuemin={0}
              aria-valuemax={trainStatus.budget}
              aria-valuenow={trainStatus.step}
              className="h-2 w-full overflow-hidden rounded bg-surface-3"
            >
              <div className="h-full bg-q-violet transition-[width] motion-reduce:transition-none" style={{ width: `${trainPct}%` }} />
            </div>
            <div className="mt-3">
              <ButtonRow>
                <button type="button" className="btn-primary focus-ring" onClick={startTraining} disabled={trainStatus.done || trainer.isRunning()}>
                  {trainStatus.step === 0 ? `Train (${TRAIN_BUDGET} steps)` : trainStatus.done ? 'Trained' : 'Resume'}
                </button>
                <button type="button" className="btn-ghost focus-ring" onClick={stopTraining}>Stop</button>
                <button type="button" className="btn-ghost focus-ring" onClick={resetTraining}>Reset weights</button>
              </ButtonRow>
            </div>
            <p className="mt-3 text-[13px] leading-relaxed text-ink-secondary">
              A 3 → 16 → 16 → 1 network, trained here in your tab with Adam on batches of 64 synthetic
              curves: E(λ) = c + (E₀ − c)·e^(−aλ) at λ = 1, 3, 5 with shot noise added, target E₀. It never
              sees your circuit. It is bounded at {TRAIN_BUDGET} steps, runs in animation-frame slices, and
              the Stop button is honoured between slices. Once trained, switch the extrapolation to
              &ldquo;Learned&rdquo; and the three amber points go through it instead of a formula.
            </p>
          </div>

          {/* Fidelity vs depth */}
          <div className="card overflow-hidden">
            <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pt-4">
              <h3 className="section-label">Fidelity vs depth · {preset.label}</h3>
              <span className="font-mono text-[11px] text-ink-muted" aria-live="polite">
                {scanning ? `scanning ${scan.length} / ${scanMax - preset.minDepth + 1}` : scan.length ? `${scan.length} depths · ${SCAN_SHOTS} trajectories each` : 'not run'}
              </span>
            </div>
            <div className="p-2">
              <FidelityChart points={scan} maxDepth={scanMax} reference={reference} presetLabel={preset.label} />
            </div>
            <div className="border-t border-line px-4 py-3">
              <ButtonRow>
                <button type="button" className="btn-primary focus-ring" onClick={startScan} disabled={scanning}>
                  Scan {preset.minDepth}…{scanMax}
                </button>
                <button type="button" className="btn-ghost focus-ring" onClick={stopScan} disabled={!scanning}>Stop</button>
              </ButtonRow>
              <p className="mt-2 text-[11px] leading-relaxed text-ink-muted">
                Fidelity is the trajectory average of |⟨ψ_ideal|ψ⟩|², the overlap with the exact state —
                readout error is not part of it. The dotted reference assumes every one of the
                {' '}{gatesPerBlock} gates per block fails independently and no error ever cancels. Budget:
                {' '}{SCAN_SHOTS} trajectories per depth, {scanMax - preset.minDepth + 1} depths, stoppable.
              </p>
            </div>
          </div>

          {/* Table of the points */}
          {fitted ? (
            <div className="card p-4 sm:p-5">
              <h3 className="section-label mb-3">The numbers behind the chart</h3>
              <div className="-mx-2 overflow-x-auto px-2">
                <table className="w-full min-w-[560px] border-collapse text-left text-sm">
                  <caption className="sr-only">Expectation of {obsLabel} at each fold scale, raw and readout-mitigated, with fidelity and gate count.</caption>
                  <thead>
                    <tr className="border-b border-line text-[11px] uppercase tracking-wider text-ink-muted">
                      <th scope="col" className="py-2 pr-3 font-bold">Scale λ</th>
                      <th scope="col" className="py-2 pr-3 text-right font-bold">Gates</th>
                      <th scope="col" className="py-2 pr-3 text-right font-bold">Fidelity</th>
                      <th scope="col" className="py-2 pr-3 text-right font-bold">Raw</th>
                      <th scope="col" className="py-2 text-right font-bold">Readout-mitigated</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono text-[13px]">
                    {fitted.points.map((p) => (
                      <tr key={p.scale} className="border-b border-line">
                        <th scope="row" className="py-2 pr-3 text-left font-sans font-semibold text-ink">{p.scale}</th>
                        <td className="py-2 pr-3 text-right text-ink-secondary">{p.gateCount}</td>
                        <td className="py-2 pr-3 text-right text-ink-secondary">{fmt(p.fidelity)}</td>
                        <td className="py-2 pr-3 text-right text-q-rose-text">{fmt(p.value)}</td>
                        <td className="py-2 text-right text-q-amber-text">{pm(p.readoutMitigated, p.stderr)}</td>
                      </tr>
                    ))}
                    <tr>
                      <th scope="row" className="py-2 pr-3 text-left font-sans font-semibold text-ink">0 (extrapolated)</th>
                      <td className="py-2 pr-3 text-right text-ink-muted">—</td>
                      <td className="py-2 pr-3 text-right text-ink-muted">—</td>
                      <td className="py-2 pr-3 text-right text-ink-muted">—</td>
                      <td className="py-2 text-right text-q-violet-text">{pm(fitted.zne, fitted.zneStderr)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-[13px] text-ink-secondary">
                Calibrated readout: {fitted.calibration.qubits.map((q, i) => `q${i} P(1|0) ${(q.p1given0 * 100).toFixed(1)}%, P(0|1) ${(q.p0given1 * 100).toFixed(1)}%`).join(' · ')}.
                {p1 > 0 ? ' The |1…1⟩ calibration circuit uses the same faulty X gates, so part of the gate error is booked as readout error — the estimate of P(0|1) runs high by about 2p₁/3 per qubit, and the correction overshoots a little. Hardware has the same ambiguity.' : ''}
              </p>
            </div>
          ) : null}
        </section>

        <aside className="card p-4 sm:p-5" aria-labelledby="noise-controls">
          <h2 id="noise-controls" className="section-label mb-4">Controls</h2>
          <div className="flex flex-col gap-5">{controls}</div>
        </aside>
      </div>

      <div className="mt-10 max-w-3xl">
        <Explainer title="What to try, in this order">
          <p>
            <strong className="text-ink">Turn everything off.</strong> Zero every slider and switch T1/T2
            off. All four numbers agree with the dashed line to the last digit, and the error bars collapse:
            with no noise the trajectory engine is the ordinary statevector engine, bit for bit.
          </p>
          <p>
            <strong className="text-ink">Readout only.</strong> Leave the gate noise at zero and raise the
            two readout sliders. The raw number sinks; the readout-mitigated number comes back to the ideal
            — but its bar is wider than the raw bar. That widening is 1/(1 − P(1|0) − P(0|1)) per qubit.
          </p>
          <p>
            <strong className="text-ink">Add gate noise, then fold.</strong> Now raise the two-qubit
            depolarising. Readout mitigation stops being enough: the amber point at λ = 1 sits below the
            line, and the amber points at 3 and 5 sit lower still. The fit through them, run back to
            zero, is the ZNE estimate. Try the four fits: the exponential is exact for pure depolarising,
            the line undershoots on a curve, the parabola chases the noise, and the learned one — once
            trained — is a compromise the network found on its own.
          </p>
          <p>
            <strong className="text-ink">Change the seed.</strong> Same circuit, same noise, different dice.
            Watch the ZNE estimate wander by roughly its own error bar. If it wanders more than that, the
            bar is lying; here it should not.
          </p>
          <p>
            <strong className="text-ink">Scan depth.</strong> Repeat the block and watch fidelity fall.
            The Bell pair at depth 2 is the identity — H·CX·CX·H — and the state should be |00⟩ again,
            which it nearly is; the gap between the measured curve and the dotted product is the errors
            that cancelled or that the observable never noticed.
          </p>
        </Explainer>

        <Explainer title="What just happened">
          <p>
            Each shot is one trajectory: the circuit runs on the ordinary statevector simulator, and after
            every gate a coin is flipped — with the depolarising probability, a random Pauli is applied
            to that gate&rsquo;s qubits. A qubit that has no gate in a layer idles, and per idle step it
            may relax (|1⟩ → |0⟩, probability 1 − e^(−1/T1)) or pick up a phase flip (from T2). Then
            every qubit is read out and each classical bit flips with the readout probabilities. Averaged
            over shots this reproduces the noise channels exactly; per shot it produces the scatter a
            device produces.
          </p>
          <p>
            Readout mitigation measures |0…0⟩ and |1…1⟩ on the same noisy device, builds one 2×2 confusion
            matrix per qubit, and applies the inverse to your counts. The result is a quasi-probability —
            entries can go slightly negative — and the expectation value over it is unbiased. Zero-noise
            extrapolation replaces every gate G by G·G†·G and G·G†·G·G†·G, which changes nothing about the
            ideal unitary and triples or quintuples the noise, measures the observable at each, and fits a
            curve back to the noise level you cannot reach. Both are post-processing: the device is not
            better, your estimate of what it would have said is.
          </p>
        </Explainer>

        <Explainer title="What this tool does not do">
          <p>
            <strong className="text-ink">It does not scale.</strong> Readout inversion needs a calibration
            of 2ⁿ states in general — the two circuits here identify only the uncorrelated model — and a
            2ⁿ × 2ⁿ matrix to invert. ZNE needs the circuit at three to five times its depth to still
            return a signal; past a certain depth the folded points are pure noise and the extrapolation
            is a line through static. Neither technique turns a 100-qubit, 1,000-gate circuit into a
            reliable one. That is what error <em>correction</em> is for, and it is a different page.
          </p>
          <p>
            <strong className="text-ink">It amplifies variance.</strong> Every mitigated number on this page
            has a wider bar than the raw number it came from. Inverting readout multiplies shot noise by
            1/(1 − P(1|0) − P(0|1)) per qubit; extrapolating from λ ∈ {'{1, 3, 5}'} to 0 multiplies it by about
            1.5× for a line and far more for a parabola. Mitigation trades bias for variance, and the trade
            is paid in shots — often 10× to 100× more for the same bar.
          </p>
          <p>
            <strong className="text-ink">It only sees what folding scales.</strong> Gate folding multiplies
            gate errors. It does not stretch idle time, so T1 and T2 decay on idle qubits are not
            extrapolated away — the &ldquo;Idle |1⟩&rdquo; preset shows three identical points. It also
            assumes the noise is the same at every scale, which real crosstalk and drift violate.
          </p>
          <p>
            <strong className="text-ink">The learned extrapolator is not a physics model.</strong> It was
            trained on the exponential family with shot noise, because that is what depolarising noise
            produces. On a circuit whose noise curve is not in that family it will be confidently wrong,
            exactly like a formula fitted to the wrong shape. Its advantage is only that it has seen the
            noise at training time and learned not to chase it.
          </p>
          <p>
            <strong className="text-ink">The noise model is a model.</strong> Uniform depolarising, one T1
            and T2 for every qubit, uncorrelated readout, no crosstalk, no coherent over-rotation, no
            leakage. It is the model most mitigation papers benchmark against; it is not a device.
          </p>
        </Explainer>

        <Explainer title="Take the circuit with you">
          <p>
            The circuit being measured, as OpenQASM 3. Paste it into the simulator, or fold it yourself —
            the scale-3 version is every gate followed by its inverse and itself.
          </p>
          <pre className="overflow-x-auto rounded-lg border border-line bg-surface-2 p-3 font-mono text-[12px] leading-relaxed text-ink-secondary">
            {toQasm({ ...circuit, ops: circuit.ops.filter((o) => o.name !== 'BARRIER') })}
          </pre>
          <p>
            Checked in{' '}
            <code className="rounded bg-surface-3 px-1 py-0.5 text-[12px]">lib/quantum/noise.test.ts</code>{' '}
            (zero noise is bit-identical to the ideal engine; a depolarised X gives 1 − 2p/3; an idle |1⟩
            decays as e^(−t/T1)) and{' '}
            <code className="rounded bg-surface-3 px-1 py-0.5 text-[12px]">lib/workbench/mitigation.test.ts</code>{' '}
            (readout inversion recovers a known distribution; ZNE recovers a line&rsquo;s intercept; the
            network&rsquo;s gradients match finite differences).
          </p>
        </Explainer>
      </div>
    </div>
  )
}
