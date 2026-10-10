# Quantum in a Week

A seven-day email course. One idea a day, each ending at a simulation the reader
can actually drag.

**The rule this course is written under:** never say "both at once", never say
"the universe checks", never imply entanglement sends a signal. Every day ends
with the reader doing something, not reading a conclusion. The visualization is
the payload; the email is the setup.

Send at 07:00 local. Plain text with one link. No images, no tracking pixel — the
product's whole privacy stance is that learner data stays on the learner's
device, and the email course must not be the exception that contradicts it.

---

## Day 1 — The experiment that broke classical physics

**Subject:** You can run the double-slit experiment in about ten seconds

Fire electrons at a wall with two slits. Not a beam — one electron at a time, so
far apart that no two are ever in the apparatus together. Each one lands as a
single dot. There is nothing wave-like about a dot.

Let it run. The dots pile up into stripes.

This is the part worth sitting with: the pattern is built out of individual
particle impacts, but the *shape* of the pile is the shape of two overlapping
waves. Nothing in classical physics lets a thing be sorted into stripes by a slit
it did not go through.

Then do the thing that makes it strange. Turn on the detector that tells you
which slit each electron used. The stripes vanish. Not "become fuzzy" — vanish,
replaced by two plain heaps. Turn it off and they come back.

The point isn't that observation is magic. It's that the striped pattern and the
answer to "which slit?" cannot both exist. You choose which one you get.

→ **Run it:** /visualizations/double-slit

Tomorrow: what the electron is doing between the source and the screen.

---

## Day 2 — What a qubit actually is

**Subject:** The most common explanation of a qubit is wrong

You have probably read that a qubit is "0 and 1 at the same time". That sentence
has done more damage to public understanding of quantum computing than any other.

A qubit in superposition is in a *definite* state. It is just not either of the
two states you were expecting. A compass needle pointing northeast is in a
perfectly definite direction — it is not "north and east at the same time", and
it isn't secretly one of them while you aren't looking. It is pointing
northeast, which is a third thing.

Written down: |ψ⟩ = α|0⟩ + β|1⟩. Those two numbers are **amplitudes**, not
probabilities. They can be negative. They can be complex. Square the magnitude to
get the odds of each outcome.

That "can be negative" is the whole ball game, and it's why yesterday's stripes
appeared. Probabilities only ever add up. Amplitudes can cancel.

Today's simulation lets you set α and β and watch the measurement statistics.
Set them so both outcomes are equally likely, then run a thousand shots and
notice you cannot tell, from the statistics alone, which of several different
states you prepared.

→ **Run it:** /visualizations/superposition

Tomorrow: the picture that makes the missing information visible.

---

## Day 3 — Every possible qubit, on one globe

**Subject:** Why yesterday's statistics couldn't tell two states apart

Yesterday you found two different states that produce identical measurement
results. Today, the picture that shows what the statistics were missing.

Every possible state of one qubit is a point on the surface of a sphere. |0⟩ at
the north pole, |1⟩ at the south, and everything in between is superposition.
The latitude sets the odds. The longitude — the **phase** — sets nothing at all
about the odds, which is precisely why measurement statistics can't see it.

So why care about a coordinate you can't measure? Because phase is what
interferes. It's invisible on its own and decisive the moment two paths meet.
Yesterday's amplitudes that cancel? That cancellation is a phase relationship.
Day 1's stripes were phase, made visible by recombining two paths.

Drag the vector around the equator. The probabilities do not move. Then apply a
Hadamard and watch that invisible longitude turn into a visible difference.

→ **Run it:** /visualizations/bloch-sphere

Tomorrow: two qubits, and the strongest correlation the universe permits.

---

## Day 4 — Entanglement, minus the mysticism

**Subject:** What entanglement is, and what it definitely is not

Two qubits, prepared together. Measure the first: you get 0 or 1, apparently at
random. Measure the second: you get the same answer. Every time. However far
apart they are.

Here is the sentence that matters, and almost every popular article gets it
wrong: **this cannot be used to send a message.** Alice's outcomes are random no
matter what Bob does. She sees noise. Only when the two of them compare notes —
over an ordinary channel, at ordinary speed — does the correlation appear. There
is no faster-than-light anything here.

What's genuinely strange isn't the correlation. Correlations are ordinary: two
gloves in two boxes are correlated. It's that no assignment of definite
properties to each glove, made when they were packed, can reproduce what quantum
mechanics predicts and experiments confirm. The correlation is too strong for
that. That's Bell's theorem, and it's the reason "they were secretly labelled all
along" is not available as an explanation.

In the simulation, measure one qubit and watch the other's Bloch vector collapse
to a point. Then look at the entanglement entropy: exactly ln 2 for a Bell state,
and zero the moment you break it.

→ **Run it:** /visualizations/entanglement

Tomorrow: a particle goes somewhere it does not have the energy to be.

---

## Day 5 — Through the wall

**Subject:** This is why your phone's storage works

Roll a ball at a hill it hasn't the energy to climb. It rolls back. Always.

Fire a quantum particle at a barrier it hasn't the energy to cross, and
sometimes it appears on the other side. Not often. Exponentially rarely as the
barrier gets thicker. But not never.

The bad explanation — the one you'll see everywhere — is that the particle
"borrows energy" from somewhere. It doesn't. It emerges with exactly the energy
it started with. Nothing is borrowed and nothing is repaid.

What actually happens: inside the barrier the wavefunction stops oscillating and
starts decaying. It gets smaller, but it does not reach zero at the far wall — so
there is some left on the other side, and "some left" means a real chance of
finding the particle there.

This is not exotic. It is why flash memory holds your photos, how a scanning
tunnelling microscope images single atoms, and why the Sun burns at all — protons
in the core don't have enough energy to overcome their mutual repulsion, and
fuse anyway.

Drag the barrier width. Transmission collapses exponentially, exactly as
e^(−2κw) says it should. The simulation reports the measured value beside the
analytic estimate; they agree.

→ **Run it:** /visualizations/tunneling

Tomorrow: putting all of it to work.

---

## Day 6 — A computer that searches by cancelling

**Subject:** Grover's algorithm, and why quantum speedups are narrower than advertised

You have an unsorted list of a million items and one is marked. Classically you
check them one at a time: half a million tries on average.

Grover's algorithm finds it in about a thousand.

Not by checking all million at once — that's the folk explanation and it's wrong.
The trick is amplitude. Start with every possibility equally likely. Flip the
sign of the marked one — invisible so far, since squaring hides the sign. Then
reflect every amplitude about their average. The one you flipped is now further
from average than the rest, so it grows and the others shrink. Repeat about √N
times.

Watch the bars in the simulation and you will see the crucial detail: **you can
over-rotate.** Keep going past the optimum and the answer gets worse again. This
is not a search that converges; it's a rotation you must stop at the right
moment. Nothing in classical computing behaves like that.

And note the speedup: √N, not exponential. Quadratic. A million to a thousand is
worth having — it is not "tries everything simultaneously", and anyone who tells
you quantum computers brute-force all possibilities at once is describing
something that does not exist.

→ **Run it:** /visualizations/grover

Tomorrow: the reason you don't have one on your desk.

---

## Day 7 — Why you don't own one

**Subject:** The honest state of quantum computing

Six days of things that work. Today, the thing that doesn't.

A qubit holding a superposition is holding a phase relationship, and phase is
fragile. A stray photon, a vibration, a fractionally warm wire — and the phase
information leaks into the environment. It isn't destroyed; it's diluted into so
many degrees of freedom that no measurement you can make will recover it. What's
left behind behaves like an ordinary probabilistic bit. That is decoherence, and
it's the entire engineering problem.

Watch the Bloch vector in today's simulation: it doesn't jump to a pole. It
spirals inward, off the surface, toward the centre. Off the surface means it is
no longer a definite quantum state at all.

Error correction exists, and it works, at a price: spread one logical qubit over
many physical ones so an error can be detected and undone before it spreads. The
current ratio is brutal — hundreds to thousands of physical qubits for one good
logical one. That factor is why factoring a real RSA key is a machine of millions
of qubits, and why "quantum computers will break encryption" is a sentence about
the 2030s or 2040s, not about this year.

None of which makes the field vapour. It makes it engineering — the specific,
grindy kind, where the physics is settled and the fabrication is not.

→ **Run it:** /visualizations/decoherence

**Where to go next:** the full course starts at the beginning and goes deeper,
with a circuit simulator you can build in and quizzes that check whether the
idea landed. It's free — the whole foundations track, permanently, no account.

→ /learn

---

## Notes for whoever wires this up

- Day 5 (tunnelling) and Day 4 (entanglement) get the strongest engagement in
  every quantum course I've seen the numbers for. If you A/B the order, test
  moving tunnelling earlier — but not before Day 2, because "the wavefunction
  decays rather than oscillates" needs amplitude to have been introduced first.
- Every link is a route that exists today. Verify them against
  `VISUALIZATIONS` in `apps/web/components/ui/Hero.tsx` before sending — that
  array is the source of truth and the routes are derived from it.
- Do not add tracking pixels. `docs/ANALYTICS.md` commits to learner data never
  leaving the device, and an email course that quietly tracks opens makes that
  claim false.
- One-click unsubscribe in the header, not just the footer link.
- The subject lines are written to be specific rather than curious-gap ("You can
  run the double-slit experiment in about ten seconds", not "The experiment
  physicists can't explain"). Clickbait subject lines get opened once and
  unsubscribed from twice.
