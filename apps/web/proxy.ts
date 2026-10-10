/**
 * proxy.ts (formerly middleware.ts, renamed for Next.js 16 — see
 * https://nextjs.org/docs/app/guides/upgrading/version-16) — attach the
 * security headers to every response.
 *
 * DELIBERATELY NOT AN AUTH BOUNDARY. This app authenticates and authorises per
 * route handler, using the caller's Supabase access token; moving that into
 * this proxy would change the behaviour of all 61 route handlers at once, which is a
 * refactor rather than a fix, and a proxy that half-enforces auth is worse
 * than one that does not try. See docs/SECURITY.md.
 *
 * SPEED. This runs on every matched request, so it does exactly two things:
 * build a small object of constant strings and copy it onto the response. No
 * awaits, no fetches, no cookie parsing, no crypto (see the "why there is no
 * nonce" note in lib/security/headers.ts — a nonce would need a per-request
 * random value here AND dynamic rendering everywhere, which this app does not
 * have). `securityHeaders()` reads only `process.env.NODE_ENV` and the
 * NEXT_PUBLIC_* values, all inlined at build time.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { applySecurityHeaders } from '@/lib/security/headers'

export function proxy(request: NextRequest): NextResponse {
  const response = NextResponse.next()

  // `x-forwarded-proto` is what a proxy/CDN reports; nextUrl.protocol is what
  // this process sees. Either being https is enough to justify HSTS.
  const forwardedProto = request.headers.get('x-forwarded-proto')
  const isSecure = forwardedProto === 'https' || request.nextUrl.protocol === 'https:'

  // /embed/* is the ONLY route family whose headers differ, and the only
  // difference is frame-ancestors gaining the NEXT_PUBLIC_EMBED_ANCESTORS
  // allowlist (unset = no difference at all). The check is a constant-string
  // prefix test on the already-parsed pathname, keeping the "no awaits, no
  // parsing" promise above. See embedFrameAncestors() in lib/security/headers.ts
  // for the full reasoning, including why X-Frame-Options is left alone.
  const embed = request.nextUrl.pathname.startsWith('/embed/')

  applySecurityHeaders(response.headers, { isSecure, embed })
  return response
}

export const config = {
  /**
   * Skip everything that is not a document or an API response:
   *
   *   _next/static  — immutable build output, already hashed
   *   _next/image   — the image optimiser; running middleware per variant is
   *                   pure overhead and CSP on an image byte-stream is noise
   *   favicon/icon/opengraph-image/robots.txt/sitemap.xml/manifest/sw.js
   *                 — static, cacheable, and not a script-execution context
   *
   * Everything else — every page and every /api route — is matched, so the
   * headers land on the HTML documents and JSON responses that actually matter.
   */
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico|icon\\.svg|opengraph-image|robots\\.txt|sitemap\\.xml|manifest\\.webmanifest|sw\\.js).*)',
  ],
}
