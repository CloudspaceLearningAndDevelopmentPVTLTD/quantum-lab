import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'
import { JsonLd } from '@/components/seo/JsonLd'
import { vizPageSchemas } from '@/components/seo/schema'

export const metadata: Metadata = pageMetadata({
  title: 'Blackbody Radiation and the Ultraviolet Catastrophe, Visualized',
  description:
    'Plot the Planck curve against the classical Rayleigh-Jeans prediction on the same axes, from the 2.7 K microwave background to the surface of Sirius.',
  path: '/visualizations/blackbody-spectrum',
})

const HREF = '/visualizations/blackbody-spectrum'

/**
 * LearningResource (a Simulation, not a Lesson) plus the
 * Home › Visualizations › <this page> trail, both built from this route's entry
 * in VISUALIZATIONS. See components/seo/schema.ts.
 */
export default function VisualizationsBlackbodyLayout({
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
