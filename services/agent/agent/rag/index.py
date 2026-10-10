"""Build and load the course retrieval index.

WHY TF-IDF AND NOT A VECTOR DATABASE
------------------------------------
The design doc asked for Pinecone or pgvector behind an embedding model. This
project's central constraint is that everything works offline with no API key,
so an embedding service is not available by default and a local sentence
transformer would mean a multi-hundred-megabyte model download at first use.
TF-IDF over locally-built vectors needs none of that:

* **No API key, no network, no model download.** scikit-learn is used at build
  time only; query time is pure Python over sparse dicts.
* **Deterministic.** The same lessons produce byte-identical vectors, so a
  retrieval regression shows up in CI rather than in a learner's session.
* **Reviewable.** The index is JSON, not pickle — a diff shows which chunks and
  which terms changed, and there is no cross-version unpickling footgun.

The honest trade-off is that TF-IDF matches vocabulary, not meaning. It handles
the common case where a learner's phrasing overlaps the course's phrasing even
partially (and bigrams plus sublinear term frequency help a lot), but it will
miss a genuine paraphrase that shares no words at all.

UPGRADE PATH
------------
:class:`Index` exposes exactly one query-time method, ``search(query, top_k)``,
returning ``(score, chunk_metadata)`` pairs. Swapping in embeddings means
writing an alternative builder that stores dense vectors under the same JSON
envelope and an ``Index`` variant whose ``search`` embeds the query and does the
same cosine similarity. Nothing in :mod:`agent.rag.retrieve` or
:mod:`agent.knowledge` needs to change.

The index is a **build artifact**: it is written by ``python -m agent.rag.index``
and committed. Importing this module never builds anything.
"""

from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

from agent.rag.chunker import (
    DEFAULT_OVERLAP_WORDS,
    DEFAULT_TARGET_WORDS,
    build_chunks,
)

#: Schema version of the persisted index; a mismatch means "rebuild".
INDEX_VERSION: int = 1

#: Token pattern, matching scikit-learn's ``TfidfVectorizer`` default.
TOKEN_PATTERN: str = r"(?u)\b\w\w+\b"

#: Suffixes stripped by :func:`stem`, longest first. Deliberately conservative:
#: the goal is to unify the inflections the course and its learners actually mix
#: ("entangled"/"entanglement", "measure"/"measurement"/"measurements"), not to
#: implement full Porter. Over-stemming collides unrelated words and hurts.
_SUFFIXES: tuple[tuple[str, str], ...] = (
    ("ements", ""),
    ("ement", ""),
    ("ments", ""),
    ("ment", ""),
    ("ations", ""),
    ("ation", ""),
    ("ities", "ity"),
    ("iness", "y"),
    ("ness", ""),
    ("ingly", ""),
    ("edly", ""),
    ("ings", ""),
    ("ing", ""),
    ("ies", "y"),
    ("sses", "ss"),
    ("ied", "y"),
    ("ed", ""),
    ("es", ""),
    ("s", ""),
)

#: Doubled final consonants collapsed after suffix stripping, so that
#: "tunnelling" -> "tunnell" -> "tunnel" meets "tunnel".
_DOUBLES: frozenset[str] = frozenset("bdgklmnprt")

#: Weights below this are dropped when persisting: they never change a ranking
#: and they triple the size of the diff.
MIN_WEIGHT: float = 1e-4

_AGENT_DIR = Path(__file__).resolve().parents[1]

#: Where ``scripts/export-lessons.mjs`` writes its JSON.
DEFAULT_LESSONS_PATH: Path = _AGENT_DIR.parent / "data" / "lessons.json"

#: Where the committed index artifact lives.
DEFAULT_INDEX_PATH: Path = _AGENT_DIR.parent / "data" / "course_index.json"


# --------------------------------------------------------------------------- #
# Query-time analyzer (pure Python, must match the build-time vectorizer)
# --------------------------------------------------------------------------- #


def stem(word: str) -> str:
    """Reduce a word to a crude stem so inflections match each other.

    TF-IDF compares strings, so without this "why do entangled qubits agree"
    shares no term at all with a lesson that says "entanglement". One suffix is
    stripped, never below three characters, and a doubled final consonant is
    collapsed.

    Args:
        word: A single lowercase token.

    Returns:
        The stem, or the word unchanged when no rule applies.
    """
    if len(word) <= 3:
        return word
    for suffix, replacement in _SUFFIXES:
        if word.endswith(suffix) and len(word) - len(suffix) + len(replacement) >= 3:
            word = word[: -len(suffix)] + replacement
            break
    if word.endswith("e") and len(word) > 3:
        word = word[:-1]
    if len(word) > 3 and word[-1] == word[-2] and word[-1] in _DOUBLES:
        word = word[:-1]
    return word


def preprocess(text: str, stop_words: Iterable[str]) -> str:
    """Lowercase, drop stop words and stem — the shared build/query front end.

    This runs as the vectorizer's ``preprocessor`` at build time and inside
    :func:`analyze` at query time, so the two sides cannot drift. Stop words are
    removed *before* stemming (a stemmed "does" would no longer be recognised as
    one) and before n-grams are formed, so bigrams join content words that were
    adjacent after filtering.

    Args:
        text: Raw document or query text.
        stop_words: The stop-word list to filter with.

    Returns:
        A space-joined string of stemmed content tokens.
    """
    stops = set(stop_words)
    return " ".join(
        stem(t) for t in re.findall(TOKEN_PATTERN, text.lower()) if t not in stops
    )


def analyze(
    text: str,
    stop_words: Iterable[str],
    ngram_max: int = 2,
    ngram_min: int = 1,
) -> list[str]:
    """Tokenize ``text`` the way the build-time vectorizer does.

    Preprocess (lowercase, stop words, stem) and then form n-grams — the same
    order scikit-learn applies, which matters because filtering before joining
    changes which bigrams exist.

    Args:
        text: Raw query or document text.
        stop_words: The stop-word list persisted with the index, so query-time
            analysis provably matches build-time analysis.
        ngram_max: Largest n-gram size to emit.
        ngram_min: Smallest n-gram size to emit.

    Returns:
        The analyzed terms, with repeats preserved so term frequency is real.
    """
    stops = set(stop_words)
    # The second filter mirrors scikit-learn, which applies ``stop_words`` after
    # the preprocessor: a token whose stem happens to be a stop word is dropped
    # on both sides rather than only at build time.
    tokens = [
        t for t in re.findall(TOKEN_PATTERN, preprocess(text, stops)) if t not in stops
    ]

    terms: list[str] = []
    for n in range(ngram_min, ngram_max + 1):
        if n == 1:
            terms.extend(tokens)
            continue
        for i in range(len(tokens) - n + 1):
            terms.append(" ".join(tokens[i : i + n]))
    return terms


# --------------------------------------------------------------------------- #
# The index
# --------------------------------------------------------------------------- #


@dataclass
class Index:
    """An in-memory TF-IDF index over course chunks.

    Attributes:
        vocabulary: Term -> column position.
        idf: Inverse document frequency per column position.
        vectors: One sparse row per chunk, as ``{column: l2-normalized weight}``.
        chunks: Per-chunk metadata, aligned with ``vectors``.
        stop_words: The stop-word list used at build time.
        ngram_range: The n-gram range used at build time.
        sublinear_tf: Whether ``1 + log(tf)`` scaling was used at build time.
    """

    vocabulary: dict[str, int]
    idf: list[float]
    vectors: list[dict[int, float]]
    chunks: list[dict[str, Any]]
    stop_words: list[str] = field(default_factory=list)
    ngram_range: tuple[int, int] = (1, 2)
    sublinear_tf: bool = True

    def __len__(self) -> int:
        """Return the number of indexed chunks."""
        return len(self.chunks)

    def embed_query(self, query: str) -> dict[int, float]:
        """Vectorize a query into a sparse, L2-normalized TF-IDF row.

        Args:
            query: Free-text query.

        Returns:
            ``{column: weight}``. Empty when no query term is in the vocabulary.
        """
        counts: dict[int, float] = {}
        for term in analyze(
            query, self.stop_words, self.ngram_range[1], self.ngram_range[0]
        ):
            column = self.vocabulary.get(term)
            if column is not None:
                counts[column] = counts.get(column, 0.0) + 1.0

        row: dict[int, float] = {}
        for column, tf in counts.items():
            weight = (1.0 + math.log(tf)) if self.sublinear_tf else tf
            row[column] = weight * self.idf[column]

        norm = math.sqrt(sum(w * w for w in row.values()))
        if norm == 0.0:
            return {}
        return {c: w / norm for c, w in row.items()}

    def search(self, query: str, top_k: int = 4) -> list[tuple[float, dict[str, Any]]]:
        """Return the ``top_k`` chunks most similar to ``query``.

        Cosine similarity in pure Python: both sides are already L2-normalized,
        so the similarity is just the sparse dot product. Iteration is over the
        query's terms, not the corpus, which keeps this fast without sklearn.

        Args:
            query: Free-text query.
            top_k: Maximum number of hits to return.

        Returns:
            ``(score, chunk)`` pairs sorted by descending score. Chunks scoring
            zero are omitted, so an out-of-vocabulary query returns ``[]``.
        """
        query_row = self.embed_query(query)
        if not query_row or top_k <= 0:
            return []

        scores: dict[int, float] = {}
        for i, row in enumerate(self.vectors):
            total = 0.0
            # Iterate the shorter side: queries are tiny compared to chunks.
            for column, weight in query_row.items():
                doc_weight = row.get(column)
                if doc_weight:
                    total += weight * doc_weight
            if total > 0.0:
                scores[i] = total

        ranked = sorted(scores.items(), key=lambda pair: (-pair[1], pair[0]))
        return [(score, self.chunks[i]) for i, score in ranked[:top_k]]


# --------------------------------------------------------------------------- #
# Build
# --------------------------------------------------------------------------- #


def build_index(
    lessons_path: str | Path,
    out_path: str | Path,
    target_words: int = DEFAULT_TARGET_WORDS,
    overlap_words: int = DEFAULT_OVERLAP_WORDS,
) -> dict[str, Any]:
    """Build the TF-IDF index from exported lessons and persist it as JSON.

    Requires scikit-learn, which is a **build-time** dependency only — nothing
    at query time imports it.

    Args:
        lessons_path: Path to ``data/lessons.json`` from the export script.
        out_path: Where to write the index artifact.
        target_words: Chunk size target, passed to the chunker.
        overlap_words: Chunk overlap, passed to the chunker.

    Returns:
        Stats: ``chunks``, ``lessons``, ``vocabulary``, ``nonzero``, ``words``,
        ``out_path`` and the build parameters.

    Raises:
        FileNotFoundError: If ``lessons_path`` does not exist.
        ValueError: If the export contains no usable text.
    """
    from sklearn.feature_extraction.text import ENGLISH_STOP_WORDS, TfidfVectorizer

    lessons_path = Path(lessons_path)
    out_path = Path(out_path)
    payload = json.loads(lessons_path.read_text(encoding="utf-8"))

    chunks = build_chunks(payload, target_words, overlap_words)
    if not chunks:
        raise ValueError(f"No chunks produced from {lessons_path}")

    vectorizer = TfidfVectorizer(
        sublinear_tf=True,
        stop_words="english",
        ngram_range=(1, 2),
        min_df=1,
        preprocessor=lambda doc: preprocess(doc, ENGLISH_STOP_WORDS),
    )
    # The lesson title rides along with every chunk it came from: a chunk deep
    # inside the entanglement lesson rarely repeats the word "entanglement", and
    # without this a query naming the topic ranks incidental matches elsewhere
    # above the lesson that actually teaches it. Only the indexed copy carries
    # the title; the stored chunk text stays exactly what a learner would read.
    matrix = vectorizer.fit_transform(
        [f"{c['lesson_title']}. {c['text']}" for c in chunks]
    )

    vocabulary = {term: int(i) for term, i in vectorizer.vocabulary_.items()}
    idf = [float(v) for v in vectorizer.idf_]
    stop_words = sorted(str(w) for w in vectorizer.get_stop_words() or ())

    csr = matrix.tocsr()
    vectors: list[dict[str, float]] = []
    nonzero = 0
    for i in range(csr.shape[0]):
        start, end = csr.indptr[i], csr.indptr[i + 1]
        row: dict[str, float] = {}
        for column, value in zip(csr.indices[start:end], csr.data[start:end]):
            weight = round(float(value), 6)
            if weight >= MIN_WEIGHT:
                row[str(int(column))] = weight
        # Re-normalize after pruning so cosine similarity stays a cosine.
        norm = math.sqrt(sum(w * w for w in row.values()))
        if norm:
            row = {c: round(w / norm, 6) for c, w in row.items()}
        nonzero += len(row)
        vectors.append(row)

    document = {
        "version": INDEX_VERSION,
        "built_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": lessons_path.name,
        "vectorizer": "tfidf",
        "params": {
            "sublinear_tf": True,
            "stop_words": "english",
            "ngram_range": [1, 2],
            "min_df": 1,
            "target_words": target_words,
            "overlap_words": overlap_words,
        },
        "stop_words": stop_words,
        "vocabulary": vocabulary,
        "idf": [round(v, 6) for v in idf],
        "chunks": [{k: v for k, v in c.items()} for c in chunks],
        "vectors": vectors,
    }

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(
        json.dumps(document, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
    )

    return {
        "chunks": len(chunks),
        "lessons": len({c["lesson_slug"] for c in chunks}),
        "vocabulary": len(vocabulary),
        "nonzero": nonzero,
        "words": sum(len(c["text"].split()) for c in chunks),
        "target_words": target_words,
        "overlap_words": overlap_words,
        "out_path": str(out_path),
    }


# --------------------------------------------------------------------------- #
# Load
# --------------------------------------------------------------------------- #


def load_index(path: str | Path) -> Index | None:
    """Load an index artifact, returning ``None`` instead of raising.

    Callers treat a missing or unusable index as "fall back to keyword search",
    so this never raises: an absent file, malformed JSON, or a schema version
    from the future all yield ``None``.

    Args:
        path: Path to the index JSON.

    Returns:
        The loaded :class:`Index`, or ``None`` when it cannot be used.
    """
    try:
        raw = Path(path).read_text(encoding="utf-8")
        document = json.loads(raw)
    except (OSError, ValueError):
        return None

    try:
        if int(document.get("version", 0)) != INDEX_VERSION:
            return None
        vocabulary = {str(k): int(v) for k, v in document["vocabulary"].items()}
        idf = [float(v) for v in document["idf"]]
        chunks = list(document["chunks"])
        vectors = [
            {int(column): float(weight) for column, weight in row.items()}
            for row in document["vectors"]
        ]
        if len(vectors) != len(chunks):
            return None
        params = document.get("params", {})
        ngram = params.get("ngram_range", [1, 2])
        return Index(
            vocabulary=vocabulary,
            idf=idf,
            vectors=vectors,
            chunks=chunks,
            stop_words=[str(w) for w in document.get("stop_words", [])],
            ngram_range=(int(ngram[0]), int(ngram[1])),
            sublinear_tf=bool(params.get("sublinear_tf", True)),
        )
    except (KeyError, TypeError, ValueError, AttributeError, IndexError):
        return None


def _main() -> int:
    """Rebuild the committed index from ``data/lessons.json`` and print stats."""
    import argparse

    parser = argparse.ArgumentParser(description="Build the course TF-IDF index.")
    parser.add_argument("--lessons", default=str(DEFAULT_LESSONS_PATH))
    parser.add_argument("--out", default=str(DEFAULT_INDEX_PATH))
    parser.add_argument("--target-words", type=int, default=DEFAULT_TARGET_WORDS)
    parser.add_argument("--overlap-words", type=int, default=DEFAULT_OVERLAP_WORDS)
    args = parser.parse_args()

    stats = build_index(args.lessons, args.out, args.target_words, args.overlap_words)
    print(f"Wrote {stats['out_path']}")
    for key in ("lessons", "chunks", "words", "vocabulary", "nonzero"):
        print(f"  {key:11} {stats[key]}")
    return 0


if __name__ == "__main__":  # pragma: no cover - CLI entry point
    raise SystemExit(_main())
