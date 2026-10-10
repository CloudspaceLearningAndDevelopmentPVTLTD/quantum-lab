# syntax=docker/dockerfile:1
#
# Quantum Lab — QuantumMind tutor agent service (FastAPI + LangChain).
#
# BUILD CONTEXT IS THIS DIRECTORY:
#
#     docker build -t quantum-lab-agent ./services/agent
#
# (docker-compose.yml uses `build: ./services/agent`.)
#
# WHAT CHANGED AND WHY (this file used to be a single stage):
#   * `COPY tests ./tests` shipped the test suite into the runtime image, and
#     requirements.txt installs pytest, so the running container carried a test
#     framework it never uses.
#   * `data/` was NOT copied. That directory holds course_index.json, the
#     committed TF-IDF index the RAG layer retrieves from
#     (agent/rag/index.py: DEFAULT_INDEX_PATH = <agent>/../data/course_index.json).
#     Without it retrieval fails OPEN: the tutor still answers, just without the
#     course under it, and nothing in the API response or the health endpoint
#     says so. That is the single most expensive silent regression available in
#     this image, which is why agent/env_check.py now warns about it at boot.
#   * The build ran as root and the container ran as root.
#   * There was no HEALTHCHECK.


###############################################################################
# Stage 1 — builder
###############################################################################
FROM python:3.11-slim AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# See the note in services/api/Dockerfile: qiskit and qiskit-aer publish cp311
# manylinux wheels, so on amd64 nothing is compiled. This exists so a platform
# without a matching wheel fails with a build error rather than a missing-gcc
# error. Discarded with this stage.
RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /build

RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

COPY requirements.txt ./

# pytest is stripped from the runtime install — see the same note in
# services/api/Dockerfile for why the filter lives here rather than in
# requirements.txt.
RUN grep -viE '^[[:space:]]*pytest([[:space:]]|[<>=!~]|$)' requirements.txt > /tmp/runtime-requirements.txt \
 && pip install --upgrade pip \
 && pip install -r /tmp/runtime-requirements.txt


###############################################################################
# Stage 2 — runtime
###############################################################################
FROM python:3.11-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/opt/venv/bin:$PATH" \
    PORT=8001

RUN groupadd --system --gid 1001 quantum \
 && useradd --system --uid 1001 --gid quantum --create-home quantum

COPY --from=builder --chown=quantum:quantum /opt/venv /opt/venv

WORKDIR /app

COPY --chown=quantum:quantum agent ./agent
# The RAG artifact. ~1MB of JSON; the difference between a tutor that quotes the
# course and one that improvises. Read-only at run time.
COPY --chown=quantum:quantum data ./data

USER quantum

EXPOSE 8001

# /api/agent/health answers whether the service is configured; it does not call
# Anthropic, so an unconfigured deployment is still HEALTHY rather than being
# restarted forever. start-period covers the qiskit and langchain imports.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD python -c "import os,urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:'+os.environ.get('PORT','8001')+'/api/agent/health', timeout=4).status < 400 else 1)"

# Validate, then serve — see the same note in services/api/Dockerfile.
# services/agent/railway.json overrides this CMD, so on Railway the check runs
# through the import in agent/server.py instead.
CMD ["sh", "-c", "python -m agent.env_check && exec uvicorn agent.server:app --host 0.0.0.0 --port ${PORT:-8001}"]
