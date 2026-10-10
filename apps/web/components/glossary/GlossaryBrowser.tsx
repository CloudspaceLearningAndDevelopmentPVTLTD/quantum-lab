'use client'

/**
 * GlossaryBrowser — filter-as-you-type over the glossary, plus an A–Z jump bar.
 *
 * Every entry is rendered on the server (this is a client component, but it is
 * still server-rendered with the filter empty), so the full glossary is in the
 * HTML. Filtering only hides entries; it never fetches anything.
 */

import Link from 'next/link'
import { useMemo, useState } from 'react'
import type { SeeLink } from '@/lib/glossary/links'
import type { GlossaryTerm } from '@/lib/glossary/terms'

export interface GlossaryEntry extends GlossaryTerm {
  seeLinks: SeeLink[]
  relatedTerms: { id: string; term: string }[]
}

const KIND_ICON: Record<SeeLink['kind'], string> = {
  Lesson: '📘',
  Visualization: '🔭',
  Challenge: '🎯',
  Workbench: '🛠️',
  Simulator: '⚛',
  Hardware: '🖥️',
}

function initial(term: string): string {
  const c = term.charAt(0).toUpperCase()
  return /[A-Z]/.test(c) ? c : '#'
}

function matches(entry: GlossaryEntry, query: string): boolean {
  const haystack = [entry.term, entry.short, entry.body, ...(entry.aliases ?? [])].join(' ').toLowerCase()
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word))
}

export function GlossaryBrowser({ entries }: { entries: GlossaryEntry[] }) {
  const [query, setQuery] = useState('')
  // Sixty-odd short entries: filtering on every keystroke is instant, so there
  // is no deferral — which also keeps the related-term jump below simple.
  const deferred = query.trim()

  const visible = useMemo(
    () => (deferred ? entries.filter((e) => matches(e, deferred)) : entries),
    [entries, deferred],
  )
  const letters = useMemo(() => [...new Set(entries.map((e) => initial(e.term)))], [entries])
  const visibleLetters = new Set(visible.map((e) => initial(e.term)))

  return (
    <>
      <div className="sticky top-14 z-10 -mx-2 mt-8 bg-bg/90 px-2 py-3 backdrop-blur">
        <label htmlFor="glossary-search" className="sr-only">Search the glossary</label>
        <input
          id="glossary-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search terms — try “phase”, “T2” or “kyber”"
          autoComplete="off"
          className="focus-ring w-full rounded-lg border border-line bg-surface px-4 py-2.5 text-[15px] text-ink placeholder:text-ink-muted"
        />
        <nav aria-label="Jump to letter" className="mt-2 flex flex-wrap gap-1">
          {letters.map((letter) =>
            visibleLetters.has(letter) ? (
              <a
                key={letter}
                href={`#letter-${letter}`}
                className="focus-ring grid h-7 min-w-7 place-items-center rounded px-1 text-xs font-bold text-ink-secondary hover:bg-surface-3 hover:text-ink"
              >
                {letter}
              </a>
            ) : (
              <span key={letter} aria-hidden="true" className="grid h-7 min-w-7 place-items-center px-1 text-xs font-bold text-ink-muted opacity-40">
                {letter}
              </span>
            ),
          )}
        </nav>
      </div>

      <p className="mt-4 text-sm text-ink-muted" role="status" aria-live="polite">
        {deferred
          ? visible.length === 0
            ? `No terms match “${deferred}”. The AI tutor can answer anything this glossary does not cover.`
            : `${visible.length} of ${entries.length} terms`
          : `${entries.length} terms`}
      </p>
      {deferred && visible.length === 0 ? (
        <Link href="/tutor" className="btn-ghost focus-ring mt-3 inline-flex">Ask the tutor instead</Link>
      ) : null}

      <dl className="mt-4 space-y-4">
        {visible.map((entry, index) => {
          const letter = initial(entry.term)
          const firstOfLetter = index === 0 || initial(visible[index - 1].term) !== letter
          return (
            <div
              key={entry.id}
              id={entry.id}
              className="card scroll-mt-40 p-5 target:ring-2 target:ring-q-violet"
            >
              <dt
                id={firstOfLetter ? `letter-${letter}` : undefined}
                className="flex scroll-mt-40 flex-wrap items-baseline gap-x-3 gap-y-1"
              >
                <a href={`#${entry.id}`} className="focus-ring rounded text-lg font-bold text-ink hover:underline underline-offset-4">
                  {entry.term}
                </a>
                {entry.aliases?.length ? (
                  <span className="text-xs text-ink-muted">also: {entry.aliases.join(', ')}</span>
                ) : null}
                {/* Each term also has its own page; this is the link a crawler follows to it. */}
                <Link
                  href={`/glossary/${entry.id}`}
                  aria-label={`${entry.term}: open as its own page`}
                  className="focus-ring ml-auto rounded text-xs text-ink-muted underline underline-offset-2 hover:text-ink"
                >
                  Own page
                </Link>
              </dt>
              <dd className="mt-2">
                <p className="text-[15px] font-medium text-ink">{entry.short}</p>
                <p className="mt-2 text-sm leading-relaxed text-ink-secondary">{entry.body}</p>
                {entry.formula ? (
                  <p className="mt-3 overflow-x-auto rounded-lg bg-surface-2 px-3 py-2 font-mono text-sm text-ink">
                    {entry.formula}
                  </p>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  {entry.seeLinks.map((link) => (
                    <Link
                      key={link.href}
                      href={link.href}
                      className="focus-ring inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1 text-xs font-semibold text-q-violet-text hover:bg-surface-3"
                    >
                      <span aria-hidden="true">{KIND_ICON[link.kind]}</span>
                      <span className="sr-only">{link.kind}: </span>
                      {link.label}
                    </Link>
                  ))}
                </div>
                {entry.relatedTerms.length ? (
                  <p className="mt-3 text-xs text-ink-muted">
                    Related:{' '}
                    {entry.relatedTerms.map((rel, i) => (
                      <span key={rel.id}>
                        {i > 0 ? ', ' : ''}
                        <a
                          href={`#${rel.id}`}
                          onClick={(e) => {
                            // A filtered-out target is not in the DOM yet, so
                            // clear the filter first and navigate once it is.
                            if (!query) return
                            e.preventDefault()
                            setQuery('')
                            requestAnimationFrame(() => {
                              window.location.hash = rel.id
                            })
                          }}
                          className="focus-ring rounded text-ink-secondary underline underline-offset-2 hover:text-ink"
                        >
                          {rel.term}
                        </a>
                      </span>
                    ))}
                  </p>
                ) : null}
              </dd>
            </div>
          )
        })}
      </dl>
    </>
  )
}
