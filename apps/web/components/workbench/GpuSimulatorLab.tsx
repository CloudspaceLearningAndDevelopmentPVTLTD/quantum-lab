'use client'

/**
 * GpuSimulatorLab — run one circuit on the CPU (float64, lib/quantum.ts's
 * kernels) and on the GPU (float32, WGSL compute via WebGPU), side by side.
 *
 * Props: none. The component owns both backends: the GPU one is created once
 * on mount through createBackend() and disposed on unmount; a CpuBackend is
 * created per run. Every number on screen comes from lib/quantum/webgpu/
 * runner.ts (timeCircuit, probeCapacity), which is what the tests cover —
 * this file is layout and state.
 *
 * Two actions:
 *   Run both        the chosen circuit at the chosen N on each backend, with
 *                   the full statevector read back (N ≤ COMPARE_MAX_QUBITS) to
 *                   report the largest float32-vs-float64 amplitude gap.
 *   Probe capacity  walk N upward on each backend until a rung breaks the
 *                   stated memory/time budget; report the largest N reached.
 *
 * The CPU path runs on the main thread and blocks it for the duration of a
 * rung; the lab yields to the browser between rungs so the progress line
 * paints, and says so in the copy. Stop takes effect at the next rung.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Segmented, ButtonRow, Stat, Slider } from '@/components/ui/Controls'
import { Explainer } from '@/components/ui/VizFrame'
import { formatKet } from '@/lib/quantum'
import { CpuBackend, statevectorBytes, type StatevectorBackend } from '@/lib/quantum/backend'
import { createBackend, detectWebGpu } from '@/lib/quantum/webgpu'
import type { WebGpuInfo } from '@/lib/quantum/webgpu/WebGpuBackend'
import {
  BENCHMARK_LABELS,
  DEFAULT_BUDGET,
  benchmarkCircuit,
  fmtBytes,
  fmtMs,
  type BenchmarkKind,
} from '@/lib/quantum/webgpu/benchmarks'
import { maxAmplitudeDeviation } from '@/lib/quantum/webgpu/reference'
import { probeCapacity, timeCircuit, type ProbeReport, type ProbeRung, type RunReport } from '@/lib/quantum/webgpu/runner'

/** Above this the readback (2^N × 24 bytes for both copies) stops being a quick comparison. */
export const COMPARE_MAX_QUBITS = 20
/** Slider ceiling for "Run both". A depth-20 random circuit at 22 qubits is ~10 s on a laptop CPU. */
export const RUN_MAX_QUBITS = 22
const RUN_MIN_QUBITS = 2
const TOP_K = 6

const KIND_OPTIONS: { value: BenchmarkKind; label: string }[] = (
  ['random', 'qft', 'ghz'] as BenchmarkKind[]
).map((value) => ({ value, label: BENCHMARK_LABELS[value] }))

type GpuStatus =
  | { state: 'checking' }
  | { state: 'ready'; info: WebGpuInfo | null; maxQubits: number }
  | { state: 'fallback'; reason: string }

type Phase = 'idle' | 'running' | 'probing'

const yieldToBrowser = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

function describeGpu(info: WebGpuInfo | null): string {
  if (!info) return 'adapter'
  const parts = [info.vendor, info.architecture, info.device, info.description].filter(Boolean)
  return parts.length ? parts.join(' · ') : 'adapter'
}

export default function GpuSimulatorLab() {
  const gpuRef = useRef<StatevectorBackend | null>(null)
  const stopRef = useRef(false)
  const [gpu, setGpu] = useState<GpuStatus>({ state: 'checking' })
  const [kind, setKind] = useState<BenchmarkKind>('random')
  const [numQubits, setNumQubits] = useState(12)
  const [phase, setPhase] = useState<Phase>('idle')
  const [progress, setProgress] = useState<string>('')
  const [cpuRun, setCpuRun] = useState<RunReport | null>(null)
  const [gpuRun, setGpuRun] = useState<RunReport | null>(null)
  const [deviation, setDeviation] = useState<number | null>(null)
  const [cpuProbe, setCpuProbe] = useState<ProbeReport | null>(null)
  const [gpuProbe, setGpuProbe] = useState<ProbeReport | null>(null)
  const [liveRungs, setLiveRungs] = useState<{ cpu: ProbeRung[]; gpu: ProbeRung[] }>({ cpu: [], gpu: [] })
  const [error, setError] = useState<string | null>(null)

  // One GPU device for the life of the component.
  useEffect(() => {
    let cancelled = false
    const support = detectWebGpu()
    if (!support.available) {
      setGpu({ state: 'fallback', reason: support.reason })
      return
    }
    createBackend({ prefer: 'webgpu' }).then((sel) => {
      if (cancelled) {
        sel.backend.dispose()
        return
      }
      if (sel.backend.kind === 'webgpu') {
        gpuRef.current = sel.backend
        const info = (sel.backend as StatevectorBackend & { info?: WebGpuInfo }).info ?? null
        setGpu({ state: 'ready', info, maxQubits: sel.backend.maxQubits })
      } else {
        sel.backend.dispose()
        setGpu({ state: 'fallback', reason: sel.fallbackReason ?? 'the GPU backend could not be created' })
      }
    })
    return () => {
      cancelled = true
      gpuRef.current?.dispose()
      gpuRef.current = null
    }
  }, [])

  const gpuReady = gpu.state === 'ready' && gpuRef.current !== null
  const runMax = Math.min(RUN_MAX_QUBITS, gpu.state === 'ready' ? gpu.maxQubits : RUN_MAX_QUBITS)
  const n = Math.max(RUN_MIN_QUBITS, Math.min(numQubits, runMax))
  const gateCount = useMemo(() => benchmarkCircuit(kind, n).ops.length, [kind, n])

  const runBoth = useCallback(async () => {
    if (phase !== 'idle') return
    setPhase('running')
    setError(null)
    setDeviation(null)
    setCpuRun(null)
    setGpuRun(null)
    stopRef.current = false
    const circuit = benchmarkCircuit(kind, n)
    const compare = n <= COMPARE_MAX_QUBITS
    try {
      let gpuReport: RunReport | null = null
      const g = gpuRef.current
      if (g) {
        setProgress(`GPU: ${circuit.ops.length} gates on ${n} qubits…`)
        await yieldToBrowser()
        gpuReport = await timeCircuit(g, circuit, { topK: TOP_K, readAmplitudes: compare })
        setGpuRun(gpuReport)
      }
      setProgress(`CPU: ${circuit.ops.length} gates on ${n} qubits — the tab is busy until this finishes…`)
      await yieldToBrowser()
      const cpu = new CpuBackend()
      const cpuReport = await timeCircuit(cpu, circuit, { topK: TOP_K, readAmplitudes: compare })
      cpu.dispose()
      setCpuRun(cpuReport)
      if (gpuReport?.amplitudes && cpuReport.amplitudes) {
        setDeviation(maxAmplitudeDeviation(gpuReport.amplitudes, cpuReport.amplitudes))
      }
      setProgress('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setProgress('')
    } finally {
      setPhase('idle')
    }
  }, [kind, n, phase])

  const probe = useCallback(async () => {
    if (phase !== 'idle') return
    setPhase('probing')
    setError(null)
    setCpuProbe(null)
    setGpuProbe(null)
    setLiveRungs({ cpu: [], gpu: [] })
    stopRef.current = false
    const common = {
      budget: DEFAULT_BUDGET,
      startQubits: 8,
      shouldStop: () => stopRef.current,
      yieldBetween: yieldToBrowser,
    }
    try {
      const g = gpuRef.current
      if (g) {
        setProgress('Probing the GPU…')
        await yieldToBrowser()
        const report = await probeCapacity(g, kind, {
          ...common,
          onRung: (r) => {
            setLiveRungs((prev) => ({ ...prev, gpu: [...prev.gpu, r] }))
            setProgress(`GPU: ${r.numQubits} qubits in ${fmtMs(r.wallMs)}`)
          },
        })
        setGpuProbe(report)
      }
      if (!stopRef.current) {
        setProgress('Probing the CPU — each rung blocks the tab while it runs…')
        await yieldToBrowser()
        const cpu = new CpuBackend()
        const report = await probeCapacity(cpu, kind, {
          ...common,
          onRung: (r) => {
            setLiveRungs((prev) => ({ ...prev, cpu: [...prev.cpu, r] }))
            setProgress(`CPU: ${r.numQubits} qubits in ${fmtMs(r.wallMs)}`)
          },
        })
        cpu.dispose()
        setCpuProbe(report)
      }
      setProgress('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setProgress('')
    } finally {
      setPhase('idle')
    }
  }, [kind, phase])

  const busy = phase !== 'idle'
  const speedup = cpuRun && gpuRun && gpuRun.wallMs > 0 ? cpuRun.wallMs / gpuRun.wallMs : null

  const controls = (
    <>
      <Segmented<BenchmarkKind> label="Circuit" value={kind} options={KIND_OPTIONS} onChange={setKind} />
      <Slider
        label="Qubits"
        value={n}
        min={RUN_MIN_QUBITS}
        max={runMax}
        step={1}
        onChange={(v) => setNumQubits(Math.round(v))}
        format={(v) => `N = ${Math.round(v)} · 2^${Math.round(v)} amplitudes`}
        hint={
          n >= 18
            ? `At N = ${n} the CPU run is roughly ${fmtMs(0.00004 * gateCount * 2 ** (n - 1))} and blocks this tab while it runs.`
            : 'For "Run both". The probe picks its own sizes.'
        }
      />
      <ButtonRow>
        <button type="button" className="btn-primary focus-ring" onClick={runBoth} disabled={busy || gpu.state === 'checking'}>
          Run both
        </button>
        <button type="button" className="btn-ghost focus-ring" onClick={probe} disabled={busy || gpu.state === 'checking'}>
          Probe capacity
        </button>
        <button
          type="button"
          className="btn-ghost focus-ring"
          onClick={() => { stopRef.current = true }}
          disabled={phase !== 'probing'}
        >
          Stop
        </button>
      </ButtonRow>
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Gates" value={gateCount.toLocaleString('en-US')} accent="violet" />
        <Stat label="GPU float32" value={fmtBytes(statevectorBytes(n, 'float32'))} accent="rose" />
        <Stat label="CPU float64" value={fmtBytes(statevectorBytes(n, 'float64'))} accent="sky" />
        <Stat label="Budget" value={`${fmtBytes(DEFAULT_BUDGET.memoryBytes)} · ${fmtMs(DEFAULT_BUDGET.timeMs)}`} accent="amber" />
      </div>
    </>
  )

  return (
    <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
      <section className="flex flex-col gap-4" aria-labelledby="gpu-sim-results">
        <h2 id="gpu-sim-results" className="sr-only">Results</h2>

        <div className="card p-4 sm:p-5" role="status" aria-live="polite">
          <p className="section-label">This machine</p>
          {gpu.state === 'checking' ? (
            <p className="mt-1 text-sm text-ink-secondary">Asking the browser for a WebGPU adapter…</p>
          ) : gpu.state === 'ready' ? (
            <p className="mt-1 text-sm text-ink-secondary">
              <strong className="text-q-rose-text">WebGPU ready</strong> — {describeGpu(gpu.info)}. This GPU binds
              at most 2^{gpu.maxQubits} amplitudes{gpu.info ? ` (${fmtBytes(gpu.info.maxStorageBufferBindingSize)})` : ''}.
            </p>
          ) : (
            <p className="mt-1 text-sm text-ink-secondary">
              <strong className="text-q-amber-text">No GPU backend</strong> — {gpu.reason}. Everything below runs on the CPU
              path only; the GPU column stays empty rather than showing made-up numbers.
            </p>
          )}
          {progress ? <p className="mt-2 font-mono text-xs text-q-violet-text">{progress}</p> : null}
          {error ? <p className="mt-2 text-sm text-q-rose-text">{error}</p> : null}
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <RunCard title="CPU · float64" accent="sky" report={cpuRun} probe={cpuProbe} available />
          <RunCard title="GPU · float32" accent="rose" report={gpuRun} probe={gpuProbe} available={gpuReady} />
        </div>

        {cpuRun || gpuRun ? (
          <div className="card p-4 sm:p-5">
            <p className="section-label">What just happened</p>
            <p className="mt-1 text-sm text-ink-secondary">
              {BENCHMARK_LABELS[kind]} on {n} qubits: {cpuRun ? `${cpuRun.gates} gates fused into ${cpuRun.dispatches} passes` : ''}
              {cpuRun && gpuRun ? '; ' : ''}
              {cpuRun ? `CPU ${fmtMs(cpuRun.wallMs)}` : ''}
              {gpuRun ? `${cpuRun ? ', ' : ''}GPU ${fmtMs(gpuRun.wallMs)}` : ''}
              {speedup !== null ? ` — ${speedup >= 1 ? `${speedup.toFixed(1)}× faster on the GPU` : `${(1 / speedup).toFixed(1)}× faster on the CPU`}` : ''}.
              {speedup !== null && speedup < 1
                ? ' Small states lose to the fixed cost of a dispatch and a readback; move the slider up and watch it flip.'
                : ''}
            </p>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
              <Stat
                label="Max |Δ amplitude|"
                value={deviation === null ? (n > COMPARE_MAX_QUBITS ? `skipped > ${COMPARE_MAX_QUBITS} q` : gpuReady ? '—' : 'no GPU') : deviation.toExponential(2)}
                accent="amber"
              />
              <Stat label="float32 ulp at 1" value="1.19e-7" accent="rose" />
              <Stat label="float64 ulp at 1" value="2.22e-16" accent="sky" />
            </div>
            {deviation !== null ? (
              <p className="mt-2 text-xs text-ink-muted">
                The largest difference between any GPU amplitude and its CPU twin, real or imaginary part. It grows with
                gate count, roughly √(gates) × 10⁻⁷, because each float32 multiply rounds once.
              </p>
            ) : null}
          </div>
        ) : null}

        {(liveRungs.cpu.length || liveRungs.gpu.length) ? (
          <div className="card overflow-x-auto p-4 sm:p-5">
            <p className="section-label">Capacity ladder</p>
            <p className="mt-1 text-xs text-ink-muted">
              Wall time per rung. The probe stops when a rung breaks the budget or the next one is predicted to
              (each extra qubit doubles the state and adds gates).
            </p>
            <table className="mt-3 w-full text-left font-mono text-xs">
              <thead>
                <tr className="text-ink-muted">
                  <th className="py-1 pr-4 font-semibold">N</th>
                  <th className="py-1 pr-4 font-semibold">Amplitudes</th>
                  <th className="py-1 pr-4 font-semibold">GPU (2^N × 8 B)</th>
                  <th className="py-1 pr-4 font-semibold">CPU (2^N × 16 B)</th>
                </tr>
              </thead>
              <tbody>
                {ladderRows(liveRungs.cpu, liveRungs.gpu).map((row) => (
                  <tr key={row.n} className="border-t border-line">
                    <td className="py-1 pr-4">{row.n}</td>
                    <td className="py-1 pr-4">2^{row.n}</td>
                    <td className="py-1 pr-4 text-q-rose-text">{row.gpu !== undefined ? `${fmtMs(row.gpu)} · ${fmtBytes(statevectorBytes(row.n, 'float32'))}` : '—'}</td>
                    <td className="py-1 pr-4 text-q-sky-text">{row.cpu !== undefined ? `${fmtMs(row.cpu)} · ${fmtBytes(statevectorBytes(row.n, 'float64'))}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <aside className="card p-4 sm:p-5" aria-labelledby="gpu-sim-controls">
        <h2 id="gpu-sim-controls" className="section-label mb-4">Controls</h2>
        <div className="flex flex-col gap-5">{controls}</div>
      </aside>
    </div>
  )
}

function ladderRows(cpu: ProbeRung[], gpu: ProbeRung[]): { n: number; cpu?: number; gpu?: number }[] {
  const byN = new Map<number, { n: number; cpu?: number; gpu?: number }>()
  for (const r of gpu) byN.set(r.numQubits, { ...(byN.get(r.numQubits) ?? { n: r.numQubits }), gpu: r.wallMs })
  for (const r of cpu) byN.set(r.numQubits, { ...(byN.get(r.numQubits) ?? { n: r.numQubits }), cpu: r.wallMs })
  return [...byN.values()].sort((a, b) => a.n - b.n)
}

function RunCard({
  title,
  accent,
  report,
  probe,
  available,
}: {
  title: string
  accent: 'sky' | 'rose'
  report: RunReport | null
  probe: ProbeReport | null
  available: boolean
}) {
  const text = accent === 'sky' ? 'text-q-sky-text' : 'text-q-rose-text'
  return (
    <div className="card p-4 sm:p-5">
      <h3 className={`text-sm font-bold ${text}`}>{title}</h3>
      {!available ? (
        <p className="mt-2 text-sm text-ink-muted">Not available in this browser.</p>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Stat label="Wall time" value={report ? fmtMs(report.wallMs) : '—'} accent={accent} />
            <Stat label="Passes" value={report ? `${report.dispatches} / ${report.gates}` : '—'} accent={accent} />
            <Stat label="State" value={report ? fmtBytes(report.bytes) : '—'} accent={accent} />
            <Stat
              label="Largest N in budget"
              value={probe ? `${probe.largest}` : '—'}
              accent={accent}
            />
          </div>
          {probe ? <p className="mt-2 text-xs text-ink-muted">Stopped: {probe.reason}.</p> : null}
          {report ? (
            <div className="mt-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-ink-muted">Most probable states</p>
              <ol className="mt-1 space-y-0.5 font-mono text-xs">
                {report.top.map((s) => (
                  <li key={s.index} className="flex justify-between gap-2">
                    <span className="truncate">{formatKet(s.index, report.numQubits)}</span>
                    <span className="text-ink-secondary">{(s.probability * 100).toFixed(3)}%</span>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}

/** Prose below the lab. Exported so the page can place it under the grid. */
export function GpuSimulatorExplainers() {
  return (
    <>
      <Explainer title="What this measures">
        <p>
          Both columns run the identical circuit through the same gate list — one 2×2 matrix per single-qubit
          gate, a control mask for CX and Toffoli, an index swap for SWAP. Runs of single-qubit gates on one
          qubit are multiplied into a single matrix first (that is the &ldquo;passes&rdquo; number: fewer passes
          than gates), because on a GPU every pass is a full sweep over the statevector.
        </p>
        <p>
          The CPU column is the float64 engine every other page on this site uses. The GPU column is the same
          arithmetic in float32 inside a WebGPU compute shader: 2^N complex amplitudes in one storage buffer,
          one shader invocation per amplitude pair, and a dynamic-offset uniform holding the matrix.
        </p>
      </Explainer>
      <Explainer title="Memory is the wall, not time">
        <p>
          This is a <strong>statevector</strong> simulator: it stores every amplitude. That is 2^N × 8 bytes of
          float32 on the GPU and 2^N × 16 bytes of float64 on the CPU — 8 MB at 20 qubits, 2 GB at 28. No amount of
          compute changes that, which is why the probe reports the largest N that fits a memory budget as well as a
          time budget, and why it stops when your GPU&rsquo;s maximum storage-buffer size says so.
        </p>
        <p>
          Watch the ladder: the GPU&rsquo;s time per rung barely moves until the state is a few million
          amplitudes, then doubles per qubit like the CPU&rsquo;s does. Below that, a fixed cost per pass —
          command encoding, the readback of a few kilobytes of results — dominates, and the CPU wins.
        </p>
      </Explainer>
      <Explainer title="float32 is not float64">
        <p>
          A float32 amplitude carries about seven significant digits; a float64 one about sixteen. Each gate
          rounds once, and the rounding errors random-walk, so after a few hundred gates the GPU state differs
          from the CPU state by a few parts in ten million. &ldquo;Max |Δ amplitude|&rdquo; above is that gap,
          measured — not estimated — by reading both statevectors back and comparing every entry. For sampling
          measurement outcomes it is invisible; for computing a phase to twelve digits it is not.
        </p>
      </Explainer>
      <Explainer title="Where it runs">
        <p>
          WebGPU ships in Chrome and Edge 113+, and Safari 17+ on macOS, iOS and iPadOS. Firefox has it behind{' '}
          <code>dom.webgpu.enabled</code> in <code>about:config</code>. Anywhere else, and on any machine whose GPU
          the browser blocklists, this page falls back to the CPU column and says so — it never invents a GPU
          result.
        </p>
      </Explainer>
    </>
  )
}
