/**
 * Bodies of seven of the eight Quantum Foundations lessons (tunneling has its own module, as it always has).
 *
 * BODY ONLY. Metadata (title, level, minutes, objectives, track membership)
 * lives in `lib/lessons/index.ts`; this module holds the prose, code, callouts
 * and quiz questions, and is reachable only through `lib/lessons/server.ts`.
 * Importing it from a client component puts 67,208 bytes of lesson text
 * (measured as JSON, unminified) back into the browser bundle — the exact
 * defect the metadata/body split closed. `lib/lessons/bundle.test.ts` walks the
 * import graph from every 'use client' module and fails if that happens.
 *
 */

import type { LessonBody } from '../types'
import { TUNNELING_BODY } from './tunneling'

export const FOUNDATION_BODIES: LessonBody[] = [
  // ─────────────────────────────────────────────────────────────────────
  // 1. What Is a Qubit?
  // ─────────────────────────────────────────────────────────────────────
  {
    slug: 'what-is-a-qubit',

    blocks: [
      {
        kind: 'prose',
        title: 'Start with the thing you already know',
        paragraphs: [
          'A classical bit is a switch. It is up or it is down, 1 or 0, and there is nothing else to say about it. Every computer you have ever used is built out of billions of these switches, and the entire discipline of classical computing is the art of arranging them so that flipping them in the right order does something useful. The bit is a wonderfully austere object: to describe one completely, you need exactly one piece of information, the answer to a single yes-or-no question.',
          'A qubit is the physical system that replaces that switch — a single electron spin, the polarization of one photon, a superconducting circuit whose persistent current can be put in a superposition of the two circulation directions. And the first surprise is that describing one completely takes considerably more than a yes-or-no answer. A qubit still has two special states we agree to call |0⟩ and |1⟩, and if you measure it you will always get one of those two answers. But between measurements, the qubit is not obliged to be sitting in either one.',
          'The picture worth carrying around is this: a bit is a switch with two positions, and a qubit is an arrow that can point anywhere on the surface of a sphere. |0⟩ is the north pole. |1⟩ is the south pole. Everything else on that surface — the equator, the mid-latitudes, every point in between — is a legitimate state of the qubit that has no classical counterpart at all. That sphere has a name, the Bloch sphere, and it is the single most useful mental image in the subject.',
          'Note what has just happened to the accounting. To pin down a point on a sphere you need two continuous numbers, a latitude and a longitude. So one qubit, the smallest quantum system there is, already needs two real numbers to describe rather than one bit. This is where the sense that quantum systems are "bigger" than classical ones begins, and it is worth noticing that it starts at n = 1, before entanglement or interference or anything else exotic enters the story.',
        ],
      },
      {
        kind: 'prose',
        title: 'Writing the state down',
        paragraphs: [
          'The standard notation for a qubit state is α|0⟩ + β|1⟩. The angled bracket thing, |0⟩, is called a ket, and it is nothing more exotic than a label — a way of writing "the state we call zero" that is visually distinct from the ordinary number 0. The interesting content is in α and β, the two numbers out front. They are called amplitudes.',
          'Read the expression as a weighted sum, exactly the way you would read a recipe: this state is "α parts |0⟩ mixed with β parts |1⟩". The state 1·|0⟩ + 0·|1⟩ is just |0⟩ — pure north pole, and a measurement will return 0 every single time. The state 0·|0⟩ + 1·|1⟩ is |1⟩. And the state with α = β = 1/√2, which lands you on the equator, is the famous even superposition: measure it and you get 0 half the time and 1 half the time.',
          'The one rule the amplitudes must obey is normalization: |α|² + |β|² = 1. This is not a deep physical postulate so much as bookkeeping — it says the probabilities of all the possible outcomes add to one, which they had better. Geometrically it is exactly the statement that the arrow has length 1, which is what keeps it on the surface of the sphere rather than floating around inside it.',
          'So α and β control the two things that distinguish one qubit state from another: how the weight is split between |0⟩ and |1⟩, and the relative phase between them. The first of those determines the latitude on the Bloch sphere. The second determines the longitude, and it is the part with no classical analogue whatsoever.',
        ],
      },
      {
        kind: 'inline-check',
        id: 'c1',
        question:
          'A qubit sits in the state (|0⟩ + |1⟩)/√2. Which best describes it before you measure?',
        options: [
          { id: 'a', text: 'It is secretly |0⟩ or secretly |1⟩ — the state just records your ignorance of which' },
          { id: 'b', text: 'It is in a definite state of its own that is neither |0⟩ nor |1⟩' },
          { id: 'c', text: 'It flickers rapidly between |0⟩ and |1⟩, and measuring catches it mid-flicker' },
          { id: 'd', text: 'It holds both values at once, and both can be read out' },
        ],
        correctId: 'b',
        explanation:
          'The superposition is a state in its own right — a definite point on the equator of the Bloch sphere, a location as legitimate as either pole. The "secretly one or the other" reading (option A) makes experimental predictions that differ from quantum mechanics, and experiment comes down against it; the callout below says how seriously to take that. Options C and D each smuggle a classical picture back in — a flicker is still a definite value at every instant, and one measured qubit only ever yields one bit.',
      },
      {
        kind: 'callout',
        tone: 'warning',
        title: 'A superposition is not ignorance',
        body: 'The tempting reading of α|0⟩ + β|1⟩ is "the qubit is secretly 0 or secretly 1 and I just have not looked yet". That reading is wrong, and it is wrong in a way that experiment can detect — single-particle interference rules out the version where the qubit is a 50/50 classical mixture of a definite |0⟩ and a definite |1⟩, and Bell tests rule out any account in which the values are pre-assigned locally. The qubit in a superposition is not hiding a definite value from you. It is genuinely in a state that is neither 0 nor 1, a state that has properties (a definite value along a different measurement axis, for instance) that no secretly-definite bit could have.',
      },
      {
        kind: 'inline-check',
        id: 'c2',
        question:
          'So far: probabilities come from squaring amplitudes. Now suppose a process offers two indistinguishable routes to the same outcome, one contributing amplitude +1/√2 and one contributing −1/√2 — and quantum mechanics says to add the amplitudes first, then square. How often does that outcome occur?',
        options: [
          { id: 'a', text: 'Always — each route alone gives probability 1/2, and 1/2 + 1/2 = 1' },
          { id: 'b', text: 'Half the time — the two routes average out' },
          { id: 'c', text: 'Never — the amplitudes sum to zero, and 0² = 0' },
          { id: 'd', text: 'A quarter of the time — 1/2 × 1/2' },
        ],
        correctId: 'c',
        explanation:
          'Amplitudes add before you square: +1/√2 − 1/√2 = 0, so the probability is |0|² = 0 and the outcome never happens. Adding the probabilities instead (option A) predicts certainty — and certain versus impossible is the whole gap between classical and quantum reasoning. The section below builds everything on this one piece of arithmetic.',
      },
      {
        kind: 'prose',
        title: 'Why the amplitudes are not probabilities',
        paragraphs: [
          'Here is the crux of the whole lesson, and the thing most worth slowing down for. Amplitudes are not probabilities. Probabilities are real numbers between 0 and 1. Amplitudes are complex numbers, which means they can be negative, and they can carry a phase like 1/√2 · e^{iπ/4}.',
          'To get a probability out of an amplitude you take its squared magnitude: the chance of measuring 0 is |α|², and the chance of measuring 1 is |β|². This is called the Born rule, and it is the bridge between the mathematical state and anything you can actually observe in a lab. Note what the squaring does — it throws information away. The amplitudes +1/√2 and −1/√2 both square to 1/2, so both give a 50% probability, and no single measurement can ever tell them apart.',
          'And yet the sign matters enormously. Consider what happens if two paths lead to the same outcome, one contributing amplitude +1/√2 and one contributing −1/√2. Amplitudes for indistinguishable paths add before you square them. So the total amplitude is +1/√2 − 1/√2 = 0, and the probability of that outcome is 0 — it never happens. If you had been adding probabilities, as you would for a coin, you would have got 1/2 + 1/2 = 1 and concluded the outcome was certain. Certain versus impossible is not a subtle discrepancy.',
          'That cancellation is called destructive interference, and it is the entire reason quantum computers can outperform classical ones. Every quantum algorithm worth the name is an elaborate scheme for arranging amplitudes so that the wrong answers cancel each other out and the right one survives. If amplitudes were probabilities — if they were stuck being non-negative — nothing could ever cancel, and quantum computing would offer you nothing at all. The negative sign is not a mathematical inconvenience. It is the resource.',
        ],
      },
      {
        kind: 'code',
        language: 'python',
        code: `# A qubit state is just two complex numbers.
import numpy as np

zero = np.array([1, 0], dtype=complex)   # |0⟩
one  = np.array([0, 1], dtype=complex)   # |1⟩

# An even superposition: (|0⟩ + |1⟩)/√2
plus = (zero + one) / np.sqrt(2)

# ...and its sibling with a minus sign: (|0⟩ - |1⟩)/√2
minus = (zero - one) / np.sqrt(2)

def probabilities(state):
    """Born rule: probability = |amplitude|²."""
    return np.abs(state) ** 2

print(probabilities(plus))    # [0.5 0.5]
print(probabilities(minus))   # [0.5 0.5]  ← identical!

# The states are measurably different even though the
# measurement statistics in this basis are identical.
print(np.allclose(plus, minus))            # False
print(np.vdot(plus, minus))                # 0 — they are orthogonal`,
        caption:
          '|+⟩ and |−⟩ give identical measurement statistics yet are perfectly distinguishable states — in fact they are orthogonal, as different as |0⟩ and |1⟩ are. All of that difference lives in a sign the Born rule squares away.',
      },
      {
        kind: 'embed',
        href: '/visualizations/bloch-sphere',
        title: 'Bloch Sphere',
        blurb:
          'Drag the state vector around the sphere and watch α and β update in real time. Start at the north pole and move to the equator to see the probabilities shift; then travel around the equator, where the probabilities stay pinned at 50/50 while the phase — the part that will do all the work in later lessons — sweeps through a full turn.',
      },
      {
        kind: 'keypoints',
        points: [
          'A bit takes one of two values; a qubit is a unit-length arrow that can point anywhere on the Bloch sphere.',
          'The state α|0⟩ + β|1⟩ is a weighted sum, not a statement about a hidden value you have not looked at yet.',
          'Normalization |α|² + |β|² = 1 is the statement that the arrow has length 1.',
          'Amplitudes are complex; probabilities are their squared magnitudes (the Born rule).',
          'Squaring discards the sign and phase — but those are exactly what lets amplitudes cancel, and that cancellation is where quantum advantage comes from.',
        ],
      },
      {
        kind: 'quiz',
        questions: [
          {
            id: 'q1',
            prompt: 'A qubit is in the state (3/5)|0⟩ + (4/5)|1⟩. What is the probability of measuring 1?',
            options: [
              { id: 'a', text: '4/5 = 0.8' },
              { id: 'b', text: '16/25 = 0.64' },
              { id: 'c', text: '1/2 — measurement outcomes are always equally likely' },
              { id: 'd', text: '9/25 = 0.36' },
            ],
            correctId: 'b',
            explanation:
              'The Born rule says probability = |amplitude|², so P(1) = |4/5|² = 16/25 = 0.64. Reading 4/5 straight off as the probability is the single most common early mistake — it skips the squaring step. Sanity check the answer: P(0) = |3/5|² = 9/25 = 0.36, and 0.64 + 0.36 = 1, so the state is properly normalized.',
          },
          {
            id: 'q2',
            prompt:
              'Why does it matter that amplitudes can be negative, given that the Born rule squares away the sign anyway?',
            options: [
              { id: 'a', text: 'It does not matter — it is a mathematical convention with no physical consequence' },
              { id: 'b', text: 'Negative amplitudes correspond to negative probabilities, which encode uncertainty' },
              { id: 'c', text: 'Amplitudes for different paths to the same outcome add before squaring, so opposite signs can cancel' },
              { id: 'd', text: 'A negative amplitude means the qubit is rotating in the opposite direction' },
            ],
            correctId: 'c',
            explanation:
              'Amplitudes add, then you square. So a path contributing +1/√2 and a path contributing −1/√2 sum to zero, making that outcome impossible — even though each path alone would have given it 50% probability. Probabilities can never cancel this way because they are never negative. This is destructive interference, and every quantum speed-up is built from it. (Option B is a trap: probabilities are never negative; it is the amplitudes that carry the sign.)',
          },
          {
            id: 'q3',
            prompt: 'Which statement best describes a qubit in the state (|0⟩ + |1⟩)/√2?',
            options: [
              { id: 'a', text: 'It is really 0 or really 1, and the superposition just tracks our ignorance of which' },
              { id: 'b', text: 'It is in a genuinely new state, neither 0 nor 1, that yields each outcome half the time when measured' },
              { id: 'c', text: 'It rapidly oscillates between 0 and 1, and measurement catches it wherever it happens to be' },
              { id: 'd', text: 'It is 0 and 1 simultaneously in the sense that both values are stored and can both be read out' },
            ],
            correctId: 'b',
            explanation:
              'The superposition is a state in its own right — it sits on the equator of the Bloch sphere, a location as definite as the poles. Option A is the "secretly definite" reading — a classical 50/50 mixture of |0⟩ and |1⟩ — which interference experiments rule out (and Bell tests go further, ruling out any locally pre-assigned values). Option C imagines a fast classical flicker, which would still be a definite value at each instant and would never produce interference. Option D is the "parallel universes" slogan, and it fails on the readout: you get exactly one bit out of one qubit, no matter how the amplitudes are arranged.',
          },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────
  // 2. Superposition & Measurement
  //
  // The question-first flagship. Three 'inline-check' blocks sit at this
  // lesson's natural predict-before-you-look moments, each IMMEDIATELY BEFORE
  // the section that answers it (Brilliant's pattern; the renderer softly
  // gates the section on the check — see lib/lessons/inlineCheck.ts). The
  // end-of-lesson quiz deliberately stays: predicting first and being tested
  // later on the same idea is retrieval practice, not redundancy.
  // ─────────────────────────────────────────────────────────────────────
  {
    slug: 'superposition-and-measurement',

    blocks: [
      {
        kind: 'inline-check',
        id: 'c1',
        // 'recall': this is lesson 1's Born rule, warmed up before this
        // lesson restates it properly.
        framing: 'recall',
        question:
          'A qubit is prepared in the state (1/√3)|0⟩ + √(2/3)·|1⟩ and measured once in the computational basis. What is the probability the outcome is 1?',
        options: [
          { id: 'a', text: '√(2/3) ≈ 0.82 — the amplitude on |1⟩ is its probability' },
          { id: 'b', text: '2/3 — the squared magnitude of the amplitude on |1⟩' },
          { id: 'c', text: '1/2 — a superposition always yields each outcome equally often' },
          { id: 'd', text: 'Undefined — a single measurement has no meaningful probability' },
        ],
        correctId: 'b',
        explanation:
          'The Born rule: probability = |amplitude|². P(1) = |√(2/3)|² = 2/3, and P(0) = |1/√3|² = 1/3 — which sum to 1, so the state is properly normalized. Reading the amplitude straight off as a probability (option A) is the classic slip from lesson 1, and option C fails because outcomes are only 50/50 when the two magnitudes happen to be equal.',
      },
      {
        kind: 'prose',
        title: 'The Born rule, stated properly',
        paragraphs: [
          'You have already met the Born rule in passing: the probability of an outcome is the squared magnitude of its amplitude. It deserves a moment of attention, because it is the only place in quantum mechanics where probability enters at all. Everything else — how states evolve, how gates act, how systems combine — is perfectly deterministic. All of the randomness in the theory is concentrated in this single rule about what happens when you look.',
          'Concretely: given the state α|0⟩ + β|1⟩ and a measurement in the computational basis, you get outcome 0 with probability |α|² and outcome 1 with probability |β|². Nothing in the theory tells you which one you will get on any particular run. This is not the ordinary ignorance of a coin flip, where a sufficiently detailed model of the hand and the air would predict the result. As far as anyone has been able to establish, the individual outcome is not determined by anything at all.',
          'A useful discipline is to keep two objects strictly separate in your head: the state, which is a list of complex amplitudes and evolves smoothly and predictably, and the outcome, which is a single classical symbol that appears when you measure. The state is what the theory describes. The outcome is what your lab notebook records. Confusing the two is the source of an enormous amount of muddle.',
        ],
      },
      {
        kind: 'inline-check',
        id: 'c2',
        question:
          'You measure a qubit in the state (|0⟩ + |1⟩)/√2 and the outcome is 0. Immediately, you measure the same qubit again in the same basis. What do you expect?',
        options: [
          { id: 'a', text: '0 or 1 with equal probability — the state is still the same 50/50 superposition' },
          { id: 'b', text: '0 with certainty' },
          { id: 'c', text: '1 is now more likely — the 0 outcome has been used up' },
          { id: 'd', text: 'It alternates: having given 0, the qubit now gives 1, then 0 again' },
        ],
        correctId: 'b',
        explanation:
          'Measurement does not just report a value — it rewrites the state. After the outcome 0, the qubit is exactly |0⟩, with no |1⟩ component left, so every immediate re-measurement in that basis returns 0 with certainty. The 50/50 behaviour is gone because the state that produced it is gone. The section below unpacks this collapse rule and why it is the least reversible operation in physics.',
      },
      {
        kind: 'prose',
        title: 'Collapse: measurement rewrites the state',
        paragraphs: [
          'The second half of the measurement postulate is the part people find genuinely uncomfortable. Measuring does not merely reveal a value — it changes the state. If you measure α|0⟩ + β|1⟩ and get the outcome 0, then immediately afterwards the qubit is in the state |0⟩. Not "approximately |0⟩", not "|0⟩ plus a small residue of |1⟩". Exactly |0⟩. The β|1⟩ term is gone.',
          'You can verify this experimentally in the most direct way imaginable. Measure the same qubit again, right away. You get 0 again, with certainty. Measure it a thousand more times: 0 every time. The 50/50 behaviour has vanished, permanently, because the state that produced it no longer exists. This is why collapse is sometimes described as the least reversible operation in physics — every other quantum operation can be undone by running it backwards, but there is no gate you can apply to recover the superposition you destroyed.',
          'It follows that a single measurement of a single qubit tells you almost nothing. One run of a 50/50 superposition yields one bit. That bit is consistent with a state that was 50/50, or 60/40, or 90/10, or with a qubit that was simply |0⟩ all along. You cannot distinguish these from a single sample, and — critically — you cannot go back and take another sample from the same state, because you obliterated it.',
          'So the practical shape of every quantum experiment is: prepare, evolve, measure, record, and then throw the qubit away and start over. Thousands of times. What you are building is a histogram, and only the histogram carries the information you were after. This is why "shots" (or "repetitions") is the first parameter on every quantum computing API you will ever touch, and why a quantum program that runs once is a quantum program that has told you nothing.',
        ],
      },
      {
        kind: 'callout',
        tone: 'insight',
        title: 'You cannot read out the amplitudes',
        body: 'It is tempting to imagine a qubit as a way of storing two continuous numbers, α and β, in a single particle — infinite storage in one atom. The measurement postulate is precisely what forecloses that. One qubit measured gives you exactly one classical bit, and destroys the state in the process. The amplitudes are real and they genuinely influence what you observe, but they are not accessible: you can only ever infer them statistically, from many identically prepared copies. A quantum algorithm that ends with "and now read off the amplitude" is not an algorithm.',
      },
      {
        kind: 'inline-check',
        id: 'c3',
        question:
          'Box A emits the coherent superposition (|0⟩ + |1⟩)/√2 on every run. Box B flips a fair coin behind a curtain and emits |0⟩ or |1⟩. Measuring only in the computational basis, with as many shots as you like — can you tell the boxes apart?',
        options: [
          { id: 'a', text: 'Yes — Box A’s histogram drifts away from 50/50 once you take enough shots' },
          { id: 'b', text: 'Yes — Box A gives the same outcome every run; Box B is the random one' },
          { id: 'c', text: 'No — both give exactly 50/50 in that basis, no matter how many shots you take' },
          { id: 'd', text: 'No — because the two boxes emit physically identical states' },
        ],
        correctId: 'c',
        explanation:
          'In the computational basis the statistics are genuinely identical: |±1/√2|² = 1/2 from Box A, and a fair coin from Box B — 50/50 from both, forever, so no histogram in that basis can separate them. But option D overshoots: the states are NOT identical, and measuring in a different basis distinguishes them on essentially every run. How, exactly, is the point of the section below.',
      },
      {
        kind: 'prose',
        title: 'Superposition versus mixture — the idea that matters most',
        paragraphs: [
          'Here is the distinction that separates people who have understood this lesson from people who have not. Consider two boxes, each of which produces a qubit.',
          'Box A prepares the coherent superposition (|0⟩ + |1⟩)/√2 every single time. Same state, every run, no randomness in the preparation at all. Box B flips a fair coin behind a curtain and hands you |0⟩ on heads and |1⟩ on tails. Its output is a probabilistic mixture: a definite state each run, but you do not know which.',
          'Measure either box in the computational basis and you get 0 half the time and 1 half the time. The histograms are indistinguishable. No amount of measuring in that basis will ever separate them, and this is not a limitation of your apparatus — the statistics are genuinely identical.',
          'Now measure in a different basis. Apply a Hadamard gate first and then measure — equivalently, ask whether the state is |+⟩ = (|0⟩+|1⟩)/√2 or |−⟩ = (|0⟩−|1⟩)/√2. Box A gives |+⟩ with probability 1. Every single run. Because the coherent superposition is |+⟩, exactly, and measuring a state in a basis it already belongs to gives a certain answer. Box B, meanwhile, still gives 50/50: |0⟩ has an equal overlap with |+⟩ and |−⟩, and so does |1⟩, so whichever the coin chose, you get a coin flip out.',
          'Certain versus random. That is not a subtle difference, and it is entirely down to whether the two branches have a definite relative phase — whether they can interfere. The coherent superposition has one; the mixture does not, because there are no simultaneous branches to have a phase between. This is the operational meaning of the word coherence, and losing it is exactly what decoherence means: the environment sneaks a look, the definite phase between the branches is scrambled, and your superposition quietly degrades into a mixture. It still gives you 50/50 in the computational basis, so it looks fine if you are not paying attention — but the interference is gone, and with it the entire reason you built a quantum computer.',
        ],
      },
      {
        kind: 'code',
        language: 'python',
        code: `import numpy as np

H = np.array([[1, 1], [1, -1]], dtype=complex) / np.sqrt(2)
zero = np.array([1, 0], dtype=complex)
one  = np.array([0, 1], dtype=complex)

# Box A — a coherent superposition, as a state vector.
plus = (zero + one) / np.sqrt(2)

# Box B — a 50/50 mixture, which needs a density matrix to describe.
mixture = 0.5 * np.outer(zero, zero.conj()) + 0.5 * np.outer(one, one.conj())

def measure_probs_after_H(rho):
    rho_rotated = H @ rho @ H.conj().T
    return np.real(np.diag(rho_rotated))

rho_A = np.outer(plus, plus.conj())

print(np.real(np.diag(rho_A)))       # [0.5 0.5]  ← identical in Z basis
print(np.real(np.diag(mixture)))     # [0.5 0.5]

print(measure_probs_after_H(rho_A))   # [1. 0.]   ← certain
print(measure_probs_after_H(mixture)) # [0.5 0.5] ← still random

# Purity, Tr(ρ²), separates them with a single number:
print(np.real(np.trace(rho_A @ rho_A)))       # 1.0  — pure
print(np.real(np.trace(mixture @ mixture)))   # 0.5  — maximally mixed`,
        caption:
          'A superposition needs only a state vector; a mixture needs a density matrix. Identical in one basis, completely different in another — and purity, Tr(ρ²), tells them apart in one number.',
      },
      {
        kind: 'embed',
        href: '/visualizations/superposition',
        title: 'Superposition Lab',
        blurb:
          'Prepare a state, choose a measurement basis, and fire shots one at a time to watch a histogram assemble itself out of individual random outcomes. Then switch the source from a coherent superposition to a classical mixture and watch what changes — and, more instructively, what does not.',
      },
      {
        kind: 'keypoints',
        points: [
          'The Born rule is the only source of randomness in quantum mechanics; everything else evolves deterministically.',
          'Measurement collapses the state onto the outcome you got, irreversibly — measure again and you get the same answer forever.',
          'One measurement of one qubit yields one classical bit, so every experiment must be repeated over many shots to build a distribution.',
          'A coherent superposition and a probabilistic mixture give identical statistics in one basis and completely different statistics in another.',
          'A mixture can never interfere. Decoherence is precisely the process that turns your superpositions into mixtures.',
        ],
      },
      {
        kind: 'quiz',
        questions: [
          {
            id: 'q1',
            prompt:
              'You measure a qubit in state (|0⟩ + |1⟩)/√2 and get outcome 0. You immediately measure it again in the same basis. What do you get?',
            options: [
              { id: 'a', text: '0 or 1 with equal probability — the state is still a superposition' },
              { id: 'b', text: '0 with certainty — the first measurement collapsed the state to |0⟩' },
              { id: 'c', text: '1 with certainty — measurement flips the qubit to the other basis state' },
              { id: 'd', text: 'The result is undefined; a qubit can only be measured once' },
            ],
            correctId: 'b',
            explanation:
              'Collapse is real and it persists. After the first measurement the state is exactly |0⟩, with no |1⟩ component left, so every subsequent measurement in that basis returns 0 with certainty. This repeatability is not an extra assumption — it is the direct experimental signature of collapse, and it is why you must re-prepare the state from scratch to take another sample from the original distribution.',
          },
          {
            id: 'q2',
            prompt:
              'How can you experimentally distinguish (|0⟩ + |1⟩)/√2 from a source that emits |0⟩ or |1⟩ at random with equal probability?',
            options: [
              { id: 'a', text: 'You cannot — both give 50/50 statistics and are physically identical' },
              { id: 'b', text: 'Measure many times in the computational basis and compare the histograms carefully' },
              { id: 'c', text: 'Apply a Hadamard gate before measuring: the superposition gives 0 with certainty, the mixture stays 50/50' },
              { id: 'd', text: 'Measure the total energy of the source; superpositions carry more' },
            ],
            correctId: 'c',
            explanation:
              'Rotating the measurement basis is the whole trick. H maps (|0⟩+|1⟩)/√2 back to |0⟩ exactly, so the coherent superposition gives outcome 0 every time. The mixture is |0⟩ or |1⟩ on any given run, and H sends either of those to an even superposition, so it stays stubbornly 50/50. Option B fails because the computational-basis histograms are genuinely identical, no matter how many shots you take — more data will not help if you are asking the wrong question.',
          },
          {
            id: 'q3',
            prompt: 'Why does every quantum algorithm have to be run many times?',
            options: [
              { id: 'a', text: 'Because quantum hardware is noisy and repetition averages the noise away' },
              { id: 'b', text: 'Because one run yields a single classical outcome sampled from a distribution, and destroys the state' },
              { id: 'c', text: 'Because the amplitudes converge to their true values only after many runs' },
              { id: 'd', text: 'Because the qubits need time to warm up before results are reliable' },
            ],
            correctId: 'b',
            explanation:
              'This is a consequence of the measurement postulate itself, not of imperfect hardware — a flawless quantum computer would still need repeated shots. Each run gives you one sample from the output distribution and collapses the state, so the distribution can only be reconstructed statistically. Noise (option A) is a real and separate problem that also motivates repetition, but it is not the fundamental reason; even a perfect device gives you one bit per qubit per run.',
          },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────
  // 3. Interference
  // ─────────────────────────────────────────────────────────────────────
  {
    slug: 'interference',

    blocks: [
      {
        kind: 'inline-check',
        id: 'c1',
        question:
          'The Hadamard gate H turns |0⟩ into an even superposition: measure right after one H and you get 0 or 1, 50/50 — statistically a fair coin flip. Now start in |0⟩, apply H twice without measuring in between, then measure. What do you see?',
        options: [
          { id: 'a', text: '50/50 — randomizing twice is still random, exactly like flipping a fair coin twice' },
          { id: 'b', text: '0, every single time' },
          { id: 'c', text: '1, every single time' },
          { id: 'd', text: 'Mostly 0, with a small admixture of 1 that shrinks as the hardware improves' },
        ],
        correctId: 'b',
        explanation:
          'HH|0⟩ = |0⟩ exactly, so the outcome is 0 with certainty: the second H takes the random-looking intermediate state and interferes it back into a deterministic one. No arrangement of coins or dice can undo its own randomness this way, and option D concedes too much — the zero is exact in the theory, not an engineering approximation. The section below sets the puzzle up carefully, and the one after it does the two-line arithmetic.',
      },
      {
        kind: 'prose',
        title: 'A puzzle you can check by hand',
        paragraphs: [
          'The Hadamard gate, written H, takes |0⟩ to an even superposition of |0⟩ and |1⟩. Measure right after applying it and you get 0 half the time and 1 half the time. By every statistic you can gather at that point, H behaves exactly like a fair coin flip.',
          'Now do not measure. Apply H a second time, and only then measure. If H were really a coin flip, the answer is obvious: flipping a fair coin twice leaves you with a fair coin. You should still see 50/50.',
          'You see 0. One hundred percent of the time. Not approximately, not on average — every single shot, forever, to whatever precision your hardware allows. Two applications of a "randomizing" operation have produced a perfectly deterministic result, and undone the randomness of the first. There is no arrangement of coins, dice, or hidden variables that reproduces this. Something in the description of the intermediate state is carrying information that a probability distribution simply cannot hold.',
        ],
      },
      {
        kind: 'prose',
        title: 'Following the amplitudes',
        paragraphs: [
          'Work it through with the actual numbers and the mystery dissolves into arithmetic. H acts on the basis states like this: H|0⟩ = (|0⟩ + |1⟩)/√2, and H|1⟩ = (|0⟩ − |1⟩)/√2. Note the minus sign in the second line. That is the whole lesson, sitting right there.',
          'Start in |0⟩. After the first H you are in (|0⟩ + |1⟩)/√2. Now apply H again, term by term, using linearity: the |0⟩ half becomes (|0⟩ + |1⟩)/2, and the |1⟩ half becomes (|0⟩ − |1⟩)/2.',
          'Add them up and collect terms. The |0⟩ amplitude is 1/2 + 1/2 = 1. The |1⟩ amplitude is 1/2 − 1/2 = 0. So the final state is exactly |0⟩, and the probability of measuring 1 is zero. There were two routes to the outcome |1⟩ — via the intermediate |0⟩ and via the intermediate |1⟩ — each individually contributing amplitude 1/2, and they arrived with opposite signs and annihilated each other.',
          'Compare the coin. Two routes to "tails" at the end, each with probability 1/4 given the first flip, and probabilities are never negative, so they can only pile up: 1/4 + 1/4 = 1/2. Classical alternatives always add. Quantum alternatives add as amplitudes first, and amplitudes are signed, so alternatives can subtract. That is the entire structural difference between the two theories, and it fits on one line.',
        ],
      },
      {
        kind: 'inline-check',
        id: 'c2',
        question:
          'An n-qubit superposition really does carry 2ⁿ amplitudes, one per candidate answer. Suppose a circuit merely puts the register into a uniform superposition over all of them, and you measure. What do you get?',
        options: [
          { id: 'a', text: 'All 2ⁿ answers, in parallel' },
          { id: 'b', text: 'The correct answer — the computer had it in there somewhere' },
          { id: 'c', text: 'One n-bit outcome, sampled uniformly at random — no better than guessing' },
          { id: 'd', text: 'The 2ⁿ amplitudes themselves, read out as numbers' },
        ],
        correctId: 'c',
        explanation:
          'Measurement returns exactly one outcome, and for a uniform superposition it is a uniformly random one — a machine that only "tries everything at once" is an expensive random-number generator. Nor are the amplitudes readable (one qubit measured yields one bit, and the state collapses as it does). What rescues quantum computing is the step this lesson is about: interference, arranged so that wrong answers cancel before you ever measure. The callout below is the slogan, corrected.',
      },
      {
        kind: 'callout',
        tone: 'insight',
        title: 'The slogan to unlearn',
        body: 'Popular accounts say a quantum computer "tries all the answers at once". The first half is defensible — a superposition over n qubits really does carry 2ⁿ amplitudes. The problem is the readout: measurement gives you exactly one of those 2ⁿ answers, chosen at random, so a machine that merely tried everything in parallel would be no better than a machine that guessed. The useful slogan is the second half: a quantum algorithm spends its whole runtime arranging for the amplitudes of wrong answers to cancel, so that when you finally measure, the right answer is overwhelmingly likely. Superposition provides the raw material. Interference does the work.',
      },
      {
        kind: 'inline-check',
        id: 'c3',
        question:
          'Electrons are fired one at a time at a screen through a single open slit, and some land at a point P. You now open a second slit. What can happen to the rate at which electrons arrive at P?',
        options: [
          { id: 'a', text: 'It can only increase or stay the same — a second route can only add arrivals' },
          { id: 'b', text: 'It exactly doubles — twice the routes, twice the arrivals' },
          { id: 'c', text: 'It can drop — all the way to zero at some points' },
          { id: 'd', text: 'It fluctuates from run to run with no stable rate at all' },
        ],
        correctId: 'c',
        explanation:
          'Opening a second route adds an amplitude, not a probability — and where the two amplitudes arrive out of phase they cancel, so P can become a place electrons never land at all. Classically, option A is airtight: extra ways to arrive can only pile probability up. The dark fringes of the double slit are the experimental fact that quantum alternatives can subtract, and the section below walks through it.',
      },
      {
        kind: 'prose',
        title: 'The double slit is the same thing in a different costume',
        paragraphs: [
          'Fire electrons one at a time at a barrier with two slits, and let each one land on a screen behind. Each electron arrives as a single point — a discrete flash at a definite place, unmistakably a particle. But let thousands accumulate and the pile of points forms bands: bright stripes with completely dark gaps between them.',
          'The dark stripes are the interesting part. Those are places where an electron never lands. Close one slit and electrons land there happily; open both and they stop arriving. Opening a second route to a destination has made that destination unreachable. In any classical picture of particles travelling through one slit or the other, this is flatly impossible: adding an alternative path can only ever add probability.',
          'The quantum account is the H-twice calculation with the labels changed. Each point on the screen has two amplitudes reaching it, one per slit. The relative phase between them depends on the difference in path length. Where the two arrive in phase, they add and you get a bright band; where they arrive exactly out of phase, they cancel to zero and you get a dark one. Same mathematics, same signed addition, same cancellation.',
          'And the punchline is the one that made the experiment famous. Put a detector at the slits to find out which one each electron went through, and the bands disappear — you get two plain blobs, the classical result. Learning the path is not a passive act. It makes the two alternatives distinguishable, and distinguishable alternatives add as probabilities rather than amplitudes. This is exactly the superposition-versus-mixture distinction from the last lesson, appearing in the wild: which-path information turns a coherent superposition into a mixture, and mixtures do not interfere.',
        ],
      },
      {
        kind: 'code',
        language: 'python',
        code: `import numpy as np

H = np.array([[1, 1], [1, -1]], dtype=complex) / np.sqrt(2)
zero = np.array([1, 0], dtype=complex)

after_one = H @ zero
after_two = H @ after_one

print(np.abs(after_one) ** 2)   # [0.5 0.5] — looks like a fair coin
print(np.abs(after_two) ** 2)   # [1.  0. ] — but it is not one

# The classical analogue, for contrast: a stochastic "coin" matrix.
C = np.array([[0.5, 0.5], [0.5, 0.5]])
p = np.array([1.0, 0.0])
print(C @ C @ p)                # [0.5 0.5] — a coin stays a coin

# Where the cancellation happens, term by term:
#   route via |0⟩ :  (1/√2)·(+1/√2) = +1/2  toward |1⟩
#   route via |1⟩ :  (1/√2)·(-1/√2) = -1/2  toward |1⟩
#   total amplitude for |1⟩ = 0  →  probability 0
print(H[1, 0] * H[0, 0] + H[1, 1] * H[0, 1])   # 0j`,
        caption:
          'The same two-step process, once with amplitudes and once with probabilities. Only the signed version can cancel — and cancellation is the only thing that makes the outcomes differ.',
      },
      {
        kind: 'embed',
        href: '/visualizations/double-slit',
        title: 'Double-Slit Experiment',
        blurb:
          'Send particles through one at a time and watch the interference pattern build up from individual detections. Then switch on the which-path detector and watch the fringes wash out into two featureless blobs — the transition from superposition to mixture, happening in front of you.',
      },
      {
        kind: 'keypoints',
        points: [
          'H twice returns |0⟩ with certainty; no classical randomizing process can undo its own randomness this way.',
          'Two routes to the same outcome contributed +1/2 and −1/2, cancelling exactly.',
          'Classical alternatives add as probabilities and can only accumulate; quantum alternatives add as signed amplitudes and can subtract.',
          'The double slit is the same interference — dark fringes are outcomes cancelled to zero amplitude.',
          'Which-path information destroys interference by making the alternatives distinguishable, converting a superposition into a mixture.',
          'Quantum algorithms do not test every answer in parallel; they engineer destructive interference for the wrong ones.',
        ],
      },
      {
        kind: 'quiz',
        questions: [
          {
            id: 'q1',
            prompt:
              'Applying H to |0⟩ gives 50/50 statistics. Applying H twice gives 0 with certainty. Why can no classical coin reproduce this?',
            options: [
              { id: 'a', text: 'Because quantum gates operate faster than classical coin flips' },
              { id: 'b', text: 'Because probabilities are non-negative, so two routes to an outcome can only add, never cancel' },
              { id: 'c', text: 'Because the coin is affected by air resistance and other classical noise' },
              { id: 'd', text: 'Because a real coin is never perfectly fair' },
            ],
            correctId: 'b',
            explanation:
              'The two routes to |1⟩ carry amplitudes +1/2 and −1/2, which sum to zero. A classical process combines the two routes as probabilities, 1/4 + 1/4 = 1/2, and since probabilities can never be negative there is no way for contributions to destroy each other. This is a structural difference between the theories, not a matter of engineering quality or speed — a perfect, frictionless, exactly fair coin still cannot do it.',
          },
          {
            id: 'q2',
            prompt:
              'In a double-slit experiment, why do the interference fringes vanish when you install a detector that records which slit each particle passed through?',
            options: [
              { id: 'a', text: 'The detector physically blocks part of the beam, reducing the intensity' },
              { id: 'b', text: 'Which-path information makes the two paths distinguishable, so they combine as probabilities rather than amplitudes' },
              { id: 'c', text: 'The detector heats the particles, and hot particles do not interfere' },
              { id: 'd', text: 'Observation causes the particle to choose a slit before it arrives at the barrier' },
            ],
            correctId: 'b',
            explanation:
              'Interference requires indistinguishable alternatives. Once the environment (here, your detector) holds a record of which slit was taken, the two branches are no longer alternative routes to the same situation — they end in different total states, so their amplitudes never meet to cancel and you add probabilities instead. This is decoherence, and it is why the essential engineering problem in quantum computing is isolation: any stray coupling that leaks which-path information out into the world destroys the interference you were relying on.',
          },
          {
            id: 'q3',
            prompt: 'Which is the most accurate description of how quantum algorithms achieve a speed-up?',
            options: [
              { id: 'a', text: 'They evaluate every possible answer in parallel and return the best one' },
              { id: 'b', text: 'They run the same classical algorithm on much faster hardware' },
              { id: 'c', text: 'They use superposition to create many amplitudes, then interfere them so wrong answers cancel and right ones reinforce' },
              { id: 'd', text: 'They store exponentially more data in each qubit than a classical bit can hold' },
            ],
            correctId: 'c',
            explanation:
              'Superposition alone buys you nothing, because measurement returns just one outcome sampled at random — parallel evaluation with a random readout is no better than guessing. The speed-up comes from the interference step, where the algorithm arranges the phases so that amplitudes for wrong answers cancel. Option D is a common misreading: the amplitudes are numerous, but you cannot read them out (one qubit measured yields one bit), so they are not storage.',
          },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────
  // 4. Quantum Tunneling
  //
  // Sits here, after `interference` and before `gates-and-circuits`, because
  // interference teaches that amplitudes add and cancel and tunnelling is the
  // payoff: the wave is a real physical object with structure inside a region
  // the particle "cannot" enter. Keeping it here finishes the wave-mechanics
  // thread before the course shifts into the discrete, gate-based picture.
  // (Definition lives in ./tunneling.ts to keep this file navigable.)
  // ─────────────────────────────────────────────────────────────────────
  TUNNELING_BODY,

  // ─────────────────────────────────────────────────────────────────────
  // 5. Gates & Circuits
  // ─────────────────────────────────────────────────────────────────────
  {
    slug: 'gates-and-circuits',

    blocks: [
      {
        kind: 'inline-check',
        id: 'c1',
        question:
          'The classical AND gate maps two input bits to one output bit: inputs 00, 01 and 10 all give output 0. Can there be a quantum gate with that shape — two qubits in, one qubit out?',
        options: [
          { id: 'a', text: 'Yes — AND is basic logic, and a quantum computer must be able to run classical logic' },
          { id: 'b', text: 'No — a quantum gate must be reversible, and AND destroys the information needed to run it backwards' },
          { id: 'c', text: 'Yes, but only on qubits that are not in superposition' },
          { id: 'd', text: 'No — quantum gates cannot produce the output |0⟩' },
        ],
        correctId: 'b',
        explanation:
          'Given the output 0, AND cannot tell you which of three inputs produced it — it discards information, so no operation could undo it. Quantum gates turn out to be unitary, which forces every gate to have an inverse that is itself a legal gate; there is no two-in-one-out quantum AND. (Classical logic still runs on a quantum computer, but through reversible embeddings like the Toffoli gate, which carries its inputs along to the output.) The section below unpacks where the reversibility requirement comes from and what else it buys.',
      },
      {
        kind: 'prose',
        title: 'Unitary: reversible and length-preserving',
        paragraphs: [
          'Between preparation and measurement, a quantum state evolves by matrix multiplication, and the matrices are not arbitrary — they must be unitary. A matrix U is unitary when U†U = I, where U† is the conjugate transpose. Two consequences follow immediately, and they are the two things worth remembering.',
          'First, unitary operations preserve length. The normalization condition |α|² + |β|² = 1 has to hold at every instant, because those numbers are probabilities and probabilities must sum to one. A unitary matrix is exactly a matrix that maps unit vectors to unit vectors, so unitarity is the mathematical statement that the theory does not leak probability. Geometrically it means gates move the Bloch vector around the sphere without ever changing its length: every gate is a rotation.',
          'Second, unitary operations are reversible. U†U = I says U† undoes U, so every quantum gate has an inverse that is itself a legal quantum gate. This is a striking departure from classical logic. The classical AND gate takes two bits to one and is irreversible — given the output 0 you cannot recover which of three inputs produced it. There is no quantum AND gate of that shape. Every quantum circuit can be run backwards, and a quantum computation is in principle a perfectly reversible process right up until you measure.',
          'This is why measurement stands so far apart from everything else. Gates are unitary, deterministic, reversible. Measurement is none of those. The whole art of designing a quantum algorithm is choreographing a long reversible dance and then, at exactly the right moment, doing the one irreversible thing.',
        ],
      },
      {
        kind: 'inline-check',
        id: 'c2',
        framing: 'recall',
        question:
          'The Z gate leaves |0⟩ alone and multiplies the amplitude of |1⟩ by −1. You apply Z to a qubit and then measure in the computational basis. Compared with not applying Z at all, what changes in the outcome statistics?',
        options: [
          { id: 'a', text: 'Nothing — the Born rule squares away the sign, so the statistics are identical' },
          { id: 'b', text: 'The probabilities of 0 and 1 swap' },
          { id: 'c', text: 'The probability of 1 drops, because its amplitude was made negative' },
          { id: 'd', text: 'The outcome 1 becomes impossible' },
        ],
        correctId: 'a',
        explanation:
          'In this basis, nothing changes: |−β|² = |β|². This is lesson one again — the amplitudes +1/√2 and −1/√2 give identical statistics yet are orthogonal states. Z is invisible to a computational-basis measurement, and yet it is not a do-nothing gate: the sign it plants is exactly what a later interference step converts into a probability difference. The section below names the gates that live entirely in that invisible layer, including the one that makes the whole gate set universal.',
      },
      {
        kind: 'prose',
        title: 'The single-qubit gates worth knowing by name',
        paragraphs: [
          'The Pauli gates are the three half-turns about the three axes. X is the quantum NOT: it swaps |0⟩ and |1⟩, a 180° rotation about the x-axis. Z leaves |0⟩ alone and flips the sign of |1⟩ — it does nothing you can see in the computational basis, but it is a 180° rotation about the z-axis and it manipulates precisely the relative phase that drives interference. Y is the half-turn about the y-axis, equal to iXZ, a bit flip and a phase flip together.',
          'H, the Hadamard, is the one that moves between the two worlds. It maps the poles of the Bloch sphere to the equator and back: |0⟩ ↦ |+⟩, |1⟩ ↦ |−⟩, and because H² = I it is its own inverse. Nearly every algorithm opens with a layer of H gates to build the superposition and closes with another layer to interfere it back down into a readable answer.',
          'The phase gates are the finer instruments. S rotates by 90° about the z-axis, multiplying the |1⟩ amplitude by i; T rotates by 45°, multiplying by e^{iπ/4}. S is T² and Z is S². These look inconsequential — they never change a single measurement probability in the computational basis — but phase is the raw material of interference, and the T gate in particular is what lifts the gate set from classically simulable to universal. It is also, on real error-corrected hardware, by far the most expensive gate to implement, which is why algorithm papers report "T-count" as a headline cost.',
          'Underneath the named gates sit the continuous rotations RX(θ), RY(θ), RZ(θ), which turn the Bloch vector by an arbitrary angle θ about the corresponding axis. Every named single-qubit gate is one of these at a particular angle, and any single-qubit unitary at all can be written as three of them in sequence — the Euler decomposition. On real hardware these are usually what you actually get: a calibrated pulse of a given duration is an RX or RZ of a given angle, and the named gates are just convenient labels for common angles.',
        ],
      },
      {
        kind: 'inline-check',
        id: 'c3',
        question:
          'CNOT flips the target qubit when the control is |1⟩ and does nothing when it is |0⟩. Feed it a control in the superposition (|0⟩ + |1⟩)/√2 and a target in |0⟩. What comes out?',
        options: [
          { id: 'a', text: 'The gate cannot act until the control is measured and has a definite value' },
          { id: 'b', text: 'The target flips on a random half of the runs, as the gate checks the control' },
          { id: 'c', text: '(|00⟩ + |11⟩)/√2 — the gate acts in both branches, correlating the qubits' },
          { id: 'd', text: 'Control and target each end up in (|0⟩ + |1⟩)/√2, independently' },
        ],
        correctId: 'c',
        explanation:
          'Gates are linear, so CNOT acts on each branch of the superposition: the |0⟩ branch leaves the target alone (giving |00⟩), the |1⟩ branch flips it (giving |11⟩), and the output is (|00⟩ + |11⟩)/√2. Nothing was checked and nothing random happened — the gate is deterministic, and the state it produces cannot be written as one state per qubit. That failure to factor has a name, and it is the next lesson\'s entire subject. The section below works through why "controlled" is not an if-statement.',
      },
      {
        kind: 'prose',
        title: 'CNOT, and what "controlled" really means',
        paragraphs: [
          'One-qubit gates alone can never produce anything interesting, because they act on each qubit independently and can never correlate them. You need at least one two-qubit gate, and the workhorse is CNOT: controlled-NOT. It takes a control qubit and a target, and applies X to the target if the control is |1⟩ — leaving everything alone if the control is |0⟩.',
          'On basis states it is easy: |00⟩ ↦ |00⟩, |01⟩ ↦ |01⟩, |10⟩ ↦ |11⟩, |11⟩ ↦ |10⟩. If you stop there, CNOT looks like a plain classical conditional, and the word "controlled" sounds like an if-statement. But an if-statement needs to know whether its condition is true, and the control qubit need not have a truth value at all.',
          'That is the point, and it is worth stating carefully. Because gates are linear, CNOT acts on every branch of a superposition at once, and the linear extension of the definition is the actual definition. Feed it a control in (|0⟩ + |1⟩)/√2 with the target in |0⟩. The |0⟩ branch leaves the target alone, giving |00⟩; the |1⟩ branch flips it, giving |11⟩. The result is (|00⟩ + |11⟩)/√2 — a Bell state, and one that cannot be written as a state of the first qubit times a state of the second. The gate has not chosen a branch. It has correlated them, and produced entanglement out of a superposition. That is the subject of the next lesson.',
          'A last useful fact: this handful of gates is enough for everything. H, T, and CNOT form a universal gate set — any unitary on any number of qubits can be approximated to arbitrary precision by a circuit built from those three alone. So the whole apparatus reduces to a small vocabulary, applied in the right order.',
        ],
      },
      {
        kind: 'callout',
        tone: 'aside',
        title: 'How to read a circuit diagram',
        body: 'Each horizontal wire is one qubit, and time runs left to right — the leftmost gate happens first, which is the opposite of the order in the matrix product, where the first gate ends up rightmost. Boxes on a wire are single-qubit gates. A filled dot joined by a vertical line to another symbol means "controlled on this qubit": a dot connected to a ⊕ is a CNOT, a dot connected to a Z is a controlled-Z. The meter symbol at the right end is a measurement, and the double line coming out of it carries a classical bit rather than a quantum one.',
      },
      {
        kind: 'code',
        language: 'qasm',
        code: `OPENQASM 3;
include "stdgates.inc";

// Prepare a Bell state: (|00⟩ + |11⟩)/√2
qubit[2] q;
bit[2] c;

reset q;

h q[0];        // q0: |0⟩ → (|0⟩ + |1⟩)/√2
cx q[0], q[1]; // entangle: (|00⟩ + |11⟩)/√2

c[0] = measure q[0];
c[1] = measure q[1];

// Over many shots you see only "00" and "11", each ≈50%.
// "01" and "10" never appear — the two qubits are perfectly
// correlated, though each one alone looks like a fair coin.`,
        caption:
          'Two gates is the entire Bell-state preparation: one H to create a superposition, one CNOT to spread it across both qubits.',
      },
      {
        kind: 'embed',
        href: '/simulator',
        title: 'Circuit Simulator',
        blurb:
          'Build circuits by dragging gates onto the wires and watch the state vector update after every step. Try the Bell circuit above, then insert a Z between the H and the CNOT and see which measurement statistics change — and which stubbornly do not.',
      },
      {
        kind: 'keypoints',
        points: [
          'Gates are unitary: they preserve the norm (probabilities keep summing to 1) and are always reversible.',
          'Every single-qubit gate is a rotation of the Bloch sphere; X, Y, Z are half-turns about the three axes.',
          'H moves between poles and equator and is its own inverse; S and T are 90° and 45° z-rotations that touch phase only.',
          'RX, RY, RZ give arbitrary rotation angles, and three of them compose any single-qubit unitary.',
          'CNOT applies X to the target when the control is |1⟩ — and acts linearly on superposed controls, which is how entanglement is made.',
          'H, T and CNOT together are universal: any quantum computation can be built from these three.',
        ],
      },
      {
        kind: 'quiz',
        questions: [
          {
            id: 'q1',
            prompt: 'Why must every quantum gate be reversible?',
            options: [
              { id: 'a', text: 'To save energy — irreversible operations dissipate heat' },
              { id: 'b', text: 'Because gates are unitary, and U†U = I means U† always undoes U' },
              { id: 'c', text: 'Because quantum computers run algorithms backwards to verify results' },
              { id: 'd', text: 'It is a design convention that simplifies compilers, not a physical requirement' },
            ],
            correctId: 'b',
            explanation:
              'Reversibility falls straight out of unitarity, which is itself forced by the requirement that total probability stay equal to 1 throughout the evolution. Since U† is also a valid unitary, the inverse of any gate is itself a legal gate. This is why there is no quantum AND gate in the classical two-in-one-out shape: it would discard information and could not be undone. (Landauer\'s principle in option A links irreversibility to heat and is genuinely true, but it is a thermodynamic consequence, not the reason.)',
          },
          {
            id: 'q2',
            prompt: 'Apply CNOT with the control in (|0⟩ + |1⟩)/√2 and the target in |0⟩. What comes out?',
            options: [
              { id: 'a', text: '(|00⟩ + |11⟩)/√2 — an entangled Bell state' },
              { id: 'b', text: '(|00⟩ + |10⟩)/√2 — the target is unchanged because the control is not definitely 1' },
              { id: 'c', text: '|00⟩ or |11⟩ chosen at random, 50/50' },
              { id: 'd', text: '(|0⟩ + |1⟩)/√2 ⊗ (|0⟩ + |1⟩)/√2 — both qubits end up in superposition' },
            ],
            correctId: 'a',
            explanation:
              'Gates are linear, so CNOT acts on both branches at once: |00⟩ passes through untouched, |10⟩ becomes |11⟩, and the result is the superposition (|00⟩ + |11⟩)/√2. This state cannot be factored into a state of qubit 0 times a state of qubit 1 — it is entangled. Option C describes the measurement outcomes you would eventually see, but no randomness has occurred yet; the gate is deterministic and the state is a definite superposition until you measure it.',
          },
          {
            id: 'q3',
            prompt: 'The T gate never changes any measurement probability in the computational basis. Why is it indispensable?',
            options: [
              { id: 'a', text: 'It is not — T gates are an optimisation that circuits can do without' },
              { id: 'b', text: 'It slows the circuit down, giving other gates time to settle' },
              { id: 'c', text: 'It adjusts relative phase, which later interference converts into probability differences, and it makes the gate set universal' },
              { id: 'd', text: 'It corrects accumulated hardware errors on the qubit' },
            ],
            correctId: 'c',
            explanation:
              'Phase is invisible until you interfere, and then it is decisive: a phase applied now determines which amplitudes cancel when a later H brings the branches back together. Formally, Clifford gates alone (H, S, CNOT) are efficiently simulable on a classical computer by the Gottesman–Knill theorem; adding T is what makes the set universal and takes the circuit beyond classical reach. It is also the most expensive gate under error correction, which is why algorithm cost is often quoted as a T-count.',
          },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────
  // 6. Entanglement
  // ─────────────────────────────────────────────────────────────────────
  {
    slug: 'entanglement',

    blocks: [
      {
        kind: 'inline-check',
        id: 'c1',
        question:
          'Try to write the two-qubit state (|00⟩ + |11⟩)/√2 in the form (a|0⟩ + b|1⟩) ⊗ (c|0⟩ + d|1⟩) — a definite state for each qubit separately. Can it be done?',
        options: [
          { id: 'a', text: 'Yes: take a = b = c = d = 1/√2' },
          { id: 'b', text: 'Yes, but only if some of the coefficients carry complex phases' },
          { id: 'c', text: 'No — the equations the coefficients must satisfy contradict each other' },
          { id: 'd', text: 'Yes for this state, though some other two-qubit states cannot be factored' },
        ],
        correctId: 'c',
        explanation:
          'Expanding the product gives ac|00⟩ + ad|01⟩ + bc|10⟩ + bd|11⟩. Matching the target needs ad = 0 and bc = 0 while ac and bd are both 1/√2 — which requires all four coefficients to be non-zero. Contradiction; no factorization exists, with or without phases. (Option A actually produces (|00⟩+|01⟩+|10⟩+|11⟩)/2, which factors just fine and is not this state.) A joint state with no per-qubit description is what "entangled" means, and the section below sits with how strange that is.',
      },
      {
        kind: 'prose',
        title: 'A state that will not factor',
        paragraphs: [
          'Two qubits have four basis states — |00⟩, |01⟩, |10⟩, |11⟩ — so a general two-qubit state carries four amplitudes. Some of those states are boring in a specific technical sense: they can be written as a state of the first qubit tensored with a state of the second. For example (|00⟩ + |01⟩)/√2 factors neatly into |0⟩ ⊗ (|0⟩ + |1⟩)/√2. Qubit 0 is definitely |0⟩; qubit 1 is definitely in a superposition; each has its own complete description. These are called product states, and they hold no surprises.',
          'Now try to factor the Bell state (|00⟩ + |11⟩)/√2. Suppose it equalled (a|0⟩ + b|1⟩) ⊗ (c|0⟩ + d|1⟩). Expanding gives ac|00⟩ + ad|01⟩ + bc|10⟩ + bd|11⟩. Matching coefficients, you need ad = 0 and bc = 0, but also ac = 1/√2 and bd = 1/√2, which requires all four of a, b, c, d to be non-zero. The requirements contradict each other. No such factorization exists.',
          'That failure is the definition of entanglement, and it is worth appreciating how strange it is. The two-qubit system has a complete, definite description — the state (|00⟩ + |11⟩)/√2 is fully specified, with no missing information whatsoever. But neither individual qubit has a state of its own. All of the information lives in the relationship. This is genuinely alien to classical physics, where a complete description of a composite system always contains a complete description of each part.',
          'There are four maximally entangled two-qubit states, the Bell basis: (|00⟩ ± |11⟩)/√2 and (|01⟩ ± |10⟩)/√2. They are mutually orthogonal, so together they form a perfectly good basis for two qubits — one in which every basis state is maximally entangled, and no basis state assigns a definite value to either qubit alone.',
        ],
      },
      {
        kind: 'prose',
        title: 'Perfectly correlated, individually random',
        paragraphs: [
          'Take the Bell state (|00⟩ + |11⟩)/√2 and give one qubit to Alice and one to Bob, who then walk to opposite ends of the building, or the planet.',
          'Alice measures hers. She gets 0 half the time and 1 half the time, and no pattern will ever emerge from her record no matter how many runs she does — it is an unimpeachably random bit stream. The technical statement is that her reduced density matrix, obtained by tracing out Bob\'s qubit, is the maximally mixed state I/2, which is the most uninformative state a qubit can be in. Bob\'s data, looked at alone, is exactly the same: pure noise.',
          'But bring the two records together and compare them shot by shot, and they match perfectly. Every single run. Alice got 0 precisely when Bob got 0. Two streams of perfect randomness that agree completely — that is the signature of entanglement, and it is only visible in the joint data.',
          'The obvious explanation is that the qubits agreed in advance: the pair left the source already carrying instructions, "we are both 0 this time", like a pair of gloves in separate boxes. For this particular measurement, that explanation works fine. What kills it is measuring along other axes. Bell showed in 1964 that if Alice and Bob each choose randomly between several measurement directions, any pre-agreed instruction set obeys an inequality that quantum mechanics violates — and experiments from Aspect in 1982 through the loophole-free tests of 2015 come out on the quantum side, decisively. The correlations are real, and they are stronger than any shared plan could produce.',
        ],
      },
      {
        kind: 'inline-check',
        id: 'c2',
        question:
          'Alice and Bob share the Bell pair (|00⟩ + |11⟩)/√2 from opposite ends of the planet. Alice measures her qubit and gets 0. Before any message can reach Bob, what changes in the statistics he can observe on his qubit?',
        options: [
          { id: 'a', text: 'His qubit now gives 0 with certainty — Alice’s measurement forced it' },
          { id: 'b', text: 'Nothing whatsoever — every local statistic Bob can gather is unchanged' },
          { id: 'c', text: 'His outcomes shift from 50/50 toward 0, by an amount set by the distance' },
          { id: 'd', text: 'His qubit becomes unmeasurable until the pair is re-prepared' },
        ],
        correctId: 'b',
        explanation:
          'Bob’s reduced state is the maximally mixed I/2 before Alice acts and I/2 afterwards: averaged over her two equally likely outcomes, his statistics are untouched — whatever she measures, and whether she measures at all. Option A is the seductive one: it is true that conditioned on Alice’s result Bob’s qubit is definite, but Bob does not have her result, and no experiment of his can reveal that she acted. That is the no-communication theorem, and the callout below states it precisely.',
      },
      {
        kind: 'callout',
        tone: 'warning',
        title: 'Measuring one qubit does not send anything to the other',
        body: 'The popular framing is that Alice\'s measurement "instantly forces" Bob\'s qubit into a matching state. Here is why that cannot be a physical influence: Bob\'s outcome statistics are 50/50 whatever Alice does — whether she measures, what basis she picks, whether she measured at all. Nothing in Bob\'s data changes. He cannot tell from any amount of local experimentation whether Alice has acted, so no information reaches him. This is the no-communication theorem, and it is a rigorous consequence of the formalism, not a hopeful gloss. The correlation only becomes visible when the two data sets are physically brought together and compared — which requires an ordinary classical channel, running at or below light speed. Entanglement cannot carry a message on its own.',
      },
      {
        kind: 'inline-check',
        id: 'c3',
        question:
          'The Bell pair’s joint state is pure: the two-qubit system is completely specified, with nothing about it unknown. How much can be known about one of its qubits on its own?',
        options: [
          { id: 'a', text: 'Everything — knowing the whole exactly means knowing each part exactly, as in classical physics' },
          { id: 'b', text: 'Nothing at all — each qubit alone is as random as a qubit can be' },
          { id: 'c', text: 'Exactly half of what there is to know, split evenly between the two' },
          { id: 'd', text: 'It depends on which basis the qubit is eventually measured in' },
        ],
        correctId: 'b',
        explanation:
          'Each qubit’s reduced state is I/2 — maximally mixed, the most uninformative state a single qubit can be in, in every basis at once (which is why option D fails). Classically, option A is a theorem: a complete description of a composite system contains a complete description of its parts. Here it fails completely, and that failure is the sharpest formal statement of entanglement — all of the information lives in the correlation, none of it in the parts. The section below turns this into a number, the entanglement entropy.',
      },
      {
        kind: 'prose',
        title: 'Measuring how entangled a state is',
        paragraphs: [
          'Entanglement is not binary. States range from fully separable to maximally entangled, with a continuum in between, and the standard measure for a pure bipartite state is the entanglement entropy: take the reduced density matrix of one half, ρ_A = Tr_B(|ψ⟩⟨ψ|), and compute its von Neumann entropy S = −Tr(ρ_A log₂ ρ_A).',
          'For a product state, ρ_A is a pure state and S = 0 — no entanglement. For the Bell state, ρ_A = I/2 and S = 1 bit, the maximum for a single qubit. The interpretation is neat and memorable: the entropy measures how much information about the whole is missing from the part. Zero means the part tells you everything; one full bit means the part tells you nothing at all.',
          'There is a paradox lurking here that is worth savouring. The joint state |ψ⟩ is pure — entropy zero, maximal knowledge, nothing unknown about the system as a whole. Yet each subsystem has entropy 1, maximal ignorance. Classically this is impossible: if you know everything about a composite system, you know everything about its parts. Quantum mechanically it is routine, and it is the sharpest formal statement of what entanglement is.',
          'This quantity turns out to matter well beyond foundations. It is the reason classical simulation of quantum systems is hard — tensor-network methods such as MPS simulate low-entanglement states efficiently and choke exactly when the entanglement entropy grows. It appears in condensed matter as the "area law" that characterises ground states, and in quantum gravity through the Ryu–Takayanagi correspondence, where entanglement entropy in a boundary theory is computed by the area of a surface in the bulk. One number, doing a remarkable amount of work.',
        ],
      },
      {
        kind: 'code',
        language: 'python',
        code: `import numpy as np

bell = np.array([1, 0, 0, 1], dtype=complex) / np.sqrt(2)   # (|00⟩+|11⟩)/√2

def reduced_density_matrix(psi):
    """Trace out qubit B from a 2-qubit pure state."""
    m = psi.reshape(2, 2)          # index [a, b]
    return m @ m.conj().T          # ρ_A

def entanglement_entropy(psi):
    evals = np.linalg.eigvalsh(reduced_density_matrix(psi))
    evals = evals[evals > 1e-12]
    return float(-np.sum(evals * np.log2(evals)))

print(reduced_density_matrix(bell))   # [[0.5 0] [0 0.5]] — maximally mixed
print(entanglement_entropy(bell))     # 1.0 bit — maximally entangled

product = np.kron([1, 0], [1, 1] / np.sqrt(2))   # |0⟩ ⊗ |+⟩
print(entanglement_entropy(product))  # 0.0 — no entanglement

# The whole is pure, the parts are not:
rho = np.outer(bell, bell.conj())
print(np.real(np.trace(rho @ rho)))                       # 1.0 — pure
rho_A = reduced_density_matrix(bell)
print(np.real(np.trace(rho_A @ rho_A)))                   # 0.5 — mixed`,
        caption:
          'Complete knowledge of the pair, total ignorance of each member. Purity 1 for the joint state, 0.5 for each half — a combination with no classical counterpart.',
      },
      {
        kind: 'embed',
        href: '/visualizations/entanglement',
        title: 'Entanglement Lab',
        blurb:
          'Prepare Bell states, choose independent measurement axes for Alice and Bob, and watch the correlations rise and fall as you vary the angle between them. The lab also runs a CHSH test, so you can watch the classical bound of 2 be exceeded by real simulated data.',
      },
      {
        kind: 'keypoints',
        points: [
          'A state is entangled when it cannot be written as a tensor product of individual states.',
          'The Bell state (|00⟩ + |11⟩)/√2 is the canonical example — one of four mutually orthogonal Bell states.',
          'Each qubit alone is maximally mixed and looks perfectly random; the correlation only exists in the joint data.',
          'Bell inequality violations rule out any pre-agreed classical instruction set.',
          'No-communication: local statistics are unaffected by what the other party does, so no signal can be sent.',
          'Entanglement entropy S = −Tr(ρ_A log₂ ρ_A) quantifies it — 0 for product states, 1 bit for a Bell pair.',
        ],
      },
      {
        kind: 'quiz',
        questions: [
          {
            id: 'q1',
            prompt: 'Which of these two-qubit states is entangled?',
            options: [
              { id: 'a', text: '(|00⟩ + |01⟩)/√2' },
              { id: 'b', text: '(|01⟩ − |10⟩)/√2' },
              { id: 'c', text: '(|00⟩ + |01⟩ + |10⟩ + |11⟩)/2' },
              { id: 'd', text: '|11⟩' },
            ],
            correctId: 'b',
            explanation:
              'Option B is the singlet, a Bell state, and no factorization exists — matching coefficients forces a contradiction. The others all factor: A is |0⟩⊗(|0⟩+|1⟩)/√2, C is (|0⟩+|1⟩)/√2 ⊗ (|0⟩+|1⟩)/√2, and D is |1⟩⊗|1⟩. Option C is the instructive distractor: it has all four amplitudes non-zero and looks thoroughly mixed up, but every qubit still has its own definite state. Superposition across many basis states is not the same thing as entanglement.',
          },
          {
            id: 'q2',
            prompt:
              'Alice and Bob share a Bell pair. Alice measures her qubit. What changes in the statistics Bob observes on his?',
            options: [
              { id: 'a', text: 'Nothing — his outcomes remain 50/50 regardless of whether or how Alice measures' },
              { id: 'b', text: 'His qubit immediately becomes definite, so he now gets the same answer every time' },
              { id: 'c', text: 'His outcome distribution shifts to match Alice\'s result' },
              { id: 'd', text: 'His measurements become impossible until the pair is re-prepared' },
            ],
            correctId: 'a',
            explanation:
              'This is the no-communication theorem in action. Bob\'s reduced density matrix is I/2 before Alice acts and I/2 afterwards, so every local statistic he can gather is unchanged — he has no way of telling whether Alice measured at all. Option B is the seductive one: it is true that conditioned on Alice\'s result Bob\'s qubit is definite, but Bob does not know her result, and averaging over her two equally likely outcomes returns him to 50/50. The correlation only appears when the two records are compared over a classical channel.',
          },
          {
            id: 'q3',
            prompt: 'The Bell state is a pure state, yet each of its qubits has entanglement entropy 1 bit. What does that mean?',
            options: [
              { id: 'a', text: 'The calculation is an artifact; a pure state cannot have mixed subsystems' },
              { id: 'b', text: 'The pair is fully specified while each qubit individually is maximally uncertain — all the information is in the correlation' },
              { id: 'c', text: 'The state has decohered and is no longer usable' },
              { id: 'd', text: 'Each qubit stores one bit of classical data' },
            ],
            correctId: 'b',
            explanation:
              'Complete knowledge of the whole coexisting with zero knowledge of the parts is the defining oddity of entanglement, and it has no classical analogue — classically, knowing a joint distribution exactly means knowing each marginal exactly. Here the information is stored entirely in the relationship between the qubits, not in either of them. Note that this is a property of a perfectly coherent, undamaged state: option C confuses maximal entanglement with decoherence, which is a different and unwanted thing.',
          },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────
  // 7. Grover's Search
  // ─────────────────────────────────────────────────────────────────────
  {
    slug: 'grover',

    blocks: [
      {
        kind: 'prose',
        title: 'The problem, stated carefully',
        paragraphs: [
          'You have a function f from N inputs to {0, 1}. Exactly one input w satisfies f(w) = 1; every other input gives 0. You want to find w. The only thing you can do is evaluate f, and f is a black box — no structure to exploit, no gradient to follow, no ordering to binary-search. Checking one item tells you about that item and nothing else.',
          'Classically the cost is easy to pin down. With no structure, all you can do is try inputs. You expect to find w after about N/2 evaluations, and to be certain you may need all N. There is no cleverness available: this is a proven lower bound, not a failure of imagination. If the haystack has a million items, you are looking at roughly half a million evaluations.',
          'Grover\'s algorithm, published in 1996, finds w with high probability in about (π/4)√N evaluations. For a million items that is roughly 785 instead of 500,000. It is a quadratic speed-up, not an exponential one — worth being precise about, because the difference matters enormously in practice and gets blurred in popular accounts.',
          'It is also known to be optimal. Bennett, Bernstein, Brassard and Vazirani proved that no quantum algorithm can search an unstructured space in fewer than Ω(√N) queries, and Grover\'s achieves that bound up to constants. So this is not a waypoint on the road to something faster: for genuinely unstructured search, √N is the end of the line.',
        ],
      },
      {
        kind: 'inline-check',
        id: 'c1',
        question:
          'Grover’s oracle acts on the uniform superposition by flipping the sign of the marked item’s amplitude: +1/√N becomes −1/√N, everything else untouched. Suppose you measure immediately after one oracle call. What is the probability of getting the marked item?',
        options: [
          { id: 'a', text: 'Roughly 2/N — the oracle boosted its weight' },
          { id: 'b', text: 'Still exactly 1/N — a sign flip changes no probability' },
          { id: 'c', text: 'Nearly 1 — the oracle has identified the answer' },
          { id: 'd', text: 'Zero — a negative amplitude marks an impossible outcome' },
        ],
        correctId: 'b',
        explanation:
          '(−1/√N)² = 1/N. The oracle writes its mark in the one place a measurement cannot see — the sign — so measuring now is still a uniformly random guess, as if nothing had happened. The entire burden of the algorithm falls on the second move, which converts that invisible sign into visible amplitude; the section below introduces both moves and what each one does to the bar chart.',
      },
      {
        kind: 'prose',
        title: 'The two moves',
        paragraphs: [
          'Start by putting n qubits, with N = 2ⁿ, into an even superposition over all N basis states using a layer of Hadamards. Every amplitude is 1/√N. Measuring now would give a uniformly random guess — useless. The algorithm then repeats two operations, and everything depends on understanding what each one does to the amplitudes.',
          'The first is the oracle. It flips the sign of the amplitude of the marked item and leaves everything else alone: |x⟩ ↦ −|x⟩ if x = w, otherwise |x⟩ ↦ |x⟩. This is what a quantum query looks like — not "tell me if this one is the answer" but "negate whichever one is". A crucial point: it changes no probabilities whatsoever. Squaring a negated amplitude gives the same number back, so if you measured immediately after the oracle you would still see a uniformly random result. The oracle marks; it does not amplify.',
          'The second move, the diffusion operator, does the amplifying. It reflects every amplitude about their mean: each amplitude a becomes 2μ − a, where μ is the average. Picture the amplitudes as a bar chart. After the oracle, N−1 bars sit at +1/√N and one dips down to −1/√N, so the mean μ is a hair below 1/√N. Reflecting about that mean barely moves the tall bars — they are already near it — but the marked bar is far below, so it flips to a value well above the mean. Its magnitude has grown.',
          'That is the whole algorithm: mark with a sign, then reflect about the mean, and repeat. Each round the marked amplitude grows by roughly 2/√N while the others shrink slightly to compensate — the total must stay normalized. This is called amplitude amplification, and it is the interference story from lesson three in its most purposeful form. The negative sign the oracle introduces is exactly what makes the reflection treat the marked item differently from the rest.',
        ],
      },
      {
        kind: 'callout',
        tone: 'insight',
        title: 'Why √N, geometrically',
        body: 'The two reflections have a clean geometric reading: together they rotate the state vector by a fixed angle θ inside a two-dimensional plane spanned by |w⟩ and the uniform superposition of everything else. For large N, sin(θ/2) = 1/√N, so θ ≈ 2/√N. You begin almost perpendicular to |w⟩ and need to rotate through about π/2 to reach it, so the number of iterations is roughly (π/2)/(2/√N) = (π/4)√N. The √N is not a clever trick or a lucky bound — it is the angle of one rotation step, and each step can only be that big because amplitudes are square roots of probabilities. That relationship is where the quadratic, rather than exponential, character of the speed-up ultimately comes from.',
      },
      {
        kind: 'inline-check',
        id: 'c2',
        question:
          'The success probability peaks near 1 after about (π/4)√N iterations. Suppose you keep iterating well past that point — say to twice the optimal count. What happens to the success probability?',
        options: [
          { id: 'a', text: 'It stays pinned near 1 — the algorithm has converged' },
          { id: 'b', text: 'It keeps creeping upward, approaching 1 asymptotically' },
          { id: 'c', text: 'It falls back down — the iteration rotates straight past the target' },
          { id: 'd', text: 'It becomes undefined; the algorithm must be restarted' },
        ],
        correctId: 'c',
        explanation:
          'Each iteration is a rotation by a fixed angle, and a rotation does not stop at its destination: past the optimum the state sweeps through |w⟩ and out the other side, and by about (π/2)√N iterations you are nearly back where you began, oscillating forever. This inverts the classical intuition that more iterations never hurt — here they actively do. The section below draws the consequences, including how to stop on time when you do not know how many solutions there are.',
      },
      {
        kind: 'prose',
        title: 'You can absolutely run it too long',
        paragraphs: [
          'Because the iteration is a rotation at a constant angle, it does not stop when it reaches the target. Keep applying it past the optimal (π/4)√N steps and the state rotates straight through |w⟩ and out the other side. The success probability, having climbed to nearly 1, falls back down — and after about (π/2)√N iterations it returns to roughly where it started. The amplitude oscillates sinusoidally, forever.',
          'This behaviour catches people out, because it inverts an intuition built on classical algorithms. More iterations of a search loop, or more steps of gradient descent, generally do not hurt; here they do. Grover\'s is a rotation, not a convergence, and you have to stop at the right moment.',
          'Which means you need to know N, or at least estimate it, to know when to stop. If the number of marked items is unknown, the fix is either quantum counting (a phase-estimation routine that determines how many solutions there are) or the exponential-search trick of running Grover with a random iteration count drawn from a geometrically growing range, which recovers the O(√N) scaling without knowing the answer in advance.',
          'One more practical caution about the oracle. It is a quantum circuit you have to build, and its cost counts. Grover\'s gives you a quadratic speed-up in the number of oracle queries, so if implementing f as a reversible circuit is expensive, that cost multiplies through every one of your √N iterations. The theoretical query complexity and the wall-clock runtime can be very different animals.',
        ],
      },
      {
        kind: 'code',
        language: 'python',
        code: `import numpy as np

def grover(n_qubits, marked, iterations=None):
    N = 2 ** n_qubits
    if iterations is None:
        iterations = int(np.floor(np.pi / 4 * np.sqrt(N)))

    amps = np.full(N, 1 / np.sqrt(N))     # uniform superposition
    history = []

    for _ in range(iterations):
        amps[marked] *= -1                # oracle: flip the marked sign
        mean = amps.mean()                # diffusion: reflect about mean
        amps = 2 * mean - amps
        history.append(amps[marked] ** 2)

    return amps, history

amps, history = grover(n_qubits=10, marked=573)   # N = 1024
print(len(history))                 # 25 iterations  (≈ (π/4)·32)
print(round(history[-1], 4))        # ≈ 0.9995 probability of success

# Classically you would expect ~512 evaluations. 25 vs 512.

# Overshoot deliberately and watch it oscillate:
_, long_run = grover(n_qubits=10, marked=573, iterations=80)
print([round(long_run[i], 3) for i in (24, 40, 50, 64)])
# ≈ [0.999, 0.271, 0.006, 0.664]  ← past the target, then climbing back: it oscillates`,
        caption:
          'The full algorithm in eight lines. The oracle is one sign flip; diffusion is one reflection about the mean. Run it past the optimum and the success probability falls away — and then, because it is a rotation, climbs back up again.',
      },
      {
        kind: 'embed',
        href: '/visualizations/grover',
        title: 'Grover Search Lab',
        blurb:
          'Watch the amplitude bar chart step through the algorithm one iteration at a time — the marked bar dipping negative under the oracle, then vaulting above the mean under diffusion. Push the iteration count past the optimum to see the success probability slide back down.',
      },
      {
        kind: 'inline-check',
        id: 'c3',
        question:
          'Brute-force search over the 2ⁿ candidate assignments of a 3-SAT formula, run through Grover’s algorithm, costs about 2^(n/2) oracle calls instead of 2ⁿ. What does that make of NP-complete problems on a quantum computer?',
        options: [
          { id: 'a', text: 'Tractable — 2^(n/2) is a polynomial cost' },
          { id: 'b', text: 'Still intractable — the exponent halves, but the cost is still exponential' },
          { id: 'c', text: 'Tractable up to a few thousand variables, intractable beyond' },
          { id: 'd', text: 'Unaffected — Grover’s does not apply to NP-complete problems at all' },
        ],
        correctId: 'b',
        explanation:
          '2^(n/2) = (√2)ⁿ is still exponential: a problem hopeless at n = 200 is still hopeless at n = 400, so the wall moves but does not fall. The gain is real — it is why post-quantum guidance doubles symmetric key lengths — but Grover’s puts nothing new in P and resolves nothing about P versus NP. Option D fails in the other direction: Grover’s applies to any NP problem via search over candidate certificates, precisely because checking one is easy and the space is unstructured. The closing section holds both truths at once.',
      },
      {
        kind: 'prose',
        title: 'What this does not mean for NP',
        paragraphs: [
          'Grover\'s algorithm gets recruited into some overreaching claims, so it is worth being precise about what it delivers.',
          'It does apply to NP-complete problems in a limited, honest way. Any problem in NP has an efficiently checkable certificate, so you can treat the space of candidate certificates as an unstructured search space and use Grover\'s to find one. For 3-SAT on n variables, brute force over 2ⁿ assignments becomes about 2^(n/2) with Grover\'s. That is a real and meaningful improvement — it is the reason post-quantum cryptography recommends doubling symmetric key lengths, since Grover\'s reduces the effective security of AES-256 to something like 128 bits.',
          'But 2^(n/2) is still exponential. Halving the exponent does not make an intractable problem tractable; it moves the wall, it does not remove it. A problem that was hopeless at n = 200 is still hopeless at n = 400. Grover\'s does not put NP-complete problems in P, does not put them in BQP, and does not resolve anything about P versus NP.',
          'And the quadratic gain is fragile in a way that exponential gains are not. Under fault-tolerant error correction, each logical operation costs orders of magnitude more than its physical counterpart, and detailed resource analyses have repeatedly found that this overhead can swallow a quadratic speed-up entirely for realistic problem sizes. Shor\'s exponential advantage survives such accounting comfortably; Grover\'s often does not.',
          'The right way to hold it: Grover\'s is a beautiful and provably optimal algorithm for a clean abstract problem, and its real value is partly conceptual. It is the clearest possible demonstration that quantum advantage comes from steering amplitudes — mark with a phase, reflect to amplify, repeat — rather than from trying everything at once. Every algorithm in this course has been building to that sentence.',
        ],
      },
      {
        kind: 'keypoints',
        points: [
          'Unstructured search costs O(N) classically and Θ(√N) quantumly — Grover\'s is provably optimal.',
          'The oracle flips the sign of the marked amplitude and changes no probability at all.',
          'Diffusion reflects every amplitude about their mean, converting that sign flip into amplitude.',
          'The pair of reflections is a rotation by θ ≈ 2/√N, so about (π/4)√N iterations are needed.',
          'Overshooting rotates past the target and the success probability falls — you must stop at the right step.',
          'The speed-up is quadratic, not exponential: NP-complete problems go from 2ⁿ to 2^(n/2) and remain intractable.',
        ],
      },
      {
        kind: 'quiz',
        questions: [
          {
            id: 'q1',
            prompt: 'Immediately after the oracle flips the sign of the marked amplitude, what is the probability of measuring the marked item?',
            options: [
              { id: 'a', text: 'It has doubled, because the oracle marks the correct answer' },
              { id: 'b', text: 'It is unchanged at 1/N — squaring removes the sign' },
              { id: 'c', text: 'It is zero, because a negative amplitude means an impossible outcome' },
              { id: 'd', text: 'It is 1 — the oracle identifies the answer directly' },
            ],
            correctId: 'b',
            explanation:
              'The Born rule squares the amplitude, and (−1/√N)² = (1/√N)², so the oracle alone accomplishes nothing observable. This is exactly why the diffusion operator is essential: it converts the invisible phase difference into a visible amplitude difference by reflecting about the mean. The pattern generalises across quantum algorithms — write information into phases, then interfere to turn phases into probabilities.',
          },
          {
            id: 'q2',
            prompt: 'What happens if you run Grover\'s algorithm for twice the optimal number of iterations?',
            options: [
              { id: 'a', text: 'The success probability increases further, closer to 1' },
              { id: 'b', text: 'It stays flat once the marked amplitude reaches its maximum' },
              { id: 'c', text: 'The success probability falls back toward its starting value — the state rotates past the target' },
              { id: 'd', text: 'The algorithm errors out and returns nothing' },
            ],
            correctId: 'c',
            explanation:
              'Each iteration rotates the state by a fixed angle in the plane spanned by |w⟩ and everything else, and rotation does not stop at the destination. At about (π/2)√N iterations you are back roughly where you began, and the success probability oscillates sinusoidally from there. This is why knowing N (or estimating the number of solutions via quantum counting) matters — unlike a classical search loop, running longer actively hurts.',
          },
          {
            id: 'q3',
            prompt: 'What does Grover\'s algorithm imply about NP-complete problems?',
            options: [
              { id: 'a', text: 'It solves them in polynomial time, so a quantum computer proves P = NP' },
              { id: 'b', text: 'It reduces brute-force search from 2ⁿ to about 2^(n/2), which is faster but still exponential' },
              { id: 'c', text: 'It says nothing about them; it only applies to sorted databases' },
              { id: 'd', text: 'It makes them harder, since quantum computers cannot check certificates efficiently' },
            ],
            correctId: 'b',
            explanation:
              'You can Grover-search the space of candidate certificates, which square-roots the size of the search — 3-SAT goes from 2ⁿ to roughly 2^(n/2). That is genuinely useful (it is the reason post-quantum guidance says to double symmetric key lengths), but halving an exponent leaves the problem exponential and moves the tractability wall rather than removing it. Option C inverts the premise: Grover\'s applies precisely because the space is unstructured — a sorted database can be binary-searched classically in log N, far faster.',
          },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────
  // 8. Inside a Quantum Computer
  //
  // The course closer: after seven lessons of states and gates as
  // mathematics, this is the machine. It leans on gates-and-circuits (a
  // gate as a calibrated rotation is the load-bearing idea) and ends at
  // /hardware, where the reader can submit a real circuit to a real
  // device — the one embed in the course that is not a simulation.
  // ─────────────────────────────────────────────────────────────────────
  {
    slug: 'inside-a-quantum-computer',

    blocks: [
      {
        kind: 'prose',
        title: 'The qubit is a circuit you could see',
        paragraphs: [
          'Seven lessons in, a qubit has been an abstraction: two amplitudes, a point on a sphere, a wire in a diagram. Time to open the box. In the machines built by IBM, Google and a good fraction of the field, the object playing the role of the qubit is a transmon — a small superconducting circuit, patterned in aluminium on a chip, that you could point to with a finger. Its main capacitor is a few hundred micrometres across: visible to the naked eye, millions of times larger than an atom, and made of billions of paired electrons all doing the same thing.',
          'The starting point is the humblest circuit in the electronics curriculum: a capacitor and an inductor in a loop, an LC oscillator, with charge sloshing back and forth at a resonant frequency set by L and C. Build it from superconducting metal, cold enough that resistance is exactly zero, and the oscillation stops being damped classical sloshing and becomes a quantum system: its energy is quantized into discrete levels, a ladder of states you can hope to use. The demonstration that an electrical circuit — a macroscopic, manufactured object with soldered leads — really does show quantized energy levels and tunnelling was made by John Clarke, Michel Devoret and John Martinis in the mid-1980s, and it earned them the 2025 Nobel Prize in Physics. Every transmon is a working consequence of that result.',
          'It is worth pausing on what this is not. The qubit is not an electron, and nothing here is small — "quantum" is not a synonym for "tiny". What makes the circuit quantum is not its size but its isolation: superconductivity removes the resistance that would leak its energy, and the rest of this lesson is about removing everything else.',
          'But a plain LC oscillator, quantized or not, fails as a qubit — and the way it fails is the most instructive fact in this lesson. Before reading on, commit to a prediction.',
        ],
      },
      {
        kind: 'inline-check',
        id: 'c1',
        question:
          'A superconducting LC circuit is a harmonic oscillator: its energy levels form a ladder with exactly equal spacing, every rung hf apart. You drive it with microwaves at frequency f, intending to use the bottom two rungs as |0⟩ and |1⟩. What happens?',
        options: [
          { id: 'a', text: 'It works — the drive is resonant with the 0→1 transition, so only those two levels respond' },
          { id: 'b', text: 'The drive climbs the whole ladder — every transition is at the same f, so the state spreads upward and no two-level qubit exists' },
          { id: 'c', text: 'Nothing — a macroscopic circuit has no quantized levels to address' },
          { id: 'd', text: 'The circuit absorbs exactly one photon and stops, because a second photon would violate energy conservation' },
        ],
        correctId: 'b',
        explanation:
          'Equal spacing is fatal. The same frequency that drives 0→1 also drives 1→2, 2→3 and every rung above, so population leaks straight up the ladder: the drive produces the quantum version of a swinging pendulum, not a two-level system. A qubit needs the 1→2 transition to sit at a different frequency from 0→1, so a drive can address one without touching the other — and spoiling the spacing is exactly the job of the one nonlinear component the next section introduces. (Option C is wrong but honourably: the circuit is macroscopic and its levels are quantized anyway, which is what the 2025 Nobel work established.)',
      },
      {
        kind: 'prose',
        title: 'The Josephson junction: anharmonicity is what makes it a qubit',
        paragraphs: [
          'The fix is to replace the inductor with a Josephson junction — two superconductors separated by a nanometre of insulating oxide, thin enough that Cooper pairs tunnel through. (The course keeps paying off: this is the tunnelling lesson, deployed as a component.) A junction behaves like an inductor whose inductance depends on the current through it. That nonlinearity turns the harmonic oscillator into an anharmonic one, and the level spacings stop being equal.',
          'The numbers are modest and they are enough. A typical transmon has its 0→1 transition near 5 GHz, while the 1→2 transition sits lower by the anharmonicity — usually 200 to 300 MHz. That few-percent offset is the entire difference between an oscillator and a qubit: a microwave drive tuned to the 0→1 frequency is now off-resonant with 1→2, so population placed in the bottom two levels stays there. The qubit is not a two-level system by nature. It is the bottom two rungs of a many-level ladder, used as a qubit because the third rung has been pushed out of tune.',
          'This is also an honest place to note what a fragile arrangement that is. The other levels do not vanish; drive too hard or with too short a pulse — a short pulse is a wide band of frequencies, wide enough to reach the 1→2 transition — and amplitude leaks into level 2, an error outside the qubit space entirely. Real machines shape their pulses carefully to keep that leakage down, and the anharmonicity sets a floor on how fast a clean gate can be.',
        ],
      },
      {
        kind: 'prose',
        title: 'A gate is a shaped microwave pulse',
        paragraphs: [
          'The gates lesson said that on real hardware "a calibrated pulse of a given duration is an RX or RZ of a given angle". Here is that sentence unpacked. Shine a microwave tone at the qubit at exactly its 5 GHz transition frequency and the state does not jump — it rotates, smoothly and deterministically, cycling between |0⟩ and |1⟩ at a rate set by the drive amplitude. This is Rabi oscillation, and it is continuous: stop the pulse a quarter of the way through a cycle and you have applied a 90° rotation and left the qubit in an even superposition; run it half a cycle and you have applied the X gate.',
          'So one knob — pulse duration times amplitude — sets the rotation angle. A second knob, the phase of the microwave carrier, sets the rotation axis: the same pulse shifted a quarter-period in phase turns an RX into an RY. Those two knobs generate every rotation on the Bloch sphere, and a typical single-qubit gate takes 20 to 40 nanoseconds. The RZ rotations come almost free: rotating about the z-axis is equivalent to rotating the frame every later pulse is measured against, so the control software simply adds a phase offset to all subsequent pulses — a "virtual Z", taking zero time and introducing zero error, which is why compilers push as much of a circuit as possible into Z rotations.',
          'A circuit diagram, then, is a pulse schedule. The neat boxes of the gates lesson compile down to a timed sequence of shaped microwave bursts, each lasting tens of nanoseconds, fired down coaxial lines into a chip — and the reason the abstraction holds is that each burst has been calibrated, on that individual qubit, that morning, to be the rotation its box claims. No two transmons are identical: they are fabricated objects with fabrication spread, and each one\'s frequency and pulse calibrations are measured, not designed.',
        ],
      },
      {
        kind: 'inline-check',
        id: 'c2',
        question:
          'A transmon\'s |0⟩→|1⟩ splitting is about 5 GHz, and E = hf turns that into a temperature: hf/k_B ≈ 240 mK. Liquid helium gets you to 4.2 K cheaply. Is that cold enough to run the qubit?',
        options: [
          { id: 'a', text: 'Yes — 4 K is seventy times colder than the room, and superconductors already work there' },
          { id: 'b', text: 'No — at 4 K the thermal energy is ~17× the qubit\'s level splitting, so the environment constantly excites and scrambles it' },
          { id: 'c', text: 'Yes for storing |0⟩, but not for storing |1⟩' },
          { id: 'd', text: 'Temperature is irrelevant — the qubit\'s state is set by the control pulses, not by its surroundings' },
        ],
        correctId: 'b',
        explanation:
          'The comparison that matters is not "cold versus room temperature" but k_BT versus hf. At 4 K, k_BT is about 17 times the qubit\'s splitting, so the wiring and the chip itself glow with microwave photons resonant with the very transition the qubit lives on — the mean thermal occupation is around 16 photons\' worth, and the "qubit" would be a hot, fluctuating mixture rather than the state you prepared. You need k_BT well below hf: at 15 mK the ratio inverts to hf/k_BT ≈ 16, making a thermal excitation as rare as e⁻¹⁶ ≈ 10⁻⁷. The next section is about the machine that buys those last two orders of magnitude.',
      },
      {
        kind: 'prose',
        title: 'The refrigerator is most of the machine',
        paragraphs: [
          'The photograph everyone has seen — the golden chandelier of discs and pipes — is not the quantum computer. It is the refrigerator, with the computer, a chip the size of a large coin, bolted to the bottom. The instrument is a dilution refrigerator, and it reaches its base temperature by exploiting a quantum property of helium itself: below about 0.87 K, a mixture of helium-3 and helium-4 separates into two phases, and dragging ³He atoms across the boundary from the concentrated phase into the dilute one absorbs heat, the way evaporation cools skin. Circulate the ³He in a closed loop and the cooling runs continuously.',
          'The chandelier\'s discs are temperature stages, typically near 50 K, 4 K, 900 mK, 100 mK and finally the mixing chamber plate at 10 to 20 millikelvin, where the chip lives — colder than the 2.7 K of deep space, and colder than any naturally occurring place known. Run the arithmetic from the check above at 15 mK and the Boltzmann factor for thermally exciting a 5 GHz qubit is e^{−hf/k_BT} = e^{−16} ≈ 10⁻⁷: the environment has been made quiet enough that the qubit stays where you put it, at least on the timescales that matter.',
          'The wiring is the part the photograph does not explain. Every control pulse originates in room-temperature electronics at 300 K, and a coaxial cable is a pipe for thermal noise as much as for signals — so each line is deliberately attenuated in stages as it descends, dumping the accumulated room-temperature noise as heat at the upper plates and delivering a faint, clean pulse at the bottom. The readout signals going the other way are boosted by amplifiers that themselves work near the quantum limit. The cooling power at the mixing chamber is measured in microwatts, which is why the attenuation has to happen higher up: the coldest stage could not absorb a milliwatt if you asked it to.',
          'And for all that, the qubit still forgets. A modern transmon\'s T₁ — the timescale for an excited state to relax — is around a hundred microseconds, sometimes several hundred. Against 20-nanosecond gates that allows a few thousand operations before the state has decayed, which is exactly why the error-correction machinery of the advanced track is not optional for large algorithms. The refrigerator does not make decoherence go away; it buys time, at a rate of roughly one part in ten thousand per gate on a good day.',
        ],
      },
      {
        kind: 'callout',
        tone: 'warning',
        title: 'Cold does not make it quantum',
        body: 'A tempting reading of all this: quantum behaviour is a delicate low-temperature phenomenon, switched on by the refrigerator. That is backwards. Quantum mechanics applies at every temperature — the interference lesson\'s electrons were doing it in a warm vacuum chamber, and the tunnelling lesson\'s fusion runs at fifteen million kelvin. The refrigerator solves a signal-to-noise problem, not a physics problem: a hot environment exchanges energy and information with the qubit constantly, and any leak of which-state information into the surroundings is exactly the which-path decoherence from the interference lesson — the superposition degrades into a mixture, and the phase relationships every algorithm depends on are gone. Cold is how a transmon is isolated. It is not why it is quantum, and other qubit technologies buy their isolation in entirely different currencies.',
      },
      {
        kind: 'prose',
        title: 'Reading it out without looking directly',
        paragraphs: [
          'Measurement is the one remaining piece, and it is done sideways. You do not probe the qubit at its own 5 GHz frequency — a resonant probe would drive rotations and dump noise into the very transition you care about. Instead, each transmon is coupled to a readout resonator, a length of transmission line resonating a few hundred megahertz to a couple of gigahertz away from the qubit. Because the pair are coupled but detuned, they cannot exchange energy resonantly; what survives is a subtler dispersive interaction: the resonator\'s frequency shifts by a small amount whose sign depends on the qubit\'s state.',
          'So the measurement is: send a weak microwave tone at the resonator, and see which of two slightly different resonators it encounters. If the qubit is |0⟩ the reflected tone comes back with one phase; if |1⟩, another. A few hundred nanoseconds of integration separates the two, and the Born rule of the measurement lesson happens here — the random outcome, the collapse, all of it, implemented as a phase shift on a probe tone that never touched the qubit\'s own transition. Done well, the qubit is still in the state the measurement reported, ready to be measured again with the same answer: the repeatability that lesson two called the experimental signature of collapse.',
          'Every readout error rate on the hardware page bottoms out here: distinguish the two phases too slowly and the qubit may decay mid-measurement; probe too strongly and you disturb what you are reading. Readout on current superconducting machines is, per operation, roughly ten times more error-prone than a single-qubit gate — around a percent — which is a number worth knowing before interpreting a noisy histogram.',
        ],
      },
      {
        kind: 'code',
        language: 'python',
        code: `import math

H  = 6.62607015e-34    # J·s
KB = 1.380649e-23      # J/K

f01 = 5.0e9            # a typical transmon 0→1 transition, Hz

# The qubit's level splitting, as a temperature.
T_qubit = H * f01 / KB
print(round(T_qubit * 1000))          # 240 mK

def thermal_photons(T):
    """Mean thermal occupation at f01 (Bose–Einstein)."""
    return 1 / (math.expm1(H * f01 / (KB * T)))

print(thermal_photons(300))           # ~1250   — room temperature
print(thermal_photons(4.2))           # ~17     — liquid helium: still hot
print(thermal_photons(0.015))         # ~1.1e-7 — dilution fridge base

# Anharmonicity: why the drive stays out of level 2.
f12 = f01 - 0.25e9                    # 1→2 sits ~250 MHz lower
detuning = f01 - f12
print(detuning / 1e6)                 # 250.0 MHz off-resonant

# ...which caps the pulse speed: a pulse much shorter than ~1/detuning
# is spectrally wide enough to drive 1→2 anyway.
print(1 / detuning * 1e9)             # 4.0 ns — gates run ~5-10× longer`,
        caption:
          'The whole cooling requirement in one function: at 4.2 K the qubit sits in a bath of ~17 resonant thermal photons; at 15 mK the expected number is one in ten million. The last two lines are the anharmonicity budget — the 250 MHz detuning that separates "qubit" from "oscillator" also sets the floor under gate duration.',
      },
      {
        kind: 'prose',
        title: 'Trapped ions do it completely differently',
        paragraphs: [
          'Everything above is one technology, and honesty requires saying so before the mental model hardens. The other mature platform, trapped ions — IonQ, Quantinuum, and decades of academic machines — shares almost none of the engineering. The qubit is a single atomic ion, say ¹⁷¹Yb⁺ or ⁴⁰Ca⁺, held in ultra-high vacuum by oscillating electric fields in a Paul trap, with |0⟩ and |1⟩ encoded in two internal electronic states. Gates are driven by laser or microwave pulses rather than wires on a chip, and two-qubit gates work through the ions\' shared motion: the chain of ions in a trap vibrates as a unit, and that collective motion is the bus that lets any ion entangle with any other — all-to-all connectivity, where a transmon chip only couples fixed neighbours.',
          'The trade-offs run in both directions, and neither side is winning so much as betting differently. Ions of the same isotope are perfectly identical — nature fabricates them, with no spread and no per-qubit calibration file — and their coherence times are measured in seconds to minutes, against the transmon\'s hundred microseconds. In exchange, ion gates are slow: single-qubit operations take microseconds and two-qubit gates typically tens to hundreds of microseconds, thousands of times slower than a transmon\'s, so an ion machine performs far fewer operations per second even while each operation is often cleaner. And an ion trap needs no dilution refrigerator: the vacuum system and laser optics are the machine, with the trap itself at room temperature or a modest 4 K.',
          'The practical moral: a raw qubit count comparing a transmon machine to an ion machine is close to meaningless. Gate speed, gate fidelity, connectivity and coherence all trade against each other, and which combination wins depends on the algorithm. When the hardware page offers you a choice of backends, that is the choice it is offering.',
        ],
      },
      {
        kind: 'embed',
        href: '/hardware',
        title: 'Real hardware',
        blurb:
          'Everything in this lesson is now something you can use. Build a small circuit — the Bell pair from the gates lesson is the classic first job — and submit it to a physical quantum computer: your gates become pulse schedules, your qubits are transmons or ions at the bottom of someone\'s refrigerator or trap, and the histogram that comes back rode a readout resonator on its way to you. Expect it to be noisier than the simulator\'s, and expect a queue. Both are the subject of this lesson, experienced first-hand.',
      },
      {
        kind: 'keypoints',
        points: [
          'A transmon is a superconducting anharmonic oscillator — a capacitor and a Josephson junction — macroscopic, fabricated, and quantized anyway.',
          'A harmonic oscillator cannot be a qubit: equal level spacing means any drive climbs the whole ladder. The junction\'s nonlinearity detunes 1→2 from 0→1 by ~250 MHz, and that anharmonicity is what isolates two levels.',
          'Gates are resonant microwave pulses: duration × amplitude sets the rotation angle, carrier phase sets the axis, and RZ is a free software frame change.',
          'A 5 GHz splitting corresponds to hf/k_B ≈ 240 mK, so even 4 K leaves ~17 thermal photons on the transition; at 15 mK the Boltzmann factor e⁻¹⁶ ≈ 10⁻⁷ makes thermal excitation negligible.',
          'The dilution refrigerator and staged, attenuated wiring exist to keep room-temperature noise off the chip; cold buys isolation, it does not switch on quantum mechanics.',
          'Readout is dispersive: the qubit state shifts a coupled resonator\'s frequency, and a probe tone\'s phase — not a direct look at the qubit — carries the answer.',
          'Trapped ions invert every trade-off: identical atoms, seconds of coherence, all-to-all coupling, no millikelvin fridge — and gates thousands of times slower. Raw qubit counts across platforms compare almost nothing.',
        ],
      },
      {
        kind: 'quiz',
        questions: [
          {
            id: 'q1',
            prompt:
              'Why does the transmon need a Josephson junction — why not use a plain superconducting LC circuit as the qubit?',
            options: [
              { id: 'a', text: 'The junction is what makes the circuit superconduct in the first place' },
              { id: 'b', text: 'A plain LC circuit is harmonic: every level spacing is identical, so any drive that addresses 0→1 equally addresses every other transition, and no two levels can be isolated as a qubit' },
              { id: 'c', text: 'The junction amplifies the incoming microwave control pulses' },
              { id: 'd', text: 'Without the junction the circuit would have only a single energy level' },
            ],
            correctId: 'b',
            explanation:
              'The junction is a nonlinear inductor, and the nonlinearity makes the oscillator anharmonic: the 1→2 transition moves ~200–300 MHz away from 0→1, so a resonant drive rotates within the bottom two levels without climbing the ladder. Superconductivity (option A) comes from the material and the temperature, not the junction — a junction-free LC circuit superconducts fine and is still useless as a qubit. The levels also do not disappear (option D): a transmon has many, and using the bottom two safely is precisely what the anharmonicity buys.',
          },
          {
            id: 'q2',
            prompt:
              'Why must the chip sit at ~15 mK in a dilution refrigerator, rather than in a far simpler 4 K cryostat?',
            options: [
              { id: 'a', text: 'Superconductivity only sets in below about 100 mK' },
              { id: 'b', text: 'Colder circuits oscillate more slowly, giving the control pulses more time to act' },
              { id: 'c', text: 'At 4 K, k_BT is about 17× the qubit\'s level splitting, so thermal photons constantly excite the transition; at 15 mK, hf/k_BT ≈ 16 and thermal excitation is suppressed to ~e⁻¹⁶ ≈ 10⁻⁷' },
              { id: 'd', text: 'It is a convention inherited from the first dilution refrigerators, kept for comparability across labs' },
            ],
            correctId: 'c',
            explanation:
              'The criterion is k_BT ≪ hf. A 5 GHz splitting is 240 mK in temperature units, so 4 K is "hot" by a factor of ~17 — the mean thermal occupation at the qubit frequency is about 16 photons, and the qubit would be a fluctuating thermal mixture. At 15 mK the exponent flips and excitation becomes a one-in-ten-million event. Option A has the physics backwards: aluminium superconducts below 1.2 K and niobium below 9.2 K, so 4 K is cold enough for superconductivity — it is the qubit\'s energy scale, not the material\'s, that demands millikelvin.',
          },
          {
            id: 'q3',
            prompt: 'Which statement about trapped-ion qubits versus transmons is accurate?',
            options: [
              { id: 'a', text: 'A trapped ion is essentially a transmon cooled by lasers instead of a refrigerator' },
              { id: 'b', text: 'Ions of one isotope are perfectly identical, hold coherence for seconds to minutes, and couple all-to-all through shared motion — but their gates run thousands of times slower than a transmon\'s' },
              { id: 'c', text: 'Trapped ions need no vacuum system, which is their main practical advantage' },
              { id: 'd', text: 'Transmons hold coherence longer, while ions execute gates faster' },
            ],
            correctId: 'b',
            explanation:
              'The platforms trade in opposite currencies. Ions: atomic qubits with no fabrication spread, seconds-to-minutes coherence, any-to-any two-qubit gates via the chain\'s collective motion — paid for with microsecond-to-millisecond gate times and demanding laser systems. Transmons: nanosecond gates and chip-scale manufacturing — paid for with ~100 μs coherence, per-qubit calibration and fixed nearest-neighbour coupling. Option D states the trade-off exactly backwards, and option C is upside down too: ultra-high vacuum is one thing an ion trap absolutely requires. This is why raw qubit counts across platforms compare almost nothing.',
          },
        ],
      },
    ],
  },
]
