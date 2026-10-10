'use client'

import Link from 'next/link'
import { useCallback, useState } from 'react'
import EraserLab, { type EraserStats } from '@/components/viz/EraserLab'
import { VizFrame, Explainer } from '@/components/ui/VizFrame'
import { ButtonRow, Segmented, Slider, Stat, Toggle } from '@/components/ui/Controls'

const DEG = 180 / Math.PI
const fmt3 = (v: number) => v.toFixed(3)
const pct = (p: number) => `${(p * 100).toFixed(1)}%`

const EMPTY_STATS: EraserStats = {
  singles: [0.5, 0.5],
  coincidence: [0.25, 0.25],
  coincidenceOrthogonal: [0.25, 0.25],
  visibility: { singles: 0, coincidence: 1, coincidenceOrthogonal: 1 },
  overlap: 0,
  shots: 0,
  measured: null,
}

type Preset = 'whichPath' | 'partial' | 'erase'

const PRESETS: { value: Preset; label: string; angle: number }[] = [
  { value: 'whichPath', label: 'θ = 0° · read', angle: 0 },
  { value: 'partial', label: 'θ = 22.5° · half', angle: Math.PI / 8 },
  { value: 'erase', label: 'θ = 45° · erase', angle: Math.PI / 4 },
]

export default function QuantumEraserPage() {
  const [phase, setPhase] = useState(Math.PI / 4)
  const [idlerAngle, setIdlerAngle] = useState(Math.PI / 4)
  const [marker, setMarker] = useState(true)
  const [scanning, setScanning] = useState(true)
  const [resetKey, setResetKey] = useState(0)
  const [stats, setStats] = useState<EraserStats>(EMPTY_STATS)

  const onStats = useCallback((s: EraserStats) => setStats(s), [])

  const preset: Preset | '' =
    PRESETS.find((p) => Math.abs(p.angle - idlerAngle) < 1e-6)?.value ?? ''

  const measuredSingles = stats.measured?.singles
  const measuredCoincidence = stats.measured?.coincidence

  const controls = (
    <>
      <Toggle
        label="Mark arm A with a half-wave plate"
        checked={marker}
        onChange={setMarker}
        hint="Turn this off and the interferometer has nothing to erase — fringes come back in the singles."
      />

      <Segmented<Preset | ''>
        label="Idler analyser preset"
        value={preset}
        options={PRESETS.map((p) => ({ value: p.value as Preset | '', label: p.label }))}
        onChange={(v) => {
          const found = PRESETS.find((p) => p.value === v)
          if (found) setIdlerAngle(found.angle)
        }}
      />

      <Slider
        label="Idler polariser θ"
        value={idlerAngle}
        min={0}
        max={Math.PI / 2}
        step={0.005}
        onChange={setIdlerAngle}
        format={(v) => `${(v * DEG).toFixed(1)}°`}
        hint="0° reads the which-path basis. 45° destroys it. In between, erasure is partial: coincidence visibility V = |sin 2θ|."
      />

      <Slider
        label="Interferometer phase φ"
        value={phase}
        min={0}
        max={2 * Math.PI}
        step={0.01}
        onChange={setPhase}
        format={(v) => `${(v / Math.PI).toFixed(2)}π`}
        hint="Where the dashed marker sits on the plot. The scan sweeps this independently."
      />

      <ButtonRow>
        <button
          type="button"
          className="btn-primary focus-ring"
          onClick={() => setScanning((s) => !s)}
        >
          {scanning ? 'Pause scan' : 'Run scan'}
        </button>
        <button
          type="button"
          className="btn-ghost focus-ring"
          onClick={() => setResetKey((k) => k + 1)}
        >
          Clear counts
        </button>
      </ButtonRow>

      <div className="grid grid-cols-2 gap-2">
        <Stat label="Singles visibility" value={fmt3(stats.visibility.singles)} accent="amber" />
        <Stat
          label="Coincidence visibility"
          value={fmt3(stats.visibility.coincidence)}
          accent="violet"
        />
        <Stat
          label="Measured · singles"
          value={measuredSingles == null ? '—' : fmt3(measuredSingles)}
          accent="amber"
        />
        <Stat
          label="Measured · coinc."
          value={measuredCoincidence == null ? '—' : fmt3(measuredCoincidence)}
          accent="violet"
        />
        <Stat label="Path overlap ⟨A|B⟩" value={fmt3(stats.overlap)} accent="rose" />
        <Stat label="Shots" value={stats.shots.toLocaleString('en-US')} accent="sky" />
      </div>

      <div className="rounded-lg border border-line bg-surface-2 p-3">
        <p className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">
          At φ = {(phase / Math.PI).toFixed(2)}π
        </p>
        <dl className="mt-1.5 space-y-1 font-mono text-[11px] text-ink-secondary">
          <div className="flex justify-between gap-2">
            <dt>D1, every shot</dt>
            <dd className="text-q-amber-text">{pct(stats.singles[0])}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt>D1 &amp; idler at θ</dt>
            <dd className="text-q-violet-text">{pct(stats.coincidence[0])}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt>D1 &amp; idler at θ+90°</dt>
            <dd className="text-q-teal-text">{pct(stats.coincidenceOrthogonal[0])}</dd>
          </div>
        </dl>
        <p className="mt-2 text-[11px] leading-relaxed text-ink-muted">
          The bottom two always add to the top one. That is not a coincidence of the numbers; it is
          the reason none of this can send a message.
        </p>
      </div>

      <p className="text-[11px] leading-relaxed text-ink-muted">
        Dots are sampled counts, lines are the computed rates. Each shot is drawn once and counted
        into the singles histogram and into whichever coincidence histogram its idler earns — three
        views of one list of detections.
      </p>
    </>
  )

  return (
    <VizFrame
      title="The Quantum Eraser"
      tagline="Label which path a photon took, lose the interference, then throw the label away after the photon is already detected — and find the interference hiding in the bookkeeping."
      level="Advanced"
      canvas={
        <div className="p-2">
          <EraserLab
            phase={phase}
            markerAngle={marker ? Math.PI / 4 : null}
            idlerAngle={idlerAngle}
            scanning={scanning}
            resetKey={resetKey}
            onStats={onStats}
          />
          <p className="px-3 pb-2 pt-2 text-[11px] leading-relaxed text-ink-muted">
            The amber curve is what detector D1 records, full stop. The violet and teal curves are
            the same clicks, split into two piles according to which way the partner photon came out
            of its polariser. Amber never moves when you turn θ; the two piles trade fringes.
          </p>
        </div>
      }
      controls={controls}
    >
      <Explainer title="The setup, and what to watch">
        <p>
          A crystal emits two photons at once, entangled in polarisation: neither has a polarisation
          of its own, but whatever you find for one, the other matches. One photon — the{' '}
          <em>signal</em> — goes into a Mach-Zehnder interferometer. The other — the{' '}
          <em>idler</em> — flies off down a long fibre to a polariser you can rotate, and a
          detector.
        </p>
        <p>
          A half-wave plate in arm A of the interferometer swaps that arm&rsquo;s horizontal and
          vertical. Because the signal&rsquo;s polarisation is tied to the idler&rsquo;s, this makes
          the two arms carry two-photon states that are perfectly distinguishable. The signal
          detector D1 goes flat: no fringes, at any phase, no matter what.
        </p>
        <p>
          Now run the scan and watch the plot fill in. The amber points — every D1 click, counted —
          sit on a flat line at 50%. The violet points, the subset whose idler passed the polariser,
          swing from 0 to 50% and back: a full-visibility fringe. The teal points, the rest, trace
          exactly the opposite fringe. Turn θ from 45° down to 0° and the two fringes collapse
          together onto a flat 25%. The amber line never moves.
        </p>
      </Explainer>

      <Explainer title="What just happened, stated carefully">
        <p>
          Nothing you did to the idler changed what D1 recorded. That statement is exact, it is
          visible in the readout — the two coincidence rates always sum to the singles rate — and it
          is the single most important fact on this page.
        </p>
        <p>
          What the analyser angle changes is how the shots get <em>sorted</em>. The idler on its own
          carries no which-arm information; the record lives in the <em>joint</em> signal–idler
          polarisation. At θ = 0° the polariser projects the idler onto horizontal, which leaves the
          signal horizontal in one arm and vertical in the other — the arms are still tagged, so
          each pile still looks flat. Reading the arm off would take one more step: measuring the
          signal&rsquo;s own polarisation as well. At θ = 45° the projection onto diagonal leaves
          the signal with the <em>same</em> polarisation in both arms; the tag is gone, and sorting
          by that answer splits the same clicks into two piles that each show perfect interference,
          out of step with one another so their sum is still flat.
        </p>
        <p>
          The fringes were never absent and never restored. Once the idler is measured every click
          belongs to one pile or the other — which pile is random shot by shot, and is only fixed
          when the idler is actually measured — but the statistics of every possible way of sorting
          were fixed by the state the moment the pair was created and the plates were set. The only
          thing the eraser changes is which partition of the data you are allowed to compute — and
          computing it requires the idler results, which arrive by ordinary classical means, at
          ordinary classical speed.
        </p>
      </Explainer>

      <Explainer title="Delayed choice, and what it does not mean">
        <p>
          Make the idler&rsquo;s fibre long enough and the signal photon hits D1 before the idler
          reaches the polariser. You can then set θ after the signal is already recorded. The
          coincidence curves come out identical. This is the delayed-choice configuration, and the
          timeline under the optical table is drawn to that order.
        </p>
        <p>
          It is routinely described as a later choice reaching back to change an earlier event. It
          is not, and the model makes the reason concrete: the idler measurement and the
          signal&rsquo;s trip through the interferometer act on different factors of the same state,
          so the two operations <strong>commute</strong>. The engine behind this page has a unit test
          that does them in both orders and gets the same numbers to twelve digits. Nothing needed to
          travel backwards, because the order was never load-bearing.
        </p>
        <p>
          The reason the experiment <em>feels</em> retrocausal is a genuine subtlety about sorting.
          You cannot see a fringe in a single detection; a fringe is a property of an ensemble. The
          ensemble that shows fringes is defined by the idler results, and you do not hold those
          results until the idler has been measured and the record has been carried to wherever the
          signal record is. Until the two lists are brought together — by a wire, a courier, a
          person — there is nothing but a flat curve.
        </p>
        <p className="rounded-lg border border-q-rose/30 bg-q-rose/[0.07] p-3 text-[13px]">
          <strong className="text-q-rose-text">If it could work the other way, it would be a
          telephone.</strong>{' '}
          Suppose choosing θ = 45° really did put fringes into D1&rsquo;s own record. Then whoever
          holds the idler could send a bit — fringes for 1, no fringes for 0 — instantly, at any
          distance. Quantum mechanics forbids that, and this page shows exactly how: the marginal
          distribution at D1 is fixed by the state alone and contains no θ at all.
        </p>
      </Explainer>

      <Explainer title="Things to try">
        <p>
          <strong>Turn the marker off.</strong> With no half-wave plate the two arms are
          indistinguishable, and the fringes appear in the singles themselves — the amber curve
          starts oscillating. The coincidence curves become half of it, and stay in step with each
          other whatever θ you choose. There is nothing to erase because nothing was written.
        </p>
        <p>
          <strong>Park θ at 22.5°.</strong> The coincidence visibility lands at{' '}
          <span className="font-mono">|sin 2θ| = 0.707</span>. Erasure is not a switch; it is a
          continuous trade between how much which-path information the idler still carries and how
          much fringe survives in the sorted data.
        </p>
        <p>
          <strong>Watch the measured column.</strong> The visibility computed from the sampled
          counts wanders around the exact figure and settles as the shots pile up. That is shot
          noise, the same thing that makes real coincidence experiments take hours. The experiment
          this page is modelled on — Walborn, Terra Cunha, Pádua and Monken (Phys. Rev. A 65, 033818,
          2002), with polarisation markers and a rotatable idler polariser, in the spirit of Kim,
          Yu, Kulik, Shih and Scully&rsquo;s 2000 delayed-choice eraser — ran for exactly that
          reason.
        </p>
        <p>
          Then go back to the{' '}
          <Link
            href="/visualizations/mach-zehnder"
            className="focus-ring rounded font-semibold text-q-violet-text underline decoration-q-violet/40 underline-offset-2 hover:decoration-q-violet"
          >
            Mach-Zehnder page
          </Link>{' '}
          and switch on its 45° detector polariser. That is the same erasure done with a single
          photon and no partner — same physics, no delay, and no mystery available to be
          misreported.
        </p>
      </Explainer>
    </VizFrame>
  )
}
