import { OG_SIZE, OG_CONTENT_TYPE, ogAlt, ogCard, type OgAccent, type OgCardInput } from '@/components/seo/og'
import { WORKBENCH } from '@/lib/workbench'

/** Social card for this route, drawn from its own WORKBENCH entry. */
const HREF = '/workbench/noise'

function input(): OgCardInput {
  const tool = WORKBENCH.find((t) => t.href === HREF)
  if (!tool) {
    return { eyebrow: 'Workbench', title: 'Qubit16', kicker: 'AI tools for quantum developers' }
  }
  return {
    eyebrow: `Workbench · ${tool.kind}`,
    title: tool.title,
    kicker: 'Ideal, noisy, readout-mitigated and zero-noise-extrapolated — with the error bar it costs.',
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
