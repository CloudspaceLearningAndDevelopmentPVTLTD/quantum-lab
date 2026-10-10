"""Cross-vendor device recommendation: where should this circuit actually run?

Every vendor console can tell you how its own machine is calibrated today. None
of them can tell you whether your circuit would come back cleaner, or cheaper
per usable shot, on somebody else's machine. This service already holds all
four inputs needed to answer that in one place — per-device calibration
(:mod:`app.quantum.calibration`), vendor basis sets and transpilation plus
published pricing (:mod:`app.quantum.transpile`), and queue depth from the
device listing (:mod:`app.quantum.hardware`) — so this module joins them.

It is pure: no network, no vendor SDK, no credentials. Live calibration and
queue depth are *passed in* by the caller (from ``list_hardware_devices()``)
rather than fetched here, which is what keeps it testable offline and what lets
the same function serve a logged-out visitor from the static tables.

THE MODEL, stated so you can argue with it
------------------------------------------
For each candidate device the circuit is transpiled to that vendor's basis and
the resulting one- and two-qubit gate counts are read off. The projected
probability that *the whole circuit survives* is then

    P = (1 - e1) ** n1 * (1 - e2) ** n2 * exp(-w * t / T)

where ``e1``/``e2`` are the device's median one-/two-qubit gate errors, ``n1``/
``n2`` the transpiled gate counts, ``w`` the circuit width, ``t`` an estimated
wall-clock duration and ``T`` the median T2 (falling back to T1). The first two
factors are independent per-gate survival; the third is idle decoherence and
can be switched off with ``include_decoherence=False``.

This is deliberately the simplest defensible model. A more elaborate one would
look more authoritative without being more true, because the inputs above are
medians over a whole chip, and no amount of arithmetic recovers the per-qubit
structure that the median threw away.

WHAT THE MODEL IGNORES — read this before quoting a number from it
------------------------------------------------------------------
* **Crosstalk.** Simultaneous gates on neighbouring qubits degrade each other.
  Nothing here models that, so P is optimistic for wide, parallel circuits.
* **Non-uniform error across the device.** A median hides the spread. A real
  layout lands on specific qubits, and a bad pair can be an order of magnitude
  worse than the median. P is neither an upper nor a lower bound on what a
  particular layout gives you.
* **SPAM / readout error.** Not modelled *at all* — the calibration summary
  this service collects carries no readout-error field, so state preparation
  and measurement errors are simply absent from P. On superconducting hardware
  readout is often the single largest error term, which makes P materially
  optimistic there.
* **Routing and SWAP overhead.** :func:`app.quantum.transpile.transpile_for`
  targets each vendor's *basis gates* but not its *coupling map*, because this
  service does not hold per-device coupling maps. So the two-qubit gate count
  for a limited-connectivity superconducting device omits the SWAPs a real
  transpile would insert. This is the model's largest systematic bias and it
  runs one way: it flatters lattice devices (IBM, Rigetti) relative to
  all-to-all trapped-ion devices (IonQ, Quantinuum), which need no routing.
* **Basis-set expressibility, which biases the gate counts the OTHER way.**
  The one- and two-qubit counts compared across vendors are counts in
  *different* gate sets, and those sets are not equally expressive.
  :mod:`app.quantum.transpile` can only target a vendor's basis through
  Qiskit's ``basis_gates`` argument, so IBM (``sx``/``rz``/``cx``/``x``) and
  Rigetti (``rx``/``rz``/``cz``) are transpiled to their real native sets,
  while IonQ's true set (``gpi``/``gpi2``/``ms``) is not expressible that way
  and Quantinuum has no entry at all — both fall back to the universal
  ``u``/``cx``. A ``u`` is one gate here and several native pulses there, so a
  Bell pair costs 3 one-qubit gates on IBM, 9 on Rigetti and 1 on IonQ in this
  model, and only the first two of those are counts of anything real. This
  under-counts trapped-ion gate error and so runs *opposite* to the routing
  bias above; the two do not cancel, and neither is quantified. When it
  applies, ``inputs.transpile_notes`` says so for IonQ — but NOT for
  Quantinuum, whose fallback basis is standard and therefore silent.
* **Which contract you are billed under.** ``azure_ionq_aria`` and
  ``ionq_aria`` are the same trap reached two ways, and
  :func:`app.quantum.transpile.estimate_cost` prices both at Amazon Braket's
  published per-shot rate plus its per-task fee, because both map to vendor
  family ``ionq``. Azure Quantum does not bill on Braket's schedule, so the
  dollar figure on the Azure row — and therefore its place in a per-dollar
  ranking — is the Braket price wearing an Azure label. The two rows will
  score near-identically for that reason and not because the invoices agree.
* **Drift since the calibration snapshot.** Even a ``source='live'`` row was
  read at listing time and devices are recalibrated on their own schedule; a
  ``source='static'`` row is a specification sheet and was never a measurement
  of the machine you would run on.
* **Gate durations** are a per-vendor typical table here (see
  :data:`VENDOR_GATE_TIME_US`), not per-device data, so the decoherence term is
  the coarsest part of the model. The duration is ``depth * mean gate time``
  and Qiskit's ``depth()`` counts the measurement layer, which is therefore
  charged one average gate time even though measurement is excluded from the
  gate census — a small over-estimate of duration, kept because inventing a
  readout duration would be worse than a layer of slop.

Accordingly every number this module returns is a PROJECTION and is labelled as
one, every row carries the provenance of the calibration it was computed from,
and a device whose calibration is ``unavailable`` is reported as **unrankable**
rather than handed an invented score.
"""

from __future__ import annotations

import math
from typing import Any

from app.quantum.calibration import (
    SOURCE_UNAVAILABLE,
    STATIC_CALIBRATIONS,
    static_calibration,
)
from app.quantum.hardware import (
    AZURE_BACKEND_TARGETS,
    BACKEND_PROVIDER,
    BRAKET_DEVICE_ARNS,
    KNOWN_DEVICES,
)
from app.quantum.runner import parse_qasm
from app.quantum.transpile import estimate_cost, transpile_for, vendor_for

#: Objective: minimise dollars spent per shot that survives the circuit.
#:
#: ``cost_per_successful_shot = estimated_total / (shots * P)``. Lower is
#: better. This is the objective that answers the question the module exists
#: for ("most usable result per dollar") and it has one property worth stating
#: out loud rather than hiding: a genuinely free device scores 0.0 whatever its
#: fidelity, so all free devices tie at the top and are then ordered among
#: themselves by projected success probability. That is a real consequence of
#: asking for value per dollar when the dollar figure is zero, not a defect.
OBJECTIVE_COST_PER_SUCCESSFUL_SHOT = "min_cost_per_successful_shot"

#: Objective: maximise the projected whole-circuit success probability, price
#: ignored. Use this when the budget is already decided, or to rank devices we
#: cannot price in dollars (Quantinuum) alongside ones we can.
OBJECTIVE_SUCCESS_PROBABILITY = "max_success_probability"

OBJECTIVES: dict[str, str] = {
    OBJECTIVE_COST_PER_SUCCESSFUL_SHOT: (
        "Minimise estimated USD per projected surviving shot "
        "(estimated_total / (shots x projected success probability)). "
        "Devices this service cannot price in dollars are excluded from the "
        "ranking rather than scored as free. Free devices score 0.00 and are "
        "ordered among themselves by projected success probability."
    ),
    OBJECTIVE_SUCCESS_PROBABILITY: (
        "Maximise the projected probability that the whole circuit survives, "
        "ignoring price entirely."
    ),
}

DEFAULT_OBJECTIVE = OBJECTIVE_COST_PER_SUCCESSFUL_SHOT

#: The devices considered when the caller names none.
#:
#: Derived from the hardware dispatch table rather than retyped, so a device
#: added to :data:`app.quantum.hardware.BACKEND_PROVIDER` is recommended on
#: without anyone remembering to edit a second list. ``ibm_quantum`` is dropped
#: because it is the generic "pick an IBM device" alias, not a machine: it has
#: no calibration row of its own and would only ever appear as unrankable.
DEFAULT_CANDIDATES: tuple[str, ...] = tuple(
    sorted(set(BACKEND_PROVIDER) - {"ibm_quantum"})
)

#: Typical gate durations in microseconds, per vendor family.
#:
#: Transcribed by hand from vendor documentation and published benchmarking,
#: with the same provenance discipline as the pricing table in transpile.py:
#: indicative, coarse, and never presented as a measurement. They exist only to
#: turn a transpiled depth into an order-of-magnitude wall-clock time for the
#: decoherence term. The superconducting/trapped-ion split spans four orders of
#: magnitude, which is the part that actually matters — a 200-layer circuit is
#: microseconds on Rigetti and tens of milliseconds on Aria — so getting the
#: family right matters far more than the second significant figure.
VENDOR_GATE_TIME_US: dict[str, dict[str, float]] = {
    "ibm": {"one_qubit": 0.035, "two_qubit": 0.5},
    "rigetti": {"one_qubit": 0.04, "two_qubit": 0.18},
    "ionq": {"one_qubit": 135.0, "two_qubit": 600.0},
    "quantinuum": {"one_qubit": 10.0, "two_qubit": 300.0},
    "simulator": {"one_qubit": 0.0, "two_qubit": 0.0},
}

#: Operations that are not gates for error-budget purposes.
#:
#: ``measure`` is excluded here specifically because this model does NOT have a
#: readout error to charge it with; counting measurements against the 1Q gate
#: error would be making up a SPAM term, which is worse than admitting we have
#: none. The module docstring says readout is unmodelled; this is where that
#: promise is kept.
_NON_GATE_OPS: frozenset[str] = frozenset({"measure", "barrier", "reset", "delay"})

#: Qubit counts for the devices we reach, for the "is the circuit even wide
#: enough to fit" check. Built from the hardware catalogue plus the static
#: calibration table (which is where the Azure targets' widths live).
_DEVICE_QUBITS: dict[str, int] = {
    **{
        str(device["id"]): int(device["qubits"])
        for device in KNOWN_DEVICES
        if device.get("qubits")
    },
    **{
        backend_id: int(STATIC_CALIBRATIONS[target]["qubits"])
        for backend_id, target in AZURE_BACKEND_TARGETS.items()
        if target in STATIC_CALIBRATIONS
    },
}

_PROJECTION_DISCLAIMER = (
    "Every figure below is a PROJECTION computed from calibration medians and "
    "published prices, not a measurement of your circuit on the device. "
    "Treat the ranking as a starting point, not a guarantee."
)


def _calibration_key(backend_id: str) -> str:
    """Translate a registry backend id into the key the calibration table uses.

    The static calibration table keys its two Azure rows by Microsoft's target
    strings (``quantinuum.qpu.h1-1``, ``ionq.qpu.aria-1``) while every route in
    this service is keyed by our registry ids (``azure_quantinuum_h1``,
    ``azure_ionq_aria``). Without this translation both Azure devices would
    report ``source='unavailable'`` and drop out of every ranking, which looks
    exactly like "we have no data" rather than "we looked in the wrong drawer".

    Args:
        backend_id: Our stable registry backend id.

    Returns:
        The id to pass to :func:`app.quantum.calibration.static_calibration`.
    """
    return AZURE_BACKEND_TARGETS.get(backend_id, backend_id)


def _row_ids_for(backend_id: str) -> frozenset[str]:
    """Every spelling a ``list_hardware_devices()`` row may use for a backend.

    ``list_hardware_devices()`` does not speak one language. Catalogue rows and
    live IBM rows are keyed by our registry id, the Azure rows are translated
    back to it on the way out — but ``_live_braket_devices()`` publishes
    ``row["id"] = str(device.arn)`` and nothing translates that. So matching on
    the registry id alone silently misses ionq_aria, ionq_forte and
    rigetti_ankaa *exactly when AWS credentials exist*, which is the only time
    there is live calibration to miss: three of the eight devices would fall
    back to the typical-values table and lose their live queue depth, while the
    offline tests (which hand-build IBM-shaped rows) stayed green.

    Failing that way is safe rather than dishonest — the row is still labelled
    ``static`` — but "live calibration wins" is the reason this module takes a
    ``devices`` argument at all, so a silent no-op is still a defect. The
    rejected alternative was fixing the id at the source in
    ``_live_braket_devices``; that file is shared and is not ours to edit, and
    accepting both spellings here is robust either way.

    Args:
        backend_id: Our stable registry backend id.

    Returns:
        The set of row ids that identify this backend.
    """
    aliases = {backend_id}
    arn = BRAKET_DEVICE_ARNS.get(backend_id)
    if arn:
        aliases.add(arn)
    target = AZURE_BACKEND_TARGETS.get(backend_id)
    if target:
        aliases.add(target)
    return frozenset(aliases)


def _gate_mix(gate_counts: dict[str, int], two_qubit_gates: int) -> tuple[int, int]:
    """Split a transpiled gate census into one-qubit and two-qubit counts.

    Args:
        gate_counts: ``count_ops``-style mapping from transpile_for.
        two_qubit_gates: The entangling-gate count transpile_for already
            computed by walking the instruction list.

    Returns:
        ``(one_qubit_gates, two_qubit_gates)``. The one-qubit count is derived
        by subtraction, so a three-qubit gate that survived transpilation would
        be counted once as "two-qubit" and not at all as one-qubit — acceptable
        because no vendor basis in this service contains one.
    """
    total_gates = sum(
        count for name, count in gate_counts.items() if name not in _NON_GATE_OPS
    )
    one_qubit = max(total_gates - two_qubit_gates, 0)
    return one_qubit, int(two_qubit_gates)


def _estimated_duration_us(
    vendor: str, depth: int, one_qubit_gates: int, two_qubit_gates: int
) -> float | None:
    """Estimate a circuit's wall-clock duration on a vendor's hardware.

    Model: each transpiled layer costs about one *average* gate time for this
    circuit's particular gate mix, so ``duration = depth * mean_gate_time``.
    The rejected alternative was summing every gate's duration, which assumes
    full serialisation and overstates duration by roughly the circuit width on
    a wide circuit; depth already encodes the critical path, which is what
    idling qubits actually wait through.

    Args:
        vendor: Vendor family from :func:`app.quantum.transpile.vendor_for`.
        depth: Transpiled circuit depth.
        one_qubit_gates: Transpiled one-qubit gate count.
        two_qubit_gates: Transpiled two-qubit gate count.

    Returns:
        Duration in microseconds, or None when the vendor has no duration row
        (in which case the caller must omit the decoherence term rather than
        substitute a guess).
    """
    times = VENDOR_GATE_TIME_US.get(vendor)
    if times is None:
        return None
    total_gates = one_qubit_gates + two_qubit_gates
    if total_gates == 0 or depth == 0:
        return 0.0
    mean_gate_us = (
        one_qubit_gates * times["one_qubit"] + two_qubit_gates * times["two_qubit"]
    ) / total_gates
    return float(depth) * mean_gate_us


def project_success_probability(
    *,
    one_qubit_gates: int,
    two_qubit_gates: int,
    median_1q_error: float | None,
    median_2q_error: float | None,
    width: int,
    duration_us: float | None = None,
    coherence_us: float | None = None,
) -> dict[str, Any]:
    """Project the probability that a whole circuit survives on a device.

    Multiplies independent per-gate survival probabilities and, when a duration
    and a coherence time are both supplied, folds in an idle-decoherence factor
    ``exp(-width * duration / coherence)``. That factor charges *every* qubit
    for the *entire* circuit duration, which over-counts exposure for qubits
    that are being actively driven — it is therefore a pessimistic bound on the
    coherence term, and it is reported separately from the gate term so a
    reader can discount it.

    Args:
        one_qubit_gates: Transpiled one-qubit gate count.
        two_qubit_gates: Transpiled two-qubit gate count.
        median_1q_error: Median one-qubit gate error probability, or None.
        median_2q_error: Median two-qubit gate error probability, or None.
        width: Number of qubits the circuit occupies.
        duration_us: Estimated wall-clock duration in microseconds, or None.
        coherence_us: Median T2 (or T1) in microseconds, or None.

    Returns:
        ``{estimated_success_probability, gate_survival, coherence_survival,
        is_projection, missing}`` where ``missing`` names the calibration
        figures that were needed and absent. When ``missing`` is non-empty the
        probability is None — an absent input produces no number, never a
        default.

    Raises:
        ValueError: When a supplied error probability is outside [0, 1), a gate
            count is negative, or ``width``/``duration_us``/``coherence_us`` is
            negative.
    """
    if one_qubit_gates < 0 or two_qubit_gates < 0:
        raise ValueError(
            f"Gate counts must be non-negative, got {one_qubit_gates!r} / {two_qubit_gates!r}."
        )
    # A negative width or duration flips the sign of the decoherence exponent,
    # and exp() of a positive number is > 1: this function would then return a
    # "probability" of 7e86 from a signature that documents a probability.
    # Nothing inside this module can produce one (both come from a transpiled
    # circuit), but the function is public, so it refuses rather than trusting
    # its caller to have done the arithmetic that makes the output meaningful.
    if width < 0:
        raise ValueError(f"width must be non-negative, got {width!r}.")
    if duration_us is not None and float(duration_us) < 0.0:
        raise ValueError(f"duration_us must be non-negative, got {duration_us!r}.")
    if coherence_us is not None and float(coherence_us) < 0.0:
        raise ValueError(f"coherence_us must be non-negative, got {coherence_us!r}.")
    for label, error in (("median_1q_error", median_1q_error), ("median_2q_error", median_2q_error)):
        if error is not None and not (0.0 <= float(error) < 1.0):
            raise ValueError(f"{label} must be in [0, 1), got {error!r}.")

    missing: list[str] = []
    if one_qubit_gates > 0 and median_1q_error is None:
        missing.append("median_1q_error")
    if two_qubit_gates > 0 and median_2q_error is None:
        missing.append("median_2q_error")

    if missing:
        return {
            "estimated_success_probability": None,
            "gate_survival": None,
            "coherence_survival": None,
            "is_projection": True,
            "missing": missing,
        }

    gate_survival = 1.0
    if one_qubit_gates > 0:
        gate_survival *= (1.0 - float(median_1q_error or 0.0)) ** one_qubit_gates
    if two_qubit_gates > 0:
        gate_survival *= (1.0 - float(median_2q_error or 0.0)) ** two_qubit_gates

    coherence_survival: float | None = None
    if duration_us is not None and coherence_us is not None and coherence_us > 0.0:
        exponent = -(float(width) * float(duration_us)) / float(coherence_us)
        # math.exp underflows to 0.0 well before it overflows here; a circuit
        # that long genuinely returns noise, so 0.0 is the right answer rather
        # than an exception.
        coherence_survival = math.exp(exponent) if exponent > -700.0 else 0.0

    probability = gate_survival
    if coherence_survival is not None:
        probability *= coherence_survival

    return {
        "estimated_success_probability": probability,
        "gate_survival": gate_survival,
        "coherence_survival": coherence_survival,
        "is_projection": True,
        "missing": [],
    }


def _calibration_for(
    backend_id: str, devices: list[dict[str, Any]] | None
) -> dict[str, Any]:
    """Pick the best calibration summary available for a backend.

    A live row supplied by the caller wins over the static table; a caller row
    that itself says ``unavailable`` does not, because the static table may
    still hold typical values for that device. Rows are matched on any of the
    ids the device listing uses for that backend (see :func:`_row_ids_for`).

    Args:
        backend_id: Our registry backend id.
        devices: Rows in the shape of ``list_hardware_devices()``, or None.

    Returns:
        A calibration summary dict — always with a ``source`` key.
    """
    fallback = static_calibration(_calibration_key(backend_id))
    aliases = _row_ids_for(backend_id)
    for row in devices or []:
        if str(row.get("id", "")) not in aliases and str(
            row.get("vendor_target", "")
        ) not in aliases:
            continue
        summary = row.get("calibration")
        if isinstance(summary, dict) and summary.get("source") != SOURCE_UNAVAILABLE:
            return summary
        return fallback
    return fallback


def _unrankable(
    backend_id: str,
    vendor: str,
    reason: str,
    *,
    calibration: dict[str, Any] | None = None,
    inputs: dict[str, Any] | None = None,
    cost: dict[str, Any] | None = None,
    projection: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build a row for a device that cannot honestly be given a score.

    Args:
        backend_id: Our registry backend id.
        vendor: Vendor family.
        reason: Plain-language explanation shown to the user.
        calibration: The calibration summary, when one was obtained.
        inputs: The transpilation inputs, when transpilation succeeded.
        cost: The cost estimate, when one was produced.
        projection: The success projection, when one was produced.

    Returns:
        A result row with ``rankable=False``, ``rank=None`` and ``score=None``.
    """
    summary = calibration or {"source": SOURCE_UNAVAILABLE, "note": "", "queue_depth": None}
    return {
        "backend": backend_id,
        "vendor": vendor,
        "device_qubits": _DEVICE_QUBITS.get(backend_id),
        "rankable": False,
        "rank": None,
        "score": None,
        "unrankable_reason": reason,
        "projection": projection,
        "inputs": inputs,
        "cost": cost,
        "queue_depth": summary.get("queue_depth"),
        "calibration_source": summary.get("source", SOURCE_UNAVAILABLE),
        "calibration_note": summary.get("note", ""),
    }


def _evaluate_device(
    qasm: str,
    backend_id: str,
    *,
    shots: int,
    optimization_level: int,
    include_decoherence: bool,
    devices: list[dict[str, Any]] | None,
) -> dict[str, Any]:
    """Produce one device's row: projection, inputs, cost and provenance.

    Args:
        qasm: OpenQASM 3 (or 2) circuit source.
        backend_id: Our registry backend id.
        shots: Shot count the ranking is priced at.
        optimization_level: Qiskit optimisation level for the transpile.
        include_decoherence: Whether to fold in the idle-decoherence term.
        devices: Live device rows from ``list_hardware_devices()``, or None.

    Returns:
        A result row. ``rankable`` is False whenever any input needed for a
        score was missing; the row still carries whatever was obtained.
    """
    vendor = vendor_for(backend_id)
    calibration = _calibration_for(backend_id, devices)

    try:
        transpiled = transpile_for(qasm, backend_id, optimization_level=optimization_level)
    except ValueError as exc:
        return _unrankable(
            backend_id,
            vendor,
            f"The circuit could not be transpiled for this device: {exc}",
            calibration=calibration,
        )

    width = int(transpiled["num_qubits"])
    depth = int(transpiled["depth_after"])
    one_qubit_gates, two_qubit_gates = _gate_mix(
        transpiled["gate_counts_after"], int(transpiled["two_qubit_gates_after"])
    )

    duration_us = (
        _estimated_duration_us(vendor, depth, one_qubit_gates, two_qubit_gates)
        if include_decoherence
        else None
    )
    # T2 is the right clock for a circuit that contains superpositions; T1 is
    # only used when the device reports no T2, and the row says which was used
    # so nobody has to guess.
    coherence_us = calibration.get("median_t2_us") or calibration.get("median_t1_us")
    coherence_basis = (
        "T2"
        if calibration.get("median_t2_us")
        else ("T1" if calibration.get("median_t1_us") else None)
    )

    inputs: dict[str, Any] = {
        "transpiled_depth": depth,
        "one_qubit_gates": one_qubit_gates,
        "two_qubit_gates": two_qubit_gates,
        "circuit_qubits": width,
        "basis_gates": transpiled["basis_gates"],
        "transpile_notes": transpiled["notes"],
        "median_1q_error": calibration.get("median_1q_error"),
        "median_2q_error": calibration.get("median_2q_error"),
        "median_t1_us": calibration.get("median_t1_us"),
        "median_t2_us": calibration.get("median_t2_us"),
        "coherence_basis": coherence_basis if include_decoherence else None,
        "estimated_duration_us": duration_us,
        "decoherence_included": bool(
            include_decoherence and duration_us is not None and coherence_us
        ),
    }

    cost = dict(estimate_cost(backend_id, shots, width))
    # transpile.py signals "we cannot price this vendor" as total == 0 with
    # is_free False (Quantinuum bills in H-System Credits). Deriving `priced`
    # from that public contract, rather than reaching for the private
    # _UNPRICED_VENDORS set, keeps the two modules decoupled — and the check is
    # the whole reason Quantinuum never reaches the top of a per-dollar
    # ranking on a zero it does not have.
    priced = bool(cost["is_free"]) or float(cost["estimated_total"]) > 0.0
    cost["priced"] = priced
    cost["cost_per_successful_shot"] = None

    device_qubits = _DEVICE_QUBITS.get(backend_id)
    if device_qubits is not None and width > device_qubits:
        return _unrankable(
            backend_id,
            vendor,
            f"The circuit needs {width} qubits and this device has {device_qubits}.",
            calibration=calibration,
            inputs=inputs,
            cost=cost,
        )

    if calibration.get("source") == SOURCE_UNAVAILABLE:
        return _unrankable(
            backend_id,
            vendor,
            "No calibration data for this device, so there is nothing to project "
            "a success probability from. Scoring it would mean inventing the "
            "inputs.",
            calibration=calibration,
            inputs=inputs,
            cost=cost,
        )

    projection = project_success_probability(
        one_qubit_gates=one_qubit_gates,
        two_qubit_gates=two_qubit_gates,
        median_1q_error=calibration.get("median_1q_error"),
        median_2q_error=calibration.get("median_2q_error"),
        width=width,
        duration_us=duration_us,
        coherence_us=coherence_us if include_decoherence else None,
    )

    if projection["missing"]:
        return _unrankable(
            backend_id,
            vendor,
            "This device's calibration is missing "
            + ", ".join(projection["missing"])
            + ", which the projection needs for the gates in this circuit.",
            calibration=calibration,
            inputs=inputs,
            cost=cost,
            projection=projection,
        )

    probability = float(projection["estimated_success_probability"])
    if priced and probability > 0.0:
        cost["cost_per_successful_shot"] = float(cost["estimated_total"]) / (
            float(shots) * probability
        )

    return {
        "backend": backend_id,
        "vendor": vendor,
        "device_qubits": device_qubits,
        "rankable": True,
        "rank": None,  # filled in by recommend_devices once the objective sorts
        "score": None,
        "unrankable_reason": None,
        "projection": projection,
        "inputs": inputs,
        "cost": cost,
        "queue_depth": calibration.get("queue_depth"),
        "calibration_source": calibration.get("source"),
        "calibration_note": calibration.get("note", ""),
    }


def _apply_objective(
    row: dict[str, Any], objective: str
) -> tuple[bool, str | None]:
    """Attach the objective's score to a row, or explain why it has none.

    Args:
        row: A rankable row from :func:`_evaluate_device`.
        objective: One of :data:`OBJECTIVES`.

    Returns:
        ``(scored, reason)``; when ``scored`` is False, ``reason`` says why.
    """
    probability = float(row["projection"]["estimated_success_probability"])

    if objective == OBJECTIVE_SUCCESS_PROBABILITY:
        row["score"] = probability
        return True, None

    if probability <= 0.0:
        return False, (
            "The projected success probability underflows to zero at this "
            "depth, so cost per surviving shot is unbounded. This device is "
            "not a candidate for this circuit."
        )
    if not row["cost"]["priced"]:
        return False, (
            f"This service cannot price {row['vendor']} runs in dollars, so it "
            "cannot be ranked by cost per surviving shot. It is NOT free — see "
            "the cost note. Rank by "
            f"'{OBJECTIVE_SUCCESS_PROBABILITY}' to include it."
        )
    row["score"] = float(row["cost"]["cost_per_successful_shot"])
    return True, None


def recommend_devices(
    qasm: str,
    *,
    shots: int = 1024,
    backends: list[str] | None = None,
    optimization_level: int = 1,
    objective: str = DEFAULT_OBJECTIVE,
    include_decoherence: bool = True,
    devices: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Rank the devices this service reaches for one circuit.

    Args:
        qasm: OpenQASM 3 (or 2) circuit source.
        shots: Shot count the cost estimate and the ranking are priced at.
        backends: Candidate backend ids; defaults to
            :data:`DEFAULT_CANDIDATES`.
        optimization_level: Qiskit optimisation level, 0..3, applied to every
            candidate equally so the comparison is like-for-like.
        objective: One of :data:`OBJECTIVES`.
        include_decoherence: Fold the idle-decoherence term into the
            projection. Switch it off to see the pure gate-error budget.
        devices: Rows from
            :func:`app.quantum.hardware.list_hardware_devices`, supplying live
            calibration and queue depth. Omit for the static tables — the
            result says which was used, per device.

    Returns:
        ``{objective, objective_description, objective_better_when, shots,
        optimization_level, disclaimer, model, ranked, unrankable}``.
        ``ranked`` is ordered best-first with ``rank`` set from 1; every row in
        either list carries ``calibration_source``.

    Raises:
        ValueError: When ``shots`` is not a positive integer, ``objective`` is
            unknown, ``optimization_level`` is outside 0..3, ``backends`` is
            empty, or the circuit cannot be parsed.
    """
    if not isinstance(shots, int) or isinstance(shots, bool) or shots < 1:
        raise ValueError(f"shots must be a positive integer, got {shots!r}.")
    if objective not in OBJECTIVES:
        raise ValueError(
            f"Unknown objective {objective!r}; expected one of {sorted(OBJECTIVES)}."
        )
    # Both of the next two checks exist because _evaluate_device catches
    # ValueError from transpile_for and turns it into a per-device "the circuit
    # could not be transpiled for this device" row. That is the right handling
    # for a genuine device-specific basis failure and the wrong handling for a
    # caller mistake: an unparseable circuit or optimization_level=9 is not a
    # property of ibm_brisbane, yet it would come back as eight unrankable
    # devices and an empty ranking, which a UI renders as "no device can run
    # your circuit" — blaming the hardware for the user's typo. Same reasoning
    # as the empty-backends check below: an empty ranking must be an answer,
    # never a swallowed input error.
    if optimization_level not in (0, 1, 2, 3):
        raise ValueError(
            f"optimization_level must be 0, 1, 2 or 3, got {optimization_level!r}."
        )
    parse_qasm(qasm)  # raises ValueError with the parser's own message
    candidates = list(backends) if backends is not None else list(DEFAULT_CANDIDATES)
    if not candidates:
        raise ValueError("backends must name at least one device to compare.")
    # A repeated backend would otherwise occupy two ranks with identical
    # numbers, which reads as two devices agreeing rather than one counted
    # twice. First occurrence wins so the caller's order is still honoured by
    # the id tie-break.
    candidates = list(dict.fromkeys(candidates))

    rows = [
        _evaluate_device(
            qasm,
            backend_id,
            shots=shots,
            optimization_level=optimization_level,
            include_decoherence=include_decoherence,
            devices=devices,
        )
        for backend_id in candidates
    ]

    ranked: list[dict[str, Any]] = []
    unrankable: list[dict[str, Any]] = []
    for row in rows:
        if not row["rankable"]:
            unrankable.append(row)
            continue
        scored, reason = _apply_objective(row, objective)
        if not scored:
            row["rankable"] = False
            row["rank"] = None
            row["score"] = None
            row["unrankable_reason"] = reason
            unrankable.append(row)
        else:
            ranked.append(row)

    better_when = (
        "higher" if objective == OBJECTIVE_SUCCESS_PROBABILITY else "lower"
    )
    # Two circuits with identical scores must always come back in the same
    # order, otherwise a page that re-renders on every poll shuffles its
    # recommendation for no reason and stops looking trustworthy. Under the
    # cost objective every free device scores exactly 0.0, so ties are the
    # common case rather than the edge case: break them by projected success
    # probability (descending), then by backend id, which is total.
    ranked.sort(
        key=lambda row: (
            -float(row["score"]) if better_when == "higher" else float(row["score"]),
            -float(row["projection"]["estimated_success_probability"]),
            str(row["backend"]),
        )
    )
    for position, row in enumerate(ranked, start=1):
        row["rank"] = position
    unrankable.sort(key=lambda row: str(row["backend"]))

    return {
        "objective": objective,
        "objective_description": OBJECTIVES[objective],
        "objective_better_when": better_when,
        "shots": shots,
        "optimization_level": optimization_level,
        "disclaimer": _PROJECTION_DISCLAIMER,
        "model": {
            "name": "independent-gate-survival",
            "formula": "P = (1-e1)^n1 * (1-e2)^n2 * exp(-width * duration / T2)",
            "decoherence_included": include_decoherence,
            "ignores": [
                "crosstalk between simultaneous gates",
                "non-uniform error across the device (medians only)",
                "SPAM and readout error entirely — no readout figure is collected",
                "routing/SWAP overhead: transpilation targets the vendor basis, "
                "not the device coupling map, which flatters lattice devices "
                "relative to all-to-all trapped ions",
                "basis-set expressibility: IonQ's and Quantinuum's native gates "
                "cannot be targeted through Qiskit's basis_gates, so those "
                "circuits are counted in universal u/cx gates and their gate "
                "error is under-counted — a bias running opposite to the "
                "routing one, and neither is quantified",
                "drift since the calibration snapshot was taken",
                "the billing contract: an Azure-routed IonQ device is priced at "
                "Amazon Braket's published rate, because both map to the same "
                "vendor family — Azure does not bill on that schedule",
                "per-device gate durations (a per-vendor typical table is used)",
            ],
        },
        "ranked": ranked,
        "unrankable": unrankable,
    }
