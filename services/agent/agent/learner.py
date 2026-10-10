"""Learner progress modelling for the tutor agent.

Where the data comes from
-------------------------
Course progress lives entirely in the learner's **browser**, under the
localStorage keys ``quantum-lab.progress`` (completed lessons, quiz scores,
last visited lesson) and ``quantum-lab.exam-attempts`` (exam history). A Python
service has no way to read localStorage, and it must not pretend otherwise.

So the flow is one-directional and explicit: the web route that proxies a chat
turn reads localStorage in the client, attaches the progress payload to the
request body, and the agent receives it as an ordinary function argument. The
agent never reaches into a browser, never holds a per-learner database, and
never fabricates progress it was not given. If no payload arrives, the correct
behaviour is "no profile available" — a signed-out or first-time learner is the
normal case, not an error.

Because that payload has travelled through a browser, it may be partial, stale
from an older schema version, or hand-edited by a curious learner with devtools
open. :func:`parse_progress` therefore validates every field and degrades to a
sane default rather than raising, mirroring the defensive ``normalize()`` in
``apps/web/lib/lessons/progress.ts``.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from agent import curriculum

__all__ = [
    "LearnerProfile",
    "PASS_THRESHOLD",
    "parse_progress",
    "infer_level",
    "weak_concepts",
    "summarise",
]

#: A quiz score at or above this fraction counts as "understood". Below it the
#: lesson is treated as shaky and worth revising before advancing.
PASS_THRESHOLD: float = 0.7


@dataclass
class LearnerProfile:
    """A normalised view of one learner's course progress.

    Attributes:
        completed: Slugs of lessons the learner has marked complete, filtered to
            slugs the course actually has and put back into course order.
        quiz_scores: Lesson slug -> best quiz score as a fraction in 0..1.
        exam_best: Exam id -> best exam score as a fraction in 0..1, derived
            from the ``quantum-lab.exam-attempts`` history.
        circuits_saved: How many circuits the learner has saved in the builder.
        last_visited: The slug of the lesson they were last reading, if known.
        level: The inferred difficulty band — ``"beginner"``, ``"intermediate"``
            or ``"advanced"``. Set by :func:`infer_level`, never self-reported.
    """

    completed: list[str] = field(default_factory=list)
    quiz_scores: dict[str, float] = field(default_factory=dict)
    exam_best: dict[str, float] = field(default_factory=dict)
    circuits_saved: int = 0
    last_visited: str | None = None
    level: str = "beginner"


def _as_fraction(value: Any) -> float | None:
    """Coerce a score of unknown provenance into a fraction in 0..1.

    Scores reach us either as fractions (``0.67``) or as percentages (``67``),
    depending on which part of the web app wrote them, so anything above 1 and
    at most 100 is interpreted as a percentage.

    Args:
        value: The raw value from the payload.

    Returns:
        A float in 0..1, or ``None`` when the value is not a usable number.
    """
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    number = float(value)
    if number != number or number in (float("inf"), float("-inf")):  # NaN / inf
        return None
    if number < 0:
        return 0.0
    if number > 1.0:
        if number <= 100.0:
            return number / 100.0
        return 1.0
    return number


def _score_map(raw: Any) -> dict[str, float]:
    """Extract a slug -> fraction mapping from an untrusted object.

    Args:
        raw: The candidate mapping, which may be any JSON value at all.

    Returns:
        A dict containing only the entries with a string key and a usable
        numeric value. Never raises.
    """
    if not isinstance(raw, dict):
        return {}
    result: dict[str, float] = {}
    for key, value in raw.items():
        if not isinstance(key, str) or not key.strip():
            continue
        fraction = _as_fraction(value)
        if fraction is None:
            continue
        result[key.strip()] = fraction
    return result


def _exam_best(raw: Any) -> dict[str, float]:
    """Reduce an exam-attempt history to the best score per exam.

    Accepts either the list-of-attempts shape written by
    ``lib/exams/attempts.ts`` or an already-reduced ``{examId: score}`` mapping,
    because both have appeared in request payloads.

    Args:
        raw: The ``exam_attempts`` / ``examAttempts`` value from the payload.

    Returns:
        Exam id -> best score as a fraction in 0..1.
    """
    if isinstance(raw, dict):
        return _score_map(raw)
    if not isinstance(raw, list):
        return {}

    best: dict[str, float] = {}
    for attempt in raw:
        if not isinstance(attempt, dict):
            continue
        exam_id = attempt.get("examId") or attempt.get("exam_id") or attempt.get("id")
        if not isinstance(exam_id, str) or not exam_id.strip():
            continue
        fraction = _as_fraction(attempt.get("score"))
        if fraction is None:
            continue
        key = exam_id.strip()
        if fraction > best.get(key, -1.0):
            best[key] = fraction
    return best


def parse_progress(raw: dict[str, Any] | None) -> LearnerProfile:
    """Turn a browser progress payload into a validated :class:`LearnerProfile`.

    The payload is untrusted input: it may be ``None``, the wrong type entirely,
    missing every key, carry nulls where strings belong, use camelCase or
    snake_case keys, or contain slugs that no longer exist in the course. Each
    field is validated independently and a bad field degrades to its default
    without discarding the good ones. This function never raises.

    Args:
        raw: The decoded ``quantum-lab.progress`` object (optionally with an
            ``exam_attempts``/``examAttempts`` key carrying the exam history),
            as forwarded by the web route.

    Returns:
        A :class:`LearnerProfile` with :attr:`LearnerProfile.level` already set
        by :func:`infer_level`.
    """
    profile = LearnerProfile()
    if not isinstance(raw, dict):
        return profile

    known = set(curriculum.LESSON_SLUGS)

    completed_raw = raw.get("completed")
    if isinstance(completed_raw, (list, tuple, set)):
        seen: set[str] = set()
        for item in completed_raw:
            if isinstance(item, str) and item.strip().lower() in known:
                seen.add(item.strip().lower())
        profile.completed = [s for s in curriculum.LESSON_SLUGS if s in seen]

    scores = _score_map(raw.get("quizScores"))
    scores.update(_score_map(raw.get("quiz_scores")))
    profile.quiz_scores = {k.lower(): v for k, v in scores.items()}

    profile.exam_best = _exam_best(
        raw.get("examAttempts") if raw.get("examAttempts") is not None else raw.get("exam_attempts")
    )

    circuits = raw.get("circuitsSaved")
    if circuits is None:
        circuits = raw.get("circuits_saved")
    if isinstance(circuits, list):
        profile.circuits_saved = len(circuits)
    elif isinstance(circuits, (int, float)) and not isinstance(circuits, bool):
        try:
            profile.circuits_saved = max(0, int(circuits))
        except (ValueError, OverflowError):
            profile.circuits_saved = 0

    last = raw.get("lastVisited")
    if not isinstance(last, str):
        last = raw.get("last_visited")
    if isinstance(last, str) and last.strip():
        profile.last_visited = last.strip().lower()

    profile.level = infer_level(profile)
    return profile


def infer_level(profile: LearnerProfile) -> str:
    """Infer the difficulty band to pitch an explanation at.

    Inferred from behaviour, never from self-report, because learners are poor
    judges of their own level in this subject in both directions. The thresholds:

    * **advanced** — at least 6 lessons complete *and* at least one Advanced
      lesson complete, with a mean quiz score of 0.8 or better (or no quiz data
      at all, in which case completion alone carries it).
    * **intermediate** — at least 3 lessons complete, or at least 2 complete
      with a mean quiz score of 0.7 or better.
    * **beginner** — everything else, including a learner with no progress.

    A mean quiz score below 0.5 caps the result at ``"intermediate"`` no matter
    how many lessons are ticked off: clicking "complete" is cheap, answering
    correctly is not.

    Args:
        profile: The parsed profile to judge.

    Returns:
        One of ``"beginner"``, ``"intermediate"``, ``"advanced"``.
    """
    completed = set(profile.completed)
    n_done = len(completed)

    scores = list(profile.quiz_scores.values())
    mean_score = sum(scores) / len(scores) if scores else None

    advanced_done = any(
        (curriculum.get_lesson(slug) or {}).get("level") == "Advanced" for slug in completed
    )

    level = "beginner"
    if n_done >= 3 or (n_done >= 2 and mean_score is not None and mean_score >= PASS_THRESHOLD):
        level = "intermediate"
    if n_done >= 6 and advanced_done and (mean_score is None or mean_score >= 0.8):
        level = "advanced"

    if mean_score is not None and mean_score < 0.5 and level == "advanced":
        level = "intermediate"
    return level


def weak_concepts(profile: LearnerProfile) -> list[str]:
    """Identify the lessons this learner should shore up, most blocking first.

    Two different signals are merged:

    1. **Shaky** — lessons whose recorded quiz score is below
       :data:`PASS_THRESHOLD`. The learner has met the material and it did not
       stick.
    2. **Ready but avoided** — lessons whose prerequisites are all complete but
       which the learner has never started. In practice this is the more useful
       signal: it is where someone has quietly stalled, and it is invisible from
       quiz scores alone.

    Ordering is by how *blocking* each lesson is — how many other lessons sit
    downstream of it in the prerequisite graph — with lower quiz scores and
    earlier course position breaking ties. That puts the thing holding up the
    most of the course first.

    Args:
        profile: The parsed profile to analyse.

    Returns:
        Lesson slugs, most blocking first. Empty when nothing stands out.
    """
    completed = set(profile.completed)
    blocking: dict[str, int] = {slug: 0 for slug in curriculum.LESSON_SLUGS}
    for slug in curriculum.LESSON_SLUGS:
        for ancestor in curriculum.prerequisites_of(slug, transitive=True):
            blocking[ancestor] = blocking.get(ancestor, 0) + 1

    candidates: dict[str, float] = {}

    for slug, score in profile.quiz_scores.items():
        if curriculum.get_lesson(slug) is not None and score < PASS_THRESHOLD:
            candidates[slug] = score

    for slug in curriculum.unlocked_lessons(completed):
        if slug in completed or slug in profile.quiz_scores:
            continue
        # Unstarted but unlocked: no score, treated as maximally uncertain.
        candidates.setdefault(slug, PASS_THRESHOLD)

    order = {slug: i for i, slug in enumerate(curriculum.LESSON_SLUGS)}
    return sorted(
        candidates,
        key=lambda slug: (-blocking.get(slug, 0), candidates[slug], order.get(slug, 99)),
    )


def summarise(profile: LearnerProfile) -> str:
    """Write a short paragraph about the learner, ready to drop into an answer.

    Args:
        profile: The parsed profile to describe.

    Returns:
        Two to four plain sentences naming how far along the learner is, how
        their quizzes have gone, where they left off, and what looks shaky. For
        an empty profile it says so explicitly rather than inventing progress.
    """
    total = len(curriculum.LESSON_SLUGS)
    n_done = len(profile.completed)

    if n_done == 0 and not profile.quiz_scores:
        return (
            "This learner has no recorded progress yet — no lessons completed and no "
            f"quizzes taken out of {total} lessons. Treat them as a beginner and start "
            "from 'What Is a Qubit?' unless they say otherwise."
        )

    parts: list[str] = []
    titles = [
        (curriculum.get_lesson(slug) or {}).get("title", slug) for slug in profile.completed
    ]
    if titles:
        listed = ", ".join(titles[-3:])
        parts.append(
            f"This learner has completed {n_done} of {total} lessons "
            f"(most recently {listed}) and reads as {profile.level} level."
        )
    else:
        parts.append(
            f"This learner has completed no lessons yet but has attempted "
            f"{len(profile.quiz_scores)} quiz(zes); they read as {profile.level} level."
        )

    if profile.quiz_scores:
        mean = sum(profile.quiz_scores.values()) / len(profile.quiz_scores)
        low = [slug for slug, s in profile.quiz_scores.items() if s < PASS_THRESHOLD]
        sentence = (
            f"Their quiz average across {len(profile.quiz_scores)} lesson(s) is "
            f"{100.0 * mean:.0f}%"
        )
        if low:
            sentence += f", with weak results on {', '.join(sorted(low))}"
        parts.append(sentence + ".")

    if profile.exam_best:
        best = max(profile.exam_best.values())
        parts.append(f"Their best exam score so far is {100.0 * best:.0f}%.")

    if profile.circuits_saved:
        parts.append(
            f"They have saved {profile.circuits_saved} circuit(s) in the builder, so "
            "they are comfortable being shown QASM."
        )

    if profile.last_visited:
        lesson = curriculum.get_lesson(profile.last_visited)
        where = lesson["title"] if lesson else profile.last_visited
        parts.append(f"They were last reading {where}.")

    weak = weak_concepts(profile)
    if weak:
        parts.append(
            "The most useful thing to revisit next is "
            f"{', '.join(weak[:2])} — either the score was low or the prerequisites are "
            "done but the lesson never was."
        )

    return " ".join(parts)
