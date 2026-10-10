import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'
import { JsonLd } from '@/components/seo/JsonLd'
import { vizPageSchemas } from '@/components/seo/schema'

export const metadata: Metadata = pageMetadata({
  title: 'Quantum Key Distribution: BB84 and E91, Visualized',
  description:
    'Run BB84 and E91 qubit by qubit, let Eve intercept a chosen fraction, and watch the error rate expose her against the 11% abort line.',
  path: '/visualizations/quantum-key-distribution',
})

const HREF = '/visualizations/quantum-key-distribution'

/**
 * LearningResource (a Simulation, not a Lesson) plus the
 * Home › Visualizations › <this page> trail, both built from this route's entry
 * in VISUALIZATIONS. See components/seo/schema.ts.
 */
export default function VisualizationsQkdLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <JsonLd data={vizPageSchemas(HREF)} />
      {children}
    </>
  )
}
