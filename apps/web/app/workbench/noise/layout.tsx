import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'
import { JsonLd } from '@/components/seo/JsonLd'
import { workbenchToolSchemas } from '@/components/seo/schema'

export const metadata: Metadata = pageMetadata({
  title: 'Noise Sandbox and Mitigation',
  description:
    'Run a circuit under depolarising, T1/T2 and readout noise, then recover the expectation value with readout inversion and zero-noise extrapolation.',
  path: '/workbench/noise',
})

/**
 * Home › Workbench › Noise Sandbox trail. No LearningResource node: this is a
 * tool that produces a number, not a lesson, and the schema helpers for
 * visualizations are deliberately not reused for it.
 */
export default function WorkbenchNoiseLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <JsonLd data={workbenchToolSchemas('/workbench/noise')} />
      {children}
    </>
  )
}
