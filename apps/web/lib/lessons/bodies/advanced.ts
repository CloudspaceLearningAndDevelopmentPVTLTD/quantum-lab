/**
 * Bodies of the six Advanced Quantum Computing lessons — the PAID track.
 *
 * BODY ONLY. Metadata (title, level, minutes, objectives, track membership)
 * lives in `lib/lessons/index.ts`; this module holds the prose, code, callouts
 * and quiz questions, and is reachable only through `lib/lessons/server.ts`.
 * Importing it from a client component puts the paid course text (~70KB+ as
 * JSON, unminified) back into the browser bundle — the exact defect the
 * metadata/body split closed. `lib/lessons/bundle.test.ts` walks the
 * import graph from every 'use client' module and fails if that happens.
 *
 * These six are the ones the paywall is actually about. Until the split the
 * original four shipped in full in the shared client chunk of EVERY route, so
 * the gate raised the price of the paid course from `curl` to "open a .js
 * file".
 *
 * QUESTION-FIRST: each lesson carries 2-3 'inline-check' blocks at its real
 * predict moments, each sitting IMMEDIATELY BEFORE the section that answers
 * it (Brilliant's pattern; the renderer softly gates on the check — see
 * lib/lessons/inlineCheck.ts). The end-of-lesson quizzes deliberately stay:
 * predicting first and being tested later on the same idea is retrieval
 * practice, not redundancy.
 */

import type { LessonBody } from '../types'

export const ADVANCED_BODIES: LessonBody[] = [
  // ─────────────────────────────────────────────────────────────────────
  // 1. Shor's Algorithm
  // ─────────────────────────────────────────────────────────────────────
  {
    slug: 'shor',

    blocks: [
      {
        kind: 'prose',
        title: 'The reduction: factoring is period-finding in disguise',
        paragraphs: [
          'Shor\'s algorithm is usually introduced as "the quantum algorithm that factors numbers", which is true and also slightly misleading, because the factoring is not where the quantum computer earns its keep. The algorithm is a classical reduction wrapped around one quantum subroutine, and the subroutine does not know what factoring is. It finds the period of a periodic function. That is all it does.',
          'Here is the reduction. Suppose you want to factor N. Pick a random integer a with 1 < a < N. Compute gcd(a, N) — if that is not 1 you have stumbled onto a factor by luck and you are done, which essentially never happens for the semiprimes RSA uses. Otherwise, consider the function f(x) = a^x mod N. Because a and N are coprime, this function is periodic: there is some smallest r > 0 with a^r ≡ 1 (mod N), and thereafter f repeats with period r. That r is called the multiplicative order of a modulo N.',
          'Now do a little algebra. If r happens to be even, then a^r − 1 ≡ 0 (mod N) factors as (a^{r/2} − 1)(a^{r/2} + 1) ≡ 0 (mod N). So N divides that product. Unless one of the two factors is itself a multiple of N — the failure case, which is what you get when a^{r/2} ≡ −1 (mod N) — the factors of N must be split between the two brackets. Compute gcd(a^{r/2} − 1, N) and gcd(a^{r/2} + 1, N) and at least one of them is a non-trivial factor of N.',
          'That is the whole classical part, and it is genuinely elementary — Euclid\'s algorithm and one line of high-school algebra. The failure modes (r odd, or a^{r/2} ≡ −1) happen with probability at most about 1/2 for a random a, so you retry with a fresh a and succeed after a couple of attempts on average. Everything difficult has been pushed into one place: finding r. Classically, finding the order of a modulo N is believed to be as hard as factoring itself, and no polynomial-time classical algorithm is known — the best classical methods, like the number field sieve, are sub-exponential but still super-polynomial. Quantumly, it is the natural thing a quantum computer does.',
        ],
      },
      {
        kind: 'inline-check',
        id: 'c1',
        question:
          'The quantum computer\'s one job is now to find the period r of f(x) = a^x mod N. A natural plan: prepare a superposition over all x, compute f into a second register, measure BOTH registers, and repeat until the collected (x, f(x)) samples reveal the period. Why does this plan fail?',
        options: [
          { id: 'a', text: 'Each run yields one uniformly random x with its f(x) — samples a classical computer could generate for itself by just picking x and computing a^x mod N, and no efficient procedure recovers r from polynomially many of them' },
          { id: 'b', text: 'Measuring the second register changes f, so successive samples come from different functions' },
          { id: 'c', text: 'Modular exponentiation cannot be made reversible, so the superposition cannot be prepared in the first place' },
          { id: 'd', text: 'It does not fail — this is exactly how Shor\'s algorithm works' },
        ],
        correctId: 'a',
        explanation:
          'Measure both registers and superposition has bought you nothing: you hold one random (x, a^x mod N) pair per run, which a laptop can produce without any quantum hardware — pick x, compute a^x mod N by repeated squaring. For cryptographic N the period r is astronomically large, and no known efficient classical method extracts r from such samples; that hardness is the whole reason RSA works. The algorithm has to do something cleverer: get the period into a form ONE measurement can see. The next two sections build exactly that.',
      },
      {
        kind: 'prose',
        title: 'Modular exponentiation into superposition',
        paragraphs: [
          'The quantum subroutine uses two registers. The first holds x, the exponent, and needs about 2n qubits when N is n bits long. The second holds the value f(x) = a^x mod N and needs n qubits. Start both in |0⟩ and apply Hadamards across the whole first register, producing an even superposition over every exponent: (1/√Q) Σ_x |x⟩|0⟩, where Q = 2^{2n}.',
          'Then apply modular exponentiation as a reversible circuit: |x⟩|0⟩ ↦ |x⟩|a^x mod N⟩. This is by far the most expensive part of the algorithm in practice. It is not a clever quantum trick at all — it is ordinary repeated-squaring arithmetic, compiled into reversible gates, with all the adders and comparators and ancillas that implies. Most of the gate count and nearly all of the circuit depth in a real Shor implementation lives here, not in the Fourier transform everyone talks about.',
          'After that step the joint state is (1/√Q) Σ_x |x⟩|a^x mod N⟩. Now measure the second register — or do not, it makes no difference to the analysis, which is a nice illustration of the deferred-measurement principle. Say you get the value y. The first register collapses onto exactly those x with a^x ≡ y, and by periodicity those are the values x₀, x₀ + r, x₀ + 2r, and so on: an evenly spaced comb with spacing r and an unknown offset x₀.',
          'Pause on what you now hold and what you cannot do with it. The state is a superposition over an arithmetic progression whose spacing is precisely the number you want. But measuring the first register directly would give you one uniformly random element of that progression, which tells you essentially nothing — a single sample from a comb with unknown offset is just a random number. And you cannot sample twice, because measuring destroys the state and re-running gives you a fresh, independent, unrelated offset x₀. The period is there in the state; you need an operation that converts spacing into something a single measurement can see.',
        ],
      },
      {
        kind: 'inline-check',
        id: 'c2',
        question:
          'The first register now holds a comb of amplitudes at x₀, x₀ + r, x₀ + 2r, … — spacing r, unknown random offset x₀. You apply the quantum Fourier transform and measure. Where should the outcomes concentrate?',
        options: [
          { id: 'a', text: 'On k = r and its multiples, reading the period off directly' },
          { id: 'b', text: 'On values k with k/Q close to c/r for whole numbers c — multiples of Q/r, the comb\'s spacing inverted' },
          { id: 'c', text: 'On k = x₀ — the Fourier transform recovers the offset, not the spacing' },
          { id: 'd', text: 'Nowhere — the unknown offset x₀ randomises the output uniformly' },
        ],
        correctId: 'b',
        explanation:
          'A Fourier transform turns spacing in its input into peak position in its output, and spacing r in a domain of size Q lands the peaks at multiples of Q/r — so the measured k satisfies k/Q ≈ c/r. Two traps here: option A forgets the inversion (a comb with LARGE spacing r transforms to peaks with SMALL spacing Q/r), and option D overestimates the offset — x₀ contributes a factor e^{2πix₀k/Q} to the amplitude at each output value k, a pure phase of modulus 1 that the Born rule squares away, so the offset moves no probability anywhere. The section below does the sum explicitly.',
      },
      {
        kind: 'prose',
        title: 'The QFT reads the period off a phase ramp',
        paragraphs: [
          'The quantum Fourier transform is exactly that operation. It maps |x⟩ to (1/√Q) Σ_k e^{2πixk/Q} |k⟩ — it takes a basis state to a uniform superposition whose phases wind around the unit circle at a rate set by x. Applied to a superposition, linearity does the rest, and the QFT does to the amplitude comb precisely what the classical DFT does to a periodic signal: it turns spacing in the input into sharp peaks in the output.',
          'Work out where the peaks land. The comb has terms at x₀ + jr for j = 0, 1, 2, …, so after the QFT the amplitude at output value k is proportional to Σ_j e^{2πi(x₀ + jr)k/Q}. The x₀ part factors out as a global phase — which is why the unknown offset is harmless, and it is a genuinely elegant feature of the construction. What remains is a geometric series in e^{2πijrk/Q}. That series is a sum of unit vectors marching around the circle: unless the step rk/Q is very close to a whole number, they spread out evenly and cancel almost completely. When rk/Q is near an integer, every term points the same way and the amplitudes reinforce.',
          'So the output distribution is concentrated on values of k with k/Q ≈ c/r for some integer c. This is destructive interference doing the same job it did in Grover\'s algorithm and in the double slit, just with a more elaborate phase pattern: the wrong answers cancel, and what survives is a number that encodes r.',
          'One important honesty note about the name. The QFT is not, by itself, a fast Fourier transform for data. It runs in O(n²) gates where the classical FFT needs O(n2^n) operations on 2^n samples, which sounds like an exponential speed-up — but the output lives in amplitudes you cannot read out. You get one sample from the transformed distribution and the state is gone. The QFT is useful precisely when one sample of the spectrum is what you needed, and period-finding is the canonical case where that is true.',
        ],
      },
      {
        kind: 'callout',
        tone: 'insight',
        title: 'Why you get c/r and not r',
        body: 'The measurement returns a k with k/Q ≈ c/r for some integer c you do not know, uniformly chosen from 0 to r−1. That is why one run may not be enough: if c and r share a factor, the continued-fraction step recovers only r divided by that factor. You detect this by checking a^{r_candidate} ≡ 1 (mod N) directly on a classical computer — cheap, and definitive. If the check fails, run the quantum part again for a fresh c and take the least common multiple of the candidates. A handful of runs suffices with high probability, which is why Shor\'s is a bounded-error probabilistic algorithm rather than a deterministic one.',
      },
      {
        kind: 'prose',
        title: 'Continued fractions: from a measured integer back to r',
        paragraphs: [
          'The measurement gives you an integer k. You know k/Q is close to c/r, where both c and r are unknown but r is smaller than N. The task is to find the fraction with a small denominator that best approximates the rational number k/Q, and this is a completely standard piece of eighteenth-century number theory: the continued-fraction expansion.',
          'Expand k/Q as a continued fraction, a₀ + 1/(a₁ + 1/(a₂ + …)), and truncate it at successive depths to get the convergents p₀/q₀, p₁/q₁, p₂/q₂, and so on. A theorem of Legendre guarantees that if |k/Q − c/r| < 1/(2r²), then c/r appears exactly among those convergents. Choosing Q > N² is what makes the measurement precise enough for that condition to hold, and it is the reason the first register needs roughly 2n qubits rather than n.',
          'So the classical post-processing is: expand, walk the convergents in order, and for each denominator q test whether a^q ≡ 1 (mod N). The first one that passes is the order r (or a divisor of it that you resolve by repeating). Every step of this is fast — continued fractions are Euclid\'s algorithm wearing a different hat, and modular exponentiation for the check is repeated squaring.',
          'It is worth stepping back to see the shape of the whole algorithm, because it is the shape of most useful quantum algorithms. Classical setup picks a and reduces the problem. A quantum circuit produces one noisy sample of a number-theoretic quantity that is classically hard to obtain. Classical post-processing turns that sample into an answer and — critically — verifies it. The quantum computer is a specialised sampler embedded in a classical program, never a general-purpose machine that runs the whole computation. And verification being cheap is what makes the probabilistic nature of the sample tolerable: you never have to trust the quantum device, you check its output.',
        ],
      },
      {
        kind: 'code',
        language: 'python',
        code: `"""Shor's algorithm with the quantum step replaced by classical brute force.

Everything outside find_order() is exactly what a real implementation does.
Only find_order() is intractable classically for large N — which is precisely
the part the quantum computer supplies.
"""
from math import gcd
from fractions import Fraction


def find_order(a: int, N: int) -> int:
    """The quantum subroutine, faked. O(r) here, O(n^3) on hardware."""
    x, r = a % N, 1
    while x != 1:
        x = (x * a) % N
        r += 1
    return r


def order_from_measurement(k: int, Q: int, a: int, N: int) -> int | None:
    """Classical post-processing: continued fractions on k/Q."""
    frac = Fraction(k, Q).limit_denominator(N)
    r = frac.denominator
    return r if r > 0 and pow(a, r, N) == 1 else None


def shor(N: int, attempts: int = 20) -> tuple[int, int] | None:
    for a in range(2, min(N, attempts + 2)):
        g = gcd(a, N)
        if g > 1:
            return g, N // g              # lucky: a shares a factor already

        r = find_order(a, N)
        if r % 2 == 1:
            continue                       # odd period — retry with a new a
        half = pow(a, r // 2, N)
        if half == N - 1:
            continue                       # a^(r/2) = -1 — no useful split

        p, q = gcd(half - 1, N), gcd(half + 1, N)
        if 1 < p < N:
            return p, N // p
        if 1 < q < N:
            return q, N // q
    return None


print(shor(15))     # (3, 5)
print(shor(21))     # (7, 3)
print(shor(3233))   # (61, 53)  — the textbook RSA toy modulus

# The continued-fraction step, shown on its own. Q = 2^11, r = 4,
# so a measurement lands near k/Q = c/4 for some c:
print(order_from_measurement(k=512, Q=2048, a=7, N=15))   # 4`,
        caption:
          'The classical scaffolding is short and elementary. Swap find_order for a period-finding circuit and this is Shor\'s algorithm — the quantum computer supplies one number and nothing else.',
      },
      {
        kind: 'embed',
        href: '/visualizations/qft',
        title: 'Quantum Fourier Transform',
        blurb:
          'Feed the QFT a periodic comb of amplitudes and watch the output concentrate into evenly spaced peaks. Change the period and watch the peak spacing change inversely; add noise to the input comb and watch the peaks blur — a direct picture of why circuit depth and coherence time set the largest number you can hope to factor.',
      },
      {
        kind: 'inline-check',
        id: 'c3',
        question:
          'Commit to an order of magnitude before reading on. The algorithm needs on the order of a thousand error-corrected LOGICAL qubits to factor a 2048-bit RSA modulus. At today\'s physical error rates, what do careful resource estimates say that costs in PHYSICAL qubits?',
        options: [
          { id: 'a', text: 'A few thousand — logical and physical qubits are roughly one-to-one on good hardware' },
          { id: 'b', text: 'A few tens of thousands — about ten physical qubits per logical one' },
          { id: 'c', text: 'On the order of a million physical qubits, running for days' },
          { id: 'd', text: 'It cannot be estimated until such a machine is built' },
        ],
        correctId: 'c',
        explanation:
          'At error rates near 10⁻³, the surface code needs hundreds to a thousand physical qubits per logical qubit, plus magic-state factories for the non-Clifford gates. The older standard estimate (Gidney and Ekerå, 2019/2021) landed near twenty million physical qubits for about eight hours; Gidney\'s 2025 analysis (arXiv 2505.15917) brings that down to under one million physical qubits — roughly 1,400 logical — running for under a week at 0.1% gate error. If you guessed low, you have plenty of company in press coverage that quotes physical qubit counts as if they were logical ones. The section below walks through where the overhead comes from and what it implies about timelines.',
      },
      {
        kind: 'prose',
        title: 'What breaking RSA actually costs',
        paragraphs: [
          'RSA\'s security rests on the belief that factoring a 2048-bit semiprime is infeasible. Shor\'s algorithm factors an n-bit number in roughly O(n³) quantum operations, so 2048-bit RSA needs something on the order of a few thousand logical qubits and on the order of 10¹⁰ or more logical gate operations. Elliptic-curve cryptography falls to the same machinery via discrete logarithms, at somewhat smaller sizes, so ECC is if anything an easier target than RSA rather than a refuge from it.',
          'The word "logical" is carrying all the weight in that paragraph. A logical qubit is an error-corrected abstraction built from many noisy physical ones, and at present-day error rates — around 10⁻³ per gate on good superconducting hardware — the surface code needs something like a few hundred to a thousand physical qubits per logical qubit, plus a substantial factory for producing the magic states that non-Clifford gates consume. Careful resource estimates keep improving: Gidney and Ekerå\'s 2019/2021 analysis, long the standard reference, put 2048-bit RSA at roughly twenty million physical qubits running for about eight hours; Gidney\'s 2025 update (arXiv 2505.15917) brings that down to under one million physical qubits — about 1,400 logical — running for under a week at a 0.1% gate error rate.',
          'Set that against reality. The largest superconducting devices announced have around a thousand physical qubits (IBM Condor, 2023: 1,121), without full error correction. A million is not one more generation of the same machine; it is roughly three orders of magnitude, and it demands manufacturing, wiring, cryogenics and classical control at a scale nobody has demonstrated. Headlines about "factoring 21 on a quantum computer" describe demonstrations that typically bake in knowledge of the answer to shrink the circuit, and they do not scale. This is why "how many qubits does it have" is close to a meaningless question about a device: physical qubit count without error rates, connectivity and coherence times tells you almost nothing.',
          'None of which makes the threat academic, for two reasons. The first is harvest-now-decrypt-later: an adversary can record encrypted traffic today and decrypt it whenever a machine finally exists, so anything that must stay secret for twenty years is already at risk. The second is migration time. Replacing cryptography across an installed base of protocols, embedded devices, certificate hierarchies and standards takes a decade or more of committee work and rollout. That is why NIST standardised post-quantum algorithms in 2024 — ML-KEM, ML-DSA and SLH-DSA, based on lattice and hash problems with no known quantum attack — and why the sensible time to migrate is well before the machine that motivates it is built.',
        ],
      },
      {
        kind: 'keypoints',
        points: [
          'Factoring reduces classically to finding the period r of f(x) = a^x mod N; only period-finding is quantum.',
          'If r is even and a^{r/2} ≢ −1 (mod N), then gcd(a^{r/2} ± 1, N) yields a non-trivial factor.',
          'Modular exponentiation into superposition creates a comb of amplitudes with spacing r and an irrelevant unknown offset.',
          'The QFT turns that spacing into interference peaks at k/Q ≈ c/r — wrong values cancel, the period survives.',
          'Continued fractions recover r from the measured k, and a^r ≡ 1 (mod N) verifies it cheaply on a classical machine.',
          'Cryptographically relevant factoring needs on the order of a thousand logical qubits — under a million physical ones by the 2025 estimate (down from twenty million in 2019), not the roughly one thousand that exist today.',
        ],
      },
      {
        kind: 'quiz',
        questions: [
          {
            id: 'q1',
            prompt: 'Which part of Shor\'s algorithm actually requires a quantum computer?',
            options: [
              { id: 'a', text: 'Computing gcd(a^{r/2} ± 1, N), which is exponentially hard classically' },
              { id: 'b', text: 'Finding the period r of a^x mod N' },
              { id: 'c', text: 'Choosing the random base a, which must be quantum-random to avoid bias' },
              { id: 'd', text: 'Multiplying the two recovered factors to verify the result' },
            ],
            correctId: 'b',
            explanation:
              'Everything except period-finding is elementary classical number theory: Euclid\'s algorithm for the gcds, repeated squaring for the modular arithmetic, continued fractions for the post-processing. All of it runs in polynomial time on a laptop. Order-finding is the single step with no known efficient classical algorithm, and it is the entire quantum contribution. Recognising this shape — a classical program that calls a quantum sampler once and then verifies the result — is more useful than memorising the circuit, because almost every practically motivated quantum algorithm has it.',
          },
          {
            id: 'q2',
            prompt: 'Why does measuring the first register before applying the QFT give you nothing useful?',
            options: [
              { id: 'a', text: 'Measurement in that basis is forbidden until the QFT has been applied' },
              { id: 'b', text: 'You would get one uniformly random element of the progression x₀, x₀+r, x₀+2r, …, and one sample of an offset comb carries no information about r' },
              { id: 'c', text: 'The first register holds no information about the period at all' },
              { id: 'd', text: 'It would give you r directly, but with an error too large to correct' },
            ],
            correctId: 'b',
            explanation:
              'The period genuinely is present in the state — it is the spacing of the superposed values — but a single sample from an arithmetic progression with an unknown random offset is indistinguishable from a uniformly random number. And you cannot take a second sample: measurement destroys the state, and re-running the circuit produces a fresh, independent offset. The QFT is what converts spacing (invisible to one sample) into peak position (visible to one sample). This is the recurring lesson of the whole course: a quantum algorithm must arrange for its answer to survive the brutal one-sample readout.',
          },
          {
            id: 'q3',
            prompt: 'Today\'s largest devices have around a thousand physical qubits. Why does that not put 2048-bit RSA at immediate risk?',
            options: [
              { id: 'a', text: 'Because RSA keys can simply be lengthened faster than qubit counts grow' },
              { id: 'b', text: 'Because Shor\'s algorithm has never been proven correct for large numbers' },
              { id: 'c', text: 'Because the estimate is in error-corrected logical qubits — on the order of a million physical qubits at current error rates' },
              { id: 'd', text: 'Because modular exponentiation cannot be made reversible' },
            ],
            correctId: 'c',
            explanation:
              'On the order of a thousand logical qubits is the right order for the algorithm, but every logical qubit costs hundreds to a thousand physical qubits under the surface code at today\'s error rates, plus magic-state factories for the non-Clifford gates. The older standard estimate (Gidney and Ekerå, 2019/2021) landed near twenty million physical qubits for about eight hours; the current one (Gidney, 2025) is under a million physical qubits for under a week — still roughly three orders of magnitude beyond existing hardware. Option A fails on the exponents: Shor\'s runs in O(n³), so doubling the key length costs the attacker only about eightfold while costing legitimate users too, which is why post-quantum algorithms with different hard problems (lattices, hashes) are the real answer.',
          },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────
  // 2. Quantum Error Correction
  // ─────────────────────────────────────────────────────────────────────
  {
    slug: 'error-correction',

    blocks: [
      {
        kind: 'prose',
        title: 'Three reasons it should be impossible',
        paragraphs: [
          'Classical error correction is conceptually trivial. To protect a bit, send it three times; if one copy flips in transit, majority vote fixes it. Every objection you might raise is an engineering matter of overhead, not a matter of principle. Quantum error correction has to work around three obstacles that look, on first inspection, fatal.',
          'First, no-cloning. There is no unitary that maps |ψ⟩|0⟩ to |ψ⟩|ψ⟩ for arbitrary |ψ⟩ — the proof is two lines from linearity, and it forbids the repetition trick outright. You cannot make three copies of an unknown qubit and vote.',
          'Second, measurement destroys. The classical scheme reads all three copies and compares them. Reading a qubit collapses it. If the data qubit is in the superposition α|0⟩ + β|1⟩, any measurement that learns α and β has already destroyed the state you were trying to protect.',
          'Third, errors are continuous. A classical bit can only fail one way: it flips. A qubit can be rotated by any angle about any axis, so the space of possible errors is a continuum. Even if you could somehow detect an error, correcting a rotation of 0.03 radians about a tilted axis sounds like it would require infinite precision — and you would need to determine that angle without measuring the state.',
          'All three objections have answers, and each answer is a genuine insight rather than a technicality. Redundancy without copying: spread one logical qubit across an entangled state of many physical qubits, so the information is in the correlations and no single qubit holds it. Detection without reading: measure operators that compare qubits to each other and commute with the encoded information, so the answer reveals what went wrong but nothing about α and β. Continuous errors made discrete: measuring the syndrome projects an arbitrary small rotation onto either "no error" or a specific Pauli error, so you only ever need to fix a discrete set.',
        ],
      },
      {
        kind: 'inline-check',
        id: 'c1',
        question:
          'Suppose one logical qubit is spread across the entangled state α|000⟩ + β|111⟩, and a bit flip has hit one of the three qubits — you do not know which. Measuring any qubit directly would collapse the superposition and destroy α and β. What kind of measurement could locate the error anyway?',
        options: [
          { id: 'a', text: 'A weaker, gentler measurement of each qubit that disturbs the state only slightly' },
          { id: 'b', text: 'One that asks only whether PAIRS of qubits agree with each other — never what value any qubit holds' },
          { id: 'c', text: 'None — any measurement that locates the error necessarily reveals the encoded amplitudes' },
          { id: 'd', text: 'Measure all three qubits, take the majority vote, and re-prepare the state from the vote' },
        ],
        correctId: 'b',
        explanation:
          'The question "do qubits 1 and 2 agree?" has the same answer — yes — on both |000⟩ and |111⟩, so measuring it cannot distinguish the logical states and learns nothing about α or β, while a disagreement pins down exactly where a flip landed. Option D destroys the thing it is trying to save: the vote tells you the bit values, but α and β are gone and cannot be re-prepared, because you never knew them. Option A is a real technique (weak measurement) but trades information for disturbance continuously — it cannot locate the error without paying in exactly the damage you were avoiding. The section below builds the pair-comparison version concretely.',
      },
      {
        kind: 'prose',
        title: 'The three-qubit bit-flip code',
        paragraphs: [
          'The encoding is |0⟩_L = |000⟩ and |1⟩_L = |111⟩, so a general state becomes α|000⟩ + β|111⟩. Two CNOTs from the data qubit onto two fresh |0⟩ ancillas produce it. Look carefully at what this is and is not: it is not three copies of α|0⟩ + β|1⟩, which would be the forbidden clone and would expand to eight terms. It is a two-term entangled state in which no individual qubit carries the superposition — each alone shows only the populations |α|² and |β|², never the relative phase. No-cloning is untouched, and yet the redundancy is there.',
          'Now suppose a bit flip hits qubit 1, giving α|100⟩ + β|011⟩. The classical instinct is to measure the three qubits and vote, but measuring collapses the superposition and destroys α and β. The trick is to measure something else: the two-qubit parity operators Z₁Z₂ and Z₂Z₃.',
          'Z₁Z₂ answers the question "do qubits 1 and 2 agree?" — and crucially, it answers only that question. On both |000⟩ and |111⟩ it returns +1, so it cannot distinguish the two logical states and therefore learns nothing about α or β. It commutes with the encoded information. On the corrupted state above, the first two qubits disagree, so Z₁Z₂ returns −1, while Z₂Z₃ returns +1 because qubits 2 and 3 still agree. That pair of signs, (−1, +1), is the syndrome, and it points uniquely at qubit 1.',
          'The four possible syndromes map to the four cases: (+1,+1) means no error, (−1,+1) means qubit 1, (−1,−1) means qubit 2, (+1,−1) means qubit 3. Apply X to whichever qubit the syndrome names and the state is exactly restored — with α and β intact and never having been observed. The code corrects any single bit flip. Two simultaneous flips defeat it, exactly as with the classical repetition code, and it does nothing at all about phase errors, which is the more serious gap.',
        ],
      },
      {
        kind: 'callout',
        tone: 'insight',
        title: 'Continuous errors become discrete for free',
        body: 'Suppose the error is not a clean flip but a small rotation, X(ε) = cos ε · I + i sin ε · X. Then the state after the error is a superposition of "no error" and "bit flip". Measuring the syndrome projects that superposition: with probability cos²ε you get the trivial syndrome and the state snaps back to uncorrupted, and with probability sin²ε you get the bit-flip syndrome and correct a full X. Either way the residual error is exactly zero — you never had to know ε. This digitisation is why quantum error correction is possible at all, and why it suffices to handle the discrete Pauli set {I, X, Y, Z}: any single-qubit error whatsoever is a linear combination of those four, and the syndrome measurement collapses the combination onto one of them.',
      },
      {
        kind: 'inline-check',
        id: 'c2',
        question:
          'A phase flip Z sends α|0⟩ + β|1⟩ to α|0⟩ − β|1⟩ — it changes no computational-basis probability, but it wrecks interference. Predict: a Z error hits one qubit of the encoded state α|000⟩ + β|111⟩. What do the bit-flip code\'s parity checks Z₁Z₂ and Z₂Z₃ report?',
        options: [
          { id: 'a', text: 'The syndrome names the hit qubit, as it does for a bit flip' },
          { id: 'b', text: '(+1, +1) — "no error". The corrupted state α|000⟩ − β|111⟩ passes every check while the logical content is damaged' },
          { id: 'c', text: 'The syndrome is ambiguous between two qubits' },
          { id: 'd', text: 'The parity measurements themselves fail, since Z errors make the state unmeasurable' },
        ],
        correctId: 'b',
        explanation:
          'A Z on any one qubit turns α|000⟩ + β|111⟩ into α|000⟩ − β|111⟩ — still a superposition of |000⟩ and |111⟩, so both parity checks return +1 and the code waves it through as healthy. Yet the encoded qubit has suffered a full logical phase flip. The bit-flip code is completely blind to the error that matters most on real hardware, where dephasing (T₂) usually outruns relaxation (T₁). The fix, in the section below, is a change of basis: a phase flip in one basis is a bit flip in another, and Shor\'s nine-qubit code layers the two protections.',
      },
      {
        kind: 'prose',
        title: 'Phase flips, and Shor\'s nine-qubit code',
        paragraphs: [
          'A phase flip Z leaves |0⟩ alone and sends |1⟩ to −|1⟩. In the computational basis it is invisible — it changes no measurement probability — but it is every bit as destructive as a bit flip, because it wrecks the relative phase that all interference depends on. On real hardware, phase errors are typically the more common failure: T₂ (dephasing time) is usually shorter than T₁ (relaxation time), sometimes by a lot.',
          'The fix is a change of basis. In the Hadamard basis, |+⟩ = (|0⟩+|1⟩)/√2 and |−⟩ = (|0⟩−|1⟩)/√2, a Z error swaps |+⟩ and |−⟩ — that is, a phase flip in one basis is a bit flip in the other. So the three-qubit repetition code with |0⟩_L = |+++⟩ and |1⟩_L = |−−−⟩, whose syndrome operators are X₁X₂ and X₂X₃, corrects single phase flips by exactly the same argument. Bit-flip and phase-flip protection are the same construction viewed from two bases.',
          'Shor\'s nine-qubit code, the first full quantum error-correcting code (1995), simply concatenates the two. Take a phase-flip code across three blocks, then protect each of those three qubits with a three-qubit bit-flip code. Nine physical qubits, eight stabilizer measurements, one logical qubit. It corrects an arbitrary single-qubit error: any X, any Z, any Y (which is both at once, up to a phase), and by the digitisation argument any continuous rotation as well.',
          'This was the result that changed the field\'s prospects. Before it, the standard objection to quantum computing was that decoherence made large computations impossible in principle — you cannot protect a continuous parameter against continuous noise, the argument went. Shor\'s code, followed within months by Steane\'s seven-qubit code and then the general stabilizer formalism of Calderbank, Shor and Gottesman, showed the objection was simply wrong. The problem became quantitative — how much overhead, how low must the error rate be — rather than a matter of principle.',
        ],
      },
      {
        kind: 'code',
        language: 'python',
        code: `"""Three-qubit bit-flip code: encode, corrupt, diagnose, correct."""
import numpy as np

I = np.eye(2, dtype=complex)
X = np.array([[0, 1], [1, 0]], dtype=complex)
Z = np.array([[1, 0], [0, -1]], dtype=complex)


def kron(*ops):
    out = np.array([[1]], dtype=complex)
    for op in ops:
        out = np.kron(out, op)
    return out


def encode(alpha: complex, beta: complex) -> np.ndarray:
    """|psi> -> alpha|000> + beta|111>.  NOT three copies — an entangled state."""
    state = np.zeros(8, dtype=complex)
    state[0b000] = alpha
    state[0b111] = beta
    return state


def syndrome(state: np.ndarray) -> tuple[int, int]:
    """Expectation of Z1Z2 and Z2Z3 — reveals the error, not the data."""
    s12 = np.real(state.conj() @ kron(Z, Z, I) @ state)
    s23 = np.real(state.conj() @ kron(I, Z, Z) @ state)
    return int(round(s12)), int(round(s23))


CORRECTION = {
    (1, 1): None,                 # no error
    (-1, 1): kron(X, I, I),       # qubit 0 flipped
    (-1, -1): kron(I, X, I),      # qubit 1 flipped
    (1, -1): kron(I, I, X),       # qubit 2 flipped
}

alpha, beta = 0.6, 0.8
clean = encode(alpha, beta)

corrupted = kron(I, X, I) @ clean          # flip the middle qubit
print(syndrome(clean))                      # (1, 1)   — nothing wrong
print(syndrome(corrupted))                  # (-1, -1) — points at qubit 1

fix = CORRECTION[syndrome(corrupted)]
recovered = corrupted if fix is None else fix @ corrupted
print(np.allclose(recovered, clean))        # True — alpha, beta never observed

# Continuous errors digitise. A tiny rotation is a superposition of
# "no error" and "bit flip"; the syndrome measurement collapses it.
eps = 0.03
small = (np.cos(eps) * kron(I, I, I) + 1j * np.sin(eps) * kron(I, X, I)) @ clean
p_flip = np.abs(np.vdot(kron(I, X, I) @ clean, small)) ** 2
print(round(p_flip, 5))                     # sin^2(eps) — else it snaps back clean`,
        caption:
          'The syndrome names the faulty qubit without ever touching α or β. Z₁Z₂ returns +1 on both |000⟩ and |111⟩, so it cannot tell the logical states apart — which is exactly why it is safe to measure.',
      },
      // The right visualization for this lesson does not exist: a distance-3 or
      // distance-5 surface-code patch where you click qubits to inject X and Z
      // errors, watch the stabilizer plaquettes light up, and see the decoder
      // pair up defects — with a slider for the physical error rate p that
      // shows logical error falling with d below ~1% and rising above it, which
      // is the threshold made visible. `/visualizations/decoherence` is the
      // closest thing shipped, and it teaches the *problem* (T₁ vs T₂) rather
      // than the code. Do not quietly upgrade this blurb to imply otherwise.
      {
        kind: 'embed',
        href: '/visualizations/decoherence',
        title: 'Decoherence',
        blurb:
          'Watch a Bloch vector shrink toward the centre of the sphere as the environment scrambles its phase, and compare T₁ relaxation with T₂ dephasing. Dephasing is usually the faster of the two, which is why phase errors — invisible in the computational basis — are the ones error correction has to work hardest against.',
      },
      {
        kind: 'inline-check',
        id: 'c3',
        question:
          'A bigger code corrects more errors, but its extra qubits are themselves error-prone. Predict: your hardware\'s physical error rate p sits just ABOVE the code\'s threshold, and you scale the code distance d up anyway. What happens to the logical error rate?',
        options: [
          { id: 'a', text: 'It falls exponentially in d — more redundancy always helps' },
          { id: 'b', text: 'It stays roughly constant: the extra correction and the extra noise cancel' },
          { id: 'c', text: 'It gets WORSE as d grows: each added qubit brings in more error than the larger code removes' },
          { id: 'd', text: 'It falls, but only linearly in d' },
        ],
        correctId: 'c',
        explanation:
          'This is the two-sided content of the threshold theorem, and the side people forget. Every qubit you add is another place for errors to enter; the code only wins if it removes error faster than the new hardware injects it, and the break-even point is the threshold. Below it, growing d suppresses logical error exponentially. Above it, the same scaling runs in reverse and bigger codes are strictly worse. That is why "we added more qubits" means nothing without an error rate attached — and why Google\'s demonstration that a distance-7 patch beats distance-5 mattered so much: it was direct evidence of being on the right side of the line. The section below makes the budget quantitative.',
      },
      {
        kind: 'prose',
        title: 'The surface code, the threshold, and the overhead',
        paragraphs: [
          'The code that essentially every serious hardware roadmap now targets is the surface code. Qubits sit on a two-dimensional lattice; half of them hold data and half are ancillas that repeatedly measure four-body stabilizers — Z-type plaquettes on one sublattice, X-type on the other. Its decisive practical virtue is locality: every stabilizer involves only nearest neighbours, which suits chips where qubits can talk to their neighbours and nobody else. Codes with better rates exist, and low-density parity-check codes are an active and promising area, but most of them demand long-range connectivity that superconducting hardware does not have.',
          'A surface code patch of distance d uses roughly 2d² physical qubits (d² data, d²−1 ancilla) and corrects any error pattern of weight less than d/2. The logical error rate falls exponentially in d, provided the physical error rate p is below a critical value — the threshold, around 1% for the surface code under realistic circuit-level noise models. Above threshold, adding qubits makes things worse, because each new qubit brings more error than the code removes. Below threshold, each two-step increase in d suppresses logical errors by another factor of roughly p/p_th.',
          'That is the threshold theorem, and it is the reason the field believes large-scale quantum computing is possible at all: arbitrarily long computations can be run with arbitrarily low error, at a cost only polylogarithmic in the length of the computation, so long as physical error rates stay below a constant. It converts an impossibility argument into a budget.',
          'The budget is nonetheless brutal. To get a logical error rate of 10⁻¹⁵ — what a long algorithm needs — from physical qubits at p = 10⁻³, you need distance around 25 to 30, so roughly 1,000 to 2,000 physical qubits per logical qubit, before counting the magic-state factories that supply the T gates. Google\'s 2023 result was a first, modest step: a distance-5 patch performed marginally better than distance-3 (a suppression factor Λ ≈ 1.04 — barely above one). The 2024 Willow result was the decisive one: exponential suppression across d = 3, 5 and 7, with Λ ≈ 2.14 per two-step increase in distance, and the distance-7 logical qubit beating its best constituent physical qubit — below threshold, on real hardware, with the scaling in the right direction. It was significant precisely because it demonstrated exponential suppression empirically for the first time — the necessary first step, and only the first.',
          'Hence the two vocabularies you must keep separate. A physical qubit is a piece of hardware: a transmon, a trapped ion, a spin. A logical qubit is an encoded, actively corrected abstraction built from many of them, with an error rate low enough to compute with. When a press release says "1,000 qubits", it means physical. When an algorithm paper says "4,000 qubits", it means logical. The conversion factor between them is currently three orders of magnitude, and closing that gap is the central engineering problem of the field.',
        ],
      },
      {
        kind: 'keypoints',
        points: [
          'No-cloning forbids copying, but a logical qubit can be spread across an entangled state where no single qubit holds the information.',
          'Syndrome measurements measure parity operators that commute with the encoded data, so they reveal the error without revealing α or β.',
          'Measuring the syndrome digitises continuous errors: an arbitrary rotation collapses to "no error" or a specific Pauli.',
          'A phase flip is a bit flip in the Hadamard basis; Shor\'s nine-qubit code concatenates the two repetition codes to fix any single-qubit error.',
          'The surface code needs only nearest-neighbour stabilizers and suppresses logical error exponentially in the code distance d, using roughly 2d² physical qubits (d² data, d²−1 ancilla).',
          'The threshold theorem: below a physical error rate near 1%, arbitrarily long computation is possible — at roughly 1,000+ physical qubits per logical qubit today.',
        ],
      },
      {
        kind: 'quiz',
        questions: [
          {
            id: 'q1',
            prompt: 'The three-qubit code encodes α|0⟩+β|1⟩ as α|000⟩+β|111⟩. Why does this not violate the no-cloning theorem?',
            options: [
              { id: 'a', text: 'It does violate it, but only approximately, and the error is negligible' },
              { id: 'b', text: 'No-cloning applies only to entangled states, and this state is a product state' },
              { id: 'c', text: 'The encoded state is a single entangled state, not three copies — no qubit individually carries α and β' },
              { id: 'd', text: 'The ancillas are measured immediately, which resets the cloning restriction' },
            ],
            correctId: 'c',
            explanation:
              'A genuine clone would be (α|0⟩+β|1⟩)^⊗3, which expands to eight terms including α²β|001⟩ and the rest. The encoded state has exactly two terms, and no individual qubit carries the superposition — each alone, traced out, is |α|²|0⟩⟨0| + |β|²|1⟩⟨1|: it shows only the populations, never the relative phase. The phase lives entirely in the correlations. That is the whole trick: redundancy in the correlations rather than redundancy in copies. Note what it does not buy you, though: losing a qubit outright (an erasure) is not a bit flip — it includes an unknown Z error, which this code cannot detect — so recovering from a lost qubit needs a code that also handles phase errors, such as the 5- or 7-qubit codes.',
          },
          {
            id: 'q2',
            prompt: 'Why is measuring Z₁Z₂ safe when measuring Z₁ alone would destroy the encoded state?',
            options: [
              { id: 'a', text: 'Two-qubit measurements are inherently weaker and disturb the state less' },
              { id: 'b', text: 'Z₁Z₂ returns +1 on both |000⟩ and |111⟩, so it cannot distinguish the logical states and learns nothing about α or β' },
              { id: 'c', text: 'Z₁Z₂ is measured on the ancillas rather than the data qubits' },
              { id: 'd', text: 'The measurement is undone immediately afterwards by applying Z₁Z₂ again' },
            ],
            correctId: 'b',
            explanation:
              'The operator asks a strictly narrower question: "do these two qubits agree?" Both logical basis states answer +1, so the measurement commutes with the logical information and its outcome is statistically independent of α and β. The projection it performs acts only on the error subspace. This is the defining property of a stabilizer: an operator that fixes the whole code space pointwise, so measuring it collapses errors without collapsing data. Every code in the stabilizer family — Steane, Shor, surface — is built by choosing a set of such operators.',
          },
          {
            id: 'q3',
            prompt: 'What does the threshold theorem actually promise?',
            options: [
              { id: 'a', text: 'That errors vanish entirely once enough qubits are used' },
              { id: 'b', text: 'That there is a maximum number of qubits above which error correction stops working' },
              { id: 'c', text: 'That if the physical error rate is below a constant threshold, logical error can be suppressed to any target with only polylogarithmic overhead' },
              { id: 'd', text: 'That quantum computers must run below a threshold temperature to function' },
            ],
            correctId: 'c',
            explanation:
              'Below threshold — around 1% for the surface code under circuit-level noise — increasing the code distance suppresses the logical error rate exponentially, so any desired reliability is reachable at a cost that grows only polylogarithmically in the length of the computation. Above threshold the scaling inverts and more qubits make things worse, because each addition injects more error than the code removes. The theorem converts an in-principle impossibility argument into an engineering budget, and today that budget is roughly a thousand physical qubits per logical one.',
          },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────
  // 3. NISQ Algorithms and VQE
  // ─────────────────────────────────────────────────────────────────────
  {
    slug: 'vqe-and-nisq',

    blocks: [
      {
        kind: 'prose',
        title: 'NISQ: what the acronym is actually claiming',
        paragraphs: [
          'John Preskill coined "NISQ" in 2018 — Noisy Intermediate-Scale Quantum — to name the era we are in and, just as importantly, to set expectations about it. Intermediate-scale means roughly 50 to a few hundred qubits: past the point where a laptop can simulate the state vector, short of the millions error correction demands. Noisy means no error correction, so errors accumulate through the circuit unchecked.',
          'The second word is the one that binds. With gate error rates around 10⁻³ for two-qubit gates on good hardware, a circuit of depth D on a handful of qubits accumulates total error roughly D × (number of gates per layer) × 10⁻³. Once that product approaches 1, the output is noise. In practice that caps useful circuits at hundreds of two-qubit gates, and it is a hard cap: no amount of clever compilation gets you past it, because the limit is physical.',
          'Note what this does to the algorithms in the rest of this track. Shor\'s algorithm on a cryptographically interesting number needs circuit depth in the billions. Grover\'s needs √N sequential iterations, each containing an oracle circuit, so any instance large enough to be interesting needs depth far beyond NISQ reach — and worse, Grover\'s speed-up is quadratic, so noise-induced slowdown eats it easily. Neither is a NISQ algorithm, not by a factor of a thousand. Depth, not qubit count, is the wall.',
          'So the NISQ question is: what can you compute with a wide but very shallow circuit? The dominant answer has been the variational family — VQE for chemistry and materials, QAOA for combinatorial optimisation, and quantum machine-learning variants. The shared idea is to make the quantum circuit as shallow as possible and hand everything else to a classical computer, running the two in a loop. It is a genuinely reasonable response to the constraint. Whether it delivers a practical advantage is still, honestly, unresolved.',
        ],
      },
      {
        kind: 'inline-check',
        id: 'c1',
        question:
          'A Hamiltonian H has ground-state energy E₀. You prepare some normalised trial state |ψ⟩ that is NOT a ground state, and you evaluate ⟨ψ|H|ψ⟩ exactly. What do you know about the number you get?',
        options: [
          { id: 'a', text: 'It is strictly greater than E₀ — every trial state gives a rigorous upper bound' },
          { id: 'b', text: 'It can land below E₀ if |ψ⟩ is entangled in the right way' },
          { id: 'c', text: 'It equals the unweighted average of all of H\'s eigenvalues' },
          { id: 'd', text: 'Nothing, without first diagonalising H' },
        ],
        correctId: 'a',
        explanation:
          'Expand |ψ⟩ in H\'s eigenbasis: ⟨ψ|H|ψ⟩ is a probability-weighted average of eigenvalues, and no average of numbers can fall below their minimum — with equality only when all the weight sits on the ground space, which "not a ground state" rules out. No state, however entangled, escapes this; option B has the logic backwards, since the bound is what makes the whole method trustworthy. This one undergraduate theorem is the entire foundation of VQE: any circuit\'s energy is a certificate, and lower is provably better. The section below builds the algorithm on it.',
      },
      {
        kind: 'prose',
        title: 'The variational principle, which does all the work',
        paragraphs: [
          'VQE rests on one theorem from undergraduate quantum mechanics. For any Hamiltonian H with ground-state energy E₀, and any normalised state |ψ⟩ whatsoever, ⟨ψ|H|ψ⟩ ≥ E₀. Expand |ψ⟩ in the energy eigenbasis and the proof is immediate: the expectation is a probability-weighted average of eigenvalues, and no average can fall below the minimum.',
          'The consequence is that the expectation value is a certificate. Any trial state gives you an upper bound on the ground-state energy, with equality exactly when the trial state is the ground state. So the search for a ground state becomes a minimisation: sweep over a family of trial states, and the lowest energy you find is your best estimate and a rigorous bound.',
          'Classical quantum chemistry has used this for a century — Hartree-Fock, configuration interaction and coupled cluster are all variational or nearly so. The difficulty is always the same: the space of states is exponentially large, and any classically parameterisable family of trial states is an exponentially small corner of it. Strongly correlated systems — transition-metal catalysts, high-temperature superconductors, the FeMo cofactor of nitrogenase — are precisely those where the true ground state sits outside every tractable classical family.',
          'The quantum pitch is that a parameterised quantum circuit prepares trial states no classical ansatz can efficiently represent, because the circuit itself lives in the exponentially large space. You still search over a small number of parameters — tens or hundreds — but the states those parameters reach are entangled in ways a classical wavefunction ansatz cannot compactly write down. That is the hoped-for advantage. It has not yet been demonstrated at a scale where a classical method could not keep up, and tensor-network and quantum Monte Carlo methods have repeatedly caught up with claimed demonstrations.',
        ],
      },
      {
        kind: 'prose',
        title: 'The ansatz, the loop, and the measurement problem',
        paragraphs: [
          'The trial states come from an ansatz: a fixed circuit shape with tunable rotation angles. A hardware-efficient ansatz alternates layers of single-qubit rotations RY(θ) and RZ(φ) with a fixed pattern of entangling gates chosen to match the chip\'s connectivity — cheap to run, physically motivated by nothing in particular. A chemistry-motivated ansatz such as UCCSD (unitary coupled cluster with singles and doubles) derives its structure from the physics of electron excitations, which makes it far more likely to contain the true ground state and far more expensive to run. This trade-off — expressiveness against depth, physics against hardware constraints — is the central design decision in VQE, and it has no universally right answer.',
          'The loop is straightforward. A classical optimiser proposes parameters θ. The quantum device prepares |ψ(θ)⟩ and measures, over many shots, an estimate of ⟨ψ(θ)|H|ψ(θ)⟩. The optimiser takes that number, updates θ, and repeats until convergence. The quantum computer is a subroutine that evaluates one scalar function; the intelligence about where to search next is entirely classical. Because each circuit run is short — one ansatz preparation and one measurement — the depth stays within NISQ budget even though the total number of runs is enormous.',
          'Measuring the energy is subtler than it looks, and it is where the practical cost hides. You cannot measure a Hamiltonian directly; you can only measure qubits in some basis. So H is decomposed into a weighted sum of Pauli strings, H = Σ_i c_i P_i, where each P_i is a tensor product like Z₀Z₁ or X₀Y₂Z₃. Each Pauli string is measurable: rotate the relevant qubits into the right basis (an H gate before measurement turns a Z-measurement into an X-measurement, and applying S† and then H (the operator H·S†) does the same for Y), measure, and average the ±1 outcomes. Linearity then gives ⟨H⟩ = Σ_i c_i ⟨P_i⟩.',
          'The catch is the number of terms. A molecular Hamiltonian on M spin-orbitals has O(M⁴) Pauli strings, so a modest molecule generates thousands to millions of them, and each one needs enough shots for its own statistical error to be small. Chemical accuracy — 1.6 millihartree, the precision at which reaction rates become predictive — demands shot counts that, for interesting molecules, run into the billions and translate to days or weeks of device time. Grouping commuting Pauli strings into simultaneously measurable sets, and shot-allocation schemes that spend more shots on high-weight terms, cut this substantially but do not change the asymptotics. Measurement cost, not gate count, is often the binding constraint in a real VQE experiment.',
        ],
      },
      {
        kind: 'callout',
        tone: 'warning',
        title: 'Noise does not merely add error to VQE — it moves the answer',
        body: 'It is tempting to think the variational bound protects you: whatever the noise does, ⟨H⟩ ≥ E₀, so you still get a valid upper bound. That is wrong, and the reason matters. On a noisy device the prepared state is not a pure |ψ(θ)⟩ but a mixed state ρ(θ), and Tr(ρH) is still ≥ E₀ — but you never measure Tr(ρH) exactly either. Readout error, in particular, biases the estimator, and a biased estimator can report an energy *below* E₀, which is physically nonsense and destroys the certificate. Error-mitigation techniques (zero-noise extrapolation, probabilistic error cancellation, readout calibration matrices) address this, but they cost extra circuit runs — often an exponential number as the noise grows — and they are mitigation, not correction. The variational bound is only as trustworthy as your estimator.',
      },
      {
        kind: 'code',
        language: 'python',
        code: `"""VQE on H2 in a minimal basis: two qubits, five Pauli terms.

The Hamiltonian coefficients below are the standard STO-3G H2 values at
bond length 0.735 A after the parity mapping with two-qubit (Z2-symmetry) reduction.
"""
import numpy as np
from scipy.optimize import minimize

I = np.eye(2, dtype=complex)
X = np.array([[0, 1], [1, 0]], dtype=complex)
Z = np.array([[1, 0], [0, -1]], dtype=complex)


def pauli(a, b):
    return np.kron(a, b)


# H = sum_i c_i P_i  — the decomposition the device actually measures.
TERMS = [
    (-1.0523, pauli(I, I)),
    (+0.3979, pauli(I, Z)),
    (-0.3979, pauli(Z, I)),
    (-0.0113, pauli(Z, Z)),
    (+0.1809, pauli(X, X)),
]
H = sum(c * P for c, P in TERMS)


def ansatz(theta: float) -> np.ndarray:
    """One-parameter ansatz: |01> rotated toward |10> by angle theta."""
    state = np.zeros(4, dtype=complex)
    state[0b01] = np.cos(theta / 2)
    state[0b10] = np.sin(theta / 2)
    return state


def energy(params: np.ndarray) -> float:
    """What the loop evaluates. On hardware this is many thousands of shots."""
    psi = ansatz(float(params[0]))
    return float(np.real(psi.conj() @ H @ psi))


result = minimize(energy, x0=np.array([0.0]), method="COBYLA")
exact = float(np.min(np.linalg.eigvalsh(H)))

print(f"VQE:   {result.fun:.6f} Ha")     # -1.857102 Ha (electronic energy; add ~0.72 Ha nuclear repulsion for the familiar -1.137 Ha total)
print(f"exact: {exact:.6f} Ha")          # -1.857102 Ha
print(f"gap:   {result.fun - exact:.2e}")  # ~1e-9, well inside chemical accuracy

# Per-term expectation values — one measurement setting each on hardware.
psi = ansatz(float(result.x[0]))
for c, P in TERMS:
    print(f"  c={c:+.4f}  <P>={np.real(psi.conj() @ P @ psi):+.4f}")`,
        caption:
          'Five Pauli strings, one parameter, exact agreement. A real molecule has O(M⁴) terms and dozens of parameters, and the shot budget rather than the gate count is what stops you.',
      },
      {
        kind: 'embed',
        href: '/simulator',
        title: 'Circuit Simulator',
        blurb:
          'Build a two-qubit ansatz — RY rotations, a CNOT, more rotations — and sweep the angles by hand while watching the state vector move. Doing the optimisation manually for two parameters gives you a visceral sense of the landscape a classical optimiser has to navigate, and of how quickly that intuition fails as you add layers.',
      },
      {
        kind: 'inline-check',
        id: 'c2',
        question:
          'You scale a generic, expressive hardware-efficient ansatz from 10 qubits to 40, changing nothing else. Predict what happens to the cost-function gradients your shot-based estimator has to resolve.',
        options: [
          { id: 'a', text: 'They grow — more parameters means more directions of steepest descent' },
          { id: 'b', text: 'They stay about the same size; only the location of the minimum moves' },
          { id: 'c', text: 'Their typical size shrinks exponentially in the qubit count, so the landscape is flat almost everywhere and finite shots read pure noise' },
          { id: 'd', text: 'They become impossible to define, because gradients do not exist for quantum circuits' },
        ],
        correctId: 'c',
        explanation:
          'For sufficiently expressive random circuits the gradient of the cost has mean zero and variance decaying exponentially in the number of qubits — resolving a 2⁻ⁿ-sized gradient from shot noise costs on the order of 4ⁿ measurements, hopeless past a few dozen qubits. This is not a hardware defect and not a local minimum; it is a property of the geometry of the state space. Option D is wrong on a technicality worth knowing: the parameter-shift rule gives exact gradients — they exist, they are just exponentially small. The section below is about this result and the uncomfortable escape routes from it.',
      },
      {
        kind: 'prose',
        title: 'Barren plateaus: the central open problem',
        paragraphs: [
          'Here is the result that reframed the whole variational programme. McClean and collaborators showed in 2018 that for a sufficiently expressive random parameterised circuit, the gradient of the cost function with respect to any parameter has mean zero and a variance that decays exponentially in the number of qubits. The optimisation landscape is, with overwhelming probability, flat almost everywhere — a vast plateau with the minimum hidden in a narrow crevice you will never stumble into.',
          'The consequence for practice is severe. To estimate a gradient of size 2^{-n} you need on the order of 4^n shots to distinguish it from statistical noise. Beyond thirty or so qubits with a generic ansatz, the optimiser is quite literally reading noise, and it will wander at random and report a converged-looking answer that means nothing. This is not a hardware problem that better qubits will fix; it is a property of the geometry of the state space, related to the fact that random circuits approximate unitary 2-designs and concentrate measure.',
          'It gets worse before it gets better. Noise induces its own barren plateaus — as the device degrades the state toward the maximally mixed state, gradients flatten independently of the ansatz. And cost functions defined by global observables (anything measuring all qubits at once) have barren plateaus even at shallow depth, whereas local cost functions built from few-qubit observables can avoid them for logarithmic depth.',
          'That last observation is where the escape routes begin. Local cost functions, shallow problem-inspired ansätze, structured initialisation strategies such as identity-block or layerwise training, and symmetry-preserving ansätze that restrict the circuit to a physically relevant subspace all provably or empirically mitigate the effect. But there is an uncomfortable tension underneath: several results suggest that circuits structured enough to avoid barren plateaus are often structured enough to be classically simulable. If the only trainable circuits are the ones a classical computer can also evaluate, the variational advantage evaporates. Nobody has proved that dichotomy in general, and finding a family that is both trainable and classically hard is arguably the single most important open question in near-term quantum computing.',
          'The honest summary of the NISQ era, then: it produced real physics, real hardware progress, and a research community that now understands the constraints far better than it did in 2018. It has not yet produced a demonstrated practical quantum advantage on a useful problem. Most serious groups have shifted their timelines toward early fault-tolerance — a few hundred logical qubits — rather than betting on NISQ-era variational methods to cross the line on their own.',
        ],
      },
      {
        kind: 'keypoints',
        points: [
          'NISQ means 50 to a few thousand noisy qubits with no error correction; accumulated gate error caps useful circuits at hundreds of two-qubit gates.',
          'Depth, not qubit count, is the binding constraint — Shor and Grover are far outside NISQ reach.',
          'The variational principle guarantees ⟨ψ|H|ψ⟩ ≥ E₀, turning ground-state search into parameter optimisation with a built-in certificate.',
          'A parameterised ansatz runs on the device; a classical optimiser chooses the next parameters, keeping each circuit shallow.',
          'Energies are measured by decomposing H into Pauli strings; O(M⁴) terms and chemical accuracy make shot count the real cost.',
          'Barren plateaus flatten gradients exponentially in qubit number, and circuits structured enough to avoid them are often classically simulable — the central open problem.',
        ],
      },
      {
        kind: 'quiz',
        questions: [
          {
            id: 'q1',
            prompt: 'Why is circuit depth, rather than qubit count, the binding constraint in the NISQ era?',
            options: [
              { id: 'a', text: 'Deeper circuits need more qubits, and qubits are the scarce resource' },
              { id: 'b', text: 'Without error correction, gate errors accumulate through the circuit until the output is indistinguishable from noise' },
              { id: 'c', text: 'Quantum computers execute gates sequentially, so depth determines the wall-clock runtime' },
              { id: 'd', text: 'Compilers cannot optimise circuits beyond a certain depth' },
            ],
            correctId: 'b',
            explanation:
              'Each two-qubit gate carries roughly 10⁻³ error and nothing removes it, so error compounds along the circuit. Once the accumulated error approaches 1 the final state has decohered and the measured distribution carries no signal. This is why adding qubits without lowering error rates buys very little: you can go wider, but not deeper, and every interesting algorithm needs depth. Option C is true but not the limit — runtime is measured in microseconds, while decoherence is what actually stops you.',
          },
          {
            id: 'q2',
            prompt: 'Why must a Hamiltonian be decomposed into Pauli strings before VQE can evaluate its energy?',
            options: [
              { id: 'a', text: 'Because Pauli matrices are the only unitary operators available on hardware' },
              { id: 'b', text: 'Because a quantum device can only measure qubits in a basis, so ⟨H⟩ must be built from measurable ±1 observables and combined by linearity' },
              { id: 'c', text: 'Because the decomposition compresses the Hamiltonian into fewer terms' },
              { id: 'd', text: 'Because Pauli strings commute, so they can all be measured at once' },
            ],
            correctId: 'b',
            explanation:
              'There is no "measure H" instruction. You can measure each qubit in the Z basis, and with a rotation beforehand in the X or Y basis, which is exactly what measuring a Pauli string amounts to. Averaging the ±1 outcomes gives ⟨P_i⟩, and linearity assembles ⟨H⟩ = Σ c_i⟨P_i⟩. Option C inverts the truth — the decomposition expands rather than compresses, into O(M⁴) terms for a molecule with M spin-orbitals. Option D is false in general: Pauli strings mostly do not commute, though grouping the ones that do into shared measurement settings is a standard and valuable optimisation.',
          },
          {
            id: 'q3',
            prompt: 'A barren plateau in a variational circuit means that:',
            options: [
              { id: 'a', text: 'The optimiser has found a local minimum it cannot escape' },
              { id: 'b', text: 'The circuit is too shallow to represent the ground state' },
              { id: 'c', text: 'Cost-function gradients have mean zero and variance decaying exponentially in qubit number, so the landscape is flat and training needs exponentially many shots' },
              { id: 'd', text: 'Hardware noise has driven the measured energy below the true ground-state energy' },
            ],
            correctId: 'c',
            explanation:
              'A barren plateau is a statement about the geometry of the landscape, not about a particular run getting stuck. For sufficiently expressive random circuits the gradient concentrates exponentially around zero, so resolving it from shot noise costs O(4ⁿ) measurements and the optimiser is effectively reading noise past about thirty qubits. Mitigations exist — local cost functions, shallow problem-inspired ansätze, layerwise or identity-block initialisation — but the uncomfortable pattern is that circuits structured enough to be trainable are frequently structured enough to simulate classically, which is why this is the field\'s central open question rather than a solved engineering detail.',
          },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────
  // 4. Quantum Cryptography
  // ─────────────────────────────────────────────────────────────────────
  {
    slug: 'quantum-cryptography',

    blocks: [
      {
        kind: 'prose',
        title: 'BB84, step by step',
        paragraphs: [
          'Bennett and Brassard published BB84 in 1984, and it remains the cleanest illustration of what quantum mechanics buys you in cryptography. The goal is narrow and worth stating precisely: Alice and Bob want to end up holding the same random bit string, with a guarantee that no third party knows it. Not to send a message — to establish a shared secret key, which they will then use with ordinary classical encryption.',
          'Step one. For each bit, Alice picks two random choices: a bit value (0 or 1) and a basis (rectilinear, {|0⟩, |1⟩}, or diagonal, {|+⟩, |−⟩}). She encodes accordingly — bit 0 in the rectilinear basis is |0⟩, bit 1 in the diagonal basis is |−⟩, and so on — and sends the photon to Bob.',
          'Step two. Bob, who has no idea which basis Alice used, picks a basis at random for each arriving photon and measures. When his basis matches Alice\'s, he gets her bit with certainty. When it does not, he gets a uniformly random result, because |0⟩ measured in the diagonal basis is a fair coin. So about half his measurements are correct and half are noise, and he cannot tell which are which.',
          'Step three, basis reconciliation. Over a public, authenticated but not secret channel, Alice and Bob announce which basis they used for each photon — never the bit values. They discard every position where the bases differed, roughly half of them. What remains is the sifted key, and in a noiseless world with no eavesdropper it is identical on both sides.',
          'Step four, the check. They sacrifice a random subset of the sifted key by publicly comparing the actual bits. If those agree, the rest of the key is sound; the compared bits, now public, are discarded from the key material. If they disagree at more than a small rate, something interfered, and they throw the whole thing away and start over. That subset comparison is where the security lives.',
        ],
      },
      {
        kind: 'inline-check',
        id: 'c1',
        question:
          'Eve intercepts every photon, measures it in a basis she picks at random, and forwards a fresh photon in whatever state she found. Work it out before reading on: what error rate does she leave in Alice and Bob\'s sifted key?',
        options: [
          { id: 'a', text: '0% — she forwards a photon every time, so nothing is missing and nothing is disturbed' },
          { id: 'b', text: '12.5% — errors appear in one-eighth of the kept bits' },
          { id: 'c', text: '25% — she guesses the wrong basis half the time, and each wrong guess corrupts half of the retained bits' },
          { id: 'd', text: '50% — the sifted key becomes pure noise' },
        ],
        correctId: 'c',
        explanation:
          'No-cloning forces Eve to measure rather than copy, and measuring means committing to a basis without knowing Alice\'s. Half the time she guesses right and leaves no trace. Half the time she guesses wrong: her measurement collapses the photon into the other basis, and when Bob later measures in Alice\'s basis — the only positions that survive sifting — he gets a coin flip and disagrees with Alice half of those times. One half times one half is 25%, and it is set by the physics of measurement, not by the quality of Eve\'s equipment: there is no quieter version of this attack. The section below turns the same arithmetic into a security guarantee.',
      },
      {
        kind: 'prose',
        title: 'Why listening is detectable rather than preventable',
        paragraphs: [
          'Suppose Eve intercepts each photon, measures it, and forwards a fresh photon prepared in whatever state she found — the intercept-resend attack. Note first what physics has already denied her: no-cloning means she cannot keep a copy and forward the original untouched, so she has to measure, and measuring means choosing a basis without knowing Alice\'s.',
          'Half the time she guesses right and forwards exactly the state Alice sent, leaving no trace. Half the time she guesses wrong: she measures |0⟩ in the diagonal basis, gets |+⟩ or |−⟩ at random, and forwards that. Now when Bob happens to use Alice\'s basis — the case they will keep — he no longer gets Alice\'s bit with certainty. He gets a coin flip, so he disagrees with Alice half of those times.',
          'Multiply it out: Eve chooses the wrong basis half the time, and in those cases she induces an error in half of the retained bits. So intercept-resend introduces a 25% error rate into the sifted key. Alice and Bob compare a few hundred sacrificed bits and see a quarter of them disagree, which is unmistakable. There is no way for Eve to be quieter while still learning anything: any measurement that extracts information about a non-orthogonal state necessarily disturbs it, and the information-disturbance trade-off makes that quantitative — more information for Eve means strictly more error for Bob, with no loophole.',
          'This is the conceptual inversion worth taking away, and it is why "quantum cryptography" is often a misleading name. Classical cryptography tries to make eavesdropping useless: Eve can copy every bit, and we rely on her not having the computational power to invert the math. QKD instead makes eavesdropping visible. Eve can still listen; she simply cannot do it invisibly, and Alice and Bob will notice before they use the key. The security rests on physical law rather than on computational assumptions, which is why it survives the arrival of a quantum computer — and why it protects the key rather than the message.',
          'Two more steps make this practical, because real channels are noisy even with no Eve present. Error correction (information reconciliation) fixes the residual disagreements using public parity exchanges, and privacy amplification then hashes the reconciled key down to a shorter one, shrinking it by more than the amount Eve could possibly have learned given the observed error rate. The toll is steep: the secure fraction of the sifted key is about 1 − 2h(Q) for error rate Q, so at Q = 10% only about 6% of it survives, and even a 6% error rate leaves you with a key roughly a third the length — but one about which Eve\'s information is provably exponentially small.',
        ],
      },
      {
        kind: 'embed',
        href: '/visualizations/quantum-key-distribution',
        title: 'Quantum Key Distribution Lab',
        blurb:
          'Run BB84 qubit by qubit on the simulator: watch half the positions fall away in sifting, then let Eve intercept a chosen fraction and see the error rate climb by a quarter of it — past the 11% line at about 44%. Switch to E91 and watch |S| fall from 2√2 toward √2 as she listens.',
      },
      {
        kind: 'callout',
        tone: 'insight',
        title: 'The error rate is the whole security parameter',
        body: 'Alice and Bob never detect Eve directly. They measure one number — the quantum bit error rate on the sacrificed subset — and the security proof converts it into a bound on how much information any eavesdropper, using any strategy permitted by quantum mechanics, could hold about the sifted key. Below about 11% QBER for BB84, privacy amplification can compress that information away to nothing. Above it, no amount of post-processing helps and the protocol aborts. Every physical imperfection — detector dark counts, fibre loss, imperfect polarisers — shows up as QBER, and the proof is conservative: it attributes all of it to Eve. This is why QKD range is limited. Loss raises the effective error rate until the protocol simply refuses to produce a key.',
      },
      {
        kind: 'prose',
        title: 'E91: security from Bell inequality violation',
        paragraphs: [
          'Artur Ekert proposed a different route in 1991, and it is worth studying because it makes the source of the security explicit. Instead of Alice preparing and sending states, a source — which may sit anywhere, and may even be operated by Eve — distributes entangled pairs in the singlet state (|01⟩ − |10⟩)/√2, one qubit to each party.',
          'Alice and Bob each measure along randomly chosen axes drawn from a small set. When they happen to choose the same axis, the singlet\'s perfect anticorrelation gives them opposite outcomes with certainty, so Alice\'s bit and the complement of Bob\'s form shared key material. So far this is BB84 with the preparation moved.',
          'The interesting part is what they do with the mismatched runs, which BB84 simply discards. Alice and Bob use those to compute a CHSH correlation. Quantum mechanics predicts |S| = 2√2 ≈ 2.83 for the singlet with well-chosen axes; any local hidden-variable theory is bounded by |S| ≤ 2. If they observe the full violation, the state they shared was genuinely maximally entangled — and a maximally entangled pure state is, by the monogamy of entanglement, uncorrelated with everything else in the universe. There is no room for Eve to hold a correlated third system.',
          'That argument is stronger than it first appears, and it grew into device-independent QKD. The security conclusion follows from the observed statistics alone, without assuming the devices work as specified — you do not have to trust the manufacturer of your photon source or detectors, because a Bell violation cannot be faked by any classically correlated device. Fully device-independent QKD was demonstrated for the first time in 2022, and it is slow and finicky, but it closes a class of implementation attacks that has repeatedly broken deployed systems.',
        ],
      },
      {
        kind: 'code',
        language: 'python',
        code: `"""BB84 with an optional intercept-resend eavesdropper."""
import random

RECT, DIAG = 0, 1


def measure(bit: int, sent_basis: int, read_basis: int) -> int:
    """Matching basis reads the bit exactly; mismatched basis is a coin flip."""
    return bit if sent_basis == read_basis else random.randint(0, 1)


def bb84(n: int = 20_000, eavesdrop: bool = False) -> tuple[int, float]:
    alice_bits = [random.randint(0, 1) for _ in range(n)]
    alice_bases = [random.randint(0, 1) for _ in range(n)]
    bob_bases = [random.randint(0, 1) for _ in range(n)]

    bob_bits = []
    for bit, a_basis, b_basis in zip(alice_bits, alice_bases, bob_bases):
        if eavesdrop:
            # Eve must measure — no-cloning forbids a silent copy.
            e_basis = random.randint(0, 1)
            bit = measure(bit, a_basis, e_basis)
            a_basis = e_basis          # she forwards what she found
        bob_bits.append(measure(bit, a_basis, b_basis))

    # Sifting: keep only positions where the bases agreed.
    sifted = [
        (a, b)
        for a, b, ab, bb_ in zip(alice_bits, bob_bits, alice_bases, bob_bases)
        if ab == bb_
    ]
    errors = sum(1 for a, b in sifted if a != b)
    return len(sifted), errors / len(sifted)


length, qber = bb84(eavesdrop=False)
print(f"clean channel: {length} sifted bits, QBER {qber:.1%}")   # ~0.0%

length, qber = bb84(eavesdrop=True)
print(f"with Eve:      {length} sifted bits, QBER {qber:.1%}")   # ~25.0%

# Eve is wrong about the basis half the time, and induces an error in half
# of those retained bits: 0.5 x 0.5 = 25%. BB84 aborts above ~11%.`,
        caption:
          'Roughly half the raw bits survive sifting. A clean channel gives near-zero QBER; intercept-resend forces it to 25%, more than twice the ~11% abort threshold.',
      },
      {
        kind: 'embed',
        href: '/visualizations/entanglement',
        title: 'Entanglement Lab',
        blurb:
          'Vary the angle between Alice\'s and Bob\'s measurement axes and watch the correlation curve trace a cosine rather than the straight line any shared-instruction model would give. Run the CHSH test and watch S climb past the classical bound of 2 toward 2√2 — the measurement E91 turns directly into a security guarantee.',
      },
      {
        kind: 'inline-check',
        id: 'c2',
        question:
          'A bank installs a QKD link between two data centres. The physics of BB84 now guarantees the key is secret. Predict which problem the QKD box has NOT touched at all.',
        options: [
          { id: 'a', text: 'Key freshness — QKD keys can only be generated once per day' },
          { id: 'b', text: 'Knowing WHO is on the other end: without an authenticated classical channel, Eve can run BB84 with each side separately and both will happily share a key with her' },
          { id: 'c', text: 'Key randomness — the bits QKD produces are biased and need whitening' },
          { id: 'd', text: 'Key length — QKD cannot produce enough bits for modern ciphers' },
        ],
        correctId: 'b',
        explanation:
          'BB84\'s basis-reconciliation step runs over a classical channel, and the protocol\'s security proof assumes that channel is authenticated. Drop that assumption and the man-in-the-middle is trivial: Eve plays Bob to Alice and Alice to Bob, completes both protocols honestly, and reads all traffic. Authenticating the channel needs a pre-shared secret or a signature scheme — classical cryptography. So QKD expands an existing shared secret into a longer one; it does not create trust from nothing. That limitation, plus endpoints and implementation side channels, is why the section below ends somewhere the headlines rarely do: at post-quantum cryptography.',
      },
      {
        kind: 'prose',
        title: 'What QKD does not solve — and what actually protects you',
        paragraphs: [
          'QKD solves one problem completely: distributing a symmetric key over an untrusted channel, with security resting on physics rather than on computational hardness. It is genuinely remarkable. It is also, in the shape of most real systems, a small part of the problem, and overselling it has done the field no favours.',
          'It does not solve authentication, and this is the deepest limitation. BB84 requires an authenticated classical channel for basis reconciliation — otherwise Eve simply man-in-the-middles it, running BB84 with Alice while pretending to be Bob and vice versa, and both parties happily establish keys with her. Authenticating that channel needs a pre-shared secret or a public-key signature. So QKD does not remove the need for classical cryptography; it expands a short pre-shared secret into a long one. That is useful, but it is key expansion, not key establishment from nothing.',
          'It does not protect endpoints. The key arrives in a computer, and if that computer is compromised the physics of the channel is irrelevant. Nearly all real-world compromises are endpoint compromises, and no protocol on the wire touches them.',
          'It does not protect against side channels in the implementation, and this has bitten deployed systems repeatedly. Photon-number-splitting attacks exploit the fact that attenuated lasers sometimes emit two photons instead of one, letting Eve keep a copy — decoy-state protocols were developed specifically to close this. Detector blinding attacks shine bright light to force avalanche photodiodes into a classical linear mode where Eve controls the outcome; several commercial systems were fully broken this way. The theorems are unassailable; the devices are ordinary hardware with ordinary flaws.',
          'And it needs special infrastructure. Photons cannot be amplified without destroying their quantum state — no-cloning again — so QKD is limited to a few hundred kilometres of fibre. Longer links need trusted relay nodes, which reintroduce exactly the trust you were trying to eliminate, or satellites, as China\'s Micius demonstrated over 1,200 km in 2017. Quantum repeaters would fix this properly but require quantum memories and entanglement swapping that remain firmly experimental.',
          'So the practical answer to the quantum threat is post-quantum cryptography: classical algorithms whose hard problems have no known efficient quantum attack. NIST standardised the first set in August 2024 — ML-KEM (from CRYSTALS-Kyber, based on module lattices) for key encapsulation, ML-DSA (from CRYSTALS-Dilithium) and SLH-DSA (from SPHINCS+, hash-based) for signatures. These are software. They run on existing hardware, over existing networks, and they solve authentication as well as key exchange. Chrome and Cloudflare have been running hybrid post-quantum key exchange in production TLS since 2023, at a cost of a kilobyte or so per handshake. That is the migration actually happening, at internet scale, while QKD remains a specialised technology for a small number of high-value point-to-point links.',
        ],
      },
      {
        kind: 'keypoints',
        points: [
          'BB84: random bits in random bases, then discard the positions where Alice and Bob chose differently.',
          'No-cloning forces Eve to measure, and measuring a non-orthogonal state disturbs it — intercept-resend produces a 25% error rate.',
          'The measured QBER is the entire security parameter; below ~11% privacy amplification removes Eve\'s information, above it the protocol aborts.',
          'E91 replaces basis matching with a CHSH test: observing |S| > 2 proves genuine entanglement, and monogamy leaves no room for a correlated Eve.',
          'QKD does not provide authentication, does not protect endpoints, and has been broken repeatedly through implementation side channels.',
          'Post-quantum cryptography — ML-KEM, ML-DSA, SLH-DSA, standardised in 2024 — is the practical defence: software, on existing networks, covering signatures too.',
        ],
      },
      {
        kind: 'quiz',
        questions: [
          {
            id: 'q1',
            prompt: 'In BB84, why does an intercept-resend eavesdropper introduce a 25% error rate in the sifted key?',
            options: [
              { id: 'a', text: 'Eve\'s equipment is imperfect and adds noise proportional to the bit rate' },
              { id: 'b', text: 'Eve picks the wrong basis half the time, and in those cases Bob gets a random bit half the time: 0.5 × 0.5' },
              { id: 'c', text: 'Eve can only forward 75% of the photons she intercepts' },
              { id: 'd', text: 'Quantum channels have an intrinsic 25% loss rate' },
            ],
            correctId: 'b',
            explanation:
              'No-cloning forces Eve to measure rather than copy, and she must guess a basis. Guessing wrong collapses the photon into the other basis, so when Bob later uses Alice\'s basis — the only positions kept after sifting — he gets a coin flip instead of Alice\'s bit and disagrees half the time. Half of a half is 25%, more than twice the ~11% abort threshold. Notice the error rate is set by physics, not by Eve\'s budget: better equipment does not make her quieter, because the disturbance comes from the measurement itself.',
          },
          {
            id: 'q2',
            prompt: 'What does E91 gain by testing a Bell inequality on the runs where Alice and Bob chose different axes?',
            options: [
              { id: 'a', text: 'It speeds up key generation by using runs BB84 would discard' },
              { id: 'b', text: 'A CHSH violation certifies genuine entanglement, and monogamy then rules out any third party correlated with the pair — even if the source is untrusted' },
              { id: 'c', text: 'It corrects transmission errors without needing a public channel' },
              { id: 'd', text: 'It removes the need for an authenticated classical channel' },
            ],
            correctId: 'b',
            explanation:
              'The Bell test is a certificate about the state itself. Only a genuinely entangled pair can violate the CHSH bound of 2, and a maximally entangled pure pair is by monogamy uncorrelated with anything else — so there is nowhere for Eve\'s information to live. Because the conclusion follows from the observed statistics alone, it holds even if Eve built the source and the detectors, which is the basis of device-independent QKD (first demonstrated in 2022). Option D is the standard misconception: E91 still needs an authenticated classical channel, or Eve simply man-in-the-middles the reconciliation.',
          },
          {
            id: 'q3',
            prompt: 'Why is post-quantum cryptography, rather than QKD, the mainstream response to the quantum threat?',
            options: [
              { id: 'a', text: 'Because QKD has been proven insecure' },
              { id: 'b', text: 'Because post-quantum algorithms are information-theoretically secure, while QKD relies on computational assumptions' },
              { id: 'c', text: 'Because PQC is software that runs on existing hardware and networks and also solves authentication, while QKD needs dedicated optical links and still requires classical authentication' },
              { id: 'd', text: 'Because quantum computers cannot attack lattice problems even in principle' },
            ],
            correctId: 'c',
            explanation:
              'QKD\'s theorems are sound, but it protects one link, needs dedicated fibre or satellites, is range-limited because photons cannot be amplified, and does not address authentication or endpoint security — the places real attacks happen. ML-KEM and ML-DSA are drop-in software deployed today in production TLS. Option B inverts the security models: QKD is the information-theoretic one and PQC rests on computational hardness. Option D overstates the case — no efficient quantum algorithm for lattice problems is known, which is not the same as a proof that none exists, and that gap is exactly why hybrid classical-plus-PQC deployments are the current recommendation.',
          },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────
  // 5. Quantum Machine Learning
  // ─────────────────────────────────────────────────────────────────────
  {
    slug: 'quantum-machine-learning',

    blocks: [
      {
        kind: 'prose',
        title: 'What QML actually is — and the sentence to unlearn first',
        paragraphs: [
          'Strip away the branding and quantum machine learning, in its dominant near-term form, is one specific idea: use a parameterised quantum circuit as the model inside an otherwise ordinary machine-learning pipeline. Encode a data point x into a quantum state, run a circuit with tunable angles θ, measure an observable, and call the expectation value f(x, θ) the model\'s output. Train by having a classical optimiser adjust θ to minimise a loss over a labelled dataset. If that loop sounds familiar, it should — it is the VQE loop from the previous lesson with the Hamiltonian swapped for a loss function and a dataset threaded through the circuit. Same ansatz design questions, same classical optimiser, same shot-noise economics, and, as we will see, the same barren plateaus.',
          'The sentence to unlearn is the one every popular article opens with: "quantum computers try all possibilities at once, so they learn faster." You already know from the interference lesson why this is wrong, but it is worth restating in ML terms because the misconception does real damage here. A superposition over states is not a parallel evaluation you can harvest: measurement returns one outcome, sampled by the Born rule, and everything the model "computed" in the other branches is gone. A quantum model is not a classical model with free parallelism. It is a different hypothesis class — a different family of functions f(x, θ) — that may or may not fit your data better, and whose every evaluation costs many shots of a physical experiment.',
          'Put precisely: training is not faster. Each gradient step needs the circuit run thousands of times per data point (expectation values are estimated from samples, and the parameter-shift rule needs two such estimates per parameter), where a GPU evaluates a neural network\'s exact gradient in one backward pass. On today\'s hardware a quantum model is slower to train than a classical one by orders of magnitude. The only honest pitch for QML is not speed but expressivity: perhaps some datasets have structure that a quantum hypothesis class captures with fewer parameters or better generalisation than any efficient classical class. Whether such datasets exist outside cryptography is the open question this lesson keeps returning to.',
        ],
      },
      {
        kind: 'inline-check',
        id: 'c1',
        question:
          'You encode a feature x into the circuit exactly once, through a single rotation gate RY(x), then stack twenty layers of trainable gates on top. Predict: which functions of x can the trained model\'s output f(x) express?',
        options: [
          { id: 'a', text: 'Any continuous function, given enough trainable layers — like a deep neural network' },
          { id: 'b', text: 'Only a + b·cos(x) + c·sin(x): one frequency, with all that training merely tuning the three coefficients' },
          { id: 'c', text: 'Polynomials in x, of degree up to the number of layers' },
          { id: 'd', text: 'It depends on which classical optimiser is used for training' },
        ],
        correctId: 'b',
        explanation:
          'The output of a rotation-encoded circuit is a Fourier series in the data, and the available frequencies are fixed entirely by the encoding — how many times, and through which gates, x enters. One encoding gate means one frequency, forever; the twenty trainable layers adjust a, b and c and can do nothing else. This is the single most important structural fact about near-term QML, and it inverts the deep-learning intuition of option A: adding trainable depth does not enlarge the function class, while re-encoding x at several points in the circuit does. The section below builds this out — in QML, the encoding is the model.',
      },
      {
        kind: 'prose',
        title: 'Data encoding, where the battle is won or lost',
        paragraphs: [
          'Before a circuit can process a data point, the data point has to become a quantum state, and this step — not the trainable circuit — turns out to dominate everything. The two standard schemes make the trade-off concrete. Angle encoding writes each feature into a rotation: feature x_j becomes RY(x_j) on qubit j, so d features need d qubits and depth one. Cheap, NISQ-friendly, and linear in the data size. Amplitude encoding writes the whole feature vector into the amplitudes themselves: a vector of dimension 2ⁿ becomes Σ x_i |i⟩ on n qubits, after normalisation. Exponentially compact — a million-dimensional vector in twenty qubits — which is the number that launched a thousand pitch decks.',
          'Here is what the pitch decks omit. Preparing an arbitrary amplitude-encoded state requires a circuit of depth O(2ⁿ/n) in general — exponential in the qubit count — so loading the data costs what the compression saved. The proposals that avoid this assume a quantum RAM that can serve superposed queries in logarithmic time; no such device exists, and building one at scale faces the same decoherence economics as the computer itself. This "input problem" felled an earlier generation of QML: the 2009 HHL algorithm solves linear systems exponentially faster than classical methods *if* the data is already loaded and *if* you only need one global property of the solution rather than the solution itself. Read the fine print on any claimed exponential and you will usually find the cost hiding in state preparation or readout.',
          'Encoding also decides, quite literally, what functions the model can express. A result by Schuld, Sweke and Meyer (2021) makes this exact: the output of any circuit that encodes data through rotation gates is a Fourier series in the data, and the available frequencies are fixed entirely by the encoding — how many times, and with what gates, x enters the circuit. The trainable parameters θ only adjust the coefficients of that series. Encode a feature once and your million-parameter quantum model can express exactly one sinusoidal frequency in it, however deep the trained part is. This is why "re-uploading" the data at several points in the circuit measurably enlarges the model class while adding layers of trainable gates alone does not: in QML, the encoding is the model.',
          'The 2019 result of Havlíček and co-workers at IBM reframed all of this compactly: a circuit that encodes x and measures is computing a kernel — an inner product ⟨φ(x)|φ(x′)⟩ between feature-space vectors — which puts QML on the same mathematical footing as classical kernel methods and support vector machines. That framing is where both the sharpest hopes and the sharpest negative results now live, and we return to it after looking at what training these circuits is actually like.',
        ],
      },
      {
        kind: 'prose',
        title: 'Variational classifiers, and the plateau you already met',
        paragraphs: [
          'A variational quantum classifier assembles the pieces: an encoding circuit E(x), a trainable circuit W(θ), and a measurement — typically ⟨Z⟩ on one qubit, thresholded at zero to give a binary label. The loss is ordinary (hinge, cross-entropy, squared error), the optimiser is ordinary (Adam, COBYLA, SPSA), and gradients come from the parameter-shift rule: for a gate generated by a Pauli, ∂⟨M⟩/∂θ = [⟨M⟩(θ+π/2) − ⟨M⟩(θ−π/2)]/2, exact but costing two full expectation-value estimates per parameter per step. Everything about this is the VQE loop; the one new ingredient is that the circuit is re-run for every data point in the batch.',
          'Which means everything you learned about barren plateaus transfers without modification, because the theorem never mentioned chemistry. McClean et al.\'s 2018 result is about parameterised circuits and cost functions, full stop: make the trainable circuit expressive enough to approximate a 2-design and the gradient of any such cost concentrates exponentially around zero in the qubit count. A deep hardware-efficient classifier on 30+ qubits is untrainable for exactly the reason a deep hardware-efficient VQE ansatz is, and noise-induced and global-cost plateaus carry over identically. The QML literature spent its first years rediscovering this, and the escape routes are the same ones: shallow circuits, local observables, structured ansätze, clever initialisation.',
          'And the same uncomfortable dichotomy follows the escape routes here too, with an extra twist published by Cerezo and collaborators: for many of the QML architectures made shallow and structured enough to dodge plateaus, the resulting model can be simulated — or "surrogated" — classically after a modest number of runs on the device, meaning a classical computer can learn to predict the quantum model\'s outputs and then train and deploy it with no quantum computer at all. A model must be non-classical enough to be interesting yet structured enough to be trainable, and nobody has exhibited a family that is provably both on a practical problem. That is the same open question as VQE\'s, wearing a lab coat from a different department.',
        ],
      },
      {
        kind: 'callout',
        tone: 'warning',
        title: '"Exponential compression" is not exponential speed-up',
        body: 'Amplitude encoding really does hold 2ⁿ numbers in n qubits, and this fact anchors most inflated QML claims. But you cannot read the numbers back out — measurement samples one basis state, and estimating even a single amplitude to precision ε costs O(1/ε²) shots. You cannot, in general, load them in — arbitrary state preparation takes exponential depth, and the qRAM that would fix this does not exist. Compression you can neither fill cheaply nor read at all is not a speed-up; it is a storage format with no I/O. Every serious QML proposal has to say where its data comes from and how few bits of answer it needs back, and the ones that survive that audit are rarer than the headlines suggest.',
      },
      {
        kind: 'code',
        language: 'python',
        code: `"""A working variational quantum classifier on one qubit — and its limit.

Angle encoding, one trainable rotation layer, <Z> readout. Small enough to
simulate exactly, which is itself the honest footnote: anything this
trainable is also this simulable.
"""
import numpy as np

def ry(t):
    return np.array([[np.cos(t / 2), -np.sin(t / 2)],
                     [np.sin(t / 2),  np.cos(t / 2)]])

def model(x: float, theta: np.ndarray) -> float:
    """f(x) = <psi| Z |psi>,  |psi> = RY(th1) RY(x) RY(th0) |0>.

    Schuld et al. 2021: with x encoded once through a rotation, whatever
    theta does, f(x) = a + b*cos(x) + c*sin(x) and nothing else. The
    encoding fixed the frequency; training only tunes a, b, c.
    """
    psi = ry(theta[1]) @ ry(x) @ ry(theta[0]) @ np.array([1.0, 0.0])
    return psi[0] ** 2 - psi[1] ** 2      # <Z>


def grad(xs, ys, theta):
    """Mean-squared-error gradient via the parameter-shift rule: two extra
    model evaluations per parameter. Each evaluation here is one matrix
    multiply; on hardware it is thousands of shots — which is why quantum
    gradients are expensive, not fast."""
    g = np.zeros_like(theta)
    for i in range(len(theta)):
        shift = np.zeros_like(theta); shift[i] = np.pi / 2
        for x, y in zip(xs, ys):
            d = (model(x, theta + shift) - model(x, theta - shift)) / 2
            g[i] += 2 * (model(x, theta) - y) * d / len(xs)
    return g


rng = np.random.default_rng(7)
xs = rng.uniform(-np.pi, np.pi, 60)

def train(ys):
    theta = np.array([0.3, -0.2])
    for _ in range(150):
        theta -= 0.5 * grad(xs, ys, theta)
    return np.mean(np.sign([model(x, theta) for x in xs]) == ys)

# Labels follow sign(cos x) — a frequency the encoding CAN express.
print(f"cos(x) labels:  {train(np.sign(np.cos(xs))):.0%}")      # 97%

# Labels follow sign(cos 3x) — a frequency it CANNOT. The trained model
# plateaus at the ~2/3 agreement any single-frequency sign(cos(x + phi))
# has with sign(cos 3x): the ceiling of the model class, not of training.
print(f"cos(3x) labels: {train(np.sign(np.cos(3 * xs))):.0%}")  # 67%`,
        caption:
          'The first task is learnable and the second is provably not — with the same trainable circuit, because the single encoding gate fixes which frequencies the model contains. The 67% is the exact ceiling of a one-frequency model on cos(3x) labels; twenty more trainable layers would not raise it, while encoding x three times would.',
      },
      {
        kind: 'embed',
        href: '/visualizations/vqe',
        title: 'VQE and the Barren Plateau',
        blurb:
          'The training loop of a quantum classifier is this loop with a loss function in place of a Hamiltonian. Watch the optimiser descend the energy landscape, then increase the qubit count and circuit depth and watch the landscape flatten — the barren plateau that makes deep quantum classifiers untrainable is the same one that threatens VQE, and here you can see it form.',
      },
      {
        kind: 'inline-check',
        id: 'c2',
        question:
          'Before the honest accounting below, commit to a position: what is actually PROVEN about exponential quantum advantage in machine learning on classical data?',
        options: [
          { id: 'a', text: 'Nothing either way — no separation has ever been proved in any setting' },
          { id: 'b', text: 'Exponential advantage has been demonstrated end-to-end on standard image benchmarks' },
          { id: 'c', text: 'Exactly one provable exponential separation exists — for a problem deliberately built from the discrete logarithm — and none for any natural dataset' },
          { id: 'd', text: 'Exponential advantage has been proven impossible for classical data' },
        ],
        correctId: 'c',
        explanation:
          'Liu, Arunachalam and Temme proved in 2021 that a quantum kernel learns a discrete-log-based classification problem that no efficient classical learner can (assuming discrete log is classically hard) — a genuine, end-to-end separation, for labels reverse-engineered from the one function quantum computers are known to compute and classical ones are believed unable to. Option A undersells it and option B oversells it; option D fails in the other direction, because no impossibility proof exists either, which is exactly why the question is open rather than settled. The section below places this lone positive result against the wall of dequantisation results around it.',
      },
      {
        kind: 'prose',
        title: 'Quantum kernels, and what is actually proven',
        paragraphs: [
          'The kernel view deserves its own honest accounting, because it is where QML\'s one rigorous advantage result lives. A quantum kernel machine never trains a quantum circuit at all: the device is used only to estimate pairwise similarities k(x, x′) = |⟨φ(x)|φ(x′)⟩|², and a classical support vector machine does the learning on that kernel matrix. This sidesteps barren plateaus entirely — there are no circuit parameters to differentiate — at the price of O(N²) kernel evaluations for N training points, each one a multi-thousand-shot experiment, which is its own scaling wall for datasets beyond a few thousand rows.',
          'The rigorous result: Liu, Arunachalam and Temme proved in 2021 that there exists a classification problem — labels built from the discrete logarithm — that a quantum kernel learns efficiently while no efficient classical learner can, assuming discrete log is classically hard. This is a genuine, end-to-end, provable exponential separation, and you should also see exactly what it is: a problem reverse-engineered from Shor-style period-finding so that the quantum feature map computes the one thing classical computers provably struggle with. It is a proof that quantum learning advantage is *possible*, not evidence that your tabular, image or transaction data has any of this structure. Nobody has found a natural dataset that does.',
          'Around that lone positive result stands a wall of negative ones, and a course that hunts misconceptions owes you the wall. Tang\'s 2018 dequantisation of the quantum recommendation-systems algorithm — an exponential QML speed-up claim answered by a classical algorithm achieving the same task with only polynomial slowdown under matching data-access assumptions — set the pattern, and a series of results since (Cotler et al. 2021 among them) has shown that for classical data with efficient classical access, many claimed quantum learning advantages evaporate once the classical side is granted analogous sampling access. Huang et al.\'s 2021–2022 work drew the sharpest line: provable exponential advantages in learning are real and demonstrated for experiments on *quantum* data — states from a quantum sensor or simulator, processed coherently — while for classical data none has been established. As of 2026 that line has not moved: there is no proven, and no convincingly demonstrated, exponential quantum advantage for machine learning on classical data. Anyone claiming otherwise is selling something.',
        ],
      },
      {
        kind: 'prose',
        title: 'The NISQ reality, and how to read the field',
        paragraphs: [
          'What do QML experiments actually look like on 2026 hardware? Dozens of qubits, heavily error-mitigated, on datasets of a few hundred points that sklearn fits in milliseconds — usually PCA-compressed to fit the qubit budget, which quietly discards most of the structure a quantum model was supposed to exploit. Published head-to-head comparisons at these scales show quantum models roughly matching, and typically trailing, well-tuned classical baselines. That is not scandalous — it is what proof-of-principle work on hundred-gate depth budgets must look like, for the NISQ reasons the previous lesson made precise — but it means every "quantum AI" headline you read describes an experiment a laptop reproduces, because at simulable scales it must. You can run that experiment yourself: the QML Reality Check tool in the workbench trains a 2–4 qubit variational classifier against a properly fitted logistic regression and a small network on the same held-out rows, counts the circuit evaluations against the flops, and lets you watch the ranking flip on a dataset whose labels a hidden quantum circuit produced — the one regime where the quantum model is the natural hypothesis class.',
          'A checklist for reading any QML claim, each item cashing out something from this lesson. Where does the data come from, and what does encoding it cost — is there an amplitude-encoding or qRAM assumption doing the real work? Is the claimed advantage against a serious classical baseline with the same tuning effort, or against a strawman? Is the model in a regime where it is trainable (no barren plateau) yet not classically surrogatable — and can the authors say why? Is the problem natural, or reverse-engineered from a quantum-hard function? Most claims die on the first or second question.',
          'The honest closing summary. Parameterised quantum circuits are a mathematically distinctive model family — Fourier models over encoding-determined frequencies, kernel machines over Hilbert-space feature maps — and the tooling around them (PennyLane and its peers made circuit differentiation as routine as autograd) is genuinely good, which is why the field can now test its own claims quickly. The most defensible near-term bet is quantum data: learning from the outputs of quantum sensors and simulators, where proven advantages exist. For classical data, QML in 2026 is a research programme with one contrived separation, several dequantised claims, and no demonstrated practical win — the 2024 benchmark by Bowles, Ahmed and Schuld, which tuned twelve popular quantum models and their classical baselines with equal care on the same datasets, found no case where the quantum models won, and the field\'s own reviews now say so in their abstracts. Worth understanding deeply, not worth a press release. You now know enough to tell the difference, which was the point.',
        ],
      },
      {
        kind: 'embed',
        href: '/workbench/qml-check',
        title: 'QML Reality Check',
        blurb:
          'Train a variational quantum classifier against a tuned logistic regression and a small MLP on moons, circles and a quantum-generated dataset, in your browser. Read the held-out accuracies and the training cost in circuit evaluations versus flops — and watch the gap invert only on the data a quantum circuit made.',
      },
      {
        kind: 'keypoints',
        points: [
          'Near-term QML = the VQE loop with a loss function: encode x, run a parameterised circuit, measure, let a classical optimiser adjust θ.',
          'Superposition is not free parallelism — measurement returns one Born-rule sample, and training is slower than classical, not faster; the only honest pitch is a different hypothesis class.',
          'Angle encoding is cheap and linear; amplitude encoding is exponentially compact but exponentially expensive to load and unreadable at output — compression without I/O.',
          'The encoding fixes the model\'s Fourier frequencies; the trainable parameters only tune coefficients. In QML the encoding is the model.',
          'Barren plateaus apply verbatim, and shallow trainable circuits are often classically surrogatable — the trainable-but-not-simulable family remains unfound.',
          'One proven quantum learning advantage exists (discrete-log kernels, a contrived problem); for classical data, no exponential advantage has been proven or demonstrated as of 2026. Quantum data is the defensible frontier.',
        ],
      },
      {
        kind: 'quiz',
        questions: [
          {
            id: 'q1',
            prompt: 'Why is "a quantum model trains faster because superposition evaluates all data points at once" wrong?',
            options: [
              { id: 'a', text: 'It is essentially right, but only for models with more qubits than data points' },
              { id: 'b', text: 'Measurement returns one Born-rule sample, so superposed evaluations cannot be harvested — and each expectation value costs thousands of shots, making training slower than classical, not faster' },
              { id: 'c', text: 'Superposition speeds up inference but not training, which is the phase that matters' },
              { id: 'd', text: 'Quantum computers cannot process more than one data point per circuit in principle' },
            ],
            correctId: 'b',
            explanation:
              'This is the interference lesson\'s central point wearing ML clothes. A superposition is not a bundle of results you get to keep: readout is a single sample, and estimating the expectation values that training needs costs O(1/ε²) shots each, with the parameter-shift rule demanding two per parameter per gradient step. A GPU computes a neural network\'s exact gradient in one backward pass. The honest case for QML was never speed — it is that a parameterised circuit is a different hypothesis class (a Fourier model whose frequencies the encoding fixes) that might fit some data better. Option D is false but irrelevant: batching tricks exist, and they change none of this.',
          },
          {
            id: 'q2',
            prompt: 'Amplitude encoding stores a 2ⁿ-dimensional vector in n qubits. Why does this exponential compression not translate into an exponential speed-up for practical ML?',
            options: [
              { id: 'a', text: 'The compression introduces errors that grow with the vector dimension' },
              { id: 'b', text: 'It does — this is precisely the proven advantage of algorithms like HHL' },
              { id: 'c', text: 'Preparing an arbitrary amplitude-encoded state needs exponential circuit depth (or a qRAM that does not exist), and reading amplitudes back out costs O(1/ε²) samples each — the loading and readout consume what the compression saved' },
              { id: 'd', text: 'Amplitude encoding only works for vectors whose entries are all positive' },
            ],
            correctId: 'c',
            explanation:
              'The compression is real; the I/O is the catch. Arbitrary state preparation takes depth O(2ⁿ/n), the log-time loading proposals assume quantum RAM hardware nobody has built, and measurement samples basis states rather than printing amplitudes. HHL is the canonical cautionary tale rather than a counterexample: its exponential speed-up holds only if the data is already loaded and only one global property of the answer is needed — and Tang\'s 2018 dequantisation showed that under matching data-access assumptions, the claimed exponential for recommendation systems vanishes classically. When you audit a QML claim, look at state preparation and readout first; that is where the exponent usually hides.',
          },
          {
            id: 'q3',
            prompt: 'What is the honest status of quantum advantage in machine learning on classical data, as of 2026?',
            options: [
              { id: 'a', text: 'Exponential advantage has been demonstrated on standard image-classification benchmarks' },
              { id: 'b', text: 'A provable exponential separation exists for one contrived problem built from the discrete logarithm; for natural classical data, no exponential advantage has been proven or demonstrated' },
              { id: 'c', text: 'Quantum advantage has been mathematically ruled out for all classical data' },
              { id: 'd', text: 'Quantum kernels are proven to outperform classical kernels whenever the feature space is large enough' },
            ],
            correctId: 'b',
            explanation:
              'Both halves matter. Liu, Arunachalam and Temme\'s 2021 result is a genuine end-to-end separation — but for labels reverse-engineered from discrete log, the very function quantum computers are known to compute and classical ones are believed unable to. No natural dataset with that structure has been found, dequantisation results have dismantled several claimed exponentials, and shallow trainable models keep turning out classically surrogatable. Option C errs in the other direction: no impossibility proof exists either, which is why this is an open question rather than a settled one. The demonstrated exponential learning advantages are on quantum data — sensor and simulator outputs processed coherently — which is the defensible frontier the field is shifting toward.',
          },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────
  // 6. QAOA and Quantum Optimization
  // ─────────────────────────────────────────────────────────────────────
  {
    slug: 'qaoa-and-optimization',

    blocks: [
      {
        kind: 'prose',
        title: 'MaxCut, and how a graph becomes a Hamiltonian',
        paragraphs: [
          'The poster problem for quantum optimisation is MaxCut. Take a graph — vertices, edges — and paint every vertex one of two colours. An edge is "cut" when its endpoints get different colours, and the task is to choose the colouring that cuts the most edges. It looks like a puzzle and it is a monster: MaxCut is NP-hard, it shows up wherever something must be split into two groups with maximum disagreement across the boundary — circuit layout, spin glasses, clustering — and nobody expects any algorithm, classical or quantum, to solve every instance efficiently.',
          'The encoding into quantum mechanics is almost embarrassingly direct. Give each vertex a qubit and read colour off the computational basis: |0⟩ is one side of the cut, |1⟩ the other. For an edge (i, j), the operator (1 − Z_iZ_j)/2 evaluates to 1 when the endpoints differ and 0 when they agree — check it on the four basis combinations, it is a one-line calculation. Summing over the edges gives the cost Hamiltonian C = Σ_{(i,j)} (1 − Z_iZ_j)/2, whose eigenvalue on any basis state is exactly the number of edges that colouring cuts. The best cut is the highest-eigenvalue eigenstate.',
          'Pause on a structural point that separates this from the VQE chemistry problem you already know. C is diagonal in the computational basis. Every eigenstate is a plain classical bit string; the answer we want is not an entangled state, it is a colouring you could write on paper. Nobody needs a quantum computer to REPRESENT a cut, or to evaluate one — counting cut edges is instant. The only possible quantum contribution is to the SEARCH: arranging interference so that a measurement lands on a good bit string more often than blind luck would.',
          'One more piece of vocabulary and the classical bar it sets. An algorithm has approximation ratio α if it always delivers at least α times the optimal cut. Painting vertices at random cuts half the edges on average, which already guarantees ratio 1/2 on any graph. The classical algorithm to beat is Goemans–Williamson (1995), a semidefinite-programming rounding scheme with a proven ratio of about 0.878 on every graph — and under a standard complexity conjecture, doing better than that in the worst case is NP-hard for any algorithm whatsoever, quantum ones included. Whatever QAOA is for, it is not for breaking that barrier.',
        ],
      },
      {
        kind: 'inline-check',
        id: 'c1',
        question:
          'C is diagonal: every computational basis state is a candidate cut, and its energy is that cut\'s size. Prepare the uniform superposition over all 2ⁿ colourings — every cut "present at once", as the headlines would put it — and measure every qubit. What do you get?',
        options: [
          { id: 'a', text: 'The best cut, or something close to it — the high-value cuts dominate the superposition' },
          { id: 'b', text: 'One uniformly random colouring: exactly what classical random guessing produces, cutting about half the edges on average' },
          { id: 'c', text: 'An average of all cuts, weighted by their quality' },
          { id: 'd', text: 'The measurement is not defined, because C has degenerate eigenvalues' },
        ],
        correctId: 'b',
        explanation:
          'The uniform superposition gives every colouring the same amplitude 1/√(2ⁿ), so the Born rule hands you one uniformly random bit string — a fair coin per vertex, the same half-the-edges average a laptop gets by literal guessing. "All possibilities at once" buys nothing by itself; you have read this before in the interference and Shor lessons, and here it is again wearing an optimisation costume. Everything QAOA adds is a way of tilting those amplitudes toward high-value cuts before the measurement — and the tilting mechanism, in the next section, is interference, arranged by exactly two kinds of operation.',
      },
      {
        kind: 'prose',
        title: 'The alternating ansatz: cost layers and mixer layers',
        paragraphs: [
          'QAOA — the Quantum Approximate Optimization Algorithm, Farhi, Goldstone and Gutmann, 2014 — prepares its state with two alternating ingredients. Start from the uniform superposition |+⟩^⊗n. Then apply, p times over, a cost layer e^{−iγ_k C} followed by a mixer layer e^{−iβ_k B}, where B = Σ_i X_i is a transverse field and the 2p angles (γ₁, β₁, …, γ_p, β_p) are free parameters.',
          'Each ingredient alone is useless, and seeing why teaches you what the pair accomplishes. The cost layer is diagonal: it multiplies each colouring\'s amplitude by the phase e^{−iγ·(its cut value)}, writing the quality of every cut into the phase pattern — but phases alone move no probability, so measuring right after a cost layer still yields a uniform sample. The mixer is a rotation RX(2β) on every qubit: it makes amplitudes of colourings that differ by single bit flips interfere, converting the phase pattern into actual amplitude differences — but applied to a state with no phase structure it does nothing useful either. Cost writes the problem into phases; mixer cashes phases out as interference. Alternating them is the algorithm.',
          'This should feel familiar twice over. It is the Grover template — an oracle-like phase step followed by a mixing step — with the sharp all-or-nothing oracle replaced by a graded phase proportional to solution quality, and the fixed iteration count replaced by tunable angles. And operationally it is VQE\'s outer loop verbatim: a classical optimiser proposes the 2p angles, the device prepares the state and estimates ⟨C⟩ from shots, the optimiser updates, repeat. The differences from VQE are that the ansatz shape is dictated by the problem rather than chosen from a menu, that there are only 2p parameters rather than hundreds, and that any single measurement outcome IS a candidate solution whose value you can check classically for free — you keep the best bit string you ever saw, whatever ⟨C⟩ was doing.',
          'Where does the ansatz come from? From the adiabatic theorem, discretised. Run the cost and mixer layers with infinitesimally small alternating steps that slowly trade mixer for cost, and you recover adiabatic evolution from the transverse-field ground state to the ground state of −C, which reaches the optimum exactly. QAOA at finite p is a coarse Trotterisation of that path with the step sizes left free for the optimiser to choose. This is why p → ∞ convergence to the true optimum is guaranteed — and the next section is about why that guarantee is worth far less than it sounds.',
        ],
      },
      {
        kind: 'prose',
        title: 'What p buys, and what it costs',
        paragraphs: [
          'The depth parameter p is the whole trade-off, so take it one side at a time. What is proven at small p: for p = 1 on 3-regular graphs, QAOA guarantees an approximation ratio of about 0.6924. That number was genuinely exciting in 2014 — a quantum circuit with one layer and a provable worst-case guarantee. It is also below random-guessing-plus-local-search territory and well below Goemans–Williamson\'s 0.878, so p = 1 is provably NOT better than classical. The hope was that the guarantee would climb quickly with p.',
          'Then came the locality obstructions, and they are worth understanding because they are exact statements, not empirics. At depth p, each qubit\'s measurement statistics depend only on the part of the graph within p edges of it — information cannot travel further through p rounds of nearest-neighbour interaction. Fixed-p QAOA is therefore a LOCAL algorithm: it decides each vertex\'s colour from a bounded neighbourhood, blind to any structure — a long odd cycle, say — larger than radius p. Bravyi, Gosset, König and Temme turned this into theorems: on certain graph families, constant-depth QAOA provably cannot beat simple classical algorithms, and symmetry makes the obstruction stick at any constant p. Meanwhile Hastings exhibited classical local algorithms matching or beating one-step QAOA across broad families, and on large-girth graphs classical message-passing algorithms achieve the value that QAOA only approaches as p → ∞. The pattern: for QAOA\'s fixed-p guarantees, classical algorithms — local ones at small p, message-passing ones asymptotically — match or beat them on the graph families studied.',
          'So p must grow with the problem. Now count the cost. Each round applies a two-qubit interaction across every edge of the graph, so circuit depth grows with p times the graph\'s size divided by whatever parallelism the hardware layout allows — and on a NISQ machine, the depth budget from the previous lesson caps p at single digits for any interesting instance. Worse, noise does not merely blur the result: Stilck França and García-Patrón proved in 2021 that at even modest depth, noise drags the output distribution close enough to something classically samplable that any advantage is gone — for noisy devices, more p stops helping and starts actively erasing the quantum structure. The adiabatic guarantee lives at p → ∞; the hardware lives at p ≈ 3.',
          'Two genuine mercies soften the picture. With only 2p parameters, QAOA\'s optimisation is far more tractable than a generic VQE ansatz, and the optimal angles CONCENTRATE: good angles found on small instances of a problem family transfer to large instances of the same family, so the expensive outer loop can often be skipped after being run once. And the trainability warning from the VQE lesson still applies in the large: barren plateaus are a property of parameterised circuits generally, and deep or noise-afflicted QAOA inherits them — but shallow QAOA with its problem-shaped, few-parameter ansatz is among the least-afflicted variational circuits known. The /visualizations/vqe landscape you have already flattened is the same landscape this outer loop walks.',
        ],
      },
      {
        kind: 'callout',
        tone: 'warning',
        title: '"Converges to the optimum as p → ∞" is a boundary condition, not a performance claim',
        body: 'The adiabatic limit guarantees QAOA reaches the exact optimum at infinite depth — a sentence that appears in nearly every QAOA pitch. Read it against the classical baseline: exhaustive search also reaches the exact optimum, in finite time. A convergence guarantee with no rate attached says nothing about beating anything. And the rate is where the hardness went: the adiabatic runtime scales with the inverse square of the minimum spectral gap along the path, and for hard optimisation instances that gap is believed to close exponentially with problem size. The p → ∞ guarantee is the NP-hardness of the problem, relocated — not removed.',
      },
      {
        kind: 'code',
        language: 'python',
        code: `"""QAOA at p=1 on a 5-vertex ring, simulated exactly.

Small enough to verify every claim by brute force — which is itself the
honest footnote: a laptop simulates QAOA exactly to ~30 qubits, so no
demonstration at these scales can be evidence of quantum advantage.
"""
import numpy as np

EDGES = [(0, 1), (1, 2), (2, 3), (3, 4), (4, 0)]   # a 5-cycle: best cut = 4
n = 5

def cut_value(bits: int) -> int:
    """Edges whose endpoints land on different sides of the partition."""
    return sum(((bits >> i) ^ (bits >> j)) & 1 for i, j in EDGES)

CUTS = np.array([cut_value(b) for b in range(2 ** n)])   # C is diagonal
BEST = int(CUTS.max())


def qaoa_state(gamma: float, beta: float) -> np.ndarray:
    """|gamma, beta> = e^{-i beta B} e^{-i gamma C} |+>^n,  B = sum X_i."""
    state = np.full(2 ** n, 1 / np.sqrt(2 ** n), dtype=complex)
    state *= np.exp(-1j * gamma * CUTS)        # cost layer: a phase per cut
    c, s = np.cos(beta), -1j * np.sin(beta)    # mixer: RX(2 beta) each qubit
    for q in range(n):
        state = state.reshape(2 ** (n - q - 1), 2, 2 ** q)
        state = np.stack([c * state[:, 0, :] + s * state[:, 1, :],
                          s * state[:, 0, :] + c * state[:, 1, :]], axis=1)
    return state.reshape(2 ** n)


def expected_cut(state: np.ndarray) -> float:
    return float(np.sum(np.abs(state) ** 2 * CUTS))   # <C>, the Born rule


def p_best(state: np.ndarray) -> float:
    return float(np.sum(np.abs(state) ** 2, where=(CUTS == BEST)))


# The uniform superposition IS random guessing, exactly.
uniform = np.full(2 ** n, 1 / np.sqrt(2 ** n), dtype=complex)
print(f"guessing: E[cut] = {expected_cut(uniform):.3f}, P(best) = {p_best(uniform):.3f}")
# guessing: E[cut] = 2.500, P(best) = 0.312

# The classical outer loop — here, a plain grid over the two p=1 angles.
grid = np.linspace(0, np.pi, 120)
g, b = max(((g, b) for g in grid for b in grid),
           key=lambda gb: expected_cut(qaoa_state(*gb)))
tuned = qaoa_state(g, b)
print(f"p=1 QAOA: E[cut] = {expected_cut(tuned):.3f}, P(best) = {p_best(tuned):.3f}")
# p=1 QAOA: E[cut] = 3.750, P(best) = 0.879   (best cut is 4 of 5 edges)`,
        caption:
          'One cost layer and one mixer layer lift the expected cut from 2.5 to exactly 3.75 — three quarters of the edges, the known p=1 performance on a ring — and the best cut\'s probability from 0.31 to 0.88. Honest scale check: at 5 qubits, random guessing already finds an optimal cut a third of the time, and this whole "quantum" computation is thirty lines of numpy.',
      },
      {
        kind: 'embed',
        href: '/visualizations/vqe',
        title: 'VQE and the Barren Plateau',
        blurb:
          'QAOA\'s outer loop is this loop with ⟨C⟩ in place of a molecular energy: a classical optimiser walking a landscape whose every point costs a batch of circuit shots. Watch the optimiser descend, then raise the qubit count and depth and watch the landscape flatten — QAOA\'s few, problem-shaped parameters make it unusually resistant to that flattening at shallow depth, and the resistance fades exactly as p grows toward where the theory says the power would be.',
      },
      {
        kind: 'inline-check',
        id: 'c2',
        question:
          'Commit before the honest accounting below: as of 2026, what is the strongest evidence that QAOA can beat classical optimisation at anything?',
        options: [
          { id: 'a', text: 'Hardware demonstrations now routinely beat tuned classical solvers on industrial problems' },
          { id: 'b', text: 'A proof that QAOA outperforms every classical algorithm once p ≥ 2' },
          { id: 'c', text: 'Numerical evidence of a better time-to-solution scaling exponent on one engineered problem family, obtained mostly in simulation, with the projected crossover beyond any existing hardware — and no proof, and no wall-clock win anywhere' },
          { id: 'd', text: 'There is none, because QAOA has been proven never to beat classical methods' },
        ],
        correctId: 'c',
        explanation:
          'The state of the art in evidence is a scaling study — QAOA\'s time-to-solution appearing to grow with a smaller exponent than the best classical heuristic\'s on low-autocorrelation binary sequences — and a scaling exponent measured at simulable sizes is a promissory note, not a payment: the projected crossover sits beyond current machines and assumes fault-tolerant execution. Option A describes no experiment that exists; every hardware demonstration to date runs at classically reproducible scale. Option D fails in the other direction — no impossibility proof exists, fixed-p obstructions notwithstanding, which is precisely why "unproven" rather than "disproven" is the accurate word. The section below lays out both sides.',
      },
      {
        kind: 'prose',
        title: 'Why "quantum optimisation beats classical" remains unproven',
        paragraphs: [
          'Start with what an advantage claim would need to establish: on a problem someone actually wants solved, a quantum device delivering better answers, or equal answers meaningfully faster or cheaper, than the best classical method given the same tuning effort — not than a strawman, and not at a size a laptop replicates. No experiment as of 2026 meets that bar, on any optimisation problem, on any hardware. That is not a controversial reading; it is the stated position of the serious groups working on it.',
          'The theory side sets expectations low and specific. Since MaxCut is NP-hard, nobody credible expects exponential quantum speed-ups for its worst case — the realistic ceiling is a polynomial improvement, Grover-like quadratic factors, or a better exponent inside a still-exponential runtime. The fixed-depth results from earlier in this lesson close off the cheapest routes: constant-p QAOA is a local algorithm, and for its known guarantees classical counterparts exist that match or beat them. Noise results close another: on uncorrected hardware, depth large enough to be interesting is depth large enough for the output to be classically approximable. What remains open — genuinely open, not politely open — is whether growing-depth QAOA on fault-tolerant hardware beats the best classical heuristics on some family of instances.',
          'The best current evidence that it might: a 2024 study (Shaydulin and collaborators, in Science Advances) of QAOA on the low-autocorrelation-binary-sequences problem, a small-but-vicious optimisation task where the best classical heuristics are themselves exponential. Extrapolating from exact simulation at modest sizes, QAOA\'s time-to-solution appeared to scale with a smaller exponent than the classical state of the art, with amplitude amplification layered on top. Take the result at exactly its own valuation: evidence of a scaling advantage on one engineered family, produced largely in simulation, with a crossover point that requires error-corrected machines that do not exist. It is the most serious positive data point the field has — and it is not a demonstration, and its authors do not claim otherwise.',
          'And hanging over any polynomial speed-up is an economics theorem of sorts: error correction itself costs a large constant and polylogarithmic factor — slow logical clock speeds, thousandfold qubit overhead. Careful analyses (Babbush and co-authors, 2021) conclude that a bare quadratic speed-up, run on realistic fault-tolerant hardware, would need absurd runtimes before overtaking a classical computer that starts executing immediately at gigahertz rates. For quantum optimisation to matter in practice, the speed-up must be well beyond quadratic on instances people care about — a conjunction nobody has exhibited. When you read a "quantum optimisation breakthrough" headline, the checklist from the QML lesson transfers whole: what baseline, what scale, what was tuned, and who checked the classical side as hard as the quantum one.',
        ],
      },
      {
        kind: 'prose',
        title: 'Where it genuinely might matter',
        paragraphs: [
          'After all that, why does this lesson exist? Because QAOA earns its place on grounds that survive the honesty audit. It is the cleanest laboratory the field has for the central open question — can any variational circuit be simultaneously trainable, classically hard to simulate, and useful? Its problem-dictated ansatz, tiny parameter count and parameter concentration make it the variational algorithm where theory can actually get traction, and most of the sharpest results about variational circuits, positive and negative, were proved on it first. Its measurement outcomes are self-certifying — every shot is a candidate solution you can score classically — which removes the estimator-trust problems that plague VQE. And it is a natural benchmark workload: a QAOA layer exercises entangling gates across a whole graph at once, and doing that well is exactly what near-term machines need to demonstrate.',
          'If a practical advantage ever arrives, the shape it would most plausibly take is narrow: fault-tolerant machines, problem families where classical heuristics scale badly and the quantum exponent is provably or empirically better by more than a whisker — the LABS pattern, found on a problem with real stakes — or optimisation subroutines inside quantum workflows, where the data is already quantum and the classical alternative starts from a disadvantage. What the evidence does not support is the version in the pitch decks: near-term devices optimising portfolios and delivery routes better than classical software. Classical optimisation is a half-century-old discipline in ruthless form, it is improving faster than quantum hardware is, and it sets a bar that respect for the problem requires stating plainly: as of 2026, quantum optimisation has never cleared it. You now know precisely what would have to change for that sentence to expire — depth past the locality obstructions, error correction past the noise results, and an exponent gap big enough to survive the overhead. That is not nothing. It is also not yet anything.',
        ],
      },
      {
        kind: 'keypoints',
        points: [
          'MaxCut encodes as a diagonal Hamiltonian C = Σ(1 − Z_iZ_j)/2 whose basis states are cuts — the answer is a classical bit string, so quantum mechanics can only help with the search.',
          'QAOA alternates cost layers e^{−iγC} (write cut quality into phases) with mixer layers e^{−iβΣX} (turn phases into interference), p times, with 2p classically optimised angles.',
          'p → ∞ recovers adiabatic evolution and the exact optimum — a guarantee with no rate, worth no more than exhaustive search until one is attached.',
          'Fixed p makes QAOA a local algorithm: provable obstructions show constant-depth QAOA matched or beaten by classical algorithms, so p must grow — and NISQ noise caps p at single digits and makes deep noisy circuits classically approximable.',
          'Every shot is a self-certifying candidate solution, parameters concentrate across instances, and 2p parameters dodge the worst of the barren-plateau problem at shallow depth.',
          'As of 2026 no quantum optimisation advantage has been demonstrated on any practical problem; the best evidence is a simulated scaling-exponent study on one engineered family (LABS), and quadratic-ish speed-ups are unlikely to survive error-correction overheads.',
        ],
      },
      {
        kind: 'quiz',
        questions: [
          {
            id: 'q1',
            prompt: 'In QAOA\'s MaxCut encoding, what is the state that solves the problem?',
            options: [
              { id: 'a', text: 'A highly entangled superposition that only a quantum computer can represent' },
              { id: 'b', text: 'A computational basis state — a classical bit string assigning each vertex a side, which happens to be an extreme eigenstate of the diagonal Hamiltonian C' },
              { id: 'c', text: 'The uniform superposition |+⟩^⊗n, since it contains every cut at once' },
              { id: 'd', text: 'The ground state of the mixer B = ΣX_i' },
            ],
            correctId: 'b',
            explanation:
              'C is diagonal, so its eigenstates are plain bit strings and the optimal cut is one of them — an answer you could write on paper, evaluate instantly, and verify with no quantum hardware at all. This is the deepest structural difference from VQE, where the sought ground state is generically entangled and hard even to represent classically. It also frames the only honest role for the quantum device in optimisation: not representing solutions, but biasing which one a measurement samples. Option C repeats the all-possibilities-at-once misconception — measuring the uniform superposition is uniform random guessing, as the first inline check of this lesson had you work out.',
          },
          {
            id: 'q2',
            prompt: 'Why does running QAOA at a FIXED depth p, however well-tuned, face proven limits against classical algorithms?',
            options: [
              { id: 'a', text: 'Because the 2p parameters are too few to express any interesting state' },
              { id: 'b', text: 'Because at depth p each qubit\'s outcome depends only on the graph within p steps of it — fixed-p QAOA is a local algorithm, and classical local algorithms have been shown to match or beat its known guarantees' },
              { id: 'c', text: 'Because the adiabatic theorem only applies when p is infinite' },
              { id: 'd', text: 'Because fixed-depth circuits cannot generate entanglement' },
            ],
            correctId: 'b',
            explanation:
              'Information propagates at most one edge per interaction round, so p rounds give each qubit a radius-p view of the graph and no more — structure larger than that horizon, like a long odd cycle, is invisible. That makes constant-p QAOA a local algorithm, a class about which classical computer science knows a great deal: Bravyi–Gosset–König–Temme-style obstructions and Hastings\' classical local algorithms show its fixed-depth guarantees matched or beaten classically. This is why any honest hope for QAOA requires p to grow with the instance — which is exactly what NISQ depth budgets and the noise-approximability results forbid on uncorrected hardware. Options A and D are simply false (2p parameters suffice for the states in question, and even p = 1 entangles across every edge).',
          },
          {
            id: 'q3',
            prompt: 'What is the honest status of quantum advantage in combinatorial optimisation, as of 2026?',
            options: [
              { id: 'a', text: 'Demonstrated: quantum devices beat classical solvers on logistics and finance problems in production' },
              { id: 'b', text: 'Ruled out: fixed-depth obstructions prove no quantum optimisation advantage can ever exist' },
              { id: 'c', text: 'Unproven: no demonstration exists on any practical problem; the strongest evidence is a largely simulated scaling-exponent study on one engineered family, with the crossover requiring fault-tolerant hardware' },
              { id: 'd', text: 'Proven in theory for MaxCut, pending only engineering' },
            ],
            correctId: 'c',
            explanation:
              'Both wrong options overreach in opposite directions, and the field\'s literature supports neither. The fixed-p obstructions bound constant-depth QAOA, not quantum optimisation as such, so nothing is ruled out (option B); and every hardware result to date runs at classically reproducible scale against baselines that a tuned classical solver beats, so nothing is demonstrated (option A). The LABS scaling study is genuine evidence of a possible exponent advantage and states its own caveats: simulation-extrapolated, one problem family, fault tolerance assumed. Add the overhead economics — a quadratic-ish speed-up is unlikely to survive error correction\'s constant factors — and "unproven, with a narrow plausible path" is the precise summary. Anyone selling more is selling something.',
          },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────
  // 7. Post-Quantum Cryptography
  // ─────────────────────────────────────────────────────────────────────
  {
    slug: 'post-quantum-cryptography',

    blocks: [
      {
        kind: 'prose',
        title: 'Why "post-quantum" means classical',
        paragraphs: [
          'The name misleads almost everyone on first contact. Post-quantum cryptography is not cryptography that runs on a quantum computer, and it is not QKD. It is ordinary software — classical algorithms, running on the laptop and phone you already own — chosen because the mathematical problem underneath them has no known efficient quantum attack. The previous lesson ended by naming it as the practical answer to the quantum threat. This lesson is about what that answer actually is, what it costs, why the migration has already started, and why it is the part of this course most likely to show up in a job description.',
          'Start with the threat, stated precisely. Shor\'s algorithm finds periods, and every public-key system deployed at scale today — RSA, Diffie–Hellman, and elliptic-curve schemes like ECDH and Ed25519 — reduces to a period-finding problem. A cryptographically relevant quantum computer breaks all of them, completely, not gradually. That covers the key exchange in every TLS connection, the signature on every certificate and software update, and the identity behind every SSH login. It does not cover symmetric cryptography: AES and SHA-2 face only Grover\'s quadratic speed-up, which turns 128-bit security into roughly 64-bit-equivalent effort and is answered by moving to AES-256. The public-key layer is the emergency; the symmetric layer is a parameter change.',
          'Now the part that makes this urgent rather than academic. Encrypted traffic can be recorded today and decrypted later, once a machine exists — "harvest now, decrypt later." Anything whose confidentiality must outlast the arrival of that machine is already exposed, on the day it is sent, regardless of how far away the machine is. Michele Mosca put this as an inequality: let X be how long your data must stay secret, Y how long your migration takes, and Z how long until a cryptographically relevant quantum computer exists. If X + Y > Z, you are already late. Nobody knows Z. But medical records, state secrets, and long-lived industrial designs have X measured in decades, and Y for a large organisation is routinely five to ten years, so for a great deal of real data the inequality holds for any Z under about thirty years — which is why governments started the migration before anyone had built the machine.',
        ],
      },
      {
        kind: 'inline-check',
        id: 'c1',
        question:
          'A cryptographically relevant quantum computer switches on tomorrow. Predict which one of these it does NOT break outright.',
        options: [
          { id: 'a', text: 'RSA-2048, used to sign a software update' },
          { id: 'b', text: 'ECDH on curve P-256, used for the key exchange in a TLS handshake' },
          { id: 'c', text: 'AES-256, used to encrypt the bytes of a file' },
          { id: 'd', text: 'Ed25519, used to authenticate an SSH login' },
        ],
        correctId: 'c',
        explanation:
          'RSA, ECDH and Ed25519 are all public-key schemes whose hardness is a period-finding problem in disguise — factoring, or the discrete logarithm in a group — and Shor\'s algorithm solves those outright. AES is symmetric: there is no algebraic structure for Shor to exploit, and the best quantum attack is Grover\'s unstructured search, which halves the effective key length. AES-256 under Grover is roughly as strong as AES-128 is today, which is still far out of reach. So the migration is almost entirely about replacing the public-key layer; the symmetric layer just needs bigger keys, and mostly already has them.',
      },
      {
        kind: 'prose',
        title: 'Hard problems with no Shor',
        paragraphs: [
          'Shor works because factoring and discrete logarithms hide a periodic structure that the quantum Fourier transform reads off in one shot. The post-quantum programme is a search for hard problems with no such structure — and, crucially, for several of them at once, resting on different mathematics, so that a break in one does not take down everything.',
          'The family that won the most is lattices. The Learning With Errors problem, introduced by Oded Regev in 2005, is disarmingly simple to state. You are given a system of linear equations modulo some q — but every right-hand side has a small random error added. Without the errors, Gaussian elimination solves it in a moment. With them, elimination amplifies the noise until it swamps the answer, and the best known algorithms, classical and quantum alike, need time exponential in the dimension. In lattice language you are looking for the closest lattice point to a target, in hundreds of dimensions, and nobody knows how to do it fast. ML-KEM (from CRYSTALS-Kyber) and ML-DSA (from CRYSTALS-Dilithium) are built on a structured variant, module-LWE, chosen to make keys smaller and arithmetic faster while keeping the hardness argument.',
          'Why lattices resist Shor is worth stating carefully, because the honest answer is not "proven." The relevant hidden-subgroup problem for lattices is over the dihedral group, which is non-abelian, and the Fourier-sampling trick that solves the abelian case does not go through. Kuperberg\'s algorithm gives a subexponential quantum attack on the dihedral problem, but it is far too weak against the parameters actually used. In April 2024 a paper claimed a genuine quantum attack on LWE; within about ten days other researchers found a bug, and the author retracted the claim. That episode is the correct summary of the state of knowledge: intense scrutiny, no break, and no proof that a break is impossible.',
          'Two other families made the cut, and their differences are the point. Hash-based signatures — SLH-DSA, from SPHINCS+ — rest on nothing but the security of a hash function, an assumption cryptographers have been leaning on since the 1970s; the price is signatures of several kilobytes. Code-based schemes go back to McEliece in 1978, and in 2025 NIST selected HQC as a backup key-encapsulation standard precisely because its hardness comes from decoding random error-correcting codes rather than from lattices. If module-LWE fell tomorrow, HQC and SLH-DSA would still stand.',
        ],
      },
      {
        kind: 'callout',
        tone: 'warning',
        title: '"Post-quantum" is a claim about known attacks, not a proof',
        body: 'Two of the schemes in NIST\'s final rounds were broken during the competition — by classical computers, not quantum ones. Rainbow, a multivariate signature scheme, fell in February 2022 to an attack that ran over a weekend on a laptop. SIKE, an isogeny-based key exchange that had survived five years of scrutiny, fell in July 2022 to an attack that recovered the key in about an hour on a single core. Neither break used any quantum idea at all. This is why NIST standardised several unrelated families, why HQC was added as a backup to ML-KEM, and why every serious deployment today is hybrid: the new scheme combined with X25519, so that a break in either one alone leaves the connection secure. The engineering word for building systems that can swap an algorithm without a redesign is crypto-agility, and it is the single most transferable lesson from the whole migration.',
      },
      {
        kind: 'prose',
        title: 'The standards, and what they cost',
        paragraphs: [
          'NIST published the first three standards on 13 August 2024. FIPS 203 is ML-KEM, a key-encapsulation mechanism — the replacement for ECDH in the handshake. FIPS 204 is ML-DSA, a lattice signature scheme — the replacement for RSA and ECDSA in certificates, code signing and authentication. FIPS 205 is SLH-DSA, the hash-based signature, recommended where conservatism outweighs size: firmware, root certificates, anything that cannot be updated if a lattice assumption fails. FN-DSA (from Falcon) is being standardised as FIPS 206 (draft), with smaller signatures at the cost of an implementation that is notoriously hard to get right.',
          'The cost is bytes. An X25519 public key is 32 bytes; an ML-KEM-768 public key is 1,184 bytes and its ciphertext 1,088. An Ed25519 signature is 64 bytes; an ML-DSA-65 signature is 3,309, and SLH-DSA signatures run from about 8 kilobytes to nearly 50 depending on the parameter set. Key exchange has absorbed this easily — a TLS handshake grew by roughly a kilobyte in each direction (about 2.3 KB total) and nobody noticed. Signatures are the hard part, because a certificate chain carries several of them and some network paths still fragment or drop packets above a few kilobytes. That asymmetry is why the migration has happened in two clearly separated waves.',
          'The first wave is done. Chrome enabled hybrid post-quantum key exchange by default in 2024, first as X25519Kyber768 and then, once the standard was final, as X25519MLKEM768; Firefox, Safari, Cloudflare, and the major cloud providers followed, and by late 2024 Cloudflare reported that more than a third of its human-initiated traffic was already using it. If you open your browser\'s security panel on a major site today there is a good chance the key exchange listed is post-quantum. Nothing about the page changed. That invisibility is the migration working as designed.',
          'The second wave — signatures, certificates, and the public-key infrastructure that binds identities to keys — is where the field is now, and it is slower for reasons that have nothing to do with mathematics. Every certificate authority, every hardware security module, every embedded device with a burned-in root of trust has to change, in an order that keeps everything verifiable at every step. Estimates for that put it years out, which is exactly what makes Mosca\'s Y large.',
        ],
      },
      {
        kind: 'code',
        language: 'python',
        code: `"""Learning With Errors, at toy scale: why a little noise breaks elimination."""
import random
from itertools import product

q, n, m = 31, 4, 8          # modulus, secret length, number of equations
secret = [random.randrange(q) for _ in range(n)]
A = [[random.randrange(q) for _ in range(n)] for _ in range(m)]
errors = [random.choice((-1, 0, 1)) for _ in range(m)]   # the "E" in LWE

# Public: A and b = A·s + e (mod q).  Secret: s.  Nobody publishes e.
b = [(sum(a * s for a, s in zip(row, secret)) + e) % q for row, e in zip(A, errors)]


def consistent(candidate):
    """Does this candidate secret explain every equation to within ±1?"""
    for row, target in zip(A, b):
        residue = (target - sum(a * c for a, c in zip(row, candidate))) % q
        if residue not in (0, 1, q - 1):
            return False
    return True


# Brute force over every possible secret: q**n candidates.
matches = [c for c in product(range(q), repeat=n) if consistent(c)]
print(f"searched {q**n:,} candidates, {len(matches)} consistent")
print("recovered secret:", matches[0] == tuple(secret))

# The noise is what kills Gaussian elimination — it turns exact equations into
# "almost" equations, and eliminating variables multiplies the errors together
# until they are as big as q. Brute force still works here because q**n is
# under a million. ML-KEM-768 uses a module of dimension 3 x 256 over q = 3329:
# the candidate space is ~5**768 candidate secrets (coefficients in -2..2), and — unlike factoring — there is no
# period hiding in it for a quantum Fourier transform to read.`,
        caption:
          'A four-variable LWE instance is solvable by brute force in about a second; each extra variable multiplies the work by q. Real parameters put the search space at hundreds of dimensions, and the added noise is exactly what stops linear algebra from short-cutting it.',
      },
      {
        kind: 'embed',
        href: '/visualizations/shor',
        title: 'Shor\'s Algorithm',
        blurb:
          'Watch the period of a modular exponential appear as a phase ramp, and the quantum Fourier transform read it off. That readable periodicity is precisely the structure RSA and elliptic curves have and lattices do not — which is the whole reason the migration is to lattices and not to bigger RSA keys.',
      },
      {
        kind: 'inline-check',
        id: 'c2',
        question:
          'A hospital must keep patient records confidential for 25 years. Its IT department estimates a full migration of its systems would take 7 years. The most optimistic serious forecast puts a cryptographically relevant quantum computer 15 years away. Apply Mosca\'s inequality: is the hospital already late?',
        options: [
          { id: 'a', text: 'No — 15 years is a comfortable margin over a 7-year migration' },
          { id: 'b', text: 'Yes — records encrypted today must stay secret until 25 years from now, and a machine 15 years out reads them; X + Y = 32 > Z = 15' },
          { id: 'c', text: 'No — the records are protected by AES, which Shor does not break' },
          { id: 'd', text: 'Only if the quantum computer arrives before the migration finishes, i.e. within 7 years' },
        ],
        correctId: 'b',
        explanation:
          'The trap is measuring from the end of the migration instead of from the day the data is sent. A record transmitted today under RSA or ECDH key exchange can be recorded today and decrypted the day a machine exists — 15 years from now, well inside its 25-year confidentiality window. The migration only protects data sent after it completes, seven years from now, and even that data has 18 years of exposure left. Option C is half right in an instructive way: the file itself may be under AES, but the key that encrypts it was exchanged with a public-key scheme, and breaking that exchange recovers the AES key. This arithmetic, applied to national-security data with X measured in decades, is why the migration started before anyone had built the machine.',
      },
      {
        kind: 'prose',
        title: 'Migration, honestly',
        paragraphs: [
          'The United States set the pace. National Security Memorandum 10, in 2022, set 2035 as the target for federal systems, and the NSA\'s CNSA 2.0 suite gives national-security systems staged deadlines: software and firmware signing moves first, with exclusive use of post-quantum algorithms by 2030; networking equipment follows, with exclusive use required by 2030; browsers, servers, cloud services and operating systems by 2033; and legacy and custom systems have until 2033 to be replaced or updated. The European Union published a coordinated roadmap in 2025 asking member states to begin by the end of 2026 and to have high-risk systems migrated by 2030. None of these are forecasts of when the machine arrives. They are risk-management decisions made under uncertainty, which is the only kind available.',
          'What the machine itself looks like is a moving estimate, and the direction of movement matters. In 2019 the best analysis put breaking RSA-2048 at around twenty million noisy physical qubits running for eight hours. In 2025 Craig Gidney revised that to under one million noisy qubits running for less than a week, by combining better error-correcting codes with more careful arithmetic. Today\'s largest machines have on the order of a thousand physical qubits, with error rates that are still too high for that construction to work. So the honest reading is: no such machine exists as of 2026, no one can say when one will, and the required resources have dropped by more than an order of magnitude in six years. Planning on the old number would have been a mistake.',
          'In practice a migration is an inventory before it is anything else. Most organisations do not know where their cryptography is — which libraries, which protocols, which hard-coded certificates in which devices — and a cryptographic bill of materials is the first deliverable in every published migration plan. Then comes the hybrid rollout: new key exchange alongside the old, so nothing is lost if either fails. Then signatures and PKI, slowest of all. And throughout, crypto-agility, so that the next transition — and there will be one, because SIKE and Rainbow taught that "post-quantum" is a status, not a guarantee — does not require doing all of this again.',
          'The reason this lesson exists in a course about qubits is that the demand for people who understand both halves is real and unmet. The physics side explains exactly what is threatened and why; the cryptography side explains what replaces it and what the replacement costs. Most job postings for the migration ask for the second and get candidates who cannot explain the first. Having followed Shor\'s algorithm through a period-finding circuit two lessons ago, and understood here why lattices have no period to find, you can.',
        ],
      },
      {
        kind: 'keypoints',
        points: [
          'Post-quantum cryptography is classical software chosen for problems with no known efficient quantum attack — not QKD, not anything that runs on a quantum computer.',
          'Shor breaks every deployed public-key scheme (RSA, DH, elliptic curves) outright; symmetric ciphers and hashes face only Grover\'s quadratic speed-up and are fixed by larger keys.',
          '"Harvest now, decrypt later" makes the threat present-tense: if data lifetime plus migration time exceeds the time to a quantum computer, the data is already exposed (Mosca\'s inequality).',
          'ML-KEM and ML-DSA rest on module-LWE — noisy linear equations that elimination cannot solve and that hide no period for a QFT to read; SLH-DSA (hash-based) and HQC (code-based) rest on different mathematics as a hedge.',
          'NIST standardised ML-KEM, ML-DSA and SLH-DSA on 13 August 2024; keys and signatures are tens of times larger, which is why key exchange migrated in a year and signatures will take several.',
          'Two candidates were broken classically during the competition, which is why deployments are hybrid and why crypto-agility is the lasting lesson.',
          'US federal targets are 2030–2035 and the EU\'s 2030 for high-risk systems; resource estimates for breaking RSA-2048 fell from ~20 million qubits (2019) to under 1 million (2025), with no such machine existing yet.',
        ],
      },
      {
        kind: 'quiz',
        questions: [
          {
            id: 'q1',
            prompt: 'What is post-quantum cryptography?',
            options: [
              { id: 'a', text: 'Cryptography that runs on a quantum computer to resist quantum attacks' },
              { id: 'b', text: 'Quantum key distribution protocols such as BB84 and E91' },
              { id: 'c', text: 'Classical algorithms, run on ordinary hardware, built on problems with no known efficient quantum attack' },
              { id: 'd', text: 'Symmetric ciphers such as AES-256 that Grover\'s algorithm cannot break' },
            ],
            correctId: 'c',
            explanation:
              'The name refers to the era, not the machine. ML-KEM, ML-DSA and SLH-DSA are software that runs in your browser today; they replace RSA and elliptic curves because their underlying problems — module-LWE and hash-function security — have no known quantum shortcut. Option A confuses PQC with quantum computation; option B is the previous lesson\'s topic, a physically secured key-distribution method that needs dedicated optical links and still relies on classical authentication; option D names the one part of cryptography that mostly did not need replacing, since Grover only halves symmetric security.',
          },
          {
            id: 'q2',
            prompt: 'Why did key exchange migrate to post-quantum algorithms in about a year, while signatures and certificates are expected to take several?',
            options: [
              { id: 'a', text: 'Because ML-DSA has not yet been standardised' },
              { id: 'b', text: 'Because a handshake carries one key-exchange message but a certificate chain carries several signatures, each tens of times larger than before, and the PKI that issues certificates must change in a verifiable order' },
              { id: 'c', text: 'Because signatures are not threatened by Shor\'s algorithm and can wait' },
              { id: 'd', text: 'Because browsers control key exchange but governments control signatures' },
            ],
            correctId: 'b',
            explanation:
              'The mathematics is equally ready for both — FIPS 203 and 204 were published on the same day. The difference is bytes and coordination. ML-KEM added roughly a kilobyte in each direction (about 2.3 KB total) to a handshake, which two browser vendors and one CDN could switch on unilaterally and did. An ML-DSA signature is over three kilobytes, a chain has several, some network paths fragment above a few kilobytes, and every certificate authority, hardware security module and embedded root of trust has to change while everything stays verifiable at each step. Option C is backwards: Shor breaks RSA and ECDSA signatures completely, which is exactly why forged updates and certificates are the more frightening long-term risk.',
          },
          {
            id: 'q3',
            prompt: 'Rainbow (a finalist) and SIKE (an alternate candidate) were both broken in 2022. What is the correct lesson to draw?',
            options: [
              { id: 'a', text: 'Quantum computers are further along than publicly known' },
              { id: 'b', text: 'Lattice-based schemes are therefore also likely to fall soon' },
              { id: 'c', text: '"Post-quantum" describes the absence of known attacks, not a proof of security — so deploy in hybrid mode, standardise several unrelated families, and build systems that can swap algorithms' },
              { id: 'd', text: 'Only hash-based signatures should ever be used' },
            ],
            correctId: 'c',
            explanation:
              'Both breaks were classical — a laptop over a weekend for Rainbow, about an hour on one core for SIKE — so option A is simply false, and they say nothing specific about lattices (option B), which rest on entirely different mathematics and have survived far more scrutiny, including a widely publicised 2024 claimed quantum attack that was retracted within days. The breaks do show that security is a status that can change, which is why NIST added HQC as a code-based backup, why every production deployment combines ML-KEM with X25519, and why crypto-agility is the design principle that outlives any particular algorithm. Option D overcorrects: SLH-DSA is the conservative choice for roots of trust precisely because its signatures are too large for general use.',
          },
        ],
      },
    ],
  },
]
