'use client'

/**
 * global-error.tsx — the last line of defence.
 *
 * This boundary replaces the root layout when rendering it fails, so it must
 * render its own <html> and <body> and cannot rely on globals.css having been
 * loaded. Everything below is therefore inline-styled with the same tokens as
 * tailwind.config.ts, so it looks like Qubit16 even when nothing else does.
 *
 * It shows the digest — the id Next.js assigns to the error — because that is
 * the one string a user can quote that lets an operator find the matching report.
 * It does NOT show a stack trace: a stack is meaningless to a learner and can
 * leak internal paths.
 */

import { useEffect } from 'react'
import { reportError } from '@/lib/observability/report'

const BG = '#07090f'
const SURFACE = '#0d1120'
const LINE = 'rgba(255,255,255,0.13)'
const INK = '#eef2ff'
const INK_SECONDARY = '#8fa3c8'
const VIOLET = '#a99dff'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    reportError(error, { boundary: 'global-error', digest: error.digest ?? 'none' })
  }, [error])

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          backgroundColor: BG,
          color: INK,
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
        }}
      >
        <main
          style={{
            width: '100%',
            maxWidth: '560px',
            backgroundColor: SURFACE,
            border: `1px solid ${LINE}`,
            borderRadius: '12px',
            padding: '32px',
          }}
        >
          <p
            style={{
              margin: 0,
              fontSize: '12px',
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: INK_SECONDARY,
            }}
          >
            Something broke
          </p>

          <h1 style={{ margin: '10px 0 0', fontSize: '28px', lineHeight: 1.2 }}>
            This page stopped part way through
          </h1>

          <p style={{ margin: '14px 0 0', color: INK_SECONDARY, lineHeight: 1.6 }}>
            An unexpected error interrupted rendering. Nothing you saved has been lost —
            circuits and progress live in your own browser. Trying again usually works,
            because most of these are transient.
          </p>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', marginTop: '24px' }}>
            <button
              type="button"
              onClick={() => reset()}
              style={{
                appearance: 'none',
                border: 'none',
                cursor: 'pointer',
                backgroundColor: VIOLET,
                color: '#ffffff',
                fontSize: '15px',
                fontWeight: 600,
                padding: '10px 18px',
                borderRadius: '8px',
              }}
            >
              Try again
            </button>
            {/*
              A plain <a>, not next/link, and it has to be. global-error
              REPLACES the root layout when the app has already failed to
              render, so it owns its own <html>/<body> and runs outside the
              router context next/link depends on. A <Link> here would be
              relying on the very thing that just broke.
            */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- see the note above. */}
            <a
              href="/"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                border: `1px solid ${LINE}`,
                color: INK,
                textDecoration: 'none',
                fontSize: '15px',
                padding: '10px 18px',
                borderRadius: '8px',
              }}
            >
              Back to the home page
            </a>
          </div>

          {error.digest ? (
            <p style={{ margin: '24px 0 0', fontSize: '13px', color: INK_SECONDARY }}>
              If it keeps happening, quote this reference:{' '}
              <code
                style={{
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                  color: INK,
                }}
              >
                {error.digest}
              </code>
            </p>
          ) : null}
        </main>
      </body>
    </html>
  )
}
