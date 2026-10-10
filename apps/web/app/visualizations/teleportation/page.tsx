'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import TeleportLab from '@/components/viz/TeleportLab'
import { VizFrame, Explainer } from '@/components/ui/VizFrame'
import { ButtonRow, Segmented, Slider, Stat, Toggle } from '@/components/ui/Controls'
import {
  BOB,
  PAYLOAD,
  PRESET_STATES,
  TELEPORT_STAGES,
  averageBobVector,
  blochDistance,
  blochFidelity,
  blochLength,
  blochOf,
  teleportBranches,
  teleportFrames,
} from '@/lib/viz/teleportation'

const pct = (p: number) => `${(p * 100).toFixed(1)}%`
const rad = (v: number) => `${(v / Math.PI).toFixed(2)}π`

type BranchKey = '00' | '01' | '10' | '11'

/**
 * The last frame before anything is measured — the end of the Bell-basis
 * rotation (op table in lib/viz/teleportation.ts). Frames up to here are the
 * same in all four branches, and Bob's reduced state in this frame is the only
 * thing he can know about his qubit until the classical bits reach him.
 */
const PRE_MEASUREMENT_FRAME = TELEPORT_STAGES.find((s) => s.id === 'bell')?.frame ?? 6

const BRANCH_OPTIONS: { value: BranchKey; label: string }[] = [
  { value: '00', label: 'c₁c₀ = 00' },
  { value: '01', label: '01' },
  { value: '10', label: '10' },
  { value: '11', label: '11' },
]

export default function TeleportationPage() {
  const [theta, setTheta] = useState(1.1)
  const [phi, setPhi] = useState(2.3)
  const [stageIndex, setStageIndex] = useState(0)
  const [branch, setBranch] = useState<BranchKey>('10')
  const [correct, setCorrect] = useState(true)

  const stage = TELEPORT_STAGES[stageIndex]
  const c1 = (branch[0] === '1' ? 1 : 0) as 0 | 1
  const c0 = (branch[1] === '1' ? 1 : 0) as 0 | 1

  const alice = useMemo(() => blochOf(theta, phi), [theta, phi])
  const bits = useMemo(() => ({ c0, c1 }), [c0, c1])

  const frames = useMemo(
    () => teleportFrames({ theta, phi, correct }, { c0, c1 }),
    [theta, phi, correct, c0, c1]
  )
  // A circuit without the corrections is two ops shorter, so the last stage's
  // frame index has to be clamped rather than trusted.
  const frame = frames[Math.min(stage.frame, frames.length - 1)]
  // The payload qubit as it actually is. Alice knows her own outcome, so this
  // may follow the chosen branch: prepared arrow → cloud → ±z.
  const payload = frame.blochVector(PAYLOAD)
  // Bob's qubit as Bob can know it. `frames` is computed for one forced branch,
  // and reading Bob's vector out of it after the measurement would draw the
  // branch's full-length arrow before the bits have landed — a picture of
  // faster-than-light signalling. Until the channel has delivered, the only
  // state Bob is entitled to is the pre-measurement reduced state, which is
  // the zero vector from the moment the pair is shared.
  const bob =
    stage.channel === 'arrived'
      ? frame.blochVector(BOB)
      : frames[Math.min(stage.frame, PRE_MEASUREMENT_FRAME)].blochVector(BOB)

  const branches = useMemo(() => teleportBranches({ theta, phi, correct }), [theta, phi, correct])
  const blind = useMemo(
    () => averageBobVector(teleportBranches({ theta, phi, correct: false })),
    [theta, phi]
  )

  // Alice only has bits once she has measured — stage 'measure' and later.
  const measured = stage.frame >= 8
  // The bits have left Alice once the channel is no longer idle.
  const sent = stage.channel !== 'idle'
  const fidelity = blochFidelity(alice, bob)
  const branchProbability = branches.find((b) => b.label === branch)?.probability ?? 0.25

  // The last stage's copy assumes the correction happens. With it switched off
  // the step is still real — Bob does nothing — and the narration has to say so
  // rather than describe a gate that was not applied.
  const narration =
    stage.id === 'correct' && !correct
      ? 'Correction switched off, so Bob does nothing at all. Three outcomes out of four leave him holding a perfectly good pure state that is simply the wrong one — and no measurement he can make tells him which.'
      : stage.narration

  const activePreset = PRESET_STATES.find(
    (p) => Math.abs(p.theta - theta) < 1e-9 && Math.abs(p.phi - phi) < 1e-9
  )

  const controls = (
    <>
      <Segmented
        label="Send this state"
        value={activePreset?.id ?? 'custom'}
        // The "custom" chip appears only while the sliders are somewhere the
        // presets are not, so there is never a button that does nothing.
        options={[
          ...PRESET_STATES.map((p) => ({ value: p.id, label: p.label })),
          ...(activePreset ? [] : [{ value: 'custom', label: 'custom' }]),
        ]}
        onChange={(id) => {
          const p = PRESET_STATES.find((x) => x.id === id)
          if (p) {
            setTheta(p.theta)
            setPhi(p.phi)
          }
        }}
      />

      <Slider
        label="Polar angle θ"
        value={theta}
        min={0}
        max={Math.PI}
        step={Math.PI / 60}
        onChange={setTheta}
        format={rad}
        hint="How far from |0⟩ toward |1⟩ the state sits."
      />
      <Slider
        label="Phase φ"
        value={phi}
        min={0}
        max={Math.PI * 2}
        step={Math.PI / 60}
        onChange={setPhi}
        format={rad}
        hint="The part a classical bit cannot carry — and the part that still arrives."
      />

      <div>
        <span className="mb-1.5 block text-[13px] font-semibold text-ink-secondary">
          Step {stageIndex + 1} of {TELEPORT_STAGES.length}: {stage.title}
        </span>
        <ButtonRow>
          <button
            type="button"
            className="btn-primary focus-ring"
            onClick={() => setStageIndex((s) => Math.min(TELEPORT_STAGES.length - 1, s + 1))}
            disabled={stageIndex === TELEPORT_STAGES.length - 1}
          >
            Next step
          </button>
          <button
            type="button"
            className="btn-ghost focus-ring"
            onClick={() => setStageIndex((s) => Math.max(0, s - 1))}
            disabled={stageIndex === 0}
          >
            Back
          </button>
          <button type="button" className="btn-ghost focus-ring" onClick={() => setStageIndex(0)}>
            Restart
          </button>
        </ButtonRow>
      </div>

      <Segmented<BranchKey>
        label="Alice's measurement came out"
        value={branch}
        options={BRANCH_OPTIONS}
        onChange={setBranch}
      />

      <Toggle
        label="Apply Bob's correction"
        checked={correct}
        onChange={setCorrect}
        hint="Turn it off to see what the two classical bits were actually for."
      />

      <div className="grid grid-cols-2 gap-2">
        <Stat
          label="Fidelity"
          value={pct(fidelity)}
          accent={stage.channel === 'arrived' && fidelity > 0.999 ? 'teal' : 'rose'}
        />
        <Stat label="Bob's |r|" value={blochLength(bob).toFixed(3)} accent="sky" />
        <Stat label="P(this outcome)" value={pct(branchProbability)} accent="amber" />
        <Stat label="Bits sent" value={sent ? '2' : '0'} accent="violet" />
      </div>

      <p className="text-[11px] leading-relaxed text-ink-muted">
        Every number here comes from a three-qubit statevector simulation that really measures and
        really conditions Bob&rsquo;s gates on the result — not from a script of what should happen.
      </p>
    </>
  )

  return (
    <VizFrame
      title="Quantum Teleportation"
      tagline="A qubit's state crosses the room without the qubit — and it still needs two ordinary bits, sent the slow way, to get there."
      level="Intermediate"
      canvas={
        <div className="p-2">
          <TeleportLab
            alice={alice}
            payload={payload}
            bob={bob}
            entangled={stage.frame >= 4}
            channel={stage.channel}
            bits={measured ? bits : null}
            caption={stage.title}
          />
          <p className="px-3 pb-2 pt-1 text-[13px] leading-relaxed text-ink-secondary">
            {narration}
          </p>
        </div>
      }
      controls={controls}
    >
      <Explainer title="What you are looking at">
        <p>
          Pick a state with the two sliders — any point on the sphere, including the ones with a
          phase, which is the half of a qubit a classical bit cannot describe. Then walk the seven
          steps and watch both spheres. The left one is the payload qubit itself, not a label for
          what Alice chose: once it stops pointing where she prepared it, the prepared direction
          stays on only as a faint dashed ghost, so you can still compare it with Bob&rsquo;s arrow.
        </p>
        <p>
          The thing to watch for is the moment Bob&rsquo;s arrow <em>disappears</em>. From the
          instant the pair is shared until the instant the classical bits land, his qubit has no
          direction at all: the drawing shows a cloud, not a short arrow, because a maximally mixed
          state genuinely has nowhere to point. Every measurement Bob can make on it comes out a
          coin flip, whatever Alice did.
        </p>
      </Explainer>

      <Explainer title="The two bits are the whole protocol">
        <p>
          Turn off <strong>Apply Bob&rsquo;s correction</strong> and step through all four outcomes.
          For a generic state one of them — 00 — arrives correct by luck; the other three arrive
          rotated by X, by Z, or by both. (For special states like |0⟩ or |+⟩ a second branch
          happens to be exact too — the table shows which.) Bob&rsquo;s qubit is in a perfectly
          good pure state; it is simply the wrong one, and nothing he can do to it alone will tell
          him which.
        </p>
        <p>
          Alice&rsquo;s two bits are the missing information. They cost two bits because there are
          exactly four possibilities, each with probability{' '}
          <span className="font-mono">0.25</span> no matter what state she sent — which is also why
          the bits are safe to shout across a room: on their own they say nothing about the state.
        </p>
        <div className="my-3 overflow-x-auto rounded-lg border border-line">
          <table className="w-full min-w-[26rem] text-left text-[13px]">
            <caption className="sr-only">
              The four Bell outcomes, their probabilities, the correction each one calls for, and
              whether Bob&rsquo;s state matches Alice&rsquo;s.
            </caption>
            <thead className="bg-surface-2 text-[11px] uppercase tracking-wider text-ink-muted">
              <tr>
                <th scope="col" className="px-3 py-2 font-bold">c₁c₀</th>
                <th scope="col" className="px-3 py-2 font-bold">Probability</th>
                <th scope="col" className="px-3 py-2 font-bold">Bob applies</th>
                <th scope="col" className="px-3 py-2 font-bold">Result</th>
              </tr>
            </thead>
            <tbody>
              {branches.map((b) => {
                const ok = blochDistance(b.bob, alice) < 1e-9
                return (
                  <tr key={b.label} className="border-t border-line">
                    <td className="px-3 py-2 font-mono">{b.label}</td>
                    <td className="px-3 py-2 font-mono">{pct(b.probability)}</td>
                    <td className="px-3 py-2">{b.correction}</td>
                    <td
                      className={`px-3 py-2 font-semibold ${ok ? 'text-q-teal-text' : 'text-q-rose-text'}`}
                    >
                      {ok ? 'exact match' : `off by ${blochDistance(b.bob, alice).toFixed(2)}`}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="text-[13px] text-ink-muted">
          With the correction on, all four rows read <em>exact match</em> — the protocol works for
          every outcome, not on average.
        </p>
      </Explainer>

      <Explainer title="Why this is not faster-than-light communication">
        <p>
          The tempting story is that Alice&rsquo;s measurement instantly changes Bob&rsquo;s qubit,
          so something crossed the gap instantly. Something did change — but nothing Bob can detect.
        </p>
        <p>
          Before the bits arrive, Bob does not know which of the four branches he is in, so the state
          he actually has is the average of all four. For this input that average has Bloch length{' '}
          <span className="font-mono">{blochLength(blind).toFixed(3)}</span> — zero, to within
          floating point. Slide θ and φ anywhere you like: it stays zero. His statistics are
          identical for every state Alice could have sent, and for the case where she sent nothing at
          all. There is no measurement that distinguishes them, so there is no message.
        </p>
        <p>
          The information Bob is missing travels in the classical channel, at the speed a classical
          channel travels, and the protocol simply waits for it. That is the step labelled{' '}
          <strong>Send 2 bits</strong>, and it is the only step in which nothing quantum happens at
          all.
        </p>
      </Explainer>

      <Explainer title="Nothing was copied">
        <p>
          Watch the left sphere as you step. At <strong>Bell basis</strong> the payload is already
          entangled with Alice&rsquo;s half of the pair, and its arrow shrinks to length{' '}
          <span className="font-mono">|cos θ|</span> along x: the phase φ — the half a classical
          bit could never carry — is the first thing to go, and for a state on the equator nothing is
          left but a cloud. After <strong>Measure</strong> it sits at ±z, a definite computational
          state carrying no trace of θ or φ. The dashed ghost is only a reminder of what was
          prepared; the qubit no longer points there. The state was not duplicated and then
          transmitted — it was destroyed at one end and rebuilt at the other.
        </p>
        <p>
          That is not a design choice, it is forced. If teleportation left the original intact you
          would have a perfect cloning machine, and cloning an unknown quantum state is impossible.
          The protocol pays for the copy it makes by giving up the original, every time.
        </p>
      </Explainer>

      <Explainer title="Build it yourself">
        <p>
          The{' '}
          <Link
            href="/simulator"
            className="focus-ring rounded font-semibold underline underline-offset-2"
          >
            circuit simulator
          </Link>{' '}
          can express this circuit for real: place a measurement, choose which classical bit it
          records into, then place an X and a Z bound to those bits. The preset{' '}
          <em>Teleportation (real classical wires)</em> loads the finished version — press Run and
          watch the Bell result change from shot to shot while qubit 2 comes out right every time.
        </p>
      </Explainer>
    </VizFrame>
  )
}
