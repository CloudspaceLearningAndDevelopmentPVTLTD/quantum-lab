'use client'

import Link from 'next/link'
import { useCallback, useMemo, useState } from 'react'
import BellTestLab, { type BellLabStats } from '@/components/viz/BellTestLab'
import { VizFrame, Explainer } from '@/components/ui/VizFrame'
import { Segmented, ButtonRow, Slider, Stat } from '@/components/ui/Controls'
import {
  CLASSICAL_BOUND,
  LHV_STRATEGY_LABELS,
  OPTIMAL_SETTINGS,
  PAIR_LABELS,
  SETTING_PAIRS,
  anglesFor,
  lhvS,
  quantumS,
  type ChshSettings,
  type LhvStrategy,
} from '@/lib/viz/chsh'

type TrialChoice = '4000' | '20000' | '100000'

const TRIAL_OPTIONS: { value: TrialChoice; label: string }[] = [
  { value: '4000', label: '4k pairs' },
  { value: '20000', label: '20k pairs' },
  { value: '100000', label: '100k pairs' },
]

const STRATEGY_OPTIONS: { value: LhvStrategy; label: string }[] = [
  { value: 'naive', label: LHV_STRATEGY_LABELS.naive },
  { value: 'conspiracy', label: LHV_STRATEGY_LABELS.conspiracy },
]

/** Settings where both analyzers agree — the correlation is perfect and S is not. */
const ALIGNED_SETTINGS: ChshSettings = { a: 0, aPrime: 45, b: 0, bPrime: 45 }

const deg = (v: number) => `${v.toFixed(1)}°`
const fixed2 = (v: number) => v.toFixed(3)

export default function BellTestPage() {
  const [settings, setSettings] = useState<ChshSettings>(OPTIMAL_SETTINGS)
  const [strategy, setStrategy] = useState<LhvStrategy>('naive')
  const [trialChoice, setTrialChoice] = useState<TrialChoice>('20000')
  const [running, setRunning] = useState(true)
  const [runKey, setRunKey] = useState(0)
  const [stats, setStats] = useState<BellLabStats | null>(null)

  const targetTrials = parseInt(trialChoice, 10)

  const onStats = useCallback((s: BellLabStats) => setStats(s), [])

  const setAngle = (key: keyof ChshSettings) => (v: number) =>
    setSettings((prev) => ({ ...prev, [key]: v }))

  const restart = () => {
    setStats(null)
    setRunKey((k) => k + 1)
    setRunning(true)
  }

  // Named `applyPreset`, not `usePreset`: it is an event handler, but
  // eslint-plugin-react-hooks matches the `use` prefix and read it as a hook
  // called inside an onClick callback.
  const applyPreset = (next: ChshSettings) => {
    setSettings(next)
    setStats(null)
    setRunning(true)
  }

  const theoryQuantum = Math.abs(quantumS(settings))
  const theoryClassical = Math.abs(lhvS(strategy, settings))

  const measuredQ = stats?.quantum
  const measuredC = stats?.classical

  /** How many standard errors the quantum result sits above the classical bound. */
  const sigmas =
    measuredQ && Number.isFinite(measuredQ.se) && measuredQ.se > 0
      ? (measuredQ.sAbs - CLASSICAL_BOUND) / measuredQ.se
      : null

  const settingRows = useMemo(
    () =>
      SETTING_PAIRS.map((key, i) => {
        const [alpha, beta] = anglesFor(settings, key)
        return {
          key,
          label: PAIR_LABELS[key],
          alpha,
          beta,
          quantum: measuredQ?.perPair[i] ?? null,
          classical: measuredC?.perPair[i] ?? null,
        }
      }),
    [settings, measuredQ, measuredC]
  )

  const controls = (
    <>
      <ButtonRow>
        <button
          type="button"
          className="btn-primary focus-ring"
          onClick={() => applyPreset(OPTIMAL_SETTINGS)}
        >
          Optimal angles
        </button>
        <button
          type="button"
          className="btn-ghost focus-ring"
          onClick={() => applyPreset(ALIGNED_SETTINGS)}
        >
          Aligned — no violation
        </button>
      </ButtonRow>

      <Slider
        label="Alice a"
        value={settings.a}
        min={0}
        max={180}
        step={0.5}
        format={deg}
        onChange={setAngle('a')}
      />
      <Slider
        label="Alice a′"
        value={settings.aPrime}
        min={0}
        max={180}
        step={0.5}
        format={deg}
        onChange={setAngle('aPrime')}
        hint="Alice picks one of her two angles at random on every pair."
      />
      <Slider
        label="Bob b"
        value={settings.b}
        min={0}
        max={180}
        step={0.5}
        format={deg}
        onChange={setAngle('b')}
      />
      <Slider
        label="Bob b′"
        value={settings.bPrime}
        min={0}
        max={180}
        step={0.5}
        format={deg}
        onChange={setAngle('bPrime')}
        hint="Optimal is 22.5° between each Alice–Bob pairing."
      />

      <Segmented<LhvStrategy>
        label="Classical rival"
        value={strategy}
        options={STRATEGY_OPTIONS}
        onChange={(v) => {
          setStrategy(v)
          setStats(null)
        }}
      />

      <Segmented<TrialChoice>
        label="Pairs to measure"
        value={trialChoice}
        options={TRIAL_OPTIONS}
        onChange={(v) => {
          setTrialChoice(v)
          setStats(null)
        }}
      />

      <ButtonRow>
        <button
          type="button"
          className="btn-primary focus-ring"
          onClick={() => setRunning((r) => !r)}
        >
          {running ? 'Pause' : 'Resume'}
        </button>
        <button type="button" className="btn-ghost focus-ring" onClick={restart}>
          New run
        </button>
      </ButtonRow>

      <div className="grid grid-cols-2 gap-2">
        <Stat
          label="S — entangled"
          value={measuredQ ? fixed2(measuredQ.sAbs) : '—'}
          accent="violet"
        />
        <Stat
          label="S — hidden vars"
          value={measuredC ? fixed2(measuredC.sAbs) : '—'}
          accent="rose"
        />
        <Stat label="Quantum theory" value={fixed2(theoryQuantum)} accent="teal" />
        <Stat label="Classical theory" value={fixed2(theoryClassical)} accent="amber" />
      </div>

      <div className="grid grid-cols-1 gap-2">
        <Stat
          label="Violation"
          value={sigmas === null ? '—' : sigmas > 0 ? `${sigmas.toFixed(1)}σ over 2` : 'none yet'}
          accent="sky"
        />
        <Stat
          label="Pairs measured"
          value={stats ? stats.trials.toLocaleString('en-US') : '0'}
          accent="violet"
        />
      </div>

      <p className="text-[11px] leading-relaxed text-ink-muted">
        Each pair is measured at one randomly chosen pair of angles, so every correlator is built
        from about a quarter of the trials. The shaded bands are ±1 standard error.
      </p>
    </>
  )

  return (
    <VizFrame
      title="The Bell Test"
      tagline="Two detectors, four angles, one number — and a ceiling that no theory of local causes can get over."
      level="Intermediate"
      canvas={
        <div className="p-2">
          <BellTestLab
            settings={settings}
            strategy={strategy}
            targetTrials={targetTrials}
            running={running}
            runKey={runKey}
            onStats={onStats}
          />
          <p className="px-3 pb-2 pt-1 text-[11px] text-ink-muted">
            Violet is the entangled source, rose is a local hidden-variable source running the same
            protocol on the same number of pairs. Amber is the line classical physics cannot cross.
          </p>
        </div>
      }
      controls={controls}
    >
      <Explainer title="What you are about to do">
        <p>
          The <Link href="/visualizations/entanglement" className="focus-ring text-q-teal-text underline decoration-q-teal/40 underline-offset-2">entanglement page</Link>{' '}
          shows two qubits whose answers always match. That is striking, but it is not yet an
          argument: a pair of gloves posted to opposite ends of the country also always match, and
          nothing spooky happened to the gloves. To turn correlation into a claim about reality you
          have to measure the pairs along <em>different</em> axes and see whether the answers hang
          together more tightly than any pre-agreed plan could manage.
        </p>
        <p>
          That is what this page runs. Alice has two analyzer angles, a and a′; Bob has b and b′. On
          every pair, each of them picks one of their two at random and records +1 or −1. Four
          correlators come out, and they are combined into a single number:
        </p>
        <p className="rounded-lg border border-line bg-surface-2 px-4 py-3 text-center font-mono text-[13px] text-ink">
          S = E(a,b) − E(a,b′) + E(a′,b) + E(a′,b′)
        </p>
        <p>
          Press play and watch two things race: the violet curve is the entangled source, the rose
          curve is a classical source doing its best. Watch where each one stalls.
        </p>
      </Explainer>

      <div className="card mb-4 p-6">
        <h2 className="mb-3 text-lg font-bold">The four correlators, right now</h2>
        {/* RESPONSIVE: the table is the widest element on the page at 390px, so it
            gets its own scroller rather than pushing the body sideways. */}
        <div className="-mx-2 overflow-x-auto px-2">
          <table className="w-full min-w-[30rem] text-sm">
            <caption className="sr-only">
              Measured correlators for each pair of analyzer settings, for the entangled source and
              the local hidden-variable source.
            </caption>
            <thead>
              <tr className="border-b border-line text-[11px] uppercase tracking-wider text-ink-muted">
                <th scope="col" className="py-2 text-left font-bold">
                  Term
                </th>
                <th scope="col" className="py-2 text-left font-bold">
                  Angles
                </th>
                <th scope="col" className="py-2 text-right font-bold">
                  Entangled
                </th>
                <th scope="col" className="py-2 text-right font-bold">
                  Hidden vars
                </th>
                <th scope="col" className="py-2 text-right font-bold">
                  Pairs
                </th>
              </tr>
            </thead>
            <tbody>
              {settingRows.map((row) => (
                <tr key={row.key} className="border-b border-line last:border-0">
                  <td className="py-2 font-mono text-q-violet-text">{row.label}</td>
                  <td className="py-2 font-mono text-ink-muted">
                    {deg(row.alpha)} / {deg(row.beta)}
                  </td>
                  <td className="py-2 text-right font-mono text-ink-secondary">
                    {row.quantum && row.quantum.n > 0
                      ? `${row.quantum.e.toFixed(3)} ± ${row.quantum.se.toFixed(3)}`
                      : '—'}
                  </td>
                  <td className="py-2 text-right font-mono text-ink-secondary">
                    {row.classical && row.classical.n > 0
                      ? `${row.classical.e.toFixed(3)} ± ${row.classical.se.toFixed(3)}`
                      : '—'}
                  </td>
                  <td className="py-2 text-right font-mono text-ink-muted">
                    {row.quantum ? row.quantum.n.toLocaleString('en-US') : '0'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[13px] leading-relaxed text-ink-secondary">
          Sum them with the signs above and you get S. Nothing in any single row is remarkable — each
          one is a correlation between −1 and +1, and the hidden-variable source can match any one of
          them exactly if you let it choose. The impossibility only shows up in the combination.
        </p>
      </div>

      <Explainer title="Why the classical racer stalls">
        <p>
          The rose source is not a scripted animation with a cap. It is a simulation of exactly the
          kind of world Einstein wanted: at the moment the pair is created, a hidden variable λ is
          drawn — a shared secret polarization angle, plus a private coin for each side — and from
          then on each detector&rsquo;s output is a function of its own angle and λ. Neither side can
          see the other&rsquo;s setting. That is locality, and in the code it is enforced by the
          function signature: the outcome function is handed one angle, never two.
        </p>
        <p>
          <strong className="text-ink">Naive realist</strong> is the model a nineteenth-century
          physicist would write: each photon really does carry a definite polarization and passes its
          analyzer with the Malus-law probability cos²(α − λ). It produces exactly half the quantum
          correlation and tops out at S = √2 ≈ 1.41.
          <strong className="text-ink"> Best conspiracy</strong> is the provably optimal local
          strategy, the one that squeezes every last drop out of the shared secret. It climbs to
          2.000 and stops dead. Switch between them and watch: cleverness buys the classical source a
          lot, and then buys it nothing at all.
        </p>
        <p>
          The reason is four lines of arithmetic. Give one hidden state λ, ask it all four questions
          at once, and form the same combination:{' '}
          <span className="font-mono text-[13px] text-ink">
            A(a)[B(b) − B(b′)] + A(a′)[B(b) + B(b′)]
          </span>
          . Every outcome is ±1, so one bracket is always zero and the other is always ±2. Every
          single pair contributes exactly ±2, and an average of ±2 cannot leave the interval [−2, 2].
          {stats && stats.trials > 0 ? (
            <>
              {' '}
              This run has audited{' '}
              <strong className="text-ink">{stats.trials.toLocaleString('en-US')}</strong> hidden
              states that way; the largest single value seen was{' '}
              <strong className="text-q-rose-text">{stats.witnessMaxAbs.toFixed(3)}</strong>, and
              their mean is{' '}
              <strong className="text-q-rose-text">
                {Math.abs(stats.witnessMean).toFixed(3)}
              </strong>
              .
            </>
          ) : null}
        </p>
        <p>
          Two honest caveats about that rose curve. It is an <em>estimate</em>, so with the
          conspiracy strategy at the optimal angles — where the true value is exactly 2 — it will
          jitter a hundredth or so either side of the line, and sometimes sit fractionally above it.
          That is finite-sample noise, not a violation; it shrinks as 1/√N, and it is the reason real
          Bell tests are quoted in standard deviations rather than in decimal places. The audit
          above, by contrast, cannot jitter past 2 at all, because it averages values that are each
          exactly ±2.
        </p>
      </Explainer>

      <Explainer title="The step the quantum source cannot be asked to take">
        <p>
          Notice what the audit above required: asking one λ what it <em>would</em> have said at an
          angle that was never used. For a classical source that question is free — λ is a number in
          memory, and the code can evaluate it four times. For an entangled pair it is not a question
          at all. Measure Alice&rsquo;s photon at a and the counterfactual value at a′ does not exist
          to be read, not even in principle.
        </p>
        <p>
          That, and nothing more exotic, is what Bell&rsquo;s theorem rules out. Not faster-than-light
          signalling — check the marginals on the entanglement page, they stay at a dead 50/50 no
          matter what Bob does, which is why no message can ride this channel. What fails is the
          assumption that the unasked question had an answer.
        </p>
        <p>
          Set the optimal angles and let the violet curve settle. It converges on 2√2 ≈ 2.828,
          Tsirelson&rsquo;s bound — quantum mechanics has a ceiling of its own, and it is not the
          arithmetic maximum of 4. Reaching 4 would not even require signalling: Popescu and Rohrlich
          wrote down a hypothetical no-signalling correlation (the &ldquo;PR box&rdquo;) that hits 4
          with the same dead-50/50 marginals. Nature stops short of it for reasons that are still
          being argued about; what is not in doubt is that it stops at 2√2.
        </p>
      </Explainer>

      <Explainer title="What just happened">
        <p>
          You measured a number that a whole class of theories is arithmetically forbidden to produce,
          and the forbidden number came out anyway — repeatedly, from a source that follows the
          ordinary rules of quantum mechanics with no special pleading.
        </p>
        <p>
          Drag the angles away from the preset and watch the violation evaporate: at aligned settings
          the entangled source is perfectly correlated and S collapses to 2 or below, which is why the{' '}
          <Link href="/visualizations/entanglement" className="focus-ring text-q-teal-text underline decoration-q-teal/40 underline-offset-2">
            matching-outcomes demo
          </Link>{' '}
          on its own proves nothing. The violation lives in the mismatch — in measuring the two halves
          of a pair along axes that disagree by 22.5°, where the classical best-fit to a cosine is a
          triangle wave and falls short by exactly the margin you can see on the chart.
        </p>
        <p>
          Real laboratories have been running this experiment since 1972, closing one loophole at a
          time — detection efficiency, locality of the setting choice, the freedom to choose at all.
          The 2015 loophole-free tests settled it, and the 2022 Nobel Prize in Physics went to Clauser,
          Aspect and Zeilinger for the campaign. The number on your screen is the number they measured.
        </p>
      </Explainer>
    </VizFrame>
  )
}
