import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'
import { JsonLd } from '@/components/seo/JsonLd'
import { vizPageSchemas } from '@/components/seo/schema'

export const metadata: Metadata = pageMetadata({
  title: 'Wavefunctions in Three Dimensions',
  description:
    'Box, oscillator, rigid rotor and hydrogen drawn as the probability clouds they are. Step the quantum numbers, slice the cloud, watch degeneracy split.',
  path: '/visualizations/wavefunctions-3d',
})

const HREF = '/visualizations/wavefunctions-3d'

/**
 * LearningResource (a Simulation, not a Lesson) plus the
 * Home › Visualizations › <this page> trail, both built from this route's entry
 * in VISUALIZATIONS. See components/seo/schema.ts.
 */
export default function VisualizationsWavefunctions3dLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <>
      <JsonLd data={vizPageSchemas(HREF)} />
      {children}
    </>
  )
}
