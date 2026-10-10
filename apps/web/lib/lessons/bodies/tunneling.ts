/**
 * Body of the Quantum Tunneling lesson (foundations track, free).
 *
 * BODY ONLY. Metadata (title, level, minutes, objectives, track membership)
 * lives in `lib/lessons/index.ts`; this module holds the prose, code, callouts
 * and quiz questions, and is reachable only through `lib/lessons/server.ts`.
 * Importing it from a client component puts 16,449 bytes of lesson text
 * (measured as JSON, unminified) back into the browser bundle — the exact
 * defect the metadata/body split closed. `lib/lessons/bundle.test.ts` walks the
 * import graph from every 'use client' module and fails if that happens.
 *
 */

import type { LessonBody } from '../types'

export const TUNNELING_BODY: LessonBody = {
  slug: 'tunneling',

  blocks: [
    {
      kind: 'prose',
      title: 'The classical impossibility',
      paragraphs: [
        'Roll a ball up a hill. Kinetic energy converts into potential energy as it climbs, and energy conservation holds the whole way: ½mv² + V(x) = E, where E is the total energy it started with and never changes. Solve for the speed and you get v(x) = √(2(E − V(x))/m).',
        'Now let the hill be taller than the ball can manage. At the height where V(x) = E the speed is exactly zero. That point is called the turning point, and it is a wall in the most literal sense the theory allows: beyond it V(x) > E, so E − V(x) is negative, and v(x) would be the square root of a negative number. There is no such speed. The ball stops dead at the turning point, reverses, and rolls back. The region beyond is not merely hard to reach — it is classically forbidden, and the probability of ever finding the ball there is exactly zero, not approximately zero.',
        'This is worth stating carefully, because it is the precise claim quantum mechanics is about to violate, and it has nothing to do with friction or with the ball being too slow. It is two lines of algebra applied to energy conservation: anything with a definite position and a definite momentum is barred from every region where V exceeds E.',
        'Pose the same problem as a rectangular barrier — height V₀, width w, a particle of energy E < V₀ arriving from the left — and the classical answer is stark. Reflection: 100%. Transmission: 0%, for every width, for every height above E, forever. Hold onto that number, because the experiment gives something else.',
      ],
    },
    {
      kind: 'inline-check',
      id: 'c1',
      question:
        'Quantum mechanics replaces the trajectory with a wavefunction ψ(x), and inside the barrier — where E < V — the Schrödinger equation reads d²ψ/dx² = (2m/ħ²)(V − E)ψ, with a coefficient that is now positive. What do its solutions look like in there?',
      options: [
        { id: 'a', text: 'Oscillations with a shorter wavelength — the wave speeds up inside' },
        { id: 'b', text: 'Exactly zero — the wavefunction cannot enter a classically forbidden region' },
        { id: 'c', text: 'Real exponentials — the wave stops oscillating and decays smoothly through' },
        { id: 'd', text: 'Oscillations at an imaginary frequency, which cancel to nothing observable' },
      ],
      correctId: 'c',
      explanation:
        'A positive coefficient means the curvature has the same sign as ψ itself: the curve bends away from the axis, so it can never turn around and cross zero — it cannot oscillate. The solutions are e^{+κx} and e^{−κx}; for a barrier of finite width both are present, but for a thick barrier (κw ≫ 1) the decaying one dominates, and ψ shrinks smoothly across the barrier without ever reaching zero. Option B is the classical answer in quantum clothing: nothing in the equation lets ψ drop to zero at the turning point, and continuity actively forbids it, as the section below shows.',
    },
    {
      kind: 'prose',
      title: 'The wave does not stop at the wall',
      paragraphs: [
        'Quantum mechanics does not give the particle a position and a momentum. It gives it a wavefunction ψ(x) obeying the time-independent Schrödinger equation, −(ħ²/2m)·d²ψ/dx² + V(x)ψ = Eψ. Rearrange it to put the curvature on the left, where the physics is visible: d²ψ/dx² = (2m/ħ²)·(V(x) − E)·ψ.',
        'Read that as an instruction about shape. The bending at each point is proportional to ψ itself, with a coefficient whose sign is the sign of V − E, and that one sign is the pivot on which the whole lesson turns. Outside the barrier, where E > V, the coefficient is negative: d²ψ/dx² = −k²ψ, with k = √(2m(E − V))/ħ. A function whose curvature always points back toward the axis is one that oscillates — sines, cosines, e^{ikx}. That is the free particle you already know, a travelling wave of wavelength 2π/k.',
        'Inside the barrier, where E < V, the coefficient flips sign: d²ψ/dx² = +κ²ψ, with κ = √(2m(V − E))/ħ. Now the curvature points away from the axis — wherever ψ is positive it bends upward, wherever negative it bends downward — so the curve can never turn around and cross zero. The solutions are no longer oscillations but real exponentials, e^{+κx} and e^{−κx}. For a barrier of finite width the general solution inside is a mix of both — the growing term is needed to match the wave on the far side — but for a thick barrier (κw ≫ 1) the decaying one dominates, and what you see inside the forbidden region is essentially e^{−κx}: a wave that does not oscillate and does not vanish, but dies away smoothly.',
        'Nothing permits ψ to fall off a cliff at the turning point. ψ and its first derivative must be continuous, because the equation contains a second derivative and a kink would make the curvature infinite. So whatever amplitude the incoming wave has at the barrier face is matched there by the decaying solution, which then carries a shrinking but nonzero amplitude across the entire width.',
        'Then the barrier ends. At the far face the exponential has been cut to a fraction e^{−κw} of its starting value, but it is still a nonzero amplitude, and continuity applies there too. Beyond it V drops back down, E > V again, and the solution resumes being an oscillating travelling wave — small, but real, and moving away to the right. By the Born rule, |ψ|² out there is a genuine probability density, so there is a computable chance of detecting the particle past a wall it could never have climbed. That is tunnelling, and it is not an approximation or an edge case. It is what the equation says.',
      ],
    },
    {
      kind: 'inline-check',
      id: 'c2',
      question:
        'A particle with energy E tunnels through a barrier of height V₀ > E and is detected on the far side. You measure its energy there. What do you find?',
      options: [
        { id: 'a', text: 'Exactly E — the same energy it arrived with' },
        { id: 'b', text: 'A little more than V₀ — it must have topped the barrier at some point, however briefly' },
        { id: 'c', text: 'E minus whatever the barrier absorbed on the way through' },
        { id: 'd', text: 'E on average, with fluctuations of order ħ/Δt around it' },
      ],
      correctId: 'a',
      explanation:
        'Exactly E, every time. The whole calculation runs at one fixed energy — that is what "time-independent Schrödinger equation" means — and the transmitted wave oscillates with the same wavelength, hence the same kinetic energy, as the incident one. Options B and D are versions of the "borrows energy via ΔEΔt" story, the most persistent misconception about tunnelling; the callout below is written to kill it. The particle never goes over the top, so there is nothing to borrow for.',
    },
    {
      kind: 'callout',
      tone: 'insight',
      title: 'Nothing is borrowed. Energy is conserved throughout.',
      body: 'The most persistent story about tunnelling is that the particle briefly "borrows" energy via ΔEΔt ≳ ħ/2, hops the wall while nobody is looking, and pays it back. That picture is wrong and worth killing outright. The transmitted particle emerges with exactly the energy it arrived with — measure it and you find E, never E plus something, and the whole calculation above runs at one fixed E, which is what "time-independent" means. What changes across the barrier is not the energy but the character of the solution: oscillatory outside, exponentially decaying inside. The instinct that the particle "must have had more energy in there" comes from insisting it has a definite kinetic energy at each point, which is exactly the classical assumption tunnelling refutes. Inside the barrier ψ has no oscillation, hence no local wavelength and no local momentum to assign. There is no trajectory, so there is nothing to conserve badly.',
    },
    {
      kind: 'inline-check',
      id: 'c3',
      question:
        'A barrier transmits electrons with probability about 10⁻⁴. Keeping the height and the electron energy fixed, you double the barrier’s width. Predict the new transmission.',
      options: [
        { id: 'a', text: 'About 5 × 10⁻⁵ — twice the barrier, half the transmission' },
        { id: 'b', text: 'About 2.5 × 10⁻⁵ — transmission falls as 1/w²' },
        { id: 'c', text: 'About 10⁻⁸ — doubling the width squares the transmission' },
        { id: 'd', text: 'Exactly zero — beyond some thickness, tunnelling stops entirely' },
      ],
      correctId: 'c',
      explanation:
        'Transmission is dominated by e^{−2κw}: doubling w doubles the exponent, and doubling an exponent squares the number, so 10⁻⁴ becomes about 10⁻⁸ — ten thousand times more opaque, not twice. Options A and B are the two natural polynomial guesses, and the gulf between them and the truth is the entire character of tunnelling. Option D is wrong in principle (T is never exactly zero for finite width) but nearly right in practice. The code below runs the real numbers — watch what happens between the 0.5 nm and 1.0 nm lines.',
    },
    {
      kind: 'code',
      language: 'python',
      code: `import math

HBAR = 1.054571817e-34      # J·s
M_E  = 9.1093837015e-31     # kg
EV   = 1.602176634e-19      # J per eV

def kappa(V_eV, E_eV):
    """Decay constant inside the barrier: κ = √(2m(V − E)) / ħ, in m⁻¹."""
    return math.sqrt(2 * M_E * (V_eV - E_eV) * EV) / HBAR

def transmission(V_eV, E_eV, w_m):
    """T ≈ 16·(E/V)(1 − E/V)·e^(−2κw), valid when κw ≫ 1 (a thick barrier).

    Prefactor: falls out of matching ψ and ψ' at the two faces. At most 4
      (at E/V = 1/2), and it vanishes as E → 0 or E → V. A detail.
    Exponential: amplitude falls by e^(−κw) across the barrier, and
      probability is amplitude squared — hence the 2 in the exponent.
    """
    r = E_eV / V_eV
    return 16 * r * (1 - r) * math.exp(-2 * kappa(V_eV, E_eV) * w_m)

# A 1 eV electron meeting a 5 eV barrier — roughly an STM tip over a metal.
print(kappa(5.0, 1.0) / 1e9)           # 10.25 nm⁻¹ → decay length 1/κ ≈ 0.98 Å
print(transmission(5.0, 1.0, 0.5e-9))  # 9.08e-05  ← 0.5 nm gap
print(transmission(5.0, 1.0, 1.0e-9))  # 3.22e-09  ← 1.0 nm gap, 28,000× smaller

# Doubling the width did not halve T. It squared the suppression.`,
      caption:
        'Two factors with very different jobs: a polynomial prefactor never bigger than 4, and an exponential that decides everything. Note the decay length 1/κ ≈ 1 Å for a few-eV electron barrier — that is why tunnelling is an atomic-scale phenomenon and not an everyday one.',
    },
    {
      kind: 'embed',
      href: '/visualizations/tunneling',
      title: 'Tunneling Lab',
      blurb:
        'This integrates the time-dependent Schrödinger equation live on a 600-point grid, so you are watching a real wave packet hit a real barrier. Start with E = 2.0 below V₀ = 4.0 at width 20: the packet splits at the wall, about 2% getting through, and the faint Re ψ trace inside the amber region visibly stops oscillating and decays. Now widen the barrier. At width 40 transmission collapses to roughly 0.03%; at 80 it is one part in ten million. Watch the reflected packet as you do — it develops interference ripples where the returning wave overlaps the tail still arriving.',
    },
    {
      kind: 'prose',
      title: 'Exponential is the whole story',
      paragraphs: [
        'Look again at T ≈ 16(E/V)(1 − E/V)·e^{−2κw} and notice how lopsided it is. The prefactor is a polynomial ranging between 0 and 4. Everything that makes tunnelling behave the way it does lives in e^{−2κw}, and the intuition to build is that this term does not scale — it collapses.',
        'Take the electron from the code block: 1 eV against a 5 eV barrier, so κ ≈ 10.25 nm⁻¹. Across a 0.5 nm gap, 2κw ≈ 10.2 and T ≈ 9 × 10⁻⁵, about one electron in eleven thousand. Double the gap to 1.0 nm and the naive expectation is one in twenty-two thousand. The actual answer is 3 × 10⁻⁹ — one in three hundred million. Transmission fell by a factor of 28,000, not a factor of 2.',
        'The rule generalises: T ≈ e^{−2κw}, so T(2w) ≈ T(w)². Doubling the width squares the transmission. A barrier passing 10⁻⁴ becomes one passing 10⁻⁸ — not "twice as blocked" but ten thousand times as blocked. The same lever works on the other knobs, since κ grows as √(V − E) and as √m: raising the barrier, lowering the energy or using a heavier particle all feed the exponent.',
        'This is also why tunnelling is simultaneously invisible and indispensable. Put macroscopic numbers into κ — a gram, a joule, a centimetre — and the exponent lands around 10³⁰, making e^{−2κw} a number with no physical meaning at all. That is why you have never tunnelled through a door. Shrink w to a nanometre and V − E to a few electronvolts and 2κw sits between roughly 5 and 30: rare enough to be exotic, common enough that a nanoamp of tunnelling current is six billion electrons a second doing it.',
      ],
    },
    {
      kind: 'prose',
      title: 'This runs the world',
      paragraphs: [
        'That exponential sensitivity is the working principle of the scanning tunnelling microscope, built by Binnig and Rohrer at IBM Zurich in 1981 and awarded the Nobel Prize in 1986. A sharpened metal tip sits about half a nanometre above a conducting surface and the instrument measures the tunnelling current across the vacuum gap. Because that current drops by roughly a factor of eight per additional ångström, essentially all of it flows through the single atom at the very end of the tip. Scan across while holding the current constant by adjusting height, and the trace is a map of individual atoms — which is how the first atom-resolved images of silicon were made, and how IBM spelled its logo in 35 xenon atoms in 1989.',
        'The same effect is a liability in the device you are reading this on. A flash memory cell stores bits as electrons trapped on a floating gate behind a silicon-dioxide tunnel oxide typically under 10 nm thick, and writing and erasing work by deliberately driving electrons through it. But the barrier does not become impassable once you stop, so charge leaks back off continuously. Fresh cells hold their contents for years; every erase cycle damages the oxide, though, adding defect states that give electrons easier stepping stones through. That is why the JEDEC retention spec for a consumer SSD at the end of its rated endurance is only about a year at room temperature, and why an unpowered drive left in a drawer can genuinely forget.',
        'Tunnelling also settled a puzzle that predates the theory being taken seriously. An alpha particle inside a heavy nucleus is bound by the strong force but repelled by the Coulomb barrier outside, and measured alpha energies of a few MeV sit far below a barrier top of roughly 25–30 MeV for uranium — classically it can never leave. Gamow, and independently Gurney and Condon, showed in 1928 that it tunnels out, and that the exponential energy dependence explains the otherwise absurd spread of half-lives. Uranium-238 emits a 4.27 MeV alpha and lives 4.47 billion years; polonium-212 emits an 8.78 MeV alpha and lives 294 nanoseconds. A factor of two in energy, twenty-four orders of magnitude in lifetime — the Geiger–Nuttall law is e^{−2κw} on a log axis.',
        'And the same mechanism is why you are warm. The Sun fuses hydrogen at a core temperature near 15.7 million kelvin, which corresponds to k_BT ≈ 1.35 keV (a mean kinetic energy of about 2 keV). Two protons must close to within a couple of femtometres to fuse, where their Coulomb repulsion is several hundred keV — hundreds of times the energy available, out of reach even for the fast tail of the Maxwell–Boltzmann distribution. Classically, the Sun cannot burn. What happens instead is that protons in a narrow band around 5–6 keV, the Gamow peak where the falling supply of fast particles meets the rising tunnelling probability, tunnel through and fuse. The per-pair rate is fantastically small — which is exactly why the Sun has lasted 4.6 billion years instead of detonating — but there are enough protons to add up to 3.8 × 10²⁶ watts. Without tunnelling, no star of the Sun\'s mass could ignite hydrogen at all.',
      ],
    },
    {
      kind: 'keypoints',
      points: [
        'Classically a particle stops dead at the turning point where V(x) = E; transmission is exactly zero.',
        'd²ψ/dx² = (2m/ħ²)(V − E)ψ, so the sign of V − E decides the character of the solution: oscillation when E > V, real exponentials when E < V.',
        'Inside the barrier ψ ∝ e^{−κx} with κ = √(2m(V − E))/ħ — small but never zero, so a real amplitude survives to the far face and resumes travelling.',
        'No energy is borrowed: E is fixed throughout, and the transmitted particle emerges with exactly the energy it arrived with.',
        'In T ≈ 16(E/V)(1 − E/V)·e^{−2κw} the prefactor is at most 4; the exponential is the whole story.',
        'Doubling the barrier width squares the transmission — 10⁻⁴ becomes 10⁻⁸, not 5 × 10⁻⁵.',
        'Tunnelling is what STMs image with, what makes flash memory forget, how alpha particles escape nuclei, and how the Sun fuses hydrogen.',
      ],
    },
    {
      kind: 'quiz',
      questions: [
        {
          id: 'q1',
          prompt:
            'A barrier transmits electrons with probability 10⁻⁴. You double its width, holding the height and the electron energy fixed. What is the new transmission, approximately?',
          options: [
            { id: 'a', text: '5 × 10⁻⁵ — twice the barrier, half the transmission' },
            { id: 'b', text: '10⁻⁸ — doubling the width squares the transmission' },
            { id: 'c', text: '2.5 × 10⁻⁵ — transmission falls as the inverse square of the width' },
            { id: 'd', text: '0 — past a certain thickness, tunnelling stops entirely' },
          ],
          correctId: 'b',
          explanation:
            'T is dominated by e^{−2κw}, so doubling w doubles the exponent, which squares the number: 10⁻⁸. Options A and C are the two ways of assuming polynomial behaviour, and both understate the collapse by four orders of magnitude. Option D is wrong in principle but nearly right in practice — T is never exactly zero for any finite width, yet it shrinks so fast that a barrier a few nanometres thick is unobservably opaque. This one factor is why an STM resolves individual atoms and why a slightly thicker tunnel oxide buys years of data retention.',
        },
        {
          id: 'q2',
          prompt: 'A particle of energy E tunnels through a barrier of height V₀ > E. What is its energy when it emerges?',
          options: [
            { id: 'a', text: 'E — unchanged; energy is conserved throughout' },
            { id: 'b', text: 'Slightly more than V₀, since it briefly borrowed enough energy to clear the top' },
            { id: 'c', text: 'E − V₀, the energy left after paying the cost of the barrier' },
            { id: 'd', text: 'Somewhere between E and V₀, depending on the barrier width' },
          ],
          correctId: 'a',
          explanation:
            'The transmitted particle has exactly the energy it started with, and the whole calculation runs at a single fixed E — that is what the time-independent Schrödinger equation means. Option B is the borrowed-energy story, usually justified by waving at ΔEΔt ≳ ħ/2; it is the most common misconception about tunnelling and it is not what the theory says. The particle never goes over the top, so there is nothing to borrow for. Inside the barrier ψ is a real decaying exponential with no oscillation, hence no local wavelength and no local momentum, so "how much kinetic energy does it have in there?" has no answer to be embarrassed by.',
        },
        {
          id: 'q3',
          prompt: 'What is actually happening while the particle is inside the classically forbidden region?',
          options: [
            { id: 'a', text: 'The barrier has microscopic gaps, and the particle slips through wherever the wall is thin enough' },
            { id: 'b', text: 'The particle detours around the barrier through an extra spatial dimension' },
            { id: 'c', text: 'The wavefunction is nonzero inside, decaying as e^{−κx}, so a reduced but real amplitude reaches the far side' },
            { id: 'd', text: 'The particle briefly becomes a different kind of particle that the potential does not affect' },
          ],
          correctId: 'c',
          explanation:
            'Continuity of ψ and ψ′ forbids the wavefunction from dropping to zero at the barrier face, and for E < V the equation d²ψ/dx² = +κ²ψ has exponentials rather than oscillations as its solutions — so ψ decays through and arrives at the far face small but nonzero. Option A imagines a porous barrier; the derivation assumes a perfectly uniform solid one and tunnelling happens anyway. Option B is the "goes around it" picture, which this one-dimensional calculation neither describes nor needs. Option D invents new physics for something the ordinary Schrödinger equation already explains: tunnelling is the direct consequence of describing the particle as a wave instead of a trajectory.',
        },
      ],
    },
  ],
}
