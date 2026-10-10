import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'
import { JsonLd } from '@/components/seo/JsonLd'
import { workbenchToolSchemas } from '@/components/seo/schema'

export const metadata: Metadata = pageMetadata({
  title: 'Verified Circuit Generation',
  description:
    'Write a spec — a target histogram, state or unitary with gate-set and depth limits — and get a circuit that passes it on an exact simulator, failures kept.',
  path: '/workbench/generate',
})

export default function WorkbenchGenerateLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <JsonLd data={workbenchToolSchemas('/workbench/generate')} />
      {children}
    </>
  )
}
