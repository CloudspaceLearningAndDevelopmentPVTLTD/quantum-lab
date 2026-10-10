import { JsonLd } from '@/components/seo/JsonLd'
import { HOME_CRUMB, breadcrumbSchema } from '@/components/seo/schema'
import { getChallenge } from '@/lib/challenges/catalogue'

/**
 * Breadcrumbs for one challenge. No `metadata` export — the title, description
 * and canonical come from `generateMetadata` in page.tsx, where `params.id` is
 * already resolved.
 *
 * Deliberately no `Quiz` or `Exercise` node. schema.org's `Quiz` expects
 * questions with accepted answers; a challenge here is "build a circuit that
 * reaches this state", graded by simulating what the learner built. There is no
 * answer string to state, and inventing one would describe a page that does not
 * exist.
 */
export default async function ChallengeLayout(
  props: {
    children: React.ReactNode
    params: Promise<{ id: string }>
  }
) {
  const params = await props.params;

  const {
    children
  } = props;

  const challenge = getChallenge(params.id)
  if (!challenge) return <>{children}</>

  return (
    <>
      <JsonLd
        data={breadcrumbSchema([
          HOME_CRUMB,
          { name: 'Challenges', path: '/challenges' },
          { name: challenge.title, path: `/challenges/${challenge.id}` },
        ])}
      />
      {children}
    </>
  )
}
