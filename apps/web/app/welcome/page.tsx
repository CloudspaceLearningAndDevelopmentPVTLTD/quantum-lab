'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

import WelcomeFlow from '@/components/onboarding/WelcomeFlow'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { VISUALIZATIONS } from '@/components/ui/Hero'
import { LESSONS } from '@/lib/lessons'
import {
  isOnboardingComplete,
  loadOnboarding,
  resetOnboarding,
  type OnboardingState,
} from '@/lib/onboarding/state'
import { PATHS } from '@/lib/onboarding/steps'

type View = 'loading' | 'flow' | 'already'

export default function WelcomePage() {
  const [view, setView] = useState<View>('loading')
  const [state, setState] = useState<OnboardingState | null>(null)

  // localStorage is only ever read after mount.
  useEffect(() => {
    const loaded = loadOnboarding()
    setState(loaded)
    setView(isOnboardingComplete(loaded) || loaded.dismissedAt !== undefined ? 'already' : 'flow')
  }, [])

  const startOver = useCallback(() => {
    const fresh = resetOnboarding()
    setState(fresh)
    setView('flow')
  }, [])

  const chosen = state?.path ? PATHS[state.path] : null

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <header className="mx-auto mb-8 max-w-2xl">
        <p className="section-label">First run</p>
        <h1 className="section-title mt-2">Welcome to Qubit16</h1>
        {/* This used to say "Fifty-two pages", which was wrong by three the day
            it was written and gets wronger with every route added or removed —
            nothing in the app can count its own routes at runtime. Lessons and
            visualizations are data, so these two numbers cannot rot, and they
            are the parts a newcomer is actually being offered. */}
        <p className="section-desc mt-2">
          {LESSONS.length} lessons and {VISUALIZATIONS.length} visualizations is a lot to land in
          front of. So: build one real circuit first — two gates, about a minute — and then one
          question, and we&rsquo;ll point you at the part that&rsquo;s actually for you. Skip
          either. Nothing here locks.
        </p>
      </header>

      {/* Reserve the column so the page does not jump once state loads. */}
      {view === 'loading' ? (
        <div className="mx-auto min-h-[540px] w-full max-w-2xl" aria-hidden="true" />
      ) : view === 'flow' ? (
        <WelcomeFlow onDismissed={() => setView('already')} />
      ) : (
        <Card className="mx-auto min-h-[540px] w-full max-w-2xl p-6 md:p-8">
          <h2 className="section-title">You&rsquo;ve already done this</h2>
          <p className="section-desc mt-2">
            {state?.firstCircuitRun
              ? 'You built a Bell pair here once already — no need to do it twice.'
              : 'You have been through the welcome flow before.'}{' '}
            {chosen
              ? `Your path is "${chosen.label}".`
              : 'You never picked a path, which is completely fine.'}
          </p>

          <div className="mt-6 flex flex-wrap gap-3">
            {chosen ? (
              <Button asChild>
                <Link href={chosen.steps[0].href}>{chosen.steps[0].cta} →</Link>
              </Button>
            ) : (
              <Button asChild>
                <Link href="/learn">Go to the course →</Link>
              </Button>
            )}
            <Button asChild variant="secondary">
              <Link href="/coach">Ask the coach what&rsquo;s next</Link>
            </Button>
            <Button type="button" variant="secondary" onClick={startOver}>
              Start over
            </Button>
          </div>

          <p className="mt-6 border-t border-line pt-4 text-xs text-ink-muted">
            &ldquo;Start over&rdquo; clears the onboarding state only. Your course progress,
            saved circuits and challenge results are untouched.
          </p>
        </Card>
      )}
    </div>
  )
}
