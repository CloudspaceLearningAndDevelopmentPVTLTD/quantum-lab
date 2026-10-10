import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'
import { JsonLd } from '@/components/seo/JsonLd'
import { workbenchToolSchemas } from '@/components/seo/schema'

export const metadata: Metadata = pageMetadata({
  title: 'Measurement-Induced Entanglement Transition, Live',
  description:
    'Random Clifford circuits with measurements, simulated live: watch half-chain entanglement switch from volume law to area law as the measurement rate rises.',
  path: '/workbench/entanglement-transition',
})

export default function WorkbenchEntanglementTransitionLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <JsonLd data={workbenchToolSchemas('/workbench/entanglement-transition')} />
      {children}
    </>
  )
}
