import { OG_SIZE, OG_CONTENT_TYPE, ogAlt, ogCard, type OgAccent, type OgCardInput } from '@/components/seo/og'
import { WORKBENCH } from '@/lib/workbench'

/** Card for this route, drawn from its own WORKBENCH entry (lib/workbench.ts). */
const HREF = '/workbench/resource-estimator'

function inputFor(): OgCardInput {
  const tool = WORKBENCH.find((t) => t.href === HREF)
  if (!tool) {
    return { eyebrow: 'Workbench', title: 'Fault-Tolerant Resource Estimator', kicker: 'Workbench tool', accent: 'violet' }
  }
  return {
    eyebrow: `Workbench · ${tool.kind}`,
    title: tool.title,
    kicker: tool.result,
    accent: tool.accent as OgAccent,
  }
}

export const runtime = 'edge'
export const alt = ogAlt(inputFor())
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

export default function Image() {
  return ogCard(inputFor())
}
