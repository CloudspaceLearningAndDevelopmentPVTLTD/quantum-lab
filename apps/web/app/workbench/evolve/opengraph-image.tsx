import { OG_SIZE, OG_CONTENT_TYPE, ogAlt, ogCard, type OgAccent, type OgCardInput } from '@/components/seo/og'
import { WORKBENCH } from '@/lib/workbench'

/**
 * Social card for /workbench/evolve, drawn from this route's own entry in the
 * workbench catalogue — same pattern as components/seo/vizCard.tsx, inlined
 * because the workbench catalogue does not yet have a shared card helper.
 */
const HREF = '/workbench/evolve'

function input(): OgCardInput {
  const tool = WORKBENCH.find((t) => t.href === HREF)
  if (!tool) {
    return { eyebrow: 'Workbench', title: 'Qubit16', kicker: 'AI tools for quantum developers' }
  }
  return {
    eyebrow: `Workbench · ${tool.kind}`,
    title: tool.title,
    kicker: 'Models propose heuristics, the simulator scores them, the fittest survive',
    accent: tool.accent as OgAccent,
  }
}

export const runtime = 'edge'
export const alt = ogAlt(input())
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

export default function Image() {
  return ogCard(input())
}
