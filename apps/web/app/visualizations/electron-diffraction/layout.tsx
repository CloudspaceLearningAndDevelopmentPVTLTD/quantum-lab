import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'
import { JsonLd } from '@/components/seo/JsonLd'
import { vizPageSchemas } from '@/components/seo/schema'

export const metadata: Metadata = pageMetadata({
  title: 'The Davisson–Germer Experiment, Visualized',
  description:
    'Sweep the voltage and swing the detector: electrons diffract off nickel and the 54 V peak lands at 50°, where a 0.167 nm de Broglie wave must put it.',
  path: '/visualizations/electron-diffraction',
})

const HREF = '/visualizations/electron-diffraction'

/**
 * LearningResource (a Simulation, not a Lesson) plus the
 * Home › Visualizations › <this page> trail, both built from this route's entry
 * in VISUALIZATIONS. See components/seo/schema.ts.
 */
export default function VisualizationsElectronDiffractionLayout({
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
