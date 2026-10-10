"""Query-time retrieval over the course index.

This is the module the tutor's tools talk to. It loads the committed index once
per process, searches it, and renders hits into a citation-friendly context
block. It imports no third-party package: scikit-learn is needed to *build* the
index, never to query it.

Every function degrades quietly. If the index artifact is missing — a fresh
checkout that has not run the build, say — :func:`search_course` returns an
empty list and the caller falls back to keyword search.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from agent.rag.index import DEFAULT_INDEX_PATH, Index, load_index

#: Default relevance floor. Cosine scores over TF-IDF are small in absolute
#: terms; below roughly 0.05 a hit is usually one incidental shared word.
DEFAULT_MIN_SCORE: float = 0.05

#: Character budget for :func:`format_for_model`, chosen to stay well inside a
#: system-prompt-sized context without truncating a typical four-hit result.
DEFAULT_CONTEXT_CHARS: int = 4000

#: Environment variable that overrides the index location (used by tests).
INDEX_PATH_ENV: str = "QUANTUM_LAB_RAG_INDEX"

_CACHE: dict[str, Index | None] = {}


def index_path() -> Path:
    """Return the path the index is loaded from.

    Returns:
        The value of ``QUANTUM_LAB_RAG_INDEX`` if set, otherwise the committed
        artifact path ``services/agent/data/course_index.json``.
    """
    override = os.environ.get(INDEX_PATH_ENV)
    return Path(override) if override else DEFAULT_INDEX_PATH


def get_index() -> Index | None:
    """Load the index, caching the result per path for the process lifetime.

    Returns:
        The loaded :class:`Index`, or ``None`` when no usable artifact exists.
    """
    key = str(index_path())
    if key not in _CACHE:
        _CACHE[key] = load_index(key)
    return _CACHE[key]


def reset_cache() -> None:
    """Drop the cached index.

    Useful after rebuilding the artifact in a long-running process, and in
    tests that point :data:`INDEX_PATH_ENV` at a fixture.
    """
    _CACHE.clear()


def is_index_available() -> bool:
    """Report whether real course retrieval is available.

    Returns:
        ``True`` when an index artifact loaded successfully and holds at least
        one chunk.
    """
    index = get_index()
    return index is not None and len(index) > 0


def search_course(
    query: str,
    top_k: int = 4,
    min_score: float = DEFAULT_MIN_SCORE,
) -> list[dict[str, Any]]:
    """Search the course content for passages relevant to ``query``.

    Args:
        query: A learner's question, in natural language.
        top_k: Maximum number of excerpts to return.
        min_score: Cosine-similarity floor; hits below it are discarded so a
            nonsense query returns nothing rather than its least-bad match.

    Returns:
        Hits sorted by descending score, each a dict with ``text``,
        ``lesson_slug``, ``lesson_title``, ``score``, ``url`` and the chunk's
        ``block_kind``, ``track``, ``level`` and ``position``. Returns ``[]``
        when there is no index or nothing clears the threshold.
    """
    index = get_index()
    if index is None or not (query or "").strip() or top_k <= 0:
        return []

    hits: list[dict[str, Any]] = []
    for score, chunk in index.search(query, top_k=top_k):
        if score < min_score:
            continue
        slug = str(chunk.get("lesson_slug", ""))
        hits.append(
            {
                "text": str(chunk.get("text", "")),
                "lesson_slug": slug,
                "lesson_title": str(chunk.get("lesson_title", "")),
                "score": round(float(score), 6),
                "url": f"/learn/{slug}",
                "block_kind": str(chunk.get("block_kind", "")),
                "track": str(chunk.get("track", "")),
                "level": str(chunk.get("level", "")),
                "position": int(chunk.get("position", 0)),
            }
        )
    return hits


def format_for_model(
    hits: list[dict[str, Any]],
    max_chars: int = DEFAULT_CONTEXT_CHARS,
) -> str:
    """Render hits as a compact, citable context block.

    Each excerpt is headed by its lesson title and URL so the model can point
    the learner at the exact lesson instead of paraphrasing anonymously.

    Args:
        hits: The output of :func:`search_course`.
        max_chars: Total character budget. Excerpts that do not fit are dropped
            whole rather than cut mid-sentence, and the count of dropped hits is
            stated at the end so nothing silently disappears.

    Returns:
        The formatted block, or a short "nothing found" line when ``hits`` is
        empty.
    """
    if not hits:
        return "No course material matched that question."

    header = "Course excerpts (cite the lesson by title and link):"
    parts: list[str] = [header]
    used = len(header)
    included = 0

    for hit in hits:
        block = (
            f"\n[{hit.get('lesson_title', '')}] {hit.get('url', '')}\n"
            f"{str(hit.get('text', '')).strip()}"
        )
        if included and used + len(block) > max_chars:
            break
        parts.append(block)
        used += len(block)
        included += 1

    trimmed = len(hits) - included
    if trimmed > 0:
        parts.append(
            f"\n({trimmed} further excerpt{'s' if trimmed != 1 else ''} trimmed "
            "to stay within the context budget.)"
        )

    return "\n".join(parts)
