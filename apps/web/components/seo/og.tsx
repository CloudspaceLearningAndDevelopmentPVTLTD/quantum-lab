import { ImageResponse } from 'next/og'

/**
 * og.tsx — the one card layout every per-route social image is drawn with.
 *
 * Eight visualization routes and eleven lessons need their own card. Eight
 * copies of a 120-line JSX layout is how they drift; each route file is a
 * six-line call into `ogCard` with data read from the page's own catalogue.
 *
 * ── NO EMOJI. THIS WAS MEASURED, NOT ASSUMED. ────────────────────────────────
 * The first version of this card put the visualization's own emoji (🌊, 🔮, 🔗)
 * top-right and an ⚛ in the wordmark tile. Rendering the PNGs and looking at
 * them shows both are simply ABSENT: `next/og` ships no emoji font, and Satori
 * drops a glyph it cannot resolve rather than erroring, so the card renders
 * "successfully" with a hole in it. `new ImageResponse(..., { emoji: 'twemoji' })`
 * would fix it by fetching SVGs from a CDN at render time — which trades a
 * silent visual bug for a silent network dependency inside the image route, and
 * that is a worse trade for a card nobody is watching. The accent rail below
 * carries the per-page identity instead. `app/opengraph-image.tsx` had the same
 * invisible ⚛ and was fixed in the same pass.
 *
 * ── LEGIBILITY IS THE WHOLE CONSTRAINT ───────────────────────────────────────
 * and it is not the same constraint as "looks good at 1200x630". A Slack unfurl
 * renders the card around 360px wide and an X timeline card around 250px — a
 * ~4.8x downscale. Every card was rendered to PNG, box-downscaled to 250px and
 * looked at (docs/SEO.md has the two commands). What that showed:
 *
 *   source 104/88/72px title → 22/18/15px at 250px   reads at a glance
 *   source 34px kicker       → ~7px                  readable, with effort
 *   source 26px eyebrow      → ~5px                  strained; treat as texture
 *
 * So the hierarchy is deliberately shallow: ONE thing (the title) is meant to
 * be read at thumbnail size; everything else is a bonus at full size. Do not
 * add a fourth text block — it makes the title smaller, and the title is the
 * only element that survives the size these are actually seen at.
 *
 * Deliberately font-free, same as app/opengraph-image.tsx: loading a custom
 * typeface means fetching a font file at build time, which fails in a sandboxed
 * or offline build. System stacks cost nothing and render fine at this size.
 */

export const OG_SIZE = { width: 1200, height: 630 } as const
export const OG_CONTENT_TYPE = 'image/png'

const BG = '#07090f'
const INK = '#f5f7ff'
const INK_DIM = '#9aa3bd'

/**
 * Hex mirrors of the site's accent tokens. These CANNOT read the CSS custom
 * properties in globals.css — the card is rasterized on a server with no
 * stylesheet — so they are duplicated here on purpose. If a token's hue is
 * changed there, change it here in the same commit; a card whose accent no
 * longer matches the site is the only failure mode, and it is cosmetic.
 */
const ACCENT: Record<OgAccent, string> = {
  violet: '#a99dff',
  teal: '#4edbca',
  sky: '#4aa8f0',
  amber: '#e0a33c',
  rose: '#e0678f',
}

export type OgAccent = 'violet' | 'teal' | 'sky' | 'amber' | 'rose'

const FONT_STACK =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif'

/**
 * Title size by length. `next/og` has no text measurement and no auto-fit, so a
 * long title at a fixed size either overflows the card or wraps into the
 * footer. These three steps were picked by rendering the longest real title in
 * each catalogue ("The Double-Slit Experiment", "Superposition & Measurement",
 * "Error Correction and the Threshold Theorem") and checking each fits.
 */
function titleSize(title: string): number {
  if (title.length <= 22) return 104
  if (title.length <= 34) return 88
  return 72
}

export interface OgCardInput {
  /** Small all-caps line above the title, e.g. 'LESSON 3 OF 7'. Texture only. */
  eyebrow: string
  /** The one thing that must be readable in a timeline. Keep it short. */
  title: string
  /** One line under the rule. Reads at full size, not at thumbnail size. */
  kicker: string
  /** Per-page tint, from the page's own catalogue entry. Defaults to violet. */
  accent?: OgAccent
}

/**
 * `alt` matters more than usual here: a social card is an image made of text,
 * so a screen reader on the unfurling platform gets nothing but this string. It
 * says what the linked page is, not what the artwork looks like.
 */
export function ogAlt(input: OgCardInput): string {
  return `${input.title} — ${input.kicker} · Qubit16`
}

export function ogCard(input: OgCardInput): ImageResponse {
  const { eyebrow, title, kicker } = input
  const accent = ACCENT[input.accent ?? 'violet']
  // The second gradient stop is teal, except when the accent already IS teal —
  // a teal-to-teal gradient renders as a flat block and loses the brand cue.
  const accent2 = input.accent === 'teal' ? ACCENT.violet : ACCENT.teal

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
          padding: '64px 80px',
          fontFamily: FONT_STACK,
        }}
      >
        {/* Wordmark. The tile is a plain gradient chip, not a glyph — see the
            no-emoji note at the top of this file. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <div
            style={{
              display: 'flex',
              width: 52,
              height: 52,
              borderRadius: 14,
              background: `linear-gradient(135deg, ${accent} 0%, ${accent2} 100%)`,
            }}
          />
          <div
            style={{
              display: 'flex',
              fontSize: 30,
              fontWeight: 700,
              color: '#e9ecf5',
              letterSpacing: -0.4,
            }}
          >
            Qubit16
          </div>
        </div>

        {/* Title block. flex:1 with centred content keeps a one-line title
            optically in the same place as a three-line one. The 40px bottom
            padding is load-bearing: without it a descender in the last line
            ("Quantum Cryptography") crossed the gradient rule below. */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            flex: 1,
            justifyContent: 'center',
            gap: 22,
            paddingTop: 24,
            paddingBottom: 40,
          }}
        >
          <div
            style={{
              display: 'flex',
              fontSize: 26,
              fontWeight: 700,
              letterSpacing: 3,
              textTransform: 'uppercase',
              color: accent,
            }}
          >
            {eyebrow}
          </div>
          <div
            style={{
              display: 'flex',
              fontSize: titleSize(title),
              fontWeight: 800,
              lineHeight: 1.05,
              letterSpacing: -2,
              color: INK,
              maxWidth: 1000,
            }}
          >
            {title}
          </div>
        </div>

        {/* Footer rule + kicker. */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
          <div
            style={{
              display: 'flex',
              width: '100%',
              height: 8,
              borderRadius: 999,
              background: `linear-gradient(90deg, ${accent} 0%, ${accent2} 100%)`,
            }}
          />
          <div style={{ display: 'flex', fontSize: 34, color: INK_DIM }}>{kicker}</div>
        </div>
      </div>
    ),
    OG_SIZE
  )
}
