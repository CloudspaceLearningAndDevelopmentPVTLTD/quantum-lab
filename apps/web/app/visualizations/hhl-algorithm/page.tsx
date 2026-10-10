'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import HHLLab from '@/components/viz/HHLLab'
import { VizFrame, Explainer } from '@/components/ui/VizFrame'
import { Slider, ButtonRow, Stat } from '@/components/ui/Controls'
import {
  C_CONST,
  MATRIX_A,
  ancillaProbabilities,
  classicalSolve,
  clockProbabilities,
  clockReadingForEigenvalue,
  eigenSym2x2,
  extractSolution,
  hhlStages,
  normalize2,
  rotationAngle,
  stateProbabilities,
} from '@/lib/viz/hhl'

const pct = (p: number) => `${(p * 100).toFixed(1)}%`
const fmt = (v: number, digits = 4) => (Object.is(v, -0) ? 0 : v).toFixed(digits)

export default function HhlAlgorithmPage() {
  const [stage, setStage] = useState(0)

  // The circuit is fixed (A and b are chosen for an exact, checkable demo —
  // see lib/viz/hhl.ts), so it is built once, not on every render.
  const stages = useMemo(() => hhlStages(), [])
  const safeStage = Math.min(stage, stages.length - 1)
  const current = stages[safeStage]
  const atEnd = safeStage === stages.length - 1

  const eigenPairs = useMemo(() => eigenSym2x2(MATRIX_A), [])
  const eigenvalueReadings = useMemo(
    () =>
      eigenPairs
        .map((e) => ({ y: clockReadingForEigenvalue(e.value), lambda: e.value }))
        .filter((e): e is { y: number; lambda: number } => e.y !== null),
    [eigenPairs]
  )
  const classical = useMemo(() => classicalSolve(), [])
  const classicalNorm = useMemo(() => normalize2(classical), [classical])

  const clockProbs = useMemo(() => clockProbabilities(current.state), [current])
  const ancillaProbs = useMemo(() => ancillaProbabilities(current.state), [current])
  const stateProbs = useMemo(() => stateProbabilities(current.state), [current])

  const solution = useMemo(() => {
    if (!atEnd) return null
    try {
      return extractSolution(current.state)
    } catch {
      return null
    }
  }, [current, atEnd])

  // Sign is the one thing HHL's amplitude and the "canonical" classical vector
  // can legitimately disagree on — both describe the same physical line, and
  // a global sign is not observable. Align before comparing componentwise.
  const alignedSign =
    solution && Math.sign(solution.amplitudes[0]) !== Math.sign(classicalNorm[0]) ? -1 : 1

  const stageLabel = `${safeStage + 1}/${stages.length} · ${current.title}`

  const controls = (
    <>
      <Slider
        label="Stage"
        value={safeStage}
        min={0}
        max={stages.length - 1}
        step={1}
        onChange={(v) => setStage(Math.round(v))}
        format={() => stageLabel}
        hint="Arrow keys walk the circuit one gate layer at a time."
      />

      <ButtonRow>
        <button
          type="button"
          className="btn-primary focus-ring"
          onClick={() => setStage((s) => Math.min(s + 1, stages.length - 1))}
          disabled={atEnd}
        >
          Next stage
        </button>
        <button
          type="button"
          className="btn-ghost focus-ring"
          onClick={() => setStage((s) => Math.max(0, s - 1))}
          disabled={safeStage === 0}
        >
          Back
        </button>
        <button type="button" className="btn-ghost focus-ring" onClick={() => setStage(0)}>
          Restart
        </button>
      </ButtonRow>

      <div className="grid grid-cols-2 gap-2">
        <Stat label="A" value="1.5I + 0.5X" accent="violet" />
        <Stat label="Condition number" value="2" accent="teal" />
        <Stat label="Eigenvalues" value="1, 2" accent="sky" />
        <Stat label="Rotation const. C" value={`${C_CONST}`} accent="amber" />
        <Stat label="P(state = 1)" value={pct(stateProbs[1])} accent="violet" />
        <Stat label="P(ancilla = 1)" value={pct(ancillaProbs[1])} accent="amber" />
      </div>

      <p className="text-[11px] leading-relaxed text-ink-muted">
        A = [[1.5, 0.5], [0.5, 1.5]], b = |0⟩. Chosen so both of A&rsquo;s eigenvalues land
        exactly on the clock register&rsquo;s grid — see &ldquo;What this simulation does not
        show&rdquo; below for what that buys and what it costs.
      </p>
    </>
  )

  return (
    <VizFrame
      title="The HHL Algorithm"
      tagline="Solve Ax = b without ever computing x — quantum phase estimation reads A's eigenvalues into a register, a controlled rotation divides by them, and the answer comes back as a state, not a list of numbers."
      level="Advanced"
      canvas={
        <div className="p-2">
          <HHLLab
            clockProbabilities={clockProbs}
            ancillaProbabilities={ancillaProbs}
            eigenvalueReadings={eigenvalueReadings}
            caption={stageLabel}
          />
          <p className="px-3 pb-2 pt-1 text-[11px] leading-relaxed text-ink-muted">
            Top: the ancilla&rsquo;s measurement odds — flat until the rotation stage, because
            nothing before it touches this qubit. Bottom: the clock register, running phase
            estimation on an operator with two eigenvalues in superposition at once.
          </p>
        </div>
      }
      controls={controls}
    >
      <section className="card mb-4 p-6">
        <h2 className="mb-1 text-lg font-bold">
          Stage {safeStage + 1} of {stages.length}: {current.title}
        </h2>
        <p className="text-[15px] leading-relaxed text-ink-secondary">{current.detail}</p>
      </section>

      <section className="card mb-4 p-6">
        <h2 className="mb-3 text-lg font-bold">The state register, right now</h2>
        <p className="mb-4 text-[13px] text-ink-secondary">
          Marginal probabilities — honest even while this qubit is entangled with the clock
          register, which it is for most of the run. The exact (generally complex) joint
          amplitudes are what the engine actually simulates; this is the one number about them
          that survives tracing out the rest of the circuit.
        </p>
        <div className="space-y-2">
          {(['|0⟩', '|1⟩'] as const).map((label, i) => (
            <div key={label} className="flex items-center gap-3">
              <span className="w-10 shrink-0 font-mono text-sm text-ink-secondary">{label}</span>
              <div className="h-5 flex-1 overflow-hidden rounded bg-surface-2">
                <div
                  className="h-full rounded bg-q-violet transition-[width] duration-300"
                  style={{ width: `${Math.max(0, Math.min(100, stateProbs[i] * 100))}%` }}
                />
              </div>
              <span className="w-14 shrink-0 text-right font-mono text-xs text-ink-muted">
                {pct(stateProbs[i])}
              </span>
            </div>
          ))}
        </div>
      </section>

      {atEnd ? (
        <section className="card mb-4 border border-q-amber/30 bg-q-amber/5 p-6">
          <h2 className="mb-1 text-lg font-bold">
            Post-selected on ancilla = 1 ({pct(ancillaProbs[1])} of runs)
          </h2>
          <p className="mb-4 text-[13px] leading-relaxed text-ink-secondary">
            This is the payoff — and the honest version of it. Among the runs where the ancilla
            reads |1⟩, the state register holds a vector proportional to A⁻¹b. Nothing here reads
            x back out classically; the table below compares the STATE&rsquo;s amplitudes to the
            classically-solved answer to show they line up, which is a check on the simulator, not
            a way to extract x cheaply on real hardware.
          </p>
          {solution ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">
                  HHL&rsquo;s post-selected state register amplitudes compared to the classical
                  solution of Ax = b, normalized.
                </caption>
                <thead>
                  <tr className="border-b border-line text-[11px] uppercase tracking-wider text-ink-muted">
                    <th className="py-2 text-left font-bold" scope="col">
                      Component
                    </th>
                    <th className="py-2 text-right font-bold" scope="col">
                      Quantum (normalized)
                    </th>
                    <th className="py-2 text-right font-bold" scope="col">
                      Classical A⁻¹b (normalized)
                    </th>
                    <th className="py-2 text-right font-bold" scope="col">
                      Difference
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {[0, 1].map((i) => {
                    const q = alignedSign * solution.amplitudes[i]
                    const c = classicalNorm[i]
                    return (
                      <tr key={i} className="border-b border-line last:border-0">
                        <td className="py-2 font-mono text-q-violet-text">|{i}⟩</td>
                        <td className="py-2 text-right font-mono text-ink-secondary">{fmt(q)}</td>
                        <td className="py-2 text-right font-mono text-ink-secondary">{fmt(c)}</td>
                        <td className="py-2 text-right font-mono text-q-teal-text">
                          {fmt(Math.abs(q - c), 6)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <p className="mt-4 text-[12px] text-ink-muted">
                Classical solve: A⁻¹b = ({fmt(classical[0], 3)}, {fmt(classical[1], 3)}), unnormalized.
                Residual clock-register leakage on this run:{' '}
                {solution.residualClockLeakage.toExponential(2)} — the theoretical value is exactly
                0, because both of A&rsquo;s eigenvalues land on the clock grid with no phase
                estimation error.
              </p>
            </div>
          ) : (
            <p className="text-sm text-q-rose-text">
              This run&rsquo;s ancilla has ~zero probability of reading 1 — nothing to extract.
            </p>
          )}
        </section>
      ) : null}

      <Explainer title="What HHL actually promises">
        <p>
          HHL does not hand you the numbers in x. It prepares a quantum state proportional to x,
          on {' '}<code>log₂(dimension)</code> qubits instead of the dimension itself — the source
          of its famous exponential speedup over classically solving Ax = b when A is sparse and
          well-conditioned. But a quantum state is not a spreadsheet: reading out every component
          of x classically means tomography, and tomography on an n-qubit state costs
          exponentially many measurements in n. What HHL is actually good for is folding the
          solution into a LARGER quantum computation — a single number extracted from x, like
          xᵀMx for some observable M — where the exponential number of components never has to be
          read out one at a time. Treat any claim that HHL &ldquo;solves linear systems
          exponentially faster,&rdquo; full stop, as the oversimplification it is.
        </p>
      </Explainer>

      <Explainer title="The controlled rotation — the step that divides">
        <p>
          Phase estimation writes an eigenvalue λ into the clock register as a binary number; the
          rotation stage is what turns &ldquo;a number written down&rdquo; into &ldquo;1/λ,
          multiplied into an amplitude.&rdquo; It rotates the ancilla by an angle θ(λ) with{' '}
          sin(θ/2) = C/λ, controlled on the clock register reading that exact λ — so eigenvalue 1
          gets sin(θ/2) = {fmt(rotationAngle(1) ? Math.sin(rotationAngle(1) / 2) : 0, 2)} (a full
          π rotation) and eigenvalue 2 gets sin(θ/2) = {fmt(Math.sin(rotationAngle(2) / 2), 2)} — a
          bigger eigenvalue always gets a smaller rotation, and therefore a smaller chance of
          flipping the ancilla to |1⟩. That is the division, written as trigonometry: amplitude
          sin(θ/2) is exactly C/λ, which is the only place a reciprocal appears anywhere in this
          circuit.
        </p>
        <p>
          C has to be small enough that C/λ ≤ 1 for the smallest eigenvalue the clock register can
          read — this page sets C to that smallest eigenvalue exactly, which is also what makes
          the overall success probability as large as this fixed-C scheme allows. A matrix with a
          much smaller eigenvalue mixed in with much larger ones forces C down for everyone, which
          is the trigonometric fingerprint of HHL&rsquo;s well-known sensitivity to A&rsquo;s
          condition number: the ratio of the largest eigenvalue to the smallest.
        </p>
      </Explainer>

      <Explainer title="Where this sits in the arc">
        <p>
          <Link href="/visualizations/phase-estimation" className="focus-ring text-q-teal-text underline">
            Quantum phase estimation
          </Link>{' '}
          is the engine inside stages 2–4 of this page, run on U = e^{'{'}iAt{'}'}. That page shows
          QPE on a SINGLE eigenvector; this page runs it on |b⟩, which is a superposition of two
          of A&rsquo;s eigenvectors at once — QPE entangles each with its own eigenvalue in the
          clock register, which is exactly the two-peak distribution the canvas above draws. The{' '}
          <Link href="/visualizations/qft" className="focus-ring text-q-teal-text underline">
            quantum Fourier transform
          </Link>{' '}
          page shows the gate-by-gate machinery — Hadamards and controlled phases — that both the
          forward QFT (in the uncompute half of this circuit) and its inverse (right after the
          kickback) are built from.
        </p>
      </Explainer>

      <Explainer title="What this simulation does not show">
        <p>
          A is restricted here to c₀·I + c₁·X — a real, symmetric 2×2 matrix with equal diagonal
          entries — because that makes e^{'{'}iAt{'}'} exactly a global phase times an RX rotation,
          a gate this engine already has. A general Hermitian matrix needs Hamiltonian
          simulation — approximating e^{'{'}iAt{'}'} by Trotterization or another product formula —
          which is itself a nontrivial algorithm with its own error budget. Nothing here is
          Trotterized: every gate applied is the exact unitary, which is what makes the numeric
          check against the classical solve exact to floating-point precision rather than
          approximate.
        </p>
        <p>
          The evolution time and clock register size are also hand-picked so both of A&rsquo;s
          eigenvalues land exactly on the clock register&rsquo;s 2-bit grid. A generic matrix
          gives phase estimation an eigenvalue that is NOT an exact binary fraction — exactly the
          case the{' '}
          <Link href="/visualizations/phase-estimation" className="focus-ring text-q-teal-text underline">
            phase estimation page
          </Link>
          &rsquo;s precision section covers — which spreads each eigenvalue&rsquo;s weight across
          a few neighbouring clock readings instead of one, and would need more clock qubits to
          resolve them apart in the first place. Finally, preparing |b⟩ is treated as free: for
          this specific b it costs nothing (see the &ldquo;Prepare |b⟩&rdquo; stage), but preparing
          an arbitrary n-qubit |b⟩ in general is its own hard problem that HHL assumes is already
          solved.
        </p>
      </Explainer>
    </VizFrame>
  )
}
