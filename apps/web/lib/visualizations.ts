/**
 * lib/visualizations.ts — the canonical visualization catalogue.
 *
 * This array used to live in `components/ui/Hero.tsx`, which a dozen modules
 * imported for the data alone — and the offline fallback page could not,
 * because a precached client page should not pull in a landing-page component
 * just to list links. It kept its own copy instead, which drifted: the copy
 * froze at 8 entries while the real list grew to 11. Pure data in its own
 * module is importable from anywhere (server, client, the service-worker
 * fallback) with no component baggage, so there is exactly one list to drift.
 *
 * `components/ui/Hero.tsx` re-exports everything here, so existing
 * `from '@/components/ui/Hero'` imports keep working unchanged.
 */

export type VizAccent = 'violet' | 'teal' | 'amber' | 'rose' | 'sky'
export type VizLevel = 'Beginner' | 'Intermediate' | 'Advanced'

export type Visualization = {
  href: string
  icon: string
  title: string
  level: VizLevel
  accent: VizAccent
  hook: string
}

/**
 * The visualizations, ordered easiest → hardest.
 * Hues follow the fixed categorical order: violet → teal → sky → amber → rose.
 */
export const VISUALIZATIONS: readonly Visualization[] = [
  {
    href: '/visualizations/double-slit',
    icon: '🌊',
    title: 'The Double-Slit Experiment',
    level: 'Beginner',
    accent: 'violet',
    hook: 'Fire electrons one at a time and watch stripes appear that no particle should make.',
  },
  {
    href: '/visualizations/superposition',
    icon: '⚖️',
    title: 'Superposition & Measurement',
    level: 'Beginner',
    accent: 'teal',
    hook: 'Build a quantum state gate by gate, then find out what measuring it actually destroys.',
  },
  {
    href: '/visualizations/bloch-sphere',
    icon: '🔮',
    title: 'The Bloch Sphere',
    level: 'Beginner',
    accent: 'sky',
    hook: 'Every possible state of a single qubit, as one point on a globe you can spin.',
  },
  {
    href: '/visualizations/stern-gerlach',
    icon: '🧲',
    title: 'The Stern-Gerlach Experiment',
    level: 'Beginner',
    accent: 'amber',
    hook: 'Measure a beam sideways and it forgets which way was up — put it back through the first magnet and half of it comes out down.',
  },
  {
    href: '/visualizations/bound-states',
    icon: '📦',
    title: 'Particle in a Box',
    level: 'Beginner',
    accent: 'rose',
    hook: 'Trap a particle between two walls and only certain energies survive — then lower the walls and watch it leak out through them.',
  },
  {
    href: '/visualizations/photoelectric-effect',
    icon: '💡',
    title: 'The Photoelectric Effect',
    level: 'Beginner',
    accent: 'violet',
    hook: 'Turn the lamp up as far as you like. Below a certain colour, not one electron comes out.',
  },
  {
    href: '/visualizations/blackbody-spectrum',
    icon: '🔥',
    title: 'Blackbody Radiation',
    level: 'Beginner',
    accent: 'teal',
    hook: 'The classical curve does not overshoot slightly — it goes to infinity, and fixing that took quantising light itself.',
  },
  {
    href: '/visualizations/entanglement',
    icon: '🔗',
    title: 'Entanglement',
    level: 'Intermediate',
    accent: 'sky',
    hook: 'Two qubits whose answers always match — without either one carrying the answer.',
  },
  {
    href: '/visualizations/tunneling',
    icon: '🚀',
    title: 'Quantum Tunneling',
    level: 'Intermediate',
    accent: 'amber',
    hook: 'A particle without the energy to climb the wall, appearing on the other side anyway.',
  },
  {
    href: '/visualizations/grover',
    icon: '🔍',
    title: "Grover's Search",
    level: 'Intermediate',
    accent: 'rose',
    hook: 'Find one item in a million with a thousand guesses — by making the wrong answers cancel.',
  },
  {
    href: '/visualizations/decoherence',
    icon: '💨',
    title: 'Decoherence',
    level: 'Intermediate',
    accent: 'violet',
    hook: 'Watch a qubit forget — the arrow retracts into the sphere and takes the phase with it.',
  },
  {
    href: '/visualizations/bell-test',
    icon: '⛓️',
    title: 'The Bell Test',
    level: 'Intermediate',
    accent: 'teal',
    hook: 'Race a hidden-variable universe against a real one and watch it stall at exactly 2.',
  },
  {
    href: '/visualizations/teleportation',
    icon: '🌀',
    title: 'Quantum Teleportation',
    level: 'Intermediate',
    accent: 'sky',
    hook: 'A state crosses the room without the qubit — and still waits on two ordinary bits sent the slow way.',
  },
  {
    href: '/visualizations/superdense-coding',
    icon: '✉️',
    title: 'Superdense Coding',
    level: 'Intermediate',
    accent: 'amber',
    hook: 'Two classical bits down a single qubit. Take the entangled pair away and exactly one of them vanishes.',
  },
  {
    href: '/visualizations/harmonic-oscillator',
    icon: '🌀',
    title: 'The Quantum Harmonic Oscillator',
    level: 'Intermediate',
    accent: 'rose',
    hook: 'A ladder of evenly spaced rungs, and one packet that swings like a marble in a bowl without ever spreading.',
  },
  {
    href: '/visualizations/wave-packets',
    icon: '〰️',
    title: 'Wave Packets and Scattering',
    level: 'Intermediate',
    accent: 'violet',
    hook: 'Draw a landscape, fire a packet at it, and watch some of it bounce off a barrier it had plenty of energy to cross.',
  },
  {
    href: '/visualizations/hydrogen-atom',
    icon: '⚛️',
    title: 'Models of the Hydrogen Atom',
    level: 'Intermediate',
    accent: 'teal',
    hook: 'Bohr’s orbits and Schrödinger’s clouds predict the same spectrum — and disagree about everything else.',
  },
  {
    href: '/visualizations/mach-zehnder',
    icon: '🔺',
    title: 'The Mach-Zehnder Interferometer',
    level: 'Intermediate',
    accent: 'sky',
    hook: 'Two beams, each carrying half the light, meeting at a detector that never clicks — until you lengthen one path by half a wavelength.',
  },
  {
    href: '/visualizations/deutsch-jozsa',
    icon: '⚖️',
    title: 'Deutsch–Jozsa: The First Quantum Speedup',
    level: 'Intermediate',
    accent: 'amber',
    hook: 'One call to a black box settles a question that can cost a classical computer half a million.',
  },
  {
    href: '/visualizations/spin-precession',
    icon: '🌀',
    title: 'Spin Precession',
    level: 'Intermediate',
    accent: 'rose',
    hook: 'Put a magnetic field on the Bloch sphere and the arrow starts to turn — the same physics as an MRI scanner and as every RX gate.',
  },
  {
    href: '/visualizations/uncertainty',
    icon: '↔️',
    title: 'Uncertainty as a Fourier Trade-off',
    level: 'Intermediate',
    accent: 'violet',
    hook: 'Squeeze a packet in position and its momentum spreads to compensate — watch the Gaussian land exactly on the ħ/2 floor that nothing beats.',
  },
  {
    href: '/visualizations/lasers',
    icon: '🔦',
    title: 'How a Laser Works',
    level: 'Intermediate',
    accent: 'teal',
    hook: 'Pump atoms up faster than they fall and one stray photon becomes a beam of identical copies — take one level away and it never can.',
  },
  {
    href: '/visualizations/alpha-decay',
    icon: '☢️',
    title: 'Alpha Decay: Tunneling with a Half-life',
    level: 'Intermediate',
    accent: 'sky',
    hook: 'Uranium’s four-billion-year half-life is one number: the chance, per knock, that an alpha particle is simply on the other side of a wall it cannot climb.',
  },
  {
    href: '/visualizations/electron-diffraction',
    icon: '💎',
    title: 'Davisson–Germer: Electron Diffraction',
    level: 'Intermediate',
    accent: 'amber',
    hook: 'Fire electrons at a nickel crystal and a peak appears at 54 V and 50° — exactly where a 0.167 nm wave would put it. The experiment that proved de Broglie.',
  },
  {
    href: '/visualizations/quantum-key-distribution',
    icon: '🔑',
    title: 'Quantum Key Distribution',
    level: 'Intermediate',
    accent: 'rose',
    hook: 'Let Eve intercept the photons and watch a quarter of the key go wrong — she cannot listen more quietly, and 11% is where Alice and Bob stop trusting it.',
  },
  {
    href: '/visualizations/qft',
    icon: '〰️',
    title: 'Quantum Fourier Transform',
    level: 'Advanced',
    accent: 'violet',
    hook: 'The transform at the heart of Shor’s algorithm, with every phase laid bare.',
  },
  {
    href: '/visualizations/vqe',
    icon: '🗺️',
    title: 'VQE and the Barren Plateau',
    level: 'Advanced',
    accent: 'teal',
    hook: 'A classical optimiser hunts a ground-state energy across a landscape that goes flat as the qubit count grows.',
  },
  {
    href: '/visualizations/shor',
    icon: '🔢',
    title: "Shor's Algorithm: Period Finding",
    level: 'Advanced',
    accent: 'sky',
    hook: 'The one quantum step inside factoring — finding a hidden period, not the factors themselves.',
  },
  {
    href: '/visualizations/surface-code',
    icon: '🛡️',
    title: 'The Surface Code',
    level: 'Advanced',
    accent: 'amber',
    hook: 'Why one error-corrected qubit costs a hundred real ones, and what happens when you skimp on distance.',
  },
  {
    href: '/visualizations/qec-duel',
    icon: '⚔️',
    title: 'Decoder Duel: Lookup vs Learned',
    level: 'Advanced',
    accent: 'rose',
    hook: 'A neural decoder trains in your browser and chases majority vote — which, on this code, is provably unbeatable.',
  },
  {
    href: '/visualizations/quantum-eraser',
    icon: '🧽',
    title: 'The Quantum Eraser',
    level: 'Advanced',
    accent: 'violet',
    hook: 'Erase which-path information after the photon has already been detected, and find the interference waiting in the bookkeeping.',
  },
  {
    href: '/visualizations/phase-estimation',
    icon: '📐',
    title: 'Quantum Phase Estimation',
    level: 'Advanced',
    accent: 'teal',
    hook: 'An eigenvalue nobody can measure, written into spare qubits as a phase and read back as a number.',
  },
  {
    href: '/visualizations/band-structure',
    icon: '💎',
    title: 'Band Structure',
    level: 'Advanced',
    accent: 'sky',
    hook: 'Switch a row of atoms on under a free electron and whole ranges of energy become forbidden — then count electrons to see which solids conduct.',
  },
  {
    href: '/visualizations/identical-particles',
    icon: '👯',
    title: 'Fermions and Bosons',
    level: 'Advanced',
    accent: 'amber',
    hook: 'Put two particles in one well and swap them. A minus sign you cannot see carves a hole where they would meet — and stacks the periodic table.',
  },
  {
    href: '/visualizations/state-tomography',
    icon: '🔬',
    title: 'Tomography and No-Cloning',
    level: 'Advanced',
    accent: 'rose',
    hook: 'Learn an unknown state from thousands of copies measured three ways — and try to build the copier that would make it cheap.',
  },
  {
    href: '/visualizations/density-matrix',
    icon: '🔢',
    title: 'Mixed States and the Density Matrix',
    level: 'Advanced',
    accent: 'violet',
    hook: 'The arrow inside the sphere, as a matrix: purity is its length, a mixture is not a superposition, and half of a Bell pair is the most mixed a qubit gets.',
  },
  {
    href: '/visualizations/wavefunctions-3d',
    icon: '☁️',
    title: 'Wavefunctions in Three Dimensions',
    level: 'Advanced',
    accent: 'teal',
    hook: 'Box, oscillator, rotor and hydrogen as the probability clouds they are — no edge, no isosurface, and a plane you can drag through the nodes.',
  },
  {
    href: '/visualizations/wigner-function',
    icon: '🏔️',
    title: 'Phase Space and the Wigner Function',
    level: 'Advanced',
    accent: 'sky',
    hook: 'A quantum state as a landscape over position and momentum — and a single photon digs it below zero, where no probability can go.',
  },
  {
    href: '/visualizations/majorana-stars',
    icon: '✨',
    title: 'Majorana Stars',
    level: 'Advanced',
    accent: 'amber',
    hook: 'The Bloch sphere for bigger spins: 2j points instead of one — rotate them and they turn together, squeeze them and they fly apart.',
  },
  {
    href: '/visualizations/hhl-algorithm',
    icon: '➗',
    title: 'The HHL Algorithm',
    level: 'Advanced',
    accent: 'rose',
    hook: 'Solve Ax = b without ever computing x — phase estimation reads out an eigenvalue, and a controlled rotation divides by it.',
  },
] as const
