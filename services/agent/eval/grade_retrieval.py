"""Grade tier 2 of the tutor: the knowledge/RAG layer. NO MODEL CALL.

This is the second half of the CI-runnable evaluation (the first is
``eval/offline_probe.mjs``). It asks the same graded questions the other tiers
get and grades what ``search_concepts`` actually hands the model — which is the
honest thing to measure, because the live tutor is instructed to prefer that
text over its own recollection.

It calls the REAL tool implementation, ``agent.tools._search_concepts_impl``,
not ``knowledge.search_concepts`` directly, so the fencing and formatting the
model really sees are part of what is graded.

Two numbers come out of it, and they mean different things:

* **Routing** — did the retrieved material come from the lesson the question
  belongs to? A miss here is a ranking problem.
* **Coverage / pass** — does the retrieved material actually contain the facts
  needed to answer? A miss here, with routing correct, is a CONTENT problem:
  the right lesson was found and the fact is not in it. That distinction is the
  whole reason both are reported. In this project a retrieval failure has twice
  turned out to be missing content rather than a bad ranker, so check coverage
  before touching the vectorizer.

Usage:
    cd services/agent && .venv/bin/python -m eval.grade_retrieval [--json]

Exit code 0 when every question passes, 1 otherwise.
"""

from __future__ import annotations

import argparse
import json
import sys
from typing import Any

from agent import knowledge
from agent.rag import retrieve
from agent.tools import _search_concepts_impl

from eval.rubric import Grade, QuestionSet, grade_answer, load_questions


def grade_all(qset: QuestionSet) -> list[dict[str, Any]]:
    """Ask every question of the retrieval layer and grade the material returned.

    Args:
        qset: The loaded question set.

    Returns:
        One result dict per question.
    """
    results: list[dict[str, Any]] = []
    for question in qset.questions:
        hits = knowledge.search_concepts(question["question"], top_k=3)
        source = knowledge.search_source()
        text = _search_concepts_impl(question["question"])
        grade: Grade = grade_answer(question, text, qset)

        returned_ids = [str(hit.get("id", "")) for hit in hits]
        expected = [str(item) for item in question.get("retrieval_expect", [])]
        routed = any(item in returned_ids for item in expected)

        results.append(
            {
                **grade.as_dict(),
                "topic": question["topic"],
                "source": source,
                "returned": returned_ids,
                "expected_any_of": expected,
                "routed": routed,
                "passed": grade.passed and routed,
                "rubric_passed": grade.passed,
            }
        )
    return results


def main(argv: list[str] | None = None) -> int:
    """Run the retrieval-tier evaluation and print a report."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", action="store_true", help="emit machine-readable JSON")
    args = parser.parse_args(argv)

    qset = load_questions()
    results = grade_all(qset)

    passed = sum(1 for r in results if r["passed"])
    routed = sum(1 for r in results if r["routed"])
    clean = sum(1 for r in results if not r["violations"])
    coverage = sum(r["coverage"] for r in results) / max(1, len(results))

    summary = {
        "tier": "retrieval",
        "module": "services/agent/agent/knowledge.py + agent/rag/",
        "model_call": False,
        "index_available": retrieve.is_index_available(),
        "index_path": str(retrieve.index_path()),
        "total": len(results),
        "passed": passed,
        "routed_to_expected_lesson": routed,
        "no_misconception": clean,
        "mean_coverage": round(coverage, 4),
    }

    if args.json:
        print(json.dumps({"summary": summary, "results": results}, indent=2))
    else:
        print("Tier: RETRIEVAL (agent/knowledge.py + agent/rag/) — no model call")
        print("=" * 78)
        for r in results:
            mark = "PASS" if r["passed"] else "FAIL"
            print(
                f"{mark}  {r['question_id']:<32} {r['source']:<8} "
                f"{round(r['coverage'] * 100):>3}%  {','.join(r['returned'])}"
            )
            if not r["routed"]:
                print(f"        routing: expected one of {r['expected_any_of']}")
            for m in r["missing"]:
                print(f"        missing: {m}")
            for v in r["violations"]:
                print(f"        MISCONCEPTION: {v}")
        print("=" * 78)
        print(
            f"{passed}/{len(results)} passed | routed correctly {routed}/{len(results)} | "
            f"mean coverage {coverage:.0%} | no misconception {clean}/{len(results)} | "
            f"index available: {retrieve.is_index_available()}"
        )

    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
