import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'
import { JsonLd } from '@/components/seo/JsonLd'
import { vizPageSchemas } from '@/components/seo/schema'

export const metadata: Metadata = pageMetadata({
  title: 'Spin Precession and Rabi Flopping, Visualized',
  description:
    'Put a magnetic field on the Bloch sphere and watch a spin precess at the Larmor frequency, then drive it on resonance and watch Rabi oscillations flip it.',
  path: '/visualizations/spin-precession',
})

const HREF = '/visualizations/spin-precession'

/**
 * LearningResource (a Simulation, not a Lesson) plus the
 * Home › Visualizations › <this page> trail, both built from this route's entry
 * in VISUALIZATIONS. See components/seo/schema.ts.
 */
export default function VisualizationsSpinPrecessionLayout({
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
