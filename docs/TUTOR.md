# Tutor evaluation

The tutor answers from three tiers that degrade independently (see
`apps/web/app/api/agent/route.ts`): the full LangChain agent, a direct model
call, and an offline answer set. Until this harness existed, nobody had ever
measured whether any of them said *true things*. The clamps were audited, the
plumbing was tested, the physics was not.

Two of the three tiers can be graded with **no model call at all**, which means
they can run in CI and are the tiers most likely to rot silently.

## Running it

```bash
cd services/agent
node eval/offline_probe.mjs                    # tier 3 — offline answers
.venv/bin/python -m eval.grade_retrieval       # tier 1 retrieval — RAG + knowledge
```

The question set is `services/agent/eval/questions.json` — 31 questions with
written reference answers, `must_include` cues, and refutation cues. (Scores
dated before 2026-08-27 were measured on the original 25-question set; the set
is additive, so those questions are unchanged.)

## Measured, 2026-08-17

Run on the tree at the end of Phase 10. These are real numbers from the commands
above, not estimates.

| Tier | Result |
|---|---|
| Offline answers | **22/25 passed, 3 correctly declined, 0 failed** |
| Retrieval | 16/25 passed, routing 25/25, mean coverage 81%, misconceptions 0/25 |
| Live agent | **not run** — no API key in this environment |

## Measured, 2026-08-25 — after the chunk-merging fix

| Tier | Result |
|---|---|
| Retrieval | **21/25 passed**, routing 25/25, mean coverage 93%, misconceptions 0/25 |

Retrieval went from 16/25 to 21/25 (mean coverage 81% → 93%) by changing how
`knowledge._course_hits_as_concepts` maps index hits to results. It used to
de-duplicate by lesson keeping only the single best-scoring chunk; now each
routed lesson's excerpt merges up to three of that lesson's chunks
(`MERGE_CHUNKS_PER_LESSON`), preferring the lesson's `keypoints` chunk when one
matched at all, with sibling chunks admitted at a looser floor
(`SIBLING_MIN_SCORE`) than the per-lesson citation gate (`COURSE_MIN_SCORE`).
The index itself was not rebuilt — the chunks were always fine; the dedupe was
throwing the right ones away.

The three declines were questions with no offline entry (no-cloning, VQE/NISQ,
QFT's role). The offline tier returning its fallback menu instead of inventing
an answer is the correct behaviour, and the probe scores it as such rather than
as a pass — a tier that declines cleanly is not the same as a tier that knows.
Those three entries were written later the same day; see the next section.

## Measured, 2026-08-25 — after closing the content residuals

Same commands, same question set. Before is the morning's state (the two tables
above); after is the tree with the three new offline entries and the
`knowledge.py` content fixes described below.

| Tier | Before | After |
|---|---|---|
| Offline answers | 22/25 passed, 3 correctly declined, 0 failed | **25/25 passed, 0 declined, 0 failed** |
| Retrieval | 21/25 passed, routing 25/25, mean coverage 93% | **25/25 passed, routing 25/25, mean coverage 100%**, misconceptions 0/25 |
| Live agent | not run — no API key | not run — no API key |

What changed, and where:

- **Three new offline entries** (`apps/web/app/api/agent/offlineFaq.ts`):
  no-cloning (the two-line linearity proof, orthogonal-states exemption, and
  the QEC/QKD consequences), VQE/NISQ (the hybrid loop, ⟨H⟩ = Σ cᵢ⟨Pᵢ⟩ Pauli
  sampling, the variational upper bound, and the measurement-cost /
  barren-plateau caveats), and the QFT's role (n²/2 gates, why that is not by
  itself a speedup — amplitudes are unreadable — and periodicity → measurable
  peak). The three `offline_expect: null` markers in `eval/questions.json`
  became the new entry keys — a strictly stronger check, since a decline on
  those questions now fails instead of scoring as correct. No `must_include` /
  `must_not_include` pattern was touched.
- **Matching curated entries and two content fixes in
  `services/agent/agent/knowledge.py`**: a `vqe` concept (the curated set had
  none — `no_cloning` and `qft` already existed and already carried the
  needed facts), a `quantum_speedup` concept stating that measurement returns
  n classical bits, interference does the work, and only structured problems
  gain, and a sentence added to the measurement blurb saying interpretations
  differ while predictions do not.
- **One retrieval-logic change, measured before and after**: a strong course
  match used to suppress the curated tier entirely, which is exactly how
  bell-correlations-every-basis kept failing — the lessons routed at 0.39
  while the X/Z-agree-Y-anti-correlates fact exists only in the curated
  `bell_state` blurb. `knowledge._named_curated` now appends the top curated
  blurb alongside strong course excerpts when the query literally spells out
  that concept's id or title (stemmed) and the course results do not already
  cover it. Narrow on purpose: top keyword hit only, verbatim name only,
  never a duplicate.
- A first draft titled the speedup concept "Where Quantum Speedup Comes From";
  its stopwords ("from", "where") carried high idf and hijacked the qubit and
  teleportation questions' keyword ranking. Caught by re-running the grader,
  fixed by renaming to "Quantum Speedup"; `tests/test_knowledge_content.py`
  pins the routing so it cannot silently return.

The caveat from the note below still holds: the lessons themselves still lack
these facts, so the RAG chunks are unchanged and the improvement comes from
curated material riding alongside the course excerpts. Moving the facts into
`data/lessons.json` (owned by `apps/web`) remains the deeper fix.

## Measured, 2026-08-27 — six new topics, 31-question set

Six topics learners ask about that the set lacked, added in matched pairs to
the offline tier (`apps/web/app/api/agent/offlineFaq.ts`) and the curated
knowledge base (`services/agent/agent/knowledge.py`), each with a new graded
question: QAOA honestly framed (no demonstrated advantage, Goemans–Williamson
beats p=1 MaxCut), the quantum supremacy/advantage experiments (sampling
benchmarks, classical rebuttals, "advantage is provisional by construction"),
quantum annealing vs the gate model (not universal, no demonstrated scaling
advantage), T1 vs T2 (and why T2 ≤ 2·T1), why 2ⁿ amplitudes are not parallel
universes doing your work (Grover's √N as the counter-evidence), and qubit
hardware platforms (no clear winner). All 25 original questions are untouched;
the whole 31-question set was re-run:

| Tier | Result |
|---|---|
| Offline answers | **31/31 passed, 0 declined, 0 failed** |
| Retrieval | **31/31 passed, routing 31/31, mean coverage 100%**, misconceptions 0/31 |
| Live agent | not run — no API key in this environment |

Two regressions were caught by the harnesses during the addition and fixed in
content, not in the grader:

- The new offline T1/T2 entry initially lacked bare `t1`/`t2` keys, so the new
  t1-vs-t2 question still routed to the decoherence entry (which mentions the
  timescales but not the T2 ≤ 2T1 bound or its reason). Keys added; the old
  decoherence-t1-t2 question still routes to the decoherence entry because its
  wording names decoherence.
- The `parallel_universes` concept was first titled "Parallel Universes",
  whose bare title token "universes" matched the old
  measurement-universe-chooses question ("does the universe check it…") and
  displaced the measurement blurb from the retrieval top-up slot — the exact
  failure mode the 2026-08-25 note about high-idf title stopwords documents.
  Retitled "The Parallel-Universes Picture" (the hyphenated token cannot match
  a bare "universe"); the id still spells "parallel universes" so
  `_named_curated` fires when a learner names the topic.

The 2026-08-25 caveat still holds: none of these six topics has a lesson in
`data/lessons.json`, so on the retrieval tier the physics rides in via the
curated blurbs (keyword fallback, or the top-up/named-concept slot next to
incidental course excerpts). Lesson content remains the deeper fix.

## What the grader can and cannot detect

It checks for the **presence** of the facts a correct answer must contain, and
the **absence** of specific misconception phrasings. That second half is the
cheap, high-value part: a tutor that says tunnelling "borrows energy" is wrong
regardless of how good the surrounding sentence is, and that is a string match.

It cannot detect: an answer that contains every required phrase inside a wrong
argument, a correct fact attached to the wrong mechanism, or prose that is
technically true and pedagogically useless. Do not read a 100% as "the answer is
good" — read it as "the answer is not wrong in any of the ways we know about".

There is one refinement worth knowing about. Several questions ask about a
misconception, so a *correct* answer necessarily quotes it before refuting it.
The probe handles this with a refutation window: a misconception cue inside a
short span of a negation ("not ", "is not", "does not") counts as a refutation
rather than a violation. Two questions currently pass through that path, and the
probe prints a note saying so, because a silent version of that rule would be
indistinguishable from a grader that had been weakened to fit.

## The misconceptions it tests for

Each of these has appeared in this project's own content and been corrected:

- tunnelling as the particle "borrowing energy" — it emerges with exactly the
  energy it started with;
- superposition as "both 0 and 1 at once" in the classical sense;
- entanglement implying communication, or a change in the far party's local
  statistics;
- measurement described as the universe checking or choosing;
- Shor implying RSA falls to a small device soon — the resource estimate is
  ~20 million physical qubits (Gidney & Ekerå, 2021);
- QKD conflated with post-quantum cryptography — a physical-layer key exchange
  versus classical software already being standardised;
- a logical qubit conflated with a physical one.

## What the harness exposed

**Fixed — a physics error in the offline set.** The Bell-state answer said the
two qubits are "perfectly correlated in every measurement basis you can choose
in a matched way". False for Y: (Y⊗Y)|Φ+⟩ = −|Φ+⟩, so ⟨YY⟩ = −1 and matched Y
measurements always *disagree*, which follows from YY = −XX·ZZ. This one matters
beyond pedantry: the sign pattern is what a Bell test measures, and stating it
wrong makes "they were secretly labelled all along" look viable.

**Fixed — the same class of error in the retrieval corpus.**
`services/agent/agent/knowledge.py`'s entanglement entry said measuring one
member "instantly fixes the statistics of the other", then two sentences later
correctly said each side alone sees uniform randomness. That is the
entanglement-implies-communication error inside the tutor's own reference
material. The Bell entry now also carries the X/Z-agree, Y-anti-correlates fact.

**Mostly fixed (2026-08-25) — the wrong-chunk problem was the per-lesson
dedupe, not the ranker or the chunker.** Routing was 25/25 while nine questions
failed: the right lesson always came back, but `_course_hits_as_concepts` kept
only its single best-scoring chunk, and for "how much faster is Grover" that
was a quiz Q&A chunk discussing over-rotation while √N, "provably optimal" and
"overshoot" all sat in the lesson's keypoints chunk, which scored 0.085 —
above noise, below the 0.10 citation floor, and discarded by the dedupe
anyway. The fix (in `knowledge.py`, no index rebuild): merge up to three
chunks per routed lesson, prefer its keypoints chunk, and admit siblings at a
0.05 floor once the lesson's best chunk has cleared 0.10. Five of the nine
now pass; retrieval was 21/25, mean coverage 93%, before the content residuals
were closed the same day (see the 2026-08-25 residuals section above; retrieval
is now 25/25).

**Closed (2026-08-25, later the same day) — the four remaining retrieval
questions were content gaps, and the content was added on the curated side.**
The original analysis, kept because its diagnosis drove the fix — each missing
cue was grepped for in `data/lessons.json`:
"X and Z agree, Y anti-correlates" exists only in `knowledge.py`'s curated
fallback (the 2026-08-17 fix landed there, not in the lessons); "predictions
unchanged" (measurement interpretations) and "only some problems get a
speedup" appear in no lesson at all; and the VQE lesson states ⟨H⟩ = Σ c_i⟨P_i⟩
in chunks that share no vocabulary with "what is VQE", so no ranker tweak can
surface them. Twice before a retrieval failure turned out to be missing
content; this time it is four of the four remaining. The lasting fix is lesson
content, which lives in `apps/web` — outside this service. What closed the gap
here was the curated side: the facts were added to (or already lived in)
`knowledge.py`'s blurbs, and the top-up / named-concept logic now gets them
into the retrieved material — see the residuals section above.

Note that `knowledge.py` is the keyword **fallback**; when the RAG index is
present (`search_source() == "rag"`) the lesson index answers instead. Fixes to
`knowledge.py` therefore improve the degraded path, not the primary one.

**Open — the live agent tier is ungraded.** It is the tier users actually hit
when a key is configured, and the one that can invent things. The harness has no
way to reach it here. Whoever has a key should run it and record the score, and
until someone does, this document must keep saying the tier is unmeasured.

The same caveat now covers the stage-A2 debugging loop (run → inspect →
localize → propose fix → re-run). Its two new tools — `inspect_statevector`
(per-step exact states) and `diff_circuits` (structural QASM diff) — are pure
functions with offline unit tests (`services/agent/tests/test_debug_loop_tools.py`),
and `core.debug_loop_guidance()` is asserted to name every stage and quote the
enforced round budget. What no test here can show is whether the **model
follows the loop** — actually inspecting before diagnosing, and re-running
before presenting a fix. That is live-tier behaviour: whoever grades the live
tier should include a broken-circuit case (e.g. a Bell pair whose `cx` was
typed as `cz`) and check the answer cites the observed step states rather than
theory.
