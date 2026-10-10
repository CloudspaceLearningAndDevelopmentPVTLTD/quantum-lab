import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'
import { VISUALIZATIONS } from '@/components/ui/Hero'
import VizCallToAction from '@/components/ui/VizCallToAction'

// The count was written out as "Eight" in both the title and the description.
// It is the length of the catalogue this page renders; the ninth visualization
// would have left two lies in the search result.
const COUNT = VISUALIZATIONS.length

export const metadata: Metadata = pageMetadata({
  title: `${COUNT} Interactive Quantum Visualizations`,
  description:
    `${COUNT} live quantum simulations — double slit, Bloch sphere, entanglement, tunneling, ` +
    `Grover, the QFT. Every frame is computed from the state as you watch.`,
  path: '/visualizations',
})

export default function VisualizationsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <VizCallToAction />
    </>
  )
}
