import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'
import { JsonLd } from '@/components/seo/JsonLd'
import { workbenchToolSchemas } from '@/components/seo/schema'

export const metadata: Metadata = pageMetadata({
  title: 'Decoder Lab: Train a Surface-Code Decoder in Your Browser',
  description:
    'Train a lookup table, an MLP and a small transformer to decode the surface code at distance 3, 5 and 7, and race them against exact matching at threshold.',
  path: '/workbench/decoder-lab',
})

export default function DecoderLabLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <JsonLd data={workbenchToolSchemas('/workbench/decoder-lab')} />
      {children}
    </>
  )
}
