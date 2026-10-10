"""Content tests for the 2026-08-25 knowledge additions.

These exist because the eval harness (eval/grade_retrieval.py) found four
questions whose failures were CONTENT gaps, not ranking bugs — docs/TUTOR.md
records the numbers. The graders measure the whole pipeline; these tests pin
the specific facts the fixes added, so a later edit that drops one fails a
unit test with a readable name instead of only moving an aggregate score.

They use the curated keyword path only, so they need no course index.
"""

from __future__ import annotations

from agent import knowledge


def _concept(concept_id: str) -> dict:
    return next(c for c in knowledge.CONCEPTS if c["id"] == concept_id)


def test_vqe_concept_states_the_hamiltonian_expectation() -> None:
    """The VQE blurb carries the fact the eval's vqe-nisq question needs."""
    summary = _concept("vqe")["summary"]
    assert "expectation value" in summary
    assert "Hamiltonian" in summary
    assert "variational" in summary.lower()
    assert "upper bound" in summary
    # And it does not oversell: VQE is a heuristic.
    assert "no proof of quantum advantage" in summary


def test_quantum_speedup_concept_kills_the_parallelism_myth() -> None:
    """The speedup blurb states interference + structure, not 'tries everything'."""
    summary = _concept("quantum_speedup")["summary"]
    assert "interference" in summary
    assert "structure" in summary
    assert "no advantage" in summary


def test_measurement_concept_says_predictions_are_interpretation_free() -> None:
    """Interpretations differ; predictions do not (measurement-universe-chooses)."""
    summary = _concept("measurement")["summary"]
    assert "same predictions" in summary
    assert "argue about" in summary


def test_keyword_scorer_routes_vqe_and_speedup_queries() -> None:
    """The new concepts win their own questions without stealing others'."""
    assert knowledge._keyword_concepts(
        "What is VQE, and why is it the algorithm people run on today's noisy hardware?", 1
    )[0]["id"] == "vqe"
    assert knowledge._keyword_concepts(
        "Does a quantum computer get its speed by trying all possible answers in parallel?", 1
    )[0]["id"] == "quantum_speedup"
    # Regression: an early title ("Where Quantum Speedup Comes From") leaked
    # high-idf stopwords into the scorer and hijacked these two queries.
    assert knowledge._keyword_concepts(
        "What is a qubit, and how is it different from a classical bit?", 1
    )[0]["id"] == "qubit"
    assert knowledge._keyword_concepts(
        "How does quantum teleportation move a state, and does it beat the speed of light?", 1
    )[0]["id"] == "teleportation"


def test_named_curated_requires_the_concept_to_be_spelled_out() -> None:
    """The strong-match rider fires only when the query names the blurb."""
    # Named: the query spells out "Bell state" and the course results lack it.
    named = knowledge._named_curated(
        "In the Bell state, are the qubits perfectly correlated in every basis?",
        [{"id": "entanglement"}],
    )
    assert named is not None and named["id"] == "bell_state"
    # Already covered by the course results: never duplicated.
    assert (
        knowledge._named_curated(
            "In the Bell state, are the qubits perfectly correlated in every basis?",
            [{"id": "bell_state"}],
        )
        is None
    )
    # A query that names no curated concept: no rider. (Note that a single-word
    # concept id spelled out in the query — "measurement", "qubit" — DOES
    # qualify as naming it; that is deliberate, the blurb is correct content.)
    assert (
        knowledge._named_curated(
            "why do the paired outcomes always match", [{"id": "entanglement"}]
        )
        is None
    )
