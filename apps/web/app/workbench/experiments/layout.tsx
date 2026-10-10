import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'
import { JsonLd } from '@/components/seo/JsonLd'
import { workbenchToolSchemas } from '@/components/seo/schema'

export const metadata: Metadata = pageMetadata({
  title: 'Experiment Runner',
  description:
    'Let an MCP agent run circuits overnight — on the simulator, a noisy simulator or real hardware — and read the record it wrote: hypothesis, steps, verdict.',
  path: '/workbench/experiments',
})

export default function ExperimentsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <JsonLd data={workbenchToolSchemas('/workbench/experiments')} />
      {children}
    </>
  )
}
