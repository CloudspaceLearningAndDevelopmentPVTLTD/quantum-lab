import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'
import { JsonLd } from '@/components/seo/JsonLd'
import { HOME_CRUMB, breadcrumbSchema } from '@/components/seo/schema'

export const metadata: Metadata = pageMetadata({
  title: 'Compare — How Qubit16 Stacks Up',
  description:
    'How Qubit16 compares to IBM Quantum, Brilliant, edX/Coursera and Microsoft Learn: visual lessons, an in-browser simulator, an AI tutor and spaced review.',
  path: '/compare',
})

export default function CompareLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <JsonLd data={breadcrumbSchema([HOME_CRUMB, { name: 'Compare', path: '/compare' }])} />
      {children}
    </>
  )
}
