'use client'

import { useEffect, useState } from 'react'

import { OPEN_SEARCH_EVENT } from './CommandPalette'

/**
 * SearchTrigger — the nav button that opens the ⌘K palette.
 *
 * It owns no palette state: it dispatches OPEN_SEARCH_EVENT and the palette
 * (mounted once, elsewhere in the nav) reacts. That keeps the two mountable
 * independently and means the same button can appear more than once without
 * duplicating a dialog.
 *
 * The shortcut hint is rendered only after mount. Platform detection has no SSR
 * answer, and rendering "⌘K" on the server then "Ctrl K" on the client is a
 * hydration mismatch.
 */
export function SearchTrigger() {
  const [hint, setHint] = useState<string | null>(null)

  useEffect(() => {
    const nav: Navigator = window.navigator
    // navigator.platform is deprecated but still the most reliable signal;
    // userAgent is the fallback for browsers that have dropped it.
    const source = `${nav.platform ?? ''} ${nav.userAgent}`
    setHint(/mac|iphone|ipad|ipod/i.test(source) ? '⌘K' : 'Ctrl K')
  }, [])

  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new CustomEvent(OPEN_SEARCH_EVENT))}
      aria-keyshortcuts="Meta+K Control+K"
      className="focus-ring group flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-lg border border-line-strong bg-surface-2 px-2 py-1.5 text-sm text-ink-secondary transition-colors hover:border-q-violet/40 hover:bg-surface-3 hover:text-ink sm:min-h-0 sm:min-w-0 sm:justify-start sm:px-3"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        className="h-4 w-4 shrink-0"
      >
        <circle cx="8.5" cy="8.5" r="5.25" />
        <path d="M12.5 12.5 L17 17" />
      </svg>

      {/* Collapses to the icon alone on narrow screens. The button keeps its
          accessible name either way via the visually hidden label below. */}
      <span className="hidden font-semibold sm:inline">Search</span>
      <span className="sr-only sm:hidden">Search</span>

      {hint ? (
        <kbd className="ml-1 hidden rounded border border-line-strong bg-bg px-1.5 py-0.5 text-[10px] font-semibold text-ink-muted md:block">
          {hint}
        </kbd>
      ) : null}
    </button>
  )
}
