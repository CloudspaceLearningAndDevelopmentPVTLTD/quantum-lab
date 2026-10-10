import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'
import { JsonLd } from '@/components/seo/JsonLd'
import { workbenchToolSchemas } from '@/components/seo/schema'

export const metadata: Metadata = pageMetadata({
  title: 'Run This Paper',
  description:
    'Landmark quantum papers — teleportation, Grover, GHZ, BB84, E91 — executed on this simulator, next to what each paper reported.',
  path: '/workbench/run-paper',
})

export default function RunPaperLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <JsonLd data={workbenchToolSchemas('/workbench/run-paper')} />
      {children}
    </>
  )
}
