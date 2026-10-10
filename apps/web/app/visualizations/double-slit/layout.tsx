import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'
import { JsonLd } from '@/components/seo/JsonLd'
import { vizPageSchemas } from '@/components/seo/schema'

export const metadata: Metadata = pageMetadata({
  title: 'The Double-Slit Experiment, Visualized',
  description:
    'Fire electrons one at a time and watch interference fringes build from single impacts — then switch on the which-path detector and watch them disappear.',
  path: '/visualizations/double-slit',
})

const HREF = '/visualizations/double-slit'

/**
 * LearningResource (a Simulation, not a Lesson) plus the
 * Home › Visualizations › <this page> trail, both built from this route's entry
 * in VISUALIZATIONS. See components/seo/schema.ts.
 */
export default function VisualizationsDoubleSlitLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <JsonLd data={vizPageSchemas(HREF)} />
      {children}
    </>
  )
}
