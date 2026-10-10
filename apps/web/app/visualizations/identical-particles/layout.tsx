import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'
import { JsonLd } from '@/components/seo/JsonLd'
import { vizPageSchemas } from '@/components/seo/schema'

export const metadata: Metadata = pageMetadata({
  title: 'Fermions and Bosons: Exchange Symmetry, Visualized',
  description:
    'Two particles in one well, symmetrised or antisymmetrised: see the Pauli hole, boson bunching, level filling and why the periodic table has its rows.',
  path: '/visualizations/identical-particles',
})

const HREF = '/visualizations/identical-particles'

/**
 * LearningResource (a Simulation, not a Lesson) plus the
 * Home › Visualizations › <this page> trail, both built from this route's entry
 * in VISUALIZATIONS. See components/seo/schema.ts.
 */
export default function VisualizationsIdenticalParticlesLayout({
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
