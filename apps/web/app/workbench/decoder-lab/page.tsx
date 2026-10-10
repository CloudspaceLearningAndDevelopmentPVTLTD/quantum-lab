'use client'

import Link from 'next/link'
import { useCallback, useMemo, useState } from 'react'
import { Segmented, Slider, Toggle, ButtonRow, Stat } from '@/components/ui/Controls'
import { Explainer } from '@/components/ui/VizFrame'
import ThresholdChart, { CURVE_ORDER, CURVE_STYLE } from '@/components/workbench/decoder-lab/ThresholdChart'
import ShotInspector from '@/components/workbench/decoder-lab/ShotInspector'
import { useDecoderLab } from '@/components/workbench/decoder-lab/useDecoderLab'
import type { DecoderName, Distance } from '@/lib/qec/model'
import { rateWithInterval, thresholdGuide, type CurveKey } from '@/lib/qec/session'

/**
 * /workbench/decoder-lab — Decoder Lab.
 *
 * A reproducible, small-scale AlphaQubit: surface codes at d = 3, 5, 7 under a
 * tunable noise model, four decoders (lookup, MWPM, MLP, transformer), training
 * in a Web Worker under a visible budget, and the chart that matters — logical
 * versus physical error rate with the threshold crossing.
 *
 * All numerics live in lib/qec/. This file is controls, copy and layout.
 */

const DISTANCES: Distance[] = [3, 5, 7]
const SAMPLE_BUDGETS = [10_000, 30_000, 100_000] as const
const SECOND_BUDGETS = [15, 30, 60] as const
const SWEEP_SHOTS = [500, 1_000, 3_000] as const
const BATCH = 32

const pct = (r: number, digits = 2) => `${(r * 100).toFixed(digits)}%`

const DECODER_LABEL: Record<DecoderName, string> = {
  lookup: 'Lookup table',
  mwpm: 'MWPM',
  mlp: 'MLP',
  transformer: 'Transformer',
}

export default function DecoderLabPage() {
  const [d, setD] = useState<Distance>(3)
  const [p, setP] = useState(0.08)
  const [q, setQ] = useState(0)
  const [useLookup, setUseLookup] = useState(true)
  const [useMlp, setUseMlp] = useState(true)
  const [useTransformer, setUseTransformer] = useState(true)
  const [sampleBudget, setSampleBudget] = useState<number>(30_000)
  const [secondBudget, setSecondBudget] = useState<number>(30)
  const [sweepShots, setSweepShots] = useState<number>(1_000)
  const [seedCounter, setSeedCounter] = useState(1)

  const { state, run, stop, resweep, inspect } = useDecoderLab()
  const busy = state.phase !== 'idle'

  const decoders = useMemo<DecoderName[]>(() => {
    const out: DecoderName[] = []
    if (useLookup && d === 3) out.push('lookup')
    if (useMlp) out.push('mlp')
    if (useTransformer) out.push('transformer')
    return out
  }, [useLookup, useMlp, useTransformer, d])

  const seed = 0x2545f491 ^ (seedCounter * 0x9e3779b9) ^ (d * 7919) ^ Math.round(p * 1e5) ^ Math.round(q * 1e5)

  const onRun = useCallback(() => {
    run({
      config: { d, p, q },
      decoders,
      budget: { samples: sampleBudget, seconds: secondBudget, batch: BATCH },
      seed,
      sweepShots,
    })
    setSeedCounter((c) => c + 1)
  }, [run, d, p, q, decoders, sampleBudget, secondBudget, seed, sweepShots])

  const summary = state.summary
  const trainedD = summary?.config.d ?? d
  const trainedP = summary?.config.p ?? null
  const trainedQ = summary?.config.q ?? q
  const learnedSamples = summary
    ? Math.max(0, ...(['mlp', 'transformer', 'lookup'] as DecoderName[]).map((n) => summary.samples[n] ?? 0))
    : null
  const guide = thresholdGuide(trainedQ)

  // The point nearest the training p, for the headline stats.
  const nearest = useMemo(() => {
    if (!trainedP || state.points.length === 0) return null
    return state.points
      .filter(Boolean)
      .reduce((best, pt) => (Math.abs(pt.p - trainedP) < Math.abs(best.p - trainedP) ? pt : best))
  }, [state.points, trainedP])

  const presentKeys = useMemo(() => {
    const set = new Set<CurveKey>()
    for (const pt of state.points) if (pt) for (const k of Object.keys(pt.curves)) set.add(k as CurveKey)
    return CURVE_ORDER.filter((k) => set.has(k))
  }, [state.points])

  const statusLine = (): string => {
    if (state.error) return `Error: ${state.error}`
    if (!state.ready) return 'Starting the worker…'
    if (state.phase === 'training') {
      const live = Object.values(state.progress).find((pr) => pr && !pr.done)
      if (live) {
        return `Training ${DECODER_LABEL[live.decoder]}: ${live.samples.toLocaleString('en-US')} of ${sampleBudget.toLocaleString('en-US')} samples, ${(live.elapsedMs / 1000).toFixed(1)} s of ${secondBudget} s${Number.isFinite(live.loss) ? `, loss ${live.loss.toFixed(3)}` : ''}.`
      }
      return 'Training…'
    }
    if (state.phase === 'sweeping') {
      const done = state.points.filter(Boolean).length
      return `Sweeping p: ${done} of ${state.sweepTotal || '…'} points measured, ${sweepShots.toLocaleString('en-US')} shots per decoder per point.`
    }
    if (summary) {
      const parts = (Object.keys(summary.samples) as DecoderName[]).map(
        (n) => `${DECODER_LABEL[n]} ${summary.samples[n]!.toLocaleString('en-US')} samples in ${((summary.elapsedMs[n] ?? 0) / 1000).toFixed(1)} s (${summary.stoppedBy[n] === 'seconds' ? 'time budget' : summary.stoppedBy[n] === 'user' ? 'stopped' : 'sample budget'})`
      )
      return `${state.stopped ? 'Stopped early. ' : 'Done. '}${parts.join('; ')}.`
    }
    return 'Idle. Pick a code, a noise level and a budget, then train.'
  }

  const controls = (
    <>
      <Segmented
        label="Code distance d"
        value={String(d)}
        options={DISTANCES.map((v) => ({ value: String(v), label: `d = ${v}` }))}
        onChange={(v) => setD(Number(v) as Distance)}
      />
      <Slider
        label="Depolarising rate p"
        value={p}
        min={0.005}
        max={0.3}
        step={0.005}
        format={(v) => pct(v, 1)}
        onChange={setP}
        hint="Per data qubit, per round: X, Y or Z with probability p/3 each. The learned decoders train at this p; the sweep varies it."
      />
      <Slider
        label="Measurement error q"
        value={q}
        min={0}
        max={0.05}
        step={0.005}
        format={(v) => (v === 0 ? 'off' : pct(v, 1))}
        onChange={setQ}
        hint="Above zero, each stabiliser outcome is flipped with probability q and the experiment runs d noisy rounds plus a perfect final round."
      />
      <div role="group" aria-label="Decoders to train" className="rounded-lg border border-line bg-surface-2 px-3 py-1">
        <span className="mt-1 block text-[13px] font-semibold text-ink-secondary">Decoders</span>
        <p className="text-[11px] text-ink-muted">MWPM always runs; it needs no training.</p>
        <Toggle
          label="Lookup table"
          checked={useLookup && d === 3}
          onChange={setUseLookup}
          hint={d === 3 ? 'Majority vote per syndrome. 256 keys at d = 3.' : 'd = 3 only: the table has 2^24 keys at d = 5.'}
        />
        <Toggle label="MLP" checked={useMlp} onChange={setUseMlp} hint="Two hidden layers of 64, both channels as input." />
        <Toggle
          label="Transformer"
          checked={useTransformer}
          onChange={setUseTransformer}
          hint="One token per stabiliser, width 16, two heads, two blocks. Slowest to train."
        />
      </div>
      <Segmented
        label="Sample budget per decoder"
        value={String(sampleBudget)}
        options={SAMPLE_BUDGETS.map((v) => ({ value: String(v), label: v.toLocaleString('en-US') }))}
        onChange={(v) => setSampleBudget(Number(v))}
      />
      <Segmented
        label="Time budget per decoder"
        value={String(secondBudget)}
        options={SECOND_BUDGETS.map((v) => ({ value: String(v), label: `${v} s` }))}
        onChange={(v) => setSecondBudget(Number(v))}
      />
      <Segmented
        label="Sweep shots per point"
        value={String(sweepShots)}
        options={SWEEP_SHOTS.map((v) => ({ value: String(v), label: v.toLocaleString('en-US') }))}
        onChange={(v) => setSweepShots(Number(v))}
      />
      <ButtonRow>
        <button type="button" className="btn-primary focus-ring" onClick={onRun} disabled={!state.ready || busy}>
          Train &amp; sweep
        </button>
        <button type="button" className="btn-ghost focus-ring" onClick={stop} disabled={!busy}>
          Stop
        </button>
        <button
          type="button"
          className="btn-ghost focus-ring"
          onClick={() => resweep(sweepShots, seed ^ 0x27d4eb2f)}
          disabled={!summary || busy}
        >
          Re-sweep
        </button>
      </ButtonRow>
      <p className="text-[11px] leading-relaxed text-ink-muted" role="status" aria-live="polite">
        {statusLine()}
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
        <span className="pill border border-q-teal/30 bg-q-teal/15 text-q-teal-text">train</span>
        <h1 className="mt-3 text-3xl font-extrabold tracking-tight md:text-4xl">Decoder Lab</h1>
        <p className="mt-2 max-w-2xl text-[15px] text-ink-secondary">
          Train a lookup table, an MLP and a small transformer to decode the surface code in your
          browser, and race them against minimum-weight perfect matching across the threshold.
          You leave with a logical-vs-physical error-rate chart you generated, and the numbers
          behind it.
        </p>
      </div>

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="card overflow-hidden" role="region" aria-labelledby="decoder-lab-chart">
          <h2 id="decoder-lab-chart" className="sr-only">
            Logical error rate against physical error rate
          </h2>
          <div className="p-2">
            <ThresholdChart
              points={state.points}
              d={trainedD}
              trainedAtP={trainedP}
              trainedSamples={learnedSamples}
              thresholdGuide={guide}
              ariaLabel={
                `Logical error rate against physical error rate, log scale, for MWPM at distances 3, 5 and 7` +
                (summary ? ` and the learned decoders at distance ${trainedD}, trained on ${learnedSamples?.toLocaleString('en-US')} samples at p = ${pct(trainedP ?? 0, 1)}` : '') +
                `. The same numbers are in the table below the chart.`
              }
            />
            <p className="px-3 pb-1 pt-1 text-[11px] leading-relaxed text-ink-muted">
              Sky lines are MWPM at d = 3, 5, 7, thin to thick: where the thick line stops being
              the lowest is the threshold. Coloured lines are the decoders you trained, at the
              trained distance only, with 95% bands. Open markers mean zero failures in the
              sample — an upper bound, not a rate. The dotted line is a bare, unencoded qubit.
            </p>
          </div>

          {/* Training progress: one labelled bar per decoder. */}
          {Object.keys(state.progress).length > 0 ? (
            <div className="border-t border-line px-4 py-3">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {(Object.values(state.progress).filter(Boolean)).map((pr) => (
                  <label key={pr.decoder} className="block text-[11px] text-ink-muted">
                    <span className="flex justify-between">
                      <span className="font-semibold text-ink-secondary">{DECODER_LABEL[pr.decoder]}</span>
                      <span className="font-mono">
                        {pr.samples.toLocaleString('en-US')} · {(pr.elapsedMs / 1000).toFixed(1)} s
                        {Number.isFinite(pr.loss) ? ` · loss ${pr.loss.toFixed(3)}` : ''}
                      </span>
                    </span>
                    <progress
                      className="mt-1 h-1.5 w-full"
                      max={sampleBudget}
                      value={pr.done ? sampleBudget : pr.samples}
                      aria-label={`${DECODER_LABEL[pr.decoder]} training progress`}
                    />
                  </label>
                ))}
              </div>
            </div>
          ) : null}

          {/* Headline stats at the training p. */}
          {nearest && trainedP !== null ? (
            <div className="border-t border-line px-4 py-3">
              <p className="mb-2 text-[11px] text-ink-muted">
                At p = {pct(nearest.p, 1)} (nearest sweep point to the training p), d = {trainedD},{' '}
                {nearest.curves[`mwpm-${trainedD}` as CurveKey]?.shots.toLocaleString('en-US')} shots each:
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {(['mwpm', 'lookup', 'mlp', 'transformer'] as DecoderName[]).map((name) => {
                  const key = (name === 'mwpm' ? `mwpm-${trainedD}` : name) as CurveKey
                  const c = nearest.curves[key]
                  if (!c) return null
                  const r = rateWithInterval(c)
                  return (
                    <Stat
                      key={name}
                      label={DECODER_LABEL[name]}
                      value={`${pct(r.rate)} ±${pct((r.hi - r.lo) / 2, 1)}`}
                      accent={name === 'mwpm' ? 'sky' : name === 'lookup' ? 'amber' : name === 'mlp' ? 'violet' : 'rose'}
                    />
                  )
                })}
              </div>
              {nearest.inexactFraction > 0 ? (
                <p className="mt-2 text-[11px] text-q-amber-text">
                  {pct(nearest.inexactFraction, 1)} of MWPM shots at this point used the heuristic fallback (a
                  defect cluster larger than 14): those matchings are near-optimal, not guaranteed optimal.
                </p>
              ) : null}
            </div>
          ) : null}

          {/* Data table: the accessible rendering of the chart. */}
          {presentKeys.length > 0 ? (
            <div className="overflow-x-auto border-t border-line px-4 py-3">
              <table className="w-full min-w-[520px] text-[11px]">
                <caption className="sr-only">Logical error rate per sweep point and decoder, with 95% Wilson intervals</caption>
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wider text-ink-muted">
                    <th scope="col" className="py-1 pr-3 font-bold">p</th>
                    {presentKeys.map((k) => (
                      <th scope="col" key={k} className="py-1 pr-3 font-bold">
                        {CURVE_STYLE[k].label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {state.points
                    .filter(Boolean)
                    .slice()
                    .sort((a, b) => a.p - b.p)
                    .map((pt) => (
                      <tr key={pt.p} className="border-t border-line font-mono">
                        <th scope="row" className="py-1 pr-3 text-left font-semibold text-ink-secondary">
                          {pct(pt.p, 1)}
                        </th>
                        {presentKeys.map((k) => {
                          const c = pt.curves[k]
                          if (!c) return <td key={k} className="py-1 pr-3 text-ink-muted">—</td>
                          const r = rateWithInterval(c)
                          return (
                            <td key={k} className="py-1 pr-3 text-ink">
                              {r.rate === 0 ? `<${pct(r.hi)}` : `${pct(r.rate)} [${pct(r.lo)}, ${pct(r.hi)}]`}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {/* Single-shot inspector. */}
          {summary ? (
            <div className="border-t border-line px-4 py-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-[13px] font-bold text-ink">One shot, every verdict</h3>
                <button
                  type="button"
                  className="btn-ghost focus-ring text-xs"
                  onClick={() => inspect((Date.now() ^ seed) >>> 0)}
                  disabled={busy}
                >
                  Sample a shot
                </button>
              </div>
              {state.shot ? (
                <ShotInspector report={state.shot} />
              ) : (
                <p className="text-[11px] text-ink-muted">
                  Draws one noisy shot at the training p, shows the errors and the fired
                  stabilisers on the lattice, and prints what each decoder concluded.
                </p>
              )}
            </div>
          ) : null}
        </section>

        <aside className="card p-4 sm:p-5" aria-labelledby="decoder-lab-controls">
          <h2 id="decoder-lab-controls" className="section-label mb-4">
            Controls
          </h2>
          <div className="flex flex-col gap-5">{controls}</div>
        </aside>
      </div>

      <div className="mt-10 max-w-3xl">
        <Explainer title="What this reproduces">
          <p>
            AlphaQubit (Bausch et al., <em>Nature</em> 2024) is a transformer that reads the
            detection events of a surface-code memory experiment and predicts whether the
            logical qubit flipped. It beat matching decoders on Google&rsquo;s Sycamore data at
            d = 3 and 5, after pretraining on hundreds of millions of simulated samples and
            fine-tuning on real hardware. This page is that experiment at the scale a browser
            tab can run: the same code family, the same task framing (predict the logical flip,
            not the error), a tokens-per-stabiliser attention decoder, and the same baseline —
            minimum-weight perfect matching, implemented exactly for these sizes.
          </p>
          <p>
            Everything you see was computed after you pressed the button. The noise is sampled
            live, the networks start from random weights, and the sweep re-decodes fresh shots
            at every p. Change the seed by pressing the button again; the plotted numbers will
            wobble by about their error bars and nothing else.
          </p>
        </Explainer>

        <Explainer title="How to read the chart">
          <p>
            Below the threshold, a bigger code is a better code: the d = 7 line sits under d = 5
            under d = 3, and each step down is roughly a constant factor. Above it the order
            inverts — more qubits means more places to fail and the decoder cannot keep up. The
            crossing is the threshold, and with perfect syndrome extraction it lands near 15%
            depolarising p (10.3% per Pauli channel, the textbook figure). Turn on measurement
            error and the crossing drops to a few percent, because the decoder must now also
            work out <em>when</em> an error happened.
          </p>
          <p>
            The learned decoders are plotted only at the distance you trained them for, because
            a network trained at d = 3 has no idea what a d = 5 syndrome means. They were trained
            at one p and are evaluated across the sweep unchanged — which is exactly how a
            trained decoder is deployed, and also why they can look worse far from the training
            point: the noise statistics they learned no longer match.
          </p>
          <p>
            What to expect on the default budget. At d = 3 the lookup table is the best
            decoder on the chart, and the MLP usually beats MWPM by a few percent relative,
            because both see the X and Z channels together and depolarising noise correlates
            them (a Y fires both), while matching decodes each channel alone. At d = 5 and 7,
            thirty thousand samples is nowhere near enough: the networks trail MWPM badly, and
            the transformer, which has to learn the lattice from position embeddings alone,
            trails the MLP. That is the honest shape of the problem — AlphaQubit needed on the
            order of 10<sup>8</sup> samples — and raising the budget moves the curves visibly.
          </p>
        </Explainer>

        <Explainer title="The four decoders">
          <p>
            <strong>Lookup table.</strong> A map from every detector pattern to the most common
            logical outcome seen after it. With enough samples it is the exact
            maximum-likelihood decoder for the trained noise; its test asserts this against a
            brute-force enumeration of all 4<sup>9</sup> error patterns at d = 3. It is d = 3
            only because the key space is 2<sup>d²−1</sup>.
          </p>
          <p>
            <strong>MWPM.</strong> Dijkstra over the space-time detector graph with
            log-likelihood edge weights, then an exact minimum-weight matching: defects are
            split into clusters that can be matched independently (pairing two defects is only
            worthwhile when it beats sending both to the boundary), and each cluster of up to 14
            is solved by a subset dynamic programme. Larger clusters — only far above threshold
            — fall to a greedy start refined by exact re-solves of 12-defect windows, and the
            page reports how often that happened. Tests check the exact path against
            brute-force enumeration on every d = 3 syndrome and hundreds at d = 5 and 7.
          </p>
          <p>
            <strong>MLP.</strong> All detectors of both channels in, two ReLU layers of 64, two
            logits out. Adam, batches of 32, a few thousand parameters.
          </p>
          <p>
            <strong>Transformer.</strong> One token per stabiliser carrying that stabiliser&rsquo;s
            detection events across rounds, plus a learned position embedding. Two pre-LayerNorm
            blocks of two-head self-attention and a feed-forward layer, mean-pooled to two
            logits. Every gradient is hand-derived and checked against finite differences in
            the test suite.
          </p>
        </Explainer>

        <Explainer title="What this tool does not do">
          <p>
            It does not simulate circuit-level noise: no two-qubit gate errors, no leakage, no
            crosstalk, no idle dephasing during a round. The two noise settings here are the
            standard textbook ones — code capacity (perfect measurement) and phenomenological
            (flipped measurement outcomes). Real thresholds are lower than both.
          </p>
          <p>
            It does not train on hardware data, and it does not pretrain. The learned decoders
            here see at most a hundred thousand samples in a minute of your CPU; the published
            result needed a datacentre. A curve on this page where a network beats MWPM at
            d = 5 would be evidence of a bug, not of progress, and the test suite would be the
            place to look.
          </p>
          <p>
            It does not implement Blossom. The matching is exact for the syndromes this lab
            produces below and around threshold; the heuristic fallback is flagged whenever it
            runs. It is not a general-purpose MWPM library and should not be cited as one.
          </p>
          <p>
            It does not decode the two Pauli channels jointly in MWPM — that is the very
            limitation the learned decoders can exploit here, and it is the reason the lookup
            table and MLP beat matching at d = 3.
          </p>
        </Explainer>

        <Explainer title="Where the numbers come from">
          <p>
            <code>lib/qec/model.ts</code> holds the noise model and the detector layout;{' '}
            <code>lib/qec/matching.ts</code> the graph and the matching;{' '}
            <code>lib/qec/lookup.ts</code>, <code>mlp.ts</code> and <code>transformer.ts</code>{' '}
            the decoders; <code>lib/qec/session.ts</code> the budgeted training loop and the
            sweep, which the worker in <code>lib/qec/worker.ts</code> drives. The lattice is the
            same one behind <Link href="/visualizations/surface-code" className="underline">The Surface Code</Link>;
            the repetition-code duel this grew out of is{' '}
            <Link href="/visualizations/qec-duel" className="underline">Decoder Duel</Link>.
          </p>
        </Explainer>
      </div>
    </div>
  )
}
