import { JsonLd } from '@/components/seo/JsonLd'
import { HOME_CRUMB, breadcrumbSchema } from '@/components/seo/schema'
import { getExam } from '@/lib/exams/catalogue'

/**
 * Breadcrumbs for one exam. No `metadata` export — page.tsx's
 * `generateMetadata` already resolves `params.examId`.
 *
 * Deliberately no `Quiz` node: the questions are drawn from a pool at attempt
 * time, are served by a route handler without their answers, and are never on
 * the page a crawler sees. Marking them up would describe content that does not
 * exist at that URL.
 *
 * `EducationalOccupationalCredential` is now defensible and is still not here,
 * for a narrower reason: the certificate is per-candidate, and the node belongs
 * on the thing that proves one — `/verify/<id>` — rather than on the page
 * advertising the exam. That is a follow-up, not an oversight.
 */
export default async function ExamLayout(
  props: {
    children: React.ReactNode
    params: Promise<{ examId: string }>
  }
) {
  const params = await props.params;

  const {
    children
  } = props;

  const exam = getExam(params.examId)
  if (!exam) return <>{children}</>

  return (
    <>
      <JsonLd
        data={breadcrumbSchema([
          HOME_CRUMB,
          { name: 'Certification', path: '/certify' },
          { name: exam.title, path: `/certify/${exam.id}` },
        ])}
      />
      {children}
    </>
  )
}
