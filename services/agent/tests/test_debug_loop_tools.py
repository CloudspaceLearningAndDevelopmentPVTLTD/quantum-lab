"""The agent debugging-loop tools (roadmap stage A2).

Everything here runs offline: no API key, no network, no LangChain. The tools
are exercised through their plain ``_..._impl`` functions, which is how the
whole suite tests tools, and the statevector maths is checked against the two
states every textbook agrees on — |+0> after the Hadamard of a Bell circuit,
(|00> + |11>)/sqrt(2) after its CNOT.

What is NOT tested here: the live loop itself — whether the model actually
follows execute → inspect → localize → fix → re-run. That needs an Anthropic
key and is part of the unmeasured live tier (docs/TUTOR.md). What CAN be
asserted without a key is that the instructions exist, name the loop's steps,
and quote the real round budget.
"""

from __future__ import annotations

import pytest

from agent import core
from agent.config import settings
from agent.tools import (
    MAX_DIFF_OPS,
    MAX_INSPECT_QUBITS,
    MAX_INSPECT_STEPS,
    _diff_circuits_impl,
    _inspect_statevector_impl,
    clamp_steps,
)

BELL_QASM = """OPENQASM 3.0;
include "stdgates.inc";
qubit[2] q;
bit[2] c;
h q[0];
cx q[0], q[1];
c = measure q;
"""

#: The same Bell circuit with a single planted difference: cx became cz.
BROKEN_BELL_QASM = BELL_QASM.replace("cx q[0], q[1];", "cz q[0], q[1];")


def _labels(step: dict) -> set[str]:
    """Return the labels of the dominant basis states of one step."""
    return {entry["label"] for entry in step["amplitudes"]}


# --------------------------------------------------------------------------- #
# inspect_statevector
# --------------------------------------------------------------------------- #


def test_inspect_bell_final_step_is_the_bell_state() -> None:
    """The last step shows the |00>+|11> signature at ~50/50."""
    result = _inspect_statevector_impl(BELL_QASM)
    assert "error" not in result, result
    assert result["num_qubits"] == 2
    assert result["total_gates"] == 2
    assert result["steps_shown"] == 2
    assert result["truncated"] is False

    final = result["steps"][-1]
    assert _labels(final) == {"00", "11"}
    for entry in final["amplitudes"]:
        assert entry["probability"] == pytest.approx(0.5, abs=1e-6)
    # Both qubits are individually 50/50 — neither has a value of its own.
    assert final["prob_one_per_qubit"] == pytest.approx([0.5, 0.5], abs=1e-6)
    assert "|00>" in result["final_state"] and "|11>" in result["final_state"]


def test_inspect_bell_step_one_is_plus_zero() -> None:
    """After only the Hadamard the state is |+> on q[0] and |0> on q[1]."""
    result = _inspect_statevector_impl(BELL_QASM)
    first = result["steps"][0]
    assert first["step"] == 1
    assert first["gate"].startswith("h")
    # |+0>: weight only on labels whose q[1] bit (leftmost) is 0.
    assert _labels(first) == {"00", "01"}
    assert first["prob_one_per_qubit"][0] == pytest.approx(0.5, abs=1e-6)
    assert first["prob_one_per_qubit"][1] == pytest.approx(0.0, abs=1e-6)


def test_inspect_localizes_the_divergence_step() -> None:
    """The broken (cz) Bell shows q[1] never activating — at step 2, not step 1.

    This is the loop's core claim: comparing per-step states against intent
    finds WHERE the bug is. Step 1 matches the good circuit exactly; step 2 is
    where the states part ways.
    """
    good = _inspect_statevector_impl(BELL_QASM)
    bad = _inspect_statevector_impl(BROKEN_BELL_QASM)
    assert good["steps"][0]["prob_one_per_qubit"] == bad["steps"][0]["prob_one_per_qubit"]
    # cz on |+0> does nothing: q[1] stays |0> instead of correlating.
    assert bad["steps"][1]["prob_one_per_qubit"][1] == pytest.approx(0.0, abs=1e-6)
    assert good["steps"][1]["prob_one_per_qubit"][1] == pytest.approx(0.5, abs=1e-6)


def test_inspect_step_count_is_clamped() -> None:
    """A long circuit is truncated to MAX_INSPECT_STEPS, and says so."""
    body = "\n".join("x q[0];" for _ in range(MAX_INSPECT_STEPS + 10))
    qasm = f'OPENQASM 3.0;\ninclude "stdgates.inc";\nqubit[1] q;\n{body}\n'
    result = _inspect_statevector_impl(qasm, max_steps=10**9)
    assert "error" not in result, result
    assert result["steps_shown"] == MAX_INSPECT_STEPS
    assert result["truncated"] is True
    assert result["total_gates"] == MAX_INSPECT_STEPS + 10


def test_inspect_refuses_too_many_qubits() -> None:
    """Above the statevector ceiling the tool refuses instead of burning CPU."""
    n = MAX_INSPECT_QUBITS + 1
    qasm = f'OPENQASM 3.0;\ninclude "stdgates.inc";\nqubit[{n}] q;\nh q[0];\n'
    result = _inspect_statevector_impl(qasm)
    assert "error" in result
    assert str(MAX_INSPECT_QUBITS) in result["error"]


def test_inspect_empty_and_gateless_inputs_are_errors_not_raises() -> None:
    """Junk input comes back as an error dict, never an exception."""
    assert "error" in _inspect_statevector_impl("")
    assert "error" in _inspect_statevector_impl("   ")
    gateless = 'OPENQASM 3.0;\ninclude "stdgates.inc";\nqubit[2] q;\n'
    assert "error" in _inspect_statevector_impl(gateless)
    assert "error" in _inspect_statevector_impl("this is not qasm at all {{{")


def test_clamp_steps_matches_the_clamp_shots_contract() -> None:
    """Absurd, negative and unparseable step counts are all bounded."""
    assert clamp_steps(10**9) == MAX_INSPECT_STEPS
    assert clamp_steps(5) == 5
    assert clamp_steps(0) == 1
    assert clamp_steps(-3) == 1
    assert clamp_steps("lots") == MAX_INSPECT_STEPS
    assert clamp_steps(None) == MAX_INSPECT_STEPS


# --------------------------------------------------------------------------- #
# diff_circuits
# --------------------------------------------------------------------------- #


def test_diff_finds_a_planted_single_gate_difference() -> None:
    """cx vs cz at the same position is reported as one 'changed' entry."""
    result = _diff_circuits_impl(BELL_QASM, BROKEN_BELL_QASM)
    assert result["identical"] is False
    assert len(result["differences"]) == 1
    diff = result["differences"][0]
    assert diff["kind"] == "changed"
    assert diff["position_a"] == 2 and diff["position_b"] == 2
    assert diff["a"] == "cx q[0], q[1]"
    assert diff["b"] == "cz q[0], q[1]"
    assert "cx" in result["summary"] and "cz" in result["summary"]


def test_diff_reports_an_extra_gate() -> None:
    """A gate present in only one circuit shows up as only_in_b."""
    with_extra = BELL_QASM.replace("cx q[0], q[1];", "cx q[0], q[1];\nz q[1];")
    result = _diff_circuits_impl(BELL_QASM, with_extra)
    kinds = {d["kind"] for d in result["differences"]}
    assert kinds == {"only_in_b"}
    assert result["differences"][0]["b"] == "z q[1]"
    assert result["op_count_b"] == result["op_count_a"] + 1


def test_diff_ignores_comments_and_whitespace() -> None:
    """Formatting-only differences are not circuit differences."""
    noisy = BELL_QASM.replace("h q[0];", "  h   q[0];  // make superposition")
    result = _diff_circuits_impl(BELL_QASM, noisy)
    assert result["identical"] is True
    assert result["differences"] == []


def test_diff_is_bounded_on_huge_inputs() -> None:
    """Op comparison is capped at MAX_DIFF_OPS and flagged, never unbounded."""
    body = "\n".join("x q[0];" for _ in range(MAX_DIFF_OPS + 50))
    huge = f'OPENQASM 3.0;\ninclude "stdgates.inc";\nqubit[1] q;\n{body}\n'
    result = _diff_circuits_impl(huge, huge)
    assert result["identical"] is False  # truncated comparison never claims identity
    assert str(MAX_DIFF_OPS) in result["summary"]
    # Raw character input is clamped too, like clamp_shots clamps shots.
    assert result["op_count_a"] <= settings.max_message_chars


def test_diff_empty_input_is_an_error() -> None:
    """Empty circuits come back as an error dict."""
    assert "error" in _diff_circuits_impl("", BELL_QASM)
    assert "error" in _diff_circuits_impl(BELL_QASM, "   ")


# --------------------------------------------------------------------------- #
# The loop instructions (what can be asserted without an API key)
# --------------------------------------------------------------------------- #


def test_debug_loop_guidance_names_every_stage_and_the_budget() -> None:
    """The guidance walks run → inspect → localize → fix → re-run and quotes
    the enforced round ceiling, so prompt and clamp cannot drift apart."""
    text = core.debug_loop_guidance()
    for needle in (
        "run_quantum_circuit",
        "inspect_statevector",
        "diff_circuits",
        "EXECUTE",
        "INSPECT",
        "LOCALIZE",
        "FIX",
        "CONFIRM",
        str(settings.max_tool_rounds),
    ):
        assert needle in text, needle


def test_debug_loop_guidance_is_template_safe() -> None:
    """No braces: the text is interpolated into a ChatPromptTemplate, where a
    stray brace becomes a template variable and breaks every request."""
    text = core.debug_loop_guidance()
    assert "{" not in text and "}" not in text
