import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'
import { JsonLd } from '@/components/seo/JsonLd'
import { vizPageSchemas } from '@/components/seo/schema'

export const metadata: Metadata = pageMetadata({
  title: "Shor's Algorithm: Period Finding, Visualized",
  description:
    'Watch the quantum part of Shor’s algorithm run: measure the work register, then let a real QFT circuit concentrate amplitude on multiples of 2^n/r.',
  path: '/visualizations/shor',
})

const HREF = '/visualizations/shor'

/**
 * LearningResource (a Simulation, not a Lesson) plus the
 * Home › Visualizations › <this page> trail, both built from this route's entry
 * in VISUALIZATIONS. See components/seo/schema.ts.
 */
export default function VisualizationsShorLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <JsonLd data={vizPageSchemas(HREF)} />
      {children}
    </>
  )
}
