import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'
import { JsonLd } from '@/components/seo/JsonLd'
import { vizPageSchemas } from '@/components/seo/schema'

export const metadata: Metadata = pageMetadata({
  title: 'Uncertainty as a Fourier Trade-off, Visualized',
  description:
    'Squeeze a wave packet in position and watch its momentum distribution broaden, with σx·σp measured live against the ħ/2 floor it can never cross.',
  path: '/visualizations/uncertainty',
})

const HREF = '/visualizations/uncertainty'

/**
 * LearningResource (a Simulation, not a Lesson) plus the
 * Home › Visualizations › <this page> trail, both built from this route's entry
 * in VISUALIZATIONS. See components/seo/schema.ts.
 */
export default function VisualizationsUncertaintyLayout({
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
