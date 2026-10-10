# syntax=docker/dockerfile:1
#
# Quantum Lab — circuit execution API (FastAPI + Qiskit/Aer + PennyLane).
#
# BUILD CONTEXT IS THIS DIRECTORY:
#
#     docker build -t quantum-lab-api ./services/api
#
# (docker-compose.yml uses `build: ./services/api`.)
#
# ############################################################
# #  THIS SERVICE IS UNAUTHENTICATED BY DEFAULT              #
# #                                                          #
# #  /api/circuits/run executes user-supplied circuits and   #
# #  /api/hardware/submit can spend real IBM/Braket credits,  #
# #  with no credential unless API_SHARED_SECRET is set.      #
# #  Publishing this container's port to the internet is a   #
# #  deployment mistake, not a configuration choice. Read     #
# #  docs/SECURITY.md § "Exposing services/api safely".       #
# ############################################################
#
# WHAT CHANGED AND WHY (this file used to be a single stage):
#   * `COPY . .` copied the whole directory into the image. There is no
#     .dockerignore here, so that included services/api/.venv — a host-built
#     virtualenv, wrong architecture, several hundred megabytes — plus tests,
#     docs and __pycache__. The stage-2 copies below are explicit for that
#     reason. Do not replace them with `COPY . .` without adding a
#     .dockerignore next to this file.
#   * The build ran as root and the container ran as root.
#   * There was no HEALTHCHECK, so an orchestrator could not tell a wedged
#     process from a healthy one.


###############################################################################
# Stage 1 — builder
#
# Installs into a self-contained virtualenv at /opt/venv, which stage 2 copies
# wholesale. A venv rather than --user or the system site-packages because it
# is a single directory with no ownership surprises when it lands under a
# non-root user in the runtime image.
###############################################################################
FROM python:3.11-slim AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# build-essential is a fallback, not a certainty: qiskit, qiskit-aer and
# pennylane-lightning all publish manylinux wheels for cp311, so on amd64 this
# installs no compiler work at all. It is here because a platform without a
# matching wheel (arm64 for some releases) falls back to a source build, and
# the failure mode without it is a wall of "error: command 'gcc' failed" that
# reads like a code problem. It costs ~200MB in a stage that is discarded.
RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /build

RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

COPY requirements.txt requirements-hardware.txt ./

# pytest is declared in requirements.txt (the test suite is part of the service
# contract) but has no business in a runtime image: it is dead weight and extra
# import surface. Stripped here rather than by splitting requirements.txt,
# because that file is not owned by this workstream. If a requirements-dev.txt
# is ever introduced, delete this filter and install the runtime file directly.
RUN grep -viE '^[[:space:]]*pytest([[:space:]]|[<>=!~]|$)' requirements.txt > /tmp/runtime-requirements.txt \
 && pip install --upgrade pip \
 && pip install -r /tmp/runtime-requirements.txt

# The vendor SDKs for real hardware. ON BY DEFAULT, which is a change: they
# used to be commented-out lines in requirements.txt, so the deployed image
# could not submit to IBM, Braket or Azure even with valid credentials — the
# lazy `import qiskit_ibm_runtime` in app/quantum/hardware.py raised
# ModuleNotFoundError and /api/hardware/submit answered 503 "install it with
# pip install qiskit-ibm-runtime", advice aimed at a container nobody was
# going to pip into. Real hardware is the thing this service exists to reach;
# the image should be able to reach it.
#
# Build with --build-arg INCLUDE_HARDWARE_SDKS=0 for a simulator-only
# deployment. That saves roughly 120 MB and restores exactly the previous
# behaviour: devices list from the static catalogue, marked unavailable with
# the reason attached, and submission answers 503 with the remedy.
ARG INCLUDE_HARDWARE_SDKS=1
RUN if [ "$INCLUDE_HARDWARE_SDKS" = "1" ]; then \
      pip install -r requirements-hardware.txt; \
    else \
      echo "INCLUDE_HARDWARE_SDKS=0 - skipping vendor SDKs; hardware submission answers 503."; \
    fi


###############################################################################
# Stage 2 — runtime
#
# python:3.11-slim + the venv + the application package. No compiler, no
# requirements file, no tests, no .venv from the host.
###############################################################################
FROM python:3.11-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/opt/venv/bin:$PATH" \
    PORT=8000

# Non-root. A container process running as uid 0 that is compromised through a
# request — and this service executes user-supplied circuit descriptions — has
# root on anything bind-mounted into it.
RUN groupadd --system --gid 1001 quantum \
 && useradd --system --uid 1001 --gid quantum --create-home quantum

COPY --from=builder --chown=quantum:quantum /opt/venv /opt/venv

WORKDIR /app

# Explicit, not `COPY . .` — see the header. Only the importable package is
# needed at run time; tests/, docs/, railway.json and any host .venv are not.
COPY --chown=quantum:quantum app ./app

USER quantum

EXPOSE 8000

# Probes /api/health, which app/core/security.py deliberately exempts from the
# shared-secret gate (EXEMPT_PATHS) precisely so that a liveness probe, which
# cannot be given a secret, still works when API_SHARED_SECRET is set.
#
# start-period is 40s rather than the usual 5-10: importing qiskit, qiskit-aer
# and pennylane takes several seconds on a cold container, and a shorter grace
# window restarts the service while it is still starting, forever.
#
# urllib from the interpreter that is already here — no curl, no extra layer.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD python -c "import os,urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:'+os.environ.get('PORT','8000')+'/api/health', timeout=4).status < 400 else 1)"

# Validate the environment, then serve. `python -m app.core.env_check` exits
# non-zero on a misconfiguration that would otherwise fail silently (a '*' in
# ALLOWED_ORIGINS, an unknown DEFAULT_BACKEND), so the container dies at start
# with the reason in its logs instead of serving something broken. An empty
# environment is valid and passes.
#
# NOTE: services/api/railway.json overrides this CMD with its own startCommand,
# so on Railway the check runs only via the import in app/main.py. That import
# is the real belt; this is the braces, for `docker run` and Compose.
CMD ["sh", "-c", "python -m app.core.env_check && exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
