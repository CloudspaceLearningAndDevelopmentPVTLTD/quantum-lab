'use client'

import Link from 'next/link'
import { Fragment, useCallback, useEffect, useState } from 'react'
import { getLesson, getNextLesson, getPrevLesson, TRACKS } from '@/lib/lessons'
import { PAYWALLED_SECTION_CLASS } from '@/lib/lessons/access'
import { isComplete, markComplete, recordQuizScore, setLastVisited } from '@/lib/lessons/progress'
import type { Lesson, LessonBlock, Level } from '@/lib/lessons/types'
import { TrackedPage } from '@/components/analytics/TrackedPage'
import { ExplainSelection } from '@/components/tutor/ExplainSelection'
import { authFetch } from '@/lib/authFetch'
import { track } from '@/lib/analytics/track'
import { gateBlocks } from '@/lib/lessons/inlineCheck'
import { sectionHeading } from '@/lib/deeperExplain'
import { DeeperExplain } from './DeeperExplain'
import { InlineCheck } from './InlineCheck'
import { LessonNav } from './LessonNav'
import { LessonPaywall } from './LessonPaywall'
import { Quiz } from './Quiz'

/**
 * The lesson header — everything the page shows ABOVE and AROUND the blocks.
 *
 * Named `LessonHeader` rather than `LessonMeta` because `lib/lessons/types.ts`
 * now owns that name for a different thing: its `LessonMeta` carries a
 * text-free structural outline in `blocks`, which this component has no use
 * for and which would only add noise to the RSC payload.
 *
 * This is a paywall-critical type, not a tidiness one. Props of a client
 * component are serialised into the RSC flight payload that ships inside the
 * HTML document, so passing a whole `Lesson` here would put every withheld
 * block back into the bytes `curl` receives — the gate would be defeated by the
 * page that implements it. The blocks arrive separately, and only the ones the
 * server chose to send.
 */
export type LessonHeader = Omit<Lesson, 'blocks'>

interface LessonShellProps {
  lesson: LessonHeader
  /**
   * The blocks the SERVER decided to render. For a free lesson this is every
   * block; for a paid one it is `previewBlocks(...).visible`. Never
   * `lesson.blocks` chosen here — the whole point of the split is that this
   * component, which runs in the browser, does not get to pick.
   */
  blocks: LessonBlock[]
  /** How many blocks the server withheld. 0 for a free lesson. */
  hiddenCount: number
  /** True when the withheld tail exists and needs an entitlement to see. */
  locked: boolean
}

const LEVEL_TONE: Record<Level, string> = {
  Beginner: 'border-q-teal/40 text-q-teal-text',
  Intermediate: 'border-q-amber/40 text-q-amber-text',
  Advanced: 'border-q-rose/40 text-q-rose-text',
}

const CALLOUT_TONE = {
  insight: { border: 'border-q-teal/40', bg: 'bg-q-teal/[0.07]', text: 'text-q-teal-text' },
  warning: { border: 'border-q-amber/40', bg: 'bg-q-amber/[0.07]', text: 'text-q-amber-text' },
  aside: { border: 'border-q-sky/40', bg: 'bg-q-sky/[0.07]', text: 'text-q-sky-text' },
} as const

/** Which track a lesson belongs to — an id, never anything user-supplied. */
function trackIdFor(slug: string): string {
  return TRACKS.find((t) => t.lessonSlugs.includes(slug))?.id ?? 'unassigned'
}

export function LessonShell({ lesson, blocks, hiddenCount, locked }: LessonShellProps) {
  const [done, setDone] = useState(false)
  /**
   * The full block list, once the SERVER has agreed to send it. Starts null and
   * can only ever be filled from the 200 body of `/learn/<slug>/content`, which
   * gates on a verified token. Nothing in this file can construct it, and the
   * withheld blocks are not in the page's props to be found in the RSC payload.
   */
  const [unlockedBlocks, setUnlockedBlocks] = useState<LessonBlock[] | null>(null)
  /**
   * Inline-checks the learner has answered or skipped, by block id. Purely
   * visual gating (see lib/lessons/inlineCheck.ts): blocks after the first
   * un-revealed check are withheld from the DOM until the learner commits or
   * skips. Session-local on purpose — a returning learner gets asked again,
   * which is the pedagogy, not a bug.
   */
  const [revealedChecks, setRevealedChecks] = useState<ReadonlySet<string>>(
    () => new Set(),
  )

  useEffect(() => {
    setLastVisited(lesson.slug)
    setDone(isComplete(lesson.slug))
    // Same component instance can serve the next lesson; its checks start closed.
    setRevealedChecks(new Set())
  }, [lesson.slug])

  // Ask for the rest. A 402 (no plan, or signed out) is the ordinary case, not
  // an error: the paywall below is already rendered and simply stays.
  useEffect(() => {
    setUnlockedBlocks(null)
    if (!locked) return

    const controller = new AbortController()
    let active = true

    const run = async () => {
      try {
        const response = await authFetch(
          `/learn/${encodeURIComponent(lesson.slug)}/content`,
          { signal: controller.signal, headers: { accept: 'application/json' } },
        )
        if (!active || !response.ok) return
        const body: unknown = await response.json()
        if (!active) return
        const next = (body as { blocks?: unknown }).blocks
        if (Array.isArray(next) && next.length > 0) {
          setUnlockedBlocks(next as LessonBlock[])
        }
      } catch {
        // Offline, aborted, or a malformed body. The paywall stands.
      }
    }

    void run()
    return () => {
      active = false
      controller.abort()
    }
  }, [lesson.slug, locked])

  // The freely-served part never changes — the unlock only ever ADDS the tail,
  // so the blocks already on screen keep their identity and are not remounted.
  const paywalled = locked && unlockedBlocks === null
  const tailBlocks = unlockedBlocks === null ? [] : unlockedBlocks.slice(blocks.length)

  // Question-first gating, applied over the whole reading order (free head +
  // unlocked tail together, so a check just before the paywall seam still
  // gates across it) and then split back at the seam, because the tail must
  // stay inside the PAYWALLED_SECTION_CLASS wrapper the JSON-LD names.
  const gated = gateBlocks([...blocks, ...tailBlocks], revealedChecks)
  const shownBlocks = gated.slice(0, Math.min(gated.length, blocks.length))
  const shownTail = gated.slice(blocks.length)

  const handleScore = useCallback(
    (score: number) => {
      recordQuizScore(lesson.slug, score)
    },
    [lesson.slug],
  )

  const handleCheckReveal = useCallback((id: string) => {
    setRevealedChecks((prev) => {
      if (prev.has(id)) return prev
      const next = new Set(prev)
      next.add(id)
      return next
    })
  }, [])

  function handleComplete() {
    markComplete(lesson.slug)
    // Only the not-yet-complete → complete transition is an event; the button is
    // not rendered once `done`, but the guard keeps that true if that changes.
    if (!done) track('lesson.completed', { slug: lesson.slug, level: lesson.level })
    setDone(true)
  }

  const prev = getPrevLesson(lesson.slug)
  const next = getNextLesson(lesson.slug)

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      {/* Keyed by slug: navigating between lessons can reuse this component
          instance, and a fresh key is what makes the next lesson count. */}
      <TrackedPage
        key={lesson.slug}
        event="lesson.viewed"
        props={{ slug: lesson.slug, level: lesson.level, track: trackIdFor(lesson.slug) }}
      />
      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[240px_minmax(0,1fr)]">
        {/* Below the article on phones (single column), left rail from lg up —
            otherwise 15 lessons of nav push the lesson itself off-screen. */}
        <aside className="order-2 lg:order-1">
          <LessonNav currentSlug={lesson.slug} />
        </aside>

        <article className="order-1 max-w-2xl lg:order-2">
          <header>
            <div className="flex flex-wrap items-center gap-3">
              <span className={`pill ${LEVEL_TONE[lesson.level]}`}>{lesson.level}</span>
              <span className="text-[13px] text-ink-muted">{lesson.minutes} min read</span>
            </div>
            <h1 className="section-title mt-3 text-3xl md:text-4xl">{lesson.title}</h1>
            <p className="mt-3 text-[15px] leading-relaxed text-ink-secondary">
              {lesson.subtitle}
            </p>
            {lesson.prerequisites.length > 0 ? (
              <p className="mt-4 text-[13px] text-ink-muted">
                <span className="font-semibold">Before this: </span>
                {lesson.prerequisites.map((slug, i) => {
                  const pre = getLesson(slug)
                  return (
                    <span key={slug}>
                      {i > 0 ? ', ' : ''}
                      <Link
                        href={`/learn/${slug}`}
                        className="focus-ring rounded text-q-violet-text underline decoration-q-violet/40 underline-offset-2 hover:decoration-q-violet"
                      >
                        {pre ? pre.title : slug}
                      </Link>
                    </span>
                  )
                })}
              </p>
            ) : null}
          </header>

          <section className="card mt-8 p-5">
            <h2 className="text-sm font-bold text-ink">In this lesson you&rsquo;ll learn</h2>
            <ul className="mt-3 space-y-2">
              {lesson.objectives.map((objective) => (
                <li
                  key={objective}
                  className="flex gap-2.5 text-[14px] leading-relaxed text-ink-secondary"
                >
                  <span aria-hidden="true" className="mt-px text-q-violet">
                    →
                  </span>
                  <span>{objective}</span>
                </li>
              ))}
            </ul>
          </section>

          {/*
            Everything inside is the lesson BODY, and that is the boundary
            ExplainSelection watches: a selection here can be explained by the
            on-device model, a selection in the sidebar nav, the header or the
            prev/next cards cannot. Wrapping both block lists together (rather
            than each) keeps one listener for the whole reading order, including
            across the paywall seam once the tail has been released.
          */}
          <ExplainSelection lessonTitle={lesson.title}>
            <div className="mt-10 space-y-8">
              {shownBlocks.map((block, index) => {
                // Section boundaries (titled prose blocks) get the "explain one
                // level deeper" affordance. The component receives only what this
                // page already rendered — a slug and a heading — so it lives on
                // both sides of the paywall without ever crossing it.
                const heading = sectionHeading(block)
                return (
                  <Fragment key={`${block.kind}-${index}`}>
                    <BlockView
                      block={block}
                      onQuizScore={handleScore}
                      onCheckReveal={handleCheckReveal}
                    />
                    {heading ? <DeeperExplain slug={lesson.slug} heading={heading} /> : null}
                  </Fragment>
                )
              })}
            </div>

            {/*
              The paid section of the page. The class name is the one named by
              `hasPart.cssSelector` in the lesson's JSON-LD (Google's paywalled-
              content markup), so the selector resolves in both states: it wraps
              the paywall card when the tail is withheld and the tail itself once
              the server has released it. Absent entirely on a free lesson, where
              claiming a paywalled part would be a lie about the markup.
            */}
            {locked ? (
              <div className={`${PAYWALLED_SECTION_CLASS} mt-10 space-y-8`}>
                {paywalled ? (
                  <LessonPaywall lessonTitle={lesson.title} hiddenCount={hiddenCount} />
                ) : (
                  shownTail.map((block, index) => {
                    const heading = sectionHeading(block)
                    return (
                      <Fragment key={`tail-${block.kind}-${index}`}>
                        <BlockView
                          block={block}
                          onQuizScore={handleScore}
                          onCheckReveal={handleCheckReveal}
                        />
                        {heading ? (
                          <DeeperExplain slug={lesson.slug} heading={heading} />
                        ) : null}
                      </Fragment>
                    )
                  })
                )}
              </div>
            ) : null}
          </ExplainSelection>

          <footer className="mt-12 border-t border-line pt-8">
            {paywalled ? (
              // Nothing to mark complete: most of the lesson has not been read.
              <p className="text-[13px] text-ink-muted">
                Marking this lesson complete unlocks with the Advanced track.
              </p>
            ) : done ? (
              <p className="inline-flex items-center gap-2 rounded-lg border border-q-teal/40 bg-q-teal/10 px-4 py-2 text-sm font-semibold text-q-teal-text">
                Completed ✓
              </p>
            ) : (
              <button type="button" onClick={handleComplete} className="btn-primary focus-ring">
                Mark as complete
              </button>
            )}

            <nav
              aria-label="Lesson navigation"
              className="mt-6 flex flex-wrap items-stretch justify-between gap-3"
            >
              {prev ? (
                <Link
                  href={`/learn/${prev.slug}`}
                  className="card card-hover focus-ring flex-1 px-4 py-3"
                >
                  <span className="text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-muted">
                    ← Previous
                  </span>
                  <span className="mt-1 block text-sm font-semibold text-ink">
                    {prev.title}
                  </span>
                </Link>
              ) : (
                <span className="flex-1" />
              )}
              {next ? (
                <Link
                  href={`/learn/${next.slug}`}
                  className="card card-hover focus-ring flex-1 px-4 py-3 text-right"
                >
                  <span className="text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-muted">
                    Next →
                  </span>
                  <span className="mt-1 block text-sm font-semibold text-ink">
                    {next.title}
                  </span>
                </Link>
              ) : (
                <Link
                  href="/learn"
                  className="card card-hover focus-ring flex-1 px-4 py-3 text-right"
                >
                  <span className="text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-muted">
                    Course →
                  </span>
                  <span className="mt-1 block text-sm font-semibold text-ink">
                    Back to all lessons
                  </span>
                </Link>
              )}
            </nav>
          </footer>
        </article>
      </div>
    </div>
  )
}

function BlockView({
  block,
  onQuizScore,
  onCheckReveal,
}: {
  block: LessonBlock
  onQuizScore: (score: number) => void
  /** An inline-check answered or skipped — LessonShell un-gates what follows. */
  onCheckReveal: (id: string) => void
}) {
  switch (block.kind) {
    case 'prose':
      return (
        <section>
          {block.title ? (
            <h2 className="text-lg font-bold text-ink">{block.title}</h2>
          ) : null}
          <div className={block.title ? 'mt-3 space-y-4' : 'space-y-4'}>
            {block.paragraphs.map((paragraph, i) => (
              <p key={i} className="text-[15px] leading-relaxed text-ink-secondary">
                {paragraph}
              </p>
            ))}
          </div>
        </section>
      )

    case 'callout': {
      const tone = CALLOUT_TONE[block.tone]
      return (
        <aside className={`card ${tone.border} ${tone.bg} p-5`}>
          <p
            className={`text-[11px] font-bold uppercase tracking-[0.09em] ${tone.text}`}
          >
            {block.tone}
          </p>
          <h3 className="mt-2 text-sm font-bold text-ink">{block.title}</h3>
          <p className="mt-2 text-[14px] leading-relaxed text-ink-secondary">{block.body}</p>
        </aside>
      )
    }

    case 'code':
      return (
        <figure>
          <figcaption className="mb-2 text-[11px] font-bold uppercase tracking-[0.09em] text-ink-muted">
            {block.language}
          </figcaption>
          <pre className="code-block">{block.code}</pre>
          {block.caption ? (
            <figcaption className="mt-2 text-[13px] leading-relaxed text-ink-muted">
              {block.caption}
            </figcaption>
          ) : null}
        </figure>
      )

    case 'embed':
      return (
        <Link href={block.href} className="card card-hover focus-ring block p-5">
          <div className="flex items-baseline justify-between gap-4">
            <h3 className="text-sm font-bold text-ink">{block.title}</h3>
            <span aria-hidden="true" className="text-q-violet">
              →
            </span>
          </div>
          <p className="mt-2 text-[14px] leading-relaxed text-ink-secondary">
            {block.blurb}
          </p>
          <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.09em] text-q-violet">
            Open the live simulation
          </p>
        </Link>
      )

    case 'keypoints':
      return (
        <section className="card p-5">
          <h3 className="text-sm font-bold text-ink">Key points</h3>
          <ul className="mt-3 space-y-2">
            {block.points.map((point) => (
              <li
                key={point}
                className="flex gap-2.5 text-[14px] leading-relaxed text-ink-secondary"
              >
                <span aria-hidden="true" className="mt-px shrink-0 text-q-teal">
                  ✓
                </span>
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </section>
      )

    case 'quiz':
      return <Quiz questions={block.questions} onScore={onQuizScore} />

    case 'inline-check':
      return <InlineCheck block={block} onReveal={() => onCheckReveal(block.id)} />
  }
}
