import { OG_SIZE, OG_CONTENT_TYPE, ogAlt, ogCard, type OgCardInput } from '@/components/seo/og'
import { WORKBENCH } from '@/lib/workbench'

/**
 * Social card for /workbench/qml-check, drawn from this route's own entry in
 * WORKBENCH so a retitle there follows through here. A missing entry renders a
 * generic card rather than throwing — an image route that errors takes the
 * page's whole metadata response with it.
 */
const HREF = '/workbench/qml-check'

function input(): OgCardInput {
  const tool = WORKBENCH.find((t) => t.href === HREF)
  if (!tool) {
    return { eyebrow: 'Workbench', title: 'Qubit16', kicker: 'AI tools for quantum developers' }
  }
  return {
    eyebrow: `Workbench · ${tool.kind}`,
    title: tool.title,
    kicker: 'Quantum classifier vs tuned classical baselines, with the costs',
    accent: tool.accent,
  }
}

export const runtime = 'edge'
export const alt = ogAlt(input())
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

export default function Image() {
  return ogCard(input())
}
