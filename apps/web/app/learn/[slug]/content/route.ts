/**
 * GET /learn/[slug]/content — the withheld tail of a paid lesson.
 *
 * THIS IS THE GATE. `app/learn/[slug]/page.tsx` is statically rendered and this
 * app has no server-readable session (Supabase persists the session in browser
 * storage; identity travels as `Authorization: Bearer <access_token>` — see
 * lib/security/auth.ts and lib/authFetch.ts), so a Server Component literally
 * cannot know who is asking and is not permitted to decide. The page therefore
 * serves the same three-block preview to everyone, and the paid blocks exist on
 * the wire only in this response, only after `verifiedCaller` has proved who
 * the caller is and `requireFeature` has agreed they may have them.
 *
 * That is the same mechanism the billing and org routes use (audit findings
 * BILL-1 / BILL-2 / ORG-1). It is deliberately not a second one: a `userId` in
 * a query string is a claim, and nothing here reads one.
 *
 * WHY IT LIVES UNDER app/learn RATHER THAN app/api. It is the paid half of one
 * page and is versioned with it; keeping the two in the same folder is what
 * stops the preview length and the withheld tail drifting apart. Note that
 * robots.txt disallows /api/ but not this path — which costs nothing, because
 * an unauthenticated crawler gets the same 402 as any other stranger and no
 * lesson prose is in that body.
 */

import { NextResponse } from 'next/server'
import { getFullLesson } from '@/lib/lessons/server'
import { featureForLesson, isLessonFree, FREE_PREVIEW_BLOCKS } from '@/lib/lessons/access'
import { featureLockedResponse, requireFeature } from '@/lib/billing/entitlements'
import { verifiedCallerId } from '@/lib/security/auth'
import { check, clientKey, retryHeaders } from '@/lib/security/ratelimit'
import { apiError, failure } from '@/lib/apiError'
import { FeatureLockedError } from '@/lib/plans'

export const runtime = 'nodejs'

/**
 * Reads request headers to identify the caller, so it must never be
 * prerendered. Without this Next evaluates it during `next build` and fails
 * with a dynamic-server-usage error.
 */
export const dynamic = 'force-dynamic'

interface RouteContext {
  params: Promise<{ slug: string }>
}

export async function GET(req: Request, props: RouteContext): Promise<Response> {
  const params = await props.params;
  try {
    // Each miss costs a Supabase round trip for the token and another for the
    // subscription row, so an anonymous caller must not be able to drive that
    // for free. Same limiter and budget as /api/billing/entitlement.
    const limit = check(clientKey(req.headers, 'lesson-content'), 60, 60_000)
    if (!limit.allowed) {
      return apiError('rate_limited', { headers: retryHeaders(limit) })
    }

    const lesson = getFullLesson(params.slug)
    // Not `notFound()`: this is a route handler, and a JSON caller needs a body
    // it can branch on rather than an HTML 404 page.
    if (!lesson) return apiError('not_found')

    // A free lesson has no withheld tail. Answer it without touching Supabase —
    // the whole foundations track must keep working with no account, no token
    // and no backend configured at all.
    if (isLessonFree(lesson.slug)) {
      return NextResponse.json({
        slug: lesson.slug,
        locked: false,
        blocks: lesson.blocks,
        previewCount: lesson.blocks.length,
      })
    }

    const feature = featureForLesson(lesson.slug)
    const callerId = await verifiedCallerId(req)

    // `requireFeature(null, …)` resolves FREE_ENTITLEMENT and throws, so an
    // anonymous caller takes the 402 path below rather than a separate 401.
    // One refusal, one shape: the browser renders the paywall either way.
    await requireFeature(callerId, feature)

    return NextResponse.json(
      {
        slug: lesson.slug,
        locked: false,
        blocks: lesson.blocks,
        previewCount: FREE_PREVIEW_BLOCKS,
      },
      {
        // The body varies by `Authorization`, and the URL does not. A shared
        // cache that stored one subscriber's 200 would hand the paid lesson to
        // the next anonymous request — the paywall defeated by a CDN rather
        // than by a bug. `private, no-store` says both halves of that: not in a
        // shared cache, not on disk.
        headers: {
          'cache-control': 'private, no-store, max-age=0',
          vary: 'Authorization',
        },
      },
    )
  } catch (err) {
    if (err instanceof FeatureLockedError) {
      return featureLockedResponse(err)
    }
    return failure('internal', err, { route: 'learn/content', slug: params.slug })
  }
}
