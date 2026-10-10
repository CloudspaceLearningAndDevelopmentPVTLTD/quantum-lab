"""Retrieval over the real Qubit16 course content.

This package replaces "keyword scoring over a handful of hardcoded blurbs" with
genuine retrieval over the ~20,000 words of lesson prose, callouts, code
listings, key points and quiz explanations that ship with the app.

Layout:

* :mod:`agent.rag.chunker`  — split exported lessons into overlapping, cited chunks.
* :mod:`agent.rag.index`    — build (sklearn, offline) and load (pure Python) a
  TF-IDF index persisted as reviewable JSON.
* :mod:`agent.rag.retrieve` — the query-time API used by the tutor's tools.

Everything works with no API key, no model download and no network. Importing
this package never triggers an index build; the index is a committed artifact.
"""

from __future__ import annotations

__all__ = ["chunker", "index", "retrieve"]
