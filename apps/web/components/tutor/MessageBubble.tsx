'use client'

import { Fragment } from 'react'

export type MessageSource = 'agent' | 'direct' | 'offline' | 'device'

export interface MessageBubbleProps {
  role: 'user' | 'assistant'
  content: string
  offline?: boolean
  /** snake_case tool names reported by the agent service, e.g. `run_quantum_circuit`. */
  toolsUsed?: string[]
  source?: MessageSource
}

/**
 * Human labels for the agent's tools. Showing "ran a circuit" is the tutor
 * proving it did not merely assert an answer — it actually checked.
 */
const TOOL_LABELS: Record<string, string> = {
  run_quantum_circuit: 'ran a circuit',
  generate_circuit: 'wrote a circuit',
  explain_measurement: 'read the results',
  check_circuit: 'checked the circuit',
  search_concepts: 'looked it up',
}

function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? name.replace(/_/g, ' ')
}

/**
 * Splits a message into alternating prose / code segments on triple-backtick
 * fences. Even indices are prose, odd indices are code — no markdown library,
 * and nothing is ever injected as HTML.
 */
function splitFences(content: string): string[] {
  return content.split(/```(?:[a-z]*\n)?/)
}

function Prose({ text }: { text: string }) {
  const paragraphs = text.split(/\n\n+/).filter((p) => p.trim().length > 0)
  if (paragraphs.length === 0) return null
  return (
    <>
      {paragraphs.map((p, i) => (
        <p key={i} className="whitespace-pre-wrap text-sm leading-relaxed">
          {p.trim()}
        </p>
      ))}
    </>
  )
}

export default function MessageBubble({
  role,
  content,
  offline,
  toolsUsed,
  source,
}: MessageBubbleProps) {
  const segments = splitFences(content)

  // De-duplicate while keeping the order the agent reported.
  const tools = Array.from(new Set(toolsUsed ?? [])).filter((t) => t.trim().length > 0)

  const body = (
    <div className="space-y-3">
      {segments.map((segment, i) =>
        i % 2 === 1 ? (
          segment.trim().length > 0 ? (
            <pre key={i} className="code-block">
              {segment.replace(/\n$/, '')}
            </pre>
          ) : (
            <Fragment key={i} />
          )
        ) : (
          <Prose key={i} text={segment} />
        ),
      )}
    </div>
  )

  if (role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="ml-auto max-w-[85%] rounded-2xl border border-line bg-surface-2 px-4 py-3 text-ink">
          {body}
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-start gap-3">
      <div
        aria-hidden="true"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-q-violet/20 text-[15px] text-q-violet-text"
      >
        ⚛
      </div>
      <div className="min-w-0 max-w-[85%] space-y-1.5">
        {offline || source === 'offline' ? (
          <span className="pill border-q-amber/40 text-q-amber-text">offline</span>
        ) : null}
        {/* Per-message, not only in the status line: a conversation can contain
            answers from different tiers (the learner switches the on-device
            model on midway, or a hosted call fails back to offline), and a
            single status line above the thread would then mislabel everything
            above it. Teal, matching the "running on this device" line in
            DeviceTutorPanel, so the two read as the same thing. */}
        {source === 'device' ? (
          <span className="pill border-q-teal/40 text-q-teal-text">on your device</span>
        ) : null}
        <div className="rounded-2xl border border-line bg-surface px-4 py-3 text-ink">{body}</div>
        {tools.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            <span className="text-[11px] text-ink-muted">To answer this, I</span>
            {tools.map((tool) => (
              <span key={tool} className="pill border-q-teal/40 bg-q-teal/10 text-q-teal-text">
                {toolLabel(tool)}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}
