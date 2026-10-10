"""Tests for the agent tool implementations.

Every test here runs offline: no Anthropic API key, no network, and no
LangChain installed. The tools are called through their plain ``_..._impl``
functions, which is exactly how they are expected to behave standalone.
"""

from __future__ import annotations

import pytest

from agent import config
from agent.tools import (
    _check_circuit_impl,
    _explain_measurement_impl,
    _generate_circuit_impl,
    _run_quantum_circuit_impl,
    _search_concepts_impl,
)

BELL_QASM = """OPENQASM 3.0;
include "stdgates.inc";
qubit[2] q;
bit[2] c;
h q[0];
cx q[0], q[1];
c = measure q;
"""


def test_generate_bell() -> None:
    """A Bell request yields a real 2-qubit H+CNOT circuit."""
    result = _generate_circuit_impl("make me a bell state")
    assert "error" not in result
    assert result["num_qubits"] == 2
    qasm = result["qasm"].lower()
    assert "h q[0]" in qasm
    assert "cx" in qasm
    assert "openqasm 3.0" in qasm
    assert result["explanation"]


def test_generate_unknown_returns_hint() -> None:
    """An unmatched description returns an error plus a usable hint."""
    result = _generate_circuit_impl("a sandwich made of purple wednesday")
    assert "error" in result
    assert "hint" in result
    assert "run_quantum_circuit" in result["hint"]


def test_explain_correlated() -> None:
    """Perfectly correlated counts are called out as entanglement/correlation."""
    text = _explain_measurement_impl({"00": 500, "11": 500}).lower()
    assert "entangl" in text or "correlat" in text


def test_explain_uniform() -> None:
    """An evenly spread distribution is described as uniform or even."""
    text = _explain_measurement_impl(
        {"00": 250, "01": 250, "10": 250, "11": 250}
    ).lower()
    assert "uniform" in text or "even" in text


def test_explain_empty() -> None:
    """Empty counts produce a helpful string instead of raising."""
    text = _explain_measurement_impl({})
    assert isinstance(text, str)
    assert text.strip()


def test_search_concepts() -> None:
    """Concept search finds real entries and degrades helpfully."""
    hit = _search_concepts_impl("entanglement")
    assert hit.strip()
    assert "entangl" in hit.lower()

    miss = _search_concepts_impl("zzzz qwertyuiop nonsense")
    assert isinstance(miss, str)
    assert miss.strip()
    assert "superposition" in miss.lower()


def test_check_empty_circuit() -> None:
    """A circuit with declarations but no gates is reported as doing nothing."""
    qasm = 'OPENQASM 3.0;\ninclude "stdgates.inc";\nqubit[2] q;\nbit[2] c;\n'
    report = _check_circuit_impl(qasm).lower()
    assert "no gate" in report


def test_check_out_of_range() -> None:
    """A gate on q[5] in a 2-qubit register is flagged."""
    qasm = (
        'OPENQASM 3.0;\ninclude "stdgates.inc";\n'
        "qubit[2] q;\nbit[2] c;\nh q[0];\nh q[5];\nc = measure q;\n"
    )
    report = _check_circuit_impl(qasm)
    assert "q[5]" in report or "index 5" in report
    assert report != "No problems found."


def test_check_clean_circuit() -> None:
    """A valid Bell circuit passes static analysis."""
    report = _check_circuit_impl(BELL_QASM)
    assert report.startswith("No problems found.")


def test_run_falls_back_local(monkeypatch: pytest.MonkeyPatch) -> None:
    """With the API unreachable, the circuit still runs on the local simulator."""
    monkeypatch.setattr(config.settings, "quantum_api_url", "http://127.0.0.1:9")

    result = _run_quantum_circuit_impl(BELL_QASM, shots=256)

    assert "error" not in result, result.get("error")
    assert result["source"] == "local"
    assert result["counts"]
    assert sum(result["counts"].values()) == 256
    assert set(result["counts"]) <= {"00", "11"}
    assert result["summary"]
