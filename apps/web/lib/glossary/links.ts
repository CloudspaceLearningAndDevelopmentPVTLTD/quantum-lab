/**
 * Human labels for a glossary entry's `see` links, looked up from the same
 * catalogues the linked pages render from. Server-side only in practice (the
 * glossary page resolves them before handing terms to the client).
 */

import { CHALLENGES } from '@/lib/challenges/catalogue'
import { LESSONS } from '@/lib/lessons/index'
import { GATE_LIBRARY, PRESETS } from '@/lib/quantum'
import { VISUALIZATIONS } from '@/lib/visualizations'
import { WORKBENCH } from '@/lib/workbench'

export interface SeeLink {
  href: string
  label: string
  kind: 'Lesson' | 'Visualization' | 'Challenge' | 'Workbench' | 'Simulator' | 'Hardware'
}

export function resolveSeeLink(href: string): SeeLink | null {
  const [path, query] = href.split('?')
  if (path === '/simulator') {
    if (query?.startsWith('preset=')) {
      const preset = PRESETS.find((p) => p.id === query.slice('preset='.length))
      return preset ? { href, label: `${preset.name} in the simulator`, kind: 'Simulator' } : null
    }
    if (query?.startsWith('gate=')) {
      const gate = GATE_LIBRARY.find((g) => g.name === query.slice('gate='.length))
      return gate ? { href, label: `Try the ${gate.label} gate`, kind: 'Simulator' } : null
    }
    return { href, label: 'Circuit simulator', kind: 'Simulator' }
  }
  if (path === '/hardware') return { href, label: 'Run on real hardware', kind: 'Hardware' }
  const lesson = LESSONS.find((l) => `/learn/${l.slug}` === path)
  if (lesson) return { href, label: lesson.title, kind: 'Lesson' }
  const viz = VISUALIZATIONS.find((v) => v.href === path)
  if (viz) return { href, label: viz.title, kind: 'Visualization' }
  const challenge = CHALLENGES.find((c) => `/challenges/${c.id}` === path)
  if (challenge) return { href, label: challenge.title, kind: 'Challenge' }
  const tool = WORKBENCH.find((t) => t.href === path)
  if (tool) return { href, label: tool.title, kind: 'Workbench' }
  return null
}
