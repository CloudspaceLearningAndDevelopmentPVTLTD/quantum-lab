import type { Metadata } from 'next'
import { JsonLd } from '@/components/seo/JsonLd'
import { faqSchema } from '@/components/seo/schema'
import { pageMetadata } from '@/lib/seo'
import { HELP_FAQ } from './faq'

export const metadata: Metadata = pageMetadata({
  title: 'Help and FAQ',
  description:
    'Answers to real questions: accounts, the 30-day trial, tutor tiers, saved circuits, real hardware, certificates, offline use, embedding, and teaching.',
  path: '/help',
})

export default function HelpLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <JsonLd data={faqSchema(HELP_FAQ, '/help')} />
      {children}
    </>
  )
}
