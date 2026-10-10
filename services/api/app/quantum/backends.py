"""Registry of quantum execution targets and their live availability."""

from __future__ import annotations

import importlib.util
import os

from pydantic import BaseModel, Field

from app.core.config import settings
from app.quantum.limits import MAX_NOISY_QUBITS


class BackendInfo(BaseModel):
    """Description of a single execution target exposed by the API."""

    id: str = Field(description="Stable identifier used in API requests.")
    name: str = Field(description="Human readable backend name.")
    vendor: str = Field(description="Who provides the backend, e.g. Qiskit or Google.")
    kind: str = Field(description="Either 'simulator' or 'hardware'.")
    max_qubits: int = Field(description="Largest circuit width this backend accepts.")
    available: bool = Field(description="Whether the backend can be used right now.")
    requires: str | None = Field(
        default=None,
        description="What is missing when the backend is unavailable, else None.",
    )
    notes: str = Field(default="", description="Free-form guidance shown in the UI.")


def _module_available(name: str) -> bool:
    """Report whether an importable module is installed, without importing it.

    Args:
        name: Top-level module name, e.g. ``"cirq"``.

    Returns:
        True when the module can be located on the import path.
    """
    try:
        return importlib.util.find_spec(name) is not None
    except (ImportError, ValueError, ModuleNotFoundError):
        return False


def list_backends() -> list[BackendInfo]:
    """Build the backend registry, recomputing availability on every call.

    Returns:
        Every known backend, whether or not it is currently usable.
    """
    cirq_ok = _module_available("cirq")
    braket_ok = _module_available("braket")
    runtime_ok = _module_available("qiskit_ibm_runtime")
    token_ok = bool(settings.ibm_quantum_token)
    aws_ok = bool(settings.aws_access_key_id or os.environ.get("AWS_ACCESS_KEY_ID"))

    ibm_requires: str | None = None
    if not runtime_ok and not token_ok:
        ibm_requires = "pip install qiskit-ibm-runtime and set IBM_QUANTUM_TOKEN"
    elif not runtime_ok:
        ibm_requires = "pip install qiskit-ibm-runtime"
    elif not token_ok:
        ibm_requires = "set IBM_QUANTUM_TOKEN"

    # Braket QPUs need both the SDK and real AWS credentials; the local
    # simulator above needs neither.
    braket_qpu_requires: str | None = None
    if not braket_ok and not aws_ok:
        braket_qpu_requires = (
            "pip install amazon-braket-sdk and set AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY"
        )
    elif not braket_ok:
        braket_qpu_requires = "pip install amazon-braket-sdk"
    elif not aws_ok:
        braket_qpu_requires = "set AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY"
    braket_qpu_ok = braket_ok and aws_ok

    # Azure Quantum needs the azure-quantum SDK plus a configured workspace;
    # azure_available() reports both halves in one message.
    from app.quantum.azure import azure_available

    azure_ok, azure_reason = azure_available()
    azure_requires: str | None = None if azure_ok else azure_reason

    return [
        BackendInfo(
            id="aer_simulator",
            name="Aer Simulator",
            vendor="Qiskit",
            kind="simulator",
            max_qubits=24,
            available=True,
            requires=None,
            notes="Ideal statevector/QASM simulation with no noise. The default target.",
        ),
        BackendInfo(
            id="aer_noisy",
            name="Aer Simulator (noisy)",
            vendor="Qiskit",
            kind="simulator",
            # Deliberately half the ideal simulator's width, and NOT a typo.
            # Noisy simulation samples a fresh trajectory per shot, so it costs
            # shots x 2^n rather than 2^n: measured here at 0.83 s for 12 qubits
            # and 13.7 s for 16, both at 1024 shots. Advertising 24 told the
            # device picker a 20-qubit noisy run was fine; it is minutes of CPU.
            # runner.MAX_NOISY_QUBITS enforces the same number server-side.
            max_qubits=MAX_NOISY_QUBITS,
            available=True,
            requires=None,
            notes=(
                "Aer with a depolarising and thermal-relaxation noise model on 1- and "
                f"2-qubit gates, plus readout error. Capped at {MAX_NOISY_QUBITS} qubits: "
                "a noisy shot is a separate trajectory, so cost grows with shots x 2^n."
            ),
        ),
        BackendInfo(
            id="cirq_simulator",
            name="Cirq Simulator",
            vendor="Google",
            kind="simulator",
            max_qubits=20,
            available=cirq_ok,
            requires=None if cirq_ok else "pip install cirq",
            notes="Google's reference simulator. Circuits are imported from OpenQASM 2.",
        ),
        BackendInfo(
            id="braket_local",
            name="Braket Local Simulator",
            vendor="Amazon",
            kind="simulator",
            max_qubits=20,
            available=braket_ok,
            requires=None if braket_ok else "pip install amazon-braket-sdk",
            notes="Runs locally, no AWS account or credentials required.",
        ),
        BackendInfo(
            id="ibm_quantum",
            name="IBM Quantum Hardware",
            vendor="IBM",
            kind="hardware",
            max_qubits=127,
            available=runtime_ok and token_ok,
            requires=ibm_requires,
            notes="Real superconducting hardware. Jobs are queued and asynchronous.",
        ),
        BackendInfo(
            id="ibm_brisbane",
            name="IBM Brisbane (Eagle r3)",
            vendor="IBM",
            kind="hardware",
            max_qubits=127,
            available=runtime_ok and token_ok,
            requires=ibm_requires,
            notes=(
                "127-qubit superconducting device. Jobs are asynchronous: submit, then "
                "poll for the result. Open-plan queue times run from minutes to hours."
            ),
        ),
        BackendInfo(
            id="ionq_aria",
            name="IonQ Aria-1 (via Braket)",
            vendor="IonQ",
            kind="hardware",
            max_qubits=25,
            available=braket_qpu_ok,
            requires=braket_qpu_requires,
            notes=(
                "25-qubit trapped-ion device with all-to-all connectivity. Jobs are "
                "asynchronous and queued (often hours, availability windows apply), and "
                "each submission is billed per shot plus a task fee."
            ),
        ),
        BackendInfo(
            id="rigetti_ankaa",
            name="Rigetti Ankaa-3 (via Braket)",
            vendor="Rigetti",
            kind="hardware",
            max_qubits=84,
            available=braket_qpu_ok,
            requires=braket_qpu_requires,
            notes=(
                "84-qubit superconducting device on a square lattice. Jobs are "
                "asynchronous and queued (minutes to hours) and billed per shot plus a "
                "task fee."
            ),
        ),
        BackendInfo(
            id="azure_quantinuum_h1",
            name="Quantinuum H1-1 (via Azure Quantum)",
            vendor="Quantinuum",
            kind="hardware",
            max_qubits=20,
            available=azure_ok,
            requires=azure_requires,
            notes=(
                "20-qubit trapped-ion device with all-to-all connectivity and mid-circuit "
                "measurement. Jobs are asynchronous and queued, and are billed in "
                "Quantinuum H-System Credits."
            ),
        ),
        BackendInfo(
            id="azure_ionq_aria",
            name="IonQ Aria (via Azure Quantum)",
            vendor="IonQ",
            kind="hardware",
            max_qubits=25,
            available=azure_ok,
            requires=azure_requires,
            notes=(
                "25-qubit trapped-ion device reached through an Azure Quantum workspace. "
                "Jobs are asynchronous and queued, and billed per shot."
            ),
        ),
    ]


def get_backend(backend_id: str) -> BackendInfo:
    """Look up a backend by id and assert that it is usable.

    Args:
        backend_id: The backend identifier from the registry.

    Returns:
        The matching :class:`BackendInfo`.

    Raises:
        ValueError: If the id is unknown, or the backend exists but is
            unavailable (the message names what to install or set).
    """
    backends = list_backends()
    by_id = {backend.id: backend for backend in backends}

    backend = by_id.get(backend_id)
    if backend is None:
        valid = ", ".join(sorted(by_id))
        raise ValueError(f"Unknown backend '{backend_id}'. Valid backends are: {valid}.")

    if not backend.available:
        requires = backend.requires or "additional configuration"
        raise ValueError(
            f"Backend '{backend_id}' ({backend.name}) is not available. To enable it: {requires}."
        )

    return backend
