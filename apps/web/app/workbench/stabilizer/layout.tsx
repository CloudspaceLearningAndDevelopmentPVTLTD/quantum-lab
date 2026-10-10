import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'
import { JsonLd } from '@/components/seo/JsonLd'
import { workbenchToolSchemas } from '@/components/seo/schema'

export const metadata: Metadata = pageMetadata({
  title: 'Stabilizer Simulator: 1,000+ Qubit Clifford Circuits',
  description:
    'Run Clifford circuits on thousands of qubits in your browser with a stabilizer tableau — generators, entanglement entropy across every cut, and samples.',
  path: '/workbench/stabilizer',
})

export default function WorkbenchStabilizerLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <JsonLd data={workbenchToolSchemas('/workbench/stabilizer')} />
      {children}
    </>
  )
}
