import { ImageResponse } from 'next/og'

/**
 * The default social card for every route that does not define its own.
 * `/learn/<slug>` and the eight `/visualizations/<slug>` routes override it
 * with a card built from their own data — see components/seo/og.tsx.
 *
 * Deliberately font-free: loading a custom typeface means fetching a font file
 * at build time, which fails in a sandboxed or offline build. System stacks
 * render fine at this size and cost nothing.
 *
 * The wordmark tile used to contain an ⚛ character. Rendering this route and
 * looking at the PNG shows the glyph was never there: `next/og` ships no emoji
 * or symbol font, and Satori drops an unresolvable glyph silently rather than
 * erroring, so the card built "successfully" with an empty tile. It is now a
 * plain gradient chip, which is what it always actually looked like. Do not put
 * a symbol back without rendering the file and reading the image.
 */

export const runtime = 'edge'

export const alt = 'Qubit16 — learn quantum mechanics by playing with it'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const VIOLET = '#a99dff'
const TEAL = '#4edbca'
const BG = '#07090f'

export default function OpengraphImage(): ImageResponse {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: BG,
          padding: '72px 80px',
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif',
        }}
      >
        {/* Wordmark */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <div
            style={{
              display: 'flex',
              width: 72,
              height: 72,
              borderRadius: 20,
              background: `linear-gradient(135deg, ${VIOLET} 0%, ${TEAL} 100%)`,
            }}
          />
          <div
            style={{
              display: 'flex',
              fontSize: 40,
              fontWeight: 700,
              color: '#e9ecf5',
              letterSpacing: -0.5,
            }}
          >
            Qubit16
          </div>
        </div>

        {/* Headline */}
        <div
          style={{
            display: 'flex',
            fontSize: 76,
            fontWeight: 800,
            lineHeight: 1.1,
            letterSpacing: -2,
            color: '#f5f7ff',
            maxWidth: 940,
          }}
        >
          Learn quantum mechanics by playing with it
        </div>

        {/* Gradient accent + strapline */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
          <div
            style={{
              display: 'flex',
              width: '100%',
              height: 10,
              borderRadius: 999,
              background: `linear-gradient(90deg, ${VIOLET} 0%, ${TEAL} 100%)`,
            }}
          />
          <div style={{ display: 'flex', fontSize: 30, color: '#9aa3bd' }}>
            Interactive visualizations · Circuit simulator · AI tutor
          </div>
        </div>
      </div>
    ),
    size
  )
}
