'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Segmented, ButtonRow, Slider, Stat } from '@/components/ui/Controls'
import { Explainer } from '@/components/ui/VizFrame'
import CouplingMapCanvas from '@/components/workbench/CouplingMapCanvas'
import RewardChart from '@/components/workbench/RewardChart'
import { useRoutingTrainer } from '@/components/workbench/useRoutingTrainer'
import { fromQasm, toQasm, type Circuit } from '@/lib/quantum'
import {
  circuitMetrics,
  expandForRouting,
  routedEquivalent,
  sabreRoute,
  validateOnMap,
  type EquivalenceReport,
  type RoutedCircuit,
  type RoutingMetrics,
} from '@/lib/quantum/routing'
import { ROUTING_PRESETS } from '@/lib/quantum/routingPresets'
import {
  buildTopology,
  TOPOLOGY_KINDS,
  TOPOLOGY_LABEL,
  type CouplingMap,
  type TopologyKind,
} from '@/lib/quantum/topology'

/**
 * /workbench/routing — Routing Race.
 *
 * The page owns the inputs (QASM text, topology, budget) and renders numbers;
 * every number comes from lib/quantum/routing.ts. The heuristic runs on the
 * main thread (milliseconds at these sizes). The learned router trains in
 * routing.worker.ts under a visible budget with a stop button, and the page
 * never blocks on it.
 */

type PresetId = (typeof ROUTING_PRESETS)[number]['id'] | 'custom'

/** Largest physical register the equivalence check will simulate. */
const VERIFY_MAX_QUBITS = 14
const MAX_PHYSICAL = 64
const MAX_LOGICAL = 32

const PRESET_QASM: Record<string, string> = Object.fromEntries(
  ROUTING_PRESETS.map((p) => [p.id, toQasm(p.circuit)]),
)

function swapsPerEdge(routed: RoutedCircuit | null): Map<string, number> {
  const out = new Map<string, number>()
  if (!routed) return out
  for (const op of routed.circuit.ops) {
    if (op.name !== 'SWAP') continue
    const a = Math.min(op.qubits[0], op.qubits[1])
    const b = Math.max(op.qubits[0], op.qubits[1])
    const key = `${a}-${b}`
    out.set(key, (out.get(key) ?? 0) + 1)
  }
  return out
}

function pctChange(from: number, to: number): string {
  if (from === 0) return '—'
  const d = ((to - from) / from) * 100
  return `${d > 0 ? '+' : ''}${d.toFixed(0)}%`
}

function layoutString(layout: readonly number[]): string {
  return layout.map((p, q) => `q${q}→${p}`).join('  ')
}

export default function RoutingPage() {
  const [presetId, setPresetId] = useState<PresetId>('qft8')
  const [qasm, setQasm] = useState<string>(PRESET_QASM.qft8)
  const [topology, setTopology] = useState<TopologyKind>('heavy-hex')
  const [extraQubits, setExtraQubits] = useState(0)
  const [seed, setSeed] = useState(1)
  const [maxEpisodes, setMaxEpisodes] = useState(400)
  const [maxSeconds, setMaxSeconds] = useState(20)
  const [verify, setVerify] = useState<{ heuristic: EquivalenceReport | null; learned: EquivalenceReport | null; error: string | null }>({
    heuristic: null,
    learned: null,
    error: null,
  })
  const trainer = useRoutingTrainer()

  const applyPreset = (id: PresetId) => {
    setPresetId(id)
    if (id !== 'custom') setQasm(PRESET_QASM[id])
  }

  // ── Parse ──────────────────────────────────────────────────────────────
  const parsed = useMemo((): { circuit: Circuit; error: null } | { circuit: null; error: string } => {
    const circuit = fromQasm(qasm)
    if (circuit.ops.length === 0) {
      return { circuit: null, error: 'No gates parsed. Paste OpenQASM 2 or 3 using h x y z s sdg t tdg rx ry rz p cx cy cz swap ccx.' }
    }
    if (circuit.numQubits > MAX_LOGICAL) {
      return { circuit: null, error: `${circuit.numQubits} qubits is more than this page routes (${MAX_LOGICAL}).` }
    }
    try {
      expandForRouting(circuit)
    } catch (cause) {
      return { circuit: null, error: cause instanceof Error ? cause.message : String(cause) }
    }
    return { circuit, error: null }
  }, [qasm])

  const circuit = parsed.circuit
  const numLogical = circuit?.numQubits ?? 0
  const numPhysical = Math.min(MAX_PHYSICAL, numLogical + extraQubits)

  const map: CouplingMap | null = useMemo(
    () => (numPhysical > 0 ? buildTopology(topology, numPhysical) : null),
    [topology, numPhysical],
  )

  const original: RoutingMetrics | null = useMemo(
    () => (circuit ? circuitMetrics(expandForRouting(circuit)) : null),
    [circuit],
  )

  // ── Heuristic (synchronous; milliseconds at these sizes) ───────────────
  const heuristic = useMemo((): { routed: RoutedCircuit; error: null } | { routed: null; error: string } => {
    if (!circuit || !map) return { routed: null, error: 'nothing to route' }
    try {
      return { routed: sabreRoute(circuit, map, { seed }), error: null }
    } catch (cause) {
      return { routed: null, error: cause instanceof Error ? cause.message : String(cause) }
    }
  }, [circuit, map, seed])

  const learned = trainer.result

  // Inputs changed: the trained result belongs to a different problem.
  const resetTrainer = trainer.reset
  useEffect(() => {
    resetTrainer()
    setVerify({ heuristic: null, learned: null, error: null })
  }, [circuit, map, seed, resetTrainer])

  const startTraining = useCallback(() => {
    if (!circuit || !map) return
    setVerify((v) => ({ ...v, learned: null }))
    trainer.start({ circuit, topology, numQubits: numPhysical, seed, maxEpisodes, maxSeconds })
  }, [circuit, map, topology, numPhysical, seed, maxEpisodes, maxSeconds, trainer])

  const canVerify =
    !!circuit &&
    !!map &&
    numPhysical <= VERIFY_MAX_QUBITS &&
    circuit.ops.every((op) => op.name !== 'MEASURE' && !op.condition)

  const runVerify = () => {
    if (!circuit || !heuristic.routed) return
    try {
      const h = routedEquivalent(circuit, heuristic.routed)
      const l = learned ? routedEquivalent(circuit, learned.routed) : null
      setVerify({ heuristic: h, learned: l, error: null })
    } catch (cause) {
      setVerify({ heuristic: null, learned: null, error: cause instanceof Error ? cause.message : String(cause) })
    }
  }

  const heuristicQasm = useMemo(() => (heuristic.routed ? toQasm(heuristic.routed.circuit) : ''), [heuristic.routed])
  const learnedQasm = useMemo(() => (learned ? toQasm(learned.routed.circuit) : ''), [learned])

  const occupied = useMemo(
    () => new Set<number>(heuristic.routed ? heuristic.routed.initialLayout : []),
    [heuristic.routed],
  )
  const heuristicEdges = useMemo(() => swapsPerEdge(heuristic.routed), [heuristic.routed])
  const learnedEdges = useMemo(() => swapsPerEdge(learned?.routed ?? null), [learned])

  const running = trainer.status === 'running'
  const progress = trainer.progress
  const episodeFrac = progress ? progress.episode / progress.maxEpisodes : 0
  const secondFrac = progress ? progress.secondsUsed / progress.maxSeconds : 0
  const budgetFrac = Math.min(1, Math.max(episodeFrac, secondFrac))

  const presetOptions = [
    ...ROUTING_PRESETS.map((p) => ({ value: p.id as PresetId, label: p.label })),
    { value: 'custom' as PresetId, label: 'Custom' },
  ]

  const rows: { label: string; m: RoutingMetrics | null; swaps: number | null; accent: 'violet' | 'amber' | 'sky' }[] = [
    { label: 'Original', m: original, swaps: 0, accent: 'violet' },
    { label: 'Heuristic (SABRE)', m: heuristic.routed?.metrics ?? null, swaps: heuristic.routed?.swapsAdded ?? null, accent: 'amber' },
    { label: 'Learned (REINFORCE)', m: learned?.routed.metrics ?? null, swaps: learned?.routed.swapsAdded ?? null, accent: 'sky' },
  ]

  const statusText = (() => {
    if (trainer.status === 'error') return `Training failed: ${trainer.error}`
    if (running && progress) {
      return `Episode ${progress.episode} of ${progress.maxEpisodes}, ${progress.secondsUsed.toFixed(1)} s of ${progress.maxSeconds} s. Best sampled routing so far: ${progress.bestSampledSwaps} SWAPs against the heuristic's ${progress.heuristicSwaps}.`
    }
    if (running) return 'Starting the training worker…'
    if (trainer.status === 'done' && learned && heuristic.routed) {
      const by = trainer.stoppedBy === 'user' ? 'stopped by you' : trainer.stoppedBy === 'seconds' ? 'time budget reached' : 'episode budget reached'
      const d = learned.routed.metrics.twoQubitGates - heuristic.routed.metrics.twoQubitGates
      const verdict = d < 0 ? `${-d} fewer two-qubit gates than the heuristic` : d === 0 ? 'the same two-qubit count as the heuristic' : `${d} more two-qubit gates than the heuristic`
      return `Done after ${learned.episodes} episodes in ${trainer.secondsUsed.toFixed(1)} s (${by}). The learned routing has ${verdict}; it came from the ${learned.source === 'greedy' ? 'trained policy’s greedy rollout' : 'best sampled episode'}.`
    }
    return 'Not trained yet.'
  })()

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
      <Link
        href="/workbench"
        className="focus-ring mb-6 inline-flex items-center gap-1.5 rounded text-sm text-ink-muted transition-colors hover:text-ink-secondary"
      >
        <span aria-hidden>←</span> Workbench
      </Link>

      <div className="mb-8">
        <span className="pill border border-q-sky/30 bg-q-sky/15 text-q-sky-text">optimise</span>
        <h1 className="mt-3 text-3xl font-extrabold tracking-tight md:text-4xl">Routing Race</h1>
        <p className="mt-2 max-w-2xl text-[15px] text-ink-secondary">
          Your circuit, a real coupling map, two routers. One is the SABRE heuristic every
          transpiler ships. The other starts as that heuristic and trains, in your browser, on
          the two-qubit count and depth of the circuits it produces. Watch which wins on your
          circuit — and by how much.
        </p>
      </div>

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* ── Left: circuit, map, results ─────────────────────────────── */}
        <div className="flex flex-col gap-5">
          <section className="card p-4 sm:p-5" aria-labelledby="routing-input">
            <h2 id="routing-input" className="section-label mb-3">
              Circuit
            </h2>
            <Segmented<PresetId>
              label="Preset or your own"
              value={presetId}
              options={presetOptions}
              onChange={applyPreset}
            />
            {presetId !== 'custom' ? (
              <p className="mt-2 text-[13px] text-ink-secondary">
                {ROUTING_PRESETS.find((p) => p.id === presetId)?.blurb}
              </p>
            ) : null}
            <label className="mt-3 block">
              <span className="mb-1.5 block text-[13px] font-semibold text-ink-secondary">
                OpenQASM (edit freely — editing switches to Custom)
              </span>
              <textarea
                value={qasm}
                onChange={(e) => {
                  setQasm(e.target.value)
                  setPresetId('custom')
                }}
                spellCheck={false}
                rows={9}
                className="focus-ring w-full resize-y rounded-lg border border-line bg-surface-2 p-3 font-mono text-[12px] leading-relaxed text-ink"
                aria-describedby="routing-parse-status"
              />
            </label>
            <p id="routing-parse-status" className="mt-2 text-[12px] text-ink-muted" aria-live="polite">
              {parsed.error
                ? parsed.error
                : `${numLogical} logical qubits · ${original?.ops ?? 0} gates after expansion · ${original?.twoQubitGates ?? 0} two-qubit gates · depth ${original?.depth ?? 0}. Toffolis are expanded to six CX before routing; barriers are dropped.`}
            </p>
          </section>

          <section className="card p-4 sm:p-5" aria-labelledby="routing-map">
            <h2 id="routing-map" className="section-label mb-3">
              Coupling map
            </h2>
            {map ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <p className="mb-1 text-[12px] font-semibold text-ink-secondary">Heuristic — SWAP traffic per edge</p>
                  <CouplingMapCanvas
                    map={map}
                    swapsPerEdge={heuristicEdges}
                    occupied={occupied}
                    title="Heuristic routing"
                  />
                </div>
                <div>
                  <p className="mb-1 text-[12px] font-semibold text-ink-secondary">Learned — SWAP traffic per edge</p>
                  {learned ? (
                    <CouplingMapCanvas
                      map={map}
                      swapsPerEdge={learnedEdges}
                      occupied={new Set(learned.routed.initialLayout)}
                      title="Learned routing"
                    />
                  ) : (
                    <div className="grid h-[260px] place-items-center rounded-lg border border-dashed border-line text-[13px] text-ink-muted">
                      Train the learned router to fill this in.
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-[13px] text-ink-muted">Fix the circuit above to see a map.</p>
            )}
            <p className="mt-3 text-[12px] leading-relaxed text-ink-muted">
              Filled discs hold a logical qubit in the initial layout; the number on an edge is
              how many SWAPs the router put there. {TOPOLOGY_LABEL[topology]}, {numPhysical} physical
              qubits.
            </p>
          </section>

          <section className="card p-4 sm:p-5" aria-labelledby="routing-results">
            <h2 id="routing-results" className="section-label mb-3">
              Results
            </h2>
            {heuristic.error && circuit ? (
              <p className="text-[13px] text-q-rose-text">{heuristic.error}</p>
            ) : null}
            <div className="-mx-2 overflow-x-auto px-2">
              <table className="w-full min-w-[560px] border-collapse text-left text-sm">
                <caption className="sr-only">
                  Two-qubit gate count, depth and added SWAPs for the original circuit, the
                  heuristic routing and the learned routing.
                </caption>
                <thead>
                  <tr className="border-b border-line text-[11px] uppercase tracking-wider text-ink-muted">
                    <th scope="col" className="py-2 pr-3 font-bold">Circuit</th>
                    <th scope="col" className="py-2 pr-3 text-right font-bold">2Q gates</th>
                    <th scope="col" className="py-2 pr-3 text-right font-bold">vs original</th>
                    <th scope="col" className="py-2 pr-3 text-right font-bold">Depth</th>
                    <th scope="col" className="py-2 pr-3 text-right font-bold">SWAPs added</th>
                    <th scope="col" className="py-2 text-right font-bold">Valid on map</th>
                  </tr>
                </thead>
                <tbody className="font-mono text-[13px]">
                  {rows.map((row) => {
                    const valid =
                      row.label === 'Original'
                        ? map && circuit
                          ? validateOnMap(expandForRouting(circuit), map).length === 0
                          : null
                        : row.label.startsWith('Heuristic')
                          ? heuristic.routed && map
                            ? validateOnMap(heuristic.routed.circuit, map).length === 0
                            : null
                          : learned && map
                            ? validateOnMap(learned.routed.circuit, map).length === 0
                            : null
                    const color =
                      row.accent === 'violet' ? 'text-q-violet-text' : row.accent === 'amber' ? 'text-q-amber-text' : 'text-q-sky-text'
                    return (
                      <tr key={row.label} className="border-b border-line">
                        <th scope="row" className={`py-2 pr-3 text-left font-sans font-semibold ${color}`}>
                          {row.label}
                        </th>
                        <td className="py-2 pr-3 text-right text-ink">{row.m ? row.m.twoQubitGates : '—'}</td>
                        <td className="py-2 pr-3 text-right text-ink-secondary">
                          {row.m && original && row.label !== 'Original' ? pctChange(original.twoQubitGates, row.m.twoQubitGates) : '—'}
                        </td>
                        <td className="py-2 pr-3 text-right text-ink">{row.m ? row.m.depth : '—'}</td>
                        <td className="py-2 pr-3 text-right text-ink">{row.swaps ?? '—'}</td>
                        <td className="py-2 text-right">
                          {valid === null ? (
                            <span className="text-ink-muted">—</span>
                          ) : valid ? (
                            <span className="text-q-teal-text">yes</span>
                          ) : (
                            <span className="text-q-rose-text">no</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-[12px] leading-relaxed text-ink-muted">
              A SWAP is counted as the three CXs it compiles to, in both the gate count and the
              depth. &ldquo;Valid on map&rdquo; means every two-qubit gate sits on an edge; the
              original is only valid when the map happens to contain it.
            </p>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                className="btn-ghost focus-ring"
                onClick={runVerify}
                disabled={!canVerify || !heuristic.routed}
              >
                Verify equivalence
              </button>
              <span className="text-[12px] text-ink-secondary" aria-live="polite">
                {verify.error
                  ? verify.error
                  : verify.heuristic
                    ? `Heuristic: ${verify.heuristic.equivalent ? 'equivalent' : 'NOT equivalent'} (max error ${verify.heuristic.maxError.toExponential(1)}).` +
                      (verify.learned
                        ? ` Learned: ${verify.learned.equivalent ? 'equivalent' : 'NOT equivalent'} (max error ${verify.learned.maxError.toExponential(1)}).`
                        : '')
                    : canVerify
                      ? `Simulates the routed circuit on random states and compares it with the original up to the reported layouts (up to ${VERIFY_MAX_QUBITS} physical qubits).`
                      : `Verification simulates the routed circuit, so it needs at most ${VERIFY_MAX_QUBITS} physical qubits and no measurements.`}
              </span>
            </div>
          </section>

          <section className="card p-4 sm:p-5" aria-labelledby="routing-training">
            <h2 id="routing-training" className="section-label mb-3">
              Training
            </h2>
            <div
              role="progressbar"
              aria-label="Training budget used"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(budgetFrac * 100)}
              className="h-2 w-full overflow-hidden rounded-full bg-surface-3"
            >
              <div
                className="h-full rounded-full bg-q-sky transition-[width] duration-150 motion-reduce:transition-none"
                style={{ width: `${budgetFrac * 100}%` }}
              />
            </div>
            <p className="mt-2 text-[13px] text-ink-secondary" aria-live="polite">
              {statusText}
            </p>
            <div className="mt-3">
              <RewardChart rewards={progress?.rewards ?? learned?.rewards ?? []} maxEpisodes={maxEpisodes} />
            </div>
            <p className="mt-2 text-[12px] leading-relaxed text-ink-muted">
              Each dot is one sampled routing, scored as −(2Q gates + ½·depth) relative to the
              heuristic, so the dashed line at −1 is the heuristic and higher is better. The solid
              line is a 20-episode average. It moves slowly: the policy has eight weights and
              starts as the heuristic, and REINFORCE on a whole-circuit reward is a noisy signal.
              The best single sample usually pulls ahead long before the average does.
            </p>
          </section>

          {heuristic.routed ? (
            <section className="card p-4 sm:p-5" aria-labelledby="routing-circuits">
              <h2 id="routing-circuits" className="section-label mb-3">
                Routed circuits
              </h2>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <p className="mb-1 text-[12px] font-semibold text-q-amber-text">Heuristic</p>
                  <p className="mb-1 font-mono text-[11px] text-ink-muted">
                    initial {layoutString(heuristic.routed.initialLayout)}
                  </p>
                  <p className="mb-2 font-mono text-[11px] text-ink-muted">
                    final {layoutString(heuristic.routed.finalLayout)}
                  </p>
                  <pre
                    className="max-h-[320px] overflow-auto rounded-lg border border-line bg-surface-2 p-3 font-mono text-[11px] leading-relaxed text-ink-secondary"
                    tabIndex={0}
                    aria-label="Heuristic routed circuit as OpenQASM"
                  >
                    {heuristicQasm}
                  </pre>
                </div>
                <div>
                  <p className="mb-1 text-[12px] font-semibold text-q-sky-text">Learned</p>
                  {learned ? (
                    <>
                      <p className="mb-1 font-mono text-[11px] text-ink-muted">
                        initial {layoutString(learned.routed.initialLayout)}
                      </p>
                      <p className="mb-2 font-mono text-[11px] text-ink-muted">
                        final {layoutString(learned.routed.finalLayout)}
                      </p>
                      <pre
                        className="max-h-[320px] overflow-auto rounded-lg border border-line bg-surface-2 p-3 font-mono text-[11px] leading-relaxed text-ink-secondary"
                        tabIndex={0}
                        aria-label="Learned routed circuit as OpenQASM"
                      >
                        {learnedQasm}
                      </pre>
                    </>
                  ) : (
                    <p className="text-[13px] text-ink-muted">Not trained yet.</p>
                  )}
                </div>
              </div>
              <p className="mt-3 text-[12px] leading-relaxed text-ink-muted">
                Physical qubit indices. The routed circuit equals the original when logical qubit
                q is loaded onto physical qubit initial[q] and read back from final[q]; the
                &ldquo;Verify equivalence&rdquo; button checks exactly that with the simulator.
              </p>
            </section>
          ) : null}
        </div>

        {/* ── Right: controls ─────────────────────────────────────────── */}
        <aside className="card p-4 sm:p-5" aria-labelledby="routing-controls">
          <h2 id="routing-controls" className="section-label mb-4">
            Controls
          </h2>
          <div className="flex flex-col gap-5">
            <Segmented<TopologyKind>
              label="Topology"
              value={topology}
              options={TOPOLOGY_KINDS.map((k) => ({ value: k, label: TOPOLOGY_LABEL[k] }))}
              onChange={setTopology}
            />
            <Slider
              label="Spare physical qubits"
              value={extraQubits}
              min={0}
              max={Math.max(0, MAX_PHYSICAL - numLogical)}
              step={1}
              onChange={setExtraQubits}
              format={(v) => `+${v} → ${numPhysical} total`}
              hint="Extra qubits the router may swap through. On heavy-hex, 12 in total closes the first hexagon."
            />
            <Slider
              label="Seed"
              value={seed}
              min={1}
              max={99}
              step={1}
              onChange={setSeed}
              format={(v) => String(v)}
              hint="Tie-breaking in the heuristic and sampling in training. Same seed, same result."
            />
            <Slider
              label="Episode budget"
              value={maxEpisodes}
              min={50}
              max={2000}
              step={50}
              onChange={setMaxEpisodes}
              format={(v) => `${v} episodes`}
              hint="One episode = one full routing sampled from the policy, then one gradient step."
            />
            <Slider
              label="Time budget"
              value={maxSeconds}
              min={5}
              max={60}
              step={5}
              onChange={setMaxSeconds}
              format={(v) => `${v} s`}
              hint="Whichever budget runs out first ends training. Training runs in a Web Worker, so the page stays responsive."
            />
            <ButtonRow>
              {running ? (
                <button type="button" className="btn-primary focus-ring" onClick={trainer.stop}>
                  Stop and keep result
                </button>
              ) : (
                <button
                  type="button"
                  className="btn-primary focus-ring"
                  onClick={startTraining}
                  disabled={!circuit || !heuristic.routed}
                >
                  {learned ? 'Train again' : 'Train learned router'}
                </button>
              )}
              <button
                type="button"
                className="btn-ghost focus-ring"
                onClick={() => trainer.reset()}
                disabled={trainer.status === 'idle'}
              >
                Clear
              </button>
            </ButtonRow>
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Heuristic SWAPs" value={heuristic.routed ? String(heuristic.routed.swapsAdded) : '—'} accent="amber" />
              <Stat
                label="Learned SWAPs"
                value={learned ? String(learned.routed.swapsAdded) : progress ? `${progress.bestSampledSwaps} (best so far)` : '—'}
                accent="sky"
              />
              <Stat label="Heuristic depth" value={heuristic.routed ? String(heuristic.routed.metrics.depth) : '—'} accent="amber" />
              <Stat label="Learned depth" value={learned ? String(learned.routed.metrics.depth) : '—'} accent="sky" />
            </div>
          </div>
        </aside>
      </div>

      <div className="mt-10 max-w-3xl">
        <Explainer title="What to do">
          <p>
            Pick a preset or paste a circuit, pick a topology, and read the heuristic row: it
            is computed the moment the inputs change. Then train. The learned router starts
            from the heuristic&rsquo;s own initial layout and its own swap ranking, so at
            episode zero the two are the same router; everything after that is what the
            policy learned, or what its sampling found.
          </p>
          <p>
            Try GHZ-12 on the ring against the line, then QFT-8 on heavy-hex with and without
            spare qubits. Then paste something of yours. The QASM box accepts what the
            simulator&rsquo;s export writes, and Qiskit&rsquo;s.
          </p>
        </Explainer>

        <Explainer title="What the two routers are">
          <p>
            <strong className="text-ink">Heuristic.</strong> SABRE (Li, Ding and Xie, 2019),
            the default routing pass in Qiskit and elsewhere. Keep the gates whose
            dependencies are done in a front layer; run the ones that sit on an edge; when
            none does, score every swap that touches a front-layer qubit by how much it
            shortens the front layer plus half of how much it shortens the next twenty gates,
            with a penalty for moving a qubit that just moved, and take the best. The initial
            layout comes from routing the circuit forward, then backward, then starting from
            where that ended.
          </p>
          <p>
            <strong className="text-ink">Learned.</strong> The same loop with the swap choice
            replaced by a softmax policy over eight features of each candidate swap — the two
            SABRE terms, how many front gates it unblocks, recency, whether it undoes the last
            swap, progress on the oldest blocked gate, the degree of the qubits involved, and
            whether it moves through an empty qubit. Its weights start as the SABRE ranking
            exactly. Each episode samples a complete routing, scores it as −(two-qubit gates +
            ½·depth) relative to the heuristic, and takes one REINFORCE step on the weights.
            The result shown is the trained policy&rsquo;s greedy rollout or, when that is
            worse, the best routing any episode sampled.
          </p>
        </Explainer>

        <Explainer title="What this is a reproduction of, and what it is not">
          <p>
            IBM&rsquo;s production AI transpiler passes report improvements of 24% and 36% over
            the default heuristic on circuits of 100+ qubits, using a reinforcement-learned
            routing policy. This page is that idea at toy scale: eight weights instead of a
            neural network, twelve qubits instead of a hundred, a few hundred episodes in your
            browser instead of days on a cluster. The numbers you get are yours to compare,
            not a benchmark of IBM&rsquo;s tool.
          </p>
          <p>
            Be honest with yourself about where a win came from. The status line says whether
            the learned routing is the trained policy&rsquo;s own greedy choice or the best of
            its samples. On small circuits the best sample usually wins, because a random
            tie-break in SABRE is often the difference between 24 and 30 swaps and sampling
            explores those ties. That is also true at scale: the production passes are a
            search guided by a learned model, not a single rollout.
          </p>
          <p>
            <strong className="text-ink">Not modelled:</strong> gate direction on an edge,
            per-edge error rates, gate cancellation after routing, commutation beyond
            &ldquo;gates on different qubits commute&rdquo;, and calibration data of any real
            device. The heavy-hex map is IBM&rsquo;s lattice pattern at a chosen width, not
            the qubit numbering of any particular backend. SWAPs are always three CXs; a
            compiler that turns a swap with an idle |0⟩ qubit into a cheaper move would count
            differently.
          </p>
          <p>
            <strong className="text-ink">Checked:</strong> every routed circuit is validated
            against the map, and the &ldquo;Verify equivalence&rdquo; button runs the same
            statevector comparison the tests in{' '}
            <code className="rounded bg-surface-3 px-1 py-0.5 text-[12px]">lib/quantum/routing.test.ts</code>{' '}
            run, which also hold the heuristic to zero swaps on all-to-all and the heavy-hex
            distances to a hand-computed table.
          </p>
        </Explainer>
      </div>
    </div>
  )
}
