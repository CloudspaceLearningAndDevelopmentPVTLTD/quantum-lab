import type { Metadata } from 'next'

/**
 * Layout for the embeddable circuit widget (docs/EMBED.md).
 *
 * The page is meant to live inside an <iframe> on someone else's site, so it
 * must render NO site chrome: no nav, no footer, no banners, no theme toggle.
 *
 * WHY THE CSS RULE BELOW EXISTS: in the App Router a nested layout cannot
 * subtract from the root layout — app/layout.tsx unconditionally renders
 * SiteNav, the footer, the skip link and the PWA banners around every route,
 * and restructuring it into route groups (the "proper" fix) would touch the
 * root layout and every top-level route at once, which other workstreams are
 * editing concurrently. So the chrome is suppressed from here instead: the
 * root layout's <main> wraps this route's content, and every OTHER direct
 * child of <body> — nav, footer, skip link, banners — is hidden while (and
 * only while) this route's marker attribute is present in the tree. `:has()`
 * is supported by every browser that can run the simulator itself (it needs
 * far newer APIs than :has). If app/layout.tsx is ever reorganised into route
 * groups, delete this style and give /embed its own bare root layout.
 */
const CHROME_SUPPRESSION = `
  body:has([data-ql-embed]) > :not(main) { display: none !important; }
  body:has([data-ql-embed]) > main { min-height: 100vh; }
`

export const metadata: Metadata = {
  title: 'Qubit16 — Embedded Circuit',
  // An iframe body is not a destination: the host page is what should rank.
  robots: { index: false, follow: false },
}

export default function EmbedCircuitLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-ql-embed>
      {/* A static string child, not dangerouslySetInnerHTML — no interpolation,
          nothing user-controlled, and React escapes nothing it need not. */}
      <style>{CHROME_SUPPRESSION}</style>
      {children}
    </div>
  )
}
