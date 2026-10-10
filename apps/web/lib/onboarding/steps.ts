/**
 * onboarding/steps.ts — the three routes through the product.
 *
 * Pure data, no browser APIs, so it can be imported from a server component
 * as safely as from a client one.
 *
 * The vocabulary is deliberately the coach's: the ids below are the concept
 * ids from `lib/coach/graph.ts` (`what-is-a-qubit`, `gates-and-circuits`,
 * `entanglement`…) prefixed by path, so that finishing an onboarding step and
 * finishing the corresponding coach node mean the same thing rather than
 * two parallel notions of "progress".
 */

import type { OnboardingPath } from './state'

export interface OnboardingStep {
  /** Stable id, also used as the key passed to `markStepComplete`. */
  id: string
  title: string
  /** What they will SEE. Not what they will "learn". */
  blurb: string
  /** A route that exists in this app. */
  href: string
  cta: string
  estMinutes: number
  icon: string
}

export interface PathDefinition {
  label: string
  blurb: string
  steps: OnboardingStep[]
}

export const PATHS: Record<OnboardingPath, PathDefinition> = {
  curious: {
    label: 'Just curious',
    blurb:
      'No maths, no notation. Three things that look impossible, explained only as far as you want them to be.',
    steps: [
      {
        id: 'curious/interference',
        title: 'Fire electrons at two slits',
        blurb:
          'Send particles through one at a time. Each lands as a single dot — and the dots pile up into stripes that no stream of pellets could ever make.',
        href: '/visualizations/double-slit',
        cta: 'Open the experiment',
        estMinutes: 5,
        icon: '🌊',
      },
      {
        id: 'curious/what-is-a-qubit',
        title: 'What a qubit actually is',
        blurb:
          'The short version, in words: a coin that is not heads, not tails, and not secretly one of them either — until you look.',
        href: '/learn/what-is-a-qubit',
        cta: 'Read the lesson',
        estMinutes: 8,
        icon: '🪙',
      },
      {
        id: 'curious/bloch-sphere',
        title: 'Spin a qubit in your hands',
        blurb:
          'Every state one qubit can be in, drawn as a single point on a globe. Drag it around and watch the odds of heads and tails move with it.',
        href: '/visualizations/bloch-sphere',
        cta: 'Spin the sphere',
        estMinutes: 6,
        icon: '🔮',
      },
    ],
  },

  student: {
    label: 'Studying it properly',
    blurb:
      'The foundations course in order, with the simulator handed to you at exactly the point the maths stops being enough.',
    steps: [
      {
        id: 'student/what-is-a-qubit',
        title: 'What Is a Qubit?',
        blurb:
          'State vectors written out in full, with the Bloch sphere beside them so you can see what each number moves.',
        href: '/learn/what-is-a-qubit',
        cta: 'Start lesson 1',
        estMinutes: 12,
        icon: '①',
      },
      {
        id: 'student/superposition-and-measurement',
        title: 'Superposition & Measurement',
        blurb:
          'Amplitudes turning into probabilities in front of you, and the moment a measurement throws the rest of the state away.',
        href: '/learn/superposition-and-measurement',
        cta: 'Continue',
        estMinutes: 14,
        icon: '②',
      },
      {
        id: 'student/interference',
        title: 'Interference',
        blurb:
          'Two paths to the same outcome, cancelling. This is the mechanism every quantum algorithm on the site is built out of.',
        href: '/learn/interference',
        cta: 'Continue',
        estMinutes: 12,
        icon: '③',
      },
      {
        id: 'student/gates-and-circuits',
        title: 'Gates & Circuits — in the simulator',
        blurb:
          'The lesson hands you the circuit editor: place gates on wires, watch the statevector update after every column.',
        href: '/learn/gates-and-circuits',
        cta: 'Open lesson 4',
        estMinutes: 18,
        icon: '④',
      },
      {
        id: 'student/simulator',
        title: 'Build one yourself',
        blurb:
          'The full editor, off the leash: any gates, any number of shots, the statevector and the histogram side by side.',
        href: '/simulator',
        cta: 'Open the simulator',
        estMinutes: 10,
        icon: '⚛️',
      },
      {
        id: 'student/first-challenge',
        title: 'Your first challenge',
        blurb:
          'A target distribution and an empty circuit. Get the outcomes to match and it marks itself correct.',
        href: '/challenges/flip-it',
        cta: 'Take the challenge',
        estMinutes: 6,
        icon: '🎯',
      },
    ],
  },

  developer: {
    label: 'I want to build',
    blurb:
      'Straight into the editor. A Bell pair, real OpenQASM 3 out the other end, then problems to solve and hardware to submit to.',
    steps: [
      {
        id: 'developer/simulator-bell',
        title: 'Bell state in the simulator',
        blurb:
          'Load the Φ+ preset, run 1,024 shots, and see a histogram with exactly two bars: 00 and 11, roughly half each.',
        href: '/simulator',
        cta: 'Open the simulator',
        estMinutes: 5,
        icon: '⚛️',
      },
      {
        id: 'developer/qasm',
        title: 'Export OpenQASM 3',
        blurb:
          'The same circuit as text you can paste into Qiskit — and the QASM import box, so you can paste one back in.',
        href: '/simulator',
        cta: 'Export the circuit',
        estMinutes: 4,
        icon: '⌨️',
      },
      {
        id: 'developer/challenges',
        title: 'Circuit challenges',
        blurb:
          'Ten graded problems — Bell pairs, GHZ states, gate golf — each checked against the measured distribution, not against a stored answer.',
        href: '/challenges',
        cta: 'Browse challenges',
        estMinutes: 20,
        icon: '🎯',
      },
      {
        id: 'developer/hardware',
        title: 'Submit to real hardware',
        blurb:
          'The queue view: pick a backend, send a circuit, and watch a job you wrote in the browser come back with counts from a real device.',
        href: '/hardware',
        cta: 'Open hardware',
        estMinutes: 8,
        icon: '🛰️',
      },
    ],
  },
}

export const PATH_ORDER: OnboardingPath[] = ['curious', 'student', 'developer']

export function totalMinutes(path: OnboardingPath): number {
  return PATHS[path].steps.reduce((sum, step) => sum + step.estMinutes, 0)
}
