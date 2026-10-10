import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'
import { JsonLd } from '@/components/seo/JsonLd'
import { vizPageSchemas } from '@/components/seo/schema'

export const metadata: Metadata = pageMetadata({
  title: 'The Stern-Gerlach Experiment, Visualized',
  description:
    'Chain two or three Stern-Gerlach analysers and count atoms one at a time: measuring along x leaves a z-up beam splitting 50/50 on z again.',
  path: '/visualizations/stern-gerlach',
})

const HREF = '/visualizations/stern-gerlach'

/**
 * LearningResource (a Simulation, not a Lesson) plus the
 * Home › Visualizations › <this page> trail, both built from this route's entry
 * in VISUALIZATIONS. See components/seo/schema.ts.
 */
export default function VisualizationsSternGerlachLayout({
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
