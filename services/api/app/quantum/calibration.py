"""Per-device calibration summaries for the hardware listing.

A device row that says "127 qubits, superconducting" answers *what the machine
is*; it says nothing about *how well it is running today*, which is the number
that decides whether a 40-deep circuit comes back as signal or as noise. This
module attaches a small, flat calibration summary to every device the listing
returns — qubit count, median 1Q/2Q gate error, median T1/T2, queue depth —
under one hard rule:

**every summary says where its numbers came from, and never upgrades itself.**

* ``source="live"``   — read from the vendor SDK moments ago. Only produced
  when a provider object was actually queried and yielded at least one error
  or coherence figure.
* ``source="static"`` — the shipped table of *typical* values transcribed from
  vendor specification sheets. Served whenever there are no credentials or the
  live read failed. The note says "typical", because a spec sheet is not a
  calibration.
* ``source="unavailable"`` — we have nothing honest to show. An unknown device
  gets this rather than a guess.

Only cheap reads are made: IBM's ``backend.target`` and Braket's
``device.properties`` are metadata the SDK has already fetched (or fetches in
one call) when listing devices — no extra network round-trip per field. Every
extraction is wrapped so a vendor schema change degrades to ``static``,
never to a 500.
"""

from __future__ import annotations

from statistics import median
from typing import Any

SOURCE_LIVE = "live"
SOURCE_STATIC = "static"
SOURCE_UNAVAILABLE = "unavailable"

_STATIC_NOTE = (
    "Vendor-published typical values from the specification sheet — "
    "not a live calibration."
)

# Typical calibration figures, transcribed by hand from vendor spec sheets and
# published benchmarking (same provenance discipline as the pricing table in
# transpile.py: indicative, dated, and labelled as such — never presented as a
# measurement). Times are microseconds; errors are probabilities per gate.
# Keyed by our stable device ids, including the Azure target ids that
# app/quantum/azure.py uses, so azure rows can be labelled without touching
# that module.
STATIC_CALIBRATIONS: dict[str, dict[str, float | int]] = {
    # IBM Eagle r3 family. Same processors that seed the noise model constants
    # (docs/PENNYLANE.md §3) — spec-sheet numbers, not today's calibration.
    "ibm_brisbane": {
        "qubits": 127,
        "median_1q_error": 2.3e-4,
        "median_2q_error": 7.5e-3,
        "median_t1_us": 220.0,
        "median_t2_us": 140.0,
    },
    "ibm_kyiv": {
        "qubits": 127,
        "median_1q_error": 2.8e-4,
        "median_2q_error": 1.1e-2,
        "median_t1_us": 260.0,
        "median_t2_us": 110.0,
    },
    "ibm_sherbrooke": {
        "qubits": 127,
        "median_1q_error": 2.2e-4,
        "median_2q_error": 7.7e-3,
        "median_t1_us": 260.0,
        "median_t2_us": 170.0,
    },
    # Trapped ions: coherence is seconds-to-minutes, so T1/T2 dwarf the
    # superconducting numbers by design, not by typo.
    "ionq_aria": {
        "qubits": 25,
        "median_1q_error": 5.0e-4,
        "median_2q_error": 6.0e-3,
        "median_t1_us": 1.0e8,
        "median_t2_us": 1.0e6,
    },
    "ionq_forte": {
        "qubits": 36,
        "median_1q_error": 2.0e-4,
        "median_2q_error": 5.0e-3,
        "median_t1_us": 1.0e8,
        "median_t2_us": 1.0e6,
    },
    "rigetti_ankaa": {
        "qubits": 84,
        "median_1q_error": 1.5e-3,
        "median_2q_error": 1.5e-2,
        "median_t1_us": 21.0,
        "median_t2_us": 14.0,
    },
    # Azure Quantum targets (their ids, our table). Azure's SDK does not
    # expose calibration cheaply, so these stay static even with credentials.
    "quantinuum.qpu.h1-1": {
        "qubits": 20,
        "median_1q_error": 2.0e-5,
        "median_2q_error": 1.0e-3,
        "median_t1_us": 6.0e7,
        "median_t2_us": 4.0e6,
    },
    "ionq.qpu.aria-1": {
        "qubits": 25,
        "median_1q_error": 5.0e-4,
        "median_2q_error": 6.0e-3,
        "median_t1_us": 1.0e8,
        "median_t2_us": 1.0e6,
    },
}


def _summary(
    source: str,
    *,
    qubits: int | None = None,
    median_1q_error: float | None = None,
    median_2q_error: float | None = None,
    median_t1_us: float | None = None,
    median_t2_us: float | None = None,
    queue_depth: int | None = None,
    note: str = "",
) -> dict[str, Any]:
    """Assemble one calibration summary in the wire shape.

    Args:
        source: ``'live'``, ``'static'`` or ``'unavailable'``.
        qubits: Qubit count, when known.
        median_1q_error: Median single-qubit gate error probability.
        median_2q_error: Median two-qubit gate error probability.
        median_t1_us: Median relaxation time in microseconds.
        median_t2_us: Median dephasing time in microseconds.
        queue_depth: Pending jobs/tasks, when the provider reports one.
        note: Provenance sentence shown in the UI.

    Returns:
        A flat dictionary matching the router's ``CalibrationSummary`` model.
    """
    return {
        "source": source,
        "qubits": qubits,
        "median_1q_error": median_1q_error,
        "median_2q_error": median_2q_error,
        "median_t1_us": median_t1_us,
        "median_t2_us": median_t2_us,
        "queue_depth": queue_depth,
        "note": note,
    }


def static_calibration(device_id: str) -> dict[str, Any]:
    """Serve the typical-values table for a device, honestly labelled.

    Args:
        device_id: Our stable device id (or an Azure target id).

    Returns:
        A ``source='static'`` summary when the device is in the table, else a
        ``source='unavailable'`` summary — never a guess dressed up as data.
    """
    row = STATIC_CALIBRATIONS.get(device_id)
    if row is None:
        return _summary(
            SOURCE_UNAVAILABLE,
            note=f"No calibration data — '{device_id}' is not in the typical-values table.",
        )
    return _summary(
        SOURCE_STATIC,
        qubits=int(row["qubits"]),
        median_1q_error=float(row["median_1q_error"]),
        median_2q_error=float(row["median_2q_error"]),
        median_t1_us=float(row["median_t1_us"]),
        median_t2_us=float(row["median_t2_us"]),
        note=_STATIC_NOTE,
    )


def _median_or_none(values: list[float]) -> float | None:
    """Median of a list, or None for an empty one.

    Args:
        values: Sample values, possibly empty.

    Returns:
        The median, or None.
    """
    return float(median(values)) if values else None


def ibm_calibration(backend: Any, queue_depth: int | None = None) -> dict[str, Any] | None:
    """Summarise a live IBM backend's calibration from its transpilation target.

    ``backend.target`` is the data the SDK already holds after listing
    backends — per-qubit T1/T2 and per-instruction error rates — so reading it
    costs no extra request.

    Args:
        backend: A qiskit ``BackendV2``-shaped object.
        queue_depth: Pending job count, when the caller already read it.

    Returns:
        A ``source='live'`` summary, or None when nothing usable could be read
        (the caller then falls back to :func:`static_calibration`).
    """
    try:
        target = backend.target
        t1s: list[float] = []
        t2s: list[float] = []
        for props in getattr(target, "qubit_properties", None) or []:
            t1 = getattr(props, "t1", None)
            t2 = getattr(props, "t2", None)
            if isinstance(t1, (int, float)):
                t1s.append(float(t1) * 1e6)  # seconds -> microseconds
            if isinstance(t2, (int, float)):
                t2s.append(float(t2) * 1e6)

        errors_1q: list[float] = []
        errors_2q: list[float] = []
        for _name, qargs_map in target.items():
            for qargs, inst_props in (qargs_map or {}).items():
                error = getattr(inst_props, "error", None)
                if not isinstance(error, (int, float)) or qargs is None:
                    continue
                if len(qargs) == 1:
                    errors_1q.append(float(error))
                elif len(qargs) == 2:
                    errors_2q.append(float(error))

        summary = _summary(
            SOURCE_LIVE,
            qubits=int(getattr(backend, "num_qubits", 0) or 0) or None,
            median_1q_error=_median_or_none(errors_1q),
            median_2q_error=_median_or_none(errors_2q),
            median_t1_us=_median_or_none(t1s),
            median_t2_us=_median_or_none(t2s),
            queue_depth=queue_depth,
            note="Read from the device's reported calibration at listing time.",
        )
    except Exception:  # noqa: BLE001 - a vendor schema change degrades, never 500s
        return None

    # "Live" must mean we actually measured something; a target with no error
    # or coherence data is not a calibration, so refuse the label.
    has_data = any(
        summary[key] is not None
        for key in ("median_1q_error", "median_2q_error", "median_t1_us", "median_t2_us")
    )
    return summary if has_data else None


def _braket_queue_depth(device: Any) -> int | None:
    """Read a Braket device's total pending quantum tasks, best effort.

    Args:
        device: An ``AwsDevice``-shaped object.

    Returns:
        The summed queue depth, or None when unreported.
    """
    try:
        info = device.queue_depth()
        tasks = getattr(info, "quantum_tasks", None) or {}
        total = 0
        for value in tasks.values():
            # Braket reports counts as strings, sometimes ">1000".
            total += int(str(value).lstrip(">"))
        return total
    except Exception:  # noqa: BLE001
        return None


def braket_calibration(device: Any) -> dict[str, Any] | None:
    """Summarise a live Braket device's calibration from its properties.

    ``device.properties`` is part of the payload ``AwsDevice.get_devices``
    already fetched. Two vendor schemas are understood: IonQ's provider block
    (``fidelity`` / ``timing``) and the standardized one-/two-qubit properties
    Rigetti publishes. Anything else returns None and the caller serves the
    static table.

    Args:
        device: An ``AwsDevice``-shaped object.

    Returns:
        A ``source='live'`` summary, or None when nothing usable was found.
    """
    try:
        props = device.properties
        qubits: int | None = None
        try:
            qubits = int(props.paradigm.qubitCount)
        except Exception:  # noqa: BLE001
            qubits = None

        e1: float | None = None
        e2: float | None = None
        t1_us: float | None = None
        t2_us: float | None = None

        provider = getattr(props, "provider", None)
        fidelity = getattr(provider, "fidelity", None)
        if isinstance(fidelity, dict):
            one = fidelity.get("1Q") or fidelity.get("1q") or {}
            two = fidelity.get("2Q") or fidelity.get("2q") or {}
            if isinstance(one.get("mean"), (int, float)):
                e1 = 1.0 - float(one["mean"])
            if isinstance(two.get("mean"), (int, float)):
                e2 = 1.0 - float(two["mean"])
        timing = getattr(provider, "timing", None)
        if isinstance(timing, dict):
            if isinstance(timing.get("T1"), (int, float)):
                t1_us = float(timing["T1"]) * 1e6  # seconds -> microseconds
            if isinstance(timing.get("T2"), (int, float)):
                t2_us = float(timing["T2"]) * 1e6

        standardized = getattr(props, "standardized", None)
        if standardized is not None and e2 is None:
            f1: list[float] = []
            f2: list[float] = []
            t1s: list[float] = []
            t2s: list[float] = []
            for q in (getattr(standardized, "oneQubitProperties", None) or {}).values():
                for fid in getattr(q, "oneQubitFidelity", None) or []:
                    value = getattr(fid, "fidelity", None)
                    if isinstance(value, (int, float)):
                        f1.append(float(value))
                t1 = getattr(getattr(q, "T1", None), "value", None)
                t2 = getattr(getattr(q, "T2", None), "value", None)
                if isinstance(t1, (int, float)):
                    t1s.append(float(t1) * 1e6)
                if isinstance(t2, (int, float)):
                    t2s.append(float(t2) * 1e6)
            for pair in (getattr(standardized, "twoQubitProperties", None) or {}).values():
                for fid in getattr(pair, "twoQubitGateFidelity", None) or []:
                    value = getattr(fid, "fidelity", None)
                    if isinstance(value, (int, float)):
                        f2.append(float(value))
            m1 = _median_or_none(f1)
            m2 = _median_or_none(f2)
            e1 = (1.0 - m1) if m1 is not None else e1
            e2 = (1.0 - m2) if m2 is not None else e2
            t1_us = _median_or_none(t1s) or t1_us
            t2_us = _median_or_none(t2s) or t2_us

        summary = _summary(
            SOURCE_LIVE,
            qubits=qubits,
            median_1q_error=e1,
            median_2q_error=e2,
            median_t1_us=t1_us,
            median_t2_us=t2_us,
            queue_depth=_braket_queue_depth(device),
            note="Read from the device's reported properties at listing time.",
        )
    except Exception:  # noqa: BLE001
        return None

    has_data = any(
        summary[key] is not None
        for key in ("median_1q_error", "median_2q_error", "median_t1_us", "median_t2_us")
    )
    return summary if has_data else None
