import { OG_SIZE, OG_CONTENT_TYPE, ogAlt, ogCard, type OgAccent, type OgCardInput } from '@/components/seo/og'
import { WORKBENCH } from '@/lib/workbench'

/** Card for this route, drawn from its own WORKBENCH entry. See components/seo/og.tsx. */
const HREF = '/workbench/experiments'

function input(): OgCardInput {
  const tool = WORKBENCH.find((t) => t.href === HREF)
  if (!tool) {
    return { eyebrow: 'Workbench', title: 'Experiment Runner', kicker: 'An experiment record an agent wrote overnight' }
  }
  return { eyebrow: `Workbench · ${tool.kind}`, title: tool.title, kicker: tool.result, accent: tool.accent as OgAccent }
}

export const runtime = 'edge'
export const alt = ogAlt(input())
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

export default function Image() {
  return ogCard(input())
}
