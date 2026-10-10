import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'
import { JsonLd } from '@/components/seo/JsonLd'
import { workbenchToolSchemas } from '@/components/seo/schema'

export const metadata: Metadata = pageMetadata({
  title: 'Barren Plateau Explorer',
  description:
    'Measure barren plateaus yourself: gradient variance against qubit count for random circuits, deep versus shallow, global cost versus local.',
  path: '/workbench/barren-plateaus',
})

export default function WorkbenchBarrenPlateausLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <JsonLd data={workbenchToolSchemas('/workbench/barren-plateaus')} />
      {children}
    </>
  )
}
