"""Tests for course retrieval (chunking, indexing, search, fallback).

Everything here is hermetic: no network, no API key, and no dependency on the
committed index artifact. Each test that needs an index builds a small one from
the fixture below into a temp directory, so the suite passes on a fresh checkout
and cannot be fooled by a stale artifact.

scikit-learn is imported only where an index is built, which is exactly the
production split: build-time dependency, pure-Python query time.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from agent import knowledge
from agent.rag import retrieve
from agent.rag.chunker import build_chunks, chunk_text
from agent.rag.index import build_index, load_index

# --------------------------------------------------------------------------- #
# Fixture course
# --------------------------------------------------------------------------- #

# Deliberately written the way the real lessons are: the entanglement lesson
# explains correlated outcomes without ever using the words "measurements of two
# qubits always match", and the tunnelling lesson never says "wall". That gap is
# the whole point — keyword scoring over titles cannot bridge it.
FIXTURE_LESSONS: dict[str, Any] = {
    "lessons": [
        {
            "slug": "entanglement",
            "title": "Entanglement",
            "subtitle": "Two qubits, one shared description.",
            "level": "Intermediate",
            "minutes": 12,
            "track": "foundations",
            "blocks": [
                {
                    "kind": "prose",
                    "text": (
                        "Prepare the Bell state and then measure both qubits in "
                        "the computational basis. You will find that the two "
                        "outcomes are perfectly correlated: whenever the first "
                        "qubit reads zero the second reads zero as well, and "
                        "whenever the first reads one so does the second. The "
                        "results agree every single time, run after run, and "
                        "they agree no matter how far apart the two qubits are "
                        "carried before anybody looks at them.\n\n"
                        "The reason the outcomes always coincide is that the "
                        "pair has no separable description. Neither qubit "
                        "carries a definite value in advance; the correlation "
                        "lives in the joint state, which is why a measurement "
                        "on one side fixes what the other side will report."
                    ),
                },
                {
                    "kind": "quiz",
                    "text": (
                        "Question: Does the perfect agreement between the two "
                        "outcomes let you send a signal faster than light?\n"
                        "Answer: No.\n"
                        "Why: Each side on its own sees a uniformly random "
                        "string. The agreement only becomes visible once the "
                        "two records are compared over an ordinary classical "
                        "channel, which travels no faster than light."
                    ),
                },
                {
                    "kind": "embed",
                    "text": "Entanglement visualization\nDrag the detectors.\n/x",
                },
            ],
        },
        {
            "slug": "tunneling",
            "title": "Quantum Tunneling",
            "subtitle": "Getting past a barrier you cannot climb.",
            "level": "Intermediate",
            "minutes": 10,
            "track": "foundations",
            "blocks": [
                {
                    "kind": "prose",
                    "text": (
                        "A classical particle that arrives at a barrier taller "
                        "than its own energy simply turns around. It cannot get "
                        "through, because getting through would require energy "
                        "it does not have. A quantum particle is not so easily "
                        "stopped.\n\n"
                        "The wavefunction does not stop dead at the edge of the "
                        "barrier. It decays exponentially inside the forbidden "
                        "region, and if the barrier is thin enough some "
                        "amplitude is still left when the far side is reached. "
                        "That leftover amplitude means there is a real chance of "
                        "finding the particle on the other side, having passed "
                        "straight through a barrier it could never have climbed."
                    ),
                },
                {
                    "kind": "code",
                    "text": (
                        "Transmission falls off exponentially with thickness.\n"
                        "Code example (python):\n"
                        "import numpy as np\n"
                        "kappa = np.sqrt(2 * m * (V0 - E)) / hbar\n"
                        "T = np.exp(-2 * kappa * L)\n"
                    ),
                },
            ],
        },
        {
            "slug": "grover",
            "title": "Grover's Search",
            "subtitle": "A quadratic speedup for unstructured search.",
            "level": "Intermediate",
            "minutes": 15,
            "track": "foundations",
            "blocks": [
                {
                    "kind": "prose",
                    "text": (
                        "Checking an unsorted list one entry at a time costs "
                        "about half of the entries on average. Grover's routine "
                        "instead marks the target with an oracle and then "
                        "reflects every amplitude about their mean, which nudges "
                        "the marked amplitude upward a little on each round.\n\n"
                        "After roughly the square root of the number of items "
                        "rounds the marked amplitude dominates and a single "
                        "measurement returns the answer with high probability."
                    ),
                },
                {
                    "kind": "keypoints",
                    "text": (
                        "- The speedup is quadratic, not exponential.\n"
                        "- Running too many rounds overshoots and the "
                        "probability falls again."
                    ),
                },
            ],
        },
    ]
}

PROSE = (
    "Amplitudes are complex numbers and that is the whole story. "
    "They can be negative, which probabilities cannot.\n\n"
    "When two computational paths lead to the same outcome their amplitudes are "
    "added before the modulus is squared. Adding a positive amplitude to an "
    "equal negative one gives zero, so the outcome never happens at all. "
    "Classical probabilities can only ever pile up.\n\n"
    "That cancellation is called destructive interference. Every quantum "
    "algorithm worth the name is an arrangement of amplitudes in which the "
    "wrong answers cancel and the right one survives the sum."
)


@pytest.fixture(scope="module")
def built_index(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """Build an index from the fixture course and return its path."""
    directory = tmp_path_factory.mktemp("rag")
    lessons_path = directory / "lessons.json"
    lessons_path.write_text(json.dumps(FIXTURE_LESSONS), encoding="utf-8")
    index_path = directory / "course_index.json"
    build_index(lessons_path, index_path)
    return index_path


@pytest.fixture()
def course_index(built_index: Path, monkeypatch: pytest.MonkeyPatch):
    """Point the retrieval layer at the fixture index for the duration of a test."""
    monkeypatch.setenv(retrieve.INDEX_PATH_ENV, str(built_index))
    retrieve.reset_cache()
    yield built_index
    retrieve.reset_cache()


@pytest.fixture()
def no_index(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Point the retrieval layer at a path where no index exists."""
    missing = tmp_path / "absent" / "course_index.json"
    monkeypatch.setenv(retrieve.INDEX_PATH_ENV, str(missing))
    retrieve.reset_cache()
    yield missing
    retrieve.reset_cache()


# --------------------------------------------------------------------------- #
# Chunking
# --------------------------------------------------------------------------- #


def test_chunk_text_respects_target_size() -> None:
    """Chunks stay near the target and none of them is empty."""
    chunks = chunk_text(PROSE, target_words=40, overlap_words=8)
    assert len(chunks) > 1
    for chunk in chunks:
        assert chunk.strip()
        # The target is a packing goal, not a hard cut: a chunk may run over by
        # at most the final unit it absorbed, plus the overlap prefix.
        assert len(chunk.split()) <= 40 * 2 + 8


def test_chunk_text_empty_input() -> None:
    """Blank input yields no chunks rather than one empty one."""
    assert chunk_text("") == []
    assert chunk_text("   \n\n  ") == []


def test_chunk_text_overlaps_consecutive_chunks() -> None:
    """Each chunk repeats some words from the tail of the one before it."""
    chunks = chunk_text(PROSE, target_words=40, overlap_words=12)
    assert len(chunks) >= 2
    for previous, following in zip(chunks, chunks[1:]):
        previous_tail = set(previous.split()[-30:])
        following_head = set(following.split()[:30])
        assert previous_tail & following_head, "consecutive chunks share no words"


def test_chunk_text_short_input_is_one_chunk() -> None:
    """Text below the target is not split."""
    chunks = chunk_text("A single short paragraph about qubits.", target_words=180)
    assert len(chunks) == 1


def test_build_chunks_preserves_metadata() -> None:
    """Every chunk can be cited: slug, title and position all survive."""
    chunks = build_chunks(FIXTURE_LESSONS)
    assert chunks
    slugs = {"entanglement", "tunneling", "grover"}
    for chunk in chunks:
        assert chunk["lesson_slug"] in slugs
        assert chunk["lesson_title"]
        assert chunk["text"].strip()
        assert isinstance(chunk["position"], int)
        assert chunk["id"].startswith(chunk["lesson_slug"])


def test_build_chunks_skips_embeds_and_keeps_code_whole() -> None:
    """Embed blocks are dropped; a code listing is never split."""
    chunks = build_chunks(FIXTURE_LESSONS, target_words=10, overlap_words=2)
    assert all(chunk["block_kind"] != "embed" for chunk in chunks)
    code = [c for c in chunks if c["block_kind"] == "code"]
    assert len(code) == 1
    assert "kappa" in code[0]["text"] and "np.exp" in code[0]["text"]


# --------------------------------------------------------------------------- #
# Index build / load
# --------------------------------------------------------------------------- #


def test_build_then_load_round_trips(tmp_path: Path) -> None:
    """The artifact reloads with the same chunk count the build reported."""
    lessons_path = tmp_path / "lessons.json"
    lessons_path.write_text(json.dumps(FIXTURE_LESSONS), encoding="utf-8")
    index_path = tmp_path / "course_index.json"

    stats = build_index(lessons_path, index_path)
    assert index_path.exists()
    assert stats["chunks"] == len(build_chunks(FIXTURE_LESSONS))
    assert stats["lessons"] == 3
    assert stats["vocabulary"] > 0

    index = load_index(index_path)
    assert index is not None
    assert len(index) == stats["chunks"]
    assert len(index.vectors) == stats["chunks"]
    assert len(index.idf) == stats["vocabulary"]
    # JSON, not pickle: the artifact must be readable as plain text.
    assert json.loads(index_path.read_text(encoding="utf-8"))["vectorizer"] == "tfidf"


def test_load_index_missing_returns_none(tmp_path: Path) -> None:
    """A missing or corrupt artifact yields None instead of raising."""
    assert load_index(tmp_path / "nope.json") is None
    broken = tmp_path / "broken.json"
    broken.write_text("{not json", encoding="utf-8")
    assert load_index(broken) is None
    wrong_version = tmp_path / "old.json"
    wrong_version.write_text(json.dumps({"version": 999}), encoding="utf-8")
    assert load_index(wrong_version) is None


# --------------------------------------------------------------------------- #
# Search quality — the reason this package exists
# --------------------------------------------------------------------------- #


def test_search_finds_entanglement_without_shared_title_words(course_index) -> None:
    """A paraphrase with no title words still finds the entanglement lesson.

    "why do measurements of two qubits always match" shares no content word with
    the title "Entanglement" — the exact case the old keyword scorer got wrong.
    """
    hits = retrieve.search_course("why do measurements of two qubits always match")
    assert hits
    assert hits[0]["lesson_slug"] == "entanglement"
    assert hits[0]["url"] == "/learn/entanglement"
    assert hits[0]["score"] > 0


def test_search_finds_tunneling_for_a_wall(course_index) -> None:
    """"How does a particle get through a wall" retrieves the tunnelling lesson."""
    hits = retrieve.search_course("how does a particle get through a wall")
    assert hits
    assert hits[0]["lesson_slug"] == "tunneling"


def test_search_finds_grover(course_index) -> None:
    """A question about beating exhaustive checking retrieves Grover."""
    hits = retrieve.search_course(
        "is there a quicker way than checking an unsorted list entry by entry"
    )
    assert hits
    assert hits[0]["lesson_slug"] == "grover"


def test_search_gibberish_returns_nothing(course_index) -> None:
    """Out-of-vocabulary nonsense clears no threshold."""
    assert retrieve.search_course("xyzzy plugh frobnicate qwertyuiop zzzz") == []


def test_search_respects_top_k_and_threshold(course_index) -> None:
    """top_k caps the result count and min_score filters weak matches."""
    hits = retrieve.search_course("measure the two qubits", top_k=2)
    assert len(hits) <= 2
    assert retrieve.search_course("measure the two qubits", min_score=0.99) == []


def test_index_availability_and_formatting(course_index) -> None:
    """The formatted block names the lesson and links it, and reports trimming."""
    assert retrieve.is_index_available() is True
    hits = retrieve.search_course("why do the two outcomes always agree", top_k=3)
    assert hits
    block = retrieve.format_for_model(hits)
    assert "/learn/" in block
    assert hits[0]["lesson_title"] in block

    trimmed = retrieve.format_for_model(hits, max_chars=120)
    assert "trimmed" in trimmed
    assert retrieve.format_for_model([]).strip()


def test_search_without_index_is_empty(no_index) -> None:
    """With no artifact present, retrieval reports unavailable and returns []."""
    assert retrieve.is_index_available() is False
    assert retrieve.search_course("entanglement") == []


# --------------------------------------------------------------------------- #
# knowledge.search_concepts: RAG first, curated blurbs as fallback
# --------------------------------------------------------------------------- #

CONCEPT_KEYS = {"id", "title", "keywords", "summary"}


def test_search_concepts_falls_back_without_index(no_index) -> None:
    """Without an index the curated keyword scorer answers, in its usual shape."""
    results = knowledge.search_concepts("entanglement", top_k=3)
    assert results
    assert len(results) <= 3
    assert knowledge.search_source() == "keyword"
    for concept in results:
        assert CONCEPT_KEYS <= set(concept)
        assert isinstance(concept["keywords"], list)
        assert concept["summary"].strip()
    assert any("entangl" in c["id"] for c in results)

    assert knowledge.search_concepts("zzzz qwertyuiop nonsense", top_k=3) == []
    assert knowledge.concept_titles()
    assert len(knowledge.CONCEPTS) >= 18


def test_search_concepts_uses_rag_when_available(course_index) -> None:
    """With an index, the same call returns cited course excerpts instead."""
    results = knowledge.search_concepts(
        "why do measurements of two qubits always match", top_k=3
    )
    assert results
    assert knowledge.search_source() == "rag"
    for concept in results:
        assert CONCEPT_KEYS <= set(concept)
    assert results[0]["id"] == "entanglement"
    assert "/learn/entanglement" in results[0]["summary"]
    # One result per lesson, not three windows onto the same paragraph.
    assert len({c["id"] for c in results}) == len(results)


def test_search_concepts_merges_sibling_chunks(course_index) -> None:
    """A routed lesson's excerpt merges chunks instead of keeping only the best.

    The question's wording matches the Grover prose chunk, but the facts the
    grader (and a learner) needs — "quadratic, not exponential", overshoot —
    live in the lesson's keypoints chunk. The single-best-chunk version of
    ``_course_hits_as_concepts`` measurably dropped them (docs/TUTOR.md,
    2026-08-25: retrieval 16/25 -> 21/25 from this change alone).
    """
    results = knowledge.search_concepts(
        "how much faster is Grover than checking entries one at a time", top_k=3
    )
    assert results
    assert knowledge.search_source() == "rag"
    grover = next(c for c in results if c["id"] == "grover")
    # Prose chunk (matches the question's wording) and keypoints chunk (holds
    # the answer) are both present in the one merged summary.
    assert "reflects every amplitude about their mean" in grover["summary"]
    assert "quadratic, not exponential" in grover["summary"]
    assert "overshoots" in grover["summary"]
    # Still exactly one citation footer per lesson, and one entry per lesson.
    assert grover["summary"].count("/learn/grover") == 1
    assert len({c["id"] for c in results}) == len(results)


def test_search_concepts_rag_miss_falls_back(course_index) -> None:
    """A topic the fixture course does not cover still gets a curated answer."""
    results = knowledge.search_concepts("no cloning theorem", top_k=2)
    assert results
    assert knowledge.search_source() == "keyword"
    assert any(c["id"] == "no_cloning" for c in results)
