"""Startup environment validation for the Qubit16 API.

Companion to ``apps/web/lib/env.ts``; same rules, same reasoning, different
runtime. The variable list below was derived by grepping ``services/api/app``
for ``os.environ``/``os.getenv`` and reading ``app/core/config.py``, not copied
from a document. If you add a new environment read, add it here too —
``.env.example`` and ``docs/DEPLOYMENT.md`` are written from this table.

WHY NOTHING IS REQUIRED. This service runs its whole documented default path —
Aer and PennyLane simulators, presets, transpilation, the job store — with an
entirely empty environment. Every variable switches on an extra, and every
consumer degrades rather than throws (an unavailable backend reports itself
unavailable). So :func:`check_env` fails on misconfiguration, not on absence:

* ``ALLOWED_ORIGINS`` containing ``*``, which is credentialed any-origin access
  on a service that executes arbitrary circuits. ``Settings.origins_list``
  already raises on this; calling it here means the failure happens at import
  of ``app.main`` rather than on the first CORS-relevant request.
* ``DEFAULT_BACKEND`` naming a backend that does not exist, which makes every
  run request that does not name one fail with a confusing 400 — while
  ``/api/health`` stays green, so nothing alerts.

Everything else is a warning, and a warning never stops the service.
"""

from __future__ import annotations

import logging
import os

from app.core.config import settings

__all__ = ["KNOWN_BACKEND_IDS", "check_env", "EnvReport"]

logger = logging.getLogger(__name__)

#: Backend ids ``app.quantum.backends.list_backends`` can return. Kept as a
#: literal set rather than imported from that module on purpose: importing it
#: pulls in qiskit, pennylane and every optional vendor SDK probe, and this
#: check must be cheap enough to run before anything else at startup. If a
#: backend is added there and not here, the only cost is a spurious warning —
#: which is the right way round.
KNOWN_BACKEND_IDS: frozenset[str] = frozenset(
    {
        "aer_simulator",
        "aer_noisy",
        "cirq_simulator",
        "braket_local",
        "ibm_quantum",
        "ibm_brisbane",
        "ionq_aria",
        "rigetti_ankaa",
        "azure_quantinuum_h1",
        "azure_ionq_aria",
    }
)

#: name -> (what setting it unlocks, what happens without it).
OPTIONAL_VARS: dict[str, tuple[str, str]] = {
    "ALLOWED_ORIGINS": (
        "CORS origins the browser may call this service from.",
        "Only http://localhost:3000 is allowed, so a deployed web app on any "
        "other origin is refused by the browser.",
    ),
    "API_SHARED_SECRET": (
        "Requires X-Quantum-Lab-Secret on every request except /api/health.",
        "This service is completely unauthenticated. It executes user-supplied "
        "circuits and can spend IBM/Braket credits with no credential, so it "
        "must not be reachable from the public internet.",
    ),
    "DEFAULT_BACKEND": (
        "Backend used when a run request names none.",
        "Defaults to aer_simulator.",
    ),
    "IBM_QUANTUM_TOKEN": (
        "The ibm_quantum backend — real IBM hardware. Also needs "
        "`pip install qiskit-ibm-runtime`.",
        "IBM backends report themselves unavailable.",
    ),
    "AWS_ACCESS_KEY_ID": (
        "The braket_local backend. Also needs `pip install amazon-braket-sdk`.",
        "Braket backends report themselves unavailable.",
    ),
    "AWS_SECRET_ACCESS_KEY": ("Paired with AWS_ACCESS_KEY_ID.", "As above."),
    "AWS_DEFAULT_REGION": ("Region used for Braket.", "Defaults to us-east-1."),
    "BRAKET_S3_BUCKET": (
        "Result bucket for non-local Braket submissions.",
        "Braket jobs that require an S3 destination cannot be submitted.",
    ),
    "BRAKET_S3_PREFIX": ("Key prefix inside that bucket.", "Defaults to quantum-lab."),
    "AZURE_QUANTUM_RESOURCE_ID": (
        "Azure Quantum workspace targeting.",
        "Azure targets report themselves unavailable.",
    ),
    "AZURE_QUANTUM_LOCATION": ("Azure workspace region.", "Defaults to eastus."),
    "REDIS_URL": (
        "A shared job store, so job state survives a restart and is visible to "
        "every replica.",
        "Jobs live in a bounded in-process dict: they are lost on restart and "
        "invisible to other replicas. With more than one replica a poll can "
        "hit an instance that has never heard of the job.",
    ),
}


class EnvReport:
    """Errors and warnings found in the current environment."""

    def __init__(self) -> None:
        self.errors: list[str] = []
        self.warnings: list[str] = []


def _is_set(name: str) -> bool:
    return bool(os.environ.get(name, "").strip())


def check_env(*, strict: bool = True) -> EnvReport:
    """Validate the environment, log the findings, and optionally raise.

    Args:
        strict: When True (the default) an error raises ``RuntimeError`` so the
            process exits at startup instead of serving a misconfiguration.
            Set ``QUANTUM_LAB_SKIP_ENV_CHECK=1`` to downgrade errors to
            warnings during an incident.

    Returns:
        The :class:`EnvReport` describing what was found.

    Raises:
        RuntimeError: If ``strict`` and any error was found.
    """
    report = EnvReport()

    # Raises on '*' — see Settings.origins_list. Converted here into the same
    # error channel as everything else so one startup message lists everything.
    try:
        origins = settings.origins_list
    except ValueError as exc:
        origins = []
        report.errors.append(str(exc))

    if origins == ["http://localhost:3000"]:
        report.warnings.append(
            "ALLOWED_ORIGINS is unset, so CORS allows only http://localhost:3000. "
            "A deployed web app on any other origin will be refused by the browser."
        )

    backend = (settings.default_backend or "").strip()
    if backend and backend not in KNOWN_BACKEND_IDS:
        report.errors.append(
            f"DEFAULT_BACKEND={backend!r} is not a known backend id. Every run "
            "request that does not name a backend will fail, while /api/health "
            "stays green — so nothing alerts. Valid ids: "
            + ", ".join(sorted(KNOWN_BACKEND_IDS))
        )

    if _is_set("AWS_ACCESS_KEY_ID") and not _is_set("AWS_SECRET_ACCESS_KEY"):
        report.errors.append(
            "AWS_ACCESS_KEY_ID is set but AWS_SECRET_ACCESS_KEY is not. Braket "
            "reports itself available on the key id alone and then fails on "
            "every submission."
        )

    for name, (unlocks, without) in OPTIONAL_VARS.items():
        if not _is_set(name):
            logger.debug("env: %s unset — %s (unlocks: %s)", name, without, unlocks)

    for message in report.warnings:
        logger.warning("env: %s", message)
    for message in report.errors:
        logger.error("env: %s", message)

    skip = os.environ.get("QUANTUM_LAB_SKIP_ENV_CHECK", "").strip() == "1"
    if report.errors and strict and not skip:
        raise RuntimeError(
            "Environment is misconfigured ("
            + str(len(report.errors))
            + " error(s)): "
            + " | ".join(report.errors)
            + " — see docs/DEPLOYMENT.md. To start anyway during an incident: "
            "QUANTUM_LAB_SKIP_ENV_CHECK=1"
        )
    if report.errors and skip:
        logger.error("env: QUANTUM_LAB_SKIP_ENV_CHECK=1 is set; the errors above are not fatal.")

    return report


if __name__ == "__main__":  # pragma: no cover - CLI for CI and container starts
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    check_env()
    print("env: ok")
