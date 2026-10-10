#!/usr/bin/env python
"""Prove the hardware path works against a REAL provider account.

Nothing in the test suite can do this. Every hardware test is offline and
injects fakes, which is right — a test suite that spends money is a test suite
nobody runs — but it means the suite passing tells you the code is internally
consistent, not that IBM will accept a job from it. This script is the other
half: it is the thing you run once, by hand, with real credentials, and it is
the first time any of this code touches a live workspace.

    THIS SCRIPT CAN SPEND MONEY.

The default target is an IBM Open-plan device, which is free but heavily
queued. Any IonQ, Rigetti or Quantinuum target is billed per shot plus a task
fee, and `--shots` multiplies it. Nothing is submitted without `--submit`.

USAGE

    # 1. Credentials only - lists what your account can actually see.
    python scripts/hardware_smoke.py

    # 2. Add a circuit and a target - transpiles and prices, submits nothing.
    python scripts/hardware_smoke.py --backend ibm_brisbane

    # 3. Actually submit. Asks for confirmation unless --yes.
    python scripts/hardware_smoke.py --backend ibm_brisbane --shots 1024 --submit

    # 4. Measure observables instead of sampling (EstimatorV2).
    python scripts/hardware_smoke.py --backend ibm_brisbane --observables ZZ,XX --submit

    # 5. Poll a job from a previous run.
    python scripts/hardware_smoke.py --poll ibm:<job_id> --observables ZZ,XX

ENVIRONMENT

    IBM_QUANTUM_TOKEN       required for IBM
    IBM_QUANTUM_INSTANCE    the CRN, required on a multi-instance account
    AWS_ACCESS_KEY_ID       ) required for Braket, plus
    AWS_SECRET_ACCESS_KEY   ) BRAKET_S3_BUCKET
    AZURE_QUANTUM_RESOURCE_ID / AZURE_QUANTUM_LOCATION  required for Azure

Run it from `services/api` with that directory's virtualenv active, so the same
`app.*` modules the service uses are the ones under test.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

# Run from anywhere: put services/api on the path so `app.*` resolves to the
# same modules the service imports. Prepended rather than appended so a
# same-named package installed in the environment cannot shadow the one under
# test — the whole point of this script is to exercise THIS code.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# A Bell pair: two qubits, one entangling gate, and an answer everybody already
# knows. That is the point — the only thing being tested here is the pipe, so
# the circuit must be one where a wrong result is unmistakable. Roughly half
# 00 and half 11, with everything else attributable to noise.
BELL_QASM = """OPENQASM 3.0;
include "stdgates.inc";
qubit[2] q;
bit[2] c;
h q[0];
cx q[0], q[1];
c = measure q;
"""

#: The same pair without the measurement. An Estimator measures the observable
#: for you, so the circuit must arrive with the state still intact.
BELL_NO_MEASURE = """OPENQASM 3.0;
include "stdgates.inc";
qubit[2] q;
h q[0];
cx q[0], q[1];
"""


def _section(title: str) -> None:
    """Print a section heading.

    Args:
        title: The heading text.
    """
    print(f"\n{'=' * 68}\n{title}\n{'=' * 68}")


def _credentials() -> int:
    """Report which providers this environment can reach.

    Returns:
        The number of providers that appear usable.
    """
    from app.core.config import settings
    from app.quantum import hardware

    _section("1. Credentials")
    usable = 0
    for backend, label in (
        ("ibm_brisbane", "IBM Quantum"),
        ("ionq_aria", "Amazon Braket"),
        ("azure_quantinuum_h1", "Azure Quantum"),
    ):
        ok, reason = hardware.is_hardware_available(backend)
        print(f"  {'OK  ' if ok else 'no  '} {label}: {reason}")
        usable += 1 if ok else 0

    if settings.ibm_quantum_token and not settings.ibm_quantum_instance:
        print(
            "\n  NOTE: IBM_QUANTUM_INSTANCE is unset. On an account with a single\n"
            "  service instance that is fine. With several, the SDK picks one for\n"
            "  you, which can mean a job lands on a different plan and a different\n"
            "  bill than you intended - and a poll issued against the other\n"
            "  instance answers 'not found' for a job that plainly exists."
        )
    return usable


def _devices() -> None:
    """List every device the catalogue knows, live rows first."""
    from app.quantum import hardware

    _section("2. Devices")
    devices = hardware.list_hardware_devices()
    live = [d for d in devices if d.get("source") == "live"]
    print(f"  {len(devices)} device(s), {len(live)} of them queried live.\n")
    for device in devices:
        mark = "live " if device.get("source") == "live" else "cat. "
        state = "available" if device.get("available") else "unavailable"
        print(f"  {mark} {device['id']:<28} {device['qubits']:>4}q  {state}")
        if not device.get("available") and device.get("reason"):
            print(f"        reason: {device['reason']}")


def _transpile_and_price(backend: str, shots: int) -> None:
    """Show what the device would actually run, and what it would cost.

    Args:
        backend: The target backend id.
        shots: Shot count to price.
    """
    from app.quantum import transpile as transpile_mod

    _section(f"3. Compile and price for {backend}")
    analysis = transpile_mod.analyse_circuit(BELL_QASM)
    print(f"  Source:     {analysis['num_qubits']} qubits, depth {analysis['depth']}, "
          f"{analysis['two_qubit_gates']} two-qubit gate(s)")

    for level in (1, 3):
        prepared = transpile_mod.transpile_for(BELL_QASM, backend, optimization_level=level)
        print(
            f"  Level {level}:    depth {prepared['depth_after']}, "
            f"{prepared['two_qubit_gates_after']} two-qubit gate(s), "
            f"basis {prepared['basis_gates']}"
        )

    cost = transpile_mod.estimate_cost(backend, shots, int(analysis["num_qubits"]))
    if cost["is_free"]:
        print(f"  Cost:       free - {cost.get('note', '')}")
    else:
        print(
            f"  Cost:       {cost['estimated_total']:.4f} {cost['currency'].upper()} "
            f"for {shots} shots ({cost.get('note', '')})"
        )


def _confirm(backend: str, shots: int) -> bool:
    """Ask before spending anything.

    Args:
        backend: The target device.
        shots: The shot count.

    Returns:
        True when the operator typed the confirmation word.
    """
    print(
        f"\n  About to submit a Bell pair to {backend} at {shots} shots.\n"
        "  On a paid device this costs real money. Type 'yes' to continue: ",
        end="",
    )
    try:
        return input().strip().lower() == "yes"
    except EOFError:
        # No tty (CI, a pipe). Refusing is the only safe reading of silence.
        print("\n  No input available; refusing to submit. Pass --yes to skip this prompt.")
        return False


def _submit(
    backend: str,
    shots: int,
    level: int,
    suppress: bool,
    observables: str | None = None,
) -> dict[str, Any] | None:
    """Submit the Bell pair and print the handle.

    Args:
        backend: Target device id.
        shots: Repetitions.
        level: Qiskit preset pass-manager level.
        suppress: Request dynamical decoupling and readout twirling.

    Returns:
        The submission record, or None when submission failed.
    """
    from app.quantum import hardware
    from app.quantum.observables import parse_observables

    _section(f"4. Submit to {backend}")
    provider = hardware.provider_for(backend)

    # An Estimator needs the UN-measured state: a terminal measurement collapses
    # it before the observable is ever applied, and submit refuses a circuit that
    # carries one rather than silently editing it.
    parsed = None
    source = BELL_QASM
    if observables:
        labels = [part.strip().upper() for part in observables.split(",") if part.strip()]
        parsed = parse_observables(
            [{"label": label, "terms": [{"pauli": label}]} for label in labels], 2
        )
        source = BELL_NO_MEASURE

    try:
        record = hardware.submit_job(
            source,
            backend,
            shots,
            provider,
            optimization_level=level,
            owner="smoke-test",
            dynamical_decoupling=suppress,
            measurement_twirling=suppress,
            observables=parsed,
        )
    except Exception as exc:  # noqa: BLE001 - this script reports, it does not raise
        print(f"  REFUSED: {exc}")
        return None

    print(json.dumps(record, indent=2, default=str))

    # The poll needs the observable labels back, because IBM stores the
    # observables but not our names for them — without them the values come
    # back positional.
    poll_args = f"--poll {record['provider']}:{record['job_id']}"
    if observables:
        poll_args += f" --observables {observables}"
    print(f"\n  Poll it with:\n    python scripts/hardware_smoke.py {poll_args}")
    return record


def _poll(spec: str, observables: str | None = None) -> None:
    """Look up one job by ``provider:job_id``.

    Args:
        spec: The colon-separated handle. Braket ARNs contain colons, so only
            the FIRST colon separates the provider from the id.
        observables: Comma-separated observable labels for an estimator job.
            Their presence is what makes this an estimator poll - IBM stores
            the observables but not our names for them.
    """
    from app.quantum import hardware

    provider, _, job_id = spec.partition(":")
    if not provider or not job_id:
        print("  --poll expects provider:job_id, e.g. ibm:abc123")
        return

    labels = None
    if observables:
        labels = [part.strip() for part in observables.split(",") if part.strip()]

    _section(f"Poll {provider}/{job_id}")
    try:
        status = hardware.poll_job(provider, job_id, labels)
    except Exception as exc:  # noqa: BLE001
        print(f"  FAILED: {exc}")
        return

    print(json.dumps(status, indent=2, default=str))

    values = status.get("expectation_values")
    if values:
        print("\n  Expectation values:")
        for value in values:
            reported = value.get("value")
            error = value.get("std_error")
            shown = "unreadable" if reported is None else f"{reported:+.4f}"
            margin = "" if error is None else f" +/- {error:.4f}"
            print(f"    {value.get('label', '?'):<16} {shown}{margin}")
        print(
            "\n  A noiseless Bell pair gives <ZZ> = +1 and <XX> = +1 exactly.\n"
            "  On real hardware anything above about 0.9 is healthy; well below\n"
            "  that and you are measuring the decoherence, not the state."
        )

    counts = status.get("counts")
    if counts:
        total = sum(counts.values()) or 1
        correlated = counts.get("00", 0) + counts.get("11", 0)
        print(
            f"\n  {correlated}/{total} shots landed on 00 or 11 "
            f"({100 * correlated / total:.1f}%).\n"
            "  On a noiseless device that would be 100%. On real superconducting\n"
            "  hardware anything above roughly 90% is a healthy Bell pair; well\n"
            "  below that and you are looking at the decoherence, not the state."
        )


def main() -> int:
    """Parse arguments and run the requested checks.

    Returns:
        A process exit code.
    """
    parser = argparse.ArgumentParser(
        description="Verify the hardware path against a real provider account.",
    )
    parser.add_argument("--backend", help="Device id, e.g. ibm_brisbane or ionq_aria.")
    parser.add_argument("--shots", type=int, default=1024, help="Repetitions (default 1024).")
    parser.add_argument(
        "--optimization-level", type=int, default=1, choices=(0, 1, 2, 3),
        help="Qiskit preset pass-manager level (default 1).",
    )
    parser.add_argument(
        "--suppress", action="store_true",
        help="Request dynamical decoupling and readout twirling (free; IBM only).",
    )
    parser.add_argument("--submit", action="store_true", help="Actually enqueue the job.")
    parser.add_argument("--yes", action="store_true", help="Skip the confirmation prompt.")
    parser.add_argument("--poll", metavar="PROVIDER:JOB_ID", help="Poll an existing job and exit.")
    parser.add_argument(
        "--observables", metavar="ZZ,XX",
        help=(
            "Measure these Pauli observables instead of sampling, which makes this an "
            "EstimatorV2 job. On --poll, the labels to name the returned values with."
        ),
    )
    args = parser.parse_args()

    if args.poll:
        _poll(args.poll, args.observables)
        return 0

    usable = _credentials()
    _devices()

    if not args.backend:
        print(
            "\n  Pass --backend <id> to compile and price a circuit for a device.\n"
            "  Add --submit to actually run it."
        )
        return 0 if usable else 1

    _transpile_and_price(args.backend, args.shots)

    if not args.submit:
        print("\n  Nothing was submitted. Add --submit to enqueue this job.")
        return 0

    if not args.yes and not _confirm(args.backend, args.shots):
        print("  Cancelled.")
        return 0

    submitted = _submit(
        args.backend, args.shots, args.optimization_level, args.suppress, args.observables
    )
    return 0 if submitted else 1


if __name__ == "__main__":
    sys.exit(main())
