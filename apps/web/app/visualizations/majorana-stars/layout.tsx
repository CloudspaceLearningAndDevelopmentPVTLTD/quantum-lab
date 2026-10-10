import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'
import { JsonLd } from '@/components/seo/JsonLd'
import { vizPageSchemas } from '@/components/seo/schema'

export const metadata: Metadata = pageMetadata({
  title: 'Majorana Stars: The Bloch Sphere for Bigger Spins',
  description:
    'A spin-j state is 2j points on the Bloch sphere. Rotate it and the stars turn together; squeeze it and they separate: a bigger Hilbert space, made visible.',
  path: '/visualizations/majorana-stars',
})

const HREF = '/visualizations/majorana-stars'

/**
 * LearningResource (a Simulation, not a Lesson) plus the
 * Home › Visualizations › <this page> trail, both built from this route's entry
 * in VISUALIZATIONS. See components/seo/schema.ts.
 */
export default function VisualizationsMajoranaStarsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <JsonLd data={vizPageSchemas(HREF)} />
      {children}
    </>
  )
}
