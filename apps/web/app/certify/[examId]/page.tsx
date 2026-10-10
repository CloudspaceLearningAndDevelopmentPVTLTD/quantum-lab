import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { EXAMS, getExam } from '@/lib/exams/catalogue'
import { pageMetadata } from '@/lib/seo'
import { ExamRunner } from '@/components/exam/ExamRunner'

/**
 * A server component wrapping a client runner. The route itself stays static
 * and prerenders both exams at build time, because everything that varies —
 * the paper, the clock, the answers, the score — now comes from route handlers
 * rather than from the page.
 *
 * `ExamAccessGate` used to sit between the two. It has been DELETED, not
 * replaced: it was a client-side entitlement check whose own header called it a
 * courtesy, and keeping a decorative copy of a gate beside a real one is how a
 * product ends up claiming one thing on a page and another at the route. The
 * gate now lives in `lib/exams/service.ts`, ahead of the questions, and the
 * runner renders whatever the route says — including the upgrade panel for a
 * 402 and the sign-in panel for a 401.
 *
 * Note what this means for the page metadata below: it is public, and it should
 * be. Describing an exam is not the same as handing over its questions.
 */

interface PageProps {
  params: Promise<{ examId: string }>
}

export function generateStaticParams(): { examId: string }[] {
  return EXAMS.map((exam) => ({ examId: exam.id }))
}

/**
 * Through `pageMetadata` for the canonical and the social tags. The question
 * count, time limit and pass mark are appended from the exam record: they are
 * the three things a candidate weighs before clicking, and the subtitle alone
 * states none of them.
 */
export async function generateMetadata(props: PageProps): Promise<Metadata> {
  const params = await props.params;
  const exam = getExam(params.examId)
  if (!exam) return { title: 'Exam not found · Qubit16' }

  return pageMetadata({
    title: exam.title,
    description: `${exam.subtitle} ${exam.questionCount} questions, ${exam.timeLimitMinutes} minutes, ${Math.round(exam.passMark * 100)}% to pass. Graded on our server, and resumable on any device you are signed in on.`,
    path: `/certify/${exam.id}`,
  })
}

export default async function ExamPage(props: PageProps) {
  const params = await props.params;
  const exam = getExam(params.examId)
  if (!exam) notFound()

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <Link
        href="/certify"
        className="focus-ring text-[12px] font-semibold text-ink-muted hover:text-ink"
      >
        ← All certifications
      </Link>
      <div className="mt-4">
        <ExamRunner exam={exam} />
      </div>
    </div>
  )
}
