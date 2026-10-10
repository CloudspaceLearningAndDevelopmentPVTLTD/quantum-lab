/**
 * The help-page FAQ. A plain module (no 'use client') so app/help/layout.tsx
 * can emit FAQPage JSON-LD from the same array the page renders — the schema
 * helper requires every marked-up answer to be visible on the page.
 */
export interface HelpItem {
  q: string
  a: string
}

export const HELP_FAQ: HelpItem[] = [
  {
    q: 'Do I need an account?',
    a: 'No. The course, all visualizations, the simulator and the challenges work without one; your progress and saved circuits stay in your browser. An account adds cross-device sync, exams and certificates, organisation seats, and — during the launch period — every Pro feature free for 30 days.',
  },
  {
    q: 'How do I sign in? There is no password.',
    a: 'Enter your email on the Account page and we send you a link. Open it on the device you want to use; it signs you in and lands on your account page. Links are single-use and expire, so request a fresh one if you waited a while. If an email does not arrive within a minute, check spam, then try again.',
  },
  {
    q: 'What does the 30-day launch trial include?',
    a: 'Everything on the Pro tier: real quantum hardware jobs within the monthly quota, the live AI tutor and the advanced course track. (The full 16-qubit simulator is free for everyone, with or without the trial.) It starts when you create the account and ends 30 days later; there is no card and nothing to cancel. Afterwards you keep the Free tier and everything you made.',
  },
  {
    q: 'Which tier of the AI tutor is answering me?',
    a: 'The dot beside the tutor\'s name shows it: teal means the full tool-calling tutor, which runs your circuit to check its own answer; violet means a direct model call without tools; amber means the built-in offline material answered. Every tier gives a real answer, but only the teal one has checked it by running something.',
  },
  {
    q: 'Are my circuits saved?',
    a: 'Yes. Without an account they are saved in this browser, up to the Free limit. With an account they sync to the cloud and appear on every device you sign in on. The share link encodes the whole circuit in the URL, so it works even for someone with no account.',
  },
  {
    q: 'Can I run on a real quantum computer?',
    a: 'Yes, from the Hardware page, if this deployment has provider credentials configured — the page says which are available. Jobs go to IBM Quantum or Amazon Braket devices, queue there, and results come back to the same page. Each plan includes a monthly quota; the launch trial uses the Pro quota.',
  },
  {
    q: 'Are the certificates accredited?',
    a: 'No. A certificate records that you passed a timed, randomised exam graded against our question bank, and anyone can verify it by its number on the verify page. It is not a university credential and we do not present it as one.',
  },
  {
    q: 'Does it work offline?',
    a: 'Mostly. The app installs as a progressive web app and caches the pages you have visited; the simulator and visualizations compute entirely in your browser, so they keep working without a connection. The AI tutor falls back to its offline material, and hardware jobs and sync wait until you are back online.',
  },
  {
    q: 'Can I embed the simulator in my own course page?',
    a: 'Yes. The circuit widget at /embed/circuit is built to be iframed, with a two-line loader script and a documented message protocol for loading a circuit and receiving results. See docs/EMBED.md in the repository.',
  },
  {
    q: 'I teach a class. What do I get?',
    a: 'Seats, classes, assignments built from lessons, challenges and exams, completion tracking that learners opt in to, and CSV export. The For educators page lists exactly what exists and where; email us for a departmental pilot.',
  },
  {
    q: 'Something is wrong with a lesson or an answer.',
    a: 'Tell us. The course text is reviewed but not infallible, and the AI tutor can be wrong even when it sounds sure — that is why the full tier runs circuits to check itself. Use the contact page; a real person reads every message.',
  },
]
