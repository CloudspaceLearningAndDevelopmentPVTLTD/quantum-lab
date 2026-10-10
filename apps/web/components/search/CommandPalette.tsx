'use client'

import { isStoreApp } from '@/lib/app-shell'
import { useRouter } from 'next/navigation'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react'

import { KIND_LABEL, buildCorpus, type SearchDoc } from '@/lib/search/corpus'
import { groupByKind, search, type SearchResult } from '@/lib/search/rank'

/**
 * CommandPalette — ⌘K global search.
 *
 * Built on the native <dialog> element opened with showModal(), which is what
 * current guidance asks for: the dialog goes into the TOP LAYER (so it paints
 * above everything without a z-index arms race), the rest of the document is
 * made inert by the UA (so focus is trapped for free — no hand-rolled Tab
 * cycling, which is the classic source of trap bugs), Escape and platform
 * close gestures are handled natively, and ::backdrop is a real pseudo-element.
 * `closedby="any"` adds light dismiss declaratively; Safari does not support it
 * yet, so there is a coordinate-based fallback below.
 *
 * Opened by ⌘K / Ctrl+K, by "/" when focus is not in a text field, and by the
 * SearchTrigger button, which dispatches OPEN_SEARCH_EVENT.
 */

/** Fired by SearchTrigger (and anything else that wants to open search). */
export const OPEN_SEARCH_EVENT = 'quantumlab:open-search'

const RESULT_LIMIT = 12

/** True when the keystroke landed in something the user is typing into. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  return target.isContentEditable
}

/** Title text with the matched characters wrapped for emphasis. */
function Highlighted({ text, indices }: { text: string; indices: number[] }) {
  if (indices.length === 0) return <>{text}</>
  const set = new Set(indices)
  const parts: ReactNode[] = []
  let run = ''
  let runMatched = set.has(0)
  for (let i = 0; i < text.length; i += 1) {
    const matched = set.has(i)
    if (matched !== runMatched) {
      parts.push(
        runMatched ? (
          <mark key={i} className="bg-transparent font-bold text-q-violet-text">
            {run}
          </mark>
        ) : (
          <span key={i}>{run}</span>
        ),
      )
      run = ''
      runMatched = matched
    }
    run += text[i]
  }
  parts.push(
    runMatched ? (
      <mark key="tail" className="bg-transparent font-bold text-q-violet-text">
        {run}
      </mark>
    ) : (
      <span key="tail">{run}</span>
    ),
  )
  return <>{parts}</>
}

function LevelPill({ level }: { level: string }) {
  const tone =
    level === 'Beginner'
      ? 'border-q-teal/30 bg-q-teal/15 text-q-teal-text'
      : level === 'Advanced'
        ? 'border-q-rose/30 bg-q-rose/15 text-q-rose-text'
        : 'border-q-amber/30 bg-q-amber/15 text-q-amber-text'
  return <span className={`pill shrink-0 text-[10px] ${tone}`}>{level}</span>
}

export function CommandPalette() {
  const router = useRouter()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)

  // The corpus is derived from static module data, so it is built once.
  const corpus = useMemo<SearchDoc[]>(() => buildCorpus(), [])
  // Inside the store apps the palette must not offer /pricing (lib/app-shell.ts).
  const results = useMemo(() => {
    const hits = search(corpus, query, RESULT_LIMIT)
    return isStoreApp() ? hits.filter((r) => !r.doc.href.startsWith('/pricing')) : hits
  }, [corpus, query])
  const groups = useMemo(() => groupByKind(results), [results])

  // Flat rank order drives the keyboard; grouping is presentation only.
  const flat = useMemo<SearchResult[]>(() => groups.flatMap((g) => g.results), [groups])

  const openPalette = useCallback(() => {
    setOpen((wasOpen) => {
      if (!wasOpen) {
        // Remember where focus came from so it can go back on close. Losing
        // focus to <body> is the single most disorienting failure of a palette.
        const el = document.activeElement
        returnFocusRef.current = el instanceof HTMLElement ? el : null
      }
      return true
    })
  }, [])

  const closePalette = useCallback(() => setOpen(false), [])

  // ── Global shortcuts ──────────────────────────────────────────────────────
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const cmdK = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k'
      if (cmdK) {
        event.preventDefault()
        openPalette()
        return
      }
      // "/" is a shortcut only when the user is not already typing somewhere —
      // hijacking it mid-way through naming a circuit is a real bug.
      if (
        event.key === '/' &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !isTypingTarget(event.target)
      ) {
        event.preventDefault()
        openPalette()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [openPalette])

  // ── Trigger button (and anything else) opening us via a custom event ───────
  useEffect(() => {
    const onOpen = () => openPalette()
    window.addEventListener(OPEN_SEARCH_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_SEARCH_EVENT, onOpen)
  }, [openPalette])

  // ── Show / hide the native dialog, and manage body scroll ─────────────────
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    if (open) {
      // Light dismiss + platform close requests where supported. Set as an
      // attribute rather than a JSX prop because `closedby` is newer than the
      // React DOM typings; browsers that do not know it ignore it, and the
      // coordinate fallback in onDialogClick covers them.
      dialog.setAttribute('closedby', 'any')
      if (!dialog.open) dialog.showModal()
      setQuery('')
      setActive(0)
      inputRef.current?.focus()
      const previousOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      return () => {
        document.body.style.overflow = previousOverflow
      }
    }

    if (dialog.open) dialog.close()
    return undefined
  }, [open])

  // Restore body scroll if we unmount while open.
  useEffect(() => {
    return () => {
      document.body.style.overflow = ''
    }
  }, [])

  // ── Escape containment ────────────────────────────────────────────────────
  // The UA closes the dialog on Escape by itself. We stop the keystroke here so
  // it never reaches other document-level Escape handlers (the nav's "More"
  // menu has one) — closing the palette must not also close something behind it.
  // stopPropagation only: cancelling the event would suppress the native close.
  useEffect(() => {
    if (!open) return
    const swallowEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') event.stopPropagation()
    }
    window.addEventListener('keydown', swallowEscape, true)
    return () => window.removeEventListener('keydown', swallowEscape, true)
  }, [open])

  // ── Keep the active row in view ───────────────────────────────────────────
  useEffect(() => {
    if (!open) return
    const row = listRef.current?.querySelector<HTMLElement>('[data-active="true"]')
    // 'nearest' scrolls only when it has to; 'center' makes the list jitter on
    // every arrow press.
    row?.scrollIntoView({ block: 'nearest' })
  }, [active, open, results])

  const go = useCallback(
    (doc: SearchDoc) => {
      setOpen(false)
      router.push(doc.href)
    },
    [router],
  )

  const onInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (flat.length === 0) return
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        setActive((i) => (i + 1) % flat.length)
        break
      case 'ArrowUp':
        event.preventDefault()
        setActive((i) => (i - 1 + flat.length) % flat.length)
        break
      case 'Home':
        event.preventDefault()
        setActive(0)
        break
      case 'End':
        event.preventDefault()
        setActive(flat.length - 1)
        break
      case 'Enter': {
        event.preventDefault()
        const chosen = flat[active]
        if (chosen) go(chosen.doc)
        break
      }
      default:
        break
    }
  }

  // Light-dismiss fallback for browsers without <dialog closedby> (Safari).
  const onDialogClick = (event: ReactMouseEvent<HTMLDialogElement>) => {
    const dialog = dialogRef.current
    if (!dialog || event.target !== dialog) return
    if ('closedBy' in HTMLDialogElement.prototype) return
    const rect = dialog.getBoundingClientRect()
    const inside =
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom
    if (!inside) dialog.close()
  }

  const activeId = flat[active] ? `qlab-search-option-${flat[active].doc.id}` : undefined
  let index = -1

  return (
    <>
      {/* ::backdrop cannot be expressed in utility classes, and globals.css is
          owned elsewhere, so the two rules this component needs live with it. */}
      <style>{`
        dialog.qlab-palette::backdrop {
          background: rgb(var(--bg-rgb) / 0.72);
          backdrop-filter: blur(4px);
        }
        dialog.qlab-palette[open] {
          display: flex;
        }
      `}</style>

      <dialog
        ref={dialogRef}
        className="qlab-palette hidden w-[min(94vw,42rem)] flex-col overflow-hidden rounded-card border border-line-strong bg-surface p-0 text-ink shadow-2xl"
        style={{ marginTop: '10vh', marginInline: 'auto', maxHeight: '72vh' }}
        aria-label="Search Qubit16"
        onClick={onDialogClick}
        onClose={() => {
          setOpen(false)
          // Native <dialog> restores focus itself, but only to the element that
          // was focused when showModal() ran. Doing it explicitly also covers
          // the case where that element was re-rendered in the meantime.
          returnFocusRef.current?.focus()
        }}
      >
        <div className="flex w-full min-h-0 flex-col">
          <div className="flex items-center gap-3 border-b border-line px-4 py-3">
            <span aria-hidden className="text-ink-muted">
              🔍
            </span>
            <input
              ref={inputRef}
              type="text"
              value={query}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              placeholder="Search lessons, visualizations, gates…"
              aria-label="Search Qubit16"
              role="combobox"
              aria-expanded={flat.length > 0}
              aria-controls="qlab-search-listbox"
              aria-activedescendant={activeId}
              aria-autocomplete="list"
              onChange={(e) => {
                setQuery(e.target.value)
                setActive(0)
              }}
              onKeyDown={onInputKeyDown}
              className="w-full bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-muted"
            />
            <kbd className="hidden shrink-0 rounded border border-line-strong bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold text-ink-muted sm:block">
              esc
            </kbd>
          </div>

          {/*
            A11Y (WCAG 4.1.3, and the combobox pattern's own requirement).
            Typing filters the listbox silently: aria-expanded flips once and
            then never again, so a screen-reader user typing "bel", "bell",
            "bellx" got no signal that the first two matched and the third
            matched nothing. They would have to arrow into the list to find out.
            This region lives OUTSIDE the listbox (a live region inside a
            listbox is not reliably announced) and is deliberately coarse —
            a count, not the results, which the user reads by arrowing.
            It renders empty on an empty query so opening the palette is silent.
          */}
          <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
            {query.trim() === ''
              ? ''
              : flat.length === 0
                ? `No results for ${query.trim()}.`
                : `${flat.length} result${flat.length === 1 ? '' : 's'} for ${query.trim()}. Use the arrow keys to review them.`}
          </div>

          <div
            ref={listRef}
            id="qlab-search-listbox"
            role="listbox"
            aria-label="Search results"
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-2"
          >
            {flat.length === 0 ? (
              <div className="px-5 py-10 text-center">
                <p className="text-sm font-semibold text-ink">
                  Nothing matched “{query.trim()}”.
                </p>
                <p className="mt-2 text-sm text-ink-secondary">
                  Try a concept rather than a page name — the index knows the words the
                  physics uses. For example{' '}
                  <button
                    type="button"
                    className="focus-ring rounded font-semibold text-q-violet-text underline underline-offset-2"
                    onClick={() => {
                      setQuery('entanglement')
                      setActive(0)
                      inputRef.current?.focus()
                    }}
                  >
                    entanglement
                  </button>{' '}
                  or{' '}
                  <button
                    type="button"
                    className="focus-ring rounded font-semibold text-q-violet-text underline underline-offset-2"
                    onClick={() => {
                      setQuery('hadamard')
                      setActive(0)
                      inputRef.current?.focus()
                    }}
                  >
                    hadamard
                  </button>
                  .
                </p>
              </div>
            ) : (
              groups.map((group) => (
                <div key={group.kind} role="group" aria-label={KIND_LABEL[group.kind]}>
                  <p className="px-4 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wider text-ink-muted">
                    {KIND_LABEL[group.kind]}
                  </p>
                  {group.results.map((result) => {
                    index += 1
                    const isActive = index === active
                    const rowIndex = index
                    return (
                      <div
                        key={result.doc.id}
                        id={`qlab-search-option-${result.doc.id}`}
                        role="option"
                        aria-selected={isActive}
                        data-active={isActive ? 'true' : undefined}
                        onMouseMove={() => setActive(rowIndex)}
                        onClick={() => go(result.doc)}
                        className={`mx-2 flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 ${
                          isActive ? 'bg-surface-3' : ''
                        }`}
                      >
                        <span aria-hidden className="w-6 shrink-0 text-center text-base">
                          {result.doc.icon ?? '•'}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span
                            className="block truncate text-sm font-semibold text-ink"
                          >
                            <Highlighted text={result.doc.title} indices={result.indices} />
                          </span>
                          <span className="block truncate text-[12px] text-ink-secondary">
                            {result.doc.subtitle}
                          </span>
                        </span>
                        {result.doc.level ? <LevelPill level={result.doc.level} /> : null}
                      </div>
                    )
                  })}
                </div>
              ))
            )}
          </div>

          <div className="flex items-center gap-4 border-t border-line bg-surface-2 px-4 py-2 text-[11px] text-ink-muted">
            <span>
              <span aria-hidden>↑↓</span> navigate
            </span>
            <span aria-hidden>·</span>
            <span>
              <span aria-hidden>↵</span> open
            </span>
            <span aria-hidden>·</span>
            <span>esc close</span>
            <button
              type="button"
              onClick={closePalette}
              className="focus-ring ml-auto rounded px-2 py-0.5 font-semibold text-ink-secondary hover:text-ink"
            >
              Close
            </button>
          </div>
        </div>
      </dialog>
    </>
  )
}
