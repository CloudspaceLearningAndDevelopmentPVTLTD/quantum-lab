/**
 * questions.ts — the certification question bank.
 *
 * ############################################################################
 * #  SERVER ONLY. THIS MODULE MUST NEVER REACH A BROWSER BUNDLE.             #
 * #                                                                         #
 * #  It holds `correctIds`, `correctNumber`, `tolerance` and the worked      #
 * #  `explanation` for all 109 items. Until this change it was imported by    #
 * #  `components/exam/ExamRunner.tsx` and by `/certify`, both client         #
 * #  components, so the entire bank — answers included — was in the          #
 * #  JavaScript every visitor downloaded. Gating a route did not un-ship it. #
 * #                                                                         #
 * #  Two things keep that from happening again:                             #
 * #    · the `typeof window` guard below, which throws loudly rather than    #
 * #      quietly serving a bundle that contains the answers;                 #
 * #    · `lib/exams/boundary.test.ts`, which walks the import graph of every #
 * #      'use client' file in app/ and components/ and fails if this module  #
 * #      is reachable from one.                                             #
 * #                                                                         #
 * #  The catalogue a client page legitimately needs — titles, counts, time   #
 * #  limits, pass marks — lives in `lib/exams/catalogue.ts`. Import that.    #
 * ############################################################################
 *
 * Every item here was written against the lesson it is drawn from, and every
 * circuit-outcome item was hand-checked against the conventions in
 * `lib/quantum.ts`: qubit 0 is the least significant bit, and measurement
 * labels are printed MSB-first ("q1 q0"), matching Qiskit. Getting a question
 * wrong in an exam product is worse than not shipping it, so the explanations
 * carry the reasoning rather than just asserting the answer.
 *
 * Distractors are not filler. Each wrong option encodes a specific, common
 * misconception, and the explanation names it — a candidate who fails should
 * learn more from the review screen than from the exam itself.
 *
 * ─────────────────────────────────────────────────────────────
 * QUESTION IDS ARE PERMANENT
 * ─────────────────────────────────────────────────────────────
 * `ServerAttempt.questionIds` and `answers` are keyed by id and live in the
 * `exam_attempts` table (see supabase/schema-exams.sql). Reusing an id for a
 * different question silently regrades every stored attempt — the review screen
 * would show a past candidate a question they never saw, marked against an
 * answer they never gave, and a certificate already issued would no longer
 * correspond to the paper that earned it. So ids are append-only: f01…f58 and
 * a01…a51 are allocated in the order the questions were WRITTEN, not the order
 * they are read, which is why the tunnelling block sits at f26–f29 and the
 * second wave of foundations items runs f30–f58 across all seven lessons.
 * Never renumber; never reuse. `lib/exams/catalogue.ts` lists the same ids for
 * the client, and `questions.test.ts` fails if the two ever disagree.
 *
 * The pool is deliberately much larger than a paper: 58 foundations items for a
 * 15-question exam, 67 advanced (51 + 16 prerequisites) for a 20-question
 * one. A resit should be a different paper, not the same one shuffled.
 *
 * `questions.test.ts` checks every key against the grader, and simulates every
 * circuit-outcome item's QASM through lib/quantum.ts to confirm the listed
 * outcomes are exactly the ones with non-zero probability.
 */

import { EXAMS } from './catalogue'
import type { ExamQuestion } from './types'

/**
 * The guard, not a comment about a guard.
 *
 * A bundler that pulls this file into client JavaScript will run this line in
 * the browser and the page will fail loudly at import time. That is the
 * intended outcome: a broken exam page is a bug someone fixes in an hour, and a
 * silently shipped answer key is a bug that survives to production because
 * nothing looks wrong. `vitest` runs with `environment: 'node'`, and Next's
 * server rendering has no `window`, so neither trips it.
 */
if (typeof window !== 'undefined') {
  throw new Error(
    'lib/exams/questions.ts was imported into a browser bundle. It contains the ' +
      'answer key for every certification question. Import lib/exams/catalogue.ts instead.'
  )
}


// ────────────────────────────────────────────────────────────
// Foundations track: what-is-a-qubit → grover
// ────────────────────────────────────────────────────────────

const FOUNDATION_QUESTIONS: ExamQuestion[] = [
  {
    id: 'f01',
    kind: 'single',
    lessonSlug: 'what-is-a-qubit',
    points: 1,
    prompt:
      'A qubit is in the state α|0⟩ + β|1⟩ with α = −1/√2 and β = 1/√2. What is the probability of measuring 0?',
    options: [
      { id: 'a', text: '1/2' },
      { id: 'b', text: '−1/√2, because the amplitude is negative' },
      { id: 'c', text: '0, because a negative amplitude cancels the outcome' },
      { id: 'd', text: '1/√2' },
    ],
    correctIds: ['a'],
    explanation:
      'The Born rule says P(0) = |α|², and |−1/√2|² = 1/2. Options B and D come from reading amplitudes as probabilities — they are complex numbers, can be negative, and are not probabilities until you square their magnitude. Option C is the same error dressed up: a lone negative amplitude never cancels anything, because cancellation requires two amplitudes arriving at the same outcome. The sign here is a relative phase, invisible to this one measurement but decisive the moment you interfere the state with another.',
  },
  {
    id: 'f02',
    kind: 'single',
    lessonSlug: 'what-is-a-qubit',
    points: 2,
    prompt: 'Which statement best describes a qubit in an equal superposition of |0⟩ and |1⟩?',
    options: [
      { id: 'a', text: 'It is genuinely in a state that is neither 0 nor 1, with a definite value along a different measurement axis.' },
      { id: 'b', text: 'It is secretly already 0 or already 1, and we simply have not looked yet.' },
      { id: 'c', text: 'It rapidly oscillates between 0 and 1, and a measurement catches it wherever it happens to be.' },
      { id: 'd', text: 'It is exactly half a bit of information, so two qubits store one bit.' },
    ],
    correctIds: ['a'],
    explanation:
      'B is the "hidden value" misconception, and it is not merely unfashionable — Bell tests and single-particle interference experiments rule it out. A state on the equator of the Bloch sphere has a definite, predictable value when measured along X, which no secretly-definite bit could reproduce. C is the "fast switching" picture, which would give an evolving state; a superposition is stationary. D confuses the description of a state with the information you can extract from it: measuring one qubit yields at most one classical bit.',
  },
  {
    id: 'f03',
    kind: 'multi',
    lessonSlug: 'what-is-a-qubit',
    points: 2,
    prompt: 'Select all statements that are true of the state α|0⟩ + β|1⟩.',
    options: [
      { id: 'a', text: 'α and β may be complex numbers.' },
      { id: 'b', text: '|α|² + |β|² = 1.' },
      { id: 'c', text: 'The relative phase between α and β affects future interference.' },
      { id: 'd', text: 'α and β must both be non-negative real numbers.' },
      { id: 'e', text: 'Multiplying the whole state by e^{iθ} produces a physically different state.' },
    ],
    correctIds: ['a', 'b', 'c'],
    explanation:
      'Amplitudes are complex (A) and normalised (B), which is exactly the statement that the Bloch vector has length 1. Relative phase (C) is the longitude on the Bloch sphere and is precisely what interference is sensitive to. D is false — a negative or complex amplitude is entirely ordinary. E confuses global with relative phase: a common factor e^{iθ} multiplies every amplitude, cancels out of every squared magnitude, and is undetectable by any experiment.',
  },
  {
    id: 'f04',
    kind: 'numeric',
    lessonSlug: 'what-is-a-qubit',
    points: 1,
    prompt:
      'A qubit is in the state 0.6|0⟩ + 0.8|1⟩. What is the probability of measuring 0? Give a decimal between 0 and 1.',
    correctNumber: 0.36,
    tolerance: 0.001,
    explanation:
      'P(0) = |α|² = 0.6² = 0.36. The common wrong answer is 0.6, from treating the amplitude as the probability directly. Note the check that the state is legal at all: 0.36 + 0.64 = 1.',
  },
  {
    id: 'f05',
    kind: 'single',
    lessonSlug: 'superposition-and-measurement',
    points: 1,
    prompt:
      'A qubit in an equal superposition is measured and returns 1. It is measured again immediately, in the same basis. What happens?',
    options: [
      { id: 'a', text: 'It returns 1 with certainty — the first measurement collapsed the state to |1⟩.' },
      { id: 'b', text: 'It returns 0 or 1 with equal probability, because the state was a superposition.' },
      { id: 'c', text: 'It returns 0 with certainty, because measurement flips the qubit.' },
      { id: 'd', text: 'The result is undefined; a qubit can only be measured once.' },
    ],
    correctIds: ['a'],
    explanation:
      'Measurement in the computational basis is projective: after a result of 1 the state IS |1⟩, so a repeat gives 1 forever. B is the most common slip — it applies the pre-measurement probabilities to a post-measurement state that no longer has them. C invents a flip that no postulate provides. D confuses "measurement destroys the superposition" with "measurement destroys the qubit"; the qubit is still there, just in a definite state.',
  },
  {
    id: 'f06',
    kind: 'numeric',
    lessonSlug: 'superposition-and-measurement',
    points: 1,
    prompt:
      'A Hadamard gate is applied to |0⟩ twice in a row, then the qubit is measured. What is P(0)? Give a decimal between 0 and 1.',
    correctNumber: 1,
    tolerance: 0.001,
    explanation:
      'H is its own inverse: H·H = I, so the state returns exactly to |0⟩ and P(0) = 1. The tempting answer is 0.5 — the reasoning being "it was random after the first H, so it stays random". That reasoning fails because nothing was measured in between. The two branches are still amplitudes, and the second H makes the |1⟩ paths cancel by destructive interference. Randomness only becomes irreversible once a measurement records it.',
  },
  {
    id: 'f07',
    kind: 'multi',
    lessonSlug: 'superposition-and-measurement',
    points: 2,
    prompt: 'Select all that are true of a computational-basis measurement on a single qubit.',
    options: [
      { id: 'a', text: 'It yields one classical bit.' },
      { id: 'b', text: 'It is irreversible — the pre-measurement amplitudes cannot be recovered.' },
      { id: 'c', text: 'Its outcome probabilities are the squared magnitudes of the amplitudes.' },
      { id: 'd', text: 'It reveals both α and β to the experimenter.' },
      { id: 'e', text: 'It leaves the state unchanged.' },
    ],
    correctIds: ['a', 'b', 'c'],
    explanation:
      'A, B and C are the Born rule and collapse in three sentences. D is the fundamental limitation of the whole field: one measurement of one copy gives one bit, and no amount of cleverness extracts two continuous parameters from it — estimating α and β requires many identically prepared copies. E is true only of gates, which are unitary; measurement is the one operation in the model that is not.',
  },
  {
    id: 'f08',
    kind: 'circuit-outcome',
    lessonSlug: 'superposition-and-measurement',
    points: 2,
    prompt: 'Which measurement outcomes are possible for this circuit? Select all that apply.',
    qasm: `OPENQASM 2.0;
include "qelib1.inc";
qreg q[1];
creg c[1];
h q[0];
h q[0];
measure q[0] -> c[0];`,
    options: [
      { id: 'a', text: '0' },
      { id: 'b', text: '1' },
    ],
    correctIds: ['a'],
    explanation:
      'The first H sends |0⟩ to (|0⟩+|1⟩)/√2; the second H sends that back to |0⟩, because the two paths leading to |1⟩ arrive with opposite signs and cancel. The outcome is 0 every single shot. If you expected both, you were treating the intermediate superposition as a coin that had already been flipped — it had not been, because no measurement occurred between the gates.',
  },
  {
    id: 'f09',
    kind: 'single',
    lessonSlug: 'interference',
    points: 2,
    prompt: 'What makes quantum interference possible, and impossible for classical probabilities?',
    options: [
      { id: 'a', text: 'Amplitudes can be negative or complex, so two paths to the same outcome can cancel; probabilities are non-negative and can only accumulate.' },
      { id: 'b', text: 'Quantum states can hold more paths than classical ones, so more of them cancel.' },
      { id: 'c', text: 'Measurement adds noise that occasionally erases outcomes.' },
      { id: 'd', text: 'Entanglement between paths forces one of them to vanish.' },
    ],
    correctIds: ['a'],
    explanation:
      'Interference is a statement about signs, not about size. Adding two non-negative probabilities can only make the total larger; adding +1/√2 and −1/√2 gives exactly zero. B mistakes quantity for the mechanism. C attributes a systematic, repeatable cancellation to noise, which would not reproduce shot after shot. D is a different phenomenon entirely — single-qubit interference happens with no entanglement anywhere in the circuit.',
  },
  {
    id: 'f10',
    kind: 'circuit-outcome',
    lessonSlug: 'interference',
    points: 2,
    prompt: 'Which measurement outcomes are possible for this circuit? Select all that apply.',
    qasm: `OPENQASM 2.0;
include "qelib1.inc";
qreg q[1];
creg c[1];
h q[0];
z q[0];
h q[0];
measure q[0] -> c[0];`,
    options: [
      { id: 'a', text: '0' },
      { id: 'b', text: '1' },
    ],
    correctIds: ['b'],
    explanation:
      'H·Z·H = X, so this circuit is a NOT gate built out of a phase flip. Step by step: H takes |0⟩ to (|0⟩+|1⟩)/√2, Z flips the sign of the |1⟩ term giving (|0⟩−|1⟩)/√2, and the final H turns that into |1⟩. The outcome is 1 on every shot. The trap is thinking Z "does nothing observable" because it never changes any measurement probability on its own — true in isolation, false the moment another H converts that relative phase back into an amplitude difference.',
  },
  {
    id: 'f11',
    kind: 'numeric',
    lessonSlug: 'interference',
    points: 2,
    prompt:
      'The gates H, then S, then H are applied to |0⟩, and the qubit is measured. What is P(1)? Give a decimal between 0 and 1.',
    correctNumber: 0.5,
    tolerance: 0.001,
    explanation:
      'H gives (|0⟩+|1⟩)/√2. S multiplies the |1⟩ amplitude by i, giving (|0⟩+i|1⟩)/√2. The final H gives ((1+i)|0⟩ + (1−i)|1⟩)/2, and |1−i|²/4 = 2/4 = 0.5. So this circuit is a fair coin. Contrast it with H-Z-H, which is deterministic: a quarter turn of phase leaves the interference exactly half-constructive, while a half turn makes it fully destructive. Phase is a continuous dial, not a switch.',
  },
  // Tunnelling sits fourth in the track, between interference and gates, so the
  // items live here — but they carry ids f26–f29 rather than being renumbered
  // into sequence. Question ids are referenced by stored attempts and by
  // ADVANCED_PREREQ_IDS below; reusing f12 for a new question would silently
  // regrade every attempt already in a learner's localStorage.
  {
    id: 'f26',
    kind: 'single',
    lessonSlug: 'tunneling',
    points: 1,
    prompt:
      'A particle of energy E is inside a region where the potential is V > E. What does the Schrödinger equation give for ψ there, and why?',
    options: [
      { id: 'a', text: 'A real exponential e^{−κx}: with E < V the curvature equation reads d²ψ/dx² = +κ²ψ, which bends ψ away from the axis instead of back toward it.' },
      { id: 'b', text: 'An oscillation of shorter wavelength, because the particle has less kinetic energy left inside the barrier.' },
      { id: 'c', text: 'Exactly zero, because the region is classically forbidden and the probability of being found there is zero.' },
      { id: 'd', text: 'An oscillation of the same wavelength but reduced amplitude, because the barrier attenuates the wave uniformly.' },
    ],
    correctIds: ['a'],
    explanation:
      'The sign of V − E decides everything. Written as d²ψ/dx² = (2m/ħ²)(V − E)ψ, a positive coefficient means the curve always bends away from the axis, so it can never turn over and cross zero — the solutions are e^{±κx} with κ = √(2m(V − E))/ħ, and only the decaying one is admissible. B is the most instructive wrong answer: less kinetic energy would mean a LONGER wavelength, not a shorter one, and in any case for E < V there is no real k to build a wavelength from — that is precisely the point, since a non-oscillating ψ has no local wavelength and hence no local momentum to argue about. C states the classical result, which continuity of ψ and ψ′ forbids: ψ cannot drop to zero at the barrier face without an infinite curvature there. D keeps the wave oscillating and merely shrinks it, which no solution of the equation does.',
  },
  {
    id: 'f27',
    kind: 'numeric',
    lessonSlug: 'tunneling',
    points: 2,
    prompt:
      'A barrier transmits electrons with probability T = 10⁻⁶. Its width is then increased by 50%, with the height and the electron energy unchanged. The new transmission is about 10ⁿ. Give n.',
    correctNumber: -9,
    tolerance: 0.5,
    explanation:
      'T is dominated by e^{−2κw}, and κ depends only on m, V and E — none of which changed. Multiplying w by 1.5 multiplies the exponent by 1.5, so T → T^1.5 = (10⁻⁶)^1.5 = 10⁻⁹. Half again as much barrier costs a further factor of a thousand. The answer −6.5 comes from treating "50% wider" as a 50% penalty, and −4 from imagining the polynomial prefactor 16(E/V)(1 − E/V) is where the action is; it is bounded above by 4 and can never move the answer by an order of magnitude. This exponential lever is the whole engineering story: it is why an STM resolves single atoms, and why a tunnel oxide a nanometre thicker buys years of flash retention.',
  },
  {
    id: 'f28',
    kind: 'multi',
    lessonSlug: 'tunneling',
    points: 2,
    prompt: 'Select all statements that are true of a particle tunnelling through a rectangular barrier of height V₀ > E.',
    options: [
      { id: 'a', text: 'The transmitted particle is measured to have energy E — exactly what it arrived with.' },
      { id: 'b', text: 'Transmission falls exponentially with the barrier width.' },
      { id: 'c', text: 'At fixed E and V₀, a heavier particle tunnels less readily, because κ grows as √m.' },
      { id: 'd', text: 'The particle briefly borrows energy from the vacuum, allowed by ΔEΔt ≳ ħ/2, and repays it on the far side.' },
      { id: 'e', text: 'Because the transmitted peak can emerge earlier than a light signal would, tunnelling can be used to send information faster than light.' },
    ],
    correctIds: ['a', 'b', 'c'],
    explanation:
      'A, B and C are the physics: the calculation runs at one fixed E throughout — that is what "time-independent" means — and κ = √(2m(V₀ − E))/ħ puts both the width and the mass into the exponent, which is why electrons tunnel out of flash cells while atoms essentially never do. D is the borrowed-energy story, the most persistent misconception about tunnelling: nothing is borrowed, the particle never goes over the top, and the energy-time relation is a statement about the spread of energies in a state of finite duration, not a line of credit. E invokes the Hartman effect, which is real but misread: the transmitted packet is a reshaped, heavily attenuated remnant of the leading edge of the incident one, no part of the wave front ever exceeds c, and no signal arrives early — the peak is not a message. Note too that A is a statement about the particle detected on the far side; ψ inside the barrier does not oscillate, so there is no definite kinetic energy to assign there, and any measurement sharp enough to localise the particle inside would itself supply energy comparable to V₀.',
  },
  {
    id: 'f29',
    kind: 'single',
    lessonSlug: 'tunneling',
    points: 2,
    prompt:
      'Uranium-238 emits a 4.27 MeV alpha particle and has a half-life of 4.5 billion years; polonium-212 emits an 8.78 MeV alpha and has a half-life of 294 nanoseconds. Both alphas start far below a Coulomb barrier peaking near 26 MeV. What best explains twenty-four orders of magnitude of half-life from a factor of two in energy?',
    options: [
      { id: 'a', text: 'The higher-energy alpha faces both a smaller V − E and a narrower barrier, and transmission depends exponentially on both.' },
      { id: 'b', text: 'The polonium alpha simply has enough energy to pass over the Coulomb barrier classically, while the uranium alpha does not.' },
      { id: 'c', text: 'Polonium-212 is the lighter nucleus, and lighter nuclei are less tightly bound, so the alpha escapes without tunnelling.' },
      { id: 'd', text: 'Nuclear half-lives are intrinsically random, so no mechanism relates them to the emitted energy.' },
    ],
    correctIds: ['a'],
    explanation:
      'Raising E shrinks κ = √(2m(V − E))/ħ and, because the Coulomb barrier narrows as you go up it, also moves the outer turning point inward — so both factors in the exponent improve at once, and an exponent is exactly the machinery that turns a factor of two into twenty-four orders of magnitude. This is the Geiger–Nuttall law, and it is e^{−2κw} plotted on a log axis. B is arithmetically false: 8.78 MeV is still nowhere near a 26 MeV barrier top, so polonium tunnels too, merely far more often. C invents an escape route the strong force does not permit and gets the binding argument backwards. D confuses the randomness of an individual decay with the rate: each decay is unpredictable, but the decay CONSTANT is set by the tunnelling probability per barrier assault, and Gamow computed it in 1928.',
  },
  {
    id: 'f12',
    kind: 'single',
    lessonSlug: 'gates-and-circuits',
    points: 1,
    prompt: 'Why must every quantum gate be reversible?',
    options: [
      { id: 'a', text: 'Gates are unitary matrices, and every unitary has an inverse that is also a valid gate.' },
      { id: 'b', text: 'Because quantum computers must be able to undo mistakes at runtime.' },
      { id: 'c', text: 'Because reversible circuits run faster on real hardware.' },
      { id: 'd', text: 'They need not be — measurement is a gate, and it is irreversible.' },
    ],
    correctIds: ['a'],
    explanation:
      'Unitarity is the constraint that preserves total probability under time evolution, and U†U = I is literally the existence of an inverse. B and C are engineering rationalisations for what is a structural fact of the model. D is a definitional slip worth being precise about: measurement is an operation you can perform, but it is not a gate, and it is exactly the operation that breaks reversibility. This is also why classical AND has no direct quantum counterpart — it loses information — and why Toffoli is used instead.',
  },
  {
    id: 'f13',
    kind: 'multi',
    lessonSlug: 'gates-and-circuits',
    points: 2,
    prompt: 'Select all that are true of the Hadamard gate.',
    options: [
      { id: 'a', text: 'It maps |0⟩ to (|0⟩+|1⟩)/√2 and |1⟩ to (|0⟩−|1⟩)/√2.' },
      { id: 'b', text: 'It is its own inverse.' },
      { id: 'c', text: 'It is a single-qubit gate.' },
      { id: 'd', text: 'It creates entanglement between two qubits.' },
      { id: 'e', text: 'It makes a qubit output a random bit, permanently.' },
    ],
    correctIds: ['a', 'b', 'c'],
    explanation:
      'A is the definition, and the minus sign in the second line is the entire reason H·H = I (B). D is the most common confusion in the course: entanglement needs a two-qubit gate — H prepares the superposition, and it is the CNOT that entangles. E treats H as a randomiser, but H is deterministic and reversible; the randomness is in the measurement you choose to do afterwards, and H-H demonstrates that it is not baked in.',
  },
  {
    id: 'f14',
    kind: 'circuit-outcome',
    lessonSlug: 'gates-and-circuits',
    points: 2,
    prompt:
      'Which measurement outcomes are possible for this circuit? Outcomes are written q1q0. Select all that apply.',
    qasm: `OPENQASM 2.0;
include "qelib1.inc";
qreg q[2];
creg c[2];
h q[0];
h q[1];
measure q -> c;`,
    options: [
      { id: 'a', text: '00' },
      { id: 'b', text: '01' },
      { id: 'c', text: '10' },
      { id: 'd', text: '11' },
    ],
    correctIds: ['a', 'b', 'c', 'd'],
    explanation:
      'Two independent Hadamards give the product state (|0⟩+|1⟩)/√2 ⊗ (|0⟩+|1⟩)/√2, which is an equal superposition over all four basis states — each outcome at 25%. This state is emphatically not entangled: the qubits are uncorrelated, and learning q0 tells you nothing about q1. Compare it with the Bell state, which has the same "two possible answers" feel on each qubit but permits only 00 and 11.',
  },
  {
    id: 'f15',
    kind: 'circuit-outcome',
    lessonSlug: 'gates-and-circuits',
    points: 2,
    prompt:
      'Which measurement outcomes are possible for this circuit? Outcomes are written q1q0. Select all that apply.',
    qasm: `OPENQASM 2.0;
include "qelib1.inc";
qreg q[2];
creg c[2];
h q[0];
cz q[0],q[1];
h q[0];
measure q -> c;`,
    options: [
      { id: 'a', text: '00' },
      { id: 'b', text: '01' },
      { id: 'c', text: '10' },
      { id: 'd', text: '11' },
    ],
    correctIds: ['a'],
    explanation:
      'q1 is never touched, so it stays |0⟩ throughout. CZ only applies a phase when BOTH qubits are |1⟩, and since q1 is always |0⟩ the CZ does nothing at all here. That leaves H followed by H on q0, which is the identity. The only outcome is 00. The misconception being tested is that a two-qubit gate entangles unconditionally — a controlled gate with a control that is definitely |0⟩ is just a very expensive no-op.',
  },
  {
    id: 'f16',
    kind: 'single',
    lessonSlug: 'gates-and-circuits',
    points: 1,
    prompt: 'Two states differ only by a global phase: |ψ⟩ and e^{iπ/3}|ψ⟩. How do they differ physically?',
    options: [
      { id: 'a', text: 'They do not — no measurement of any kind can distinguish them.' },
      { id: 'b', text: 'They give different measurement probabilities in the computational basis.' },
      { id: 'c', text: 'They are distinguishable, but only by measuring in the X basis.' },
      { id: 'd', text: 'They become distinguishable once the qubit is entangled with another.' },
    ],
    correctIds: ['a'],
    explanation:
      'A global phase multiplies every amplitude by the same unit-modulus factor, which cancels out of |amplitude|² for every possible measurement in every possible basis. C and D are the useful trap, because the analogous statement about RELATIVE phase is true — a relative phase is invisible in the Z basis but plainly visible in the X basis. Keeping the two straight is the whole point: relative phase is physics, global phase is bookkeeping.',
  },
  {
    id: 'f17',
    kind: 'single',
    lessonSlug: 'entanglement',
    points: 2,
    prompt:
      'Alice and Bob each hold one qubit of the Bell state (|00⟩+|11⟩)/√2 and are light-years apart. Alice measures hers. Which statement is correct?',
    options: [
      { id: 'a', text: 'Bob\'s outcomes are now perfectly correlated with Alice\'s, but his local measurement statistics are unchanged, so no information has been sent.' },
      { id: 'b', text: 'Alice\'s measurement sends a signal to Bob\'s qubit, which is how the correlation is enforced.' },
      { id: 'c', text: 'Bob can tell that Alice measured by looking at his own qubit alone.' },
      { id: 'd', text: 'The correlation only appears if Bob measures first.' },
    ],
    correctIds: ['a'],
    explanation:
      'Bob\'s qubit is in a maximally mixed state both before and after Alice acts: he sees 50/50 either way, and there is no experiment on his half alone that reveals whether, when, or in which basis Alice measured. That is the no-signalling theorem, and it is why entanglement does not transmit information faster than light. B is the "spooky telegram" misconception; C is the same claim restated operationally, and its falsity is exactly what makes B untenable. The correlation is real, but you only see it by bringing the two records together over a classical channel — which travels at ordinary speed.',
  },
  {
    id: 'f18',
    kind: 'circuit-outcome',
    lessonSlug: 'entanglement',
    points: 2,
    prompt:
      'Which measurement outcomes are possible for this circuit? Outcomes are written q1q0. Select all that apply.',
    qasm: `OPENQASM 2.0;
include "qelib1.inc";
qreg q[2];
creg c[2];
h q[0];
cx q[0],q[1];
x q[1];
measure q -> c;`,
    options: [
      { id: 'a', text: '00' },
      { id: 'b', text: '01' },
      { id: 'c', text: '10' },
      { id: 'd', text: '11' },
    ],
    correctIds: ['b', 'c'],
    explanation:
      'H then CX builds the Bell state (|00⟩+|11⟩)/√2, whose only outcomes are 00 and 11. The final X flips q1 in both branches, turning |00⟩ into |10⟩ and |11⟩ into |01⟩. So the state is (|10⟩+|01⟩)/√2 and the outcomes are 01 and 10, each 50%. This is the anti-correlated Bell state: still maximally entangled, still two outcomes, but the qubits now always disagree. Applying a local gate after entangling does not destroy the entanglement — it relabels which correlations you see.',
  },
  {
    id: 'f19',
    kind: 'multi',
    lessonSlug: 'entanglement',
    points: 2,
    prompt: 'Select all that are true of the Bell state (|00⟩+|11⟩)/√2.',
    options: [
      { id: 'a', text: 'It cannot be written as a product of two single-qubit states.' },
      { id: 'b', text: 'Measuring either qubit alone gives 0 or 1 with equal probability.' },
      { id: 'c', text: 'The two measurement outcomes always agree.' },
      { id: 'd', text: 'It can be prepared with single-qubit gates alone.' },
      { id: 'e', text: 'It permits faster-than-light communication between the holders.' },
    ],
    correctIds: ['a', 'b', 'c'],
    explanation:
      'A is the definition of entanglement — non-separability — and B and C are its operational signature: individually random, jointly perfectly correlated. D is false and is the reason the CNOT matters at all; no product of single-qubit unitaries acting on |00⟩ can ever produce a non-separable state. E is the no-signalling misconception: perfect correlation is not a channel, because neither party can choose what their own outcome will be.',
  },
  {
    id: 'f20',
    kind: 'numeric',
    lessonSlug: 'entanglement',
    points: 1,
    prompt:
      'The Bell state (|00⟩+|11⟩)/√2 is measured 1000 times in the computational basis. Roughly how many shots give the outcome |01⟩?',
    correctNumber: 0,
    tolerance: 5,
    explanation:
      'The |01⟩ term has amplitude zero, so on an ideal simulator it never appears — the answer is 0. The tempting answer is 250, from assuming four outcomes must be equally likely because each qubit "looks" 50/50 on its own. That reasoning silently assumes the qubits are independent, which is precisely what entanglement denies. On real hardware you would see a small non-zero count from readout error, which is why this number is a standard sanity check on a device.',
  },
  {
    id: 'f21',
    kind: 'circuit-outcome',
    lessonSlug: 'entanglement',
    points: 2,
    prompt:
      'Which measurement outcomes are possible for this circuit? Outcomes are written q2q1q0. Select all that apply.',
    qasm: `OPENQASM 2.0;
include "qelib1.inc";
qreg q[3];
creg c[3];
h q[0];
cx q[0],q[1];
cx q[1],q[2];
measure q -> c;`,
    options: [
      { id: 'a', text: '000' },
      { id: 'b', text: '011' },
      { id: 'c', text: '101' },
      { id: 'd', text: '111' },
    ],
    correctIds: ['a', 'd'],
    explanation:
      'This is the GHZ state (|000⟩+|111⟩)/√2. Track the two branches: the |0⟩ branch of q0 leaves both CNOTs inactive, giving |000⟩; the |1⟩ branch flips q1, and that freshly-flipped q1 then controls the second CNOT and flips q2, giving |111⟩. Only 000 and 111 occur, each at 50%. The chain matters — the second CNOT is controlled by q1, not by q0, and it is the fact that q1 is already correlated with q0 that propagates the correlation to all three.',
  },
  {
    id: 'f22',
    kind: 'single',
    lessonSlug: 'grover',
    points: 2,
    prompt: 'What speedup does Grover\'s algorithm give over classical unstructured search?',
    options: [
      { id: 'a', text: 'Quadratic: about √N oracle calls instead of about N.' },
      { id: 'b', text: 'Exponential: log N oracle calls instead of about N.' },
      { id: 'c', text: 'It finds the answer in a single query by checking all N items in parallel.' },
      { id: 'd', text: 'None asymptotically; the advantage is only a constant factor.' },
    ],
    correctIds: ['a'],
    explanation:
      'Grover needs Θ(√N) queries, and this is provably optimal for an unstructured oracle. B overstates it — the exponential speedups live elsewhere, in Shor and in simulation of quantum systems. C is the "quantum parallelism" misconception: the superposition does touch all N items, but a measurement returns one outcome, so the parallelism is worthless without the amplitude amplification that Grover supplies. D understates a genuinely asymptotic result.',
  },
  {
    id: 'f23',
    kind: 'numeric',
    lessonSlug: 'grover',
    points: 2,
    prompt:
      'Grover\'s algorithm searches an unstructured database of N = 16 items with a single marked item. What is the optimal number of Grover iterations? Give a whole number.',
    correctNumber: 3,
    tolerance: 0.5,
    explanation:
      'The optimal count is the nearest integer to (π/4)√N. With N = 16 that is (π/4)·4 = π ≈ 3.14, so 3 iterations. Answering 4 (from √N alone) or 16 both overshoot, and overshooting genuinely hurts: the amplitude of the marked item rotates past the target and starts coming back down.',
  },
  {
    id: 'f24',
    kind: 'single',
    lessonSlug: 'grover',
    points: 2,
    prompt: 'What happens if you run substantially more than the optimal number of Grover iterations?',
    options: [
      { id: 'a', text: 'The success probability falls again — the state over-rotates past the marked item.' },
      { id: 'b', text: 'The success probability keeps rising and saturates at 1.' },
      { id: 'c', text: 'The algorithm errors out and returns no result.' },
      { id: 'd', text: 'Nothing changes; extra iterations are idempotent.' },
    ],
    correctIds: ['a'],
    explanation:
      'Each Grover iteration is a fixed rotation in a two-dimensional plane spanned by the marked state and the uniform superposition of the rest. Rotation is periodic, so going too far carries you back down — run about twice the optimum and you are close to where you started. B is the "more is better" intuition imported from classical iterative algorithms, and it is the single most common mistake when implementing Grover: knowing when to stop requires knowing N and the number of solutions in advance.',
  },
  {
    id: 'f25',
    kind: 'multi',
    lessonSlug: 'grover',
    points: 2,
    prompt: 'Select all that are true of Grover\'s algorithm.',
    options: [
      { id: 'a', text: 'It works on an unstructured search problem defined by an oracle.' },
      { id: 'b', text: 'The diffusion operator reflects amplitudes about their mean.' },
      { id: 'c', text: 'The number of iterations must be chosen in advance and depends on N.' },
      { id: 'd', text: 'It breaks RSA encryption.' },
      { id: 'e', text: 'It returns the marked item with certainty after one oracle call.' },
    ],
    correctIds: ['a', 'b', 'c'],
    explanation:
      'A, B and C are the algorithm: an oracle that flips the sign of the marked amplitude, a diffusion step that inverts every amplitude about the mean, and a stopping point at roughly (π/4)√N. D belongs to Shor — Grover only halves the effective bit-strength of a symmetric key, which is why the standard response is to double AES key lengths rather than to abandon them. E is the one-query fantasy that C already rules out.',
  },

  // ────────────────────────────────────────────────────────────
  // Second wave: f30–f58.
  //
  // Written to make a resit a different paper. Same seven lessons, a wider
  // difficulty spread (1-point recall through 3-point items that need two
  // ideas combined), and where an item overlaps an earlier one it attacks the
  // same concept from the other side — f36 is H·X·H where f08 was H·H, f51 is
  // the Bell state that survives H⊗H where f18 was the one that gets relabelled.
  // ────────────────────────────────────────────────────────────

  {
    id: 'f30',
    kind: 'numeric',
    lessonSlug: 'what-is-a-qubit',
    points: 1,
    prompt:
      'A qubit is in the state (1/2)|0⟩ + (√3/2)|1⟩. What is the probability of measuring 1? Give a decimal between 0 and 1.',
    correctNumber: 0.75,
    tolerance: 0.001,
    explanation:
      'P(1) = |β|² = (√3/2)² = 3/4 = 0.75. Two checks worth doing every time: the amplitudes square to 0.25 + 0.75 = 1, as any legal state must, and the larger amplitude belongs to the more likely outcome. Answering 0.866 is the recurring error of quoting the amplitude itself.',
  },
  {
    id: 'f31',
    kind: 'single',
    lessonSlug: 'what-is-a-qubit',
    points: 2,
    prompt:
      'On the Bloch sphere, a qubit state is fixed by two angles: θ from the north pole and φ around the equator. What does φ correspond to?',
    options: [
      { id: 'a', text: 'The relative phase between the |0⟩ and |1⟩ amplitudes.' },
      { id: 'b', text: 'The global phase of the state.' },
      { id: 'c', text: 'How likely the qubit is to be measured as 1.' },
      { id: 'd', text: 'How mixed the state is — how much it has decohered.' },
    ],
    correctIds: ['a'],
    explanation:
      'Longitude is relative phase, and it is why the sphere has an equator at all: |+⟩, |−⟩, |+i⟩ and |−i⟩ all sit on it with identical Z-measurement statistics and completely different X and Y statistics. B is the useful trap — global phase has no representation on the sphere whatsoever, which is exactly the point of drawing states this way. C is θ, the latitude. D is the radius: pure states sit on the surface, and decoherence pulls the vector inward, which is why the Bloch BALL and not just the sphere is the full state space.',
  },
  {
    id: 'f32',
    kind: 'single',
    lessonSlug: 'what-is-a-qubit',
    points: 2,
    prompt:
      'A qubit\'s state is described by two continuous complex numbers. How many classical bits can a recipient reliably extract from one qubit they are handed once?',
    options: [
      { id: 'a', text: 'One.' },
      { id: 'b', text: 'Two, by superdense coding.' },
      { id: 'c', text: 'Unbounded in principle, since the amplitudes are continuous real numbers.' },
      { id: 'd', text: 'None — a single copy carries no recoverable information.' },
    ],
    correctIds: ['a'],
    explanation:
      'Holevo\'s bound: n qubits carry at most n classical bits of accessible information, however cleverly they were encoded. C is the seductive one — the amplitudes really are continuous, and you really cannot read them, because one measurement yields one outcome and the state is gone. B is true only with a resource the question does not give you: superdense coding sends two bits down one qubit, but only when sender and receiver already share an entangled pair, so the two qubits between them still carry two bits. D overcorrects: one bit is genuinely recoverable, and that is what the whole computational basis is for.',
  },
  {
    id: 'f33',
    kind: 'multi',
    lessonSlug: 'what-is-a-qubit',
    points: 2,
    prompt: 'Select every expression below that is a legal single-qubit state.',
    options: [
      { id: 'a', text: '0.6|0⟩ + 0.8i|1⟩' },
      { id: 'b', text: '(|0⟩ − i|1⟩)/√2' },
      { id: 'c', text: '(3/5)|0⟩ − (4/5)|1⟩' },
      { id: 'd', text: '0.5|0⟩ + 0.5|1⟩' },
      { id: 'e', text: '|0⟩ + |1⟩' },
    ],
    correctIds: ['a', 'b', 'c'],
    explanation:
      'The only requirement is |α|² + |β|² = 1. A passes because |0.8i|² = 0.64, not −0.64 — squaring a magnitude, not the number. C passes and shows that a minus sign is perfectly ordinary. D and E are the same error at different scales: 0.25 + 0.25 = 0.5 and 1 + 1 = 2, so both describe a qubit that has a 50% and a 200% chance of doing something. E is the one people write most often, because it is how the state is spoken aloud — "|0⟩ plus |1⟩" — with the 1/√2 left implicit.',
  },
  {
    id: 'f34',
    kind: 'single',
    lessonSlug: 'what-is-a-qubit',
    points: 2,
    prompt:
      'A qubit is prepared in |0⟩ — a completely definite state — and then measured along the X axis. What is seen?',
    options: [
      { id: 'a', text: '+ and − with equal probability: |0⟩ is an equal superposition in the X basis.' },
      { id: 'b', text: '+ every time, since |0⟩ is a definite state and measurement just reports it.' },
      { id: 'c', text: 'Nothing well defined — X measurements are only meaningful on superpositions.' },
      { id: 'd', text: '+ or − depending on how the qubit was manufactured.' },
    ],
    correctIds: ['a'],
    explanation:
      '|0⟩ = (|+⟩ + |−⟩)/√2, so along X it is maximally uncertain. "Definite" is never a property of a state alone; it is a property of a state relative to a measurement, and every state is definite along exactly one axis and maximally random along the two perpendicular to it. B treats definiteness as absolute, which is the same mistake as expecting a spin prepared along z to have a fixed value of x. D is the hidden-variable answer, ruled out by the fact that these statistics are identical for every qubit in every laboratory.',
  },

  {
    id: 'f35',
    kind: 'single',
    lessonSlug: 'superposition-and-measurement',
    points: 3,
    prompt:
      'A qubit is prepared in |+⟩, measured along Z (giving 0), and then measured along X. What does the X measurement give?',
    options: [
      { id: 'a', text: '+ or − with equal probability — the Z measurement destroyed the definite X value.' },
      { id: 'b', text: '+ with certainty, because the qubit was prepared in |+⟩.' },
      { id: 'c', text: '+ or − with equal probability, but only because the preparation was imperfect.' },
      { id: 'd', text: '0 with certainty, since the qubit is now in |0⟩ and stays there.' },
    ],
    correctIds: ['a'],
    explanation:
      'The Z measurement projected the state onto |0⟩, and |0⟩ is an equal superposition along X — so the X result is a fresh coin flip. B is the trap: the preparation is genuinely gone, and this sequence is the standard demonstration that measurements of non-commuting observables destroy each other\'s information no matter what order you use. C blames apparatus for what the postulates require. D confuses the qubit\'s state with its label — it is in |0⟩, but "in |0⟩" says nothing definite about an X measurement.',
  },
  {
    id: 'f36',
    kind: 'circuit-outcome',
    lessonSlug: 'superposition-and-measurement',
    points: 2,
    prompt: 'Which measurement outcomes are possible for this circuit? Select all that apply.',
    qasm: `OPENQASM 2.0;
include "qelib1.inc";
qreg q[1];
creg c[1];
h q[0];
x q[0];
h q[0];
measure q[0] -> c[0];`,
    explanation:
      'H·X·H = Z, and Z leaves |0⟩ exactly where it is, so the outcome is 0 on every shot. Work it through: H gives (|0⟩+|1⟩)/√2, X swaps the two amplitudes and they are equal, so the state is unchanged, and the second H undoes the first. The X gate — the one gate everyone thinks of as "the flip" — is completely invisible here. Sandwiching a gate between Hadamards swaps its axis: X becomes Z and Z becomes X, which is the identity behind the previous question and behind the Grover diffusion operator.',
    options: [
      { id: 'a', text: '0' },
      { id: 'b', text: '1' },
    ],
    correctIds: ['a'],
  },
  {
    id: 'f37',
    kind: 'numeric',
    lessonSlug: 'superposition-and-measurement',
    points: 2,
    prompt:
      'A qubit is prepared in √0.3|0⟩ + √0.7|1⟩ and measured 200 times, re-prepared identically before each shot. About how many shots read 1?',
    correctNumber: 140,
    tolerance: 5,
    explanation:
      '200 × 0.7 = 140. The re-preparation is the load-bearing part of the question: without it the first measurement collapses the state and all 200 shots agree, which is exactly what "shots" means on real hardware — the circuit is rebuilt from scratch every time. Answering about 168 comes from using the amplitude √0.7 ≈ 0.837 instead of the probability.',
  },
  {
    id: 'f38',
    kind: 'multi',
    lessonSlug: 'superposition-and-measurement',
    points: 3,
    prompt: 'A qubit is in |+⟩ and is measured in the X basis. Select all that are true.',
    options: [
      { id: 'a', text: 'The outcome is + with certainty.' },
      { id: 'b', text: 'The state is unchanged by this measurement.' },
      { id: 'c', text: 'A Z-basis measurement afterwards gives 0 or 1 with equal probability.' },
      { id: 'd', text: 'Measuring in the X basis is not a valid quantum measurement — only Z-basis measurements exist.' },
      { id: 'e', text: 'Repeating the X measurement could give − about half the time.' },
    ],
    correctIds: ['a', 'b', 'c'],
    explanation:
      'A and B are the same fact twice: |+⟩ is an eigenstate of X, so the outcome is certain and the projection does nothing — measurement only disturbs a state that was not already definite in that basis, which is why E is false. C follows because a definite X value forces maximal Z uncertainty. D is false: any basis is a valid measurement basis, and an X measurement is a perfectly good quantum measurement. A real device typically implements it by applying H and then measuring Z, but that is an implementation detail, not a restriction on what can be measured.',
  },

  {
    id: 'f39',
    kind: 'circuit-outcome',
    lessonSlug: 'interference',
    points: 2,
    prompt: 'Which measurement outcomes are possible for this circuit? Select all that apply.',
    qasm: `OPENQASM 2.0;
include "qelib1.inc";
qreg q[1];
creg c[1];
h q[0];
s q[0];
s q[0];
h q[0];
measure q[0] -> c[0];`,
    options: [
      { id: 'a', text: '0' },
      { id: 'b', text: '1' },
    ],
    correctIds: ['b'],
    explanation:
      'S is a quarter turn about Z, so two of them make a half turn: S·S = Z exactly. The circuit is therefore H·Z·H = X, and the outcome is 1 every shot. Compare it with the H-S-H circuit, which is a fair coin: one quarter turn leaves the interference half-constructive, two make it fully destructive on the |0⟩ path. The phase is a dial, and this question and that one are two positions on it.',
  },
  {
    id: 'f40',
    kind: 'numeric',
    lessonSlug: 'interference',
    points: 3,
    prompt:
      'The gates H, then T, then H are applied to |0⟩, and the qubit is measured. What is P(1)? Give a decimal between 0 and 1, to at least two places.',
    correctNumber: 0.1464,
    tolerance: 0.005,
    explanation:
      'T is an eighth turn: after H the state is (|0⟩+|1⟩)/√2, T sends it to (|0⟩ + e^{iπ/4}|1⟩)/√2, and the final H gives a |1⟩ amplitude of (1 − e^{iπ/4})/2. Its squared magnitude is (2 − 2cos(π/4))/4 = 0.1464. Sanity-check it against the two cases you already know: with no middle gate P(1) = 0, with Z it is 1, with S it is 0.5 — and T, half of S, lands at 0.146 rather than 0.25, because the probability goes as (1 − cos φ)/2 and not linearly in φ. Answering 0.25 is the linear-interpolation error.',
  },
  {
    id: 'f41',
    kind: 'single',
    lessonSlug: 'interference',
    points: 3,
    prompt:
      'In a two-path interference experiment, a detector is added that records which path the particle took. The fringes disappear. Why?',
    options: [
      { id: 'a', text: 'The path record is now correlated with the particle, so the two paths lead to distinguishable final states and their amplitudes no longer add.' },
      { id: 'b', text: 'The detector physically jostles the particle, randomising its arrival position.' },
      { id: 'c', text: 'Observation collapses the wavefunction because a conscious observer is involved.' },
      { id: 'd', text: 'The detector absorbs half the particles, and too few are left to build up a pattern.' },
    ],
    correctIds: ['a'],
    explanation:
      'Interference requires the alternatives to be indistinguishable IN PRINCIPLE. Once anything — a detector, a stray photon, a spin left pointing the wrong way — carries a record of which path was taken, the two branches end in orthogonal states of the whole system and there is nothing to interfere. B is the momentum-kick story from Heisenberg\'s microscope; it gives the right answer in some setups but is not the mechanism, and quantum-eraser experiments prove it: erase the record afterwards, without touching the particle, and the fringes come back. C imports consciousness into a theory that never mentions it. D would reduce the count, not the contrast.',
  },
  {
    id: 'f42',
    kind: 'single',
    lessonSlug: 'interference',
    points: 2,
    prompt:
      'A fair coin flipped twice is still random. A Hadamard applied twice returns |0⟩ with certainty. What is the essential difference?',
    options: [
      { id: 'a', text: 'H is a reversible rotation on amplitudes that carry signs; a coin flip is an irreversible loss of information into probabilities that cannot cancel.' },
      { id: 'b', text: 'H is applied faster than the qubit can decohere, so the randomness has no time to set in.' },
      { id: 'c', text: 'The two H gates cancel because a Hadamard is its own inverse, and coin flips would cancel the same way if you flipped twice.' },
      { id: 'd', text: 'A coin has two outcomes and a qubit has infinitely many, so the analogy simply does not hold.' },
    ],
    correctIds: ['a'],
    explanation:
      'No randomness exists between the two Hadamards — the qubit is in a definite state, (|0⟩+|1⟩)/√2, and the second H makes the two routes to |1⟩ arrive with opposite signs and cancel. A coin flip is a measurement: it writes an outcome into the world, and nothing can un-write it. C is right that H is its own inverse but wrong about the coin: two flips do not cancel, because a flip is a measurement with no inverse — which is exactly the difference the question is asking about. B invokes timing for a result that holds at any speed on a perfect device.',
  },

  {
    id: 'f43',
    kind: 'numeric',
    lessonSlug: 'tunneling',
    points: 2,
    prompt:
      'A barrier transmits with probability T = 10⁻⁴. Its width is doubled, with height and particle energy unchanged. The new transmission is about 10ⁿ. Give n.',
    correctNumber: -8,
    tolerance: 0.5,
    explanation:
      'T ≈ e^{−2κw}, so doubling w squares T: (10⁻⁴)² = 10⁻⁸. Answering −2 halves the exponent instead of doubling it, and −4.3 comes from treating "twice as wide" as some modest linear penalty. The exponential is the entire engineering story: the same relation is why a scanning tunnelling microscope resolves single atoms — moving the tip one atomic radius closer multiplies the current by about a factor of ten.',
  },
  {
    id: 'f44',
    kind: 'single',
    lessonSlug: 'tunneling',
    points: 2,
    prompt:
      'A scanning tunnelling microscope holds its tip about one nanometre from a surface and measures a tunnelling current. Why does it resolve individual atoms, when the tip itself is far blunter than one atom?',
    options: [
      { id: 'a', text: 'Current falls by roughly an order of magnitude per 0.1 nm of extra gap, so the single closest atom of the tip carries almost all of it.' },
      { id: 'b', text: 'The tip is sharpened to a single atom by manufacture, so its resolution is geometric.' },
      { id: 'c', text: 'The electrons have a de Broglie wavelength smaller than an atom, so diffraction sets the resolution.' },
      { id: 'd', text: 'The surface atoms are imaged one at a time as the tip physically touches each in turn.' },
    ],
    correctIds: ['a'],
    explanation:
      'Exponential sensitivity converts a blunt probe into a sharp one: whichever atom of the tip happens to protrude furthest is exponentially closer to the surface than its neighbours and therefore dominates the current. B has cause and effect backwards — tips are not reliably single-atom, and the physics is what rescues them. C is the resolution argument for an electron microscope, a different instrument. D describes contact, which would destroy both tip and sample; the STM never touches.',
  },
  {
    id: 'f45',
    kind: 'multi',
    lessonSlug: 'tunneling',
    points: 3,
    prompt: 'Select all statements about quantum tunnelling that are true.',
    options: [
      { id: 'a', text: 'It sets the rate of alpha decay, and hence the enormous spread of nuclear half-lives.' },
      { id: 'b', text: 'It is the leakage mechanism that limits how thin a transistor gate oxide can be made.' },
      { id: 'c', text: 'It is how charge is written to and erased from flash memory cells.' },
      { id: 'd', text: 'It lets a particle be found beyond the barrier with more energy than it started with.' },
      { id: 'e', text: 'It is the mechanism by which a quantum computer explores every branch of a superposition.' },
    ],
    correctIds: ['a', 'b', 'c'],
    explanation:
      'A, B and C are the same exponential in three industries — Gamow\'s 1928 calculation of alpha decay, the gate leakage that ended straightforward oxide scaling around 1.2 nm, and Fowler–Nordheim tunnelling through the tunnel oxide of a flash cell. D violates energy conservation; tunnelling transmits at the energy the particle arrived with, and there is no energy loan. E is a category error that gets made surprisingly often: superposition and interference are what a quantum computer runs on, and no barrier or potential is involved.',
  },

  {
    id: 'f46',
    kind: 'circuit-outcome',
    lessonSlug: 'gates-and-circuits',
    points: 1,
    prompt:
      'Which measurement outcomes are possible for this circuit? Outcomes are written q1q0. Select all that apply.',
    qasm: `OPENQASM 2.0;
include "qelib1.inc";
qreg q[2];
creg c[2];
x q[0];
cx q[0],q[1];
measure q -> c;`,
    options: [
      { id: 'a', text: '00' },
      { id: 'b', text: '01' },
      { id: 'c', text: '10' },
      { id: 'd', text: '11' },
    ],
    correctIds: ['d'],
    explanation:
      'X sets q0 to 1, and the CNOT — control q0, target q1 — then fires with certainty and sets q1 to 1 as well. The outcome is 11 on every shot. Nothing here is in superposition, which is the point: a CNOT on classical inputs is just a classical XOR, and answering 01 means reading the control and target the other way round or forgetting that bitstrings print q0 last.',
  },
  {
    id: 'f47',
    kind: 'multi',
    lessonSlug: 'gates-and-circuits',
    points: 3,
    prompt: 'Select every gate sequence that is equal to a Z gate, up to an unobservable global phase.',
    options: [
      { id: 'a', text: 'H, then X, then H' },
      { id: 'b', text: 'S, then S' },
      { id: 'c', text: 'T four times' },
      { id: 'd', text: 'RZ(π)' },
      { id: 'e', text: 'H, then H' },
    ],
    correctIds: ['a', 'b', 'c', 'd'],
    explanation:
      'A is the basis-change identity: conjugating by Hadamards swaps the X and Z axes. B and C are the same quarter- and eighth-turn arithmetic — S² = Z and T⁴ = Z exactly. D is the one that tests whether "up to global phase" has landed: RZ(π) = diag(e^{−iπ/2}, e^{iπ/2}) = −i·Z, which differs from Z by a factor of −i on every amplitude and is therefore the same operation, physically. Simulators and hardware disagree about which convention to print, and treating that factor as an error is a classic waste of a debugging afternoon. E is the identity, not Z.',
  },
  {
    id: 'f48',
    kind: 'circuit-outcome',
    lessonSlug: 'gates-and-circuits',
    points: 3,
    prompt:
      'Which measurement outcomes are possible for this circuit? Outcomes are written q1q0. Select all that apply.',
    qasm: `OPENQASM 2.0;
include "qelib1.inc";
qreg q[2];
creg c[2];
h q[0];
h q[1];
cz q[0],q[1];
h q[1];
measure q -> c;`,
    options: [
      { id: 'a', text: '00' },
      { id: 'b', text: '01' },
      { id: 'c', text: '10' },
      { id: 'd', text: '11' },
    ],
    correctIds: ['a', 'd'],
    explanation:
      'A CZ with Hadamards on one side of the target is a CNOT: H·Z·H = X, so this circuit is H on q0 followed by CX(q0 → q1) — the Bell-pair recipe, outcomes 00 and 11 at 50% each. The lesson is that CZ and CX are the same gate in different bases, and that CZ, which looks symmetric between its two qubits (it is), becomes an asymmetric control-and-target gate the moment you fix a basis. Expecting all four outcomes means treating the last H as acting on an independent qubit rather than on half of a pair.',
  },
  {
    id: 'f49',
    kind: 'numeric',
    lessonSlug: 'gates-and-circuits',
    points: 2,
    prompt:
      'A device has no SWAP gate. How many CNOTs are needed to exchange the states of two arbitrary qubits?',
    correctNumber: 3,
    tolerance: 0,
    explanation:
      'Three, alternating direction: CX(a→b), CX(b→a), CX(a→b). Two is the tempting answer, and it does work when one of the qubits is known to be |0⟩ — which is why the shortcut passes an unwary test and then fails on real data. This number is not academic: on hardware with limited connectivity, every gate between unconnected qubits is compiled into SWAPs, so routing overhead is counted in units of three CNOTs, on the noisiest gate in the device.',
  },
  {
    id: 'f50',
    kind: 'single',
    lessonSlug: 'gates-and-circuits',
    points: 3,
    prompt:
      'The Clifford gates — H, S, CNOT and everything they generate — can produce entanglement, superposition and every Bell state. Why is a T gate added to the standard universal set?',
    options: [
      { id: 'a', text: 'Clifford circuits are efficiently simulable on a classical computer, so no Clifford-only circuit can offer a quantum advantage.' },
      { id: 'b', text: 'Clifford gates cannot create entanglement between more than two qubits.' },
      { id: 'c', text: 'T gates are faster on hardware, so they reduce total circuit time.' },
      { id: 'd', text: 'Without T, circuits cannot be made reversible.' },
    ],
    correctIds: ['a'],
    explanation:
      'The Gottesman–Knill theorem: any circuit built from Clifford gates and computational-basis measurements can be simulated in polynomial time classically. So entanglement alone is not the resource — GHZ states, superdense coding and teleportation are all Clifford, all classically simulable, and all useless as a source of advantage on their own. B is false; GHZ on any number of qubits is Clifford. The practical consequence is enormous and worth carrying: in a fault-tolerant machine, Cliffords are comparatively cheap and T gates are distilled at great cost, so "T-count" is the currency algorithms are budgeted in.',
  },

  {
    id: 'f51',
    kind: 'circuit-outcome',
    lessonSlug: 'entanglement',
    points: 3,
    prompt:
      'Which measurement outcomes are possible for this circuit? Outcomes are written q1q0. Select all that apply.',
    qasm: `OPENQASM 2.0;
include "qelib1.inc";
qreg q[2];
creg c[2];
h q[0];
cx q[0],q[1];
h q[0];
h q[1];
measure q -> c;`,
    options: [
      { id: 'a', text: '00' },
      { id: 'b', text: '01' },
      { id: 'c', text: '10' },
      { id: 'd', text: '11' },
    ],
    correctIds: ['a', 'd'],
    explanation:
      'The Bell state Φ+ is invariant under H⊗H: applying a Hadamard to both halves gives Φ+ back, so the outcomes are still 00 and 11. Multiply it out if it looks like a coincidence — the |01⟩ and |10⟩ terms appear twice with opposite signs and cancel. This is the sharpest available demonstration that Φ+ is perfectly correlated in the X basis as well as the Z basis, which is precisely the property CHSH tests exploit, and it is why "the qubits agree" is basis-independent for this state in a way that no classical correlation can be.',
  },
  {
    id: 'f52',
    kind: 'multi',
    lessonSlug: 'entanglement',
    points: 3,
    prompt: 'Select every two-qubit state below that is entangled.',
    options: [
      { id: 'a', text: '(|00⟩ + |11⟩)/√2' },
      { id: 'b', text: '(|01⟩ + |10⟩)/√2' },
      { id: 'c', text: '(|00⟩ + |01⟩)/√2' },
      { id: 'd', text: '(|00⟩ − |01⟩ + |10⟩ − |11⟩)/2' },
      { id: 'e', text: '(|00⟩ + |01⟩ + |10⟩ + |11⟩)/2' },
    ],
    correctIds: ['a', 'b'],
    explanation:
      'Entangled means not writable as a product of two single-qubit states. A and B are the Bell states. C factors as |0⟩⊗(|0⟩+|1⟩)/√2 — one qubit is idle, the other is in superposition. D factors as |+⟩⊗|−⟩ and E as |+⟩⊗|+⟩, and D is the item that catches people: four terms, two minus signs and a look of complexity, but every amplitude is a product of the corresponding single-qubit amplitudes. The reliable test is arithmetic, not appearance — for α|00⟩+β|01⟩+γ|10⟩+δ|11⟩ the state is separable exactly when αδ = βγ.',
  },
  {
    id: 'f53',
    kind: 'numeric',
    lessonSlug: 'entanglement',
    points: 3,
    prompt:
      'In the CHSH experiment the quantity S = |E(a,b) − E(a,b′) + E(a′,b) + E(a′,b′)| is measured. What is the largest value S can take in any local hidden-variable theory?',
    correctNumber: 2,
    tolerance: 0,
    explanation:
      'Two. That is Bell\'s inequality in CHSH form, and it follows from arithmetic alone: if each measurement outcome is ±1 and fixed in advance by some local variable, the four-term combination can never exceed 2. Quantum mechanics reaches 2√2 ≈ 2.83 with a Bell pair and the right measurement angles, and experiments have measured that value with the loopholes closed. Answering 2.83 gives the quantum bound, which is what the experiment finds — the point of the question is the classical bound it beats.',
  },
  {
    id: 'f54',
    kind: 'single',
    lessonSlug: 'entanglement',
    points: 2,
    prompt: 'What does the no-cloning theorem actually forbid?',
    options: [
      { id: 'a', text: 'A single device that copies an arbitrary unknown state |ψ⟩ onto a second qubit.' },
      { id: 'b', text: 'Preparing two qubits in the same known state.' },
      { id: 'c', text: 'Copying classical bits inside a quantum computer.' },
      { id: 'd', text: 'Measuring the same qubit twice.' },
    ],
    correctIds: ['a'],
    explanation:
      'The theorem is about an UNKNOWN state and a single universal machine, and it follows in two lines from linearity — a copier that works on |0⟩ and |1⟩ acts on (|0⟩+|1⟩)/√2 by linearity and produces an entangled pair, not two copies. B is routine: if you know the recipe you can run it twice, which is exactly what shots are. C is fine too, since CNOT copies basis states perfectly; what it cannot do is copy superpositions. The consequences are structural: it is why quantum error correction cannot use redundant copies, and why an eavesdropper on BB84 cannot keep a copy and forward the original.',
  },

  {
    id: 'f55',
    kind: 'numeric',
    lessonSlug: 'grover',
    points: 2,
    prompt:
      'Grover\'s algorithm searches N = 1,000,000 items with exactly one marked item. About how many iterations are optimal? Give a whole number.',
    correctNumber: 785,
    tolerance: 2,
    explanation:
      '(π/4)√N = (π/4)(1000) ≈ 785. Two comparisons make the result mean something: a classical search needs about 500,000 lookups on average, so this is a genuine three-orders-of-magnitude win — and it is a quadratic win, not an exponential one, so a database a million times larger costs only a thousand times more iterations. Answering 1000 uses √N without the π/4, which overshoots the optimum and lands past the peak of the rotation.',
  },
  {
    id: 'f56',
    kind: 'single',
    lessonSlug: 'grover',
    points: 2,
    prompt: 'What does Grover\'s oracle have to be able to do?',
    options: [
      { id: 'a', text: 'Recognise a solution when handed one, and flip the sign of that basis state\'s amplitude.' },
      { id: 'b', text: 'Know where the marked item is, and point the algorithm at it.' },
      { id: 'c', text: 'Return the marked item\'s index when measured.' },
      { id: 'd', text: 'Compare every item against the target in sequence.' },
    ],
    correctIds: ['a'],
    explanation:
      'Recognition, not knowledge — the oracle is a reversible circuit that computes the verification predicate, and for a real problem you write it yourself out of the checking code you already have. That is why Grover applies to satisfiability and to inverting a hash: verifying a candidate is easy, finding one is not. B is circular, and it is the objection people raise when they first meet the algorithm ("if you know the answer, why search?"). C confuses the oracle with the measurement at the end. D describes classical search and would surrender the speedup.',
  },
  {
    id: 'f57',
    kind: 'circuit-outcome',
    lessonSlug: 'grover',
    points: 3,
    prompt:
      'This is one complete Grover iteration on two qubits. Which outcomes are possible? Outcomes are written q1q0. Select all that apply.',
    qasm: `OPENQASM 2.0;
include "qelib1.inc";
qreg q[2];
creg c[2];
h q[0];
h q[1];
cz q[0],q[1];
h q[0];
h q[1];
x q[0];
x q[1];
cz q[0],q[1];
x q[0];
x q[1];
h q[0];
h q[1];
measure q -> c;`,
    options: [
      { id: 'a', text: '00' },
      { id: 'b', text: '01' },
      { id: 'c', text: '10' },
      { id: 'd', text: '11' },
    ],
    correctIds: ['d'],
    explanation:
      'Read it in three parts: two Hadamards make the uniform superposition, the first CZ is the oracle marking |11⟩ with a sign, and the H-X-CZ-X-H block is the diffusion operator, a reflection about the mean. For N = 4 with one marked item a single iteration is exactly enough — the marked amplitude rotates to 1 and the other three cancel to zero, so the outcome is 11 with certainty. N = 4 is the only case where Grover is exact; for every larger N the optimal iteration count is not an integer and the answer comes out with a probability short of 1.',
  },
  {
    id: 'f58',
    kind: 'multi',
    lessonSlug: 'grover',
    points: 3,
    prompt: 'A Grover search runs over N items with k > 1 marked items. Select all that are true.',
    options: [
      { id: 'a', text: 'The optimal iteration count is about (π/4)√(N/k), so more solutions means fewer iterations.' },
      { id: 'b', text: 'Not knowing k in advance is a real problem, addressed by randomising the iteration count or by quantum counting.' },
      { id: 'c', text: 'The measurement returns one of the marked items, chosen at random among them.' },
      { id: 'd', text: 'With k marked items the algorithm needs k separate runs to be certain of finding any of them.' },
      { id: 'e', text: 'If k is large enough, iterating longer keeps improving the success probability.' },
    ],
    correctIds: ['a', 'b', 'c'],
    explanation:
      'A and C describe the geometry: the algorithm rotates towards the uniform superposition OF ALL MARKED STATES, so it arrives faster and hands back a random one of them. B is the practical wrinkle — the stopping point depends on a number you often do not have, and overshooting is a real failure, which is why quantum counting exists. D misreads C. E is the over-rotation error in a new costume: the rotation is periodic whatever k is, and past the optimum the success probability falls again.',
  },
]

// ────────────────────────────────────────────────────────────
// Advanced track: shor, error-correction, vqe-and-nisq, quantum-cryptography
// ────────────────────────────────────────────────────────────

const ADVANCED_QUESTIONS: ExamQuestion[] = [
  {
    id: 'a01',
    kind: 'single',
    lessonSlug: 'shor',
    points: 2,
    prompt: 'What does the quantum part of Shor\'s algorithm actually compute?',
    options: [
      { id: 'a', text: 'The period (order) r of the function f(x) = aˣ mod N.' },
      { id: 'b', text: 'The prime factors of N directly.' },
      { id: 'c', text: 'A trial division over all candidate factors in superposition.' },
      { id: 'd', text: 'The discrete logarithm of N to base a.' },
    ],
    correctIds: ['a'],
    explanation:
      'Shor is a classical reduction plus one quantum subroutine. The reduction — factoring to order-finding — is pure number theory and was known before quantum computing; the quantum computer supplies only the period of a modular exponential, via the quantum Fourier transform. B skips the reduction that makes the algorithm work at all. C is the parallel-trial-division misconception: superposition can evaluate f everywhere, but reading out one random value of f tells you nothing, which is why the QFT and not measurement does the real work.',
  },
  {
    id: 'a02',
    kind: 'numeric',
    lessonSlug: 'shor',
    points: 2,
    prompt: 'What is the order r of 7 modulo 15 — the smallest r > 0 with 7ʳ ≡ 1 (mod 15)?',
    correctNumber: 4,
    tolerance: 0,
    explanation:
      'Compute the powers: 7¹ = 7, 7² = 49 ≡ 4, 7³ ≡ 28 ≡ 13, 7⁴ ≡ 91 ≡ 1 (mod 15). So r = 4. This is exactly the number that Shor\'s quantum subroutine extracts, and everything after it is classical arithmetic. Because r is even and 7^(r/2) = 49 ≢ −1 (mod 15), this choice of a succeeds.',
  },
  {
    id: 'a03',
    kind: 'numeric',
    lessonSlug: 'shor',
    points: 2,
    prompt:
      'Continuing the N = 15, a = 7, r = 4 case: what is gcd(7^(r/2) − 1, 15)? Give a whole number.',
    correctNumber: 3,
    tolerance: 0,
    explanation:
      '7^(r/2) = 7² = 49, so 49 − 1 = 48, and gcd(48, 15) = 3. That is a non-trivial factor of 15, and 15/3 = 5 gives the other. This last step is the point of the whole exercise: the quantum computer never sees a factor, it only supplies r, and Euclid\'s algorithm — two thousand years old and entirely classical — finishes the job.',
  },
  {
    id: 'a04',
    kind: 'multi',
    lessonSlug: 'shor',
    points: 3,
    prompt: 'Select all that are true of Shor\'s algorithm.',
    options: [
      { id: 'a', text: 'It runs in polynomial time in the number of bits of N.' },
      { id: 'b', text: 'It requires the order r to be even to yield a factor by this route.' },
      { id: 'c', text: 'It may fail for a given random a and need to be retried.' },
      { id: 'd', text: 'It solves NP-complete problems in polynomial time.' },
      { id: 'e', text: 'It has been used to factor cryptographically relevant RSA keys on existing hardware.' },
    ],
    correctIds: ['a', 'b', 'c'],
    explanation:
      'A, B and C describe a probabilistic polynomial-time algorithm with a classical retry loop: if r is odd, or if a^(r/2) ≡ −1 (mod N), you pick a new a. D is the most persistent myth in popular coverage — factoring is not known to be NP-complete, and no quantum algorithm is known that solves NP-complete problems efficiently. E is false by several orders of magnitude: published demonstrations factor tiny numbers, and often with the answer partly compiled in; a 2048-bit RSA key needs millions of error-corrected physical qubits.',
  },
  {
    id: 'a05',
    kind: 'circuit-outcome',
    lessonSlug: 'shor',
    points: 3,
    prompt:
      'This is phase kickback, the mechanism behind Shor\'s order-finding register. Which outcomes are possible? Outcomes are written q1q0. Select all that apply.',
    qasm: `OPENQASM 2.0;
include "qelib1.inc";
qreg q[2];
creg c[2];
h q[0];
x q[1];
cz q[0],q[1];
h q[0];
measure q -> c;`,
    options: [
      { id: 'a', text: '00' },
      { id: 'b', text: '01' },
      { id: 'c', text: '10' },
      { id: 'd', text: '11' },
    ],
    correctIds: ['d'],
    explanation:
      'Follow it through. H on q0 gives (|00⟩+|01⟩)/√2. X on q1 gives (|10⟩+|11⟩)/√2. CZ flips the sign of the |11⟩ term only, giving (|10⟩−|11⟩)/√2 — that is q1 = |1⟩ tensored with q0 in the state (|0⟩−|1⟩)/√2. The final H on q0 turns that into |1⟩, so the state is |11⟩ and the only outcome is 11. Note what happened: the target register q1 came out exactly as it went in, and the phase the controlled gate "applied to the target" ended up recorded in the control. That kickback is how the order-finding register learns r without ever measuring the modular-exponentiation register.',
  },
  {
    id: 'a06',
    kind: 'single',
    lessonSlug: 'error-correction',
    points: 2,
    prompt: 'Why can\'t quantum error correction work by copying each qubit three times and taking a majority vote?',
    options: [
      { id: 'a', text: 'The no-cloning theorem forbids copying an unknown state; codes entangle the logical qubit across physical ones instead.' },
      { id: 'b', text: 'Three copies are not enough — you would need five.' },
      { id: 'c', text: 'Majority voting is too slow for hardware coherence times.' },
      { id: 'd', text: 'It works fine; it is exactly how the repetition code operates.' },
    ],
    correctIds: ['a'],
    explanation:
      'You cannot make an independent copy of an unknown |ψ⟩ — that is the no-cloning theorem, and it is a direct consequence of linearity. What the repetition code actually does is map α|0⟩+β|1⟩ to α|000⟩+β|111⟩, which is one entangled state, not three copies: measuring any single physical qubit of it destroys the encoded superposition. D is the misreading that makes the encoding circuit look innocuous, and it is worth being precise about, because the whole design of syndrome measurement follows from it — you measure parities, which reveal the error without revealing α or β.',
  },
  {
    id: 'a07',
    kind: 'circuit-outcome',
    lessonSlug: 'error-correction',
    points: 2,
    prompt:
      'This is the encoder for the three-qubit repetition code applied to |+⟩. Which outcomes are possible? Outcomes are written q2q1q0. Select all that apply.',
    qasm: `OPENQASM 2.0;
include "qelib1.inc";
qreg q[3];
creg c[3];
h q[0];
cx q[0],q[1];
cx q[0],q[2];
measure q -> c;`,
    options: [
      { id: 'a', text: '000' },
      { id: 'b', text: '001' },
      { id: 'c', text: '110' },
      { id: 'd', text: '111' },
    ],
    correctIds: ['a', 'd'],
    explanation:
      'H puts q0 into (|0⟩+|1⟩)/√2, and the two CNOTs — both controlled by q0 — spread that branch structure onto q1 and q2, giving (|000⟩+|111⟩)/√2. Only 000 and 111 appear. This is the point of the code: any single bit flip moves the state to something like 010 or 101, which is not in the code space, and the parity checks q0⊕q1 and q1⊕q2 identify which qubit moved without ever asking what α and β were.',
  },
  {
    id: 'a08',
    kind: 'numeric',
    lessonSlug: 'error-correction',
    points: 2,
    prompt:
      'What is the smallest number of physical qubits in a code that can correct an arbitrary single-qubit error on one logical qubit?',
    correctNumber: 5,
    tolerance: 0,
    explanation:
      'Five, by the quantum Hamming bound, realised by the perfect [[5,1,3]] code. Three is the usual wrong answer, imported from the classical repetition code — but the three-qubit code corrects bit flips only, or phase flips only, never both. Shor\'s nine-qubit code was the first to handle arbitrary errors and is the answer people often reach for; it is correct but not minimal. Seven is Steane\'s code, which is minimal among CSS codes but not overall.',
  },
  {
    id: 'a09',
    kind: 'multi',
    lessonSlug: 'error-correction',
    points: 3,
    prompt: 'Select all that are true of syndrome measurement in a stabilizer code.',
    options: [
      { id: 'a', text: 'It reveals which error occurred without revealing the encoded logical state.' },
      { id: 'b', text: 'It projects continuous errors onto a discrete set of Pauli errors.' },
      { id: 'c', text: 'It is repeated many times, because the measurement itself can be faulty.' },
      { id: 'd', text: 'It measures each physical qubit in the computational basis.' },
      { id: 'e', text: 'It works only for errors that are exactly bit flips.' },
    ],
    correctIds: ['a', 'b', 'c'],
    explanation:
      'A is the design constraint that makes quantum error correction possible at all — the syndrome is precisely the information that is uncorrelated with α and β. B is the digitisation miracle: real noise is a continuous rotation, but the syndrome projection collapses it onto I, X, Y or Z, so a discrete correction suffices. C is what fault tolerance is about in practice. D is exactly what you must never do — measuring the physical qubits directly collapses the logical state; you measure parity operators via ancillas instead. E ignores that Y and Z errors are handled by the same machinery.',
  },
  {
    id: 'a10',
    kind: 'single',
    lessonSlug: 'error-correction',
    points: 2,
    prompt: 'What does the threshold theorem say?',
    options: [
      { id: 'a', text: 'If the physical error rate is below a fixed threshold, arbitrarily long computations become possible with polylogarithmic overhead.' },
      { id: 'b', text: 'Error correction eliminates all errors once enough physical qubits are used, at any error rate.' },
      { id: 'c', text: 'There is a hard limit on how many qubits can be entangled before decoherence wins.' },
      { id: 'd', text: 'Below the threshold, error correction is unnecessary.' },
    ],
    correctIds: ['a'],
    explanation:
      'The theorem is conditional, and the condition is the whole content: below threshold, concatenating or scaling a code suppresses the logical error rate faster than it adds new failure modes, so overhead grows only polylogarithmically in the target accuracy. B drops the condition — above threshold, adding qubits makes things worse, because you are adding more places to fail than you are fixing. D inverts the statement: below threshold is where error correction starts to help, not where it stops being needed.',
  },
  {
    id: 'a11',
    kind: 'single',
    lessonSlug: 'vqe-and-nisq',
    points: 2,
    prompt: 'In VQE, what does the quantum processor do and what does the classical computer do?',
    options: [
      { id: 'a', text: 'The quantum device prepares the ansatz and estimates ⟨H⟩; a classical optimizer proposes the next parameters.' },
      { id: 'b', text: 'The quantum device runs the optimization; the classical computer only reads out the final answer.' },
      { id: 'c', text: 'The classical computer prepares the state and the quantum device diagonalises the Hamiltonian.' },
      { id: 'd', text: 'Both run the same computation and their results are compared for error detection.' },
    ],
    correctIds: ['a'],
    explanation:
      'VQE is a hybrid loop, and the division of labour is deliberate: state preparation and expectation-value estimation are the parts that are hard classically, while gradient-free or gradient-based parameter updates are the parts classical machines already do well. B misplaces the optimizer, which matters because the optimizer needs many repeated shallow circuit executions — exactly what a noisy device can supply and a deep coherent computation cannot.',
  },
  {
    id: 'a12',
    kind: 'multi',
    lessonSlug: 'vqe-and-nisq',
    points: 3,
    prompt: 'Select all that are true of NISQ-era devices and algorithms.',
    options: [
      { id: 'a', text: 'Circuit depth is limited by decoherence, so algorithms are kept shallow.' },
      { id: 'b', text: 'There is no error correction, only error mitigation.' },
      { id: 'c', text: 'Variational algorithms have no proof of advantage over the best classical methods.' },
      { id: 'd', text: 'NISQ devices have demonstrated commercial advantage on chemistry problems.' },
      { id: 'e', text: 'Adding more qubits alone makes a NISQ device fault tolerant.' },
    ],
    correctIds: ['a', 'b', 'c'],
    explanation:
      'A and B are the definition of the regime — noisy, intermediate-scale, and reliant on mitigation techniques such as zero-noise extrapolation, which reduce bias at the cost of far more shots and do not scale indefinitely. C is the honest state of the field: VQE and QAOA are heuristics, and classical tensor-network and quantum Monte Carlo methods keep catching up. D is marketing. E confuses scale with fault tolerance, which needs error rates below threshold, not merely more qubits.',
  },
  {
    id: 'a13',
    kind: 'single',
    lessonSlug: 'vqe-and-nisq',
    points: 2,
    prompt: 'What is the barren plateau problem?',
    options: [
      { id: 'a', text: 'For many random ansätze, gradients vanish exponentially in the qubit count, so the optimizer has no signal to follow.' },
      { id: 'b', text: 'The energy landscape has many local minima, so the optimizer gets stuck in one.' },
      { id: 'c', text: 'Hardware noise makes the measured energy drift over the course of a run.' },
      { id: 'd', text: 'The ansatz is not expressive enough to represent the ground state.' },
    ],
    correctIds: ['a'],
    explanation:
      'Barren plateaus are about the gradient\'s variance, which shrinks exponentially with system size for sufficiently random, deep ansätze — the landscape is not rugged, it is flat, and the cost of resolving a gradient against shot noise becomes prohibitive. B is a different and much more familiar problem, and confusing the two leads to the wrong remedy: better optimizers help with local minima, whereas plateaus are addressed by structured, problem-informed ansätze and local cost functions. C and D are real NISQ difficulties but distinct ones.',
  },
  {
    id: 'a14',
    kind: 'numeric',
    lessonSlug: 'vqe-and-nisq',
    points: 2,
    prompt:
      'Estimating an observable with variance 1 from S shots gives a standard error of 1/√S. How many shots are needed for a standard error of 0.01? Give a whole number.',
    correctNumber: 10000,
    tolerance: 0,
    explanation:
      '1/√S = 0.01 gives S = 10 000. The quadratic scaling is the practical bottleneck of VQE: each extra decimal digit of chemical accuracy costs a factor of one hundred in runtime, and a real Hamiltonian decomposes into hundreds or thousands of Pauli terms, each needing its own estimate. Answering 100 — from reading the relationship as linear — is the mistake that makes VQE runtimes look far more affordable than they are.',
  },
  {
    id: 'a15',
    kind: 'single',
    lessonSlug: 'quantum-cryptography',
    points: 2,
    prompt: 'What is BB84\'s security actually based on?',
    options: [
      { id: 'a', text: 'Measurement disturbs an unknown quantum state, so eavesdropping introduces a detectable error rate.' },
      { id: 'b', text: 'The eavesdropper would need to solve a computationally hard problem.' },
      { id: 'c', text: 'Entanglement between Alice and Bob prevents anyone else from receiving the photons.' },
      { id: 'd', text: 'The key is transmitted faster than an eavesdropper can intercept it.' },
    ],
    correctIds: ['a'],
    explanation:
      'BB84 rests on physics, not on hardness assumptions: an eavesdropper who measures in the wrong basis — and with no basis information, she must guess half the time — perturbs the state, and the induced error rate shows up when Alice and Bob compare a sample of their bits. B describes classical public-key cryptography, and the contrast is the entire selling point of QKD: a future computer, quantum or otherwise, cannot retroactively break a key whose security came from a measurement that already happened. C is wrong on two counts — BB84 uses no entanglement, and nothing physically stops Eve intercepting photons; the protocol makes it detectable, not impossible.',
  },
  {
    id: 'a16',
    kind: 'numeric',
    lessonSlug: 'quantum-cryptography',
    points: 2,
    prompt:
      'In BB84, Alice and Bob each choose their basis uniformly at random and independently. What fraction of the transmitted bits survives basis reconciliation (sifting)? Give a decimal between 0 and 1.',
    correctNumber: 0.5,
    tolerance: 0.001,
    explanation:
      'The bases agree half the time, so roughly half the raw bits are kept and the rest are discarded. Note that this 0.5 is before error correction and privacy amplification, both of which shrink the key further, so the final secret-key rate is always well under half the transmission rate. Answering 0.25 is the usual slip, from multiplying two independent 1/2 choices when in fact any matching pair — both Z or both X — is retained.',
  },
  {
    id: 'a17',
    kind: 'multi',
    lessonSlug: 'quantum-cryptography',
    points: 3,
    prompt: 'Select all that are true of quantum key distribution.',
    options: [
      { id: 'a', text: 'It distributes a shared secret key; the message itself is still encrypted classically.' },
      { id: 'b', text: 'It requires an authenticated classical channel to prevent man-in-the-middle attacks.' },
      { id: 'c', text: 'Photon loss limits the range of fibre links without trusted nodes or repeaters.' },
      { id: 'd', text: 'It encrypts the message directly using entanglement.' },
      { id: 'e', text: 'It removes the need for any classical communication between the parties.' },
    ],
    correctIds: ['a', 'b', 'c'],
    explanation:
      'The name is precise: QKD distributes keys, and A follows. B is the caveat most often omitted — without prior authentication, Eve can impersonate both parties, so QKD bootstraps from an existing shared secret rather than creating one from nothing. C is why deployments rely on trusted relay nodes or satellites. D confuses key distribution with an encryption scheme. E is contradicted by B, and by the sifting and reconciliation steps, which are entirely classical.',
  },
  {
    id: 'a18',
    kind: 'single',
    lessonSlug: 'quantum-cryptography',
    points: 2,
    prompt: 'What is the mainstream response to the threat quantum computers pose to RSA and ECC?',
    options: [
      { id: 'a', text: 'Post-quantum cryptography — classical algorithms based on problems with no known efficient quantum attack, such as lattices.' },
      { id: 'b', text: 'Deploying QKD hardware across the entire internet.' },
      { id: 'c', text: 'Doubling RSA key lengths, which restores security against Shor.' },
      { id: 'd', text: 'Nothing is needed; Shor\'s algorithm does not scale to real key sizes even in principle.' },
    ],
    correctIds: ['a'],
    explanation:
      'The standardised answer is post-quantum cryptography — ML-KEM and ML-DSA and their relatives — which runs on ordinary hardware and needs no new physical infrastructure. B does not scale to a global network of untrusted endpoints and does not solve authentication. C is the seductive wrong answer: doubling the key length works against classical factoring but not against Shor, whose polynomial cost means larger keys buy only a polynomial amount of extra time. D confuses an engineering obstacle with a mathematical one, and it ignores harvest-now-decrypt-later, which is why the migration is happening today.',
  },
  {
    id: 'a19',
    kind: 'single',
    lessonSlug: 'error-correction',
    points: 2,
    prompt: 'A quantum code has distance d = 3. How many arbitrary errors can it correct, and how many can it detect?',
    options: [
      { id: 'a', text: 'Correct 1, detect 2.' },
      { id: 'b', text: 'Correct 3, detect 3.' },
      { id: 'c', text: 'Correct 2, detect 1.' },
      { id: 'd', text: 'Correct 1, detect 1.' },
    ],
    correctIds: ['a'],
    explanation:
      'A distance-d code corrects ⌊(d−1)/2⌋ errors and detects d−1, so d = 3 corrects one and detects two. The asymmetry is worth internalising: detection only asks whether you have left the code space, whereas correction additionally requires knowing which way you left it, and that costs you a factor of two in distance. It is also why a distance-3 surface code patch is the standard first milestone — one correctable error is the smallest interesting claim.',
  },
  {
    id: 'a20',
    kind: 'multi',
    lessonSlug: 'shor',
    points: 3,
    prompt: 'Select all that are true of the quantum Fourier transform as used in Shor\'s algorithm.',
    options: [
      { id: 'a', text: 'It converts periodicity in the amplitudes into a peaked distribution over multiples of a period-related value.' },
      { id: 'b', text: 'It is a unitary operation and therefore reversible.' },
      { id: 'c', text: 'The measured value must be post-processed classically, typically with continued fractions.' },
      { id: 'd', text: 'It outputs the Fourier coefficients so they can be read off individually.' },
      { id: 'e', text: 'It gives an exponential speedup for computing the discrete Fourier transform of arbitrary classical data.' },
    ],
    correctIds: ['a', 'b', 'c'],
    explanation:
      'A, B and C are how the subroutine is actually used: the QFT turns the period hidden in the state into constructive interference at particular measurement outcomes, and a continued-fraction expansion converts a single such outcome into a candidate r. D and E are the same misconception in two guises — the QFT does apply a DFT to 2ⁿ amplitudes in polynomial time, but you cannot read those amplitudes out. One measurement yields one sample, so the speedup is only usable when interference has arranged for that sample to carry the answer.',
  },

  // ────────────────────────────────────────────────────────────
  // Second wave: a21–a36, four per advanced lesson, weighted towards the
  // 3-point end. The advanced paper is 20 questions from a pool of 67 once the
  // foundations prerequisites are folded in, so a resit shares only about a
  // third of its items with the first attempt.
  // ────────────────────────────────────────────────────────────

  {
    id: 'a21',
    kind: 'numeric',
    lessonSlug: 'shor',
    points: 2,
    prompt: 'What is the order r of 2 modulo 21 — the smallest r > 0 with 2ʳ ≡ 1 (mod 21)?',
    correctNumber: 6,
    tolerance: 0,
    explanation:
      '2, 4, 8, 16, 32 ≡ 11, 64 ≡ 1 (mod 21), so r = 6. Then 2³ = 8, gcd(8 − 1, 21) = 7 and gcd(8 + 1, 21) = 3, which factors 21 completely. Note how little the quantum computer did: it supplied the single integer 6, and the rest is Euclid. Answering 4 is the reflex of reusing the r from the familiar N = 15 example.',
  },
  {
    id: 'a22',
    kind: 'single',
    lessonSlug: 'shor',
    points: 3,
    prompt:
      'Shor\'s reduction finds r, then computes gcd(a^(r/2) ± 1, N). Why does the algorithm restart with a new random a when a^(r/2) ≡ −1 (mod N)?',
    options: [
      { id: 'a', text: 'Because a^(r/2) + 1 is then a multiple of N, so both gcds return a trivial factor — 1 or N itself.' },
      { id: 'b', text: 'Because r was computed incorrectly and the quantum subroutine must be repeated.' },
      { id: 'c', text: 'Because a negative residue cannot be fed to Euclid\'s algorithm.' },
      { id: 'd', text: 'Because it means N is prime.' },
    ],
    correctIds: ['a'],
    explanation:
      'The whole reduction rests on a^(r/2) being a non-trivial square root of 1 mod N: x² ≡ 1 with x ≢ ±1 gives (x−1)(x+1) ≡ 0 mod N with neither factor divisible by N, so the gcd splits N. If x ≡ −1 that construction collapses and you learn nothing, so you draw a fresh a — which succeeds with probability at least 1/2 for odd composite N with at least two distinct prime factors. B blames the subroutine for a case the mathematics anticipates. D confuses a failed attempt with a primality proof; a genuinely prime N is ruled out by a cheap classical test long before any of this runs.',
  },
  {
    id: 'a23',
    kind: 'multi',
    lessonSlug: 'shor',
    points: 3,
    prompt: 'Select all that are true of the resources Shor\'s algorithm needs.',
    options: [
      { id: 'a', text: 'The dominant cost is the modular exponentiation, not the QFT.' },
      { id: 'b', text: 'The counting register needs roughly 2n qubits for an n-bit N, so the estimate of r/N is precise enough for continued fractions.' },
      { id: 'c', text: 'A cryptographically relevant run needs error correction, and therefore orders of magnitude more physical qubits than logical ones.' },
      { id: 'd', text: 'The circuit depth is shallow enough for NISQ hardware if enough qubits are available.' },
      { id: 'e', text: 'Because the algorithm is probabilistic, its answer cannot be checked without rerunning it.' },
    ],
    correctIds: ['a', 'b', 'c'],
    explanation:
      'A surprises people: the QFT is the famous part but costs O(n²) gates, while modular exponentiation is the expensive engine, and most of the literature on optimising Shor is about arithmetic circuits. B is what makes the continued-fraction step work. C is the reason 2048-bit RSA is not in danger today — recent estimates run to millions of physical qubits at realistic error rates. D contradicts C. E is the most useful thing to remember about the whole family: the output is a candidate factor, and you check it by multiplying, which takes microseconds.',
  },
  {
    id: 'a24',
    kind: 'circuit-outcome',
    lessonSlug: 'shor',
    points: 3,
    prompt:
      'The first H prepares a register whose amplitude pattern has period 2 in the index x — non-zero on x = 0 and x = 2, zero on x = 1 and x = 3. The rest is a two-qubit QFT (the controlled-S is decomposed into T gates, and the final SWAP corrects the bit order). Which outcomes are possible? Outcomes are written q1q0. Select all that apply.',
    qasm: `OPENQASM 2.0;
include "qelib1.inc";
qreg q[2];
creg c[2];
h q[1];
h q[1];
t q[0];
t q[1];
cx q[0],q[1];
tdg q[1];
cx q[0],q[1];
h q[0];
swap q[0],q[1];
measure q -> c;`,
    options: [
      { id: 'a', text: '00' },
      { id: 'b', text: '01' },
      { id: 'c', text: '10' },
      { id: 'd', text: '11' },
    ],
    correctIds: ['a', 'c'],
    explanation:
      'A period of 2 in a register of size N = 4 means a frequency of N/2 = 2, so the QFT concentrates everything on the multiples of that frequency: k = 0 and k = 2, which print as 00 and 10, at 50% each. The odd outcomes cancel exactly. This is order-finding in miniature — the measured k is not the period, it is a multiple of N/r, and recovering r from it is the continued-fraction step. Expecting all four outcomes is the reasonable-sounding guess that a Fourier transform "spreads things out"; it spreads a single basis state out, and it concentrates a periodic one.',
  },

  {
    id: 'a25',
    kind: 'circuit-outcome',
    lessonSlug: 'error-correction',
    points: 3,
    prompt:
      'A logical |+⟩ is encoded in the three-qubit repetition code and then a single X error strikes q1. Which outcomes are possible? Outcomes are written q2q1q0. Select all that apply.',
    qasm: `OPENQASM 2.0;
include "qelib1.inc";
qreg q[3];
creg c[3];
h q[0];
cx q[0],q[1];
cx q[0],q[2];
x q[1];
measure q -> c;`,
    options: [
      { id: 'a', text: '000' },
      { id: 'b', text: '010' },
      { id: 'c', text: '101' },
      { id: 'd', text: '111' },
    ],
    correctIds: ['b', 'c'],
    explanation:
      'The encoder gives (|000⟩+|111⟩)/√2, and the error flips the middle qubit of both branches: 000 → 010 and 111 → 101. Neither is a codeword, and that is exactly the signal the decoder wants — the parity q0⊕q1 is 1 and q1⊕q2 is 1, a syndrome that names q1 uniquely. Note what the syndrome does NOT reveal: both outcomes still appear at 50%, so nothing about the encoded superposition has leaked. That is the design requirement, and it is why the parities are measured with ancillas rather than by reading the data qubits, which is what this circuit does and what a real decoder must never do.',
  },
  {
    id: 'a26',
    kind: 'single',
    lessonSlug: 'error-correction',
    points: 2,
    prompt:
      'In a stabilizer code, why are parity checks measured through ancilla qubits rather than by measuring the data qubits directly?',
    options: [
      { id: 'a', text: 'Measuring the data qubits would collapse the encoded superposition; the ancilla is arranged to carry only the parity, which is uncorrelated with the logical state.' },
      { id: 'b', text: 'Ancilla measurements are faster, and speed matters within a coherence time.' },
      { id: 'c', text: 'The data qubits are physically inaccessible in most hardware architectures.' },
      { id: 'd', text: 'It avoids the no-cloning theorem, which forbids measuring a qubit that is part of an entangled state.' },
    ],
    correctIds: ['a'],
    explanation:
      'The syndrome must say what went wrong without saying what the state is, and a parity operator such as Z₀Z₁ commutes with the logical operators precisely so that it can. Measuring the data in the computational basis would destroy α and β immediately — the code would protect nothing. B and C are practical claims that do not touch the reason. D misstates no-cloning, which forbids copying an unknown state, not measuring an entangled one; the underlying constraint is the same family of ideas, but a candidate who reaches for no-cloning here usually cannot say what the syndrome actually contains.',
  },
  {
    id: 'a27',
    kind: 'numeric',
    lessonSlug: 'error-correction',
    points: 3,
    prompt:
      'Below threshold, a distance-d code suppresses the logical error rate as p_L ∝ (p/p_th)^⌊(d+1)/2⌋. For d = 5, what is that exponent? Give a whole number.',
    correctNumber: 3,
    tolerance: 0,
    explanation:
      '⌊(5+1)/2⌋ = 3: it takes three simultaneous faults to produce a logical failure, so the exponent is one more than the two errors the code can correct. Concretely, at p/p_th = 0.1 a distance-3 patch buys a factor of 100 and a distance-5 patch a factor of 1000, and that exponential-in-distance suppression is what the whole surface-code programme rests on. The wrong answer worth naming is 2, from ⌊(d−1)/2⌋ — a real formula, but the one for how many errors are CORRECTABLE. Keep the pair straight: corrects ⌊(d−1)/2⌋, suppresses as ⌊(d+1)/2⌋.',
  },
  {
    id: 'a28',
    kind: 'multi',
    lessonSlug: 'error-correction',
    points: 3,
    prompt: 'Select all that are true of the surface code.',
    options: [
      { id: 'a', text: 'It needs only nearest-neighbour connections on a two-dimensional grid.' },
      { id: 'b', text: 'Its threshold is around 1% per gate, which is unusually forgiving among codes.' },
      { id: 'c', text: 'Increasing the distance d increases the number of physical qubits per logical qubit roughly as d².' },
      { id: 'd', text: 'It implements every gate in a universal set transversally, without extra machinery.' },
      { id: 'e', text: 'A distance-d patch corrects any number of errors provided they arrive one at a time.' },
    ],
    correctIds: ['a', 'b', 'c'],
    explanation:
      'A and B are why the surface code won the architectural argument: a planar layout matches what superconducting and spin-qubit hardware can actually wire up, and a ~1% threshold is reachable. C is the cost — roughly 2d² physical qubits per logical qubit, which is where million-qubit estimates come from. D is false and is the single biggest hidden cost in fault tolerance: the surface code gives Cliffords cheaply but needs magic-state distillation for the T gate, and distillation factories dominate the qubit budget of a real algorithm. E ignores that errors accumulate between rounds of syndrome extraction, and that the extraction itself is faulty, which is why syndromes are measured repeatedly and decoded over a spacetime history.',
  },

  {
    id: 'a29',
    kind: 'single',
    lessonSlug: 'vqe-and-nisq',
    points: 2,
    prompt: 'What does the variational principle guarantee about VQE\'s output?',
    options: [
      { id: 'a', text: 'The energy it reports is never below the true ground-state energy, so it is a rigorous upper bound.' },
      { id: 'b', text: 'The optimizer converges to the global minimum given enough iterations.' },
      { id: 'c', text: 'The reported energy is within chemical accuracy of the true value.' },
      { id: 'd', text: 'The state it prepares is the true ground state up to a global phase.' },
    ],
    correctIds: ['a'],
    explanation:
      '⟨ψ|H|ψ⟩ ≥ E₀ for every normalised |ψ⟩, so any answer VQE produces is an upper bound, and a lower number is unambiguously a better one. That one-sidedness is the whole reason the method is trustworthy at all, and it is worth noticing what it does not promise: B and D would require the ansatz to contain the ground state and the optimizer to find it, neither of which is guaranteed, and C is a claim about accuracy that no principle supplies. Sampling noise can also push a measured estimate below E₀, which is a statistical artefact and not a violation.',
  },
  {
    id: 'a30',
    kind: 'numeric',
    lessonSlug: 'vqe-and-nisq',
    points: 2,
    prompt:
      'Estimating an observable of variance 1 from S shots gives a standard error of 1/√S. How many shots are needed for a standard error of 0.005? Give a whole number.',
    correctNumber: 40000,
    tolerance: 0,
    explanation:
      'S = 1/0.005² = 40 000 — four times the 10 000 needed for 0.01, because the cost goes as the inverse square of the target error. Multiply that by the hundreds or thousands of Pauli terms in a molecular Hamiltonian, then by every step of the optimization loop, and the shot budget rather than the qubit count is what makes a VQE run take days. Answering 200 reads the relationship as linear.',
  },
  {
    id: 'a31',
    kind: 'multi',
    lessonSlug: 'vqe-and-nisq',
    points: 3,
    prompt: 'Select all that are true of error MITIGATION, as distinct from error correction.',
    options: [
      { id: 'a', text: 'Zero-noise extrapolation runs the circuit at several amplified noise levels and extrapolates back to zero.' },
      { id: 'b', text: 'It reduces bias in an estimated expectation value; it does not give you a clean output state.' },
      { id: 'c', text: 'Its sampling cost typically grows exponentially with circuit depth, so it does not scale indefinitely.' },
      { id: 'd', text: 'It detects and repairs errors during the computation, without needing extra qubits.' },
      { id: 'e', text: 'It requires the physical error rate to be below a threshold to work at all.' },
    ],
    correctIds: ['a', 'b', 'c'],
    explanation:
      'A, B and C are the honest summary: mitigation is post-processing over many noisy runs, it delivers a better NUMBER rather than a better state, and you pay for it in shots — an overhead that grows exponentially with the amount of noise being cancelled. D describes error correction, and the difference matters: nothing is repaired mid-circuit and the quantum state is as noisy as it ever was. E imports the threshold theorem, which is a statement about correction; mitigation degrades smoothly rather than having a cliff, which is why it is what NISQ devices actually use.',
  },
  {
    id: 'a32',
    kind: 'single',
    lessonSlug: 'vqe-and-nisq',
    points: 3,
    prompt:
      'A "hardware-efficient" ansatz is built from whatever gates the device runs natively, in repeated layers. What is the central trade-off?',
    options: [
      { id: 'a', text: 'It is shallow enough to survive the noise, but its layers are not informed by the problem, so it is prone to barren plateaus and may not contain a good state at all.' },
      { id: 'b', text: 'It is more accurate than a chemistry-derived ansatz but takes longer to optimize.' },
      { id: 'c', text: 'It needs more qubits than a problem-derived ansatz for the same molecule.' },
      { id: 'd', text: 'It can only represent product states, so it cannot describe correlated electrons.' },
    ],
    correctIds: ['a'],
    explanation:
      'The tension is expressibility against trainability. A UCCSD ansatz is grounded in the physics and its parameters mean something, but it compiles to circuits far too deep for current hardware; a hardware-efficient ansatz fits on the device and buys that with a parameter landscape that is generic, flat at scale, and not guaranteed to contain the ground state anywhere in it. B inverts the accuracy claim. D is false — entangling layers are exactly what these ansätze are made of.',
  },

  {
    id: 'a33',
    kind: 'numeric',
    lessonSlug: 'quantum-cryptography',
    points: 3,
    prompt:
      'In BB84, Eve intercepts every photon, measures it in a randomly chosen basis and resends what she found. Among the bits Alice and Bob keep after sifting, what fraction disagree? Give a decimal between 0 and 1.',
    correctNumber: 0.25,
    tolerance: 0.001,
    explanation:
      'Eve picks the wrong basis half the time; when she does, her resent photon is random in Alice\'s basis, so Bob disagrees half of that time — 0.5 × 0.5 = 0.25. A 25% error rate on a channel that should be near zero is unmissable, which is the entire security argument, and it is why protocols abort above a threshold of a few per cent. Answering 0.5 forgets that Eve is right half the time by luck; answering 0.125 applies the sifting factor twice, once here and once in the earlier sifting step.',
  },
  {
    id: 'a34',
    kind: 'single',
    lessonSlug: 'quantum-cryptography',
    points: 2,
    prompt: 'How does the E91 protocol differ from BB84?',
    options: [
      { id: 'a', text: 'It distributes entangled pairs and detects eavesdropping through a Bell-inequality violation rather than through an error rate on prepared states.' },
      { id: 'b', text: 'It removes the need for an authenticated classical channel.' },
      { id: 'c', text: 'It transmits the key itself over the entangled pair, so no classical communication is needed.' },
      { id: 'd', text: 'It is secure against a computationally unbounded adversary, whereas BB84 assumes a bounded one.' },
    ],
    correctIds: ['a'],
    explanation:
      'E91 replaces "prepare and measure" with a shared entangled source: Alice and Bob measure along randomly chosen axes, keep the matching ones as key, and use the mismatched ones to test CHSH. A violation certifies that no local description — including any record Eve holds — can account for the correlations, which is a stronger and more elegant statement of the same guarantee. B is false for every QKD protocol, and it is the caveat most often dropped. D is false in the other direction: both protocols are information-theoretically secure, and that is the point of QKD.',
  },
  {
    id: 'a35',
    kind: 'multi',
    lessonSlug: 'quantum-cryptography',
    points: 3,
    prompt: 'Select all that are true of the role no-cloning plays in quantum cryptography.',
    options: [
      { id: 'a', text: 'It stops Eve keeping a perfect copy of a photon and forwarding the original untouched.' },
      { id: 'b', text: 'It is why an eavesdropper must measure, and therefore must disturb.' },
      { id: 'c', text: 'It also blocks the obvious way to build a quantum repeater, which is why long links need entanglement swapping or trusted nodes.' },
      { id: 'd', text: 'It guarantees that any eavesdropping is detected with certainty on every single bit.' },
      { id: 'e', text: 'It prevents Eve from storing photons and measuring them later, after the bases are announced.' },
    ],
    correctIds: ['a', 'b', 'c'],
    explanation:
      'A and B are the mechanism, and C is the operational consequence people underestimate: an optical signal cannot simply be amplified without destroying the quantum state, so QKD range is limited by loss in a way classical fibre is not. D overstates it — detection is statistical, which is why error rates are estimated from a sampled subset and privacy amplification handles the residue. E describes a genuine attack, quantum memory plus delayed measurement, and no-cloning does not forbid it; what defeats it is that Alice and Bob announce bases only after the photons are received, and that the memory required is well beyond current technology.',
  },
  {
    id: 'a36',
    kind: 'single',
    lessonSlug: 'quantum-cryptography',
    points: 2,
    prompt:
      'Why are organisations migrating to post-quantum cryptography now, when no quantum computer can factor a 2048-bit key?',
    options: [
      { id: 'a', text: 'Harvest-now-decrypt-later: traffic recorded today can be decrypted whenever a capable machine arrives, so anything needing long-term secrecy is already exposed.' },
      { id: 'b', text: 'Because post-quantum algorithms are faster than RSA and ECC on current hardware.' },
      { id: 'c', text: 'Because a capable quantum computer is expected within two years.' },
      { id: 'd', text: 'Because RSA and ECC have been broken classically and are being retired regardless.' },
    ],
    correctIds: ['a'],
    explanation:
      'The threat model is retroactive, and that is what makes the timeline urgent despite the hardware being far off: a diplomatic cable, a medical record or a signing key with a twenty-year lifetime must be protected against machines that do not yet exist. There is a second, slower reason — cryptographic migrations historically take a decade or more, so starting when the machine arrives is starting too late. B is not generally true; the lattice schemes have larger keys and different performance trade-offs. D is false, and worth saying plainly: RSA and ECC remain classically secure at current key sizes.',
  },

  // ── Quantum Machine Learning ──────────────────────────────────────────
  {
    id: 'a37',
    kind: 'single',
    lessonSlug: 'quantum-machine-learning',
    points: 2,
    prompt: 'In a variational quantum classifier, which part of the pipeline does the training — the adjustment of the parameters θ?',
    options: [
      { id: 'a', text: 'A classical optimiser, using expectation values estimated from repeated runs of the circuit.' },
      { id: 'b', text: 'The quantum circuit itself, which converges to the optimal θ through repeated interference.' },
      { id: 'c', text: 'The measurement, which collapses θ toward the values that fit the data.' },
      { id: 'd', text: 'The encoding gates, which adapt to the data distribution as more points are loaded.' },
    ],
    correctIds: ['a'],
    explanation:
      'The architecture is the VQE loop with a loss function: the device only prepares states and returns measurement statistics, and every decision about where to move θ next is made classically — gradient descent via the parameter-shift rule, or a gradient-free optimiser. Nothing quantum "learns" on its own; B, C and D all attribute agency to components that merely evaluate. Recognising this shape matters practically, because it means QML inherits every cost of the variational loop: shots per expectation value, two evaluations per parameter per gradient, and barren plateaus.',
  },
  {
    id: 'a38',
    kind: 'single',
    lessonSlug: 'quantum-machine-learning',
    points: 2,
    prompt: '"Quantum models train faster because superposition processes every data point at once." What is wrong with this claim?',
    options: [
      { id: 'a', text: 'Nothing — this is the demonstrated source of quantum advantage in ML.' },
      { id: 'b', text: 'Measurement yields one Born-rule sample, so superposed evaluations cannot be read out, and estimating each expectation value costs thousands of shots — training is slower than classical, not faster.' },
      { id: 'c', text: 'Superposition can only hold two data points at a time, so the parallelism is limited.' },
      { id: 'd', text: 'It is true for training but false for inference.' },
    ],
    correctIds: ['b'],
    explanation:
      'The same misconception that "tries every answer at once" plants for Grover reappears in ML costume. Amplitudes are not retrievable parallel results: readout samples a single outcome and destroys the rest, so the useful question is never "how much did the circuit compute" but "what survives one measurement". Gradient training makes the accounting worse — O(1/ε²) shots per expectation value, two evaluations per parameter under the parameter-shift rule — while a GPU takes exact gradients in one backward pass. The honest case for QML is a different hypothesis class, never faster training.',
  },
  {
    id: 'a39',
    kind: 'multi',
    lessonSlug: 'quantum-machine-learning',
    points: 3,
    prompt: 'Select all that are TRUE of amplitude encoding (a 2ⁿ-dimensional vector stored in the amplitudes of n qubits).',
    options: [
      { id: 'a', text: 'The representation is exponentially more compact than angle encoding.' },
      { id: 'b', text: 'Preparing an arbitrary amplitude-encoded state needs circuit depth exponential in n, unless a qRAM-style device is assumed.' },
      { id: 'c', text: 'The amplitudes cannot be read back directly — estimating one to precision ε costs on the order of 1/ε² measurement shots.' },
      { id: 'd', text: 'Loading is cheap; the exponential cost appears only at readout.' },
      { id: 'e', text: 'Because the state holds 2ⁿ numbers, any model using it is exponentially faster than a classical model.' },
    ],
    correctIds: ['a', 'b', 'c'],
    explanation:
      'A is the real fact that anchors the hype, and B and C are the two costs that consume it: arbitrary state preparation takes depth O(2ⁿ/n) — the qRAM that would fix this does not exist — and measurement samples basis states rather than printing amplitudes. D has the loading cost backwards, and E is the standard leap from storage to speed that dequantisation results keep puncturing: compression you can neither fill cheaply nor read out is a storage format without I/O, not a speed-up. Auditing where a proposal loads its data and how few bits it needs back is the fastest way to evaluate any QML claim.',
  },
  {
    id: 'a40',
    kind: 'single',
    lessonSlug: 'quantum-machine-learning',
    points: 3,
    prompt: 'A circuit encodes feature x through a single rotation gate, followed by many layers of trainable gates. Schuld et al. (2021) showed its output f(x) is a Fourier series in x. What do the trainable parameters control?',
    options: [
      { id: 'a', text: 'Only the coefficients of the series — the available frequencies are fixed entirely by how the data is encoded.' },
      { id: 'b', text: 'Both the coefficients and the frequencies, provided the circuit is deep enough.' },
      { id: 'c', text: 'The frequencies only; the coefficients are set by the measurement basis.' },
      { id: 'd', text: 'Nothing about the function — trainable gates only mitigate noise.' },
    ],
    correctIds: ['a'],
    explanation:
      'The frequencies come from the eigenvalue spectrum of the encoding gates — from how, and how many times, x enters the circuit — and no amount of trainable depth adds new ones. Encode x once through one rotation and the model is a + b·cos(x) + c·sin(x) forever; a target varying like cos(3x) is unlearnable by construction, while re-uploading x at three points in the circuit makes it learnable. This is the precise sense in which the encoding, not the parameterised part, is the model, and it is why encoding design dominates QML practice.',
  },
  {
    id: 'a41',
    kind: 'single',
    lessonSlug: 'quantum-machine-learning',
    points: 3,
    prompt: 'What is the honest status, as of 2026, of exponential quantum advantage in machine learning on CLASSICAL data?',
    options: [
      { id: 'a', text: 'One provable separation exists, for a problem built from the discrete logarithm; for natural classical data no exponential advantage has been proven or demonstrated.' },
      { id: 'b', text: 'It has been demonstrated on standard benchmarks such as image classification.' },
      { id: 'c', text: 'It has been mathematically ruled out.' },
      { id: 'd', text: 'It follows automatically from the exponential size of Hilbert space.' },
    ],
    correctIds: ['a'],
    explanation:
      'Liu, Arunachalam and Temme (2021) proved a quantum kernel learns a discrete-log-based classification task that no efficient classical learner can, assuming discrete log is hard — a genuine separation, for labels reverse-engineered from the one function quantum computers are known to compute and classical ones are believed unable to. No natural dataset with that structure is known, Tang-style dequantisation removed several claimed exponentials once classical algorithms were granted matching data access, and demonstrated exponential learning advantages (Huang et al.) are for quantum data from sensors and simulators. C errs the other way — no impossibility proof exists — which is exactly why "open question" is the accurate summary and anything stronger is salesmanship.',
  },
  {
    id: 'a42',
    kind: 'single',
    lessonSlug: 'quantum-machine-learning',
    points: 2,
    prompt: 'Why do barren-plateau results, proved originally in the context of VQE, apply to quantum machine-learning models without modification?',
    options: [
      { id: 'a', text: 'They do not — classification losses are convex, so QML training landscapes are benign.' },
      { id: 'b', text: 'The theorems are statements about parameterised circuits and cost functions in general: an expressive enough trainable circuit has exponentially concentrating gradients regardless of whether the cost is an energy or a loss.' },
      { id: 'c', text: 'Because QML circuits always contain a Hamiltonian as a sub-block.' },
      { id: 'd', text: 'They apply only when the training data is itself quantum.' },
    ],
    correctIds: ['b'],
    explanation:
      'McClean et al.\'s 2018 argument never mentions chemistry: it needs a sufficiently expressive random parameterised circuit (approaching a 2-design) and a cost built from expectation values, and both ingredients are exactly what a deep hardware-efficient classifier provides. Swapping the Hamiltonian for a cross-entropy loss changes nothing in the derivation, so gradients still concentrate exponentially in qubit count, and the noise-induced and global-cost variants carry over too. The known escape routes — shallow structured circuits, local observables — also carry over, along with their sting: models tame enough to train are frequently tame enough to simulate or surrogate classically.',
  },

  // Third QML wave, a43–a45: the training-cost arithmetic, the re-uploading
  // mechanism as a runnable circuit, and dequantisation — the three sharp
  // facts of the lesson the first wave left untested.
  {
    id: 'a43',
    kind: 'numeric',
    lessonSlug: 'quantum-machine-learning',
    points: 2,
    prompt:
      'A variational quantum classifier has 40 trainable parameters, each a rotation generated by a Pauli. Using the parameter-shift rule, how many expectation-value estimates does ONE gradient evaluation at one data point require? Give a whole number.',
    correctNumber: 80,
    tolerance: 0,
    explanation:
      'The parameter-shift rule is exact but not free: ∂⟨M⟩/∂θᵢ = [⟨M⟩(θᵢ+π/2) − ⟨M⟩(θᵢ−π/2)]/2 needs two full expectation-value estimates per parameter, so 40 parameters cost 80 — and each of those estimates is itself thousands of shots, since a standard error of ε costs O(1/ε²) samples. Answering 40 forgets the factor of two; answering 1 imports backpropagation intuition, and that is the instructive mistake: a GPU computes the exact gradient of every parameter of a neural network in one backward pass, whereas the quantum circuit must be physically re-run per shift per parameter. This arithmetic, multiplied over a dataset and an optimisation trajectory, is why quantum training is slower than classical by orders of magnitude, never faster.',
  },
  {
    id: 'a44',
    kind: 'circuit-outcome',
    lessonSlug: 'quantum-machine-learning',
    points: 3,
    prompt:
      'Angle encoding of the same feature value x = π/2 into two qubits: q0 receives it once, q1 receives it twice — data re-uploading, with no trainable gates in between. Which outcomes are possible? Outcomes are written q1q0. Select all that apply.',
    qasm: `OPENQASM 2.0;
include "qelib1.inc";
qreg q[2];
creg c[2];
ry(pi/2) q[0];
ry(pi/2) q[1];
ry(pi/2) q[1];
measure q -> c;`,
    options: [
      { id: 'a', text: '00' },
      { id: 'b', text: '01' },
      { id: 'c', text: '10' },
      { id: 'd', text: '11' },
    ],
    correctIds: ['c', 'd'],
    explanation:
      'Rotations about the same axis compose: encoding x twice applies RY(2x), not RY(x) again with no effect. So q0 sits at RY(π/2)|0⟩ = (|0⟩+|1⟩)/√2 — a fair coin — while q1 lands at RY(π)|0⟩ = |1⟩ exactly. The possible outcomes are 10 and 11, each at 50%: q1 always reads 1, q0 is random. Expecting all four outcomes treats the second upload as redundant — "the data is already in there" — which is precisely the intuition the Schuld result corrects: how many times x enters the circuit sets which frequencies of x the model contains, and here the doubled encoding makes q1 respond as cos(2x) does where q0 responds as cos(x). Re-uploading enlarges the model class; repeating trainable layers does not.',
  },
  {
    id: 'a45',
    kind: 'single',
    lessonSlug: 'quantum-machine-learning',
    points: 3,
    prompt:
      'In 2018 Ewin Tang "dequantised" the quantum recommendation-systems algorithm, which had been a flagship example of exponential quantum advantage in ML. What did the result establish?',
    options: [
      { id: 'a', text: 'Granted classical sampling access analogous to the quantum algorithm\'s state-preparation assumptions, a classical algorithm solves the same task with only polynomial slowdown — the exponential lived in the data-access assumption, not in the quantum processing.' },
      { id: 'b', text: 'That the quantum algorithm was mathematically incorrect and never delivered the claimed speedup.' },
      { id: 'c', text: 'That no quantum algorithm can ever outperform classical methods on any machine-learning task.' },
      { id: 'd', text: 'That the speedup survives, but only on fault-tolerant hardware rather than NISQ devices.' },
    ],
    correctIds: ['a'],
    explanation:
      'Tang\'s result is a fairness correction, and that is what makes it the pattern for a whole genre: the quantum algorithm assumed the data was available in quantum-accessible form, and once the classical competitor is granted the analogous access — sampling from the data in a matching way — the exponential gap closes to a polynomial one. B is wrong: the quantum algorithm was and remains correct; what fell was the comparison, not the mathematics. C overreaches in the opposite direction — dequantisation is proved problem by problem, and it has not touched the discrete-log kernel separation of Liu, Arunachalam and Temme, which is why that one still stands. D misplaces the issue entirely: no amount of better hardware restores an advantage that was an artefact of asymmetric assumptions. The durable lesson is the audit question the lesson keeps repeating — before believing any claimed exponential, ask where the data comes from and what loading it costs.',
  },

  // ── Post-quantum cryptography (advanced lesson 7) ──────────────────────
  {
    id: 'a46',
    kind: 'single',
    lessonSlug: 'post-quantum-cryptography',
    points: 1,
    prompt: 'Which of these is post-quantum cryptography?',
    options: [
      { id: 'a', text: 'ML-KEM: a lattice-based key-encapsulation scheme that runs as ordinary software on today\'s hardware.' },
      { id: 'b', text: 'BB84: a key-distribution protocol whose security comes from measurement disturbance.' },
      { id: 'c', text: 'Shor\'s algorithm, run defensively to test whether one\'s own keys are breakable.' },
      { id: 'd', text: 'A one-time pad, since it is information-theoretically secure.' },
    ],
    correctIds: ['a'],
    explanation:
      'Post-quantum cryptography is classical software built on problems with no known efficient quantum attack, and ML-KEM (FIPS 203) is its flagship. B is quantum key distribution — physically secured, but a different thing, needing dedicated optical links and still relying on classical authentication. C is not a defence at all. D is secure against everything but is a symmetric scheme with a key as long as the message, which does not solve the public-key problem — how two strangers agree on a key — that Shor actually threatens.',
  },
  {
    id: 'a47',
    kind: 'numeric',
    lessonSlug: 'post-quantum-cryptography',
    points: 2,
    prompt:
      'Grover\'s algorithm gives a quadratic speed-up on unstructured search. Against a symmetric cipher with a 128-bit key, roughly how many bits of security remain? Give a whole number.',
    correctNumber: 64,
    tolerance: 0,
    explanation:
      'Grover searches a space of 2^128 keys in about 2^64 quantum evaluations, so the effective security is halved to 64 bits. That is the whole quantum threat to symmetric cryptography, and it is answered by moving to AES-256, which retains ~128-bit security under Grover. It is worth contrasting with Shor, which does not halve RSA\'s security but destroys it: the public-key layer is the emergency, the symmetric layer is a parameter change. Answering 0 conflates the two threats; answering 128 forgets Grover applies at all.',
  },
  {
    id: 'a48',
    kind: 'numeric',
    lessonSlug: 'post-quantum-cryptography',
    points: 2,
    prompt:
      'Mosca\'s inequality, using Mosca\'s strict form: you are exposed if X + Y > Z. Data must stay confidential for X = 25 years and a full migration would take Y = 7 years. What is the smallest number of years Z until a cryptographically relevant quantum computer at which the data would NOT already be exposed today? Give a whole number.',
    correctNumber: 32,
    tolerance: 0,
    explanation:
      'The data is exposed if X + Y > Z, so it is safe only when Z ≥ 32. Data sent today under vulnerable key exchange can be recorded now and decrypted the day the machine exists; the migration protects only what is sent after it finishes, seven years from now, and even that must survive a further 25. The common slip is to compare Z with Y alone — "the machine is 15 years off and migration takes 7, so we have time" — which measures from the end of the migration rather than from the day the data is transmitted, and is exactly the reasoning "harvest now, decrypt later" defeats.',
  },
  {
    id: 'a49',
    kind: 'single',
    lessonSlug: 'post-quantum-cryptography',
    points: 2,
    prompt: 'Why is the Learning With Errors problem believed to resist Shor-style quantum attacks?',
    options: [
      { id: 'a', text: 'Its hidden-subgroup structure is over a non-abelian (dihedral) group, where the Fourier-sampling technique that solves factoring and discrete logarithms does not go through — and no efficient replacement is known.' },
      { id: 'b', text: 'It has been mathematically proven that no quantum algorithm can solve it in polynomial time.' },
      { id: 'c', text: 'The modulus q is chosen larger than any quantum computer could ever represent.' },
      { id: 'd', text: 'The added noise makes the problem random, and quantum computers cannot process random data.' },
    ],
    correctIds: ['a'],
    explanation:
      'Shor exploits a hidden period in an abelian group, read off by the quantum Fourier transform. Lattice problems map to the dihedral hidden-subgroup problem, which is non-abelian; the abelian trick fails, Kuperberg\'s subexponential algorithm is far too weak for real parameters, and a 2024 claimed quantum attack was retracted within days. B overstates it — there is no such proof, which is precisely why deployments are hybrid. C is nonsense: q for ML-KEM is 3329. D garbles the real point — the noise is what defeats Gaussian elimination and classical algebra, not "randomness" in general.',
  },
  {
    id: 'a50',
    kind: 'multi',
    lessonSlug: 'post-quantum-cryptography',
    points: 3,
    prompt: 'Select all that are true of the migration to post-quantum cryptography as of 2026.',
    options: [
      { id: 'a', text: 'Hybrid post-quantum key exchange (X25519 combined with ML-KEM) is on by default in major browsers and CDNs, invisibly to users.' },
      { id: 'b', text: 'Signatures and PKI are migrating more slowly than key exchange, largely because post-quantum signatures are several kilobytes and certificate chains carry several of them.' },
      { id: 'c', text: 'Two NIST candidates, Rainbow and SIKE, were broken during the competition — by classical attacks — which is why several unrelated mathematical families were standardised.' },
      { id: 'd', text: 'A cryptographically relevant quantum computer has been publicly demonstrated, which triggered the migration.' },
      { id: 'e', text: 'The recommended fix for RSA is to move to 8192-bit keys, which Shor cannot factor in practice.' },
    ],
    correctIds: ['a', 'b', 'c'],
    explanation:
      'A, B and C are the state of play. Key exchange migrated first because ML-KEM adds only about a kilobyte to a handshake and two browser vendors plus one CDN could switch it on unilaterally; signatures wait on every certificate authority and hardware root of trust changing in a verifiable order. The Rainbow and SIKE breaks — a laptop weekend and about an hour on one core respectively — are why NIST also standardised hash-based SLH-DSA and selected code-based HQC as a backup. D is false: no such machine exists, and the migration is a risk decision under uncertainty driven by harvest-now-decrypt-later. E is the classic wrong answer — Shor is polynomial-time, so a larger key buys only polynomially more work, not safety.',
  },
  {
    id: 'a51',
    kind: 'single',
    lessonSlug: 'post-quantum-cryptography',
    points: 3,
    prompt:
      'A vendor claims its product is "quantum-safe" because it has replaced ECDH with ML-KEM in its TLS handshake, while its certificates remain RSA-2048. What is the most precise assessment?',
    options: [
      { id: 'a', text: 'The product is fully quantum-safe: key exchange is the only part of TLS Shor threatens.' },
      { id: 'b', text: 'Recorded traffic is now protected against future decryption, but a future quantum computer could forge the RSA certificate and impersonate the server in live connections — so confidentiality is addressed and authentication is not.' },
      { id: 'c', text: 'The product is no safer than before, because ML-KEM is unproven and RSA-2048 is still present.' },
      { id: 'd', text: 'The product is less safe than before, because ML-KEM keys are larger and therefore easier to attack.' },
    ],
    correctIds: ['b'],
    explanation:
      'The two threats have different timelines, and the question tests whether you can separate them. Harvest-now-decrypt-later attacks recorded key exchanges, so replacing ECDH with ML-KEM closes that exposure today — a real and worthwhile gain. Forging an RSA signature, by contrast, only helps an attacker who has the quantum computer at the moment of the connection, so the certificate can be migrated later without retroactive loss; but until it is, authentication remains breakable on that future day. A misses that Shor breaks RSA signatures completely. C throws away the genuine confidentiality gain. D confuses key size with attack surface — ML-KEM\'s larger keys are a bandwidth cost, not a weakness.',
  },
]

/** Every certification question in the app. SERVER ONLY. */
export const QUESTION_POOL: ExamQuestion[] = [...FOUNDATION_QUESTIONS, ...ADVANCED_QUESTIONS]

/**
 * The full pool an exam may draw from, in pool order.
 *
 * Reads `poolIds` from the client-safe catalogue and resolves them here, which
 * is what lets `/certify` state "drawn from a pool of 58" without the bank.
 */
export function questionsFor(examId: string): ExamQuestion[] {
  const exam = EXAMS.find((e) => e.id === examId)
  if (!exam) return []
  const byId = new Map(QUESTION_POOL.map((q) => [q.id, q]))
  return exam.poolIds
    .map((id) => byId.get(id))
    .filter((q): q is ExamQuestion => q !== undefined)
}

export function getQuestion(id: string): ExamQuestion | undefined {
  return QUESTION_POOL.find((q) => q.id === id)
}
