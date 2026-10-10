import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'
import { JsonLd } from '@/components/seo/JsonLd'
import { workbenchToolSchemas } from '@/components/seo/schema'

export const metadata: Metadata = pageMetadata({
  title: 'Fault-Tolerant Resource Estimator',
  description:
    'Physical qubits and runtime for an algorithm under surface-code error correction, with magic-state distillation. Order of magnitude, assumptions shown.',
  path: '/workbench/resource-estimator',
})

export default function WorkbenchResourceEstimatorLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <JsonLd data={workbenchToolSchemas('/workbench/resource-estimator')} />
      {children}
    </>
  )
}
