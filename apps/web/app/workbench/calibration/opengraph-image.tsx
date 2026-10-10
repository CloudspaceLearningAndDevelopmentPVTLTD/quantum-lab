import { OG_SIZE, OG_CONTENT_TYPE, ogAlt, ogCard, type OgAccent } from '@/components/seo/og'
import { WORKBENCH } from '@/lib/workbench'

/** Card for this route, drawn from its own WORKBENCH entry. See components/seo/og.tsx. */
const HREF = '/workbench/calibration'

export const runtime = 'edge'
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

function input() {
  const tool = WORKBENCH.find((t) => t.href === HREF)
  return tool
    ? {
        eyebrow: `Workbench · ${tool.kind}`,
        title: tool.title,
        kicker: tool.result,
        accent: tool.accent as OgAccent,
      }
    : {
        eyebrow: 'Workbench',
        title: 'Calibration Agent',
        kicker: 'An RL agent that holds gate fidelity from measurement counts alone',
        accent: 'violet' as OgAccent,
      }
}

export const alt = ogAlt(input())

export default function Image() {
  return ogCard(input())
}
