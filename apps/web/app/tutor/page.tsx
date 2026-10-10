'use client'

import { useState } from 'react'
import ChatPanel, { type TutorLevel } from '@/components/tutor/ChatPanel'
import { PRESETS } from '@/lib/quantum'

const LEVELS: { id: TutorLevel; label: string; hint: string }[] = [
  { id: 'beginner', label: 'Beginner', hint: 'Plain language, analogies first' },
  { id: 'intermediate', label: 'Intermediate', hint: 'Dirac notation, small matrices' },
  { id: 'advanced', label: 'Advanced', hint: 'Precise formalism, no hand-holding' },
]

export default function TutorPage() {
  const [level, setLevel] = useState<TutorLevel>('beginner')
  const [starter, setStarter] = useState('')

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-6">
        <p className="section-label">AI Tutor</p>
        <h1 className="section-title mt-1">Ask anything about quantum mechanics</h1>
        <p className="section-desc mt-2 max-w-2xl">
          QuantumMind adapts its explanations to your level — from everyday analogies to the full
          formalism — and can reason about the circuit you are currently building, gate by gate.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/*
          The `key` deliberately remounts ChatPanel whenever a starter question is
          chosen, which seeds the new initialInput — and resets the conversation.
        */}
        <div className="card h-[min(50vh,600px)] min-h-[320px] overflow-hidden sm:h-[600px]">
          <ChatPanel key={starter} initialInput={starter} level={level} />
        </div>

        <aside className="card space-y-6 p-5">
          <section>
            <h2 className="section-label">Your level</h2>
            <div className="mt-3 flex flex-col gap-1.5">
              {LEVELS.map((l) => {
                const selected = l.id === level
                return (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => setLevel(l.id)}
                    aria-pressed={selected}
                    className={`focus-ring rounded-lg border px-3 py-2 text-left transition-colors duration-150 ${
                      selected
                        ? // bg-primary is --q-violet-strong, NOT --q-violet.
                          // --q-violet is a mark/series colour tuned to be seen
                          // AGAINST a surface, not to sit behind text: white on
                          // it is 2.34:1. --q-violet-strong exists for exactly
                          // this job — a solid violet fill under white — and is
                          // what .btn-primary already uses, for the same reason
                          // and with the same comment in globals.css.
                          'border-primary bg-primary text-white'
                        : 'border-line bg-surface-2 text-ink-secondary hover:border-line-strong hover:text-ink'
                    }`}
                  >
                    <span className="block text-sm font-semibold">{l.label}</span>
                    <span
                      // white/85, not white/75: at 75% over --q-violet-strong the
                      // hint is 4.31:1, just under the 4.5:1 this 12px text needs.
                      // 85% measures 5.04:1 dark and 5.75:1 light.
                      className={`block text-xs ${selected ? 'text-white/85' : 'text-ink-muted'}`}
                    >
                      {l.hint}
                    </span>
                  </button>
                )
              })}
            </div>
          </section>

          <section>
            <h2 className="section-label">Try asking about</h2>
            <div className="mt-3 flex flex-col gap-1.5">
              {PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => setStarter(`Explain the ${preset.name} circuit to me`)}
                  className="focus-ring rounded-lg border border-line bg-surface-2 px-3 py-2 text-left transition-colors duration-150 hover:border-line-strong"
                >
                  <span className="block text-sm font-semibold text-ink">{preset.name}</span>
                  <span className="mt-0.5 block text-xs text-ink-muted">{preset.blurb}</span>
                </button>
              ))}
            </div>
          </section>

          <section>
            <h2 className="section-label">What it can actually do</h2>
            <ul className="mt-2 space-y-2 text-xs text-ink-muted">
              <li>
                <span className="font-semibold text-ink-secondary">Runs your circuit</span> —
                executes it on a real Qiskit/Aer backend to check its own answer, rather than
                asserting one.
              </li>
              <li>
                <span className="font-semibold text-ink-secondary">Inspects the statevector</span>{' '}
                step by step, and can diff two circuits to show exactly where they diverge.
              </li>
              <li>
                <span className="font-semibold text-ink-secondary">Reads real papers</span> —
                fetches an arXiv abstract by ID when a question calls for a primary source, not
                just a summary.
              </li>
              <li>
                <span className="font-semibold text-ink-secondary">Quizzes and recommends</span> —
                generates a quiz on a concept and suggests the next lesson based on where you
                actually are, not a fixed syllabus.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="section-label">Tiered by design</h2>
            <p className="mt-2 text-xs text-ink-muted">
              The dot next to the tutor&rsquo;s name above shows which tier answered last: teal
              means the full tool-calling tutor ran your circuit to check itself, violet means a
              direct model answered without tools, amber means the built-in offline material
              covered it. Every tier gives a real answer — nothing here ever just says
              &ldquo;unavailable.&rdquo;
            </p>
          </section>
        </aside>
      </div>
    </div>
  )
}
