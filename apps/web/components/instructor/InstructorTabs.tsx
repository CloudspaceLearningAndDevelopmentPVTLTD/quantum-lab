'use client'

/**
 * InstructorTabs — the two halves of the instructor surface, in one place.
 *
 * "Cohort" is the course you are running: assignments, who has done them, the
 * CSV export. "Co-pilot" is the authoring tool that was already here. They were
 * separate ideas sharing a URL — the page said "Instructor Co-pilot" and did
 * nothing about instructing a cohort — and this is the seam that joins them.
 *
 * Cohort is the default tab because setting and marking work is the recurring
 * job; drafting a quiz question is the occasional one.
 */

import { useState } from 'react'
import CohortConsole from '@/components/instructor/CohortConsole'
import CoPilotPanel from '@/components/instructor/CoPilotPanel'

type TabId = 'cohort' | 'copilot'

const TABS: { id: TabId; label: string }[] = [
  { id: 'cohort', label: 'Cohort' },
  { id: 'copilot', label: 'Co-pilot' },
]

export default function InstructorTabs() {
  const [tab, setTab] = useState<TabId>('cohort')

  return (
    <div className="space-y-6">
      <nav className="flex gap-2" aria-label="Instructor sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-current={tab === t.id ? 'page' : undefined}
            className={`focus-ring rounded-full border px-4 py-1.5 text-xs font-semibold transition-colors ${
              tab === t.id
                ? 'border-q-violet/50 bg-q-violet/10 text-q-violet-text'
                : 'border-line text-ink-secondary hover:text-ink'
            }`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === 'cohort' ? (
        <CohortConsole />
      ) : (
        <section>
          <p className="section-desc max-w-2xl">
            Pick a lesson and a task and this composes a prompt loaded with that lesson&rsquo;s
            objectives, level and framing, then sends it to whichever model tier this deployment
            has available. Everything it returns is a draft: the prompts push hard against the
            usual quantum misconceptions, but a model can still get the physics wrong, so read it
            before a learner does.
          </p>
          <div className="mt-6">
            <CoPilotPanel />
          </div>
        </section>
      )}
    </div>
  )
}

export { InstructorTabs }
