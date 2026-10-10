import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'
import { JsonLd } from '@/components/seo/JsonLd'
import { vizPageSchemas } from '@/components/seo/schema'

export const metadata: Metadata = pageMetadata({
  title: 'Quantum State Tomography and No-Cloning, Visualized',
  description:
    'Reconstruct a qubit from shots in three bases and watch the error fall as 1/√N; fix unphysical two-qubit estimates; then try to build a cloner and fail.',
  path: '/visualizations/state-tomography',
})

const HREF = '/visualizations/state-tomography'

/**
 * LearningResource (a Simulation, not a Lesson) plus the
 * Home › Visualizations › <this page> trail, both built from this route's entry
 * in VISUALIZATIONS. See components/seo/schema.ts.
 */
export default function VisualizationsStateTomographyLayout({
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
