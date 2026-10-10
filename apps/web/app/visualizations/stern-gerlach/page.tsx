'use client'

import { useCallback, useMemo, useState } from 'react'
import SternGerlachLab from '@/components/viz/SternGerlachLab'
import { VizFrame, Explainer } from '@/components/ui/VizFrame'
import { Segmented, ButtonRow, Slider, Stat } from '@/components/ui/Controls'
import {
  DEG,
  axisLabel,
  chainPlusProbabilities,
  emptyCounts,
  incidentAngle,
  malus,
  type Analyser,
  type ChainCounts,
  type Outcome,
} from '@/lib/viz/sternGerlach'

/**
 * /visualizations/stern-gerlach — sequential spin measurement.
 *
 * The page owns the apparatus configuration and the prose; every number it
 * displays comes from lib/viz/sternGerlach.ts, and the sampled counts come
 * back up from the canvas lab, which runs one atom at a time through the same
 * functions the unit tests check against cos²(Δ/2) and against the exact
 * probabilities for the z → x → z chain.
 *
 * The source is an unpolarised oven, as in the 1922 experiment: no spin
 * direction is prepared, so the first analyser is what makes the beam definite.
 */

type PresetId = 'zz' | 'zx' | 'zxz' | 'custom'

type Preset = {
  id: PresetId
  label: string
  length: 2 | 3
  angles: number[]
  ports: Outcome[]
}

const PRESETS: Preset[] = [
  { id: 'zz', label: 'z → z', length: 2, angles: [0, 0, 0], ports: [1, 1, 1] },
  { id: 'zx', label: 'z → x', length: 2, angles: [0, 90, 0], ports: [1, 1, 1] },
  { id: 'zxz', label: 'z → x → z', length: 3, angles: [0, 90, 0], ports: [1, 1, 1] },
]

const pct = (p: number) => `${(p * 100).toFixed(1)}%`

/** A tenth of a degree is plenty; the slider steps in fives. */
const roundAngle = (deg: number) => Math.round(deg * 10) / 10

export default function SternGerlachPage() {
  const [length, setLength] = useState<2 | 3>(3)
  const [angles, setAngles] = useState<number[]>([0, 90, 0])
  const [ports, setPorts] = useState<Outcome[]>([1, 1, 1])
  const [running, setRunning] = useState(true)
  const [resetKey, setResetKey] = useState(0)
  const [burst, setBurst] = useState({ id: 0, n: 0 })
  const [counts, setCounts] = useState<ChainCounts>(() => emptyCounts(3))

  const onCounts = useCallback((c: ChainCounts) => setCounts(c), [])

  const chain: Analyser[] = useMemo(
    () =>
      Array.from({ length }, (_, i) => ({
        axis: { theta: angles[i] * DEG, phi: 0 },
        port: ports[i],
      })),
    [length, angles, ports]
  )

  const predicted = useMemo(() => chainPlusProbabilities(null, chain), [chain])
  const last = length - 1
  const delta = incidentAngle(null, chain, last)
  const deltaDeg = delta === null ? 0 : (delta * 180) / Math.PI
  const reachedLast = counts.plus[last] !== undefined ? counts.plus[last] + counts.minus[last] : 0
  const measuredLast = reachedLast > 0 ? counts.plus[last] / reachedLast : 0

  const activePreset: PresetId =
    PRESETS.find(
      (p) =>
        p.length === length &&
        p.angles.slice(0, length).every((a, i) => a === angles[i]) &&
        p.ports.slice(0, length - 1).every((v, i) => v === ports[i])
    )?.id ?? 'custom'

  const applyPreset = (id: PresetId) => {
    const p = PRESETS.find((x) => x.id === id)
    if (!p) return
    setLength(p.length)
    setAngles(p.angles.slice())
    setPorts(p.ports.slice())
  }

  const setAngle = (i: number, deg: number) =>
    setAngles((a) => a.map((v, j) => (j === i ? roundAngle(deg) : v)))

  const setPort = (i: number, port: Outcome) =>
    setPorts((p) => p.map((v, j) => (j === i ? port : v)))

  const presetOptions = [
    ...PRESETS.map((p) => ({ value: p.id, label: p.label })),
    ...(activePreset === 'custom'
      ? [{ value: 'custom' as PresetId, label: 'Custom' }]
      : []),
  ]

  const controls = (
    <>
      <Segmented<PresetId>
        label="Classic setups"
        value={activePreset}
        options={presetOptions}
        onChange={applyPreset}
      />

      <Segmented<'2' | '3'>
        label="Analysers in the chain"
        value={String(length) as '2' | '3'}
        options={[
          { value: '2', label: '2' },
          { value: '3', label: '3' },
        ]}
        onChange={(v) => setLength(v === '2' ? 2 : 3)}
      />

      {/* One group per analyser. Every control inside carries the analyser
          number in its accessible name — three sliders all called "axis angle"
          would be indistinguishable in a screen reader's forms list. */}
      {Array.from({ length }, (_, i) => (
        <div
          key={i}
          role="group"
          aria-label={`Analyser ${i + 1}${i === length - 1 ? ', the detector' : ''}`}
          className="rounded-lg border border-line bg-surface-2 p-3"
        >
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-[13px] font-bold text-ink" aria-hidden>
              Analyser {i + 1}
              {i === length - 1 ? ' · detector' : ''}
            </span>
            <span className="font-mono text-[11px] text-ink-muted" aria-hidden>
              SG-{axisLabel(angles[i])}
            </span>
          </div>

          <Slider
            label={`Analyser ${i + 1} axis`}
            value={angles[i]}
            min={0}
            max={180}
            step={5}
            onChange={(v) => setAngle(i, v)}
            format={(v) => `${v.toFixed(0)}° · ${axisLabel(v)}`}
            hint={
              i === length - 1
                ? 'Rotate this one to sweep the cos²(Δ/2) curve.'
                : 'Degrees from z. 0° is z, 90° is x.'
            }
          />

          <ButtonRow>
            <button
              type="button"
              className="btn-ghost focus-ring"
              aria-label={`Point analyser ${i + 1} along z`}
              onClick={() => setAngle(i, 0)}
            >
              Set to z
            </button>
            <button
              type="button"
              className="btn-ghost focus-ring"
              aria-label={`Point analyser ${i + 1} along x`}
              onClick={() => setAngle(i, 90)}
            >
              Set to x
            </button>
          </ButtonRow>

          {i < length - 1 ? (
            <div className="mt-3">
              <Segmented<'up' | 'down'>
                label={`Analyser ${i + 1}: port that continues`}
                value={ports[i] === 1 ? 'up' : 'down'}
                options={[
                  { value: 'up', label: '↑ up' },
                  { value: 'down', label: '↓ down' },
                ]}
                onChange={(v) => setPort(i, v === 'up' ? 1 : -1)}
              />
            </div>
          ) : null}
        </div>
      ))}

      <ButtonRow>
        <button
          type="button"
          className="btn-primary focus-ring"
          onClick={() => setRunning((r) => !r)}
        >
          {running ? 'Pause beam' : 'Run beam'}
        </button>
        <button
          type="button"
          className="btn-ghost focus-ring"
          onClick={() => setBurst((b) => ({ id: b.id + 1, n: 5000 }))}
        >
          Fire 5,000
        </button>
        <button
          type="button"
          className="btn-ghost focus-ring"
          onClick={() => setResetKey((k) => k + 1)}
        >
          Reset counts
        </button>
      </ButtonRow>

      <div className="grid grid-cols-2 gap-2">
        <Stat label="Δ at last analyser" value={`${deltaDeg.toFixed(0)}°`} accent="amber" />
        <Stat label="cos²(Δ/2)" value={pct(malus(delta ?? 0))} accent="violet" />
        <Stat label="Measured ↑" value={reachedLast > 0 ? pct(measuredLast) : '—'} accent="teal" />
        <Stat label="Atoms that got there" value={reachedLast.toLocaleString('en-US')} accent="sky" />
      </div>

      <p className="text-[11px] leading-relaxed text-ink-muted">
        Δ is the angle between the spin arriving at the last analyser and the axis that analyser
        measures. Every atom is sampled from the Born rule one at a time — the measured number
        wanders toward cos²(Δ/2) instead of being set to it.
      </p>
    </>
  )

  return (
    <VizFrame
      title="The Stern-Gerlach Experiment"
      tagline="Send a beam of atoms through a magnet and it splits in two. Send one of those halves through a second magnet turned sideways, and everything the first one told you is gone."
      level="Beginner"
      canvas={
        <div className="p-2">
          <SternGerlachLab
            chain={chain}
            source={null}
            running={running}
            resetKey={resetKey}
            burst={burst}
            onCounts={onCounts}
          />
          <p className="px-3 pb-2 pt-1 text-[11px] leading-relaxed text-ink-muted">
            Violet dots are individual atoms. Beam thickness is the exact predicted intensity; the
            percentages are what has actually been counted. A rose bar is a beam stop — those atoms
            are absorbed and never reach the next magnet. The lower panel plots cos²(Δ/2) with your
            measured fractions dropped on top, one point per angle you have run. If your system asks
            for reduced motion, the beam counts in batches a few times a second instead of animating
            individual atoms — and &ldquo;Fire 5,000&rdquo; works either way.
          </p>
        </div>
      }
      controls={controls}
    >
      <div className="card mb-6 p-6">
        <h2 className="section-label mb-3">Counts, analyser by analyser</h2>
        {/* Wide content scrolls inside its own box; the page never scrolls sideways. */}
        <div className="-mx-2 overflow-x-auto px-2">
          <table className="w-full min-w-[520px] border-collapse text-left text-sm">
            <caption className="sr-only">
              Running counts at each analyser, with the measured fraction leaving the up port beside
              the exact prediction.
            </caption>
            <thead>
              <tr className="border-b border-line text-[11px] uppercase tracking-wider text-ink-muted">
                <th scope="col" className="py-2 pr-3 font-bold">Analyser</th>
                <th scope="col" className="py-2 pr-3 font-bold">Axis</th>
                <th scope="col" className="py-2 pr-3 text-right font-bold">Reached it</th>
                <th scope="col" className="py-2 pr-3 text-right font-bold">↑ up</th>
                <th scope="col" className="py-2 pr-3 text-right font-bold">↓ down</th>
                <th scope="col" className="py-2 pr-3 text-right font-bold">Measured ↑</th>
                <th scope="col" className="py-2 text-right font-bold">Predicted ↑</th>
              </tr>
            </thead>
            <tbody className="font-mono text-[13px]">
              {chain.map((a, i) => {
                const reached = (counts.plus[i] ?? 0) + (counts.minus[i] ?? 0)
                const up = counts.plus[i] ?? 0
                const down = counts.minus[i] ?? 0
                return (
                  <tr key={i} className="border-b border-line">
                    <th scope="row" className="py-2 pr-3 text-left font-sans font-semibold text-ink">
                      {i + 1}
                      {i === length - 1
                        ? ' (detector)'
                        : a.port === 1
                          ? ' · ↑ continues'
                          : ' · ↓ continues'}
                    </th>
                    <td className="py-2 pr-3 text-q-violet-text">
                      {axisLabel(angles[i])} ({angles[i].toFixed(0)}°)
                    </td>
                    <td className="py-2 pr-3 text-right text-ink-secondary">
                      {reached.toLocaleString('en-US')}
                    </td>
                    <td className="py-2 pr-3 text-right text-q-teal-text">
                      {up.toLocaleString('en-US')}
                    </td>
                    <td className="py-2 pr-3 text-right text-q-sky-text">
                      {down.toLocaleString('en-US')}
                    </td>
                    <td className="py-2 pr-3 text-right text-ink">
                      {reached > 0 ? pct(up / reached) : '—'}
                    </td>
                    <td className="py-2 text-right text-ink-muted">{pct(predicted[i])}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[13px] text-ink-secondary">
          {counts.emitted.toLocaleString('en-US')} atoms have left the oven. Only the beam you let
          through reaches the next magnet, so each row counts fewer atoms than the one above it.
        </p>
      </div>

      <Explainer title="Run these three, in this order">
        <p>
          <strong className="text-ink">z → z.</strong> One magnet splits the beam in two. Take the
          up half and send it into a second magnet pointing the same way. Every single atom comes
          out up. Nothing surprising — the beam was measured, and measuring it again agrees.
        </p>
        <p>
          <strong className="text-ink">z → x.</strong> Now turn the second magnet sideways. The
          beam that was definitely up on z splits evenly. Also not surprising yet: nobody ever
          measured its x component, so why would it have one?
        </p>
        <p>
          <strong className="text-ink">z → x → z.</strong> Take the x-up half and put it back
          through a z magnet. The atoms in that beam were all measured z-up, and you threw none of
          them away. Watch the last two counters. Wait for a few thousand atoms.
        </p>
      </Explainer>

      <Explainer title="What just happened">
        <p>
          The third analyser reads 50/50. Half the atoms come out <em>down</em> on an axis where
          every one of them had already been measured up.
        </p>
        <p>
          Nothing went wrong with the apparatus and nothing was randomised by hand. The middle
          magnet did not disturb a value the atom was quietly carrying: after it, there is no
          z value to disturb. The x measurement replaced the state, and the replacement has no
          z component to remember. Set the middle analyser back to 0° and the last counter snaps to
          100% again — the loss is caused by the <em>angle</em>, not by the extra magnet.
        </p>
        <p>
          That is the difference between a quantum measurement and reading a label off a box. Spin
          along z and spin along x are not two properties an atom has at once; committing to one
          erases the other. The 50/50 you just watched accumulate is the erasure, counted.
        </p>
      </Explainer>

      <Explainer title="The only formula on this page">
        <p>
          Rotate the last analyser and watch the amber marker slide along the curve. If the spin
          arriving at an analyser points along one direction and the analyser measures along
          another, Δ apart, the fraction leaving the up port is cos²(Δ/2).
        </p>
        <p>
          At Δ = 0 that is 1 — perfect agreement. At 60° it is exactly ¾. At 90° it is ½, which is
          the z → x step. At 180° it is 0: the analyser is pointing the opposite way, and every atom
          leaves through the other port. Let a few thousand atoms through at each angle and the teal
          points settle onto the violet curve; they are measurements, not the formula drawn twice.
        </p>
        <p>
          The half in Δ/2 is not a typo, and it is the tell that this is a spin-½ and not an arrow.
          Two directions 180° apart on the Bloch sphere describe states that exclude each other
          completely, while two <em>perpendicular</em> axes — z and x — give no information about
          each other at all.
        </p>
      </Explainer>

      <Explainer title="Silver atoms, 1922">
        <p>
          Otto Stern and Walther Gerlach fired a beam of silver atoms through a non-uniform magnetic
          field in Frankfurt and caught them on a glass plate. Classical physics said the atomic
          magnets would point every which way and the beam would smear into a band. The old quantum
          theory of Bohr and Sommerfeld, which assigned silver one unit of orbital angular momentum,
          said the magnets could only point along or against the field: two lines. They got two
          lines, cleanly separated — which is what the first magnet on this page is doing — and
          Stern and Gerlach announced it as a triumph for Bohr.
        </p>
        <p>
          The famous part of the story, as Stern later told it, is that the deposit was too faint
          to see until he breathed over the plate — sulphur from the cheap cigars he could afford
          on his salary turned the silver into black silver sulphide, and the two lines appeared.
          (The recollection is Stern&rsquo;s own; Friedrich and Herschbach retell it in{' '}
          <em>Physics Today</em>, December 2003.)
        </p>
        <p>
          The part that matters more: it was the right answer for the wrong reason. A silver
          atom&rsquo;s orbital angular momentum is in fact zero, so the theory they thought they had
          confirmed should have given a single undeflected beam. What split their beam was the spin
          of the lone 5s electron — a property nobody proposed until Uhlenbeck and Goudsmit did,
          three years later. The experiment found spin before anyone had the concept, and for a
          while nobody noticed that it had.
        </p>
      </Explainer>

      <Explainer title="What is and isn't real here">
        <p>
          The single magnet is the 1922 experiment. The chain of two and three magnets with beam
          stops between them is the idealised sequence used to teach spin — Feynman&rsquo;s
          filters, Sakurai&rsquo;s opening chapter — rather than a photograph of a real bench;
          keeping an atomic beam collimated through three successive magnets is hard, and modern
          equivalents of these results are usually obtained with light, trapped ions or NMR.
        </p>
        <p>
          The physics is not idealised. Every branch on this page is the Born rule applied to a
          spin-½ state, sampled one atom at a time, and the numbers it produces are checked in
          <code className="mx-1 rounded bg-surface-3 px-1 py-0.5 text-[12px]">
            lib/viz/sternGerlach.test.ts
          </code>
          against cos²(Δ/2) and against the exact ⅛ yield of the z → x → z chain. If you set the
          simulation up as the real experiment, it gives the real experiment&rsquo;s answer.
        </p>
      </Explainer>
    </VizFrame>
  )
}
