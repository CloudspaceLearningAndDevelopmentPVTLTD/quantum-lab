import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'
import { JsonLd } from '@/components/seo/JsonLd'
import { vizPageSchemas } from '@/components/seo/schema'

export const metadata: Metadata = pageMetadata({
  title: 'Decoherence, Visualized',
  description:
    'Set T1 and T2 and watch a qubit lose its phase: the Bloch vector shortens, purity falls toward one half, and the coherence readout says how much is left.',
  path: '/visualizations/decoherence',
})

const HREF = '/visualizations/decoherence'

/**
 * LearningResource (a Simulation, not a Lesson) plus the
 * Home › Visualizations › <this page> trail, both built from this route's entry
 * in VISUALIZATIONS. See components/seo/schema.ts.
 */
export default function VisualizationsDecoherenceLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <JsonLd data={vizPageSchemas(HREF)} />
      {children}
    </>
  )
}
