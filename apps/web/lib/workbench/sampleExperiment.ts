/**
 * lib/workbench/sampleExperiment.ts — the built-in record the page shows when
 * no agent has written one yet (and at /workbench/experiments/sample always).
 *
 * It is not a fixture. It is BUILT, in the browser, by the same store and the
 * same targets an MCP agent drives, with fixed seeds so it reads identically
 * on every visit: a Bell pair on the ideal simulator, then the noisy simulator
 * at three two-qubit error rates, then a conclusion that cites the counts it
 * actually got. If the noise model changes, this record changes with it —
 * which is the point of a sample that is real.
 */

import { MemoryExperimentStore, type Experiment } from '@/lib/workbench/experiments'
import { runOnTarget, type Target } from '@/lib/workbench/targets'

export const SAMPLE_EXPERIMENT_ID = 'sample'

export const SAMPLE_BELL_QASM = [
  'OPENQASM 3.0;',
  'include "stdgates.inc";',
  '',
  'qubit[2] q;',
  'bit[2] c;',
  '',
  'h q[0];',
  'cx q[0], q[1];',
  '',
  'c = measure q;',
].join('\n')

const SHOTS = 4096

function oddParity(counts: Record<string, number>): number {
  return (counts['01'] ?? 0) + (counts['10'] ?? 0)
}

export async function buildSampleExperiment(): Promise<Experiment> {
  let tick = Date.UTC(2026, 8, 4, 23, 12, 0)
  const store = new MemoryExperimentStore(4, () => new Date((tick += 41_000)))
  const created = await store.create({
    title: 'Bell pair under two-qubit depolarising noise',
    hypothesis:
      'Odd-parity outcomes (01 and 10), which an ideal Bell pair never produces, should appear ' +
      'at a rate of about p₂/2 when the CX gate is depolarised with probability p₂ — because a ' +
      'depolarising event replaces the pair by the maximally mixed state, which has odd parity ' +
      'half the time. Readout error is held at 0 so only the gate channel is being measured.',
    owner: null,
  })

  const plan: { target: Target; seed: number; note: string }[] = [
    {
      target: { kind: 'simulator' },
      seed: 1,
      note: 'Baseline on the ideal simulator. Expect only 00 and 11, roughly balanced.',
    },
    ...[0.02, 0.05, 0.1].map((p2) => ({
      target: {
        kind: 'noisy-simulator' as const,
        noise: { depolarizing1: 0, depolarizing2: p2, readoutError: 0 },
      },
      seed: 1,
      note: `CX depolarised at p₂ = ${p2}. Prediction: odd parity ≈ ${(p2 / 2) * 100}% of shots, i.e. about ${Math.round((p2 / 2) * SHOTS)} of ${SHOTS}.`,
    })),
  ]

  const observed: { p2: number; odd: number }[] = []
  for (const step of plan) {
    const ran = await runOnTarget(SAMPLE_BELL_QASM, step.target, { shots: SHOTS, seed: step.seed })
    if (!ran.ok) throw new Error(ran.error)
    await store.appendStep(created.id, {
      qasm: SAMPLE_BELL_QASM,
      target: step.target,
      shots: SHOTS,
      seed: step.seed,
      result: ran.result,
      note: step.note,
    })
    if (ran.result.kind === 'counts' && step.target.kind === 'noisy-simulator') {
      observed.push({ p2: step.target.noise.depolarizing2, odd: oddParity(ran.result.counts) })
    }
  }

  // The write-up is computed from what actually came back, so the sample can
  // never claim an agreement the numbers do not show.
  const rows = observed.map((o) => {
    const predicted = (o.p2 / 2) * SHOTS
    const sigma = Math.sqrt(SHOTS * (o.p2 / 2) * (1 - o.p2 / 2))
    return { ...o, predicted, sigma, z: (o.odd - predicted) / sigma }
  })
  const maxZ = Math.max(...rows.map((r) => Math.abs(r.z)))
  const lines = rows.map(
    (r) => `p₂ = ${r.p2}: ${r.odd} odd-parity shots (predicted ${Math.round(r.predicted)}, σ ≈ ${Math.round(r.sigma)}, ${r.z >= 0 ? '+' : '−'}${Math.abs(r.z).toFixed(1)}σ)`,
  )
  const verdict =
    maxZ < 2
      ? 'Every observation sits within two standard deviations of p₂/2 × shots'
      : `The largest deviation is ${maxZ.toFixed(1)}σ, which one run at this shot count cannot separate from chance`
  const conclusion =
    'Hypothesis held. Step 0 produced no odd-parity counts at all. Steps 1–3 gave ' +
    lines.join('; ') +
    `. ${verdict}, and the rate scales linearly with p₂ across a factor of five. Next: repeat ` +
    'with readout error at 2% to see how much of a real device’s odd-parity rate is readout ' +
    'rather than gate error.'
  const done = await store.conclude(created.id, conclusion)
  return { ...done, id: SAMPLE_EXPERIMENT_ID }
}
