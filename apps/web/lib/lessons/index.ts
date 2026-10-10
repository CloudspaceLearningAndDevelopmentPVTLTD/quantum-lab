/**
 * lib/lessons/index.ts — LESSON METADATA. Client-safe, and it has to stay that
 * way.
 *
 * WHAT THIS MODULE IS FOR. It is imported from the global client graph:
 *
 *     app/layout.tsx → components/ui/SiteNav.tsx → components/search/
 *     CommandPalette.tsx → lib/search/corpus.ts → lib/lessons
 *
 * Anything reachable from there ships in the JavaScript of every page. Until
 * this split, `LESSONS` carried each lesson's `blocks` inline, so the whole
 * course — 152,364 bytes of lesson text as JSON, 68,707 of it the PAID advanced
 * track — was in that chunk. A bundler cannot drop a property of a reachable
 * object literal, so the server-side paywall on /learn/[slug] was withholding
 * from `curl` something the browser had already been handed. That is written up
 * in `lib/lessons/access.ts` and was the top open item in STATUS.md.
 *
 * The bodies now live in `lib/lessons/bodies/*` and are reachable only through
 * `lib/lessons/server.ts`. What remains here is 5,989 bytes of metadata plus a
 * structural outline per lesson (block kinds and quiz question ids, no text).
 *
 * RULES FOR EDITING THIS FILE:
 *   · Never import from `./bodies/*` or `./server` here. `bundle.test.ts` walks
 *     the import graph from every 'use client' module in the app and fails if
 *     any body module is reachable — it will catch it, but the point is not to
 *     make it necessary.
 *   · `blocks` here is an OUTLINE (see `LessonBlockOutline` in ./types). It has
 *     no prose by construction, and it must stay in step with the real bodies:
 *     `lessons.test.ts` asserts kind-for-kind and question-count equality.
 *   · Adding a lesson means adding metadata here AND a body in ./bodies. The
 *     same test fails if either half is missing.
 *
 * Teaching order is the order of these arrays, and prev/next navigation reads
 * it from TRACKS.
 */

import type { LessonMeta, Track } from './types'

/**
 * The Quantum Foundations course.
 *
 * Eight lessons, ordered so that each one only leans on ideas already built.
 * The teaching order is deliberate: a concrete picture first, then the
 * formalism that makes the picture precise, then a place to go play with it —
 * and, to close, the physical machine the formalism runs on.
 */
const FOUNDATION_META: LessonMeta[] = [
  {
    slug: 'what-is-a-qubit',
    title: 'What Is a Qubit?',
    subtitle:
      'A bit is a switch. A qubit is a direction. Getting that difference straight is most of the battle.',
    level: 'Beginner',
    minutes: 8,
    prerequisites: [],
    objectives: [
      'Describe what makes a qubit different from a classical bit',
      'Read a state written as α|0⟩ + β|1⟩ and say what each symbol means',
      'Explain why the amplitudes are not probabilities',
    ],
    blocks: [
      { kind: 'prose' },
      { kind: 'prose' },
      { kind: 'inline-check' },
      { kind: 'callout' },
      { kind: 'inline-check' },
      { kind: 'prose' },
      { kind: 'code' },
      { kind: 'embed' },
      { kind: 'keypoints' },
      { kind: 'quiz', questions: [{ id: 'q1' }, { id: 'q2' }, { id: 'q3' }] },
    ],
  },
  {
    slug: 'superposition-and-measurement',
    title: 'Superposition & Measurement',
    subtitle:
      'Measurement is not a passive reading. It is the most violent thing you can do to a quantum state.',
    level: 'Beginner',
    minutes: 10,
    prerequisites: ['what-is-a-qubit'],
    objectives: [
      'Apply the Born rule to predict measurement statistics',
      'Explain what collapse does to a state and why it is irreversible',
      'Distinguish a coherent superposition from a probabilistic mixture',
    ],
    blocks: [
      { kind: 'inline-check' },
      { kind: 'prose' },
      { kind: 'inline-check' },
      { kind: 'prose' },
      { kind: 'callout' },
      { kind: 'inline-check' },
      { kind: 'prose' },
      { kind: 'code' },
      { kind: 'embed' },
      { kind: 'keypoints' },
      { kind: 'quiz', questions: [{ id: 'q1' }, { id: 'q2' }, { id: 'q3' }] },
    ],
  },
  {
    slug: 'interference',
    title: 'Interference: Where the Power Comes From',
    subtitle:
      'Not "it tries every answer at once" — but "it arranges for the wrong answers to cancel".',
    level: 'Beginner',
    minutes: 10,
    prerequisites: ['superposition-and-measurement'],
    objectives: [
      'Show that applying H twice returns |0⟩ exactly, and explain why no coin can do that',
      'Trace how negative amplitudes cancel to make an outcome impossible',
      'Recognise the double slit and quantum algorithms as the same phenomenon',
    ],
    blocks: [
      { kind: 'inline-check' },
      { kind: 'prose' },
      { kind: 'prose' },
      { kind: 'inline-check' },
      { kind: 'callout' },
      { kind: 'inline-check' },
      { kind: 'prose' },
      { kind: 'code' },
      { kind: 'embed' },
      { kind: 'keypoints' },
      { kind: 'quiz', questions: [{ id: 'q1' }, { id: 'q2' }, { id: 'q3' }] },
    ],
  },
  {
    slug: 'tunneling',
    title: 'Quantum Tunneling',
    subtitle:
      'A particle with too little energy to climb the wall comes out the other side anyway — and nothing was borrowed to do it.',
    level: 'Intermediate',
    minutes: 12,
    prerequisites: ['superposition-and-measurement'],
    objectives: [
      'State the classical turning-point argument and identify exactly which step quantum mechanics breaks',
      'Explain why the Schrödinger equation gives exponentials rather than oscillations when E < V',
      'Use T ≈ 16(E/V)(1 − E/V)e^{−2κw} to predict how transmission responds to a thicker barrier',
      'Recognise tunnelling at work in STMs, flash memory, alpha decay and stellar fusion',
    ],
    blocks: [
      { kind: 'prose' },
      { kind: 'inline-check' },
      { kind: 'prose' },
      { kind: 'inline-check' },
      { kind: 'callout' },
      { kind: 'inline-check' },
      { kind: 'code' },
      { kind: 'embed' },
      { kind: 'prose' },
      { kind: 'prose' },
      { kind: 'keypoints' },
      { kind: 'quiz', questions: [{ id: 'q1' }, { id: 'q2' }, { id: 'q3' }] },
    ],
  },
  {
    slug: 'gates-and-circuits',
    title: 'Gates & Circuits',
    subtitle:
      'Every quantum gate is a rotation. Every circuit is a sequence of rotations you can read left to right.',
    level: 'Intermediate',
    minutes: 12,
    prerequisites: ['interference'],
    objectives: [
      'Explain why quantum gates must be unitary, and what that buys you',
      'Recognise X, Y, Z, H, S, T and the rotation gates by their action on the Bloch sphere',
      'Read a circuit diagram and say what "controlled" actually means',
    ],
    blocks: [
      { kind: 'inline-check' },
      { kind: 'prose' },
      { kind: 'inline-check' },
      { kind: 'prose' },
      { kind: 'inline-check' },
      { kind: 'prose' },
      { kind: 'callout' },
      { kind: 'code' },
      { kind: 'embed' },
      { kind: 'keypoints' },
      { kind: 'quiz', questions: [{ id: 'q1' }, { id: 'q2' }, { id: 'q3' }] },
    ],
  },
  {
    slug: 'entanglement',
    title: 'Entanglement',
    subtitle:
      'Two qubits with a definite joint state and no definite individual states. Nothing travels; the correlation was there all along — but it is not the correlation you think.',
    level: 'Intermediate',
    minutes: 12,
    prerequisites: ['gates-and-circuits'],
    objectives: [
      'Test whether a two-qubit state factors, and recognise the Bell states',
      'Explain how perfect correlation coexists with locally random marginals',
      'State why entanglement cannot be used to send a signal',
    ],
    blocks: [
      { kind: 'inline-check' },
      { kind: 'prose' },
      { kind: 'prose' },
      { kind: 'inline-check' },
      { kind: 'callout' },
      { kind: 'inline-check' },
      { kind: 'prose' },
      { kind: 'code' },
      { kind: 'embed' },
      { kind: 'keypoints' },
      { kind: 'quiz', questions: [{ id: 'q1' }, { id: 'q2' }, { id: 'q3' }] },
    ],
  },
  {
    slug: 'grover',
    title: 'Grover\'s Search',
    subtitle:
      'Find a needle in an unsorted haystack of N items in about √N steps — and understand exactly why it is √N and not something better.',
    level: 'Advanced',
    minutes: 15,
    prerequisites: ['entanglement'],
    objectives: [
      'State the unstructured search problem and its classical cost',
      'Describe the oracle as a sign flip and diffusion as a reflection about the mean',
      'Explain the √N iteration count, why overshooting hurts, and what this means for NP',
    ],
    blocks: [
      { kind: 'prose' },
      { kind: 'inline-check' },
      { kind: 'prose' },
      { kind: 'callout' },
      { kind: 'inline-check' },
      { kind: 'prose' },
      { kind: 'code' },
      { kind: 'embed' },
      { kind: 'inline-check' },
      { kind: 'prose' },
      { kind: 'keypoints' },
      { kind: 'quiz', questions: [{ id: 'q1' }, { id: 'q2' }, { id: 'q3' }] },
    ],
  },
  {
    slug: 'inside-a-quantum-computer',
    title: 'Inside a Quantum Computer',
    subtitle:
      'The qubit is a circuit you could see with the naked eye, the gates are microwave pulses, and the famous golden chandelier is not the computer — it is the refrigerator.',
    level: 'Intermediate',
    minutes: 12,
    prerequisites: ['gates-and-circuits'],
    objectives: [
      'Explain why a plain harmonic LC oscillator cannot be a qubit, and how the Josephson junction\'s anharmonicity fixes it',
      'Describe how a shaped resonant microwave pulse implements the rotation gates, and why RZ costs nothing',
      'Compute why a 5 GHz qubit demands millikelvin operation: hf/k_B ≈ 240 mK, and e^{−16} ≈ 10⁻⁷ at 15 mK',
      'Describe dispersive readout through a coupled resonator, and contrast the transmon with a trapped-ion qubit honestly',
    ],
    blocks: [
      { kind: 'prose' },
      { kind: 'inline-check' },
      { kind: 'prose' },
      { kind: 'prose' },
      { kind: 'inline-check' },
      { kind: 'prose' },
      { kind: 'callout' },
      { kind: 'prose' },
      { kind: 'code' },
      { kind: 'prose' },
      { kind: 'embed' },
      { kind: 'keypoints' },
      { kind: 'quiz', questions: [{ id: 'q1' }, { id: 'q2' }, { id: 'q3' }] },
    ],
  },
]

/**
 * The Advanced Quantum Computing track — the paid one.
 *
 * Six lessons that pick up where Quantum Foundations stops: the two algorithms
 * that made the field famous, the error-correction machinery any real machine
 * will need, the near-term variational methods people actually run today, the
 * cryptography story that pays for most of the funding, and the machine-learning
 * and optimisation stories that pay for most of the hype — assessed with the
 * same honesty.
 */
const ADVANCED_META: LessonMeta[] = [
  {
    slug: 'shor',
    title: 'Shor\'s Algorithm',
    subtitle:
      'Factoring is not the quantum part. Finding the period of a function is — and everything else is number theory you could do on a laptop.',
    level: 'Advanced',
    minutes: 18,
    prerequisites: ['grover'],
    objectives: [
      'Explain how factoring reduces to finding the period of a modular exponential',
      'Describe what the quantum Fourier transform reads off the phase ramp',
      'Recover the period from a measured value using continued fractions',
      'State honestly what breaking RSA would cost in physical qubits',
    ],
    blocks: [
      { kind: 'prose' },
      { kind: 'inline-check' },
      { kind: 'prose' },
      { kind: 'inline-check' },
      { kind: 'prose' },
      { kind: 'callout' },
      { kind: 'prose' },
      { kind: 'code' },
      { kind: 'embed' },
      { kind: 'inline-check' },
      { kind: 'prose' },
      { kind: 'keypoints' },
      { kind: 'quiz', questions: [{ id: 'q1' }, { id: 'q2' }, { id: 'q3' }] },
    ],
  },
  {
    slug: 'error-correction',
    title: 'Quantum Error Correction',
    subtitle:
      'You cannot copy a qubit, you cannot look at it to check it, and errors are continuous rather than discrete. Error correction works anyway, and how it dodges all three objections is the most beautiful construction in the field.',
    level: 'Advanced',
    minutes: 20,
    prerequisites: ['entanglement'],
    objectives: [
      'Explain why no-cloning does not rule out quantum error correction',
      'Correct a bit-flip with the three-qubit code and a syndrome measurement',
      'Describe how the Shor nine-qubit code handles phase errors too',
      'Distinguish physical from logical qubits and state what the threshold theorem promises',
    ],
    blocks: [
      { kind: 'prose' },
      { kind: 'inline-check' },
      { kind: 'prose' },
      { kind: 'callout' },
      { kind: 'inline-check' },
      { kind: 'prose' },
      { kind: 'code' },
      { kind: 'embed' },
      { kind: 'inline-check' },
      { kind: 'prose' },
      { kind: 'keypoints' },
      { kind: 'quiz', questions: [{ id: 'q1' }, { id: 'q2' }, { id: 'q3' }] },
    ],
  },
  {
    slug: 'vqe-and-nisq',
    title: 'NISQ Algorithms and VQE',
    subtitle:
      'What can you do with a few hundred noisy qubits and no error correction? The honest answer is "less than we hoped", and the reasons why are worth understanding precisely.',
    level: 'Advanced',
    minutes: 16,
    prerequisites: ['gates-and-circuits'],
    objectives: [
      'Define NISQ and explain why circuit depth is the binding constraint',
      'Apply the variational principle to turn ground-state search into optimisation',
      'Decompose a Hamiltonian into Pauli strings and estimate an expectation value',
      'Explain barren plateaus and why they threaten the whole variational programme',
    ],
    blocks: [
      { kind: 'prose' },
      { kind: 'inline-check' },
      { kind: 'prose' },
      { kind: 'prose' },
      { kind: 'callout' },
      { kind: 'code' },
      { kind: 'embed' },
      { kind: 'inline-check' },
      { kind: 'prose' },
      { kind: 'keypoints' },
      { kind: 'quiz', questions: [{ id: 'q1' }, { id: 'q2' }, { id: 'q3' }] },
    ],
  },
  {
    slug: 'quantum-cryptography',
    title: 'Quantum Cryptography',
    subtitle:
      'You cannot stop an eavesdropper from listening. You can make listening leave marks that physics guarantees you will find.',
    level: 'Advanced',
    minutes: 14,
    prerequisites: ['entanglement'],
    objectives: [
      'Walk through BB84 from photon transmission to a shared key',
      'Explain why eavesdropping is detectable rather than preventable',
      'Describe how E91 uses Bell inequality violation instead of basis choice',
      'State clearly what QKD does not solve, and why post-quantum cryptography is the practical answer',
    ],
    blocks: [
      { kind: 'prose' },
      { kind: 'inline-check' },
      { kind: 'prose' },
      { kind: 'embed' },
      { kind: 'callout' },
      { kind: 'prose' },
      { kind: 'code' },
      { kind: 'embed' },
      { kind: 'inline-check' },
      { kind: 'prose' },
      { kind: 'keypoints' },
      { kind: 'quiz', questions: [{ id: 'q1' }, { id: 'q2' }, { id: 'q3' }] },
    ],
  },
  {
    slug: 'quantum-machine-learning',
    title: 'Quantum Machine Learning',
    subtitle:
      'A parameterised circuit is a machine-learning model you train with a classical optimiser. Whether it is ever a *better* model is the most oversold open question in the field — here is what is actually known.',
    level: 'Advanced',
    minutes: 16,
    prerequisites: ['vqe-and-nisq'],
    objectives: [
      'Describe a variational quantum classifier as encoding, parameterised circuit and measurement — and say which classical piece does the training',
      'Compare angle and amplitude encoding, and explain why data encoding, not circuit power, dominates what the model can learn',
      'Explain why barren plateaus apply to QML circuits exactly as they do to VQE',
      'State honestly what quantum kernels are proven to do — and that no exponential advantage on classical data has been demonstrated',
    ],
    blocks: [
      { kind: 'prose' },
      { kind: 'inline-check' },
      { kind: 'prose' },
      { kind: 'prose' },
      { kind: 'callout' },
      { kind: 'code' },
      { kind: 'embed' },
      { kind: 'inline-check' },
      { kind: 'prose' },
      { kind: 'prose' },
      { kind: 'embed' },
      { kind: 'keypoints' },
      { kind: 'quiz', questions: [{ id: 'q1' }, { id: 'q2' }, { id: 'q3' }] },
    ],
  },
  {
    slug: 'qaoa-and-optimization',
    title: 'QAOA and Quantum Optimization',
    subtitle:
      'An alternating circuit that tilts a superposition toward good cuts of a graph. Whether it can ever beat classical optimisers is — honestly — still unknown, and knowing exactly why is the real lesson.',
    level: 'Advanced',
    minutes: 16,
    prerequisites: ['vqe-and-nisq'],
    objectives: [
      'State MaxCut and encode it as a diagonal cost Hamiltonian whose extreme eigenstate is a classical bit string',
      'Describe the alternating cost/mixer ansatz and what each of the two layers contributes',
      'Explain the p-depth trade-off: the fixed-p locality obstructions, the empty p → ∞ guarantee, and why NISQ noise caps p',
      'State honestly why quantum advantage in optimisation remains unproven as of 2026, and where QAOA genuinely might matter',
    ],
    blocks: [
      { kind: 'prose' },
      { kind: 'inline-check' },
      { kind: 'prose' },
      { kind: 'prose' },
      { kind: 'callout' },
      { kind: 'code' },
      { kind: 'embed' },
      { kind: 'inline-check' },
      { kind: 'prose' },
      { kind: 'prose' },
      { kind: 'keypoints' },
      { kind: 'quiz', questions: [{ id: 'q1' }, { id: 'q2' }, { id: 'q3' }] },
    ],
  },
  {
    slug: 'post-quantum-cryptography',
    title: 'Post-Quantum Cryptography',
    subtitle:
      'The migration away from RSA is already running in your browser. What replaced it, why lattices have no period for Shor to find, what it costs in bytes — and why "post-quantum" is a status, not a proof.',
    level: 'Advanced',
    minutes: 18,
    prerequisites: ['shor', 'quantum-cryptography'],
    objectives: [
      'State exactly which deployed cryptography Shor\'s algorithm breaks and which it only weakens, and why the difference is the shape of the migration',
      'Apply Mosca\'s inequality to decide whether data encrypted today is already exposed to a future quantum computer',
      'Explain why Learning With Errors resists both Gaussian elimination and Fourier sampling, and name the standards built on it',
      'Describe the two-wave migration — key exchange first, signatures and PKI second — with the byte costs and government deadlines that shape it',
    ],
    blocks: [
      { kind: 'prose' },
      { kind: 'inline-check' },
      { kind: 'prose' },
      { kind: 'callout' },
      { kind: 'prose' },
      { kind: 'code' },
      { kind: 'embed' },
      { kind: 'inline-check' },
      { kind: 'prose' },
      { kind: 'keypoints' },
      { kind: 'quiz', questions: [{ id: 'q1' }, { id: 'q2' }, { id: 'q3' }] },
    ],
  },
]

/**
 * Every lesson in the app, metadata only: the foundations eight, then the
 * advanced seven. `LESSONS[i].blocks` is an outline — to render a lesson you
 * need `getFullLesson` from `./server`, which only server code can call.
 */
export const LESSONS: LessonMeta[] = [...FOUNDATION_META, ...ADVANCED_META]

export const ADVANCED_TRACK: Track = {
  id: 'advanced',
  name: 'Advanced Quantum Computing',
  blurb:
    'Seven lessons past the foundations: the algorithm that threatens RSA, the error correction any real machine will need, the variational methods people actually run on today\'s hardware, the cryptography story that pays for most of the field, honest accounts of quantum machine learning and quantum optimisation — and the post-quantum migration that is already running in your browser.',
  lessonSlugs: ADVANCED_META.map((lesson) => lesson.slug),
}

export const TRACKS: Track[] = [
  {
    id: 'foundations',
    name: 'Quantum Foundations',
    blurb:
      'A guided path from "what is a qubit" to Grover\'s search — and then inside the machine itself. Eight lessons, each one building on the last, ending somewhere you can run the idea: a live simulation to pull apart, or, for the finale, real hardware.',
    lessonSlugs: FOUNDATION_META.map((lesson) => lesson.slug),
  },
  ADVANCED_TRACK,
]

/** Track order is the canonical lesson order used for prev/next navigation. */
const ORDERED_SLUGS: string[] = TRACKS.flatMap((track) => track.lessonSlugs)

export function allSlugs(): string[] {
  return [...ORDERED_SLUGS]
}

/**
 * Metadata for one lesson. This used to return the whole lesson including its
 * blocks; callers that need the body now ask `getFullLesson` in `./server`.
 * The rename is deliberate at the call sites that matter (the page and the
 * paid-content route), and everything else — nav, search, SEO, the coach —
 * only ever wanted the metadata.
 */
export function getLesson(slug: string): LessonMeta | undefined {
  return LESSONS.find((lesson) => lesson.slug === slug)
}

function indexOfSlug(slug: string): number {
  return ORDERED_SLUGS.indexOf(slug)
}

export function getNextLesson(slug: string): LessonMeta | undefined {
  const i = indexOfSlug(slug)
  if (i < 0 || i >= ORDERED_SLUGS.length - 1) return undefined
  return getLesson(ORDERED_SLUGS[i + 1])
}

export function getPrevLesson(slug: string): LessonMeta | undefined {
  const i = indexOfSlug(slug)
  if (i <= 0) return undefined
  return getLesson(ORDERED_SLUGS[i - 1])
}
