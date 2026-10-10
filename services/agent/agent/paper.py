"""'Run this paper' tools: fetch an arXiv abstract, spot runnable protocols.

Roadmap stage "Run this paper" MVP. Two tools live here:

* ``fetch_arxiv`` — one bounded HTTP request to the public arXiv export API,
  returning title/abstract/categories. Deliberately *not* built on
  :mod:`agent.arxiv`: that module's fetch has a 15s timeout and no response
  size cap, while this tool is called mid-agent-turn where the wall-clock
  budget (``settings.max_agent_seconds``) is already ticking — so it enforces
  its own tighter 10s timeout and a hard byte cap before parsing anything.
* ``protocol_hints`` — a pure keyword scan (no model call, no network) that
  maps an abstract onto the small set of named protocols this product can
  actually simulate at <=16 qubits, each paired with a ready-to-run OpenQASM 3
  template. When nothing matches it says so honestly instead of stretching.

Both follow the house rules: every public entry point returns a dict, never
raises, and text fetched from the open internet is fenced as reference
material (audit finding INJ-1) before it reaches the model's context.

The LangChain ``@tool`` wrappers at the bottom exist only when
``langchain_core`` is installed, mirroring :mod:`agent.tools`; without it
:data:`PAPER_TOOLS` is empty and the ``_impl`` functions still work — that is
what the tests exercise.
"""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from typing import Any
from urllib.parse import urlencode

from agent.tools import as_reference_material

__all__ = [
    "ARXIV_API_URL",
    "FETCH_TIMEOUT_SECONDS",
    "MAX_RESPONSE_BYTES",
    "MAX_RUNNABLE_QUBITS",
    "PROTOCOL_TEMPLATES",
    "PROTOCOL_KEYWORDS",
    "parse_arxiv_id",
    "_fetch_arxiv_impl",
    "_protocol_hints_impl",
    "PAPER_TOOLS",
    "PAPER_TOOL_NAMES",
]

#: The public arXiv Atom API endpoint (same service agent.arxiv talks to).
ARXIV_API_URL: str = "https://export.arxiv.org/api/query"

#: Seconds before the single metadata request is abandoned. Tighter than
#: agent.arxiv's 15s because this call happens inside an agent turn that has
#: its own wall-clock ceiling; a slow arXiv must not eat the whole budget.
FETCH_TIMEOUT_SECONDS: float = 10.0

#: Hard cap on the bytes of response body we will parse. A metadata query for
#: one paper is a few KB of Atom XML; anything approaching this cap is not the
#: response we asked for, and parsing unbounded attacker-adjacent XML is how
#: memory disappears. 512 KiB leaves two orders of magnitude of headroom.
MAX_RESPONSE_BYTES: int = 512 * 1024

#: The product's honest simulation ceiling: services/api's statevector paths
#: and the local Aer fallback are sized for small circuits, and every template
#: below uses far fewer. Papers whose experiments need more than this are OUT
#: OF SCOPE and the tools say so rather than pretending.
MAX_RUNNABLE_QUBITS: int = 16

# Same identifier grammar agent.arxiv accepts: 2401.12345(v2) and the old
# archive/7-digit style like quant-ph/0201082.
_NEW_ID_RE = re.compile(r"\b(\d{4}\.\d{4,5}(?:v\d+)?)\b")
_OLD_ID_RE = re.compile(r"\b([a-z-]+(?:\.[A-Z]{2})?/\d{7}(?:v\d+)?)\b")

_ATOM = "{http://www.w3.org/2005/Atom}"
_ARXIV_NS = "{http://arxiv.org/schemas/atom}"


def parse_arxiv_id(id_or_url: str) -> str | None:
    """Extract a canonical arXiv id from an id or an arxiv.org URL.

    Accepts a bare id (``2401.12345``, ``2401.12345v2``,
    ``quant-ph/0201082``), an ``arxiv.org/abs/...`` URL, or an
    ``arxiv.org/pdf/...`` URL with or without a ``.pdf`` suffix. Unlike
    :func:`agent.arxiv.fetch_paper` there is no free-text search fallback:
    this tool is for "the learner pasted a link", and a wrong guess at a
    search would fetch a *different* paper and mislead silently.

    Args:
        id_or_url: Whatever the learner or the model supplied.

    Returns:
        The bare arXiv id (version suffix preserved), or ``None`` when the
        input does not contain one.
    """
    text = (id_or_url or "").strip()
    if not text:
        return None

    candidate = text
    if "arxiv.org" in text.lower():
        # abs/pdf URLs differ only in the path segment before the id — and the
        # old-style ids contain a slash themselves, so peel path prefixes off
        # rather than taking the last segment blindly.
        candidate = re.sub(r"^[a-z]+://", "", text.strip().rstrip("/"), flags=re.IGNORECASE)
        candidate = re.sub(r"^[^/]*arxiv\.org/(abs|pdf|html)/", "", candidate, flags=re.IGNORECASE)
        candidate = re.sub(r"\.pdf$", "", candidate, flags=re.IGNORECASE)
        candidate = candidate.split("?", 1)[0].split("#", 1)[0]

    match = _NEW_ID_RE.fullmatch(candidate) or _OLD_ID_RE.fullmatch(candidate)
    if match:
        return match.group(1)
    # A bare id pasted with stray words around it ("see 2401.12345 please")
    # still resolves, but only when the id is unambiguous in the text — and
    # never out of a non-arXiv URL, where a number that merely looks like an
    # id would silently fetch a different paper than the one linked.
    if re.search(r"[a-z][a-z0-9+.-]*://|\bwww\.", text, re.IGNORECASE) and (
        "arxiv.org" not in text.lower()
    ):
        return None
    matches = _NEW_ID_RE.findall(text) + _OLD_ID_RE.findall(text)
    if len(matches) == 1:
        return matches[0]
    return None


def _fetch_arxiv_impl(id_or_url: str) -> dict[str, Any]:
    """Fetch one arXiv paper's title, abstract and categories by id or URL.

    Call this when a learner pastes an arXiv link or id and wants to know
    whether the paper's experiment can be reproduced here. It makes exactly
    one HTTP request to the arXiv export API (10 second timeout, response
    size capped) and returns the metadata record only. FULL-TEXT EXTRACTION
    IS OUT OF SCOPE: this tool never downloads or reads the PDF, so
    everything downstream — protocol detection included — works from the
    abstract alone, and you must say so when precision beyond the abstract
    would be needed. Feed the returned ``summary`` to protocol_hints to find
    out which of the paper's protocols this product can actually run.

    Args:
        id_or_url: An arXiv id (``"2401.12345"``, ``"quant-ph/0201082"``) or
            an ``arxiv.org/abs/...`` / ``arxiv.org/pdf/...`` URL.

    Returns:
        A dict with ``id``, ``title``, ``summary`` (the abstract, fenced as
        reference material), ``categories`` and ``url``. On a bad identifier,
        network failure, oversized or malformed response, ``{"error":
        <actionable message>}`` instead — this function never raises.
    """
    paper_id = parse_arxiv_id(id_or_url)
    if paper_id is None:
        return {
            "error": (
                f"Could not find an arXiv id in {str(id_or_url)[:200]!r}. Pass a bare id "
                "like '2401.12345' or an arxiv.org/abs or /pdf URL. This tool does not "
                "search by title — use fetch_arxiv_paper for that."
            )
        }

    url = f"{ARXIV_API_URL}?{urlencode({'id_list': paper_id, 'max_results': '1'})}"
    try:
        import httpx

        # One request, no retries — arXiv's API guidance asks for low rates.
        response = httpx.get(
            url,
            timeout=FETCH_TIMEOUT_SECONDS,
            headers={"User-Agent": "QuantumLabTutor/1.0 (educational agent)"},
            follow_redirects=True,
        )
        response.raise_for_status()
        body = response.content
    except Exception as exc:  # noqa: BLE001 - report, never raise, to the model
        return {
            "error": (
                f"Could not reach the arXiv API ({type(exc).__name__}: {exc}). Tell the "
                "learner the lookup failed; do not invent the paper's contents."
            )
        }

    if len(body) > MAX_RESPONSE_BYTES:
        return {
            "error": (
                f"The arXiv response was {len(body)} bytes, over the {MAX_RESPONSE_BYTES} "
                "byte cap for a single-paper metadata query — refusing to parse it. "
                "Try the id again later."
            )
        }

    try:
        root = ET.fromstring(body.decode("utf-8", errors="replace"))
    except ET.ParseError as exc:
        return {"error": f"arXiv returned invalid Atom XML ({exc}). Try again later."}

    entry = root.find(f"{_ATOM}entry")
    title = _clean(entry.find(f"{_ATOM}title")) if entry is not None else ""
    if entry is None or not title or title.lower().startswith("error"):
        return {
            "error": (
                f"No arXiv paper matched id {paper_id!r}. Check the id — versions and "
                "the old archive/number style both work when they exist."
            )
        }

    categories = [
        term
        for term in (cat.get("term") for cat in entry.findall(f"{_ATOM}category"))
        if term
    ]
    primary = entry.find(f"{_ARXIV_NS}primary_category")
    primary_term = primary.get("term") if primary is not None else None
    if primary_term and primary_term not in categories:
        categories.insert(0, primary_term)

    # SECURITY (audit finding INJ-1): the abstract is open-internet text and
    # the realistic injection vector, so it is fenced exactly as
    # fetch_arxiv_paper fences it. The one-line title is stripped of the
    # fence markers only, for the same reasons documented there.
    abstract = _clean(entry.find(f"{_ATOM}summary"))
    return {
        "id": paper_id,
        "title": title,
        "summary": as_reference_material(abstract, source="arXiv abstract"),
        "categories": categories,
        "url": f"https://arxiv.org/abs/{paper_id}",
    }


def _clean(node: Any) -> str:
    """Whitespace-normalise an XML node's text, tolerating ``None``."""
    if node is None or node.text is None:
        return ""
    return " ".join(node.text.split())


# --------------------------------------------------------------------------- #
# Protocol templates
# --------------------------------------------------------------------------- #
#
# Each template is complete, measured OpenQASM 3 that services/api's simulator
# runs as-is; the test suite round-trips every one of them through
# app.quantum.runner to keep that claim honest. All are far below
# MAX_RUNNABLE_QUBITS on purpose — these are the canonical *small* instances a
# tutor can execute and discuss in one turn, not scaled reproductions.

_HEADER = 'OPENQASM 3.0;\ninclude "stdgates.inc";'

#: Protocol key -> ready-to-run template. Keys are stable API surface: the
#: model quotes them back and tests assert on them.
PROTOCOL_TEMPLATES: dict[str, dict[str, Any]] = {
    "bell_chsh": {
        "name": "Bell pair / CHSH test (one measurement setting)",
        "num_qubits": 2,
        "qasm": (
            f"{_HEADER}\n"
            "qubit[2] q;\n"
            "bit[2] c;\n"
            "h q[0];\n"
            "cx q[0], q[1];\n"
            "// rotate q[1] into one CHSH analyser setting (b = -pi/8 rad basis)\n"
            "ry(-0.7853981633974483) q[1];\n"
            "c = measure q;\n"
        ),
        "note": (
            "One of the four CHSH correlator settings; estimating S needs four "
            "runs with analyser angles a, a', b, b' and combining <ab> terms."
        ),
    },
    "teleportation": {
        "name": "Quantum teleportation (deferred measurement)",
        "num_qubits": 3,
        "qasm": (
            f"{_HEADER}\n"
            "qubit[3] q;\n"
            "bit[3] c;\n"
            "ry(1.0471975511965976) q[0];\n"
            "h q[1];\n"
            "cx q[1], q[2];\n"
            "cx q[0], q[1];\n"
            "h q[0];\n"
            "cx q[1], q[2];\n"
            "cz q[0], q[2];\n"
            "c = measure q;\n"
        ),
        "note": (
            "Bob's corrections are written as coherent CX/CZ via the deferred-"
            "measurement principle; q[2]'s marginal reproduces ry(pi/3)|0>."
        ),
    },
    "superdense": {
        "name": "Superdense coding (sending the two bits '11')",
        "num_qubits": 2,
        "qasm": (
            f"{_HEADER}\n"
            "qubit[2] q;\n"
            "bit[2] c;\n"
            "// shared Bell pair\n"
            "h q[0];\n"
            "cx q[0], q[1];\n"
            "// Alice encodes classical bits 11 with Z then X on her qubit\n"
            "z q[0];\n"
            "x q[0];\n"
            "// Bob decodes with the inverse Bell circuit\n"
            "cx q[0], q[1];\n"
            "h q[0];\n"
            "c = measure q;\n"
        ),
        "note": "Every shot should read '11'; change the Z/X block to send other bit pairs.",
    },
    "grover": {
        "name": "Grover search, 2 qubits, marked state |11>",
        "num_qubits": 2,
        "qasm": (
            f"{_HEADER}\n"
            "qubit[2] q;\n"
            "bit[2] c;\n"
            "h q[0];\n"
            "h q[1];\n"
            "cz q[0], q[1];\n"
            "h q[0];\n"
            "h q[1];\n"
            "x q[0];\n"
            "x q[1];\n"
            "cz q[0], q[1];\n"
            "x q[0];\n"
            "x q[1];\n"
            "h q[0];\n"
            "h q[1];\n"
            "c = measure q;\n"
        ),
        "note": "One iteration is exact at N=4: essentially all shots give '11'.",
    },
    "qft": {
        "name": "Quantum Fourier transform (3 qubits, input |001>)",
        "num_qubits": 3,
        "qasm": (
            f"{_HEADER}\n"
            "qubit[3] q;\n"
            "bit[3] c;\n"
            "x q[0];\n"
            "h q[0];\n"
            "cp(1.5707963267948966) q[1], q[0];\n"
            "cp(0.7853981633974483) q[2], q[0];\n"
            "h q[1];\n"
            "cp(1.5707963267948966) q[2], q[1];\n"
            "h q[2];\n"
            "swap q[0], q[2];\n"
            "c = measure q;\n"
        ),
        "note": (
            "Counts look flat because the QFT stores its output in phases; that "
            "flatness IS the expected computational-basis signature."
        ),
    },
    "vqe_h2": {
        "name": "VQE H2 ansatz (2 qubits, near the equilibrium ground state)",
        "num_qubits": 2,
        "qasm": (
            f"{_HEADER}\n"
            "qubit[2] q;\n"
            "bit[2] c;\n"
            "// Hartree-Fock reference |01> then one UCC-style excitation\n"
            "x q[0];\n"
            "ry(0.2262) q[1];\n"
            "cx q[1], q[0];\n"
            "c = measure q;\n"
        ),
        "note": (
            "One Z-basis evaluation of the H2 ansatz near its optimal angle — "
            "a full VQE also measures other Pauli bases and runs an optimiser "
            "loop, which is beyond a single circuit run."
        ),
    },
    "ghz": {
        "name": "GHZ state (3 qubits)",
        "num_qubits": 3,
        "qasm": (
            f"{_HEADER}\n"
            "qubit[3] q;\n"
            "bit[3] c;\n"
            "h q[0];\n"
            "cx q[0], q[1];\n"
            "cx q[1], q[2];\n"
            "c = measure q;\n"
        ),
        "note": "Only '000' and '111' should appear, about half the time each.",
    },
}

#: Protocol key -> lowercase phrases whose presence in an abstract signals it.
#: Deliberately conservative: a false positive makes the tutor promise to
#: reproduce a paper it cannot, which is exactly the bluffing this feature
#: exists to avoid. Phrases are matched as plain substrings of the lowered
#: abstract text.
PROTOCOL_KEYWORDS: dict[str, tuple[str, ...]] = {
    "bell_chsh": (
        "chsh",
        "bell inequality",
        "bell test",
        "bell-test",
        "bell pair",
        "bell state",
        "clauser",
        "local realism",
        "loophole-free",
        "epr pair",
    ),
    "teleportation": ("teleport",),
    "superdense": ("superdense", "dense coding"),
    "grover": ("grover", "unstructured search", "amplitude amplification"),
    "qft": ("quantum fourier transform", "qft"),
    "vqe_h2": (
        "variational quantum eigensolver",
        "vqe",
        "hydrogen molecule",
        "h2 molecule",
        "molecular ground state",
    ),
    "ghz": ("ghz", "greenberger"),
}

#: "N qubits" / "N-qubit" mentions, used only to warn about papers whose
#: stated register sizes exceed what this product can simulate.
_QUBIT_COUNT_RE = re.compile(r"\b(\d{1,6})[\s-]*qubits?\b")


def _protocol_hints_impl(abstract_text: str) -> dict[str, Any]:
    """Detect which named protocols in an abstract this product can run.

    Pure heuristic keyword matching — no model call, no network, no reading
    beyond the text you pass in. Call it on the ``summary`` returned by
    fetch_arxiv. Each detected protocol comes with a complete, measured
    OpenQASM 3 template circuit sized well under 16 qubits; feed a template
    straight to run_quantum_circuit to reproduce the protocol's core
    behaviour, then compare the counts qualitatively with the abstract's
    claims. When ``detected`` is empty, or ``scope_warning`` is set, the
    paper is OUT OF SCOPE for reproduction here — say that plainly to the
    learner instead of improvising a circuit.

    Args:
        abstract_text: The paper's abstract (fence markers are ignored).

    Returns:
        A dict with ``detected`` — a list of ``{protocol, name, num_qubits,
        matched_keywords, qasm, note}`` entries, alphabetical by protocol key
        — plus ``max_runnable_qubits``, an optional ``scope_warning`` when
        the abstract mentions register sizes beyond the runnable ceiling, and
        a human ``summary`` line. Empty/blank input yields an empty
        detection with an honest summary; this function never raises.
    """
    text = str(abstract_text or "").lower()
    if not text.strip():
        return {
            "detected": [],
            "max_runnable_qubits": MAX_RUNNABLE_QUBITS,
            "summary": (
                "No abstract text was provided, so no protocol can be detected."
            ),
        }

    detected: list[dict[str, Any]] = []
    for protocol in sorted(PROTOCOL_KEYWORDS):
        matched = [phrase for phrase in PROTOCOL_KEYWORDS[protocol] if phrase in text]
        if matched:
            template = PROTOCOL_TEMPLATES[protocol]
            detected.append(
                {
                    "protocol": protocol,
                    "name": template["name"],
                    "num_qubits": template["num_qubits"],
                    "matched_keywords": matched,
                    "qasm": template["qasm"],
                    "note": template["note"],
                }
            )

    result: dict[str, Any] = {
        "detected": detected,
        "max_runnable_qubits": MAX_RUNNABLE_QUBITS,
    }

    counts = [int(m) for m in _QUBIT_COUNT_RE.findall(text)]
    oversized = [n for n in counts if n > MAX_RUNNABLE_QUBITS]
    if oversized:
        result["scope_warning"] = (
            f"The abstract mentions register sizes up to {max(oversized)} qubits, "
            f"beyond the {MAX_RUNNABLE_QUBITS}-qubit ceiling this product can "
            "simulate. Any template below reproduces the protocol's small "
            "canonical instance, NOT the paper's actual experiment — say so."
        )

    if detected:
        names = ", ".join(entry["protocol"] for entry in detected)
        result["summary"] = (
            f"Detected {len(detected)} runnable protocol(s): {names}. Each entry "
            "carries a ready-to-run OpenQASM 3 template."
        )
    else:
        result["summary"] = (
            "No protocol this product can run was recognised in the abstract. "
            "The paper is out of scope for reproduction here — tell the learner "
            "that honestly rather than improvising a circuit."
        )
    return result


# --------------------------------------------------------------------------- #
# LangChain wrappers (optional — the module works fine without langchain)
# --------------------------------------------------------------------------- #

def _named(func: Any, name: str) -> Any:
    """Wrap ``func`` under a public tool name (same trick as agent.tools).

    Args:
        func: The private ``_..._impl`` function.
        name: The model-facing tool name.

    Returns:
        A wrapper with the same behaviour, signature and docstring.
    """
    import functools

    @functools.wraps(func)
    def wrapper(*args: Any, **kwargs: Any) -> Any:
        return func(*args, **kwargs)

    wrapper.__name__ = name
    wrapper.__qualname__ = name
    return wrapper


try:  # pragma: no cover - depends on the installed environment
    from langchain_core.tools import tool
except ImportError:  # pragma: no cover
    tool = None  # type: ignore[assignment]

if tool is not None:  # pragma: no cover - exercised only with langchain installed
    fetch_arxiv = tool(_named(_fetch_arxiv_impl, "fetch_arxiv"))
    protocol_hints = tool(_named(_protocol_hints_impl, "protocol_hints"))
    PAPER_TOOLS: list[Any] = [fetch_arxiv, protocol_hints]
    __all__ += ["fetch_arxiv", "protocol_hints"]
else:
    PAPER_TOOLS = []

#: Stable names, available whether or not langchain is present.
PAPER_TOOL_NAMES: list[str] = ["fetch_arxiv", "protocol_hints"]
