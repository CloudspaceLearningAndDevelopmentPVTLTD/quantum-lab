import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'
import { JsonLd } from '@/components/seo/JsonLd'
import { vizPageSchemas } from '@/components/seo/schema'

export const metadata: Metadata = pageMetadata({
  title: 'The Mach-Zehnder Interferometer',
  description:
    'Drag a phase shifter into one arm of a single-photon interferometer and watch the output ports swap; block an arm and watch the interference die.',
  path: '/visualizations/mach-zehnder',
})

const HREF = '/visualizations/mach-zehnder'

/**
 * LearningResource (a Simulation, not a Lesson) plus the
 * Home › Visualizations › <this page> trail, both built from this route's entry
 * in VISUALIZATIONS. See components/seo/schema.ts.
 */
export default function VisualizationsMachZehnderLayout({
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
