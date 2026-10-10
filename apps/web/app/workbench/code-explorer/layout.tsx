import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'
import { JsonLd } from '@/components/seo/JsonLd'
import { workbenchToolSchemas } from '@/components/seo/schema'

export const metadata: Metadata = pageMetadata({
  title: 'Stabilizer Code Explorer: [[n,k,d]] Calculator',
  description:
    'Paste stabilizer generators and get the [[n,k,d]] parameters, logical operators, degeneracy and single-error syndrome table, computed in your browser.',
  path: '/workbench/code-explorer',
})

export default function WorkbenchCodeExplorerLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <JsonLd data={workbenchToolSchemas('/workbench/code-explorer')} />
      {children}
    </>
  )
}
