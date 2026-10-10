'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { VizFrame, Explainer } from '@/components/ui/VizFrame'
import { Segmented, ButtonRow, Slider, Stat } from '@/components/ui/Controls'
import {
  BlochComponentsChart,
  CloneFidelityChart,
  ConvergenceChart,
  DensityMatrixChart,
  EigenvalueChart,
  type FidelityCurvePoint,
  type SweepPoint,
} from '@/components/viz/TomographyLab'
import { GATE_BY_NAME, c, mulberry32, type GateName, type GateOp } from '@/lib/quantum'
import {
  BELL_PHI_PLUS,
  OUTCOME_LABELS,
  blochFromDensity,
  densityFromBloch,
  depolarize,
  eigenvaluesHermitian,
  expectationsFromCounts,
  fidelityWithPure,
  linearInversion,
  mleProject,
  productState,
  pureDensity,
  purity,
  randomPureState,
  reconstructSingleQubit,
  sampleSingleQubit,
  sampleTwoQubit,
  singleQubitRmsError,
  traceDistance,
  type DensityMatrix,
  type Vec3,
} from '@/lib/quantum/tomography'
import {
  CANDIDATE_PRESETS,
  cloneReport,
  noCloningVerdict,
  perfectBasisClonerBound,
  type CandidatePresetId,
  type CloneReport,
} from '@/lib/quantum/noCloning'

/**
 * /visualizations/state-tomography — Tomography and No-Cloning.
 *
 * Three benches on one page. (1) Single-qubit tomography: pick a state, take
 * N shots along X, Y and Z, and watch the Bloch-vector estimate with its
 * error bars tighten as 1/√N. (2) Two-qubit tomography in nine bases, where
 * linear inversion hands back a matrix with negative eigenvalues and the
 * maximum-likelihood projection repairs it. (3) No-cloning: build any circuit
 * you like, test it on |0⟩, |1⟩ and a third non-orthogonal state, and see the
 * linearity argument decide the outcome before the circuit even runs.
 *
 * Every number comes from lib/quantum/tomography.ts and
 * lib/quantum/noCloning.ts, whose tests pin the binomial error formula, the
 * 1/√N rate, the hand-written Bell-state table and the ½ that kills the CNOT
 * copier on |+⟩.
 */

const DEG = Math.PI / 180
const R = Math.SQRT1_2
const ZERO = [c(1), c(0)] as const
const PLUS = [c(R), c(R)] as const

const pct = (p: number) => `${(p * 100).toFixed(1)}%`
const f3 = (v: number) => v.toFixed(3)
const shotsFromExp = (e: number) => Math.round(Math.pow(10, e))
const fmtShots = (n: number) => n.toLocaleString('en-US')

const SWEEP_NS = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10_000, 20_000, 50_000, 100_000]
const SWEEP_TRIALS = 8

// ─────────────────────────────────────────────────────────────────────────────
// Section 1 · single qubit
// ─────────────────────────────────────────────────────────────────────────────

type OnePreset = 'zero' | 'plus' | 'plusi' | 'custom' | 'hidden'

const ONE_PRESETS: { id: OnePreset; label: string; theta: number; phi: number }[] = [
  { id: 'zero', label: '|0⟩', theta: 0, phi: 0 },
  { id: 'plus', label: '|+⟩', theta: 90, phi: 0 },
  { id: 'plusi', label: '|+i⟩', theta: 90, phi: 90 },
]

function unitVector(thetaDeg: number, phiDeg: number, length: number): Vec3 {
  const t = thetaDeg * DEG
  const p = phiDeg * DEG
  return [length * Math.sin(t) * Math.cos(p), length * Math.sin(t) * Math.sin(p), length * Math.cos(t)]
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 2 · two qubits
// ─────────────────────────────────────────────────────────────────────────────

type TwoState = 'bell' | 'product' | 'random' | 'noisy'

const TWO_OPTIONS: { value: TwoState; label: string }[] = [
  { value: 'bell', label: 'Bell |Φ+⟩' },
  { value: 'product', label: '|+⟩|0⟩' },
  { value: 'random', label: 'Random pure' },
  { value: 'noisy', label: 'Bell, 30% depolarised' },
]

function twoQubitTruth(kind: TwoState, seed: number): { rho: DensityMatrix; psi: readonly ReturnType<typeof c>[] | null } {
  switch (kind) {
    case 'bell':
      return { rho: pureDensity(BELL_PHI_PLUS), psi: BELL_PHI_PLUS }
    case 'product': {
      const psi = productState(PLUS, ZERO)
      return { rho: pureDensity(psi), psi }
    }
    case 'random': {
      const psi = randomPureState(4, mulberry32(0x51ed + seed))
      return { rho: pureDensity(psi), psi }
    }
    case 'noisy':
      return { rho: depolarize(pureDensity(BELL_PHI_PLUS), 0.3), psi: null }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 3 · candidate cloner editor
// ─────────────────────────────────────────────────────────────────────────────

interface EditorGate {
  id: number
  name: GateName
  qubits: number[]
  /** Radians, only for RX/RY/RZ. */
  theta?: number
}

const PALETTE: GateName[] = ['H', 'X', 'Y', 'Z', 'S', 'T', 'RX', 'RY', 'RZ', 'CX', 'CZ', 'SWAP', 'CCX']
const ANGLE_GATES = new Set<GateName>(['RX', 'RY', 'RZ'])
const QUBIT_NAMES = ['q0 · input', 'q1 · blank', 'q2 · ancilla']

let nextGateId = 1
function toEditor(ops: readonly GateOp[]): EditorGate[] {
  return ops.map((op) => ({ id: nextGateId++, name: op.name, qubits: op.qubits.slice(), theta: op.theta }))
}
function toOps(gates: readonly EditorGate[]): GateOp[] {
  return gates.map((g) => ({ name: g.name, qubits: g.qubits.slice(), theta: g.theta }))
}
function editorError(gates: readonly EditorGate[]): string | null {
  for (const g of gates) {
    if (new Set(g.qubits).size !== g.qubits.length && g.name !== 'SWAP') {
      return `${g.name} lists the same qubit twice — a control cannot also be its target.`
    }
  }
  return null
}

function FidelityRow({ name, r }: { name: string; r: CloneReport }) {
  return (
    <tr className="border-b border-line">
      <th scope="row" className="py-2 pr-3 text-left font-sans font-semibold text-ink">
        {name}
      </th>
      <td className="py-2 pr-3 text-right text-q-teal-text">{f3(r.joint)}</td>
      <td className="py-2 pr-3 text-right text-q-violet-text">{f3(r.original)}</td>
      <td className="py-2 text-right text-q-sky-text">{f3(r.copy)}</td>
    </tr>
  )
}

export default function StateTomographyPage() {
  // ── Section 1 state ──
  const [theta, setTheta] = useState(60)
  const [phi, setPhi] = useState(30)
  const [length, setLength] = useState(1)
  const [hidden, setHidden] = useState(false)
  const [shotsExp, setShotsExp] = useState(2)
  const [runId, setRunId] = useState(1)
  const [sweep, setSweep] = useState<SweepPoint[]>([])
  const [sweeping, setSweeping] = useState(false)
  const sweepCancel = useRef(false)

  const shots = shotsFromExp(shotsExp)
  const truthVec = useMemo(() => unitVector(theta, phi, length), [theta, phi, length])
  const rho1 = useMemo(() => densityFromBloch(truthVec), [truthVec])
  const truth = useMemo(() => blochFromDensity(rho1), [rho1])

  const counts1 = useMemo(
    () => sampleSingleQubit(rho1, shots, mulberry32(0xa11ce ^ (runId * 2654435761))),
    [rho1, shots, runId]
  )
  const est = useMemo(() => reconstructSingleQubit(counts1), [counts1])
  const err = Math.hypot(est.vector[0] - truth[0], est.vector[1] - truth[1], est.vector[2] - truth[2])
  const rLen = Math.hypot(...truth)
  const reference = useCallback((n: number) => Math.sqrt((3 - rLen * rLen) / n), [rLen])

  const activeOne: OnePreset = hidden
    ? 'hidden'
    : (ONE_PRESETS.find((p) => p.theta === theta && p.phi === phi && length === 1)?.id ?? 'custom')

  const applyOne = (id: OnePreset) => {
    const p = ONE_PRESETS.find((x) => x.id === id)
    if (!p) return
    setHidden(false)
    setTheta(p.theta)
    setPhi(p.phi)
    setLength(1)
  }

  const randomHidden = () => {
    const rng = mulberry32((Date.now() & 0xffff) ^ (runId << 4))
    // Uniform on the sphere: cos θ uniform in [−1, 1].
    setTheta(Math.round(Math.acos(2 * rng() - 1) / DEG))
    setPhi(Math.round(rng() * 360))
    setLength(1)
    setHidden(true)
    setRunId((r) => r + 1)
  }

  const runSweep = () => {
    if (sweeping) {
      sweepCancel.current = true
      return
    }
    sweepCancel.current = false
    setSweeping(true)
    setSweep([])
    const rng = mulberry32(0x5eed ^ runId)
    let k = 0
    const step = () => {
      if (sweepCancel.current || k >= SWEEP_NS.length) {
        setSweeping(false)
        return
      }
      const n = SWEEP_NS[k++]
      const rms = singleQubitRmsError(rho1, n, SWEEP_TRIALS, rng)
      setSweep((s) => [...s, { n, rms }])
      // One N per macrotask so the page stays responsive through the 100k point.
      setTimeout(step, 0)
    }
    setTimeout(step, 0)
  }
  // Abandon a sweep if the state it was measuring changes underneath it.
  useEffect(() => {
    sweepCancel.current = true
    setSweep([])
  }, [rho1])

  // ── Section 2 state ──
  const [twoState, setTwoState] = useState<TwoState>('bell')
  const [twoSeed, setTwoSeed] = useState(1)
  const [twoExp, setTwoExp] = useState(1.5)
  const [twoRun, setTwoRun] = useState(1)
  const twoShots = shotsFromExp(twoExp)

  const two = useMemo(() => {
    const { rho, psi } = twoQubitTruth(twoState, twoSeed)
    const counts = sampleTwoQubit(rho, twoShots, mulberry32(0x7e11 ^ (twoRun * 40503)))
    const lin = linearInversion(expectationsFromCounts(counts))
    const mle = mleProject(lin)
    return {
      rho,
      psi,
      counts,
      lin,
      mle,
      evTruth: eigenvaluesHermitian(rho),
      evLin: eigenvaluesHermitian(lin),
      evMle: eigenvaluesHermitian(mle),
      dLin: traceDistance(lin, rho),
      dMle: traceDistance(mle, rho),
      fLin: psi ? fidelityWithPure(lin, psi) : null,
      fMle: psi ? fidelityWithPure(mle, psi) : null,
      purityTruth: purity(rho),
    }
  }, [twoState, twoSeed, twoShots, twoRun])

  // ── Section 3 state ──
  const [gates, setGates] = useState<EditorGate[]>(() => toEditor(CANDIDATE_PRESETS[0].ops))
  const [probeTheta, setProbeTheta] = useState(90)
  const [probePhi, setProbePhi] = useState(0)

  const ops = useMemo(() => toOps(gates), [gates])
  const opsError = editorError(gates)
  const activePreset: CandidatePresetId | 'custom' =
    CANDIDATE_PRESETS.find(
      (p) =>
        p.ops.length === ops.length &&
        p.ops.every(
          (o, i) =>
            o.name === ops[i].name &&
            o.qubits.join() === ops[i].qubits.join() &&
            Math.abs((o.theta ?? 0) - (ops[i].theta ?? 0)) < 1e-12
        )
    )?.id ?? 'custom'

  const verdict = useMemo(
    () => (opsError ? null : noCloningVerdict(ops, probeTheta * DEG, probePhi * DEG)),
    [ops, opsError, probeTheta, probePhi]
  )
  const curve = useMemo<FidelityCurvePoint[]>(() => {
    if (opsError) return []
    const out: FidelityCurvePoint[] = []
    for (let d = 0; d <= 180; d += 2) {
      const amps = [
        c(Math.cos((d * DEG) / 2)),
        c(Math.sin((d * DEG) / 2) * Math.cos(probePhi * DEG), Math.sin((d * DEG) / 2) * Math.sin(probePhi * DEG)),
      ] as const
      const r = cloneReport(ops, amps)
      out.push({ thetaDeg: d, joint: r.joint, copy: r.copy })
    }
    return out
  }, [ops, opsError, probePhi])
  const bound = useCallback((deg: number) => perfectBasisClonerBound(deg * DEG), [])

  const addGate = (name: GateName) => {
    const arity = GATE_BY_NAME[name].arity
    setGates((g) => [
      ...g,
      {
        id: nextGateId++,
        name,
        qubits: Array.from({ length: arity }, (_, i) => i),
        theta: ANGLE_GATES.has(name) ? Math.PI / 2 : undefined,
      },
    ])
  }
  const updateGate = (id: number, patch: Partial<EditorGate>) =>
    setGates((g) => g.map((x) => (x.id === id ? { ...x, ...patch } : x)))
  const removeGate = (id: number) => setGates((g) => g.filter((x) => x.id !== id))
  const moveGate = (id: number, dir: -1 | 1) =>
    setGates((g) => {
      const i = g.findIndex((x) => x.id === id)
      const j = i + dir
      if (i < 0 || j < 0 || j >= g.length) return g
      const copy = g.slice()
      ;[copy[i], copy[j]] = [copy[j], copy[i]]
      return copy
    })

  const presetOptions = [
    ...CANDIDATE_PRESETS.map((p) => ({ value: p.id as CandidatePresetId | 'custom', label: p.label })),
    ...(activePreset === 'custom' ? [{ value: 'custom' as const, label: 'Custom' }] : []),
  ]

  // ── Controls rail (section 1) ──
  const controls = (
    <>
      <Segmented<OnePreset>
        label="State to learn"
        value={activeOne}
        options={[
          ...ONE_PRESETS.map((p) => ({ value: p.id, label: p.label })),
          ...(activeOne === 'custom' ? [{ value: 'custom' as OnePreset, label: 'Custom' }] : []),
          ...(activeOne === 'hidden' ? [{ value: 'hidden' as OnePreset, label: 'Hidden' }] : []),
        ]}
        onChange={applyOne}
      />

      {hidden ? (
        <div className="rounded-lg border border-line bg-surface-2 p-3 text-[12px] leading-relaxed text-ink-secondary">
          The state is hidden. The only thing you have is the counts. Decide what it is from the
          estimate, then reveal.
        </div>
      ) : (
        <>
          <Slider
            label="Polar angle θ"
            value={theta}
            min={0}
            max={180}
            step={1}
            onChange={setTheta}
            format={(v) => `${v.toFixed(0)}°`}
            hint="0° is |0⟩, 90° is the equator, 180° is |1⟩."
          />
          <Slider
            label="Azimuth φ"
            value={phi}
            min={0}
            max={360}
            step={1}
            onChange={setPhi}
            format={(v) => `${v.toFixed(0)}°`}
            hint="0° is |+⟩ on the equator, 90° is |+i⟩."
          />
          <Slider
            label="Bloch length |r|"
            value={length}
            min={0}
            max={1}
            step={0.05}
            onChange={setLength}
            format={(v) => v.toFixed(2)}
            hint="1 is a pure state. Less is a mixed state — the arrow sits inside the sphere."
          />
        </>
      )}

      <Slider
        label="Shots per axis, N"
        value={shotsExp}
        min={1}
        max={5}
        step={0.25}
        onChange={setShotsExp}
        format={() => fmtShots(shots)}
        hint="Log scale, 10 to 100,000. Three axes, so 3N copies of the state are consumed."
      />

      <ButtonRow>
        <button type="button" className="btn-primary focus-ring" onClick={() => setRunId((r) => r + 1)}>
          Measure again
        </button>
        {hidden ? (
          <button type="button" className="btn-ghost focus-ring" onClick={() => setHidden(false)}>
            Reveal state
          </button>
        ) : (
          <button type="button" className="btn-ghost focus-ring" onClick={randomHidden}>
            Hidden random state
          </button>
        )}
        <button type="button" className="btn-ghost focus-ring" onClick={runSweep} aria-pressed={sweeping}>
          {sweeping ? 'Stop sweep' : 'Sweep N'}
        </button>
      </ButtonRow>

      <div className="grid grid-cols-2 gap-2">
        <Stat label="|r| estimated" value={f3(est.length)} accent={est.length > 1 ? 'rose' : 'teal'} />
        <Stat label="Error |r̂ − r|" value={hidden ? 'hidden' : f3(err)} accent="amber" />
        <Stat label="Predicted error" value={f3(reference(shots))} accent="violet" />
        <Stat label="Copies used" value={fmtShots(3 * shots)} accent="sky" />
      </div>

      <p className="text-[11px] leading-relaxed text-ink-muted">
        Each component is (n₊ − n₋)/N, and its error bar is √((1 − r²)/N). When |r̂| comes out above
        1 the estimate is not a state at all; the nearest state is the same direction, length 1.
      </p>
    </>
  )

  return (
    <VizFrame
      title="Tomography and No-Cloning"
      tagline="One copy of a quantum state tells you almost nothing. Thousands of copies, measured three ways, tell you everything — and the theorem that says you cannot make the copies yourself."
      level="Advanced"
      canvas={
        <div className="p-2">
          <div className="px-2 pt-2">
            <h3 className="section-label mb-1">Single-qubit tomography · {fmtShots(shots)} shots on each of X, Y, Z</h3>
            <BlochComponentsChart truth={truth} estimate={est} showTruth={!hidden} />
          </div>
          <div className="mt-3 px-2">
            <h3 className="section-label mb-1">Error against N {sweeping ? '· sweeping…' : sweep.length ? '' : '· press Sweep N'}</h3>
            <ConvergenceChart points={sweep} reference={reference} referenceLabel={`√((3 − |r|²)/N) = √(${(3 - rLen * rLen).toFixed(2)}/N)`} />
          </div>
          <p className="px-3 pb-2 pt-2 text-[11px] leading-relaxed text-ink-muted">
            Teal bars are the reconstruction from this one experiment; the black whiskers are one
            standard error either side; the dashed violet lines are the true components (hidden while
            you play the guessing game). The lower plot is log–log: a straight line of slope −½ is the
            1/√N law, and each teal dot is the RMS error over eight fresh experiments at that N.
          </p>
        </div>
      }
      controls={controls}
    >
      {/* ── Section 1 tables ── */}
      <div className="card mb-6 p-6">
        <h2 className="section-label mb-3">The counts, and what they say</h2>
        <div className="-mx-2 overflow-x-auto px-2">
          <table className="w-full min-w-[520px] border-collapse text-left text-sm">
            <caption className="sr-only">
              Shots along each axis, the estimated Bloch component with its standard error, and the
              true component when it is not hidden.
            </caption>
            <thead>
              <tr className="border-b border-line text-[11px] uppercase tracking-wider text-ink-muted">
                <th scope="col" className="py-2 pr-3 font-bold">Axis</th>
                <th scope="col" className="py-2 pr-3 text-right font-bold">n₊</th>
                <th scope="col" className="py-2 pr-3 text-right font-bold">n₋</th>
                <th scope="col" className="py-2 pr-3 text-right font-bold">Estimate</th>
                <th scope="col" className="py-2 pr-3 text-right font-bold">± 1σ</th>
                <th scope="col" className="py-2 text-right font-bold">True</th>
              </tr>
            </thead>
            <tbody className="font-mono text-[13px]">
              {counts1.map((k, i) => (
                <tr key={k.axis} className="border-b border-line">
                  <th scope="row" className="py-2 pr-3 text-left font-sans font-semibold text-ink">
                    ⟨{k.axis}⟩
                  </th>
                  <td className="py-2 pr-3 text-right text-ink-secondary">{fmtShots(k.plus)}</td>
                  <td className="py-2 pr-3 text-right text-ink-secondary">{fmtShots(k.minus)}</td>
                  <td className="py-2 pr-3 text-right text-q-teal-text">{est.vector[i] >= 0 ? '+' : ''}{f3(est.vector[i])}</td>
                  <td className="py-2 pr-3 text-right text-ink-muted">{f3(est.stderr[i])}</td>
                  <td className="py-2 text-right text-q-violet-text">{hidden ? '?' : `${truth[i] >= 0 ? '+' : ''}${f3(truth[i])}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[13px] text-ink-secondary">
          Estimated Bloch vector length {f3(est.length)}
          {est.length > 1 ? (
            <>
              {' '}
              — longer than 1, which no state can be. Nearest state: ({est.physical.map(f3).join(', ')}).
            </>
          ) : (
            '.'
          )}{' '}
          {!hidden && length < 1 ? `The true state is mixed, |r| = ${length.toFixed(2)}: the estimate should land inside the sphere too.` : null}
        </p>
      </div>

      <Explainer title="What you are doing when you do tomography">
        <p>
          A single qubit&rsquo;s state is a point on the Bloch sphere — three numbers, ⟨X⟩, ⟨Y⟩ and ⟨Z⟩.
          Measuring along Z once gives you one bit: up or down. It does not give you ⟨Z⟩, and it
          leaves the qubit as whichever eigenstate you got, so you cannot ask it anything else.
        </p>
        <p>
          The only way through is many identically prepared copies. Take N of them, measure along Z,
          and the fraction that came up is your estimate of (1 + ⟨Z⟩)/2. Do the same along X and Y
          with fresh copies. The three averages are the Bloch vector, and the whiskers on the bars
          above are the binomial standard error √((1 − r²)/N) on each one.
        </p>
        <p>
          Press <strong className="text-ink">Sweep N</strong>. Every time N goes up by a factor of
          100, the error goes down by a factor of 10 — the dots fall along the dashed line of slope
          −½. That is the same 1/√N a coin flip obeys, and there is no cleverer choice of three
          measurement axes that beats it for a state you know nothing about. Ten thousand copies buy
          you two decimal places.
        </p>
        <p>
          Try the <strong className="text-ink">hidden random state</strong> at N = 10 first, guess
          from the bars, then push N up and see when your guess would have been wrong. And drop the
          Bloch length below 1: a mixed state — one entangled with something else, or partly
          decohered — is an arrow inside the sphere, and tomography finds that too. The length of
          the arrow is not something any single copy carries.
        </p>
      </Explainer>

      {/* ── Section 2 · two qubits ── */}
      <div className="card mb-4 p-6">
        <h2 className="mb-1 text-lg font-bold">Two qubits, nine bases</h2>
        <p className="mb-4 text-[15px] leading-relaxed text-ink-secondary">
          Two qubits have fifteen unknowns. Measuring both in every pairing of X, Y and Z — nine
          experiments of N shots — yields all fifteen, and the density matrix is a formula away.
          The formula has a problem.
        </p>

        <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Segmented<TwoState> label="State to learn" value={twoState} options={TWO_OPTIONS} onChange={setTwoState} />
          <div>
            <Slider
              label="Shots per basis, N"
              value={twoExp}
              min={1}
              max={5}
              step={0.25}
              onChange={setTwoExp}
              format={() => fmtShots(twoShots)}
              hint="Nine bases, so 9N copies."
            />
            <div className="mt-3">
              <ButtonRow>
                <button type="button" className="btn-primary focus-ring" onClick={() => setTwoRun((r) => r + 1)}>
                  Measure again
                </button>
                {twoState === 'random' ? (
                  <button type="button" className="btn-ghost focus-ring" onClick={() => setTwoSeed((s) => s + 1)}>
                    New random state
                  </button>
                ) : null}
              </ButtonRow>
            </div>
          </div>
        </div>

        {/* Wide content scrolls inside its own box. */}
        <div className="-mx-2 overflow-x-auto px-2">
          <div className="flex gap-3" style={{ minWidth: 3 * 188 + 2 * 12 }}>
            <DensityMatrixChart rho={two.rho} title="True ρ" />
            <DensityMatrixChart rho={two.lin} title="Linear inversion" />
            <DensityMatrixChart rho={two.mle} title="After MLE fix" />
          </div>
        </div>
        <p className="mb-3 mt-1 text-[11px] text-ink-muted">
          Real parts as colour — teal positive, rose negative — with the imaginary part printed
          underneath when it is not zero. Rows and columns are |00⟩, |01⟩, |10⟩, |11⟩, first qubit
          on the left.
        </p>

        <EigenvalueChart linear={two.evLin} mle={two.evMle} truth={two.evTruth} />

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Smallest eigenvalue" value={f3(two.evLin[3])} accent={two.evLin[3] < -1e-6 ? 'rose' : 'teal'} />
          <Stat label="Trace dist. · linear" value={f3(two.dLin)} accent="sky" />
          <Stat label="Trace dist. · MLE" value={f3(two.dMle)} accent="teal" />
          <Stat
            label={two.psi ? 'Fidelity · MLE' : 'True purity'}
            value={two.psi && two.fMle !== null ? pct(two.fMle) : f3(two.purityTruth)}
            accent="violet"
          />
        </div>

        <div className="-mx-2 mt-4 overflow-x-auto px-2">
          <table className="w-full min-w-[420px] border-collapse text-left text-sm">
            <caption className="sr-only">Counts in each of the nine measurement bases.</caption>
            <thead>
              <tr className="border-b border-line text-[11px] uppercase tracking-wider text-ink-muted">
                <th scope="col" className="py-2 pr-3 font-bold">Basis</th>
                {OUTCOME_LABELS.map((l) => (
                  <th key={l} scope="col" className="py-2 pr-3 text-right font-bold">
                    {l}
                  </th>
                ))}
                <th scope="col" className="py-2 text-right font-bold">⟨AB⟩</th>
              </tr>
            </thead>
            <tbody className="font-mono text-[13px]">
              {two.counts.map((b) => {
                const n = b.counts.reduce((s, x) => s + x, 0)
                const e = (b.counts[0] - b.counts[1] - b.counts[2] + b.counts[3]) / n
                return (
                  <tr key={b.a + b.b} className="border-b border-line">
                    <th scope="row" className="py-2 pr-3 text-left font-sans font-semibold text-ink">
                      {b.a}⊗{b.b}
                    </th>
                    {b.counts.map((k, i) => (
                      <td key={i} className="py-2 pr-3 text-right text-ink-secondary">
                        {fmtShots(k)}
                      </td>
                    ))}
                    <td className="py-2 text-right text-q-teal-text">{e >= 0 ? '+' : ''}{f3(e)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <Explainer title="The unphysical eigenvalue, and the fix">
        <p>
          Linear inversion writes ρ = ¼ Σ ⟨σ_a ⊗ σ_b⟩ σ_a ⊗ σ_b and drops the measured averages
          straight in. Nothing in that formula knows that a density matrix must have eigenvalues
          between 0 and 1. For a pure state the true eigenvalues are 1, 0, 0, 0 — right at the
          edge — so the statistical noise pushes some of them negative almost every time. Keep N at
          30 and press <strong className="text-ink">Measure again</strong>: the rose bar in the
          middle row is a probability less than zero. Predict a measurement with that matrix and you
          can get a negative count.
        </p>
        <p>
          The simple fix is the one Smolin, Gambetta and Smith gave in 2012: keep the eigenvectors,
          set the most negative eigenvalue to zero, share what you removed equally among the others,
          and repeat until nothing is negative. That is the maximum-likelihood state when the noise is
          Gaussian, and it is also the closest physical matrix to the linear-inversion one. It never
          moves you further from the truth — the bottom row is always at least as good as the middle
          one in Hilbert–Schmidt distance, and usually better in trace distance too.
        </p>
        <p>
          Then push N to 100,000 and the problem goes away on its own — both estimates land on the
          true matrix to three decimals, and the fix has nothing left to do. Tomography is honest at
          large N and needs help at small N, which is where every real experiment lives: fifteen
          numbers for two qubits, 4ⁿ − 1 for n, each needing its own N. Full tomography of ten qubits
          is a million parameters. Nobody does it.
        </p>
      </Explainer>

      {/* ── Section 3 · no-cloning ── */}
      <div className="card mb-4 p-6">
        <h2 className="mb-1 text-lg font-bold">Try to build a cloner</h2>
        <p className="mb-4 text-[15px] leading-relaxed text-ink-secondary">
          Tomography would be trivial if you could copy the state first. Here is the bench: q0
          carries an unknown |ψ⟩, q1 starts blank in |0⟩, q2 is a spare you may use. Build any
          circuit and it is tested on |0⟩, |1⟩ and a third state of your choosing.
        </p>

        <div className="mb-4">
          <Segmented<CandidatePresetId | 'custom'>
            label="Candidate circuit"
            value={activePreset}
            options={presetOptions}
            onChange={(id) => {
              const p = CANDIDATE_PRESETS.find((x) => x.id === id)
              if (p) setGates(toEditor(p.ops))
            }}
          />
          {activePreset !== 'custom' ? (
            <p className="mt-2 text-[12px] text-ink-muted">{CANDIDATE_PRESETS.find((p) => p.id === activePreset)?.summary}</p>
          ) : null}
        </div>

        <div role="group" aria-label="Add a gate" className="mb-3 flex flex-wrap gap-1">
          {PALETTE.map((name) => (
            <button
              key={name}
              type="button"
              className="btn-ghost focus-ring min-h-[36px] px-2.5 font-mono text-xs"
              aria-label={`Add ${GATE_BY_NAME[name].label} gate`}
              title={GATE_BY_NAME[name].description}
              onClick={() => addGate(name)}
            >
              + {GATE_BY_NAME[name].label}
            </button>
          ))}
        </div>

        <ol aria-label="Gates in the candidate circuit, in order" className="mb-3 flex flex-col gap-1.5">
          {gates.length === 0 ? (
            <li className="rounded-lg border border-dashed border-line px-3 py-2 text-[12px] text-ink-muted">
              No gates. The blank qubit stays blank.
            </li>
          ) : null}
          {gates.map((g, i) => (
            <li key={g.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2">
              <span className="w-6 font-mono text-[11px] text-ink-muted" aria-hidden>
                {i + 1}.
              </span>
              <span className="w-12 font-mono text-[13px] font-bold text-ink">{GATE_BY_NAME[g.name].label}</span>
              {g.qubits.map((q, k) => (
                <label key={k} className="flex items-center gap-1 text-[12px] text-ink-secondary">
                  <span>{g.qubits.length === 1 ? 'on' : k < g.qubits.length - 1 ? (g.name === 'SWAP' ? 'swap' : 'ctrl') : g.name === 'SWAP' ? 'with' : 'target'}</span>
                  <select
                    aria-label={`Gate ${i + 1} ${GATE_BY_NAME[g.name].label}, ${g.qubits.length === 1 ? 'qubit' : k < g.qubits.length - 1 ? `control ${k + 1}` : 'target'}`}
                    className="focus-ring rounded border border-line bg-surface-3 px-1.5 py-1 font-mono text-[12px] text-ink"
                    value={q}
                    onChange={(e) => {
                      const qs = g.qubits.slice()
                      qs[k] = parseInt(e.target.value, 10)
                      updateGate(g.id, { qubits: qs })
                    }}
                  >
                    {QUBIT_NAMES.map((n, idx) => (
                      <option key={idx} value={idx}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
              {ANGLE_GATES.has(g.name) ? (
                <label className="flex items-center gap-1 text-[12px] text-ink-secondary">
                  <span>θ</span>
                  <input
                    type="number"
                    aria-label={`Gate ${i + 1} ${g.name} angle in degrees`}
                    className="focus-ring w-24 rounded border border-line bg-surface-3 px-1.5 py-1 font-mono text-[12px] text-ink"
                    step="any"
                    value={Number(((g.theta ?? 0) / DEG).toFixed(3))}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value)
                      if (Number.isFinite(v)) updateGate(g.id, { theta: v * DEG })
                    }}
                  />
                  <span>°</span>
                </label>
              ) : null}
              <span className="ml-auto flex gap-1">
                <button type="button" className="btn-ghost focus-ring px-2 text-xs" aria-label={`Move gate ${i + 1} earlier`} onClick={() => moveGate(g.id, -1)} disabled={i === 0}>
                  ↑
                </button>
                <button type="button" className="btn-ghost focus-ring px-2 text-xs" aria-label={`Move gate ${i + 1} later`} onClick={() => moveGate(g.id, 1)} disabled={i === gates.length - 1}>
                  ↓
                </button>
                <button type="button" className="btn-ghost focus-ring px-2 text-xs" aria-label={`Remove gate ${i + 1}`} onClick={() => removeGate(g.id)}>
                  ✕
                </button>
              </span>
            </li>
          ))}
        </ol>
        {opsError ? (
          <p role="alert" className="mb-3 rounded-lg border border-q-rose/30 bg-q-rose/10 px-3 py-2 text-[13px] text-q-rose-text">
            {opsError}
          </p>
        ) : null}

        <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Slider
            label="Probe state, angle from |0⟩"
            value={probeTheta}
            min={0}
            max={180}
            step={1}
            onChange={setProbeTheta}
            format={(v) => `${v.toFixed(0)}°`}
            hint="90° with φ = 0 is |+⟩. Anything strictly between 0° and 180° is non-orthogonal to both basis states."
          />
          <Slider
            label="Probe phase φ"
            value={probePhi}
            min={0}
            max={360}
            step={1}
            onChange={setProbePhi}
            format={(v) => `${v.toFixed(0)}°`}
            hint="Rotates the probe around the z axis; 90° at θ = 90° is |+i⟩."
          />
        </div>

        {verdict ? (
          <>
            <div className="-mx-2 overflow-x-auto px-2">
              <table className="w-full min-w-[480px] border-collapse text-left text-sm">
                <caption className="sr-only">
                  Clone fidelities for the three test inputs: joint fidelity of the output pair with two
                  copies, and the fidelity of each output on its own.
                </caption>
                <thead>
                  <tr className="border-b border-line text-[11px] uppercase tracking-wider text-ink-muted">
                    <th scope="col" className="py-2 pr-3 font-bold">Input</th>
                    <th scope="col" className="py-2 pr-3 text-right font-bold">Pair = |ψ⟩|ψ⟩</th>
                    <th scope="col" className="py-2 pr-3 text-right font-bold">q0 alone</th>
                    <th scope="col" className="py-2 text-right font-bold">q1 alone</th>
                  </tr>
                </thead>
                <tbody className="font-mono text-[13px]">
                  <FidelityRow name="|0⟩" r={verdict.f0} />
                  <FidelityRow name="|1⟩" r={verdict.f1} />
                  <FidelityRow name={`probe, ${probeTheta}° · direct run`} r={verdict.test} />
                  <FidelityRow name="probe · from linearity" r={verdict.predicted} />
                </tbody>
              </table>
            </div>

            <div className="mt-4 rounded-lg border border-line bg-surface-2 p-4 text-[14px] leading-relaxed text-ink-secondary">
              {verdict.status === 'fails-basis' ? (
                <p>
                  <strong className="text-q-rose-text">Not even a basis cloner.</strong> On |0⟩ and |1⟩
                  the pair comes out as two copies with fidelity {f3(verdict.f0.joint)} and{' '}
                  {f3(verdict.f1.joint)}. The linearity argument does not need to run — but look at the
                  per-qubit columns: a circuit can make one good output ({f3(Math.max(verdict.test.original, verdict.test.copy))} on the
                  probe) at the expense of the other, and the Bužek–Hillery preset makes two
                  outputs of 5/6 each, which is the best any machine can do for every input at once.
                </p>
              ) : verdict.status === 'passes-all' ? (
                <p>
                  <strong className="text-q-amber-text">Everything copied — because the probe is not a
                  test.</strong> At {probeTheta}° the probe is |0⟩ or |1⟩ itself, and an orthogonal pair
                  can be cloned. Move the angle anywhere strictly between 0° and 180°.
                </p>
              ) : (
                <p>
                  <strong className="text-q-teal-text">Copies |0⟩ and |1⟩ perfectly — and that is
                  exactly why it fails on the probe.</strong> The circuit&rsquo;s output on{' '}
                  cos(θ/2)|0⟩ + e<sup>iφ</sup>sin(θ/2)|1⟩ is fixed by linearity before it runs: it must
                  be cos(θ/2)·U|0,00⟩ + e<sup>iφ</sup>sin(θ/2)·U|1,00⟩, a superposition of the two
                  basis outputs. That state has pair fidelity {f3(verdict.predicted.joint)} with
                  |ψ⟩|ψ⟩; the direct run gives {f3(verdict.test.joint)}, the same to{' '}
                  {verdict.linearityGap.toExponential(1)}. At 90° the ceiling for any basis-perfect
                  cloner is ½. No rearrangement of gates changes this, because every circuit is
                  linear.
                </p>
              )}
            </div>
          </>
        ) : null}

        <div className="mt-4">
          <CloneFidelityChart curve={curve} bound={bound} markerDeg={probeTheta} />
        </div>
        <p className="mt-1 text-[11px] text-ink-muted">
          Sweeping the probe from |0⟩ to |1⟩ at the chosen φ. The violet ceiling is
          (cos³(θ/2) + sin³(θ/2))² — what linearity allows any machine that copies the basis states
          perfectly. The amber line is 5/6, the best a machine can do on every state at once.
        </p>
      </div>

      <Explainer title="Why no circuit can do it">
        <p>
          Suppose a machine U copied two states: U|ψ⟩|0⟩ = |ψ⟩|ψ⟩ and U|φ⟩|0⟩ = |φ⟩|φ⟩. Take the inner
          product of the two equations. The left side gives ⟨ψ|φ⟩ because U preserves inner
          products; the right side gives ⟨ψ|φ⟩². A number equal to its own square is 0 or 1: the
          states were orthogonal, or they were the same state. Anything in between — |0⟩ and |+⟩,
          say — cannot both be copied by the same machine. That is the whole proof; it was written
          down by Wootters and Zurek and by Dieks in 1982, on one page each.
        </p>
        <p>
          The bench above is that proof made physical. The CNOT copier is a perfectly good cloner of
          |0⟩ and |1⟩ — that is all a classical copier ever had to be. Fed |+⟩ it produces a Bell
          pair, and a Bell pair is not two |+⟩s: each half on its own is a coin flip, fidelity ½ with
          everything. The <em>from linearity</em> row is computed without running the circuit on the
          probe at all, just by adding the |0⟩ and |1⟩ outputs with the probe&rsquo;s amplitudes. It
          matches the direct run to fifteen decimals. There is nothing to tune.
        </p>
        <p>
          Which is why tomography costs what it costs. If one copy could be turned into a thousand,
          a single qubit would carry unlimited classical information and the error bars in the first
          section would be a choice rather than a law. The 1/√N you measured up there and the ½ you
          measured down here are the same fact from two sides.
        </p>
      </Explainer>

      <Explainer title="What is and isn't real here">
        <p>
          The measurement statistics are exact Born-rule sampling from the stated density matrix, with
          no detector noise, no state-preparation error and no drift between shots — so the only thing
          in the error bars is finite N. Real tomography adds all three, and gauge ambiguities between
          them are a research field of their own. The maximum-likelihood fix shown is the closed-form
          projection; iterative MLE with full multinomial likelihoods, compressed sensing and
          shadow tomography all exist and all scale better than the nine-basis brute force here.
        </p>
        <p>
          The no-cloning bench tests unitary circuits only. Measure-and-prepare strategies are also
          allowed in principle and also fail — an optimal one reaches 2/3 per copy against the
          universal cloner&rsquo;s 5/6 — but this page does not simulate them. The numbers you see
          are checked in{' '}
          <code className="mx-1 rounded bg-surface-3 px-1 py-0.5 text-[12px]">lib/quantum/tomography.test.ts</code>{' '}
          and{' '}
          <code className="mx-1 rounded bg-surface-3 px-1 py-0.5 text-[12px]">lib/quantum/noCloning.test.ts</code>{' '}
          against the binomial error formula, the hand-written Bell-state Pauli table, the
          Smolin–Gambetta–Smith worked spectra, the ½ of the CNOT copier on |+⟩ and the 5/6 of the
          Bužek–Hillery network.
        </p>
      </Explainer>
    </VizFrame>
  )
}
