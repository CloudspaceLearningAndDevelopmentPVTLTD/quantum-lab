import { DOCS_URL, REPO_URL } from '@/lib/legal'
import type { Metadata, Viewport } from 'next'
import localFont from 'next/font/local'
import { Toaster } from 'sonner'
import './globals.css'
import { METADATA_BASE } from '@/lib/seo'

/**
 * Self-hosted Inter — the file is in this repo, at app/fonts/, and is served
 * from this app's own origin. No runtime request to fonts.googleapis.com, no
 * render-blocking third-party connection, no CLS from a swap. Exposed as the
 * --font-sans CSS variable (tailwind.config.ts's fontFamily.sans reads it)
 * rather than applied directly, so it composes with Tailwind instead of
 * fighting it.
 *
 * Chose Inter over the previous system-font-only stack: proven at both UI and
 * long-form body-text sizes, wide language coverage, and it is what this
 * codebase's shadcn/ui primitives (components/ui/*) were designed against.
 *
 * This used to be `next/font/google`, whose comment already claimed the font
 * was self-hosted. That was true of the *served* asset and false of the build:
 * next/font/google downloads the face from fonts.googleapis.com during
 * `next build`, so the production build was not hermetic and failed outright
 * on any CI or deploy runner without egress to Google — which is exactly what
 * happened. next/font/local reads the file off disk, so the build now depends
 * on nothing but this repository.
 *
 * The file is Inter's latin subset with the weight axis intact (100–900), from
 * @fontsource-variable/inter@5.3.0 — the same face Google Fonts serves, 48 kB.
 * SIL Open Font License 1.1; the licence travels with it in
 * app/fonts/LICENSE-Inter.txt, as the OFL requires.
 *
 * `adjustFontFallback: 'Arial'` is what next/font/google was doing implicitly:
 * it measures this file and emits a size-adjusted @font-face for the fallback
 * so the swap does not shift the layout.
 */
const inter = localFont({
  src: './fonts/inter-latin-variable.woff2',
  weight: '100 900',
  style: 'normal',
  variable: '--font-sans',
  display: 'swap',
  adjustFontFallback: 'Arial',
  fallback: ['system-ui', 'sans-serif'],
})
import { SiteNav } from '@/components/ui/SiteNav'
import { ServiceWorkerRegistrar } from '@/components/pwa/ServiceWorkerRegistrar'
import { OfflineBanner } from '@/components/pwa/OfflineBanner'
import { InstallPrompt } from '@/components/pwa/InstallPrompt'
import ResumeBanner from '@/components/onboarding/ResumeBanner'
import SkipLink from '@/components/ui/SkipLink'
import ThemeScript from '@/components/ui/ThemeScript'
import StoreAppScript from '@/components/ui/StoreAppScript'
import ThemeToggle from '@/components/ui/ThemeToggle'
import Link from 'next/link'

// Search-engine site-verification tokens (Google Search Console, Bing Webmaster
// Tools). Read at build time like every other NEXT_PUBLIC-adjacent value in
// this app — see lib/env.ts. Absent from an empty environment, on purpose:
// the app must not emit a `content="undefined"` meta tag, so each key below is
// only added once its token is actually set. Get the tokens from:
//   Google: https://search.google.com/search-console -> Settings -> Ownership
//     verification -> HTML tag (copy only the content="..." value)
//   Bing:   https://www.bing.com/webmasters -> Settings -> Verify ownership ->
//     copy only the content="..." value from the meta-tag option
// then set GOOGLE_SITE_VERIFICATION / BING_SITE_VERIFICATION in the production
// environment and rebuild — a dashboard-only change does nothing (build-time).
const googleSiteVerification = process.env.GOOGLE_SITE_VERIFICATION
const bingSiteVerification = process.env.BING_SITE_VERIFICATION

export const metadata: Metadata = {
  // Without this, a route that sets no metadataBase of its own resolves its
  // social-card URL against http://localhost:3000 — which is what /benchmark
  // was serving in production.
  metadataBase: METADATA_BASE,
  title: 'Qubit16 — Learn quantum mechanics by playing with it',
  description:
    'Interactive quantum visualizations, a browser-based circuit simulator, and an AI tutor that explains what you are seeing.',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'Qubit16',
    statusBarStyle: 'black-translucent',
  },
  ...(googleSiteVerification || bingSiteVerification
    ? {
        verification: {
          ...(googleSiteVerification ? { google: googleSiteVerification } : {}),
          ...(bingSiteVerification ? { other: { 'msvalidate.01': bingSiteVerification } } : {}),
        },
      }
    : {}),
}

// In Next 14 themeColor lives on `viewport`, not `metadata` — putting it in metadata
// logs an "Unsupported metadata themeColor" warning at build time.
export const viewport: Viewport = {
  themeColor: '#a99dff',
  width: 'device-width',
  initialScale: 1,
  // Draw under the notch / Dynamic Island / home indicator and handle it
  // ourselves with env(safe-area-inset-*) (SiteNav, MobileTabBar, globals.css).
  // Without this an installed app letterboxes the page on notched phones.
  // Zoom is deliberately NOT disabled: pinch-zoom is an accessibility feature.
  viewportFit: 'cover',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: ThemeScript deliberately mutates this element's
    // class/style before React hydrates (see that file's header) to avoid a
    // theme flash — React has no way to know that's intentional, so without
    // this it "corrects" the attributes back and logs a hydration mismatch on
    // every single load. This only stops React from warning on THIS element's
    // own attributes; it does not disable hydration checks anywhere else.
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        {/* Declared before anything paints so the browser knows both schemes are
            supported and can pick the right initial canvas colour. ThemeScript
            narrows it to a single value when the user has pinned a theme. */}
        <meta name="color-scheme" content="light dark" />
        {/* MUST stay in <head> and MUST stay parser-blocking (no next/script, no
            defer, no type=module) — that is the only thing that prevents a flash
            of the wrong theme. See the comment block in ThemeScript.tsx. */}
        <ThemeScript />
        <StoreAppScript />
      </head>
      <body className="min-h-screen bg-bg text-ink font-sans">
        {/* First child of <body> so it is the first stop in the tab order. */}
        <SkipLink />
        <SiteNav />
        {/* Renders nothing unless a visitor started onboarding and did not finish. */}
        <ResumeBanner />
        <main id="main" tabIndex={-1}>
          {children}
        </main>
        <footer className="border-t border-line mt-16">
          <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-8 text-sm text-ink-muted sm:flex-row sm:items-center sm:justify-between">
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>Qubit16 — an open-source quantum mechanics learning platform.</span>
              <Link href="/about" className="underline hover:text-ink">
                About
              </Link>
              <span aria-hidden="true" className="mx-2 text-ink-muted">·</span>
              <a href={DOCS_URL} className="underline hover:text-ink">Docs</a>
              <span aria-hidden="true" className="mx-2 text-ink-muted">·</span>
              <a href={REPO_URL} className="underline hover:text-ink">Source</a>
              <span aria-hidden="true" className="mx-2 text-ink-muted">·</span>
              <Link href="/educators" className="underline hover:text-ink">For educators</Link>
              <span aria-hidden="true" className="mx-2 text-ink-muted">·</span>
              <Link href="/help" className="underline hover:text-ink">Help</Link>
              <span aria-hidden="true" className="mx-2 text-ink-muted">·</span>
              <Link href="/contact" className="underline hover:text-ink">Contact</Link>
              <span aria-hidden="true" className="mx-2 text-ink-muted">·</span>
              <Link href="/privacy" className="underline hover:text-ink">Privacy</Link>
              <span aria-hidden="true" className="mx-2 text-ink-muted">·</span>
              <Link href="/terms" className="underline hover:text-ink">Terms</Link>
            </span>
            {/* The footer, not SiteNav: the toggle is a preference, not navigation,
                and SiteNav is being edited concurrently by other workstreams. */}
            <ThemeToggle />
          </div>
        </footer>
        <ServiceWorkerRegistrar />
        <OfflineBanner />
        <InstallPrompt />
        {/* shadcn/ui's toast primitive. Themed via the same CSS variables as
            everything else (component sets its own colors from --popover /
            --border / etc. by default under the hood). */}
        {/* offset keeps toasts clear of the mobile tab bar (globals.css sets
            --mobile-nav-h to 0 at xl and up). */}
        <Toaster
          richColors
          closeButton
          position="bottom-right"
          mobileOffset={{ bottom: 'calc(var(--mobile-nav-h) + 12px)' }}
        />
      </body>
    </html>
  )
}
