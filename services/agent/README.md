# QuantumMind — Quantum Lab Agent Service

The agentic layer of Quantum Lab. QuantumMind is an AI tutor that teaches
quantum computing to people who are actively building circuits, and its
defining habit is that it **runs circuits instead of asserting what they would
do**. When a learner asks "what does my circuit output?", the model calls a
tool, executes the circuit on the Quantum Lab API (or a local Aer simulator if
the API is down), and reports real counts.

The service is Python 3.11, LangChain tool-calling over Gemini, Groq, Anthropic or
Azure OpenAI through LiteLLM (cheapest-first, see docs/LLM-GATEWAY.md), and a small
FastAPI surface on port 8001.

## The tools work without an API key

This is a deliberate design constraint. `agent.tools`, `agent.knowledge` and
`agent.prompts` import and run with **no `ANTHROPIC_API_KEY`, no network and no
LangChain installed**. Only `agent.core` and `agent.server` need a key, and they
raise a `RuntimeError` carrying setup instructions at *call* time, never at
import time. The test suite runs entirely offline for the same reason.

That means you can use all thirteen tools — the circuit generator, runner, step inspector,
diff, checker, measurement explainer, concept lookup, learner profile, lesson recommender, quiz
builder, arXiv fetcher and the two run-this-paper tools — as an ordinary Python library:

```python
from agent.tools import _generate_circuit_impl, _run_quantum_circuit_impl

circuit = _generate_circuit_impl("grover")
print(_run_quantum_circuit_impl(circuit["qasm"], shots=1024)["summary"])
```

## Setup

```bash
cd services/agent
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

Create a `.env` next to `requirements.txt`:

```ini
ANTHROPIC_API_KEY=sk-ant-...
QUANTUM_API_URL=http://localhost:8000
MODEL=claude-sonnet-4-6
MAX_TOKENS=1024
TEMPERATURE=0.3
```

### Environment variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | _unset_ | Anthropic key. Without it the tools still work; the tutor does not. |
| `QUANTUM_API_URL` | `http://localhost:8000` | Base URL of the Quantum Lab circuit-execution API. Unreachable is fine — execution falls back to a local simulator. |
| `MODEL` | `claude-sonnet-4-6` | Model backing the tutor. |
| `MAX_TOKENS` | `1024` | Generation cap per reply. |
| `TEMPERATURE` | `0.3` | Sampling temperature. |
| `QUANTUM_LAB_RAG_INDEX` | committed artifact | Override the path to `data/course_index.json`. Missing is a **warning at boot**, not a failure — retrieval fails open. |
| `ALLOWED_ORIGINS` | `http://localhost:3000` | CORS origins. `*` is refused and the service will not start. |
| `MAX_TOOL_ROUNDS` | `6` | Tool-invocation rounds per request. |
| `MAX_AGENT_SECONDS` | `60` | Wall-clock ceiling on one agent run. |
| `MAX_HISTORY_TURNS` | `20` | Prior turns carried into the prompt. |
| `MAX_MESSAGE_CHARS` | `8000` | Characters accepted in any one turn. |
| `MAX_SHOTS` | `20000` | Ceiling on `run_quantum_circuit(shots=…)`. |

### The five clamps are a prompt-injection defence, not tuning knobs

Everything this service reads is attacker-reachable: the learner's question, the QASM in their
editor, the lesson text retrieved from the course index, and the abstract of any arXiv paper they
name. None of that can be made trustworthy, so the defence is to bound what an instruction hidden
in it can **spend**. `MAX_SHOTS` is the sharpest of the five: `services/api` already caps at 20,000
and answers 400 — but `run_quantum_circuit` *swallows* that error and falls back to a **local** Aer
run at the requested count, so without the clamp an injected "run it with 500000000 shots" burns
CPU in this process with nothing in its way.

**A non-positive value refuses to start.** `agent/env_check.py` holds the rules and is also a CLI
(`python -m agent.env_check`); it runs at import of `agent.server`, and CI runs it against an empty
environment.

## Running

**Interactive REPL:**

```bash
.venv/bin/python -m agent.cli
```

Commands are `/level <beginner|intermediate|advanced>`, `/help` and `/quit`.
History carries across turns, and the tools the agent used are printed in dim
text after each answer. With no API key the CLI prints setup instructions and
offers a degraded mode that answers straight from the local knowledge base.

**HTTP server:**

```bash
.venv/bin/uvicorn agent.server:app --host 0.0.0.0 --port 8001
# or: .venv/bin/python -m agent.server
```

**Docker:**

```bash
docker build -t quantum-lab-agent .
docker run -p 8001:8001 -e ANTHROPIC_API_KEY=sk-ant-... quantum-lab-agent
```

### Endpoints

`POST /api/agent/chat`

```json
{
  "message": "why does my bell circuit never output 01?",
  "level": "beginner",
  "history": [{ "role": "user", "content": "what is a qubit?" }],
  "circuit_qasm": "OPENQASM 3.0;\ninclude \"stdgates.inc\";\n..."
}
```

Returns `{ "reply": str, "tools_used": [str], "configured": bool }`. If the
service has no API key it still returns **200**, with the setup instructions as
the reply and `configured: false`, so the frontend can render guidance rather
than an error page.

`GET /api/agent/health` returns `{ "status", "configured", "tools", "checks" }` and **probes what
it can actually reach** — the circuit API, whether the RAG index really loaded, and the model
provider's configuration. It used to answer `ok` unconditionally, which proved only that uvicorn
was listening. `degraded` stays **200** (every degraded state here is one the tutor is designed to
survive); only `failing` drives 503.

CORS defaults to `http://localhost:3000`; set `ALLOWED_ORIGINS` on a deployment or the browser
blocks every call. `*` is refused and the service will not start.

## The thirteen tools

Thirteen: eleven in `agent/tools.py` plus `fetch_arxiv` and `protocol_hints` in
`agent/paper.py`. This section was written when there were five, then nine; the
count is `len(ALL_TOOLS) + len(PAPER_TOOLS)` in `agent/core.py`.

| Tool | When the model calls it |
| --- | --- |
| `run_quantum_circuit` | Any time the question is about what a circuit actually outputs — executes it via the Quantum Lab API, falling back to local Aer, and returns real counts plus a one-line summary. |
| `generate_circuit` | The learner asks for a standard circuit by name or description (bell, ghz, superposition, grover, teleport, deutsch, interference, qft); returns runnable OpenQASM 3 plus an explanation. |
| `explain_measurement` | Raw counts need interpreting — dominant outcomes, whether the distribution is uniform, peaked or bimodal, whether the bits are perfectly correlated (the Bell/GHZ fingerprint), and whether stray counts look like noise. |
| `check_circuit` | A learner's circuit misbehaves or fails; static analysis catches missing gates, out-of-range qubit indices, gates after a measurement, controls stuck at \|0⟩, and missing measurements — without executing anything. |
| `search_concepts` | Before explaining physics the model is not certain of, or on any "what is X" question. Retrieves from the course RAG index when it is loaded, and falls back to the 18-concept keyword base when it is not. |
| `get_learner_profile` | The answer should depend on what this learner has actually done — which lessons are complete, which challenges are solved. |
| `recommend_next_lesson` | "What should I study next?", answered from the concept graph rather than from a guess. |
| `create_quiz` | The learner asks to be tested on a concept; returns questions with answers. |
| `fetch_arxiv_paper` | The learner names an arXiv identifier. **Its output is attacker-controlled text** and is wrapped as reference material before it reaches the model. |

## Layout

```
agent/
  config.py      pydantic-settings Settings + the `settings` singleton
  env_check.py   startup validation; also `python -m agent.env_check`
  prompts.py     SYSTEM_PROMPT, LEVEL_GUIDANCE, build_system_prompt()
  knowledge.py   18 curated concepts + keyword search (no dependencies)
  curriculum.py  the concept graph behind recommend_next_lesson
  learner.py     progress → profile
  arxiv.py       the paper fetcher
  rag/           chunker.py, index.py, retrieve.py — TF-IDF over the course
  tools.py       the nine implementations, plus optional LangChain wrappers
  core.py        build_agent() / ask() — the only module needing a key
  server.py      FastAPI app
  cli.py         interactive REPL
data/
  course_index.json   the committed retrieval artifact — see docs/RAG.md
tests/
  offline tests for every tool
```

**`data/` must ship in any image you build.** Retrieval fails open: without the index the tutor
still answers, just without the course under it, and nothing in the response says so.
`agent/env_check.py` warns at boot when it is missing, and `GET /api/agent/health` reports it as
`degraded`.

## Tests

```bash
.venv/bin/python -m pytest -q     # 109 test functions, all offline
```

Note the interpreter: a bare `pytest` or `python -m pytest` uses whatever is on `PATH`, which does
not have qiskit. On Windows it is `.\.venv\Scripts\python.exe -m pytest`.

The suite needs only `pydantic`, `pydantic-settings`, `httpx`, `qiskit`,
`qiskit-aer` and `pytest` — deliberately **not** LangChain, since passing
without it is the proof that the tools stand alone.

## Where this sits

This service is **tier 1** of the tutor's three-tier degradation. The browser never calls it: it
talks to `apps/web/app/api/agent/route.ts`, which tries this service first and falls through
silently to a direct Anthropic call and then to a built-in offline answer set. See
[ADR-0009](../../docs/adr/0009-the-tutor-degrades-in-three-visible-tiers.md) and
`docs/ARCHITECTURE.md` § 4.
