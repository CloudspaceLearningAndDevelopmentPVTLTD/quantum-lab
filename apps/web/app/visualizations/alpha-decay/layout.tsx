import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'
import { JsonLd } from '@/components/seo/JsonLd'
import { vizPageSchemas } from '@/components/seo/schema'

export const metadata: Metadata = pageMetadata({
  title: 'Alpha Decay: Tunneling with a Half-life, Visualized',
  description:
    'Pick U-238, Ra-226, Po-210 or Po-212 and watch the Gamow model turn a Coulomb barrier into a half-life, find the Geiger–Nuttall line, and drag an STM tip.',
  path: '/visualizations/alpha-decay',
})

const HREF = '/visualizations/alpha-decay'

/**
 * LearningResource (a Simulation, not a Lesson) plus the
 * Home › Visualizations › <this page> trail, both built from this route's entry
 * in VISUALIZATIONS. See components/seo/schema.ts.
 */
export default function VisualizationsAlphaDecayLayout({
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
