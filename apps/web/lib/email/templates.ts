/**
 * email/templates.ts — every message Qubit16 can send, as pure functions.
 *
 * Rules that these templates follow, because mail clients are not browsers:
 *   • Inline styles only. Gmail and Outlook strip <style> blocks.
 *   • Dark text on a light card. Mail clients invert or ignore dark themes
 *     unpredictably; light-mode-first is the only thing that reads everywhere.
 *   • max-width 560px, table-free, single column — survives narrow mobile panes.
 *   • No external images and no web fonts: images are blocked by default and a
 *     remote font request is a tracking vector.
 *   • ALWAYS both parts. The text version is not a courtesy — a multipart message
 *     with no text alternative scores worse with spam filters, and some clients
 *     (and every screen reader piping through plain text) show it instead.
 *
 * No environment access and no side effects beyond one deliberate exception:
 * the 7-day course section at the bottom imports the visualization catalogue
 * (pure data) and VERIFIES ITS OWN LINKS AT MODULE LOAD, throwing if a course
 * email points at a route that does not exist. A dead link discovered in a
 * subscriber's inbox cannot be shipped again; a dead link discovered as an
 * import-time crash in CI never ships at all. Everything else remains plain
 * string builders, safe to call from a route handler or a test.
 */

import { VISUALIZATIONS } from '@/lib/visualizations'

export interface EmailContent {
  subject: string
  html: string
  text: string
}

const INK = '#1a1f2e'
const INK_SECONDARY = '#55607a'
// Exactly --q-violet-strong (light theme) from app/globals.css — the same
// color every `.btn-primary` on the site renders with. Email is light-mode
// fixed (see the file banner), so the light-theme value is the one to match;
// this used to be a close-but-not-exact #5647d4, which is the button reading
// as "almost the brand color" rather than as the brand color.
const VIOLET = '#5b47d6'
const LINE = '#e4e7ef'

/** Escape a value before it goes into HTML. Every interpolation goes through this. */
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function button(url: string, label: string): string {
  return (
    `<a href="${esc(url)}" style="display:inline-block;background:${VIOLET};color:#ffffff;` +
    `text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:8px;">` +
    `${esc(label)}</a>`
  )
}

/** The shared shell: light card, 560px, inline everything. */
function layout(headline: string, bodyHtml: string): string {
  return [
    '<!DOCTYPE html>',
    '<html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>${esc(headline)}</title></head>`,
    '<body style="margin:0;padding:24px 12px;background:#f4f5f9;">',
    `<div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid ${LINE};` +
      'border-radius:12px;padding:32px;font-family:-apple-system,BlinkMacSystemFont,' +
      `"Segoe UI",Helvetica,Arial,sans-serif;color:${INK};font-size:16px;line-height:1.6;">`,
    // Same wordmark treatment as the site header (components/ui/SiteNav.tsx):
    // bold "Qubit", the "16" in the brand violet — not a generic gray eyebrow
    // label, so the one piece of chrome every template shares actually reads
    // as the logo rather than as boilerplate.
    `<p style="margin:0 0 10px;font-size:15px;font-weight:700;letter-spacing:-0.01em;color:${INK};">` +
      `Qubit<span style="color:${VIOLET};">16</span></p>`,
    `<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:${INK};">${esc(headline)}</h1>`,
    bodyHtml,
    `<p style="margin:28px 0 0;padding-top:16px;border-top:1px solid ${LINE};font-size:13px;color:${INK_SECONDARY};">` +
      'Qubit16 — an interactive quantum mechanics learning platform.</p>',
    '</div></body></html>',
  ].join('')
}

function para(text: string): string {
  return `<p style="margin:0 0 14px;color:${INK};">${esc(text)}</p>`
}

function muted(text: string): string {
  return `<p style="margin:16px 0 0;font-size:13px;color:${INK_SECONDARY};">${esc(text)}</p>`
}

// ── org invite ────────────────────────────────────────────────

export function orgInvite(input: {
  orgName: string
  inviterEmail: string
  role: string
  acceptUrl: string
  expiresInDays: number
}): EmailContent {
  const { orgName, inviterEmail, role, acceptUrl, expiresInDays } = input
  const subject = `${inviterEmail} invited you to ${orgName} on Qubit16`

  const html = layout(`Join ${orgName} on Qubit16`, [
    para(`${inviterEmail} has invited you to join ${orgName} as a ${role}.`),
    para(
      'Qubit16 is a hands-on quantum computing course: a circuit simulator, ' +
        'interactive visualizations, and a tutor that works through the maths with you.'
    ),
    `<p style="margin:22px 0;">${button(acceptUrl, 'Accept the invitation')}</p>`,
    muted(`This invitation expires in ${expiresInDays} days.`),
    muted(`If the button does not work, paste this link into your browser: ${acceptUrl}`),
  ].join(''))

  const text = [
    `Join ${orgName} on Qubit16`,
    '',
    `${inviterEmail} has invited you to join ${orgName} as a ${role}.`,
    '',
    'Accept the invitation:',
    acceptUrl,
    '',
    `This invitation expires in ${expiresInDays} days.`,
    '',
    'Qubit16 — an interactive quantum mechanics learning platform.',
  ].join('\n')

  return { subject, html, text }
}

// ── magic link ────────────────────────────────────────────────

export function magicLink(input: { url: string; expiresInMinutes: number }): EmailContent {
  const { url, expiresInMinutes } = input
  const subject = 'Your Qubit16 sign-in link'

  const html = layout('Sign in to Qubit16', [
    para('Use the link below to sign in. It works once, and only from this message.'),
    `<p style="margin:22px 0;">${button(url, 'Sign in')}</p>`,
    muted(`The link expires in ${expiresInMinutes} minutes.`),
    muted('If you did not ask to sign in, you can ignore this email — nothing will happen.'),
    muted(`If the button does not work, paste this link into your browser: ${url}`),
  ].join(''))

  const text = [
    'Sign in to Qubit16',
    '',
    'Use this link to sign in:',
    url,
    '',
    `It expires in ${expiresInMinutes} minutes and works once.`,
    'If you did not ask to sign in, ignore this email.',
  ].join('\n')

  return { subject, html, text }
}

// ── welcome ───────────────────────────────────────────────────

export function welcome(input: { name: string }): EmailContent {
  const { name } = input
  const subject = 'Welcome to Qubit16'

  const html = layout(`Welcome, ${name}`, [
    para('Your account is ready. Two good places to start:'),
    `<ul style="margin:0 0 14px;padding-left:20px;color:${INK};">` +
      '<li style="margin-bottom:6px;">The course — ten lessons, each with a lab you run in the browser.</li>' +
      '<li>The simulator — build a circuit, run some shots, watch the state vector move.</li>' +
      '</ul>',
    para(
      'Everything computes locally in your browser, so you can work through the whole ' +
        'course offline if you want to.'
    ),
  ].join(''))

  const text = [
    `Welcome, ${name}`,
    '',
    'Your Qubit16 account is ready. Two good places to start:',
    '',
    '- The course: ten lessons, each with a lab you run in the browser.',
    '- The simulator: build a circuit, run some shots, watch the state vector move.',
    '',
    'Everything computes locally in your browser, so the course works offline too.',
  ].join('\n')

  return { subject, html, text }
}

// ── confirm subscription (double opt-in for the email course) ─

/**
 * The confirm mail for the 7-day course signup. Clicking the button is the
 * consent event: until then the row in `email_subscriptions` proves only that
 * SOMEBODY typed this address into a form.
 *
 * MAIL-1 rule, followed exactly: both URLs here MUST be built by the server
 * from this app's own origin (APP_URL) — never taken from the request body,
 * never from a caller-supplied field of any name. The subscribe route does
 * that; this function trusts its caller the same way the other templates do,
 * which is why it must never gain a caller-reachable path that skips the
 * route. A caller-supplied URL behind a "Confirm" button in a DKIM-signed
 * mail from this domain is the exact phishing relay MAIL-1 closed.
 *
 * The unsubscribe link is in the very first mail, before any course mail
 * exists to unsubscribe from, because "I never want to hear about this again"
 * is a decision the recipient is entitled to make at any point — including
 * immediately.
 */
export function confirmSubscription(input: {
  confirmUrl: string
  unsubscribeUrl: string
}): EmailContent {
  const { confirmUrl, unsubscribeUrl } = input
  const subject = 'Confirm your signup: the 7-day Qubit16 email course'

  const html = layout('One click to confirm', [
    para(
      'Someone — hopefully you — asked to receive the 7-day Qubit16 email ' +
        'course at this address. Nothing will be sent unless you confirm.'
    ),
    `<p style="margin:22px 0;">${button(confirmUrl, 'Confirm my signup')}</p>`,
    muted('If you did not ask for this, ignore this email — nothing will be sent, ever.'),
    muted(`If the button does not work, paste this link into your browser: ${confirmUrl}`),
    muted(`Never want to hear about this again? One click: ${unsubscribeUrl}`),
  ].join(''))

  const text = [
    'One click to confirm',
    '',
    'Someone — hopefully you — asked to receive the 7-day Qubit16 email',
    'course at this address. Nothing will be sent unless you confirm:',
    '',
    confirmUrl,
    '',
    'If you did not ask for this, ignore this email — nothing will be sent, ever.',
    `Never want to hear about this again? One click: ${unsubscribeUrl}`,
  ].join('\n')

  return { subject, html, text }
}

// ── exam passed ───────────────────────────────────────────────

export function examPassed(input: {
  examTitle: string
  score: number
  certificateUrl: string
}): EmailContent {
  const { examTitle, score, certificateUrl } = input
  const subject = `You passed: ${examTitle}`

  const html = layout(`You passed ${examTitle}`, [
    para(`You scored ${score}%. Your certificate is ready.`),
    `<p style="margin:22px 0;">${button(certificateUrl, 'View your certificate')}</p>`,
    muted(`If the button does not work, paste this link into your browser: ${certificateUrl}`),
  ].join(''))

  const text = [
    `You passed ${examTitle}`,
    '',
    `You scored ${score}%. Your certificate is ready:`,
    certificateUrl,
  ].join('\n')

  return { subject, html, text }
}

// ── the 7-day course (Quantum in a Week) ──────────────────────
//
// Subjects and bodies are transcribed from the launch draft
// (the "quantum in a week" course plan) and its wiring notes are treated as binding:
//   • Plain text with ONE link per day (day 7 alone adds the /learn
//     hand-off its draft ends on). The HTML part exists because sendEmail
//     requires both parts, and it is the same words — no images, no web
//     fonts, no tracking pixel. docs/ANALYTICS.md promises learner data
//     never leaves the device; an email that phones home on open would make
//     that promise false.
//   • One-click unsubscribe IN THE HEADER — the first line of the text part
//     and the first element of the HTML part — not only in the footer.
//   • Every link is checked against the visualization catalogue (plus the
//     small set of non-visualization routes a course mail may use) at module
//     load; see assertCourseLinksResolve below.

export interface CourseDaySpec {
  day: number
  subject: string
  headline: string
  /** Body paragraphs before the link, in order. */
  paragraphs: readonly string[]
  /** The one link: an app-relative route, resolved against the base URL at send time. */
  linkPath: string
  linkLabel: string
  /** Paragraphs after the link (the "tomorrow" teaser). */
  after: readonly string[]
  /** Day 7 only: the hand-off into the full course. */
  extra?: { lead: string; path: string; label: string }
}

export const COURSE_EMAILS: readonly CourseDaySpec[] = [
  {
    day: 1,
    subject: 'You can run the double-slit experiment in about ten seconds',
    headline: 'Day 1 — The experiment that broke classical physics',
    paragraphs: [
      'Fire electrons at a wall with two slits. Not a beam — one electron at a time, so far apart that no two are ever in the apparatus together. Each one lands as a single dot. There is nothing wave-like about a dot.',
      'Let it run. The dots pile up into stripes.',
      'This is the part worth sitting with: the pattern is built out of individual particle impacts, but the shape of the pile is the shape of two overlapping waves. Nothing in classical physics lets a thing be sorted into stripes by a slit it did not go through.',
      'Then do the thing that makes it strange. Turn on the detector that tells you which slit each electron used. The stripes vanish. Not "become fuzzy" — vanish, replaced by two plain heaps. Turn it off and they come back.',
      'The point isn\'t that observation is magic. It\'s that the striped pattern and the answer to "which slit?" cannot both exist. You choose which one you get.',
    ],
    linkPath: '/visualizations/double-slit',
    linkLabel: 'Run it',
    after: ['Tomorrow: what the electron is doing between the source and the screen.'],
  },
  {
    day: 2,
    subject: 'The most common explanation of a qubit is wrong',
    headline: 'Day 2 — What a qubit actually is',
    paragraphs: [
      'You have probably read that a qubit is "0 and 1 at the same time". That sentence has done more damage to public understanding of quantum computing than any other.',
      'A qubit in superposition is in a definite state. It is just not either of the two states you were expecting. A compass needle pointing northeast is in a perfectly definite direction — it is not "north and east at the same time", and it isn\'t secretly one of them while you aren\'t looking. It is pointing northeast, which is a third thing.',
      'Written down: |ψ⟩ = α|0⟩ + β|1⟩. Those two numbers are amplitudes, not probabilities. They can be negative. They can be complex. Square the magnitude to get the odds of each outcome.',
      'That "can be negative" is the whole ball game, and it\'s why yesterday\'s stripes appeared. Probabilities only ever add up. Amplitudes can cancel.',
      'Today\'s simulation lets you set α and β and watch the measurement statistics. Set them so both outcomes are equally likely, then run a thousand shots and notice you cannot tell, from the statistics alone, which of several different states you prepared.',
    ],
    linkPath: '/visualizations/superposition',
    linkLabel: 'Run it',
    after: ['Tomorrow: the picture that makes the missing information visible.'],
  },
  {
    day: 3,
    subject: "Why yesterday's statistics couldn't tell two states apart",
    headline: 'Day 3 — Every possible qubit, on one globe',
    paragraphs: [
      'Yesterday you found two different states that produce identical measurement results. Today, the picture that shows what the statistics were missing.',
      'Every possible state of one qubit is a point on the surface of a sphere. |0⟩ at the north pole, |1⟩ at the south, and everything in between is superposition. The latitude sets the odds. The longitude — the phase — sets nothing at all about the odds, which is precisely why measurement statistics can\'t see it.',
      'So why care about a coordinate you can\'t measure? Because phase is what interferes. It\'s invisible on its own and decisive the moment two paths meet. Yesterday\'s amplitudes that cancel? That cancellation is a phase relationship. Day 1\'s stripes were phase, made visible by recombining two paths.',
      'Drag the vector around the equator. The probabilities do not move. Then apply a Hadamard and watch that invisible longitude turn into a visible difference.',
    ],
    linkPath: '/visualizations/bloch-sphere',
    linkLabel: 'Run it',
    after: ['Tomorrow: two qubits, and the strongest correlation the universe permits.'],
  },
  {
    day: 4,
    subject: 'What entanglement is, and what it definitely is not',
    headline: 'Day 4 — Entanglement, minus the mysticism',
    paragraphs: [
      'Two qubits, prepared together. Measure the first: you get 0 or 1, apparently at random. Measure the second: you get the same answer. Every time. However far apart they are.',
      'Here is the sentence that matters, and almost every popular article gets it wrong: this cannot be used to send a message. Alice\'s outcomes are random no matter what Bob does. She sees noise. Only when the two of them compare notes — over an ordinary channel, at ordinary speed — does the correlation appear. There is no faster-than-light anything here.',
      'What\'s genuinely strange isn\'t the correlation. Correlations are ordinary: two gloves in two boxes are correlated. It\'s that no assignment of definite properties to each glove, made when they were packed, can reproduce what quantum mechanics predicts and experiments confirm. The correlation is too strong for that. That\'s Bell\'s theorem, and it\'s the reason "they were secretly labelled all along" is not available as an explanation.',
      'In the simulation, measure one qubit and watch the other\'s Bloch vector collapse to a point. Then look at the entanglement entropy: exactly ln 2 for a Bell state, and zero the moment you break it.',
    ],
    linkPath: '/visualizations/entanglement',
    linkLabel: 'Run it',
    after: ['Tomorrow: a particle goes somewhere it does not have the energy to be.'],
  },
  {
    day: 5,
    subject: "This is why your phone's storage works",
    headline: 'Day 5 — Through the wall',
    paragraphs: [
      'Roll a ball at a hill it hasn\'t the energy to climb. It rolls back. Always.',
      'Fire a quantum particle at a barrier it hasn\'t the energy to cross, and sometimes it appears on the other side. Not often. Exponentially rarely as the barrier gets thicker. But not never.',
      'The bad explanation — the one you\'ll see everywhere — is that the particle "borrows energy" from somewhere. It doesn\'t. It emerges with exactly the energy it started with. Nothing is borrowed and nothing is repaid.',
      'What actually happens: inside the barrier the wavefunction stops oscillating and starts decaying. It gets smaller, but it does not reach zero at the far wall — so there is some left on the other side, and "some left" means a real chance of finding the particle there.',
      'This is not exotic. It is why flash memory holds your photos, how a scanning tunnelling microscope images single atoms, and why the Sun burns at all — protons in the core don\'t have enough energy to overcome their mutual repulsion, and fuse anyway.',
      'Drag the barrier width. Transmission collapses exponentially, exactly as e^(−2κw) says it should. The simulation reports the measured value beside the analytic estimate; they agree.',
    ],
    linkPath: '/visualizations/tunneling',
    linkLabel: 'Run it',
    after: ['Tomorrow: putting all of it to work.'],
  },
  {
    day: 6,
    subject: "Grover's algorithm, and why quantum speedups are narrower than advertised",
    headline: 'Day 6 — A computer that searches by cancelling',
    paragraphs: [
      'You have an unsorted list of a million items and one is marked. Classically you check them one at a time: half a million tries on average.',
      'Grover\'s algorithm finds it in about a thousand.',
      'Not by checking all million at once — that\'s the folk explanation and it\'s wrong. The trick is amplitude. Start with every possibility equally likely. Flip the sign of the marked one — invisible so far, since squaring hides the sign. Then reflect every amplitude about their average. The one you flipped is now further from average than the rest, so it grows and the others shrink. Repeat about √N times.',
      'Watch the bars in the simulation and you will see the crucial detail: you can over-rotate. Keep going past the optimum and the answer gets worse again. This is not a search that converges; it\'s a rotation you must stop at the right moment. Nothing in classical computing behaves like that.',
      'And note the speedup: √N, not exponential. Quadratic. A million to a thousand is worth having — it is not "tries everything simultaneously", and anyone who tells you quantum computers brute-force all possibilities at once is describing something that does not exist.',
    ],
    linkPath: '/visualizations/grover',
    linkLabel: 'Run it',
    after: ["Tomorrow: the reason you don't have one on your desk."],
  },
  {
    day: 7,
    subject: 'The honest state of quantum computing',
    headline: "Day 7 — Why you don't own one",
    paragraphs: [
      'Six days of things that work. Today, the thing that doesn\'t.',
      'A qubit holding a superposition is holding a phase relationship, and phase is fragile. A stray photon, a vibration, a fractionally warm wire — and the phase information leaks into the environment. It isn\'t destroyed; it\'s diluted into so many degrees of freedom that no measurement you can make will recover it. What\'s left behind behaves like an ordinary probabilistic bit. That is decoherence, and it\'s the entire engineering problem.',
      'Watch the Bloch vector in today\'s simulation: it doesn\'t jump to a pole. It spirals inward, off the surface, toward the centre. Off the surface means it is no longer a definite quantum state at all.',
      'Error correction exists, and it works, at a price: spread one logical qubit over many physical ones so an error can be detected and undone before it spreads. The current ratio is brutal — hundreds to thousands of physical qubits for one good logical one. That factor is why factoring a real RSA key is a machine of millions of qubits, and why "quantum computers will break encryption" is a sentence about the 2030s or 2040s, not about this year.',
      'None of which makes the field vapour. It makes it engineering — the specific, grindy kind, where the physics is settled and the fabrication is not.',
    ],
    linkPath: '/visualizations/decoherence',
    linkLabel: 'Run it',
    after: [],
    extra: {
      lead: 'Where to go next: the full course starts at the beginning and goes deeper, with a circuit simulator you can build in and quizzes that check whether the idea landed. It\'s free — the whole foundations track, permanently, no account.',
      path: '/learn',
      label: 'Start the full course',
    },
  },
] as const

/**
 * The routes a course email is allowed to point at: the visualization
 * catalogue (lib/visualizations.ts — the launch draft names this list as the
 * source of truth for the "Run it" links) plus the non-visualization pages a
 * course mail legitimately hands off to.
 */
export function knownCourseRoutes(): Set<string> {
  const routes = new Set<string>(VISUALIZATIONS.map((viz) => viz.href))
  routes.add('/learn')
  return routes
}

/**
 * Throws unless every link in every course email resolves to a real route.
 * Runs at module load (below), so a renamed visualization route breaks the
 * import — and therefore the build and every test that touches email —
 * instead of breaking in a subscriber's inbox where it cannot be recalled.
 */
export function assertCourseLinksResolve(specs: readonly CourseDaySpec[] = COURSE_EMAILS): void {
  const routes = knownCourseRoutes()
  for (const spec of specs) {
    for (const path of [spec.linkPath, spec.extra?.path].filter((p): p is string => Boolean(p))) {
      if (!routes.has(path)) {
        throw new Error(
          `Course email for day ${spec.day} links to ${path}, which is not a known route. ` +
            'Check lib/visualizations.ts — the link must match a real page before anything sends.'
        )
      }
    }
  }
  if (specs === COURSE_EMAILS && specs.length !== 7) {
    throw new Error(`The 7-day course has ${specs.length} emails.`)
  }
}

assertCourseLinksResolve()

/**
 * Render one course day. `baseUrl` and `unsubscribeUrl` are built by the
 * dispatch route from APP_URL and the stored subscription — the MAIL-1 rule
 * again: nothing caller-supplied ever reaches these strings, because the only
 * caller is an operator-authenticated batch job with no user input at all.
 *
 * The unsubscribe link is the FIRST line of both parts (the launch draft's
 * wiring note: "One-click unsubscribe in the header, not just the footer
 * link") and repeats in the footer with a sentence saying why the mail came.
 */
export function courseDayEmail(input: {
  day: number
  baseUrl: string
  unsubscribeUrl: string
}): EmailContent {
  const spec = COURSE_EMAILS.find((entry) => entry.day === input.day)
  if (!spec) throw new Error(`No course email exists for day ${input.day}.`)
  const base = input.baseUrl.replace(/\/+$/, '')
  const link = `${base}${spec.linkPath}`
  const extraLink = spec.extra ? `${base}${spec.extra.path}` : null
  const { unsubscribeUrl } = input

  const html = [
    '<!DOCTYPE html>',
    '<html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>${esc(spec.headline)}</title></head>`,
    '<body style="margin:0;padding:24px 12px;background:#f4f5f9;">',
    `<div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid ${LINE};` +
      'border-radius:12px;padding:32px;font-family:-apple-system,BlinkMacSystemFont,' +
      `"Segoe UI",Helvetica,Arial,sans-serif;color:${INK};font-size:16px;line-height:1.6;">`,
    // Header: unsubscribe first, before any content. One click, no confirm page maze.
    `<p style="margin:0 0 14px;font-size:12px;color:${INK_SECONDARY};">Quantum in a Week, ` +
      `day ${spec.day} of 7 · <a href="${esc(unsubscribeUrl)}" style="color:${INK_SECONDARY};">Unsubscribe</a></p>`,
    `<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:${INK};">${esc(spec.headline)}</h1>`,
    spec.paragraphs.map((text) => para(text)).join(''),
    `<p style="margin:22px 0;">${button(link, spec.linkLabel)}</p>`,
    muted(`If the button does not work, paste this link into your browser: ${link}`),
    spec.after.map((text) => muted(text)).join(''),
    spec.extra
      ? para(spec.extra.lead) +
        `<p style="margin:22px 0;">${button(extraLink as string, spec.extra.label)}</p>`
      : '',
    `<p style="margin:28px 0 0;padding-top:16px;border-top:1px solid ${LINE};font-size:13px;color:${INK_SECONDARY};">` +
      'You are receiving this because you confirmed a signup for the 7-day Qubit16 email course. ' +
      `<a href="${esc(unsubscribeUrl)}" style="color:${INK_SECONDARY};">Unsubscribe</a> any time — one click, effective immediately.</p>`,
    '</div></body></html>',
  ].join('')

  const text = [
    `Unsubscribe (one click): ${unsubscribeUrl}`,
    '',
    `Quantum in a Week — day ${spec.day} of 7`,
    spec.headline,
    '',
    spec.paragraphs.join('\n\n'),
    '',
    `${spec.linkLabel}: ${link}`,
    ...(spec.after.length > 0 ? ['', spec.after.join('\n\n')] : []),
    ...(spec.extra ? ['', spec.extra.lead, '', `${spec.extra.label}: ${extraLink}`] : []),
    '',
    '—',
    'You are receiving this because you confirmed a signup for the 7-day',
    `Qubit16 email course. Unsubscribe any time, one click: ${unsubscribeUrl}`,
  ].join('\n')

  return { subject: spec.subject, html, text }
}
