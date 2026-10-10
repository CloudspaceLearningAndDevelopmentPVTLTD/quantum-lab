import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'
import { JsonLd } from '@/components/seo/JsonLd'
import { workbenchToolSchemas } from '@/components/seo/schema'

export const metadata: Metadata = pageMetadata({
  title: 'Algorithm Evolution — LLM-proposed heuristics, scored on the simulator',
  description:
    'Models propose QAOA schedules and local-search programs, the simulator scores them, the fittest survive — Quantinuum\'s Hive loop at demo scale.',
  path: '/workbench/evolve',
})

export default function WorkbenchEvolveLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <JsonLd data={workbenchToolSchemas('/workbench/evolve')} />
      {children}
    </>
  )
}
