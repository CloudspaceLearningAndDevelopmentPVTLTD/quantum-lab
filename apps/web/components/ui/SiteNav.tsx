'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import { AccountButton } from '@/components/auth/AccountButton'
import { CommandPalette } from '@/components/search/CommandPalette'
import { SearchTrigger } from '@/components/search/SearchTrigger'
import { MobileTabBar } from '@/components/ui/MobileTabBar'
import { isAppShell } from '@/lib/app-shell'
import { DOCS_URL, REPO_URL } from '@/lib/legal'

/**
 * Primary navigation — the things a learner or developer actually does.
 *
 * Workbench sits next to Visualizations on purpose: the visualizations are
 * for learning, the workbench is the same engines pointed at a result.
 *
 * Everything else (saved circuits, certification, insights, admin, account)
 * lives behind the "More" menu. A flat nine-item bar tested badly: the items
 * that matter stop standing out, and it wraps on a laptop.
 */
const PRIMARY = [
  { href: '/learn', label: 'Learn' },
  { href: '/visualizations', label: 'Visualizations' },
  { href: '/workbench', label: 'Workbench' },
  { href: '/simulator', label: 'Simulator' },
  { href: '/challenges', label: 'Challenges' },
  { href: '/tutor', label: 'AI Tutor' },
  { href: '/pricing', label: 'Pricing' },
]

/**
 * Everything that is not a primary tab, GROUPED. The previous version was one
 * flat list of twelve rows with no structure — every item competed equally
 * for attention, and "Admin" sat between "Agent benchmark" and "Account". The
 * groups follow what a visitor is trying to do (practise, see progress,
 * teach, learn about the product), which is the grouping every mainstream
 * learning product converges on. Labels are unchanged: the mobile e2e spec
 * matches on them.
 */
const MORE_GROUPS: { heading: string; links: { href: string; label: string; hint: string }[] }[] = [
  {
    heading: 'Practise',
    links: [
      { href: '/compete', label: 'Weekly competition', hint: 'Gate golf against everyone; resets Monday' },
      { href: '/hardware', label: 'Real hardware', hint: 'Submit to a physical quantum computer' },
      { href: '/circuits', label: 'Saved circuits', hint: 'Your circuit library' },
    ],
  },
  {
    heading: 'Your progress',
    links: [
      { href: '/paths', label: 'Learning paths', hint: 'Goal-based roadmaps, from first qubit to career' },
      { href: '/coach', label: 'Coach', hint: 'What to study next, from your progress' },
      { href: '/review', label: 'Review', hint: 'A few minutes of recall practice' },
      { href: '/insights', label: 'Insights', hint: 'Your learning stats, computed locally' },
      { href: '/certify', label: 'Certification', hint: 'Take a proctored-style exam' },
      { href: '/learn/certificate', label: 'Certificates', hint: 'Download your completions' },
    ],
  },
  {
    heading: 'Teach',
    links: [
      { href: '/educators', label: 'For educators', hint: 'Seats, classes, assignments, export' },
      { href: '/instructor', label: 'Instructor tools', hint: 'Draft quizzes, scripts and examples' },
      { href: '/admin', label: 'Admin', hint: 'Seats and cohort progress' },
    ],
  },
  {
    heading: 'About',
    links: [
      { href: '/glossary', label: 'Glossary', hint: 'Every quantum term, explained plainly' },
      { href: '/compare', label: 'Compare', hint: 'How Qubit16 stacks up' },
      { href: '/about', label: 'About', hint: 'Why this exists' },
      { href: DOCS_URL, label: 'Engineering docs', hint: 'How Qubit16 is built, in depth' },
      { href: REPO_URL, label: 'Source code', hint: 'MIT-licensed, on GitHub' },
      { href: '/benchmark', label: 'Agent benchmark', hint: 'Real model pass rates on the challenge set' },
      { href: '/account', label: 'Account', hint: 'Plan and billing' },
    ],
  },
]

/** Flat view of MORE_GROUPS, for active-state checks. */
const MORE = MORE_GROUPS.flatMap((g) => g.links)

function isActive(pathname: string, href: string): boolean {
  if (href === '/learn') {
    // /learn/certificate belongs to the More menu, not the Learn tab.
    return pathname === '/learn' || /^\/learn\/(?!certificate)/.test(pathname)
  }
  return pathname === href || pathname.startsWith(href + '/')
}

export function SiteNav() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  /**
   * RESPONSIVE: the phone/tablet drawer. Separate state from `open` (the "More"
   * dropdown) because the two are different widgets that happen to share a
   * header — the dropdown does not exist below `lg`, and the drawer does not
   * exist above it.
   */
  const [drawerOpen, setDrawerOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const headerRef = useRef<HTMLElement>(null)
  const tabBarRef = useRef<HTMLElement>(null)

  /**
   * Inside an installed app (TWA, home-screen PWA, the iOS wrapper) there is no
   * browser chrome, so no back button. Android has the system back gesture; iOS
   * has the edge swipe only where the native shell enables it. A visible back
   * chevron on every non-root route is the one affordance that works everywhere.
   * Decided in an effect, never during render, so server and client markup agree.
   */
  const [inShell, setInShell] = useState(false)
  useEffect(() => setInShell(isAppShell()), [])
  const isTabRoot = ['/', '/learn', '/visualizations', '/simulator', '/tutor'].includes(pathname)
  const showBack = inShell && !isTabRoot

  /**
   * A hydration signal for the e2e suite.
   *
   * tests/e2e/helpers.ts `waitForHydration` currently waits on the search
   * trigger's ⌘K hint, which is `md:block` — at a 390px viewport it is
   * display:none, so it is not in the accessibility tree, the locator never
   * matches, and every navigation pays the full 15s timeout before continuing
   * WITHOUT the guarantee it was supposed to give. Measured: `gotoClean('/')`
   * takes 340ms at 1280px and 15,266ms at 390px.
   *
   * This attribute is width-independent and set from an effect, so its presence
   * proves client React has committed. helpers.ts belongs to another
   * workstream; tests/e2e/mobile.spec.ts uses this instead, and the desktop
   * helper should be switched over to it too.
   */
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => setHydrated(true), [])

  // Close both menus on outside press, on Escape, and whenever the route changes.
  useEffect(() => {
    if (!open && !drawerOpen) return
    // `pointerdown`, not `mousedown`: a tap on a touch screen produces a
    // pointerdown immediately but a compatibility mousedown only after the
    // browser has ruled out a gesture, which made the drawer feel stuck.
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node
      if (menuRef.current && !menuRef.current.contains(target)) setOpen(false)
      // The bottom tab bar is not inside <header>, but a press on it is not an
      // "outside" press either: its More button toggles the drawer itself, and
      // closing here first would make the toggle re-open it.
      if (
        headerRef.current &&
        !headerRef.current.contains(target) &&
        !tabBarRef.current?.contains(target)
      ) {
        setDrawerOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setOpen(false)
      setDrawerOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, drawerOpen])

  useEffect(() => {
    setOpen(false)
    setDrawerOpen(false)
  }, [pathname])

  const moreActive = MORE.some((l) => isActive(pathname, l.href))

  return (
    <>
    <header
      ref={headerRef}
      data-nav-ready={hydrated ? 'true' : undefined}
      // Safe-area padding: with viewport-fit=cover (app/layout.tsx) the page
      // extends under the notch / Dynamic Island and the landscape side cutouts.
      // In a plain browser tab these insets are 0, so this is a no-op there.
      className="sticky top-0 z-50 border-b border-line bg-bg/80 pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] pt-[env(safe-area-inset-top)] backdrop-blur-md"
    >
      {/* RESPONSIVE: gutters and gap shrink below `sm`. At 390px the old
          `gap-4 px-6` left 294px for a logo, a search button and a menu
          button. */}
      <nav className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-2 sm:gap-4 sm:px-6 sm:py-3">
        {showBack ? (
          <button
            type="button"
            aria-label="Go back"
            onClick={() => window.history.back()}
            className="focus-ring -ml-2 grid h-11 w-11 shrink-0 place-items-center rounded-lg text-ink-secondary active:bg-surface-2"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-6 w-6"
            >
              <path d="M15 5l-7 7 7 7" />
            </svg>
          </button>
        ) : null}
        <Link href="/" className="focus-ring flex shrink-0 items-center gap-2 rounded py-2">
          {/* The mark: app/icon.svg, the same Bloch sphere the hero lets a
              visitor play with. Rendered as a decorative background, not an
              <img>: the link is already named "Qubit16" by its text, so an
              image name here would be announced twice — and the a11y suite
              rightly refuses an unnamed <img>. */}
          <span
            aria-hidden="true"
            className="h-7 w-7 shrink-0 rounded-lg bg-contain bg-center bg-no-repeat"
            style={{ backgroundImage: 'url(/icons/icon.svg)' }}
          />
          <span className="text-[15px] font-bold tracking-tight">
            Qubit<span className="text-q-violet-text">16</span>
          </span>
        </Link>

        <SearchTrigger />

        {/* RESPONSIVE: the inline bar is desktop-only.
            It was `ml-auto flex … overflow-x-auto` at every width. Measured at
            390x844, five of the six primary links and the whole "More" menu sat
            between x=308 and x=911 — off-screen, inside a horizontal scroller
            with no scrollbar and no other affordance. Everything except /learn
            was unreachable on a phone. Do not delete the `hidden xl:flex`
            without giving the drawer below somewhere else to live.

            The switch is `xl` (1280px), NOT `lg` (1024px), and that is a
            measurement rather than a preference. At exactly 1024px — iPad
            landscape, and the most common laptop width there is — this bar
            wants 829px while only ~724px is left after the wordmark and the
            search trigger. Measured: document.scrollWidth was 1130 against a
            1024 viewport, so the whole PAGE scrolled sideways by 106px, "More"
            was clipped mid-word, and the "Get started" CTA rendered at x=1031
            — entirely off-screen, unreachable without a horizontal scroll that
            has no scrollbar. 1130px is what the bar actually needs, so 1280 is
            the first standard breakpoint that fits it with headroom.

            Between 1024 and 1279 the drawer below takes over, which costs
            nothing: it holds every primary link, the whole "More" grouping and
            its own copy of the CTA. */}
        <div className="ml-auto hidden items-center gap-1 xl:flex">
          {PRIMARY.map((link) => {
            const active = isActive(pathname, link.href)
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? 'page' : undefined}
                className={`focus-ring whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${
                  active
                    ? 'bg-q-violet/15 text-q-violet-text'
                    : 'text-ink-secondary hover:bg-surface-2 hover:text-ink'
                }`}
              >
                {link.label}
              </Link>
            )
          })}

          <div ref={menuRef} className="relative">
            <button
              type="button"
              aria-expanded={open}
              aria-haspopup="menu"
              onClick={() => setOpen((v) => !v)}
              className={`focus-ring flex items-center gap-1 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${
                moreActive || open
                  ? 'bg-q-violet/15 text-q-violet-text'
                  : 'text-ink-secondary hover:bg-surface-2 hover:text-ink'
              }`}
            >
              More
              <span aria-hidden className={`text-[10px] transition-transform ${open ? 'rotate-180' : ''}`}>
                ▾
              </span>
            </button>

            {open ? (
              <div
                role="menu"
                className="absolute right-0 top-full z-50 mt-2 w-[34rem] max-w-[calc(100vw-2rem)] rounded-card border border-line-strong bg-surface p-2 shadow-2xl"
              >
                <div className="grid grid-cols-2 gap-1">
                  {/* Two explicit columns, groups stacked within each, so a
                      short group does not leave a hole beside a long one. */}
                  {[MORE_GROUPS.filter((_, i) => i % 2 === 0), MORE_GROUPS.filter((_, i) => i % 2 === 1)].map((column, ci) => (
                  <div key={ci} className="min-w-0">
                  {column.map((group) => (
                    <div key={group.heading} className="min-w-0 pb-1">
                      <p className="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-[0.12em] text-ink-muted">
                        {group.heading}
                      </p>
                      {group.links.map((link) => {
                        const active = isActive(pathname, link.href)
                        return (
                          <Link
                            key={link.href}
                            role="menuitem"
                            href={link.href}
                            className={`focus-ring block rounded-lg px-3 py-2 transition-colors ${
                              active ? 'bg-q-violet/10' : 'hover:bg-surface-2'
                            }`}
                          >
                            <span
                              className={`block text-sm font-semibold ${
                                active ? 'text-q-violet-text' : 'text-ink'
                              }`}
                            >
                              {link.label}
                            </span>
                            <span className="block truncate text-[11px] text-ink-muted">{link.hint}</span>
                          </Link>
                        )
                      })}
                    </div>
                  ))}
                  </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          {/* The only persistent path to /welcome outside the homepage Hero —
              a visitor who lands on any other page (a shared link, a search
              result) had no way back to the 60-second onboarding except a
              dismissible ResumeBanner. btn-primary, not a plain nav link, so
              it reads as the one thing on this bar worth clicking. */}
          <Link href="/welcome" className="btn-primary focus-ring ml-1 shrink-0 whitespace-nowrap !px-3 !py-1.5 !text-sm">
            Get started
          </Link>
          <AccountButton />
        </div>

        {/* RESPONSIVE: the phone/tablet entry point. 44x44 so it is a legal tap
            target, and on the right-hand edge so it is reachable with the thumb
            of the hand holding the phone. */}
        <button
          type="button"
          aria-expanded={drawerOpen}
          aria-controls="site-nav-drawer"
          // The name stays "Menu" in both states on purpose: the open/closed
          // state is carried by aria-expanded, and a name that changes underneath
          // a screen reader user mid-interaction is the thing aria-expanded
          // exists to avoid.
          aria-label="Menu"
          onClick={() => setDrawerOpen((v) => !v)}
          className={`focus-ring ml-auto grid h-11 w-11 shrink-0 place-items-center rounded-lg border transition-colors xl:hidden ${
            drawerOpen
              ? 'border-q-violet/50 bg-q-violet/15 text-q-violet-text'
              : 'border-line-strong bg-surface-2 text-ink-secondary'
          }`}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            className="h-5 w-5"
          >
            {drawerOpen ? (
              <path d="M5 5 L15 15 M15 5 L5 15" />
            ) : (
              <path d="M3 6 H17 M3 10 H17 M3 14 H17" />
            )}
          </svg>
        </button>
      </nav>

      {/* RESPONSIVE: the drawer.
          PRIMARY, then every MORE group under its own heading — flat, because a
          phone has no room for a submenu inside a submenu, and because the whole
          point is that nothing in the app is more than two taps away.
          `max-h` + `overflow-y-auto` keeps the list scrollable on a 844px-tall
          screen where fifteen 44px rows do not fit under the header.
          `dvh` rather than `vh`: on iOS Safari `vh` measures the viewport with
          the URL bar retracted, so the last row sits under the browser chrome. */}
      {drawerOpen ? (
        <div
          id="site-nav-drawer"
          className="max-h-[calc(100dvh-3.5rem-var(--mobile-nav-h)-env(safe-area-inset-top))] overflow-y-auto overscroll-contain border-t border-line bg-surface xl:hidden"
        >
          {/* Same reasoning as the desktop bar's Get started link: the drawer
              is the only nav surface a phone visitor has, so the path to
              /welcome has to live here too, not just on the homepage. */}
          <div className="px-2 pt-2">
            <Link
              href="/welcome"
              className="btn-primary focus-ring flex min-h-[44px] w-full items-center justify-center rounded-lg text-[15px]"
            >
              Get started
            </Link>
            <div className="mt-2">
              <AccountButton variant="drawer" />
            </div>
          </div>

          <ul className="px-2 py-2">
            {PRIMARY.map((link) => {
              const active = isActive(pathname, link.href)
              return (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    aria-current={active ? 'page' : undefined}
                    className={`focus-ring flex min-h-[44px] items-center rounded-lg px-3 text-[15px] font-semibold transition-colors ${
                      active ? 'bg-q-violet/15 text-q-violet-text' : 'text-ink'
                    }`}
                  >
                    {link.label}
                  </Link>
                </li>
              )
            })}
          </ul>

          {MORE_GROUPS.map((group, gi) => {
            const headingId = `site-nav-drawer-group-${gi}`
            return (
              <div key={group.heading}>
                <p
                  id={headingId}
                  className="border-t border-line px-5 pb-1 pt-3 text-[11px] font-bold uppercase tracking-wider text-ink-muted"
                >
                  {group.heading}
                </p>
                <ul className="px-2 pb-2" aria-labelledby={headingId}>
                  {group.links.map((link) => {
                    const active = isActive(pathname, link.href)
                    return (
                      <li key={link.href}>
                        <Link
                          href={link.href}
                          aria-current={active ? 'page' : undefined}
                          className={`focus-ring flex min-h-[44px] flex-col justify-center rounded-lg px-3 py-1.5 transition-colors ${
                            active ? 'bg-q-violet/10' : ''
                          }`}
                        >
                          <span
                            className={`text-[15px] font-semibold ${
                              active ? 'text-q-violet-text' : 'text-ink'
                            }`}
                          >
                            {link.label}
                          </span>
                          <span className="text-[11px] text-ink-muted">{link.hint}</span>
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )
          })}
        </div>
      ) : null}

      {/* Mounted once. The palette is a native modal dialog in the top layer, so
          it is not affected by this header's stacking context, and it swallows
          its own Escape so the More menu above stays open/closed as it was. */}
      <CommandPalette />
    </header>
    <MobileTabBar
      ref={tabBarRef}
      moreOpen={drawerOpen}
      onToggleMore={() => setDrawerOpen((v) => !v)}
      drawerId="site-nav-drawer"
      moreActive={moreActive}
    />
    </>
  )
}
