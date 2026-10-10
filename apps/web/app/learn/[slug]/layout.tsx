import { JsonLd } from '@/components/seo/JsonLd'
import { lessonPageSchemas } from '@/components/seo/schema'

/**
 * Carries the per-lesson structured data. No `metadata` export: the lesson's
 * title, description and canonical come from `generateMetadata` in page.tsx,
 * which is where `params.slug` is already resolved.
 *
 * A layout in a dynamic segment receives the same `params` the page does, which
 * is what makes per-lesson JSON-LD possible without touching the page body.
 *
 * Emits a LearningResource for the lesson and a BreadcrumbList for
 * Home › Learn › <lesson>. The two Course nodes it sits inside come from the
 * parent `app/learn/layout.tsx`; the LearningResource references one of them by
 * `@id` rather than restating it.
 */
export default async function LessonLayout(
  props: {
    children: React.ReactNode
    params: Promise<{ slug: string }>
  }
) {
  const params = await props.params;

  const {
    children
  } = props;

  return (
    <>
      <JsonLd data={lessonPageSchemas(params.slug)} />
      {children}
    </>
  )
}
