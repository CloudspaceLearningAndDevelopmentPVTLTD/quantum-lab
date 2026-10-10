'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { Explainer } from '@/components/ui/VizFrame'
import { ButtonRow, Segmented, Slider, Stat } from '@/components/ui/Controls'
import { CalibrationChart } from '@/components/workbench/CalibrationChart'
import { useCalibrationRun } from '@/components/workbench/useCalibrationRun'
import { prefersReducedMotion } from '@/components/viz/frameLoop'
import {
  DEFAULT_CONFIG,
  agentStepCost,
  scheduledAmortisedCost,
  scheduledSweepCost,
  summarise,
  type CalibrationConfig,
  type ControllerId,
} from '@/lib/workbench/calibration'

/**
 * /workbench/calibration — the Calibration Agent.
 *
 * One simulated qubit whose frequency and Rabi rate drift; two controllers
 * that each try to keep a 40 ns pulse being an X gate; a reader who can see
 * the truth neither of them can. All numbers come from
 * lib/workbench/calibration.ts, which runs in a Web Worker with a fixed step
 * budget; this file owns the configuration and the prose.
 */

type Budget = '300' | '600' | '1200'
type Interval = '15' | '30' | '60'
type Pace = 'watch' | 'fast'

const WARMUP = 40
const WATCH_STEPS_PER_SECOND = 45

const pct = (v: number, digits = 2) => (Number.isFinite(v) ? `${(v * 100).toFixed(digits)}%` : '—')
const num = (v: number) => v.toLocaleString('en-US')

export default function CalibrationPage() {
  const { records, status, start, stop, reset, setSeverity } = useCalibrationRun()

  const [severity, setSeverityLocal] = useState(DEFAULT_CONFIG.severity)
  const [budget, setBudget] = useState<Budget>('600')
  const [interval, setInterval_] = useState<Interval>('30')
  const [pace, setPace] = useState<Pace>('watch')
  const [seed, setSeed] = useState(DEFAULT_CONFIG.seed)
  const [reduced, setReduced] = useState(false)

  useEffect(() => {
    if (prefersReducedMotion()) {
      setReduced(true)
      setPace('fast')
    }
  }, [])

  const config: CalibrationConfig = useMemo(
    () => ({
      ...DEFAULT_CONFIG,
      seed,
      severity,
      steps: Number(budget),
      scheduled: { ...DEFAULT_CONFIG.scheduled, interval: Number(interval) },
    }),
    [seed, severity, budget, interval]
  )

  const onSeverity = (v: number) => {
    setSeverityLocal(v)
    setSeverity(v)
  }

  const run = () => start(config, pace === 'watch' ? WATCH_STEPS_PER_SECOND : 0)

  const last = records[records.length - 1]
  const agent = summarise(records, 'agent', WARMUP)
  const sched = summarise(records, 'scheduled', WARMUP)
  const fixed = summarise(records, 'fixed', WARMUP)
  const running = status === 'running'
  const agentCost = agentStepCost(config.agent)
  const sweepCost = scheduledSweepCost(config.scheduled)
  const schedCost = scheduledAmortisedCost(config.scheduled)

  const controls = (
    <>
      <Slider
        label="Drift severity"
        value={severity}
        min={0}
        max={1}
        step={0.05}
        onChange={onSeverity}
        format={(v) => (v === 0 ? 'frozen' : v.toFixed(2))}
        hint="Live. 0 freezes the qubit; 1 wanders its frequency by a few MHz and its Rabi rate by ~10%."
      />

      <Segmented<Budget>
        label="Step budget (next run)"
        value={budget}
        options={[
          { value: '300', label: '300' },
          { value: '600', label: '600' },
          { value: '1200', label: '1,200' },
        ]}
        onChange={setBudget}
      />

      <Segmented<Interval>
        label="Scheduled sweep every (next run)"
        value={interval}
        options={[
          { value: '15', label: '15 steps' },
          { value: '30', label: '30 steps' },
          { value: '60', label: '60 steps' },
        ]}
        onChange={setInterval_}
      />

      <Segmented<Pace>
        label="Pace"
        value={pace}
        options={[
          { value: 'watch', label: `Watch · ${WATCH_STEPS_PER_SECOND}/s` },
          { value: 'fast', label: 'Fast' },
        ]}
        onChange={setPace}
      />

      <ButtonRow>
        {running ? (
          <button type="button" className="btn-primary focus-ring" onClick={stop}>
            Stop
          </button>
        ) : (
          <button type="button" className="btn-primary focus-ring" onClick={run}>
            {records.length > 0 ? 'Run again' : 'Run'}
          </button>
        )}
        <button type="button" className="btn-ghost focus-ring" onClick={reset} disabled={records.length === 0 && !running}>
          Reset
        </button>
        <button
          type="button"
          className="btn-ghost focus-ring"
          onClick={() => setSeed((s) => (s * 1664525 + 1013904223) >>> 0)}
          aria-label="Change the random seed for the next run"
        >
          New seed
        </button>
      </ButtonRow>

      {/* The live region announces phase changes only; the step counter next to it
          changes thirty times a second and would drown a screen reader. */}
      <p className="text-[11px] leading-relaxed text-ink-muted">
        <span role="status" aria-live="polite">
          {status === 'idle' && `Ready. Seed ${seed}. The run stops itself at ${num(Number(budget))} steps.`}
          {status === 'running' && 'Running in a Web Worker.'}
          {status === 'done' && `Budget spent: ${num(records.length)} steps. Change something and run again.`}
          {status === 'stopped' && `Stopped at step ${num(records.length)}.`}
          {reduced ? ' Reduced motion is on, so the pace defaults to Fast.' : ''}
        </span>
        {status === 'running' ? (
          <span aria-hidden> Step {num(records.length)} of {num(config.steps)}.</span>
        ) : null}
      </p>

      <div className="grid grid-cols-2 gap-2">
        <Stat label="Agent fidelity" value={last ? pct(last.agent.fidelity) : '—'} accent="violet" />
        <Stat label="Scheduled fidelity" value={last ? pct(last.scheduled.fidelity) : '—'} accent="teal" />
        <Stat label="Agent shots" value={last ? num(last.agent.shots) : '0'} accent="violet" />
        <Stat label="Scheduled shots" value={last ? num(last.scheduled.shots) : '0'} accent="teal" />
        <Stat label="Agent, per step" value={`${num(agentCost)} shots`} accent="violet" />
        <Stat label="Scheduled, amortised" value={`${schedCost.toFixed(0)} shots`} accent="teal" />
      </div>

      <p className="text-[11px] leading-relaxed text-ink-muted">
        A sweep costs {num(sweepCost)} shots every {interval} steps. The agent spends{' '}
        {num(agentCost)} every step, no exceptions. What the agent thinks its pulse is worth right
        now: {last?.agent.belief != null ? pct(last.agent.belief, 1) : '—'} — a reward average, not
        a fidelity, because it has never been shown one.
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
        <span className="pill border border-q-violet/30 bg-q-violet/15 text-q-violet-text">train</span>
        <h1 className="mt-3 text-3xl font-extrabold tracking-tight md:text-4xl">Calibration Agent</h1>
        <p className="mt-2 max-w-2xl text-[15px] text-ink-secondary">
          A qubit whose parameters drift. An RL agent that keeps its X gate honest by reading nothing
          but measurement counts, against the usual answer: recalibrate everything on a timer.
        </p>
      </div>

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <section className="card overflow-hidden" role="region" aria-labelledby="calibration-chart-title" tabIndex={-1}>
          <h2 id="calibration-chart-title" className="sr-only">
            Fidelity trace and hidden qubit parameters
          </h2>
          <div className="p-3 sm:p-4">
            <CalibrationChart records={records} budget={config.steps} />
            <p className="px-1 pb-1 pt-3 text-[11px] leading-relaxed text-ink-muted">
              Top: the fidelity of each controller&rsquo;s current pulse as an X gate, recomputed every
              step from the true qubit. Teal ticks on the floor are the steps where the scheduled
              controller paid for a full sweep. Below: the qubit&rsquo;s hidden frequency and Rabi
              rate as faint dashed lines — you can see them, the controllers cannot — with each
              controller&rsquo;s drive frequency and the Rabi rate its pulse implies drawn on top. A
              calibrated controller sits on the dashed line.
            </p>
          </div>
        </section>

        <aside className="card p-4 sm:p-5" aria-labelledby="calibration-controls-title">
          <h2 id="calibration-controls-title" className="section-label mb-4">
            Controls
          </h2>
          <div className="flex flex-col gap-5">{controls}</div>
        </aside>
      </div>

      <div className="mt-10 max-w-3xl">
        <div className="card mb-6 p-6">
          <h2 className="section-label mb-3">Scoreboard, from step {WARMUP} onward</h2>
          <div className="-mx-2 overflow-x-auto px-2">
            <table className="w-full min-w-[640px] border-collapse text-left text-sm">
              <caption className="sr-only">
                Per-controller fidelity statistics, shots spent, and the current pulse parameters.
              </caption>
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-wider text-ink-muted">
                  <th scope="col" className="py-2 pr-3 font-bold">Controller</th>
                  <th scope="col" className="py-2 pr-3 text-right font-bold">Now</th>
                  <th scope="col" className="py-2 pr-3 text-right font-bold">Mean</th>
                  <th scope="col" className="py-2 pr-3 text-right font-bold">Worst</th>
                  <th scope="col" className="py-2 pr-3 text-right font-bold">Shots</th>
                  <th scope="col" className="py-2 text-right font-bold">Pulse now</th>
                </tr>
              </thead>
              <tbody className="font-mono text-[13px]">
                {(
                  [
                    ['agent', 'RL agent', agent, 'text-q-violet-text'],
                    ['scheduled', 'Scheduled sweep', sched, 'text-q-teal-text'],
                    ['fixed', 'Never recalibrated', fixed, 'text-ink-muted'],
                  ] as const
                ).map(([id, name, s, cls]) => {
                  const p = last?.[id as ControllerId].pulse
                  return (
                    <tr key={id} className="border-b border-line">
                      <th scope="row" className={`py-2 pr-3 text-left font-sans font-semibold ${cls}`}>
                        {name}
                      </th>
                      <td className="py-2 pr-3 text-right text-ink">
                        {last ? pct(last[id as ControllerId].fidelity) : '—'}
                      </td>
                      <td className="py-2 pr-3 text-right text-ink-secondary">{pct(s.mean)}</td>
                      <td className="py-2 pr-3 text-right text-ink-secondary">{pct(s.min)}</td>
                      <td className="py-2 pr-3 text-right text-ink-secondary">{num(s.shots)}</td>
                      <td className="py-2 text-right text-ink-muted">
                        {p
                          ? `${p.duration.toFixed(1)} ns · A ${p.amplitude.toFixed(3)} · ${p.frequency >= 0 ? '+' : ''}${p.frequency.toFixed(2)} MHz`
                          : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[13px] text-ink-secondary">
            Mean and worst skip the first {WARMUP} steps so that the deliberately bad starting pulse
            (1.5 MHz off, 5% too strong) does not count against anyone. The hidden qubit is currently
            at {last ? `${last.truth.frequency >= 0 ? '+' : ''}${last.truth.frequency.toFixed(2)} MHz` : '—'}{' '}
            with a Rabi rate of {last ? `${last.truth.rabiRate.toFixed(2)} MHz per unit` : '—'}.
          </p>
        </div>

        <Explainer title="Run it like this">
          <p>
            <strong className="text-ink">Frozen qubit first.</strong> Drag drift severity to 0 and
            press Run. Both controllers start from the same wrong pulse. The scheduled sweep fixes it
            in one shot at step 0 — one expensive burst of 6,400 measurements — and then does nothing
            for 30 steps. The agent climbs out over five or six steps and then jitters just under
            100%, paying 128 shots every step. With nothing drifting, the sweep wins on fidelity and
            the agent wins on cost.
          </p>
          <p>
            <strong className="text-ink">Now let it drift.</strong> Set severity to 1 and run again.
            Watch the teal line between sweeps: it sags as the qubit walks away from the last
            calibration, then snaps back the instant a sweep lands. The violet line does not sag, and
            in the lower panels you can see why — the agent&rsquo;s drive frequency is following the
            dashed truth almost step for step, without ever being handed it.
          </p>
          <p>
            <strong className="text-ink">Then move the slider while it runs.</strong> Severity is
            live. Push it to 1 mid-run and the scheduled controller has no idea until its next
            appointment. Set the sweep interval to 15 to make it competitive on fidelity again, and
            look at what happens to its shot count.
          </p>
        </Explainer>

        <Explainer title="What the agent is actually doing">
          <p>
            The agent holds three numbers — pulse duration, amplitude and drive frequency — and a
            fixed exploration width for each. Every step it draws one random nudge ε, plays the
            pulse at +ε and at −ε, and scores each candidate with two 32-shot experiments: three
            back-to-back pulses (which should return the qubit to |1⟩, and amplifies any rotation
            error threefold) and a Ramsey pair at half amplitude (which is steep in frequency
            error). The score is just the fraction of |1⟩ outcomes, averaged. Then it moves the
            pulse along ε by an amount proportional to the difference between the two scores.
          </p>
          <p>
            That is policy gradient with symmetric sampling — the update is, in expectation, a
            step up the gradient of the expected reward, and the ± pairing cancels the baseline so
            that 32-shot rewards carry a usable signal. There is no model of the qubit inside the
            agent and no fit. It is a bandit that has learned which way is up.
          </p>
          <p>
            One constraint keeps it honest: amplitude × duration is an exact degeneracy of the
            rotation angle, so a pulse twice as long at half the amplitude scores the same. Left
            alone the agent random-walks along that ridge into low amplitudes, where the same
            frequency error costs far more fidelity. The reward therefore carries a penalty for a
            pulse that no longer fits its 40 ns slot in the circuit schedule — a constraint any real
            scheduler imposes anyway.
          </p>
        </Explainer>

        <Explainer title="What the scheduled sweep is doing, and what it costs">
          <p>
            Every K steps: sixteen Ramsey delays at 200 shots each, with the drive deliberately
            detuned by 6 MHz so the fringe frequency reports the sign of the error as well as its
            size; fit the fringe, move the drive. Then sixteen amplitudes at 200 shots each on the new
            frequency; fit the Rabi period, put the π pulse at half of it. 6,400 shots, then silence.
          </p>
          <p>
            It is the better calibration when it runs — with no noise it lands within 0.1 MHz and 1%
            of amplitude, and the tests check that. Its problem is the silence. Between sweeps it
            neither learns nor spends, and the fidelity it delivers is set entirely by how far the
            qubit can drift in K steps. Shorten K and you buy fidelity with shots; the amortised cost
            at K = 30 is already 213 per step against the agent&rsquo;s 128.
          </p>
        </Explainer>

        <Explainer title="What this reproduces, and how far it is from Willow">
          <p>
            In July 2026 Google reported holding gate fidelities on a Willow processor with a
            reinforcement-learning agent that adjusted more than a thousand control parameters
            continuously, driven by measurement statistics rather than by scheduled characterisation.
            The claim that matters is the shape of the loop: counts in, parameter deltas out, no
            intermediate model of the device, and cheaper than the sweep it replaced.
          </p>
          <p>
            This page is that loop on one qubit with three parameters, a drift model made of a
            random walk and a slow sinusoid, and an agent small enough to read in a few minutes. It
            reproduces the qualitative result — a measurement-driven agent that tracks drift at lower
            shot cost than periodic recalibration — on a system more than three hundred times smaller, with a
            reward the agent can evaluate in two experiments. On Willow the reward is a whole
            error-correction cycle&rsquo;s logical error rate, the parameters interact through
            crosstalk, and the exploration budget is the real engineering problem. None of that is
            here.
          </p>
        </Explainer>

        <Explainer title="What this tool does not do">
          <p>
            It does not simulate decoherence, leakage to |2⟩, pulse shaping, DRAG, readout drift or
            crosstalk. The pulse is a rectangular rotation in the rotating-wave approximation and
            the only errors are a wrong angle and a wrong axis. Readout has a fixed 1% symmetric
            assignment error and nothing else.
          </p>
          <p>
            It does not train a neural network. The agent is a Gaussian policy over three deltas
            with fixed exploration widths; there is no value function and no learned representation.
            It does not tune more than one qubit, does not learn the drift, and does not choose its
            own experiments. It cannot be exported to hardware — the pulse units are the
            simulation&rsquo;s own.
          </p>
          <p>
            What it does do is checked:{' '}
            <code className="rounded bg-surface-3 px-1 py-0.5 text-[12px]">lib/workbench/calibration.test.ts</code>{' '}
            pins the gate fidelity to the average-fidelity formula and to the closed-form Rabi
            solution from the spin-precession lab, the sampled Rabi counts to the analytic sin²
            curve at every amplitude, the Ramsey fringe to (1 + cos Δτ)/2, the scheduled sweep to a
            known hidden offset, and both controllers to a 99% floor with the qubit frozen — from the
            same deliberately wrong start you see here.
          </p>
        </Explainer>
      </div>
    </div>
  )
}
