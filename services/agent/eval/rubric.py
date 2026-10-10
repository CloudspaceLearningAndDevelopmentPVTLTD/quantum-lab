"""The grading engine shared by every tier of the tutor evaluation.

WHAT THIS GRADER CAN AND CANNOT DO — read this before quoting a score.

It is a **pattern grader**, not a comprehension grader. For each question the
set in :mod:`questions.json` declares:

* ``must_include`` — groups of alternative regular expressions. A group scores
  if ANY of its alternatives appears. This tests that the required *vocabulary
  and facts* are present, and nothing more. A passage can hit every group and
  still be nonsense, in the same way a student can list the right words in the
  wrong order.
* ``must_not_include`` — misconception phrases that must be ABSENT. This is the
  half of the rubric that is genuinely diagnostic rather than merely suggestive:
  a tutor that says a tunnelling particle "borrows energy" is wrong regardless
  of how good the rest of the sentence is, and no amount of surrounding fluency
  redeems it.

Because good teaching *quotes a misconception in order to kill it* — the course
text literally contains the sentence "The most persistent story about tunnelling
is that the particle briefly 'borrows' energy … That picture is wrong" — a naive
absence check would fail the best answer in the corpus. So a forbidden match is
counted as a violation only when no refutation cue ("not", "wrong", "myth",
"misconception", "never", …) appears within ``refutation_window`` characters
either side of it.

That heuristic is wrong in both directions and the number it produces should be
read with that in mind:

* **False pass.** "This is not the place to explain it, but the particle borrows
  energy from the vacuum" contains a cue and would be forgiven.
* **False fail.** A text that refutes a misconception using none of the listed
  cues ("the particle keeps the energy it arrived with; the borrowing story is a
  fable") would be marked a violation.

Everything else a human would call quality — whether the physics reasoning is
sound, whether the analogy misleads, whether the level fits the learner, whether
the answer is well written, whether a cited number is current — is invisible to
this grader. See docs/TUTOR.md § "What the grader cannot detect".
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

QUESTIONS_PATH = Path(__file__).resolve().parent / "questions.json"

#: Character substitutions applied before matching, so a rubric pattern does not
#: have to be written twice for "|0⟩" and "|0>" or for "α" and "a". The same map
#: is implemented in eval/rubric.mjs and the two MUST stay in step — the offline
#: tier is graded in Node and the other two in Python, against one question set.
NORMALIZE: dict[str, str] = {
    "⟩": ">",  # ⟩
    "⟨": "<",  # ⟨
    "∣": "|",  # ∣
    "−": "-",  # −  (minus sign)
    "–": "-",  # –
    "—": "-",  # —
    "’": "'",  # ’
    "“": '"',
    "”": '"',
    " ": " ",
    "²": "^2",  # ²
    "³": "^3",  # ³
    "ⁿ": "^n",  # ⁿ
    "ˣ": "^x",  # ˣ
    "¹": "^1",  # ¹
    "⁰": "^0",  # ⁰
    "⁻": "^-",  # ⁻
    "√": "sqrt",  # √
    "κ": "kappa",  # κ
    "α": "a",  # α
    "β": "b",  # β
    "π": "pi",  # π
    "≈": "~",  # ≈
    "≤": "<=",  # ≤
    "≥": ">=",  # ≥
    "×": "*",  # ×
    "⋅": "*",  # ⋅
    "′": "'",  # ′
}


def normalize(text: str) -> str:
    """Lower-case ``text`` and fold the notation variants in :data:`NORMALIZE`.

    Args:
        text: Raw answer or excerpt.

    Returns:
        The normalized string that rubric patterns are matched against.
    """
    out = str(text or "")
    for src, dst in NORMALIZE.items():
        out = out.replace(src, dst)
    return out.lower()


@dataclass(frozen=True)
class QuestionSet:
    """The graded question set, plus the shared refutation-cue configuration."""

    version: int
    refutation_window: int
    refutation_cues: list[str]
    questions: list[dict[str, Any]]

    def by_id(self, question_id: str) -> dict[str, Any] | None:
        """Return the question with this id, or ``None``."""
        for question in self.questions:
            if question["id"] == question_id:
                return question
        return None


def load_questions(path: Path | str = QUESTIONS_PATH) -> QuestionSet:
    """Load :mod:`questions.json`.

    Args:
        path: Override for the question-set location.

    Returns:
        The parsed :class:`QuestionSet`.
    """
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    return QuestionSet(
        version=int(data["version"]),
        refutation_window=int(data["refutation_window"]),
        refutation_cues=[str(cue) for cue in data["refutation_cues"]],
        questions=list(data["questions"]),
    )


@dataclass
class Grade:
    """The outcome of grading one answer against one question."""

    question_id: str
    passed: bool
    matched: list[str] = field(default_factory=list)
    missing: list[str] = field(default_factory=list)
    violations: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    @property
    def coverage(self) -> float:
        """Fraction of ``must_include`` groups that matched (1.0 when none)."""
        total = len(self.matched) + len(self.missing)
        return 1.0 if total == 0 else len(self.matched) / total

    def as_dict(self) -> dict[str, Any]:
        """Return a JSON-serializable view."""
        return {
            "question_id": self.question_id,
            "passed": self.passed,
            "coverage": round(self.coverage, 4),
            "matched": self.matched,
            "missing": self.missing,
            "violations": self.violations,
            "notes": self.notes,
        }


def _cue_nearby(text: str, start: int, end: int, cues: list[str], window: int) -> str | None:
    """Return the refutation cue found around ``[start, end)``, if any."""
    left = max(0, start - window)
    right = min(len(text), end + window)
    context = text[left:right]
    for cue in cues:
        if cue in context:
            return cue
    return None


def grade_answer(question: dict[str, Any], answer: str, qset: QuestionSet) -> Grade:
    """Grade one answer against one question's rubric.

    Args:
        question: An entry from :attr:`QuestionSet.questions`.
        answer: The text a tier produced (an offline answer, the concatenated
            retrieved excerpts, or a live model reply).
        qset: The loaded question set, for the shared refutation configuration.

    Returns:
        A :class:`Grade`. ``passed`` requires every ``must_include`` group to
        match AND zero unrefuted ``must_not_include`` matches.
    """
    text = normalize(answer)
    grade = Grade(question_id=str(question["id"]), passed=False)

    for group in question.get("must_include", []):
        name = str(group["name"])
        if any(re.search(pattern, text, re.IGNORECASE) for pattern in group["any"]):
            grade.matched.append(name)
        else:
            grade.missing.append(name)

    for forbidden in question.get("must_not_include", []):
        name = str(forbidden["name"])
        for match in re.finditer(forbidden["pattern"], text, re.IGNORECASE):
            cue = _cue_nearby(
                text, match.start(), match.end(), qset.refutation_cues, qset.refutation_window
            )
            if cue is None:
                grade.violations.append(f"{name}: {match.group(0)!r}")
                break
            grade.notes.append(f"{name}: quoted then refuted (cue {cue!r})")
            break

    grade.passed = not grade.missing and not grade.violations
    return grade
