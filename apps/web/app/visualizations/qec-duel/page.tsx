'use client'

import Link from 'next/link'
import { useCallback, useState } from 'react'
import QECDuelLab, { type DuelLabStats } from '@/components/viz/QECDuelLab'
import { analyticLogicalRate } from '@/components/viz/qec/decoderDuel'
import { VizFrame, Explainer } from '@/components/ui/VizFrame'
import { Segmented, Slider, ButtonRow, Stat } from '@/components/ui/Controls'

const DISTANCES = [3, 5, 7] as const
const SHOT_OPTIONS = [10_000, 30_000, 100_000] as const

const pct = (r: number) => `${(r * 100).toFixed(2)}%`

export default function QECDuelPage() {
  const [d, setD] = useState<number>(5)
  const [p, setP] = useState(0.05)
  const [targetShots, setTargetShots] = useState<number>(30_000)
  const [runKey, setRunKey] = useState(0)
  const [stats, setStats] = useState<DuelLabStats>({
    shots: 0,
    majorityFailures: 0,
    netFailures: 0,
    trainMs: 0,
    done: false,
  })

  const onStats = useCallback((s: DuelLabStats) => {
    setStats((prev) => (prev.shots === s.shots && prev.done === s.done ? prev : s))
  }, [])

  const optimal = analyticLogicalRate(d, p)
  const majRate = stats.shots > 0 ? stats.majorityFailures / stats.shots : null
  const netRate = stats.shots > 0 ? stats.netFailures / stats.shots : null

  const controls = (
    <>
      <Segmented
        label="Code distance d"
        value={String(d)}
        options={DISTANCES.map((v) => ({ value: String(v), label: `d = ${v}` }))}
        onChange={(v) => setD(Number(v))}
      />

      <Slider
        label="Bit-flip rate p"
        value={p}
        min={0.01}
        max={0.2}
        step={0.005}
        format={(v) => `${(v * 100).toFixed(1)}%`}
        onChange={setP}
        hint="Chance each of the d bits flips, independently, per shot. Changing this retrains the network on the new noise."
      />

      <Segmented
        label="Shots"
        value={String(targetShots)}
        options={SHOT_OPTIONS.map((v) => ({ value: String(v), label: v.toLocaleString('en-US') }))}
        onChange={(v) => setTargetShots(Number(v))}
      />

      <ButtonRow>
        <button type="button" className="btn-primary" onClick={() => setRunKey((k) => k + 1)}>
          Retrain &amp; rerun
        </button>
      </ButtonRow>

      <div className="grid grid-cols-2 gap-2">
        <Stat
          label="Majority error rate"
          value={majRate === null ? '—' : pct(majRate)}
          accent="teal"
        />
        <Stat
          label="Net error rate"
          value={netRate === null ? '—' : pct(netRate)}
          accent="violet"
        />
        <Stat label="Optimal (exact)" value={pct(optimal)} accent="amber" />
        <Stat
          label="Trained in"
          value={stats.trainMs > 0 ? `${(stats.trainMs / 1000).toFixed(2)} s` : '—'}
          accent="sky"
        />
      </div>

      <p className="text-[11px] leading-relaxed text-ink-muted" role="status">
        {stats.shots === 0
          ? 'Training the perceptron and starting the duel…'
          : stats.done
            ? `Duel finished: ${stats.shots.toLocaleString('en-US')} shots. Majority failed ${stats.majorityFailures.toLocaleString('en-US')} times, the network ${stats.netFailures.toLocaleString('en-US')}.`
            : `${stats.shots.toLocaleString('en-US')} of ${targetShots.toLocaleString('en-US')} shots run.`}{' '}
        The network — a 2-layer perceptron, 16 hidden units — was trained on 60,000 freshly
        sampled syndromes in your browser just now; nothing is pre-baked.
      </p>
    </>
  )

  return (
    <VizFrame
      title="Decoder Duel: Lookup vs Learned"
      tagline="A neural decoder trains live in your browser and chases majority vote — which, on this code, it can only ever tie."
      level="Advanced"
      canvas={
        <div className="p-2">
          <QECDuelLab
            d={d}
            p={p}
            targetShots={targetShots}
            runKey={runKey}
            onStats={onStats}
          />
          <p className="px-3 pb-2 pt-1 text-[11px] leading-relaxed text-ink-muted">
            Top: each decoder&rsquo;s running logical error rate as shots accumulate, with the
            exact optimal rate as the dashed line. Bottom: the syndrome trace — the parity bits
            that are the <em>only</em> thing either decoder is shown, with each contestant&rsquo;s
            verdict per shot (dot = corrected, ✕ = logical error). Both decoders see the same
            syndromes in the same order.
          </p>
        </div>
      }
      controls={controls}
    >
      <Explainer title="The rules of the duel">
        <p>
          The distance-{d} repetition code stores one logical bit as {d} copies. Noise flips each
          copy independently with probability p, and neither decoder ever sees the bits — only
          the {d - 1} adjacent-pair parities, the syndrome. Exactly two error patterns are
          consistent with any syndrome: a candidate chain and its bitwise complement. Decoding is
          choosing between them, and choosing wrong is a <em>logical</em> error — the stored bit
          silently flips and no later measurement can tell.
        </p>
        <p>
          Contestant one is majority vote: take the lighter of the two consistent patterns, a
          one-line lookup. Contestant two is a genuine two-layer perceptron — 16 tanh hidden
          units, a sigmoid output — trained by streaming gradient descent on 60,000 noisy shots
          sampled at your chosen p, in your browser, the moment you change a control. The
          &ldquo;Trained in&rdquo; stat is a real wall-clock measurement of that run.
        </p>
      </Explainer>

      <Explainer title="Spoiler: the network cannot win — and that is the lesson">
        <p>
          For a repetition code under independent bit-flip noise at p &lt; ½, majority vote{' '}
          <strong>is</strong> the maximum-likelihood decoder, and it coincides with
          minimum-weight perfect matching on this code&rsquo;s one-dimensional syndrome graph:
          the two consistent patterns differ only in weight, and the lighter one is strictly more
          probable. There is no information in the syndrome that majority vote fails to use. The
          best any decoder — neural or otherwise — can do here is make the same decisions.
        </p>
        <p>
          So watch what the violet line actually does: early in training-quality terms it can sit
          above the teal line, and as the network converges the two lines meet at the dashed
          optimum. A demo that showed a neural decoder &ldquo;beating&rdquo; majority vote on
          this code would be rigged, and plenty of flashy ML-for-QEC demos quietly are. The honest
          claim is narrower and more interesting: the network <em>learns the optimal decoder from
          samples alone</em>, without ever being told the majority rule.
        </p>
      </Explainer>

      <Explainer title="Then why does anyone train decoders?">
        <p>
          Because real codes are not repetition codes. On a distance-d surface code the lookup
          table has 2<sup>d²−1</sup> rows — about 17 million at d = 5, beyond astronomical at
          d = 11 — and matching decoders, while fast, are near-optimal for independent noise but
          not maximum-likelihood on the surface code: they ignore degeneracy, the many distinct
          error patterns that share one syndrome and one correction. They degrade further with
          correlated errors, faulty syndrome measurements, crosstalk, and leakage, none of which
          the matching graph models cleanly. That is the regime where
          learned decoders (transformer and graph-network decoders in the recent literature,
          including on real hardware data) genuinely outperform the classical baselines: they can
          absorb noise structure that no one hand-modelled.
        </p>
        <p>
          This page is the control experiment for those claims. On a code where the optimum is
          computable in one line, a trained network should reach it and stop — and here you can
          verify, shot by shot, that it does. When you next see a learned decoder beat MWPM on a
          surface code, you will know exactly what question to ask: <em>what structure in the
          noise did it find that the matching graph was blind to?</em>
        </p>
      </Explainer>

      <Explainer title="What the distance buys, measured live">
        <p>
          Run the duel at each distance and keep p fixed at 5%. The optimal logical error rate is
          exact and printed in amber: {pct(analyticLogicalRate(3, 0.05))} at d = 3,{' '}
          {pct(analyticLogicalRate(5, 0.05))} at d = 5, {pct(analyticLogicalRate(7, 0.05))} at
          d = 7 — each two extra physical bits buy better than a 5× improvement, because failure
          now needs {`${(3 + 1) / 2}, ${(5 + 1) / 2}, ${(7 + 1) / 2}`} simultaneous flips
          respectively. Your Monte Carlo estimates should straddle those numbers; the same
          scaling law, run on this engine, is asserted in this page&rsquo;s test suite rather
          than taken on faith.
        </p>
        <p>
          One honest limitation: this is a classical repetition code protecting against bit flips
          only, with perfect syndrome extraction — the &ldquo;hello world&rdquo; of error
          correction, not the surface code. It is used here precisely because its optimal decoder
          is provable, which is what makes an honest duel possible. For the real thing — two
          error types, a 2-D lattice, and a matching decoder that can be legitimately fooled —
          see The Surface Code visualization.
        </p>
      </Explainer>

      <Explainer title="Take the duel to the surface code">
        <p>
          This page is deliberately the code where the network cannot win. The{' '}
          <Link href="/workbench/decoder-lab" className="underline">
            Decoder Lab
          </Link>{' '}
          in the workbench is the same contest on the surface code at d = 3, 5 and 7, with
          depolarising and measurement noise, an exact minimum-weight matching baseline, and a
          lookup table, an MLP and a small transformer that train in a Web Worker under a budget
          you set. There the learned decoders can legitimately beat matching at d = 3 — because
          they see both Pauli channels at once — and legitimately lose at d = 5 on a browser&rsquo;s
          worth of samples. The chart it produces is logical error rate against physical error
          rate with the threshold crossing, which is the chart every decoder paper is about.
        </p>
      </Explainer>
    </VizFrame>
  )
}
