"""Split exported lesson content into retrievable, citable chunks.

A retriever is only as good as its units. Whole lessons are too coarse — a
2,000-word lesson matches almost every query weakly and cites nothing precise.
Single sentences are too fine — they lose the context that makes an excerpt
readable. Paragraph-packed chunks of a couple of hundred words sit in between:
long enough to stand on their own when shown to the model, short enough that a
match means something specific.

Every chunk keeps the metadata needed to cite it. A retrieved excerpt without a
lesson slug is useless to a tutor that is supposed to point the learner at the
course.
"""

from __future__ import annotations

import re
from typing import Any

#: Default number of words to aim for per chunk.
DEFAULT_TARGET_WORDS: int = 180

#: Default number of words repeated from the tail of the previous chunk.
DEFAULT_OVERLAP_WORDS: int = 40

#: Block kinds that are links rather than content and carry no teaching text.
SKIPPED_BLOCK_KINDS: frozenset[str] = frozenset({"embed"})

#: Block kinds kept whole regardless of length. Splitting a circuit listing
#: mid-line produces fragments that retrieve badly and read worse.
ATOMIC_BLOCK_KINDS: frozenset[str] = frozenset({"code"})

_SENTENCE_END = re.compile(r"(?<=[.!?…])\s+")


def _words(text: str) -> list[str]:
    """Return the whitespace-separated tokens of ``text``."""
    return text.split()


def _tail_overlap(text: str, overlap_words: int) -> str:
    """Return the trailing ``overlap_words`` words of ``text``, sentence-aligned.

    The tail is snapped to a sentence boundary where one exists inside the
    window, so the overlap never begins mid-clause.
    """
    if overlap_words <= 0:
        return ""
    words = _words(text)
    if not words:
        return ""
    window = " ".join(words[-overlap_words:])
    sentences = _SENTENCE_END.split(window)
    if len(sentences) > 1:
        # Drop the (probably truncated) first fragment.
        snapped = " ".join(sentences[1:]).strip()
        if snapped:
            return snapped
    return window.strip()


def chunk_text(
    text: str,
    target_words: int = DEFAULT_TARGET_WORDS,
    overlap_words: int = DEFAULT_OVERLAP_WORDS,
) -> list[str]:
    """Split ``text`` into overlapping chunks of roughly ``target_words`` words.

    Paragraph boundaries are respected first: paragraphs are packed together
    until the target size is reached, and only a paragraph that on its own
    exceeds the target is split further — and then only on sentence boundaries,
    never mid-sentence.

    Why the overlap matters: a chunk boundary is an arbitrary cut through
    continuous prose. A concept explained across the seam ("...the amplitudes
    cancel. // That cancellation is called destructive interference") would be
    represented in neither chunk strongly enough to win a query about it.
    Repeating the tail of each chunk at the head of the next means every
    sentence appears in a chunk that also carries its immediate context, so
    boundary-straddling ideas stay findable. The cost is a modest amount of
    duplicated text in the index, which is cheap.

    Args:
        text: The text to split. May be empty.
        target_words: Words to aim for per chunk. Chunks may exceed this when a
            single sentence or an unbreakable paragraph is longer.
        overlap_words: Words repeated from the end of the previous chunk at the
            start of the next. Set to 0 to disable overlap.

    Returns:
        A list of non-empty chunk strings. Empty input yields an empty list.
    """
    if not text or not text.strip():
        return []
    if target_words <= 0:
        raise ValueError("target_words must be positive")
    if overlap_words < 0:
        raise ValueError("overlap_words must not be negative")
    overlap_words = min(overlap_words, max(target_words - 1, 0))

    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    if not paragraphs:
        return []

    # Pre-split any paragraph that alone blows past the target, on sentences.
    units: list[str] = []
    for paragraph in paragraphs:
        if len(_words(paragraph)) <= target_words:
            units.append(paragraph)
            continue
        current: list[str] = []
        count = 0
        for sentence in _SENTENCE_END.split(paragraph):
            sentence = sentence.strip()
            if not sentence:
                continue
            n = len(_words(sentence))
            if current and count + n > target_words:
                units.append(" ".join(current))
                current, count = [], 0
            current.append(sentence)
            count += n
        if current:
            units.append(" ".join(current))

    chunks: list[str] = []
    buffer: list[str] = []
    buffered_words = 0

    def flush() -> None:
        nonlocal buffer, buffered_words
        body = "\n\n".join(buffer).strip()
        if not body:
            buffer, buffered_words = [], 0
            return
        prefix = _tail_overlap(chunks[-1], overlap_words) if chunks else ""
        chunks.append(f"{prefix}\n\n{body}".strip() if prefix else body)
        buffer, buffered_words = [], 0

    for unit in units:
        n = len(_words(unit))
        if buffer and buffered_words + n > target_words:
            flush()
        buffer.append(unit)
        buffered_words += n
    flush()

    return [c for c in chunks if c.strip()]


def build_chunks(
    lessons_json: dict[str, Any],
    target_words: int = DEFAULT_TARGET_WORDS,
    overlap_words: int = DEFAULT_OVERLAP_WORDS,
) -> list[dict[str, Any]]:
    """Turn the exported lessons payload into a flat list of citable chunks.

    Args:
        lessons_json: The parsed contents of ``data/lessons.json`` as written by
            ``scripts/export-lessons.mjs``: ``{"lessons": [{slug, title, level,
            track, blocks: [{kind, text}]}]}``. A bare list of lessons is also
            accepted.
        target_words: Passed through to :func:`chunk_text`.
        overlap_words: Passed through to :func:`chunk_text`.

    Returns:
        A list of dicts with the keys ``id``, ``text``, ``lesson_slug``,
        ``lesson_title``, ``block_kind``, ``track``, ``level`` and ``position``.
        ``position`` is the chunk's 0-based index within its lesson, which lets
        a caller show a learner roughly how far into the lesson an excerpt sits.
    """
    lessons = (
        lessons_json
        if isinstance(lessons_json, list)
        else list(lessons_json.get("lessons", []))
    )

    chunks: list[dict[str, Any]] = []
    for lesson in lessons:
        slug = str(lesson.get("slug", "")) or "unknown"
        title = str(lesson.get("title", "")) or slug
        track = str(lesson.get("track", ""))
        level = str(lesson.get("level", ""))
        position = 0

        # The subtitle is short but unusually dense with the lesson's framing,
        # so it rides along with the first chunk of every lesson.
        header = f"{title}. {lesson.get('subtitle', '')}".strip()

        for block in lesson.get("blocks", []):
            kind = str(block.get("kind", ""))
            text = str(block.get("text", "")).strip()
            if not text or kind in SKIPPED_BLOCK_KINDS:
                continue

            if kind in ATOMIC_BLOCK_KINDS:
                pieces = [text]
            else:
                pieces = chunk_text(text, target_words, overlap_words)

            for piece in pieces:
                body = f"{header}\n\n{piece}" if position == 0 and header else piece
                chunks.append(
                    {
                        "id": f"{slug}::{position}",
                        "text": body,
                        "lesson_slug": slug,
                        "lesson_title": title,
                        "block_kind": kind,
                        "track": track,
                        "level": level,
                        "position": position,
                    }
                )
                position += 1

    return chunks
