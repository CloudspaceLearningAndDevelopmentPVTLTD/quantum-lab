import { OG_SIZE, OG_CONTENT_TYPE, ogAlt, ogCard, type OgAccent } from '@/components/seo/og'
import { WORKBENCH } from '@/lib/workbench'

/** Card for this route, drawn from its own WORKBENCH entry. */
const HREF = '/workbench/generate'

const tool = WORKBENCH.find((t) => t.href === HREF)
const input = tool
  ? { eyebrow: `Workbench · ${tool.kind}`, title: tool.title, kicker: 'A circuit that passes the spec you wrote, checked on an exact simulator', accent: tool.accent as OgAccent }
  : { eyebrow: 'Workbench', title: 'Qubit16', kicker: 'AI tools for quantum developers' }

export const runtime = 'edge'
export const alt = ogAlt(input)
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

export default function Image() {
  return ogCard(input)
}
