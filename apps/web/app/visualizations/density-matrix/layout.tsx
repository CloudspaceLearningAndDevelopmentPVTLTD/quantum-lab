import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'
import { JsonLd } from '@/components/seo/JsonLd'
import { vizPageSchemas } from '@/components/seo/schema'

export const metadata: Metadata = pageMetadata({
  title: 'Mixed States and the Density Matrix, Visualized',
  description:
    'See ρ as numbers beside the Bloch ball: purity as arrow length, a mixture vs a superposition, and a Bell pair whose halves are maximally mixed.',
  path: '/visualizations/density-matrix',
})

const HREF = '/visualizations/density-matrix'

/**
 * LearningResource (a Simulation, not a Lesson) plus the
 * Home › Visualizations › <this page> trail, both built from this route's entry
 * in VISUALIZATIONS. See components/seo/schema.ts.
 */
export default function VisualizationsDensityMatrixLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <JsonLd data={vizPageSchemas(HREF)} />
      {children}
    </>
  )
}
