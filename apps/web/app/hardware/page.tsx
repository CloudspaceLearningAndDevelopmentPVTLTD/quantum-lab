'use client'

/**
 * /hardware — submit a circuit to a physical quantum computer.
 *
 * This page is the only route in the app that leaves simulation behind, so it
 * is written defensively in two directions at once:
 *
 *  1. The Python API is usually NOT running in local development. Every failure
 *     to reach it is presented as setup guidance naming the exact URL and the
 *     exact command, never as a broken-looking error.
 *  2. Submitting costs real money and real queue time. The cost estimate, the
 *     transpile preview and the closing note all exist to make sure nobody
 *     spends either one to learn something Aer would have said instantly.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { track } from '@/lib/analytics/track'
import { CostEstimate } from '@/components/hardware/CostEstimate'
import { DevicePicker } from '@/components/hardware/DevicePicker'
import { JobHistory } from '@/components/hardware/JobHistory'
import { ObservableEditor } from '@/components/hardware/ObservableEditor'
import { RunCompare } from '@/components/hardware/RunCompare'
import { hasMeasurements, type ObservableDraft } from '@/components/hardware/observables'
import type { ObservableSubmission } from '@/components/hardware/ObservableEditor'
import { JobMonitor } from '@/components/hardware/JobMonitor'
import { UpgradeGate } from '@/components/billing/UpgradeGate'
import { Slider } from '@/components/ui/Controls'
import {
  apiBaseUrl,
  estimate as estimateCost,
  listDevices,
  submit as submitHardwareJob,
  transpile as transpileCircuit,
} from '@/lib/hardware/client'
import type {
  CostEstimate as CostEstimateData,
  HardwareDevice,
  TranspileResult,
} from '@/lib/hardware/types'
import { PRESETS, toQasm, type Circuit } from '@/lib/quantum'
import { decodeCircuit } from '@/lib/share-link'

const JOBS_KEY = 'quantum-lab.hw-jobs'
const MAX_STORED_JOBS = 20
/** Dragging the shots slider must not fire one estimate request per pixel. */
const ESTIMATE_DEBOUNCE_MS = 400
/**
 * Mirrors `MAX_SHOTS` in `lib/hardware/proxy.ts`, which mirrors `max_shots` in
 * `services/api/app/core/config.py` — the actual enforced per-job cap. The
 * slider used to stop at 4,096 with nothing behind that number; that was a UI
 * ceiling below the real limit, not a second, lower limit, so it is raised to
 * match rather than the backend being brought down to it. `lib/hardware/proxy.ts`
 * is server-only (reads a secret out of `process.env`) and cannot be imported
 * from this client component, so the value is restated here — see
 * `app/pricing/faq.ts` for the same constraint on the FAQ copy.
 */
const MAX_SHOTS = 20_000

interface StoredJob {
  job_id: string
  provider: string
  backend: string
  shots: number
  submitted_at: string
}

type DevicesState =
  | { kind: 'loading' }
  | { kind: 'ready'; devices: HardwareDevice[] }
  | { kind: 'offline'; message: string }
  | { kind: 'failed'; message: string }

function readStoredJobs(): StoredJob[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(JOBS_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((entry): entry is StoredJob => {
      if (!entry || typeof entry !== 'object') return false
      const job = entry as Partial<StoredJob>
      return typeof job.job_id === 'string' && typeof job.provider === 'string'
    })
  } catch {
    return []
  }
}

function writeStoredJobs(jobs: StoredJob[]): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(JOBS_KEY, JSON.stringify(jobs.slice(0, MAX_STORED_JOBS)))
  } catch {
    // A full or disabled localStorage must never break a submission.
  }
}

/** Read ?c= without touching window during SSR. */
function circuitFromUrl(): Circuit | null {
  if (typeof window === 'undefined') return null
  try {
    const token = new URLSearchParams(window.location.search).get('c')
    return token ? decodeCircuit(token) : null
  } catch {
    return null
  }
}

function gateCountTotal(counts: Record<string, number>): number {
  return Object.values(counts).reduce((acc, n) => acc + n, 0)
}

export default function HardwarePage() {
  const [presetId, setPresetId] = useState<string>(PRESETS[0]?.id ?? '')
  const [sharedCircuit, setSharedCircuit] = useState<Circuit | null>(null)
  const [usingShared, setUsingShared] = useState(false)

  const [devicesState, setDevicesState] = useState<DevicesState>({ kind: 'loading' })
  const [backend, setBackend] = useState('')
  const [shots, setShots] = useState(1024)
  /**
   * The Qiskit preset pass-manager level, shared by the transpile PREVIEW and
   * the SUBMISSION.
   *
   * One piece of state on purpose. The preview used to be hardcoded to 1 here
   * and the submission hardcoded to 1 upstream; they agreed only because both
   * numbers happened to be the same literal, and nothing tied them together.
   * Level 3 routinely removes a third of the two-qubit gates on a device
   * coupling map, which on hardware is the difference between a readable
   * histogram and noise — so it is worth exposing, and the moment it is
   * exposed the two numbers must be the same number.
   */
  const [optimizationLevel, setOptimizationLevel] = useState(1)
  /**
   * Idle-time dynamical decoupling. IBM only; other providers ignore it rather
   * than refusing, so the control does not need to disappear when the target
   * changes. Free — it rewrites the pulse schedule and does not add shots.
   */
  const [dynamicalDecoupling, setDynamicalDecoupling] = useState(false)
  /**
   * Readout twirling. Also free, and also IBM-only: the same shot budget is
   * split across Pauli randomisations rather than added to.
   *
   * Both of these are error SUPPRESSION, not mitigation — they change how the
   * circuit runs rather than post-processing the result — which is why neither
   * is on by default: a run has to be reproducible by default, and the user
   * comparing two runs has to be the one who decided they differ.
   */
  const [measurementTwirling, setMeasurementTwirling] = useState(false)
  /**
   * Observable drafts. Empty means SAMPLE — the histogram path this page has
   * always had. Adding one switches the submission to the Estimator, which
   * measures ⟨ψ|H|ψ⟩ instead and is what every variational algorithm needs.
   *
   * The drafts live here rather than inside the editor so that submission can
   * read them, and so switching preset does not silently discard work.
   */
  const [observables, setObservables] = useState<ObservableDraft[]>([])
  /**
   * The editor's own verdict on those drafts. The submit button binds to
   * `ready` rather than re-validating here — one validator, in
   * components/hardware/observables.ts, which mirrors the server's.
   */
  const [observableState, setObservableState] = useState<ObservableSubmission>({
    mode: 'sampler',
    ready: true,
    observables: null,
  })

  const [estimate, setEstimate] = useState<CostEstimateData | null>(null)
  const [estimateLoading, setEstimateLoading] = useState(false)
  const [estimateError, setEstimateError] = useState<string | null>(null)

  const [showTranspile, setShowTranspile] = useState(false)
  const [transpiled, setTranspiled] = useState<TranspileResult | null>(null)
  const [transpileError, setTranspileError] = useState<string | null>(null)
  const [transpileLoading, setTranspileLoading] = useState(false)

  const [jobs, setJobs] = useState<StoredJob[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // Client-only reads, after mount, so server and first client render agree.
  useEffect(() => {
    const shared = circuitFromUrl()
    if (shared) {
      setSharedCircuit(shared)
      setUsingShared(true)
    }
    setJobs(readStoredJobs())
  }, [])

  const circuit = useMemo<Circuit | null>(() => {
    if (usingShared && sharedCircuit) return sharedCircuit
    return PRESETS.find((preset) => preset.id === presetId)?.circuit ?? null
  }, [usingShared, sharedCircuit, presetId])

  const qasm = useMemo(() => (circuit ? toQasm(circuit) : ''), [circuit])

  useEffect(() => {
    let cancelled = false
    void listDevices().then((result) => {
      if (cancelled) return
      if (result.ok) {
        setDevicesState({ kind: 'ready', devices: result.data })
        const firstAvailable = result.data.find((device) => device.available)
        setBackend((current) => current || firstAvailable?.id || result.data[0]?.id || '')
      } else if (result.offline) {
        setDevicesState({ kind: 'offline', message: result.error })
      } else {
        setDevicesState({ kind: 'failed', message: result.error })
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Debounced cost estimate. The timer is keyed on backend+shots+circuit so a
  // slider drag collapses into a single request once the user settles.
  useEffect(() => {
    if (!backend || !qasm) {
      setEstimate(null)
      setEstimateError(null)
      setEstimateLoading(false)
      return
    }
    if (devicesState.kind === 'offline') {
      setEstimateLoading(false)
      return
    }

    let cancelled = false
    setEstimateLoading(true)
    const timer = window.setTimeout(() => {
      void estimateCost(backend, shots, qasm).then((result) => {
        if (cancelled) return
        setEstimateLoading(false)
        if (result.ok) {
          setEstimate(result.data)
          setEstimateError(null)
        } else {
          setEstimate(null)
          setEstimateError(
            result.offline
              ? `Cannot price this: the API at ${apiBaseUrl()} is not reachable.`
              : result.error,
          )
        }
      })
    }, ESTIMATE_DEBOUNCE_MS)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
      setEstimateLoading(false)
    }
  }, [backend, shots, qasm, devicesState.kind])

  const loadTranspile = useCallback(async () => {
    if (!backend || !qasm) return
    setTranspileLoading(true)
    setTranspileError(null)
    const result = await transpileCircuit(qasm, backend, optimizationLevel)
    setTranspileLoading(false)
    if (result.ok) {
      setTranspiled(result.data)
    } else {
      setTranspiled(null)
      setTranspileError(
        result.offline
          ? `The API at ${apiBaseUrl()} is not reachable, so the circuit cannot be transpiled here.`
          : result.error,
      )
    }
  }, [backend, qasm, optimizationLevel])

  const toggleTranspile = useCallback(() => {
    setShowTranspile((open) => {
      if (!open) void loadTranspile()
      return !open
    })
  }, [loadTranspile])

  // Re-run an open disclosure when the target or circuit changes underneath it.
  const transpileKey = `${backend}|${qasm}|${optimizationLevel}`
  const lastTranspileKey = useRef('')
  useEffect(() => {
    if (!showTranspile) return
    if (lastTranspileKey.current === transpileKey) return
    lastTranspileKey.current = transpileKey
    void loadTranspile()
  }, [showTranspile, transpileKey, loadTranspile])

  const onSubmit = useCallback(async () => {
    if (!backend || !qasm) return
    setSubmitting(true)
    setSubmitError(null)
    const result = await submitHardwareJob(qasm, backend, shots, {
      optimizationLevel,
      dynamicalDecoupling,
      measurementTwirling,
      // Omitted entirely in sampler mode: the server's test is "are there
      // observables", so sending an empty array would select the Estimator
      // and then be refused for having nothing to measure.
      ...(observableState.mode === 'estimator' && observableState.observables
        ? { observables: observableState.observables }
        : {}),
    })
    setSubmitting(false)
    if (!result.ok) {
      setSubmitError(
        result.offline
          ? `Nothing was submitted: the API at ${apiBaseUrl()} is not reachable.`
          : result.error,
      )
      return
    }
    // Only a genuinely accepted submission counts — a failed one is not a
    // hardware run, and inflating this number would misprice the whole feature.
    track('hardware.submitted', {
      provider: result.data.provider,
      backend: result.data.backend,
      shots: result.data.shots,
    })

    const entry: StoredJob = {
      job_id: result.data.job_id,
      provider: result.data.provider,
      backend: result.data.backend,
      shots: result.data.shots,
      submitted_at: result.data.submitted_at,
    }
    setJobs((current) => {
      const next = [entry, ...current.filter((job) => job.job_id !== entry.job_id)].slice(
        0,
        MAX_STORED_JOBS,
      )
      writeStoredJobs(next)
      return next
    })
  }, [
    backend,
    qasm,
    shots,
    optimizationLevel,
    dynamicalDecoupling,
    measurementTwirling,
    observableState,
  ])

  const forgetJob = useCallback((jobId: string) => {
    setJobs((current) => {
      const next = current.filter((job) => job.job_id !== jobId)
      writeStoredJobs(next)
      return next
    })
  }, [])

  const selectedDevice =
    devicesState.kind === 'ready'
      ? devicesState.devices.find((device) => device.id === backend) ?? null
      : null

  return (
    <div className="mx-auto max-w-5xl px-5 py-10">
      <header>
        <p className="section-label">Hardware</p>
        <h1 className="section-title mt-1.5">Run on a real quantum computer</h1>
        <p className="section-desc mt-2 max-w-2xl">
          This leaves the simulator behind. Your circuit is transpiled into a device&apos;s native
          gate set and executed on physical qubits — superconducting transmon circuits or trapped ions — with a
          shared queue in front of it and real noise inside it. The results will not be as clean as
          Aer&apos;s, and that is the entire point.
        </p>
      </header>

      <UpgradeGate feature="hardware.real" mode="overlay">
        <div className="mt-8 space-y-8">
          <section>
            <h2 className="text-sm font-bold text-ink">1 · Circuit</h2>
            {sharedCircuit ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setUsingShared(true)}
                  aria-pressed={usingShared}
                  className={usingShared ? 'btn-primary focus-ring' : 'btn-ghost focus-ring'}
                >
                  From your share link
                </button>
                <button
                  type="button"
                  onClick={() => setUsingShared(false)}
                  aria-pressed={!usingShared}
                  className={!usingShared ? 'btn-primary focus-ring' : 'btn-ghost focus-ring'}
                >
                  Use a preset
                </button>
              </div>
            ) : null}

            {!usingShared ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => setPresetId(preset.id)}
                    aria-pressed={preset.id === presetId}
                    className={`focus-ring rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                      preset.id === presetId
                        ? 'border-q-violet bg-surface-3 text-ink'
                        : 'border-line bg-surface-2 text-ink-secondary hover:text-ink'
                    }`}
                  >
                    {preset.name}
                  </button>
                ))}
              </div>
            ) : null}

            {qasm ? (
              <pre className="code-block mt-3">{qasm}</pre>
            ) : (
              <p className="mt-3 text-sm text-ink-secondary">Pick a circuit to continue.</p>
            )}
          </section>

          <section>
            <h2 className="text-sm font-bold text-ink">2 · Device</h2>

            {devicesState.kind === 'loading' ? (
              <div className="card mt-3 p-5 text-sm text-ink-secondary" aria-busy="true">
                Looking for devices at {apiBaseUrl()}…
              </div>
            ) : null}

            {devicesState.kind === 'offline' ? (
              <div className="card mt-3 p-5">
                <p className="text-sm font-bold text-ink">The quantum API is not running</p>
                <p className="mt-1.5 text-[13px] leading-relaxed text-ink-secondary">
                  Nothing answered at <span className="font-mono text-q-violet-text">{apiBaseUrl()}</span>.
                  This is the expected state unless you have opted into running the Python service
                  locally — the rest of Qubit16 simulates in your browser and needs no backend.
                </p>
                <pre className="code-block mt-3">{`cd services/api\nuvicorn app.main:app --port 8000`}</pre>
                <p className="mt-2.5 text-[12px] leading-relaxed text-ink-muted">
                  Point the app somewhere else with{' '}
                  <span className="font-mono">NEXT_PUBLIC_API_URL</span>. Even with the API up, real
                  devices stay unavailable until provider credentials
                  (<span className="font-mono">IBM_QUANTUM_TOKEN</span>, AWS keys) are configured —
                  the device list will say exactly which one is missing.
                </p>
              </div>
            ) : null}

            {devicesState.kind === 'failed' ? (
              <div className="card mt-3 p-5">
                <p className="text-sm font-bold text-ink">The API rejected the device request</p>
                <p className="mt-1.5 text-[13px] leading-relaxed text-q-rose-text">
                  {devicesState.message}
                </p>
              </div>
            ) : null}

            {devicesState.kind === 'ready' ? (
              <div className="mt-3">
                <DevicePicker
                  devices={devicesState.devices}
                  value={backend}
                  onChange={setBackend}
                />
              </div>
            ) : null}
          </section>

          <section>
            <h2 className="text-sm font-bold text-ink">3 · Shots and cost</h2>
            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="card p-4">
                <Slider
                  label="Shots"
                  value={shots}
                  min={100}
                  max={MAX_SHOTS}
                  step={1}
                  onChange={(value) => setShots(Math.round(value))}
                  format={(value) => Math.round(value).toLocaleString('en-US')}
                  hint="Each shot is one full preparation and measurement on the device."
                />
                {selectedDevice ? (
                  <p className="mt-3 text-[12px] leading-relaxed text-ink-secondary">
                    Targeting <span className="font-mono text-q-violet-text">{selectedDevice.name}</span>{' '}
                    · {selectedDevice.qubits} qubits · {selectedDevice.technology}
                  </p>
                ) : null}

                <fieldset className="mt-4 border-t border-hairline pt-4">
                  <legend className="sr-only">Compilation</legend>
                  <label
                    htmlFor="hw-optimization-level"
                    className="block text-[13px] font-semibold text-ink"
                  >
                    Optimisation level
                  </label>
                  <select
                    id="hw-optimization-level"
                    value={optimizationLevel}
                    onChange={(event) => setOptimizationLevel(Number(event.target.value))}
                    className="focus-ring mt-2 w-full rounded-lg border border-hairline bg-surface px-3 py-2 text-[13px] text-ink"
                    aria-describedby="hw-optimization-hint"
                  >
                    <option value={0}>0 — no optimisation, layout only</option>
                    <option value={1}>1 — light (default)</option>
                    <option value={2}>2 — medium, heavier routing search</option>
                    <option value={3}>3 — heavy, best two-qubit reduction</option>
                  </select>
                  <p
                    id="hw-optimization-hint"
                    className="mt-2 text-[12px] leading-relaxed text-ink-secondary"
                  >
                    Two-qubit gates dominate the error on every device here, so this is the
                    one setting that changes how much of your result survives. Level 3 costs
                    compile time, not shots and not money. The preview below and the circuit
                    that is actually submitted both use this level.
                  </p>

                  <label className="mt-4 flex items-start gap-2 text-[13px] text-ink">
                    <input
                      type="checkbox"
                      checked={dynamicalDecoupling}
                      onChange={(event) => setDynamicalDecoupling(event.target.checked)}
                      className="focus-ring mt-0.5"
                      aria-describedby="hw-dd-hint"
                    />
                    <span className="font-semibold">Dynamical decoupling</span>
                  </label>
                  <p id="hw-dd-hint" className="mt-1 text-[12px] leading-relaxed text-ink-secondary">
                    Fills idle qubit time with an XY4 echo sequence so a qubit waiting its turn
                    dephases less. Free — it changes the pulse schedule, not the shot count.
                    IBM devices only; other providers ignore it.
                  </p>

                  <label className="mt-4 flex items-start gap-2 text-[13px] text-ink">
                    <input
                      type="checkbox"
                      checked={measurementTwirling}
                      onChange={(event) => setMeasurementTwirling(event.target.checked)}
                      className="focus-ring mt-0.5"
                      aria-describedby="hw-twirl-hint"
                    />
                    <span className="font-semibold">Readout twirling</span>
                  </label>
                  <p
                    id="hw-twirl-hint"
                    className="mt-1 text-[12px] leading-relaxed text-ink-secondary"
                  >
                    Randomises a Pauli frame around each measurement and undoes it classically.
                    A device that mistakes 1 for 0 more often than the reverse shifts your whole
                    histogram in one direction; this turns that systematic shift into ordinary
                    variance. Also free — your shots are split across randomisations, not added
                    to. IBM devices only.
                  </p>
                </fieldset>
              </div>

              <div>
                <CostEstimate estimate={estimate} shots={shots} loading={estimateLoading} />
                {estimateError ? (
                  <p className="mt-2 text-[12px] leading-relaxed text-q-amber-text">{estimateError}</p>
                ) : null}
              </div>
            </div>
          </section>

          <section>
            <button
              type="button"
              onClick={toggleTranspile}
              aria-expanded={showTranspile}
              className="btn-ghost focus-ring"
            >
              {showTranspile ? 'Hide' : 'Show'} what the hardware actually runs
            </button>

            {showTranspile ? (
              <div className="card mt-3 p-5">
                {transpileLoading ? (
                  <p className="text-sm text-ink-secondary" aria-busy="true">
                    Transpiling for {backend || 'the selected device'}…
                  </p>
                ) : null}

                {transpileError ? (
                  <p className="text-[13px] leading-relaxed text-q-amber-text">{transpileError}</p>
                ) : null}

                {transpiled && !transpileLoading ? (
                  <div>
                    <p className="text-[13px] leading-relaxed text-ink-secondary">
                      A device has no idea what a Hadamard is. Everything you wrote is rewritten
                      into its native basis (
                      <span className="font-mono text-q-violet-text">
                        {transpiled.basis_gates.join(', ')}
                      </span>
                      ), and the circuit gets longer — that extra depth is extra time for the qubits
                      to decohere.
                    </p>

                    <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="rounded-lg border border-line bg-surface-2 p-3">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-ink-muted">
                          What you wrote
                        </div>
                        <dl className="mt-2 space-y-1 text-[12px]">
                          <div className="flex justify-between">
                            <dt className="text-ink-secondary">Depth</dt>
                            <dd className="font-mono text-ink">{transpiled.depth_before}</dd>
                          </div>
                          <div className="flex justify-between">
                            <dt className="text-ink-secondary">Gates</dt>
                            <dd className="font-mono text-ink">
                              {gateCountTotal(transpiled.gate_counts_before)}
                            </dd>
                          </div>
                          <div className="flex justify-between">
                            <dt className="text-ink-secondary">Two-qubit gates</dt>
                            <dd className="font-mono text-ink">
                              {transpiled.two_qubit_gates_before}
                            </dd>
                          </div>
                        </dl>
                        <p className="mt-2 font-mono text-[11px] text-ink-muted">
                          {Object.entries(transpiled.gate_counts_before)
                            .map(([gate, n]) => `${gate}×${n}`)
                            .join('  ')}
                        </p>
                      </div>

                      <div className="rounded-lg border border-line bg-surface-2 p-3">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-q-amber-text">
                          What the device runs
                        </div>
                        <dl className="mt-2 space-y-1 text-[12px]">
                          <div className="flex justify-between">
                            <dt className="text-ink-secondary">Depth</dt>
                            <dd className="font-mono text-ink">{transpiled.depth_after}</dd>
                          </div>
                          <div className="flex justify-between">
                            <dt className="text-ink-secondary">Gates</dt>
                            <dd className="font-mono text-ink">
                              {gateCountTotal(transpiled.gate_counts_after)}
                            </dd>
                          </div>
                          <div className="flex justify-between">
                            <dt className="text-ink-secondary">Two-qubit gates</dt>
                            <dd className="font-mono text-ink">
                              {transpiled.two_qubit_gates_after}
                            </dd>
                          </div>
                        </dl>
                        <p className="mt-2 font-mono text-[11px] text-ink-muted">
                          {Object.entries(transpiled.gate_counts_after)
                            .map(([gate, n]) => `${gate}×${n}`)
                            .join('  ')}
                        </p>
                      </div>
                    </div>

                    {transpiled.notes ? (
                      <p className="mt-3 text-[12px] leading-relaxed text-ink-muted">
                        {transpiled.notes}
                      </p>
                    ) : null}

                    <pre className="code-block mt-3 max-h-64 overflow-y-auto">
                      {transpiled.qasm}
                    </pre>
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>

          <section aria-labelledby="hw-measure-heading">
            <h2 id="hw-measure-heading" className="text-sm font-bold text-ink">
              4 · What to measure
            </h2>
            <p className="mt-1 text-[12px] leading-relaxed text-ink-secondary">
              By default the device returns a histogram of bitstrings — the sampler. Add an
              observable instead and it measures ⟨ψ|H|ψ⟩ for each one, which is what VQE, QAOA
              and most of quantum chemistry actually need.
            </p>
            <div className="card mt-3 p-4">
              <ObservableEditor
                numQubits={circuit?.numQubits ?? 0}
                value={observables}
                onChange={setObservables}
                onValidChange={setObservableState}
                circuitHasMeasurements={hasMeasurements(qasm)}
                disabled={submitting}
              />
            </div>
          </section>

          <section>
            <h2 className="text-sm font-bold text-ink">5 · Submit</h2>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void onSubmit()}
                disabled={
                  submitting ||
                  !backend ||
                  !qasm ||
                  !selectedDevice?.available ||
                  // Bound to the editor's own verdict rather than re-validated
                  // here: one validator, mirroring the server's.
                  !observableState.ready
                }
                className="btn-primary focus-ring disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? 'Submitting…' : 'Submit job'}
              </button>
              {selectedDevice && !selectedDevice.available ? (
                <span className="text-[12px] text-ink-muted">
                  {selectedDevice.name} is not configured on this server yet.
                </span>
              ) : null}
            </div>

            {submitError ? (
              <p className="mt-3 text-[13px] leading-relaxed text-q-rose-text">{submitError}</p>
            ) : null}

            {jobs.length > 0 ? (
              <div className="mt-4 space-y-3">
                {jobs.map((job) => (
                  <div key={job.job_id}>
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="text-[11px] uppercase tracking-wider text-ink-muted">
                        {job.backend} · {job.shots.toLocaleString('en-US')} shots
                      </span>
                      <button
                        type="button"
                        onClick={() => forgetJob(job.job_id)}
                        className="focus-ring text-[11px] text-ink-muted hover:text-ink-secondary"
                      >
                        Remove from this list
                      </button>
                    </div>
                    <JobMonitor provider={job.provider} jobId={job.job_id} />
                  </div>
                ))}
              </div>
            ) : null}
          </section>

          {/*
            The archive, below the live monitors above it. The monitors show
            jobs submitted in THIS tab; this panel shows every job this account
            has ever submitted, on any device, with the counts that came back —
            which until it existed were fetched from the vendor, drawn, and
            dropped.
          */}
          <JobHistory />

          {/*
            The archive answers "what did I run"; this answers "how do these two
            differ", which is the question a hardware engineer actually has. It
            fetches the same history itself — see its header for why it is not
            handed JobHistory's list.
          */}
          <RunCompare />
        </div>
      </UpgradeGate>

      <p className="mt-10 max-w-2xl text-[13px] leading-relaxed text-ink-muted">
        One last thing before you spend anything: a local simulation is instant, free and exact. If
        you want to know what a Bell state&apos;s distribution looks like, Aer will tell you in
        milliseconds. Come here when the question is specifically about the machine — how much
        decoherence eats your fidelity, what a native gate set does to your depth, how long a real
        queue actually is. Reproducing textbook results on a QPU costs money and teaches you
        nothing the simulator would not have.
      </p>
    </div>
  )
}
