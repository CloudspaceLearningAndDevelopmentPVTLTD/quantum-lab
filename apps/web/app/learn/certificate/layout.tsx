import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'
import { JsonLd } from '@/components/seo/JsonLd'
import { HOME_CRUMB, breadcrumbSchema } from '@/components/seo/schema'

export const metadata: Metadata = pageMetadata({
  title: 'Certificates for Completed Learning Tracks',
  description:
    'Claim a certificate for every track you have finished, issued from the progress recorded in this browser, with an ID you can share.',
  path: '/learn/certificate',
})

/**
 * Breadcrumbs only. No `EducationalOccupationalCredential` node: these
 * certificates are issued from progress stored in the visitor's own browser and
 * have no server-side record, so there is nothing a third party could verify.
 * Marking them up as a credential would claim more than the product does.
 *
 * The two Course nodes from `app/learn/layout.tsx` wrap this page as well; that
 * is correct here — this page is about finishing those courses.
 */
export default function LearnCertificateLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <JsonLd
        data={breadcrumbSchema([
          HOME_CRUMB,
          { name: 'Learn', path: '/learn' },
          { name: 'Certificates', path: '/learn/certificate' },
        ])}
      />
      {children}
    </>
  )
}
