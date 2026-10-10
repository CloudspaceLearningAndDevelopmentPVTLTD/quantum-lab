"""Tests for the "run this paper" tools (agent/paper.py).

Every test runs offline: the one networked function, ``_fetch_arxiv_impl``,
is exercised only against a monkeypatched ``httpx.get``. Template validity is
checked by round-tripping every QASM template through services/api's actual
simulator (``app.quantum.runner``) when that local path is importable, and by
structural assertions otherwise, so the "these templates run as-is" claim in
paper.py is enforced rather than assumed.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

import pytest

from agent.paper import (
    MAX_RESPONSE_BYTES,
    MAX_RUNNABLE_QUBITS,
    PROTOCOL_KEYWORDS,
    PROTOCOL_TEMPLATES,
    _fetch_arxiv_impl,
    _protocol_hints_impl,
    parse_arxiv_id,
)
from agent.tools import UNTRUSTED_CLOSE, UNTRUSTED_OPEN

# The abstract of Hensen et al., "Loophole-free Bell inequality violation
# using electron spins separated by 1.3 kilometres" (arXiv:1508.05949),
# lightly abridged — a real CHSH abstract, as the fixture should be.
CHSH_ABSTRACT = (
    "More than 50 years ago, John Bell proved that no theory of nature that "
    "obeys locality and realism can reproduce all the predictions of quantum "
    "theory. Here we report a Bell experiment that is free of any such "
    "additional assumption and thus directly tests the principles underlying "
    "Bell's inequality. We employ an event-ready scheme that enables the "
    "generation of high-fidelity entanglement between distant electron spins. "
    "Efficient spin readout avoids the fair sampling assumption (detection "
    "loophole), while the use of fast random basis selection and readout "
    "combined with a spatial separation of 1.3 km ensure the required "
    "locality conditions. We perform 245 trials testing the CHSH-Bell "
    "inequality S <= 2 and find S = 2.42 +/- 0.20. A null hypothesis test "
    "yields a probability of p = 0.039 that a local-realist model for "
    "space-like separated sites produces data with a violation at least as "
    "large as observed."
)

# A genuinely out-of-scope abstract: condensed-matter, no runnable protocol.
OUT_OF_SCOPE_ABSTRACT = (
    "We study the thermal Hall conductivity of the layered antiferromagnet "
    "under strong magnetic fields. Using neutron scattering and transport "
    "measurements we identify a magnon band crossing consistent with a "
    "topological transition, and we discuss implications for spin-lattice "
    "coupling in frustrated kagome materials."
)

ATOM_TEMPLATE = """<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <entry>
    <id>http://arxiv.org/abs/1508.05949v2</id>
    <title>Loophole-free Bell inequality violation using electron spins</title>
    <summary>{summary}</summary>
    <category term="quant-ph"/>
    <arxiv:primary_category term="quant-ph"/>
  </entry>
</feed>
"""


class _FakeResponse:
    """The minimal httpx.Response surface _fetch_arxiv_impl touches."""

    def __init__(self, content: bytes) -> None:
        self.content = content

    def raise_for_status(self) -> None:
        return None


def _patch_httpx_get(monkeypatch: pytest.MonkeyPatch, content: bytes) -> list[str]:
    """Replace httpx.get with a canned response; return the URLs requested."""
    import httpx

    calls: list[str] = []

    def fake_get(url: str, **kwargs: Any) -> _FakeResponse:
        calls.append(url)
        assert kwargs.get("timeout") == 10.0
        return _FakeResponse(content)

    monkeypatch.setattr(httpx, "get", fake_get)
    return calls


# --------------------------------------------------------------------------- #
# arXiv id parsing
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    ("given", "expected"),
    [
        ("2401.12345", "2401.12345"),
        ("2401.12345v2", "2401.12345v2"),
        ("quant-ph/0201082", "quant-ph/0201082"),
        ("https://arxiv.org/abs/2401.12345", "2401.12345"),
        ("https://arxiv.org/abs/2401.12345v3", "2401.12345v3"),
        ("http://arxiv.org/abs/quant-ph/0201082", "quant-ph/0201082"),
        ("https://arxiv.org/pdf/2401.12345", "2401.12345"),
        ("https://arxiv.org/pdf/2401.12345.pdf", "2401.12345"),
        ("https://arxiv.org/pdf/2401.12345v1.pdf", "2401.12345v1"),
        ("https://www.arxiv.org/abs/1508.05949", "1508.05949"),
        ("arxiv.org/abs/1508.05949/", "1508.05949"),
        ("see arXiv 1508.05949 for details", "1508.05949"),
    ],
)
def test_parse_arxiv_id_accepts_known_forms(given: str, expected: str) -> None:
    """Bare ids, abs URLs and pdf URLs all resolve to the same canonical id."""
    assert parse_arxiv_id(given) == expected


@pytest.mark.parametrize(
    "given",
    ["", "   ", "not a paper at all", "https://example.com/abs/2401.12345.exe.bin"],
)
def test_parse_arxiv_id_rejects_non_ids(given: str) -> None:
    """Text without an unambiguous arXiv id yields None, never a guess."""
    assert parse_arxiv_id(given) is None


# --------------------------------------------------------------------------- #
# fetch_arxiv (network mocked)
# --------------------------------------------------------------------------- #


def test_fetch_arxiv_parses_metadata(monkeypatch: pytest.MonkeyPatch) -> None:
    """A well-formed Atom response yields title, fenced abstract, categories."""
    from xml.sax.saxutils import escape

    body = ATOM_TEMPLATE.format(summary=escape(CHSH_ABSTRACT)).encode()
    calls = _patch_httpx_get(monkeypatch, body)

    result = _fetch_arxiv_impl("https://arxiv.org/abs/1508.05949")

    assert "error" not in result
    assert result["id"] == "1508.05949"
    assert "Bell inequality" in result["title"]
    assert result["categories"] == ["quant-ph"]
    assert result["url"] == "https://arxiv.org/abs/1508.05949"
    # INJ-1 discipline: the abstract is fenced as reference material.
    assert UNTRUSTED_OPEN in result["summary"]
    assert UNTRUSTED_CLOSE in result["summary"]
    assert "CHSH" in result["summary"]
    # Exactly one request, to the export API, by id.
    assert len(calls) == 1
    assert calls[0].startswith("https://export.arxiv.org/api/query?")
    assert "id_list=1508.05949" in calls[0]


def test_fetch_arxiv_bad_identifier_never_hits_network(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An unparseable identifier errors out before any request is made."""
    calls = _patch_httpx_get(monkeypatch, b"should never be fetched")
    result = _fetch_arxiv_impl("definitely not an arxiv id")
    assert "error" in result
    assert calls == []


def test_fetch_arxiv_network_failure_is_reported(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A raised exception becomes an error dict, never a raise."""
    import httpx

    def boom(url: str, **kwargs: Any) -> Any:
        raise httpx.ConnectTimeout("simulated timeout")

    monkeypatch.setattr(httpx, "get", boom)
    result = _fetch_arxiv_impl("2401.12345")
    assert "error" in result
    assert "arXiv" in result["error"]


def test_fetch_arxiv_caps_response_size(monkeypatch: pytest.MonkeyPatch) -> None:
    """A response over the byte cap is refused, not parsed."""
    _patch_httpx_get(monkeypatch, b"x" * (MAX_RESPONSE_BYTES + 1))
    result = _fetch_arxiv_impl("2401.12345")
    assert "error" in result
    assert str(MAX_RESPONSE_BYTES) in result["error"]


def test_fetch_arxiv_empty_feed_is_a_miss(monkeypatch: pytest.MonkeyPatch) -> None:
    """A feed with no entry (unknown id) reports a miss for that id."""
    empty = b'<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"></feed>'
    _patch_httpx_get(monkeypatch, empty)
    result = _fetch_arxiv_impl("2401.99999")
    assert "error" in result
    assert "2401.99999" in result["error"]


# --------------------------------------------------------------------------- #
# protocol_hints
# --------------------------------------------------------------------------- #


def test_protocol_hints_detects_chsh_from_real_abstract() -> None:
    """The Hensen et al. abstract is recognised as a runnable CHSH/Bell test."""
    result = _protocol_hints_impl(CHSH_ABSTRACT)
    keys = [entry["protocol"] for entry in result["detected"]]
    assert "bell_chsh" in keys

    entry = next(e for e in result["detected"] if e["protocol"] == "bell_chsh")
    assert entry["matched_keywords"]  # e.g. "chsh", "bell inequality"
    assert entry["num_qubits"] <= MAX_RUNNABLE_QUBITS
    _assert_valid_qasm_shape(entry["qasm"])


def test_protocol_hints_out_of_scope_returns_empty_honestly() -> None:
    """A condensed-matter abstract detects nothing and says so plainly."""
    result = _protocol_hints_impl(OUT_OF_SCOPE_ABSTRACT)
    assert result["detected"] == []
    assert "out of scope" in result["summary"].lower()


def test_protocol_hints_empty_input() -> None:
    """Blank input yields an empty detection with an honest summary."""
    result = _protocol_hints_impl("")
    assert result["detected"] == []
    assert result["summary"]


def test_protocol_hints_warns_on_oversized_registers() -> None:
    """A paper about 127-qubit hardware gets a scope warning even on a hit."""
    text = "We run Grover's algorithm on a 127-qubit superconducting processor."
    result = _protocol_hints_impl(text)
    assert any(e["protocol"] == "grover" for e in result["detected"])
    assert "scope_warning" in result
    assert "127" in result["scope_warning"]


def test_every_keyword_key_has_a_template() -> None:
    """The keyword table and the template dict cover exactly the same keys."""
    assert set(PROTOCOL_KEYWORDS) == set(PROTOCOL_TEMPLATES)


# --------------------------------------------------------------------------- #
# Template validity — round-trip through services/api's simulator when local
# --------------------------------------------------------------------------- #

_API_ROOT = Path(__file__).resolve().parents[2] / "api"


def _api_runner() -> Any:
    """Import services/api's runner if the sibling checkout exists, else None."""
    if not (_API_ROOT / "app" / "quantum" / "runner.py").is_file():
        return None
    if str(_API_ROOT) not in sys.path:
        sys.path.insert(0, str(_API_ROOT))
    try:
        from app.quantum import runner  # noqa: PLC0415

        return runner
    except Exception:  # noqa: BLE001 - missing api deps => structural checks only
        return None


def _assert_valid_qasm_shape(qasm: str) -> None:
    """Assert the syntactic structure every template must have."""
    assert qasm.startswith("OPENQASM 3.0;")
    assert 'include "stdgates.inc";' in qasm
    assert "qubit[" in qasm
    assert "bit[" in qasm
    assert "measure" in qasm
    # Every non-comment, non-blank line is a terminated statement.
    for line in qasm.splitlines():
        stripped = line.split("//")[0].strip()
        if stripped:
            assert stripped.endswith(";"), f"unterminated statement: {line!r}"


@pytest.mark.parametrize("protocol", sorted(PROTOCOL_TEMPLATES))
def test_template_is_valid_qasm3(protocol: str) -> None:
    """Every template parses AND runs on services/api's simulator when local.

    When the sibling services/api checkout (or its qiskit stack) is absent,
    fall back to asserting the syntactic structure, per the module contract.
    """
    template = PROTOCOL_TEMPLATES[protocol]
    _assert_valid_qasm_shape(template["qasm"])
    assert template["num_qubits"] <= MAX_RUNNABLE_QUBITS

    runner = _api_runner()
    if runner is None:
        pytest.skip("services/api simulator not importable; structural checks only")

    circuit = runner.parse_qasm(template["qasm"])
    assert circuit.num_qubits == template["num_qubits"]

    result = runner.run_circuit(template["qasm"], shots=128)
    counts = result["counts"]
    assert sum(counts.values()) == 128
    # Spot-check the physics on the deterministic templates so a template
    # edit that silently changes the protocol fails loudly here.
    if protocol == "superdense":
        assert set(counts) == {"11"}
    if protocol == "grover":
        assert counts.get("11", 0) >= 120  # one iteration is exact at N=4
    if protocol == "ghz":
        assert set(counts) <= {"000", "111"}
