'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import SuperdenseLab from '@/components/viz/SuperdenseLab'
import { VizFrame, Explainer } from '@/components/ui/VizFrame'
import { ButtonRow, Segmented, Stat, Toggle } from '@/components/ui/Controls'
import {
  ALICE,
  MESSAGES,
  SUPERDENSE_STAGES,
  decodeSuccess,
  decodedProbabilities,
  encodedState,
  encodingOps,
  overlap,
  superdenseFrames,
  type Message,
} from '@/lib/viz/superdense'

const pct = (p: number) => `${(p * 100).toFixed(1)}%`

const GATE_STORY: Record<Message, string> = {
  '00': 'nothing at all',
  '01': 'Z — flip the phase',
  '10': 'X — flip the bit',
  '11': 'X then Z — flip both',
}

export default function SuperdenseCodingPage() {
  const [message, setMessage] = useState<Message>('11')
  const [entangled, setEntangled] = useState(true)
  const [stageIndex, setStageIndex] = useState(0)

  const options = useMemo(() => ({ message, entangled }), [message, entangled])
  const stage = SUPERDENSE_STAGES[stageIndex]

  const frames = useMemo(() => superdenseFrames(options), [options])
  const frameIndex = Math.min(stage.frame(options), frames.length - 1)
  const frame = frames[frameIndex]

  // What Bob would read if he decoded and measured right now. Before the decode
  // this is not yet the answer — which is exactly why the bars only settle at
  // the last step.
  const readout = useMemo(() => {
    const probs = frame.probabilities()
    const out = {} as Record<Message, number>
    for (const m of MESSAGES) out[m] = probs[parseInt(m, 2)]
    return out
  }, [frame])

  const finalReadout = useMemo(() => decodedProbabilities(options), [options])
  const success = finalReadout[message]

  // Alice's own qubit, as anyone intercepting it would find it.
  const aliceVector = useMemo(() => encodedState(options).blochVector(ALICE), [options])
  const aliceLength = Math.hypot(aliceVector.x, aliceVector.y, aliceVector.z)

  const encoded = frameIndex >= (entangled ? 2 : 0) + encodingOps(message).length
  const phase = stage.id === 'send' ? 'flying' : stage.id === 'decode' ? 'arrived' : 'idle'

  const controls = (
    <>
      <Segmented<Message>
        label="Alice wants to send"
        value={message}
        options={MESSAGES.map((m) => ({ value: m, label: m }))}
        onChange={setMessage}
      />

      <div className="rounded-lg border border-line bg-surface-2 px-3 py-2">
        <p className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">
          Her encoding
        </p>
        <p className="mt-0.5 font-mono text-sm text-q-amber-text">{GATE_STORY[message]}</p>
        <p className="mt-1 text-[11px] text-ink-muted">
          Applied to her own qubit only. She never touches Bob&rsquo;s.
        </p>
      </div>

      <div>
        <span className="mb-1.5 block text-[13px] font-semibold text-ink-secondary">
          Step {stageIndex + 1} of {SUPERDENSE_STAGES.length}: {stage.title}
        </span>
        <ButtonRow>
          <button
            type="button"
            className="btn-primary focus-ring"
            onClick={() => setStageIndex((s) => Math.min(SUPERDENSE_STAGES.length - 1, s + 1))}
            disabled={stageIndex === SUPERDENSE_STAGES.length - 1}
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

      <Toggle
        label="Share an entangled pair first"
        checked={entangled}
        onChange={setEntangled}
        hint="Turn it off and run the identical protocol without the resource."
      />

      <div className="grid grid-cols-2 gap-2">
        <Stat
          label="P(message read)"
          value={pct(success)}
          accent={success > 0.999 ? 'teal' : 'rose'}
        />
        <Stat label="Bits through" value={entangled ? '2' : '1'} accent="amber" />
        <Stat label="Qubits sent" value="1" accent="sky" />
        <Stat label="Alice's |r|" value={aliceLength.toFixed(3)} accent="violet" />
      </div>

      <p className="text-[11px] leading-relaxed text-ink-muted">
        The bars are exact probabilities from a two-qubit statevector simulation, not sampled
        counts — a 100% bar means certainty, not a very high estimate.
      </p>
    </>
  )

  return (
    <VizFrame
      title="Superdense Coding"
      tagline="Two classical bits through a single qubit — the trick teleportation is running backwards, spending the same entangled pair."
      level="Intermediate"
      canvas={
        <div className="p-2">
          <SuperdenseLab
            message={message}
            entangled={entangled}
            phase={phase}
            readout={readout}
            encoded={encoded}
            caption={stage.title}
          />
          <p className="px-3 pb-2 pt-1 text-[13px] leading-relaxed text-ink-secondary">
            {stage.narration}
          </p>
        </div>
      }
      controls={controls}
    >
      <Explainer title="Two bits, one qubit">
        <p>
          A qubit sent down a wire can carry, on its own, exactly one bit of classical information.
          That is a theorem, not a limitation of the hardware. Superdense coding does not break it —
          it changes what &ldquo;on its own&rdquo; means.
        </p>
        <p>
          Alice and Bob share an entangled pair, prepared long before Alice knows what she wants to
          say. When she does know, she applies one of four operations to her half — nothing, X, Z,
          or both — and posts that single qubit. Bob undoes the entanglement and reads two bits, with
          no uncertainty at all. Step through it and watch which bar is standing at the end.
        </p>
      </Explainer>

      <Explainer title="The message is not in the qubit">
        <p>
          Watch the <strong>Alice&rsquo;s |r|</strong> readout as you switch between the four
          messages. It stays at <span className="font-mono">0.000</span>. Her qubit&rsquo;s Bloch
          arrow has no length whatever she sends, which means the qubit crossing the channel is
          statistically identical in all four cases — that is why the packet in the drawing is a
          featureless dot rather than four different-looking ones.
        </p>
        <p>
          The message lives in how her qubit is <em>correlated</em> with Bob&rsquo;s, and Bob&rsquo;s
          never moved. Intercept the qubit in flight and you learn nothing; you need both halves,
          which is the same reason this cannot be eavesdropped and the reason it needs the pair.
        </p>
        <div className="my-3 overflow-x-auto rounded-lg border border-line">
          <table className="w-full min-w-[30rem] text-left text-[13px]">
            <caption className="sr-only">
              Each message, the gate Alice applies, and the overlap of the resulting state with the
              state for message 00.
            </caption>
            <thead className="bg-surface-2 text-[11px] uppercase tracking-wider text-ink-muted">
              <tr>
                <th scope="col" className="px-3 py-2 font-bold">Message</th>
                <th scope="col" className="px-3 py-2 font-bold">Alice applies</th>
                <th scope="col" className="px-3 py-2 font-bold">Overlap with the &ldquo;00&rdquo; state</th>
                <th scope="col" className="px-3 py-2 font-bold">Bob reads it back</th>
              </tr>
            </thead>
            <tbody>
              {MESSAGES.map((m) => {
                const ov = overlap(encodedState({ message: '00', entangled }), encodedState({ message: m, entangled }))
                const p = decodedProbabilities({ message: m, entangled })[m]
                return (
                  <tr key={m} className="border-t border-line">
                    <td className="px-3 py-2 font-mono">{m}</td>
                    <td className="px-3 py-2">{GATE_STORY[m]}</td>
                    <td className="px-3 py-2 font-mono">{ov.toFixed(3)}</td>
                    <td
                      className={`px-3 py-2 font-semibold ${p > 0.999 ? 'text-q-teal-text' : 'text-q-rose-text'}`}
                    >
                      {pct(p)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="text-[13px] text-ink-muted">
          With the pair shared, every overlap off the diagonal is{' '}
          <span className="font-mono">0.000</span>: the four states are mutually orthogonal, and
          orthogonal states can be told apart with certainty. That single fact is the whole
          protocol. Turn the pair off and two of those zeros become{' '}
          <span className="font-mono">1.000</span> — two of the four messages become literally the
          same state, and no measurement in the universe separates them.
        </p>
      </Explainer>

      <Explainer title="Take the entanglement away">
        <p>
          Untick <strong>Share an entangled pair first</strong>. Alice applies exactly the same
          gates, sends exactly the same qubit, and Bob runs exactly the same decoder. The message
          now comes back {pct(decodeSuccess(false))} of the time instead of{' '}
          {pct(decodeSuccess(true))}.
        </p>
        <p>
          The bit that survives is the one Alice wrote with X. The one she wrote with Z is gone,
          because Z on an un-entangled |0⟩ does nothing at all — it changes a phase that no
          measurement on that qubit alone can see. Entanglement is what turns that invisible phase
          into a bit Bob can read, and that is the concrete sense in which it is a{' '}
          <em>resource</em>: it is consumed, it cannot be copied, and one pair buys exactly one
          extra bit.
        </p>
      </Explainer>

      <Explainer title="The same trade, run the other way">
        <p>
          Put the two protocols side by side and they are one idea.{' '}
          <Link
            href="/visualizations/teleportation"
            className="focus-ring rounded font-semibold underline underline-offset-2"
          >
            Teleportation
          </Link>{' '}
          spends one entangled pair plus two classical bits to move one qubit. Superdense coding
          spends one entangled pair plus one qubit to move two classical bits.
        </p>
        <p>
          Same ledger, read in opposite directions — and in both cases the pair has to be there
          first, shared in advance, and is used up in the process. Neither protocol sends anything
          faster than light, and neither works without the classical or quantum message that
          actually crosses the gap.
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
          has this as the preset <em>Superdense Coding (message 11)</em>. It is only six gates: H,
          CX, then Alice&rsquo;s Z and X, then CX and H again. Change the middle two and the answer
          changes with them, every shot, with no spread at all.
        </p>
      </Explainer>
    </VizFrame>
  )
}
