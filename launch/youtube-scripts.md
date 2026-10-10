# YouTube scripts — videos 1–3

<!--
The first three videos of the one-per-visualization channel (Phase 1,
docs/ROADMAP.md). Rules these are written under, same as the email course:
never "both at once", never "the universe checks", never
entanglement-sends-signals, no marketing adjectives. The only visual is the
live sim, screen-recorded; every on-screen action below names a control that
exists in the actual UI — verified against
app/visualizations/double-slit/page.tsx, bloch-sphere/page.tsx and
entanglement/page.tsx on the date of writing. If a control is renamed,
these scripts are wrong until updated.

Format: [m:ss] timestamp · SCREEN: what to do in the sim · VO: words to be
spoken aloud. Read at a natural pace, ~145 wpm; each script times out at
3:30–4:30 with pauses.

Titles are specific, not curiosity-gap, per the same rule as the email
subject lines.
-->

---

## Video 1 — The double-slit experiment, one particle at a time

**Title:** Watching single particles build an interference pattern (live simulation)
**Sim:** /visualizations/double-slit
**Misconception this video kills:** "The detector disturbs the particle, and that's why observation destroys the pattern."

[0:00] SCREEN: Sim already running in wave mode. Fringes visible on the
right-hand screen.
VO: This interference pattern is being computed live, right now, in a
browser. In the next three minutes I'm going to break it — and the reason it
breaks is stranger than the usual story you've heard.

[0:15] SCREEN: Drag the **Slit separation** slider slowly from 60 up toward
120, then back down toward 20. Point at the **Fringe spacing** stat as it
changes.
VO: Source on the left, a barrier with two openings, a screen on the right.
The stripes are where waves from the two slits arrive in step — bright — or
out of step — dark. Watch the readout: move the slits apart and the stripes
crowd together, exactly as wave optics says they should. So far, nothing
quantum. Water does this.

[0:45] SCREEN: Turn on the **Fire one particle at a time** toggle. Press
**Clear screen**. Let single dots accumulate. Nudge **Emission rate** up to
around 80/s once the point is made.
VO: Here's where it stops being water. Now the source fires one particle at
a time — each one lands as a single dot, somewhere unpredictable. One
particle, one dot. There's nothing wave-like about a dot. But keep watching.

[1:15] SCREEN: Let the pattern build. Hover the **Particles detected** count
as it climbs past a few hundred.
VO: The dots pile up into stripes. The same stripes. And remember — these
particles went through one at a time. No particle ever had a partner in the
apparatus to interfere with. Each one interferes with itself: its amplitude
goes through both slits, and the two paths add or cancel. The pattern was
never a property of the crowd.

[1:50] SCREEN: Turn on the **Watch which slit (measure)** toggle. Press
**Clear screen**. Let the two plain blobs build. Point at **Fringe
spacing**, which now reads "none".
VO: Now the famous part. I'll put a detector at the slits, so we always know
which opening each particle used. The stripes are gone. Not blurred — gone.
Two plain heaps, one behind each slit, which is what you'd expect from
little bullets. The readout agrees: fringe spacing, none.

[2:25] SCREEN: Hold on the two blobs. No interaction.
VO: The story you usually hear is that the detector bumps the particle and
knocks the pattern apart. That is not what's happening — and it can't be,
because the effect doesn't depend on how gently you look. What matters is
that which-path information now exists. While the two routes were
indistinguishable in principle, they were alternatives, and alternatives add
as amplitudes — which can cancel. Once the path is knowable, they're
distinct outcomes, and outcomes add as probabilities — which never cancel.
Stripes need cancellation.

[3:05] SCREEN: Turn **Watch which slit (measure)** off. Press **Clear
screen**. Let the fringes rebuild in particle mode.
VO: Turn the detector off, and the stripes come back. The stripes and the
answer to "which slit?" cannot both exist. You choose which one you get.
That trade — information for interference — is the actual mystery, and
it's the foundation everything else in quantum computing is built on.

[3:35] SCREEN: End screen — the sim URL over the running pattern.
VO: This simulation is free at the link below — no account, and every slider
you saw is yours to drag. Next video: what a single qubit actually is, and
why the most common one-sentence explanation of it is wrong.

---

## Video 2 — The Bloch sphere: every qubit state on one globe

**Title:** A qubit is not "0 and 1 at the same time" — here's what it is
**Sim:** /visualizations/bloch-sphere
**Misconception this video kills:** "A qubit in superposition is 0 and 1 simultaneously."

[0:00] SCREEN: Sphere on screen, arrow at a generic tilt. Drag the canvas to
rotate the view once, slowly.
VO: You've probably heard that a qubit is zero and one at the same time.
That sentence has done more damage to public understanding of quantum
computing than any other, and this globe is the picture that fixes it.

[0:15] SCREEN: Click **Preset states** → **|0⟩**. Arrow snaps to the north
pole. Then **|1⟩** — south pole. Point at the **P(0)** and **P(1)** stats:
100%/0%, then 0%/100%.
VO: Every possible state of one qubit is exactly one point on this sphere's
surface. The north pole is zero — measure it, you get zero, every time. The
south pole is one. Those two poles are the only answers a measurement can
ever give you.

[0:40] SCREEN: Drag the **θ (polar)** slider slowly from 0 toward π. Watch
the arrow tilt and **P(0)**/**P(1)** shift continuously.
VO: But the state itself can be anywhere on the surface. Watch the
probabilities as I tilt the arrow: the latitude sets the odds. Halfway
down, at the equator, it's fifty-fifty. And here's the correction to that
famous sentence: this state is not "zero and one at the same time." It's
one definite state — this exact arrow, this exact direction. A compass
needle pointing northeast isn't pointing north and east simultaneously.
It's pointing northeast, which is a third thing.

[1:25] SCREEN: With θ at 0.50π, note the **State vector** readout below the
sphere: |ψ⟩ with its two amplitudes.
VO: Written out, the state is two numbers — amplitudes, one for each pole.
Square them for the odds. The arrow is just those two numbers drawn as a
direction.

[1:45] SCREEN: Now drag the **φ (azimuth)** slider through a full turn, 0 to
2π. The arrow sweeps around the equator. Hold a finger on **P(0)** and
**P(1)**: they do not move.
VO: Now the strange part. This slider spins the arrow around the equator —
and look at the probabilities. They don't move. At all. This angle is called
phase, and a measurement of zero-versus-one is completely blind to it.
Different states, identical statistics.

[2:15] SCREEN: Click **Preset states** → **|+⟩**, then **|−⟩**. Arrow jumps
between opposite sides of the equator; P(0) and P(1) stay 50/50 for both.
VO: These two states — plus and minus — sit on opposite sides of the
equator. Same fifty-fifty odds. If you only ever measured, you could never
tell them apart. So why does phase matter?

[2:40] SCREEN: Hold on **|+⟩** vs **|−⟩**, rotating the view so the equator
is clearly visible.
VO: Because phase is what interferes. Run each of these through one more
gate — a Hadamard — and they separate perfectly: plus becomes zero with
certainty, minus becomes one with certainty. The invisible angle becomes a
visible answer. Every quantum algorithm worth running is that trick at
scale: arrange the phases so wrong answers cancel and right answers add. The
stripes in the double-slit video? Phase, made visible by recombining two
paths.

[3:20] SCREEN: Slowly rotate the whole sphere by dragging the canvas.
VO: One warning about this picture: it holds one qubit, alone. The moment a
qubit gets entangled with another, its arrow leaves the surface and shrinks
toward the center — it stops having a complete state of its own. What that
means is the next video.

[3:40] SCREEN: End screen — sim URL over the sphere.
VO: The sphere is live at the link below — drag the sliders, spin the view,
and check the numbers yourself. Next: entanglement, minus the mysticism.

---

## Video 3 — Entanglement: matched answers, no signal

**Title:** Entanglement can't send messages — measure a Bell pair yourself and see why
**Sim:** /visualizations/entanglement
**Misconception this video kills:** "Measuring one entangled particle instantly sends something to the other."

[0:00] SCREEN: Sim loaded with **Preparation** on **Bell state Φ+**. Two
orbs with the beam between them.
VO: Two qubits. In a moment I'll measure the left one, and the right one's
result will be decided — instantly, no matter how far apart they are. That
sounds like a faster-than-light telegraph. By the end of this video you'll
see, in the numbers, exactly why it isn't one.

[0:20] SCREEN: Point at the **Entanglement** stat (1.00 bits) and the
amplitudes table: only |00⟩ and |11⟩, 50% each.
VO: This is a Bell state — the simplest maximally entangled state. The state
table says it plainly: fifty percent zero-zero, fifty percent one-one, and
nothing else. The two qubits will agree. What's missing is any fact about
which answer they'll agree on.

[0:45] SCREEN: Click **Measure A**. The left orb collapses; the right orb's
display snaps to the matching value. Click **Measure B** to confirm the
match. Then **Reset**, and do it again — different outcome, still matching.
VO: Measure A. I got a result at random — and look at B: already decided,
same answer. Reset, again. Different answer this time, but they still
match. Every single run. This part is real, and it's what all the fuss is
about.

[1:20] SCREEN: Click **Run 500 pairs**. Histogram appears: tall bars on 00
and 11, empty on 01 and 10. Point at **Correlation** reading ~1.00.
VO: Five hundred pairs, measured both sides. Zero-zero and one-one, and the
middle two columns — disagreements — empty. Correlation: one.

[1:45] SCREEN: Point at the **P(A=1)** stat: 50.0%.
VO: Now here is the sentence that almost every popular article gets wrong.
This cannot send a message. Look at A's side alone: fifty percent. A fair
coin. If you're Alice, holding qubit A, your results are random noise no
matter what Bob does to qubit B — measure it, don't measure it, makes no
difference to anything you can see. The correlation only exists in the
comparison, and comparing the two lists takes an ordinary phone call, at
ordinary speed. Nothing travels between the qubits. There is no
faster-than-light anything here.

[2:30] SCREEN: Switch **Preparation** to **Product state**. Click **Run 500
pairs**. Histogram changes; **Entanglement** reads 0.00 bits and
**Correlation** drops to about zero.
VO: For contrast, here's an unentangled pair — A in superposition, B just
sitting at zero. Same buttons, and the perfect agreement is gone: A and B
now disagree half the time, and the correlation stat reads zero. Measuring A
tells you nothing about B. So maybe entanglement is just correlation done
well? Two gloves in two boxes — open one, find the left glove, and you
instantly know the other box holds the right one. Nothing spooky.

[3:00] SCREEN: Switch back to **Bell state Φ+**. Hold on the two orbs and
the beam.
VO: That glove story is the tempting explanation — the qubits were secretly
labelled all along, and measurement just reads the label. And it's the one
explanation the physics rules out. Bell's theorem: no assignment of
pre-existing answers, made when the pair was created, can reproduce the
correlations quantum mechanics predicts across different measurement
choices — and experiments have confirmed the quantum numbers, decade after
decade. Too strong to be gloves. Not usable as a telegraph. That narrow,
strange middle ground is what entanglement actually is.

[3:40] SCREEN: Switch **Preparation** to **Partially entangled**. Drag the
**θ** slider from 0 to π and back; watch the **Entanglement** stat sweep
0 → 1 → 0.
VO: And it isn't all-or-nothing — entanglement comes in amounts. This slider
sweeps continuously from independent to maximally entangled, and the number
on the right is measuring it: zero bits to one full bit and back.

[4:00] SCREEN: End screen — sim URL over the histogram.
VO: All of this is free at the link below — measure your own pairs, run
your own five hundred, and check the correlation yourself. The full
course starts from the double-slit experiment and goes all the way to
error correction. No account needed for any of what you just saw.


---

# YouTube scripts — videos 4–12

<!--
The remaining nine videos, one per visualization, same rules and format as
videos 1–3 above. Every on-screen action names a control verified against the
actual page component on the date of writing:
app/visualizations/{superposition,tunneling,grover,qft,decoherence,vqe,shor,
surface-code,qec-duel}/page.tsx. If a control is renamed, these scripts are
wrong until updated. Numbers quoted in the VO (Grover probabilities, Shor
register sizes, surface-code qubit counts, barren-plateau decay factors) are
the numbers the sim itself displays, not round approximations invented for
the camera.
-->

---

## Video 4 — Superposition: not a coin you haven't looked at

**Title:** Superposition is not "secretly one of them" — here's the two-line proof
**Sim:** /visualizations/superposition
**Misconception this video kills:** "A superposition is just a definite value you don't know yet."

[0:00] SCREEN: Sim loaded with the default single H gate applied — two equal
bars, |0⟩ and |1⟩ at 50% each.
VO: Two bars, fifty-fifty. The obvious reading is that the qubit is secretly
zero or secretly one, and the bars just describe my ignorance — like a coin
under a cup. In the next three minutes this sim will prove that reading
wrong, using nothing but two button presses.

[0:20] SCREEN: Press **Measure once** five or six times. Watch the **Your
measurements** histogram grow and the **Measurements** stat climb.
VO: First, the part that looks exactly like a coin. Measure: one. Again:
zero. Again: zero, one, one. Genuinely random, no pattern.

[0:45] SCREEN: Press **Run 1000 shots**. The **1000 simulated shots**
histogram appears, roughly 500 on each side.
VO: A thousand at once — about half and half. So far a coin flip reproduces
everything on this screen. If that were the whole story, quantum computing
would be a very expensive casino.

[1:10] SCREEN: Press **Reset**. One bar: |0⟩ at 100%. Press the **H** gate
button once — two equal bars again. Point at the **State vector** table:
both amplitudes +0.707.
VO: Now the proof. Reset to a definite zero, and apply one Hadamard gate —
the fifty-fifty splitter. The table underneath shows what the bars can't:
the state is two amplitudes, both positive.

[1:35] SCREEN: Press **H** a second time. The bars snap to |0⟩ at 100%.
Press **Measure once** three times — 0 every time.
VO: Apply the same splitter again. If the qubit were a hidden coin, mixing a
mixed coin should leave it mixed. Instead: certainty. Zero, every single
time. The second Hadamard sent the two |1⟩ contributions in with opposite
signs — plus point-seven-oh-seven and minus point-seven-oh-seven — and they
cancelled. Probabilities cannot do that. Probabilities only pile up. Only a
real, definite state with a sign can cancel, and that cancellation is the
entire difference between a qubit and a coin.

[2:20] SCREEN: Press **Reset**, press **H**, turn on the **Show phase**
toggle, then press **Z**. Bar heights don't move; the dial under |1⟩ swings
half a turn.
VO: Here's the sign, made visible. This Z gate changes nothing about the bar
heights — measure all day and you'd never notice it happened. But the dial
under |1⟩ just swung half a turn. That hidden angle is what the second
Hadamard turned into certainty a moment ago. Invisible to measurement,
decisive for interference.

[2:55] SCREEN: Switch **Qubits** to **3**. Using **Target qubit**, apply
**H** to q0, q1, and q2. Eight equal bars. Press **Measure once** — every
bar vanishes except one.
VO: And it scales. Three qubits, three Hadamards, eight outcomes at once —
add a qubit and the bar count doubles. But measure, and all of it collapses
to one answer; the other seven amplitudes are simply gone. Whatever a
quantum algorithm is going to do with that huge state, it has to do it
before this moment.

[3:30] SCREEN: End screen — sim URL over the eight bars.
VO: The lab is free at the link below — build any circuit you like and
watch the amplitudes cancel in the table. Next video: a particle meets a
wall it does not have the energy to climb, and appears on the other side.

---

## Video 5 — Tunneling: through the wall, no energy borrowed

**Title:** Quantum tunneling: the particle never "borrows energy" — watch what actually happens
**Sim:** /visualizations/tunneling
**Misconception this video kills:** "The particle briefly borrows energy to hop over the barrier."

[0:00] SCREEN: Sim running with defaults — packet moving right, **Barrier
height V₀** at 4.0, **Particle energy E** at 2.0. The dashed sky energy line
sits clearly below the top of the amber barrier.
VO: This wave packet has energy two, on its way to a wall of height four.
The dashed line is its energy; the amber block is the wall. Classically this
story has exactly one ending: it bounces. Watch the right-hand side of the
screen.

[0:20] SCREEN: Let the packet hit the barrier. Point at the **Transmitted**
stat as it climbs off zero, and **Reflected** taking most of the rest.
VO: Most of it reflects — and some of it is now on the far side. The
transmitted number is real probability of finding the particle beyond a wall
it could not climb. The popular explanation says it briefly borrowed energy
from the vacuum to jump. It did not, and the sim shows you the actual
mechanism if you know where to look.

[0:55] SCREEN: Press **Reset**, let the packet hit again, and press
**Pause** while amplitude is visibly inside the barrier. Point at the faint
teal curve crossing the amber block.
VO: Pause it mid-collision. The teal line is the wave itself, inside the
wall. It hasn't stopped, and it hasn't jumped — it has stopped oscillating
and started decaying. Exponentially, at a rate set by how far the energy
falls short of the top. Nothing gains energy anywhere in this picture. If
the wall ends before the decay finishes, whatever amplitude is left walks
out the other side and keeps going. That leftover is the transmission.

[1:40] SCREEN: Press **Play**. Drag **Barrier width** from 20 up to 40, then
60, pressing **Reset** between runs. Point at **Transmitted** collapsing,
and the **Analytic estimate** stat falling with it.
VO: Exponential decay has a signature: sensitivity. Double the wall's width
and transmission doesn't halve — it collapses by orders of magnitude. The
amber stat is the textbook formula for a thick barrier, e to the minus two
kappa L, computed live; the measured number tracks it as the wall thickens.

[2:15] SCREEN: With a thick barrier, point at the gap between **Transmitted**
and **Analytic estimate** — the measured value sits a little higher. Then
drag **Packet width σ** down toward 10 and reset.
VO: Notice the measurement usually beats the formula slightly. That's not a
bug — a finite packet isn't a single energy, it's a spread, and its fastest
components tunnel far more easily than the average. Narrow the packet and
the spread widens, and the gap grows. The sim is solving the actual
Schrödinger equation on a 600-point grid, so it's honest about details the
one-line formula ignores.

[2:55] SCREEN: Drag **Particle energy E** up past 4 and run once — most of
the packet now goes over, but some still reflects.
VO: One more classical impossibility, for symmetry: give the particle more
energy than the wall and part of it still bounces back. Waves reflect off
any sharp change, in both directions.

[3:15] SCREEN: Hold on the decaying teal curve inside the barrier.
VO: This exact exponential sensitivity is why a scanning tunneling
microscope can image single atoms — the current through the gap changes so
violently with distance that atoms stand out as hills. It's why flash
memory eventually forgets, and why the Sun's protons fuse at temperatures
that are far too low for the electrical repulsion they face. No borrowed
energy anywhere. Just a wave that decays instead of stopping.

[3:45] SCREEN: End screen — sim URL over the running packet.
VO: All four sliders are yours at the link below. Next video: how a quantum
computer searches a million items with a thousand guesses — and why "it
tries everything in parallel" is not the reason.

---

## Video 6 — Grover's search: parallelism is not the trick

**Title:** Grover's algorithm step by step — "tries all answers at once" is wrong, and the sim proves it
**Sim:** /visualizations/grover
**Misconception this video kills:** "A quantum computer tries every answer in parallel and picks the right one."

[0:00] SCREEN: Sim loaded. Switch **Search space** to **3 qubits · 8
items**. Eight equal amplitude bars. Point at **P(marked)**: 12.5%.
VO: Eight items, one of them marked, and a quantum computer that starts by
holding all eight as one superposition. The famous explanation says it now
checks them all in parallel and picks the winner. Watch the numbers — that
explanation dies at the very first step.

[0:20] SCREEN: Under **Marked item**, select **|101⟩**. Point at the stats:
**Classical avg** reads 4 checks, **Optimal** reads 2.
VO: The target is one-oh-one. Classically, an unsorted list of eight takes
four checks on average. Grover will need two steps — and for a million
items, about a thousand. Square root of N. Where does that come from?

[0:40] SCREEN: Press **Step** once. The |101⟩ bar flips downward — negative.
Point at **P(marked)**: still 12.5%. Point at the **Measurement
probabilities right now** histogram: perfectly flat.
VO: Step one: the oracle. It just looked at every candidate in superposition
— the "parallel" part is real. And here is what it bought: nothing you can
measure. The marked bar flipped to negative, but the histogram below is
still perfectly flat — every outcome twelve and a half percent. Measure now
and you're guessing. If parallelism were the trick, the algorithm would be
finished. It hasn't started.

[1:25] SCREEN: Press **Step** again. All bars reflect about the dashed amber
mean line; the |101⟩ bar shoots up. **P(marked)** jumps to about 78%.
VO: Step two is where the work happens: diffusion — reflect every amplitude
about their average. The dashed amber line is that average. Seven positive
bars and one negative one drag the mean down slightly, so reflecting the
deeply negative marked bar throws it far above everything else.
Seventy-eight percent, from one flip and one reflection. The trick was
never parallelism. It was arranging a sign so that interference concentrates
probability on one answer.

[2:10] SCREEN: Press **Reset**, then **Run to optimum**. **P(marked)** reads
about 94.5%, **Iteration** reads 2.
VO: Run to the optimum — two full iterations — and the marked state carries
about ninety-four percent of the probability. Not certainty. Grover is
usually a high-probability algorithm, and you check the answer classically
in one step, which is cheap.

[2:35] SCREEN: Keep pressing **Step** past the optimum. **P(marked)** falls,
then keeps oscillating on repeated presses.
VO: Now the part almost nobody mentions: keep going and it gets worse. Each
iteration rotates the state by a fixed angle toward the answer — and past
the answer, if you don't stop. More quantum computing is not automatically
better quantum computing. The optimal count, pi over four times root N, is
printed right there in the stats, and overshooting it costs you.

[3:10] SCREEN: Switch **Search space** back to **2 qubits · 4 items**, press
**Run to optimum**. P(marked) hits 100% at iteration 1.
VO: One clean coincidence to end on: for four items, a single iteration
lands exactly on certainty. That's the one size where the rotation angle
divides perfectly. Everywhere else, it's high probability plus a classical
check — which is still a square-root speedup on a problem with no structure
to exploit at all.

[3:35] SCREEN: End screen — sim URL over the bars.
VO: Step through it yourself at the link below and watch the mean line do
the work. Next video: the transform that turns an invisible period into a
measurable number — the engine inside Shor's algorithm.

---

## Video 7 — The quantum Fourier transform, with every phase visible

**Title:** The QFT in 6 gates — and why it is not a faster FFT
**Sim:** /visualizations/qft
**Misconception this video kills:** "The QFT Fourier-transforms your data exponentially faster than an FFT."

[0:00] SCREEN: Sim loaded, **Qubits** at 3. Two panels: **Input state ·
|001⟩** with a single bar, **After QFT** with eight equal bars whose dials
each point somewhere different.
VO: On the left, one spike. On the right, its quantum Fourier transform:
eight equal bars. All the information that was in the spike's position is
still here — but not in the heights. It's in the dials.

[0:20] SCREEN: Point at the dials under the output bars, tracing left to
right — each hand rotated a constant step from its neighbour.
VO: Every bar carries a phase, drawn as a clock hand, and the hands step
around by a constant amount as you walk across the register. A phase ramp.
The steeper the ramp, the higher the input value — the slope IS the number
we fed in.

[0:45] SCREEN: Drag the **Input basis state** slider from |000⟩ up to |111⟩
slowly. At |000⟩ all dials point the same way; each step up visibly steepens
the winding.
VO: Watch it live. Input zero: every hand parallel — zero frequency, flat
ramp. Each step up the slider adds one more full turn across the register.
The heights never change; only the winding rate does. Position information
in, frequency information out — exactly what a Fourier transform is for.

[1:20] SCREEN: Point at the stats: **Total QFT gates** 6, **Amplitudes** 8,
**Classical FFT** 24 ops. Switch **Qubits** to 4 — gates 10, FFT 64 ops.
VO: Now the seductive numbers. Three qubits: six gates transform all eight
amplitudes; a classical FFT needs about twenty-four operations. Four qubits:
ten gates against sixty-four. The gate count grows like n squared while the
amplitude count doubles per qubit — on fifty qubits, that's about
thirteen hundred gates against fifty-six thousand trillion operations. This
is where people conclude quantum computers do Fourier analysis
exponentially faster. They do not, and the reason is the most important
sentence in this series.

[2:05] SCREEN: Hold on the **After QFT** panel — eight bars, eight dials.
VO: You cannot read this out. All eight amplitudes exist, but one
measurement returns one basis state, at random — and destroys the rest.
Getting the full transform out would take enough repeated runs to erase the
speedup entirely. The QFT is not a fast way to transform data you have. It
is only useful inside an algorithm that arranges for the one thing you're
likely to measure to be the answer you wanted.

[2:40] SCREEN: Turn on the **Show the inverse QFT instead** toggle. The
output panel re-renders; toggle it back.
VO: The whole construction also runs backwards — same gates, every phase
angle negated — which matters because algorithms use it in both directions.

[2:55] SCREEN: Drag **Input basis state** while holding on the output dials
one more time.
VO: So what is it for? Suppose some process hands you a state whose
amplitudes repeat with a hidden period — a pattern you can't see, because
measuring gives one random sample of it. The QFT converts periodicity in
the amplitudes into concentration of probability: a sharp peak at the
corresponding frequency, which one measurement will actually find. That is
precisely the job it does inside Shor's algorithm, three videos from now.

[3:25] SCREEN: End screen — sim URL over the two panels.
VO: Drag the slider yourself at the link below — the ramp is more
convincing in motion. Next video: what happens to all these carefully
arranged phases on real hardware. Spoiler: they rot.

---

## Video 8 — Decoherence: the qubit doesn't get it wrong, it stops having an answer

**Title:** Decoherence is not a bit flip — watch the arrow leave the surface
**Sim:** /visualizations/decoherence
**Misconception this video kills:** "Decoherence means noise flips your qubit to a wrong value."

[0:00] SCREEN: Sim loaded, arrow on the equator at the sphere's surface
(default θ = 0.50π). Rotate the view once by dragging.
VO: This is the Bloch sphere from video two, with one addition that changes
everything: the arrow is now allowed to leave the surface. That single
degree of freedom is the difference between a qubit in a textbook and a
qubit in a lab.

[0:20] SCREEN: Press **Play**. The arrow retracts toward the centre while
drifting slowly upward. Point at **Vector length** and **Purity** falling,
**Coherence** heading to zero.
VO: Press play and watch what the environment does. The popular picture of
noise is a bit flip — the qubit was zero and got knocked to one. That would
be the arrow jumping to a different point on the surface. That is not what
happens. The arrow shrinks. It retracts into the sphere, and the stats
underneath are tracking it: vector length falling, purity falling. The
qubit is not acquiring a wrong value. It is losing the property of having a
definite value at all.

[1:05] SCREEN: Pause. Point at the translucent ball around the shortened
arrow.
VO: A vector on the surface is a definite quantum state with a definite
phase. A vector at the dead centre is a fair coin in every basis, with no
phase left to interfere with anything. The translucent ball is everything
the qubit no longer knows about itself.

[1:25] SCREEN: Press **Reset**. Drag **T2 (dephasing)** down to 0.10 and
**T1 (energy relaxation)** up to 2.00. Press **Play** — the arrow falls
flat onto the vertical axis quickly, then creeps toward the north pole.
VO: There are two separate destructions here, with two famous names. T-two
is dephasing: the environment scrambles the phase, so the horizontal part
of the arrow — the coherence — collapses onto the polar axis. T-one is
energy relaxation: the qubit dumps its excitation and settles toward zero,
the north pole. Set dephasing fast and relaxation slow, like this, and you
can watch them separately: flat first, pole much later. And note which one
died first — the phase. The phase is where videos two through seven did
all their work.

[2:15] SCREEN: Drag **T2** above twice **T1** — the amber pill appears:
"T2 > 2·T1 is physically impossible".
VO: One honesty note built into the sim: real hardware always has T-two at
most twice T-one, because losing energy scrambles phase all by itself. The
sliders let you break that bound so you can isolate each channel — and the
sim flags, right here, that no such device exists.

[2:40] SCREEN: Press **Reset**, then **Play**, and let the arrow decay at
the defaults. Point at **Coherence** as it drains.
VO: Now the sentence that explains the entire quantum hardware industry.
Every gate takes time, and this decay is running throughout. The number of
gates you get before the state is mush is roughly T-two divided by the gate
time — a few thousand on today's superconducting machines. Enough for
demos. Nowhere near enough for the algorithms in this series at useful
sizes. And adding more qubits doesn't help; it adds more things decohering
at once.

[3:20] SCREEN: Hold on the retracted arrow.
VO: The way out is not a better qubit — it's error correction: many
physical qubits guarding one logical one, with errors caught faster than
this decay creates them. That's videos eleven and twelve. First, though:
the algorithm that was designed to live with this hardware as it is — and
the mathematical wall it runs into.

[3:45] SCREEN: End screen — sim URL over the sphere.
VO: The sim is at the link below — break T-two yourself and watch which
stat dies first. Next: VQE and the barren plateau.

---

## Video 9 — VQE and the barren plateau, measured live

**Title:** The barren plateau: why bigger variational circuits stop being trainable — measured in your browser
**Sim:** /visualizations/vqe
**Misconception this video kills:** "Variational algorithms just need a better classical optimiser."

[0:00] SCREEN: Sim loaded — the energy landscape map, teal lows and amber
highs, with the start marker on it.
VO: This map is a real quantum computation: every pixel is a full simulation
of a quantum circuit and an exact energy of a six-qubit magnet. A classical
optimiser is about to hunt for the deepest teal. By the end of this video
you'll watch that strategy die — not from a bad optimiser, but from a
theorem, measured live.

[0:25] SCREEN: Click a point on the map, then press **Run optimiser**. The
white trail descends. Point at **Variational E** falling toward **Exact
ground E**, and the **Gap** stat shrinking.
VO: The idea is called VQE, and it's the honest plan for near-term quantum
hardware. The quantum machine does the one thing it's good at — preparing a
state too big to write down — and a classical optimiser turns two knobs to
push the measured energy down. The variational principle guarantees you can
never go below the true ground energy, printed in teal, so lower is simply
better. Watch the gap close.

[1:05] SCREEN: Click a different region of the map; press **Run optimiser**
again. The trail descends into a different basin and turns red when it
stops, short of the minimum.
VO: Start somewhere else, and it gets stuck somewhere else — the trail
turns red when the gradient gives out. Downhill is a local instruction, and
this landscape is not a bowl. Annoying, but familiar: classical machine
learning lives with this every day. That is not the wall.

[1:35] SCREEN: Switch **Ansatz layers** to 1 — the map visibly flattens and
loses its deep minimum. Switch to 4 — deeper, but more corrugated.
VO: Neither is this, quite: a one-layer circuit can't even express the
answer, and a four-layer one buries it in wrinkles. Expressive enough to
contain the solution, simple enough to search — that trade is hard but
negotiable. The wall is what happens to the gradient itself as the problem
grows.

[2:00] SCREEN: Press **Sample gradients (barren plateau)**. The bar chart
builds: gradient variance at 2, 4, 6, 8, 10 qubits, falling steadily on the
log axis. Then scroll to the **Gradient variance against qubit count** table
as the sample counts climb.
VO: This button measures it, right now, in your browser: the actual
gradient, by the exact parameter-shift rule, at thousands of random
parameter settings of a deep circuit, at five different widths. The claim
is not that the gradient is small. It's about the variance — how much the
gradient varies across random starting points — and it falls exponentially
with qubit count, by a factor of roughly two per qubit added. By ten qubits
the per-site variance is around six hundred times below the two-qubit
value. Follow the table as the samples accumulate: that's a measurement
converging, not a stock chart.

[2:50] SCREEN: Hold on the table's **Typical |gradient|** column.
VO: Here's why that kills the "better optimiser" hope. On real hardware,
every energy is estimated from measurement shots, and shot noise shrinks
only as one over root shots. When a typical gradient component is ten to
the minus four, telling it apart from zero costs about ten to the eighth
shots — per component, per step. Extrapolate the exponential and the
landscape isn't merely rugged. It is flat to within your ability to measure
it, in almost every direction, from almost every random start. No optimiser
can follow information that isn't in the data.

[3:30] SCREEN: Scroll briefly through the barren-plateau explainer text
below, pausing on the paragraph about the RX sublayer.
VO: One detail this lab is unusually honest about: the effect is easy to
fake and easy to miss. Build the sampled circuit from only real-valued
gates, and the raw variance falls as a mere power law — one over n — not a
plateau at all; this page measured that too, and its test suite now fails
if the complex-amplitude layer that produces the true exponential is
removed. When you see a barren-plateau claim, ask what ensemble was
actually sampled.

[4:00] SCREEN: End screen — sim URL over the map.
VO: Sample your own gradients at the link below — nothing in that table is
precomputed. Next video: the most famous quantum algorithm of all, and the
part of it almost every description gets wrong.

---

## Video 10 — Shor's algorithm doesn't factor. It finds a period.

**Title:** Shor's algorithm, honestly: the quantum computer never sees the factors
**Sim:** /visualizations/shor
**Misconception this video kills:** "The quantum computer factors N by trying every divisor at once."

[0:00] SCREEN: Sim loaded with **Number to factor N** at 15 and **Base a**
showing "a = 7 (order 4)". Top panel: teal dots in an evenly spaced comb.
Bottom panel: violet probability bars on dashed amber gridlines.
VO: This is Shor's algorithm running on fifteen — the algorithm that will
eventually break RSA encryption. Here is the sentence that should change
how you think about it: the quantum computer in this picture never divides
anything, never sees a factor, and doesn't even output the answer. Watch
what it actually returns.

[0:25] SCREEN: Point at the **True order r** stat: 4. Then at the teal comb
in the top panel — dots spaced exactly 4 apart.
VO: The real problem being solved is period-finding. Compute seven to the
x, mod fifteen, for every x: the results repeat with some period r —
here, four. Find r, and two lines of classical arithmetic crack N. The
quantum part exists only to find that period, because classically you'd
evaluate the function point by point until it repeated.

[0:55] SCREEN: Trace the top panel: the comb of surviving x values. Then the
bottom panel: four violet peaks sitting on the dashed amber lines at 0, 64,
128, 192.
VO: The quantum step, in two moves. First: superpose all two hundred
fifty-six values of x in a counting register, compute seven-to-the-x into a
second register, and measure that second register. The counting register
collapses to exactly the x values consistent with what you saw — this comb,
spaced r apart. You can't read the spacing directly; measuring gives one
random tooth. So, second move: the quantum Fourier transform from the last
video, which turns a comb of spacing r into peaks at multiples of
two-fifty-six over r. Sixty-four, spot on the amber lines.

[1:45] SCREEN: Press **Measure repeatedly**. The sky-outlined histogram
builds over the violet bars. Point at **Last c** updating, and **Period
found** / **N factored** percentages settling.
VO: Now measure, repeatedly. Each shot returns one number, c, near one of
the four peaks. Note the stats: only about half the shots yield the period.
That's not a defective simulation. That's the algorithm.

[2:15] SCREEN: Scroll to **The eight most likely measurements** table. Point
at the c = 0 and c = 128 rows: both read "no usable period".
VO: The table says it plainly. A quarter of the probability sits on c equals
zero, which tells you nothing at all — and c equals one-twenty-eight, another
quarter, reduces to one half and hands you a wrong candidate the classical
check rejects. The other two peaks yield the period, and
then classical arithmetic — a continued-fraction expansion to get r from c,
then greatest common divisors of a-to-the-r-over-two plus and minus one —
delivers three times five. Some bases fail even with a perfect period, which
is why the real algorithm expects to repeat with a different a. Every step
before and after the comb is ordinary classical computing.

[3:00] SCREEN: Point at the small print under the stats: counting register 8
qubits, work register 4 — 12 qubits, 4,096 joint amplitudes.
VO: So what did the quantum computer contribute? One thing: it found a
period exponentially faster than evaluating the function point by point. For
fifteen, that took twelve qubits. For a 2048-bit RSA key, the same
arithmetic needs thousands of logical qubits running flawlessly through
billions of gates — and the largest honest, unassisted Shor factorisations
on real hardware remain two-digit numbers. Several publicised "records"
compiled the circuit using knowledge of the answer, which makes them
meaningless.

[3:35] SCREEN: Switch N to a larger supported value; the comb and peaks
re-render. Hold.
VO: Why does anyone care now, then? Because encrypted traffic can be
recorded today and decrypted by a future machine — which is why post-quantum
cryptography is being rolled out years ahead of any such device. The threat
is real; the timeline runs through error correction. Which is the next
video.

[4:00] SCREEN: End screen — sim URL over the peaks.
VO: Run your own shots at the link below and watch the useless measurements
pile up next to the useful ones. Next: how to protect a qubit you are
forbidden to look at.

---

## Video 11 — The surface code: correcting errors without looking

**Title:** Quantum error correction: fixing a qubit you're not allowed to read
**Sim:** /visualizations/surface-code
**Misconception this video kills:** "Error correction must read the qubits — and reading destroys the state."

[0:00] SCREEN: Sim loaded at **d = 5**: the lattice of circles and diamonds.
Point at the **Physical qubits** stat: 49.
VO: Forty-nine physical qubits, protecting one. This video answers the
objection you should have had since video four: measuring a qubit destroys
its superposition — so checking a qubit for errors should destroy the very
thing you're protecting. The way out of that trap is one clever idea, and
you can click it into action right here.

[0:25] SCREEN: With **Inject which error** on **X (bit flip)**, click one
circle mid-lattice. Two diamonds light up; rings appear showing the
proposed correction.
VO: The circles are data qubits; the diamonds never touch the data's value
— each one measures only a parity: did an even or odd number of my
neighbours flip? Inject one error and the two diamonds at the ends of it
light up. Here's why that's safe: a parity is identical whether the encoded
qubit is zero, one, or any superposition. It carries no information about
the state — so measuring it collapses nothing that matters. The machine
learns where the errors are while staying blind to what it's storing.

[1:10] SCREEN: Click two adjacent circles in a row — the lit diamonds sit
at the ends of the chain, with none between.
VO: Errors form chains, and only the endpoints light up. Which means the
decoder — the classical algorithm watching the diamonds — knows where each
chain ends but not the path it took. It assumes the shortest one, because
at low error rates short chains are overwhelmingly more likely. That
assumption is about to be turned against it.

[1:35] SCREEN: Press **Clear errors**. Then click three circles straight
down the left column. The status line below the syndrome table flips to
"Logical error" and the canvas banner appears.
VO: Three errors down the edge of a distance-five code. Look at the verdict:
logical error. The syndrome these three produce is identical to a
two-error chain coming from the other side, so the decoder takes the shorter
explanation, and error plus correction now cross the whole lattice. Every
parity reads even. Nothing is lit. As far as the machine can tell, nothing
is wrong — and the stored qubit has been silently flipped. That's what the
**Corrects up to 2 errors** stat means: distance five survives any two
simultaneous errors, and can be beaten by three.

[2:25] SCREEN: Press **Clear errors**. Press **Run random rounds** with
**Physical error rate p** at 5%. Let **Rounds run** climb; point at
**Logical error rate**. Then switch **Code distance d** to 7, reset stats,
run again — the rate drops. Switch to d = 3 — it rises.
VO: So does more hardware help? Below a critical error rate, yes, and it
compounds: at five percent physical error, every step up in distance cuts
the logical rate further. This is the entire bet the industry is making —
that redundancy can outrun decay.

[3:00] SCREEN: Drag **p** up to 12%, run rounds at d = 3 and then d = 7 —
the bigger code is now worse.
VO: But push the physical error rate past the threshold and the promise
inverts: the bigger code loses, because you've added more places for errors
to appear than the redundancy pays for. In this sim the crossover sits
between eight and ten percent — and the sim itself warns you not to quote
that as the surface code's threshold, because it assumes perfect syndrome
measurements. Real machines measure parities with the same faulty gates
that cause the errors, and that drops the threshold to roughly one percent.
That's the number the hardware race is actually about.

[3:40] SCREEN: Hold on the lattice. Point at **Physical qubits**: 49.
VO: Forty-nine for one, and still not perfect — only better. Estimates for
running Shor's algorithm on a real RSA key land in the millions of physical
qubits, dominated by exactly this overhead.

[3:55] SCREEN: End screen — sim URL over the lattice.
VO: Fool the decoder yourself at the link below. Final video of the series:
we train a neural network to fight the decoder — and the honest result is
better than the hype.

---

## Video 12 — Decoder duel: the neural net that can only tie

**Title:** We trained a neural decoder that cannot win — and that's the point
**Sim:** /visualizations/qec-duel
**Misconception this video kills:** "Neural decoders beat classical decoding." (Rigged demos say so; the math here says when.)

[0:00] SCREEN: Sim loads at **d = 5**, p = 5%. The status line reports
training; the **Trained in** stat fills with a real time; the top chart
starts drawing — teal and violet lines with a dashed amber optimum.
VO: In the last two seconds, a neural network was trained in your browser —
that time stat is a real wall-clock measurement. It's about to decode
errors head-to-head against majority vote, the simplest rule there is. Here
is the honest spoiler that separates this demo from most machine-learning-
for-quantum demos you'll see: the network cannot win. And knowing exactly
why is worth more than a rigged victory.

[0:30] SCREEN: Point at the bottom panel — the syndrome trace, with each
decoder's per-shot verdict (dot = corrected, ✕ = logical error).
VO: The rules. Five bits store one, noise flips each independently, and
neither contestant ever sees the bits — only the four parities between
neighbours, the syndrome, exactly like the diamonds in the last video. For
any syndrome, precisely two error patterns are consistent: a chain and its
complement. Decoding is choosing between them. Choose wrong and the stored
bit silently flips — the crosses in this trace.

[1:05] SCREEN: Point at the top chart: teal (majority) hugging the dashed
amber optimal line; violet (network) starting above it and bending down to
meet it as shots accumulate.
VO: Contestant one, in teal: pick the lighter of the two patterns. Majority
vote, a one-line lookup. Contestant two, in violet: a genuine two-layer
perceptron, trained a moment ago on sixty thousand sampled syndromes,
never told the majority rule. Watch the violet line: it starts worse, and
converges onto the teal one at the dashed optimum. It never crosses below.

[1:40] SCREEN: Hold on the two lines converging at the dashed line.
VO: It never will, and this is the one point the whole video exists for: on
a repetition code with independent flips below fifty percent, majority vote
IS the maximum-likelihood decoder. The lighter pattern is strictly the more
probable one, and there is no information in the syndrome that majority
vote fails to use. The ceiling is provable, printed as the amber dashed
line. Any demo showing a neural decoder beating majority vote on this code
is rigged — and some flashy ones quietly are. The honest result is
narrower and more interesting: the network learned the optimal decoder from
raw samples alone.

[2:25] SCREEN: Drag **Bit-flip rate p** to 10% — the status line shows
retraining, both lines redraw higher, still meeting at the new dashed
optimum. Press **Retrain & rerun** once to show it's reproducible.
VO: Change the noise and the network retrains from scratch on the new
distribution — and finds the same ceiling. Every control on this page is a
fresh experiment, not a replay.

[2:45] SCREEN: Switch **Code distance d** to 3, then 7, at p = 5%. Point at
the **Optimal (exact)** stat falling sharply with each step up in d.
VO: Meanwhile the amber number is quietly reteaching the last video's
lesson: each two extra bits cut the optimal failure rate better than
fivefold, because failure needs two, then three, then four simultaneous
flips.

[3:05] SCREEN: Hold on the finished duel — final error rates in the
**Majority error rate** and **Net error rate** stats, nearly equal.
VO: So why does anyone train decoders? Because real codes aren't repetition
codes. On a distance-five surface code the lookup table already has about
seventeen million rows, and matching decoders are provably optimal only for
independent noise — real devices have correlated errors, faulty syndrome
measurements, crosstalk. That's the regime where learned decoders have
genuinely outperformed classical baselines, including on real hardware
data. This page is the control experiment for those claims: on a code where
the optimum is computable in one line, an honest network should reach it
and stop. You just watched it do exactly that.

[3:45] SCREEN: End screen — sim URL over the converged chart.
VO: Run the duel yourself at the link below — pick the shots, pick the
noise, and check that the violet line never cheats. That's the series: from
one particle through two slits, to a neural network learning error
correction, every step running live in your browser, every claim checkable
by you. The full course is free at the same link. Go break something.
