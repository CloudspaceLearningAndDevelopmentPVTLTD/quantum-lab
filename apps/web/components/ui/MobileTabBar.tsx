'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { forwardRef, useEffect, useState } from 'react'

/**
 * The phone/tablet bottom tab bar — the four things a learner does most, plus
 * a "More" that opens the full drawer.
 *
 * Why a bottom bar when the header already has a hamburger: on a 6-inch phone
 * the top 100px of the screen is the hardest to reach one-handed, and every
 * mainstream learning app (Duolingo, Brilliant, Khan) puts primary navigation
 * where the thumb already is. The hamburger stays as the second route to the
 * same drawer, so nothing that worked before stopped working.
 *
 * It is `xl:hidden`, matching the drawer it opens: below 1280px the inline
 * header bar does not exist (see SiteNav), so this is the persistent nav.
 *
 * The body gets `padding-bottom: var(--mobile-nav-h)` below `xl` (globals.css)
 * so the last row of any page is never underneath the bar.
 */
const TABS = [
  { href: '/learn', label: 'Learn', icon: 'learn' },
  { href: '/visualizations', label: 'Visualize', icon: 'viz' },
  { href: '/simulator', label: 'Simulate', icon: 'sim' },
  { href: '/tutor', label: 'Tutor', icon: 'tutor' },
] as const

type IconName = (typeof TABS)[number]['icon'] | 'more'

function isActive(pathname: string, href: string): boolean {
  if (href === '/learn') {
    return pathname === '/learn' || /^\/learn\/(?!certificate)/.test(pathname)
  }
  return pathname === href || pathname.startsWith(href + '/')
}

function Icon({ name }: { name: IconName }) {
  const common = {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    className: 'h-6 w-6',
  }
  switch (name) {
    case 'learn': // open book
      return (
        <svg {...common}>
          <path d="M3 5.5C5.5 4.5 8.5 4.5 12 6c3.5-1.5 6.5-1.5 9-.5V19c-2.5-1-5.5-1-9 .5-3.5-1.5-6.5-1.5-9-.5Z" />
          <path d="M12 6v13.5" />
        </svg>
      )
    case 'viz': // atom-ish orbit
      return (
        <svg {...common}>
          <ellipse cx="12" cy="12" rx="9" ry="3.8" />
          <ellipse cx="12" cy="12" rx="9" ry="3.8" transform="rotate(60 12 12)" />
          <ellipse cx="12" cy="12" rx="9" ry="3.8" transform="rotate(120 12 12)" />
          <circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" />
        </svg>
      )
    case 'sim': // circuit wires with a gate
      return (
        <svg {...common}>
          <path d="M3 8h5M16 8h5M3 16h18" />
          <rect x="8" y="5" width="8" height="6" rx="1.5" />
          <circle cx="12" cy="16" r="0.1" />
          <path d="M12 11v5" />
        </svg>
      )
    case 'tutor': // chat bubble
      return (
        <svg {...common}>
          <path d="M4 5h16v11H9l-5 4V5Z" />
          <path d="M8.5 9.5h7M8.5 12.5h4" />
        </svg>
      )
    case 'more':
      return (
        <svg {...common}>
          <circle cx="5.5" cy="12" r="1.4" fill="currentColor" stroke="none" />
          <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
          <circle cx="18.5" cy="12" r="1.4" fill="currentColor" stroke="none" />
        </svg>
      )
  }
}

/** Fields that bring up the on-screen keyboard. */
function isTextEntry(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  if (el.isContentEditable) return true
  if (el instanceof HTMLTextAreaElement) return true
  if (el instanceof HTMLInputElement) {
    return !['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'file', 'color', 'image'].includes(
      el.type,
    )
  }
  return false
}

interface Props {
  /** True while the drawer this bar's "More" opens is showing. */
  moreOpen: boolean
  onToggleMore: () => void
  /** The drawer's id, for aria-controls. */
  drawerId: string
  /** Lets SiteNav's outside-press handler treat taps on this bar as "inside". */
  moreActive: boolean
}

export const MobileTabBar = forwardRef<HTMLElement, Props>(function MobileTabBar(
  { moreOpen, onToggleMore, drawerId, moreActive },
  ref,
) {
  const pathname = usePathname()

  /**
   * Hide the bar while a text field is focused. With the keyboard up a phone has
   * perhaps 300px of visible page; a 56px bar pinned above the keyboard takes a
   * fifth of it, and the user is mid-typing, not navigating. It comes back the
   * moment focus leaves the field.
   */
  const [typing, setTyping] = useState(false)
  useEffect(() => {
    const onIn = (e: FocusEvent) => setTyping(isTextEntry(e.target))
    const onOut = () => setTyping(false)
    document.addEventListener('focusin', onIn)
    document.addEventListener('focusout', onOut)
    return () => {
      document.removeEventListener('focusin', onIn)
      document.removeEventListener('focusout', onOut)
    }
  }, [])

  return (
    <nav
      ref={ref}
      aria-label="Primary mobile"
      data-mobile-tabbar
      hidden={typing}
      className="fixed inset-x-0 bottom-0 z-50 border-t border-line bg-bg/95 pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] backdrop-blur-md xl:hidden"
    >
      <ul className="mx-auto flex h-14 max-w-2xl items-stretch">
        {TABS.map((tab) => {
          const active = isActive(pathname, tab.href)
          return (
            <li key={tab.href} className="min-w-0 flex-1">
              <Link
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={`focus-ring flex h-full min-h-[44px] flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition-colors ${
                  active ? 'text-q-violet-text' : 'text-ink-secondary active:text-ink'
                }`}
              >
                <Icon name={tab.icon} />
                <span>{tab.label}</span>
              </Link>
            </li>
          )
        })}
        <li className="min-w-0 flex-1">
          <button
            type="button"
            aria-expanded={moreOpen}
            aria-controls={drawerId}
            onClick={onToggleMore}
            className={`focus-ring flex h-full min-h-[44px] w-full flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition-colors ${
              moreOpen || moreActive ? 'text-q-violet-text' : 'text-ink-secondary active:text-ink'
            }`}
          >
            <Icon name="more" />
            <span>More</span>
          </button>
        </li>
      </ul>
    </nav>
  )
})
