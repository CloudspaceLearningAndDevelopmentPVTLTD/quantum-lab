import { OG_SIZE, OG_CONTENT_TYPE, ogAlt, ogCard, type OgCardInput } from '@/components/seo/og'
import { WORKBENCH } from '@/lib/workbench'

/** Card for this route, drawn from its own WORKBENCH entry. See components/seo/og.tsx. */
const HREF = '/workbench/decoder-lab'

function input(): OgCardInput {
  const tool = WORKBENCH.find((t) => t.href === HREF)
  return tool
    ? { eyebrow: `Workbench · ${tool.kind}`, title: tool.title, kicker: tool.result, accent: tool.accent }
    : { eyebrow: 'Workbench', title: 'Decoder Lab', kicker: 'Train a surface-code decoder in your browser' }
}

export const runtime = 'edge'
export const alt = ogAlt(input())
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

export default function Image() {
  return ogCard(input())
}
