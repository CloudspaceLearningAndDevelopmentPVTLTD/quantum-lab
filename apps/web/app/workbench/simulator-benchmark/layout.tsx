import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'
import { JsonLd } from '@/components/seo/JsonLd'
import { workbenchToolSchemas } from '@/components/seo/schema'

export const metadata: Metadata = pageMetadata({
  title: 'Simulator Benchmark',
  description:
    'Correctness checks (Bell, GHZ, QFT, Grover) against closed-form targets, plus a live performance sweep from 4 to 16 qubits, timed in your browser.',
  path: '/workbench/simulator-benchmark',
})

export default function WorkbenchSimulatorBenchmarkLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <JsonLd data={workbenchToolSchemas('/workbench/simulator-benchmark')} />
      {children}
    </>
  )
}
