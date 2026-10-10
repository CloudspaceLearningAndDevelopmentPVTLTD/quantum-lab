'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  DARK_CLASS,
  LIGHT_CLASS,
  THEME_STORAGE_KEY,
  type ResolvedTheme,
  type ThemeName,
} from '@/lib/theme/tokens'

const LIGHT_QUERY = '(prefers-color-scheme: light)'

function isThemeName(value: unknown): value is ThemeName {
  return value === 'dark' || value === 'light' || value === 'system'
}

/**
 * Read the stored preference. Never throws: localStorage access is a SecurityError
 * in Safari private browsing and in cookie-blocked third-party frames.
 */
function readStored(): ThemeName {
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY)
    return isThemeName(raw) ? raw : 'system'
  } catch {
    return 'system'
  }
}

function writeStored(theme: ThemeName): void {
  try {
    if (theme === 'system') window.localStorage.removeItem(THEME_STORAGE_KEY)
    else window.localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    /* Storage unavailable — the in-memory choice still applies for this page. */
  }
}

/**
 * Write the resolved theme to the document. Kept identical in effect to the
 * inline anti-flash script in components/ui/ThemeScript.tsx, so the first paint
 * and every subsequent update agree.
 */
function applyTheme(theme: ThemeName, resolved: ResolvedTheme): void {
  const root = document.documentElement
  root.classList.remove(LIGHT_CLASS, DARK_CLASS)
  root.classList.add(resolved)
  // `color-scheme` is what makes native scrollbars, form controls and the
  // pre-paint canvas colour follow the theme.
  root.style.colorScheme = resolved
  const meta = document.querySelector('meta[name="color-scheme"]')
  // 'system' keeps `light dark` so the browser stays free to adapt on its own.
  if (meta) meta.setAttribute('content', theme === 'system' ? 'light dark' : resolved)
}

export interface UseThemeResult {
  /** The user's choice, including 'system'. */
  theme: ThemeName
  /** What that choice currently renders as. */
  resolved: ResolvedTheme
  setTheme: (next: ThemeName) => void
}

/**
 * SSR-safe theme controller.
 *
 * The initial state is the CSS/HTML default ('system' + 'dark') so the server
 * render and the first client render agree — reading localStorage during render
 * would be a hydration mismatch. The real preference is adopted in an effect on
 * mount; the visible theme is already correct by then because ThemeScript set
 * it before paint, so nothing flashes.
 */
export function useTheme(): UseThemeResult {
  // The server and the first client render must agree, so state starts at the
  // *markup* default ('system' + dark) rather than at localStorage. The visible
  // theme is already correct at this point because ThemeScript ran before paint.
  const [theme, setThemeState] = useState<ThemeName>('system')
  const [system, setSystem] = useState<ResolvedTheme>('dark')
  const [adopted, setAdopted] = useState(false)

  // Adopt the stored preference once, after mount.
  useEffect(() => {
    setThemeState(readStored())
    setAdopted(true)
  }, [])

  // Track the OS preference for as long as this component is mounted. The
  // subscription is unconditional on purpose: making it depend on `theme` used
  // to let a stale closure write `resolved` back to the system value after the
  // stored preference had already been adopted, which reverted the theme on
  // every reload. `resolved` is now *derived*, so that race cannot exist.
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const query = window.matchMedia(LIGHT_QUERY)
    const onChange = (): void => setSystem(query.matches ? 'light' : 'dark')
    onChange()
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  const resolved: ResolvedTheme = theme === 'system' ? system : theme

  // Reflect onto <html> — but never before the stored preference is known, or
  // we would overwrite the correct class ThemeScript set with a default guess.
  useEffect(() => {
    if (!adopted) return
    applyTheme(theme, resolved)
  }, [adopted, theme, resolved])

  const setTheme = useCallback((next: ThemeName): void => {
    setThemeState(next)
    writeStored(next)
  }, [])

  return { theme, resolved, setTheme }
}

export default useTheme
