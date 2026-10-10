import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'
import { JsonLd } from '@/components/seo/JsonLd'
import { workbenchToolSchemas } from '@/components/seo/schema'

export const metadata: Metadata = pageMetadata({
  title: 'Routing Race — SABRE vs a Learned Router',
  description:
    'Route your circuit onto linear, ring, grid, IBM heavy-hex or all-to-all maps, then race SABRE against a REINFORCE-trained swap policy on depth and SWAPs.',
  path: '/workbench/routing',
})

export default function WorkbenchRoutingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <JsonLd data={workbenchToolSchemas('/workbench/routing')} />
      {children}
    </>
  )
}
