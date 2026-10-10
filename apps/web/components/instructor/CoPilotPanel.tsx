'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { authFetch } from '@/lib/authFetch'
import { Segmented } from '@/components/ui/Controls'
import { LESSONS } from '@/lib/lessons'

/** Which tier of the tutor stack answered — mirrors `Source` in app/api/agent/route.ts. */
type Source = 'agent' | 'direct' | 'offline'

/** Response shape of POST /api/agent. Matches components/tutor/ChatPanel.tsx. */
interface AgentResponse {
  reply?: string
  offline?: boolean
  source?: Source
  error?: boolean
}

/** Response shape of GET /api/agent — which tier is live right now. */
interface AgentStatusResponse {
  source?: Source
}

type TaskId = 'quiz' | 'example' | 'script' | 'analogies' | 'check'

interface Task {
  id: TaskId
  label: string
  /** Placeholder for the free-text box — tells the instructor what it is for. */
  placeholder: string
  /** Builds the full prompt from the chosen lesson and the extra notes. */
  build: (lesson: LessonContext, notes: string) => string
}

interface LessonContext {
  title: string
  subtitle: string
  level: string
  minutes: number
  objectives: string[]
}

const SOURCE_LABEL: Record<Source, string> = {
  agent: 'Agent service (tool-calling)',
  direct: 'Direct model call (Gemini / Groq / Anthropic)',
  offline: 'Offline FAQ (no API key configured)',
}

/** Shared preamble so every task gets the same context about the course. */
function lessonBlock(lesson: LessonContext): string {
  return [
    `Lesson: "${lesson.title}" — ${lesson.subtitle}`,
    `Level: ${lesson.level}. Nominal reading time: ${lesson.minutes} minutes.`,
    'Learning objectives:',
    ...lesson.objectives.map((o) => `  - ${o}`),
  ].join('\n')
}

const PREAMBLE =
  'You are helping an instructor build material for Qubit16, an interactive quantum ' +
  'computing course. The audience is technically literate but new to quantum mechanics. ' +
  'Be precise: do not say a qubit "is both 0 and 1 at once", do not claim quantum computers ' +
  'try all answers in parallel, and do not overstate speedups. Where a claim depends on a ' +
  'subtlety, name the subtlety.'

const TASKS: Task[] = [
  {
    id: 'quiz',
    label: 'Quiz questions',
    placeholder:
      'Anything to steer the questions — e.g. "focus on the Born rule", "avoid anything needing matrix algebra", "make one of them a trap for the parallel-universe misconception".',
    build: (lesson, notes) =>
      [
        PREAMBLE,
        '',
        lessonBlock(lesson),
        '',
        'TASK: Write 5 multiple-choice quiz questions for this lesson.',
        'For each question give: the prompt, four options labelled A-D, the correct letter, and ' +
          'a 2-3 sentence explanation that teaches something rather than just restating the answer.',
        'At least one distractor per question should be a real misconception a learner actually ' +
          'holds, not an obviously silly option. Rank the questions easiest first.',
        notes ? `\nAdditional direction from the instructor:\n${notes}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
  },
  {
    id: 'example',
    label: 'Worked example',
    placeholder:
      'The example you want worked — e.g. "trace H then CX on |00> amplitude by amplitude" or "show why measuring one Bell qubit sends no signal".',
    build: (lesson, notes) =>
      [
        PREAMBLE,
        '',
        lessonBlock(lesson),
        '',
        'TASK: Write one fully worked example for this lesson.',
        'Show every intermediate step with the actual numbers — amplitudes as exact expressions ' +
          '(1/sqrt(2), not 0.707) wherever possible. After each step, say in one sentence WHY that ' +
          'step is being taken. End with a short "what to notice" paragraph and one variation the ' +
          'learner can try themselves.',
        notes ? `\nThe example to work:\n${notes}` : '\nPick the single most instructive example for this lesson.',
      ].join('\n'),
  },
  {
    id: 'script',
    label: 'Video script',
    placeholder:
      'Length, tone, or framing — e.g. "6 minutes, conversational, open on the double-slit".',
    build: (lesson, notes) =>
      [
        PREAMBLE,
        '',
        lessonBlock(lesson),
        '',
        'TASK: Draft a video script for this lesson.',
        'Format it as a two-column outline: SPOKEN on the left, ON SCREEN on the right (describe ' +
          'the visual or the circuit diagram). Open with a concrete hook, not a definition. ' +
          'Flag every place where an animation would carry the explanation better than words. ' +
          'Mark the single sentence that is the point of the whole video.',
        notes ? `\nConstraints:\n${notes}` : '\nAssume roughly 6 minutes of runtime.',
      ].join('\n'),
  },
  {
    id: 'analogies',
    label: 'Analogies',
    placeholder:
      'Who the audience is, or analogies you have already tried and disliked — e.g. "software engineers, and please not the coin-flip one".',
    build: (lesson, notes) =>
      [
        PREAMBLE,
        '',
        lessonBlock(lesson),
        '',
        'TASK: Propose 4 analogies for the central idea of this lesson.',
        'For each one give: the analogy, exactly what it gets right, and — this is the important ' +
          'part — exactly where it breaks down and what wrong intuition a learner would pick up if ' +
          'they pushed it too far. Rank them by how far they can be pushed before breaking.',
        notes ? `\nAudience and constraints:\n${notes}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
  },
  {
    id: 'check',
    label: 'Check my draft',
    placeholder: 'Paste the draft you want checked.',
    build: (lesson, notes) =>
      [
        PREAMBLE,
        '',
        lessonBlock(lesson),
        '',
        'TASK: Review the instructor draft below for conceptual errors.',
        'Report in three sections: (1) OUTRIGHT ERRORS — anything physically or mathematically ' +
          'wrong, quoted verbatim with the correction; (2) MISLEADING — technically defensible but ' +
          'likely to plant a wrong intuition, with a suggested rewrite; (3) MISSING — a caveat or ' +
          'step whose absence will trip learners up. If a section is empty, say so explicitly ' +
          'rather than inventing findings.',
        '',
        '--- DRAFT ---',
        notes || '(The instructor has not pasted a draft yet.)',
        '--- END DRAFT ---',
      ].join('\n'),
  },
]

export default function CoPilotPanel() {
  const [taskId, setTaskId] = useState<TaskId>('quiz')
  const [slug, setSlug] = useState<string>(LESSONS[0]?.slug ?? '')
  const [notes, setNotes] = useState('')
  const [reply, setReply] = useState<string | null>(null)
  const [replySource, setReplySource] = useState<Source | null>(null)
  const [status, setStatus] = useState<Source | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<'prompt' | 'reply' | null>(null)

  // Ask the route which tier is live so the page can be honest before the
  // instructor spends a click.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await authFetch('/api/agent', { method: 'GET' })
        if (!res.ok) return
        const data = (await res.json()) as AgentStatusResponse
        if (cancelled) return
        if (data.source === 'agent' || data.source === 'direct' || data.source === 'offline') {
          setStatus(data.source)
        }
      } catch {
        // Status is a nicety; the compose-and-copy path works regardless.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const task = TASKS.find((t) => t.id === taskId) ?? TASKS[0]
  const lesson = LESSONS.find((l) => l.slug === slug) ?? LESSONS[0]

  const prompt = useMemo(() => {
    if (!lesson) return ''
    return task.build(
      {
        title: lesson.title,
        subtitle: lesson.subtitle,
        level: lesson.level,
        minutes: lesson.minutes,
        objectives: lesson.objectives,
      },
      notes.trim()
    )
  }, [task, lesson, notes])

  /** The offline FAQ answers canned questions; it cannot author material. */
  const offlineOnly = status === 'offline'

  const copy = useCallback(async (text: string, which: 'prompt' | 'reply') => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(which)
      window.setTimeout(() => setCopied(null), 1800)
    } catch {
      setCopied(null)
    }
  }, [])

  const send = useCallback(async () => {
    setLoading(true)
    setError(null)
    setReply(null)
    setReplySource(null)
    try {
      const res = await authFetch('/api/agent', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: prompt }],
          level: 'advanced',
        }),
      })
      const data = (await res.json()) as AgentResponse
      const source =
        data.source === 'agent' || data.source === 'direct' || data.source === 'offline'
          ? data.source
          : null
      if (source) setStatus(source)
      setReplySource(source)
      setReply(
        typeof data.reply === 'string' && data.reply.trim().length > 0
          ? data.reply
          : 'No answer came back that time. Try again, or copy the prompt below into a model of your choice.'
      )
    } catch {
      setError('Could not reach the tutor route. Copy the prompt below and use it directly.')
    } finally {
      setLoading(false)
    }
  }, [prompt])

  return (
    <div className="space-y-6">
      {/* ── Tier banner ── */}
      <div
        className="rounded-card border px-4 py-3 text-[13px]"
        style={
          offlineOnly
            ? { borderColor: 'rgb(var(--q-amber-rgb) / 0.33)', background: 'rgb(var(--q-amber-rgb) / 0.10)' }
            : { borderColor: 'var(--line-strong)', background: 'var(--surface-2)' }
        }
      >
        <span className="font-semibold text-ink">
          {status ? SOURCE_LABEL[status] : 'Checking which model tier is available…'}
        </span>
        {offlineOnly ? (
          <p className="mt-1.5 text-ink-secondary">
            No API key is configured, so the tutor is running on the built-in offline FAQ. That FAQ
            answers fixed questions from a lookup table — it cannot write quiz questions or review a
            draft. Everything below still works: the panel composes the full prompt for you, and you
            can copy it into any model you have access to.
          </p>
        ) : null}
      </div>

      {/* ── Composer ── */}
      <section className="card space-y-5 p-6">
        <Segmented
          label="Task"
          value={taskId}
          options={TASKS.map((t) => ({ value: t.id, label: t.label }))}
          onChange={setTaskId}
        />

        <label className="block">
          <span className="mb-1.5 block text-[13px] font-semibold text-ink-secondary">Lesson</span>
          <select
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            className="focus-ring w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink"
          >
            {LESSONS.map((l) => (
              <option key={l.slug} value={l.slug}>
                {l.title} · {l.level}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1.5 block text-[13px] font-semibold text-ink-secondary">
            {taskId === 'check' ? 'Your draft' : 'Extra direction (optional)'}
          </span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={taskId === 'check' ? 10 : 4}
            placeholder={task.placeholder}
            className="focus-ring w-full resize-y rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink placeholder:text-ink-muted"
          />
        </label>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-primary"
            onClick={send}
            disabled={loading || !prompt}
          >
            {loading ? 'Working…' : offlineOnly ? 'Try it anyway' : `Generate: ${task.label}`}
          </button>
          <button type="button" className="btn-ghost" onClick={() => copy(prompt, 'prompt')}>
            {copied === 'prompt' ? 'Prompt copied' : 'Copy prompt'}
          </button>
          {notes ? (
            <button type="button" className="btn-ghost" onClick={() => setNotes('')}>
              Clear
            </button>
          ) : null}
        </div>

        {error ? <p className="text-[13px] text-q-rose-text">{error}</p> : null}
      </section>

      {/* ── Reply ── */}
      {reply ? (
        <section className="card space-y-4 p-6" aria-live="polite">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="section-label">Draft</span>
            <div className="flex items-center gap-3">
              {replySource ? (
                <span className="pill">{SOURCE_LABEL[replySource]}</span>
              ) : null}
              <button type="button" className="btn-ghost" onClick={() => copy(reply, 'reply')}>
                {copied === 'reply' ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
          <div className="whitespace-pre-wrap text-[14px] leading-relaxed text-ink-secondary">
            {reply}
          </div>
          <p className="text-[11px] text-ink-muted">
            Model output. Check the physics before it reaches a learner.
          </p>
        </section>
      ) : null}

      {/* ── The composed prompt, always available ── */}
      <section className="card space-y-3 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="section-label">Composed prompt</span>
          <button type="button" className="btn-ghost" onClick={() => copy(prompt, 'prompt')}>
            {copied === 'prompt' ? 'Copied' : 'Copy'}
          </button>
        </div>
        <p className="text-[13px] text-ink-secondary">
          This is exactly what gets sent. Paste it into any model if you would rather not configure
          a key — the page is useful either way.
        </p>
        <pre className="code-block max-h-96 overflow-auto whitespace-pre-wrap text-[12px]">
          {prompt}
        </pre>
      </section>
    </div>
  )
}
