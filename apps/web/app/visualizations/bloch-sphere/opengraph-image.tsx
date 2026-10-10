import { OG_SIZE, OG_CONTENT_TYPE } from '@/components/seo/og'
import { vizCard, vizCardAlt } from '@/components/seo/vizCard'

/** Card for this route, drawn from its own VISUALIZATIONS entry. See components/seo/vizCard.tsx. */
const HREF = '/visualizations/bloch-sphere'

export const runtime = 'edge'
export const alt = vizCardAlt(HREF)
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

export default function Image() {
  return vizCard(HREF)
}
