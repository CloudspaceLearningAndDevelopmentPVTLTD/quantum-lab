'use client'

import { useTheme } from '@/lib/theme/useTheme'
import type { ThemeName } from '@/lib/theme/tokens'

/**
 * ThemeToggle — a three-state segmented control: System / Light / Dark.
 *
 * Layout stability: every option renders the same icon+label structure at the
 * same size in every state, and the selected state is expressed with background
 * and text colour only — no border-width, font-weight, padding or size change.
 * So switching theme cannot reflow the page around it.
 *
 * Accessibility: the group is a labelled `role="group"` (not a radiogroup —
 * these are buttons that act immediately), each option carries `aria-pressed`,
 * and each has a visible text label, so the state is never carried by colour or
 * icon shape alone.
 *
 * Note: the platform guidance for colour-scheme toggles argues for a two-state
 * control (system / the opposite), because two of three options usually look
 * identical. A three-state control is the explicit product requirement here; the
 * cost is that "System" and one of the other two often render the same, which we
 * mitigate by labelling the resolved value in the group's accessible name.
 */

const OPTIONS: ReadonlyArray<{ value: ThemeName; label: string; icon: string; title: string }> = [
  { value: 'system', label: 'Auto', icon: '◐', title: 'Follow the system colour scheme' },
  { value: 'light', label: 'Light', icon: '☀', title: 'Always use the light theme' },
  { value: 'dark', label: 'Dark', icon: '☾', title: 'Always use the dark theme' },
]

export function ThemeToggle({ className = '' }: { className?: string }) {
  const { theme, resolved, setTheme } = useTheme()

  return (
    <div
      role="group"
      aria-label={`Colour theme, currently ${theme === 'system' ? `automatic (${resolved})` : theme}`}
      className={`inline-flex items-center gap-0.5 rounded-lg border border-line bg-surface-2 p-0.5 ${className}`}
    >
      {OPTIONS.map((option) => {
        const selected = theme === option.value
        return (
          <button
            key={option.value}
            type="button"
            title={option.title}
            aria-pressed={selected}
            onClick={() => setTheme(option.value)}
            // RESPONSIVE: measured 26px tall. The wrapper's p-0.5 adds 4px, so
            // min-h-[40px] here is a 44px row on a phone.
            className={`focus-ring inline-flex min-h-[40px] items-center gap-1.5 rounded-[6px] px-2.5 py-1 text-xs font-semibold
              transition-colors duration-150 ${
                selected
                  ? 'bg-q-violet/20 text-ink'
                  : 'text-ink-secondary hover:text-ink'
              }`}
          >
            <span aria-hidden className="w-3 text-center leading-none">
              {option.icon}
            </span>
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

export default ThemeToggle
