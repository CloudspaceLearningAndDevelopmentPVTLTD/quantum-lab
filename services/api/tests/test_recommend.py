"""Offline tests for the cross-vendor device recommendation.

Same discipline as test_calibration.py and test_transpile_sequence.py: no
network, no vendor SDK, no credentials. Live calibration is injected as
hand-built rows in the shape ``list_hardware_devices()`` returns.

The tests here are mostly *honesty* tests rather than *arithmetic* tests. The
ranking itself is a projection and is allowed to be wrong; what is not allowed
is presenting a projection as a measurement, scoring a device we have no
calibration for, or letting a device we cannot price appear at the top of a
per-dollar ranking on a zero that is really "no number".
"""

from __future__ import annotations

import pytest

from app.quantum.calibration import SOURCE_LIVE, SOURCE_STATIC, SOURCE_UNAVAILABLE
from app.quantum.hardware import BACKEND_PROVIDER, BRAKET_DEVICE_ARNS
from app.quantum.recommend import (
    DEFAULT_CANDIDATES,
    OBJECTIVE_COST_PER_SUCCESSFUL_SHOT,
    OBJECTIVE_SUCCESS_PROBABILITY,
    OBJECTIVES,
    project_success_probability,
    recommend_devices,
)

BELL_QASM = """OPENQASM 3.0;
include "stdgates.inc";
qubit[2] q;
bit[2] c;
h q[0];
cx q[0], q[1];
c = measure q;
"""


def _chain_qasm(qubits: int, layers: int) -> str:
    """A ladder of CX layers, to make one circuit strictly deeper than another.

    Args:
        qubits: Circuit width.
        layers: How many times the CX ladder is repeated.

    Returns:
        OpenQASM 3 source.
    """
    body = ["h q[0];"]
    for _ in range(layers):
        for index in range(qubits - 1):
            body.append(f"cx q[{index}], q[{index + 1}];")
    return (
        'OPENQASM 3.0;\ninclude "stdgates.inc";\n'
        f"qubit[{qubits}] q;\nbit[{qubits}] c;\n"
        + "\n".join(body)
        + "\nc = measure q;\n"
    )


def _row(backend_id: str, result: dict) -> dict:
    """Find one backend's row in either list of a recommendation.

    Args:
        backend_id: The backend to look for.
        result: A :func:`recommend_devices` result.

    Returns:
        The matching row.

    Raises:
        AssertionError: When the backend is absent from both lists.
    """
    for row in list(result["ranked"]) + list(result["unrankable"]):
        if row["backend"] == backend_id:
            return row
    raise AssertionError(f"{backend_id} appeared in neither ranked nor unrankable.")


# ---------------------------------------------------------------------------
# Provenance: nothing gets scored on data we do not have
# ---------------------------------------------------------------------------


def test_device_without_calibration_is_unrankable_not_scored() -> None:
    """A device with no calibration must not receive an invented score.

    Catches the failure where an unknown backend falls through to vendor
    'simulator', prices at $0.00 and lands at the top of a per-dollar ranking
    with a success probability conjured from default error rates.
    """
    result = recommend_devices(BELL_QASM, backends=["ibm_not_a_real_device"])

    assert result["ranked"] == []
    row = _row("ibm_not_a_real_device", result)
    assert row["rankable"] is False
    assert row["rank"] is None
    assert row["score"] is None
    assert row["projection"] is None
    assert row["calibration_source"] == SOURCE_UNAVAILABLE
    assert "calibration" in row["unrankable_reason"].lower()


def test_every_row_carries_its_calibration_source() -> None:
    """A row without provenance is a projection masquerading as a fact.

    Catches a future field being added to the row builder without the source
    label, which is the one thing that tells a reader whether they are looking
    at today's calibration or a spec sheet from a press release.
    """
    result = recommend_devices(BELL_QASM)
    rows = list(result["ranked"]) + list(result["unrankable"])

    assert rows, "the default candidate list produced no rows at all"
    for row in rows:
        assert row["calibration_source"] in {SOURCE_LIVE, SOURCE_STATIC, SOURCE_UNAVAILABLE}
        assert isinstance(row["calibration_note"], str)
    for row in result["ranked"]:
        assert row["projection"]["is_projection"] is True
    assert "PROJECTION" in result["disclaimer"]


def test_model_states_what_it_ignores() -> None:
    """The response must name the model's blind spots, not just its answer.

    Catches the ignores list being quietly emptied or the decoherence flag
    drifting out of sync with the argument that controls it.
    """
    result = recommend_devices(BELL_QASM, include_decoherence=False)

    ignored = " ".join(result["model"]["ignores"]).lower()
    assert "crosstalk" in ignored
    assert "readout" in ignored or "spam" in ignored
    assert "coupling map" in ignored or "swap" in ignored
    assert "drift" in ignored
    assert result["model"]["decoherence_included"] is False


def test_azure_targets_are_not_silently_uncalibrated() -> None:
    """Azure rows must find their calibration despite the id spelling split.

    The static table keys the Azure devices by Microsoft's target strings while
    every route here uses our registry ids. Catches the translation being
    dropped, which would make both Azure devices report 'unavailable' and
    vanish from every ranking as though we had no data for them.
    """
    result = recommend_devices(
        BELL_QASM, backends=["azure_quantinuum_h1", "azure_ionq_aria"]
    )

    for backend_id in ("azure_quantinuum_h1", "azure_ionq_aria"):
        assert _row(backend_id, result)["calibration_source"] == SOURCE_STATIC


# ---------------------------------------------------------------------------
# The ranking itself
# ---------------------------------------------------------------------------


def test_deeper_circuit_projects_worse_than_shallower_on_same_device() -> None:
    """More gates must mean a worse projection and a worse per-dollar score.

    Catches the gate counts being read from the *pre*-transpilation circuit, or
    the survival product being computed over a set of gates rather than their
    counts — both of which make circuit size stop mattering, which would make
    the whole recommendation meaningless.
    """
    shallow = recommend_devices(_chain_qasm(3, 1), backends=["ionq_aria"])
    deep = recommend_devices(_chain_qasm(3, 12), backends=["ionq_aria"])

    shallow_row = _row("ionq_aria", shallow)
    deep_row = _row("ionq_aria", deep)

    assert deep_row["inputs"]["two_qubit_gates"] > shallow_row["inputs"]["two_qubit_gates"]
    assert (
        deep_row["projection"]["estimated_success_probability"]
        < shallow_row["projection"]["estimated_success_probability"]
    )
    # Same device, same shots, so the price is identical and the only thing
    # moving cost-per-surviving-shot is the projection.
    assert deep_row["cost"]["estimated_total"] == shallow_row["cost"]["estimated_total"]
    assert deep_row["score"] > shallow_row["score"]

    # The monotonicity above holds for the SOURCE gate counts too, so on its
    # own it does not prove the counts came from the transpiled circuit. Pin
    # that directly: a Bell pair carries one h in the source, and IBM's basis
    # has no h, so the transpiled count is three rz/sx rotations. Reading
    # gate_counts_before here would report 1.
    ibm = _row("ibm_brisbane", recommend_devices(BELL_QASM, backends=["ibm_brisbane"]))
    assert ibm["inputs"]["one_qubit_gates"] == 3, (
        "one_qubit_gates looks like the pre-transpilation count, or IBM's "
        "basis decomposition of h has changed"
    )


def test_ordering_is_stable_across_identical_calls() -> None:
    """The same question must always come back in the same order.

    Under the per-dollar objective every free device scores exactly 0.0, so
    ties are the normal case. Catches a sort that leaves tied rows in whatever
    order the dict iteration happened to produce, which makes a polling UI
    reshuffle its top recommendation every few seconds.
    """
    first = recommend_devices(BELL_QASM)
    second = recommend_devices(BELL_QASM)

    assert [row["backend"] for row in first["ranked"]] == [
        row["backend"] for row in second["ranked"]
    ]
    assert [row["backend"] for row in first["unrankable"]] == [
        row["backend"] for row in second["unrankable"]
    ]
    assert [row["rank"] for row in first["ranked"]] == list(
        range(1, len(first["ranked"]) + 1)
    )
    # Reversing the candidate order must not reverse the result.
    reversed_call = recommend_devices(BELL_QASM, backends=list(reversed(DEFAULT_CANDIDATES)))
    assert [row["backend"] for row in reversed_call["ranked"]] == [
        row["backend"] for row in first["ranked"]
    ]


def test_ranking_is_ordered_by_the_reported_objective() -> None:
    """The scores must actually be sorted the way the response claims.

    Catches 'better_when' saying lower while the sort key maximises, which
    would present the worst device first under a label saying it is the best.
    """
    cheap = recommend_devices(BELL_QASM)
    assert cheap["objective_better_when"] == "lower"
    scores = [row["score"] for row in cheap["ranked"]]
    assert scores == sorted(scores)

    best = recommend_devices(BELL_QASM, objective=OBJECTIVE_SUCCESS_PROBABILITY)
    assert best["objective_better_when"] == "higher"
    fidelities = [row["score"] for row in best["ranked"]]
    assert fidelities == sorted(fidelities, reverse=True)


def test_objective_is_named_and_described_in_the_output() -> None:
    """A ranking with an unstated objective is not interpretable.

    Catches the objective being applied but not echoed, which would leave a
    reader unable to tell whether 'best' meant cheapest or most accurate.
    """
    result = recommend_devices(BELL_QASM, objective=OBJECTIVE_SUCCESS_PROBABILITY)

    assert result["objective"] == OBJECTIVE_SUCCESS_PROBABILITY
    assert result["objective_description"] == OBJECTIVES[OBJECTIVE_SUCCESS_PROBABILITY]
    assert result["shots"] == 1024

    with pytest.raises(ValueError, match="Unknown objective"):
        recommend_devices(BELL_QASM, objective="cheapest_vibes")


def test_circuit_wider_than_the_device_is_unrankable() -> None:
    """A 30-qubit circuit must not be 'recommended' onto a 25-qubit trap.

    Catches the width check being skipped, which would rank a device that
    physically cannot accept the submission — and, because a narrower device
    has fewer error sources in no way relevant here, would often rank it first.
    """
    result = recommend_devices(_chain_qasm(30, 1), backends=["ionq_aria"])

    row = _row("ionq_aria", result)
    assert row["rankable"] is False
    assert "25" in row["unrankable_reason"] and "30" in row["unrankable_reason"]


# ---------------------------------------------------------------------------
# Pricing honesty
# ---------------------------------------------------------------------------


def test_quantinuum_does_not_score_as_free() -> None:
    """A vendor we cannot price must never win a per-dollar ranking on a zero.

    transpile.estimate_cost reports total 0.0 with is_free False for
    Quantinuum, because it bills in H-System Credits. Catches this module
    reading the total and ignoring the flag, which would put Quantinuum joint
    first at $0.00 per surviving shot and send somebody to a paid QPU believing
    it costs nothing.
    """
    result = recommend_devices(BELL_QASM, backends=["azure_quantinuum_h1", "ibm_brisbane"])

    row = _row("azure_quantinuum_h1", result)
    assert row["rankable"] is False
    assert row["rank"] is None
    assert row["score"] is None
    assert row["cost"]["priced"] is False
    assert row["cost"]["is_free"] is False
    assert row["cost"]["cost_per_successful_shot"] is None
    assert "not free" in row["unrankable_reason"].lower()
    assert "azure_quantinuum_h1" not in [r["backend"] for r in result["ranked"]]

    # It is unrankable by *price*, not unknown: the projection and its
    # provenance are still reported, and the fidelity objective ranks it.
    assert row["projection"]["estimated_success_probability"] > 0.0
    assert row["calibration_source"] == SOURCE_STATIC
    by_fidelity = recommend_devices(
        BELL_QASM,
        backends=["azure_quantinuum_h1", "ibm_brisbane"],
        objective=OBJECTIVE_SUCCESS_PROBABILITY,
    )
    assert "azure_quantinuum_h1" in [r["backend"] for r in by_fidelity["ranked"]]


def test_free_devices_score_zero_and_tie_break_on_fidelity() -> None:
    """Free devices tie at 0.00/shot, so the tie-break must be the projection.

    Catches free devices being ordered arbitrarily among themselves, which
    would recommend the worst-calibrated IBM machine as often as the best.
    """
    result = recommend_devices(
        BELL_QASM, backends=["ibm_brisbane", "ibm_kyiv", "ibm_sherbrooke"]
    )

    assert all(row["score"] == 0.0 for row in result["ranked"])
    probabilities = [
        row["projection"]["estimated_success_probability"] for row in result["ranked"]
    ]
    assert probabilities == sorted(probabilities, reverse=True)


def test_costed_rows_price_the_requested_shot_count() -> None:
    """Cost per surviving shot must scale with the price, not with the shots.

    Catches the per-task fee being multiplied by shots, or the shot count being
    dropped from the denominator — either of which would make a 10x larger job
    look 10x cheaper or 10x more expensive per usable shot.
    """
    small = _row("ionq_aria", recommend_devices(BELL_QASM, shots=100))
    large = _row("ionq_aria", recommend_devices(BELL_QASM, shots=10_000))

    assert large["cost"]["estimated_total"] > small["cost"]["estimated_total"]
    # The $0.30 task fee is amortised over more shots, so the larger job is
    # cheaper per surviving shot even though it costs more in total.
    assert large["score"] < small["score"]

    with pytest.raises(ValueError, match="shots must be a positive integer"):
        recommend_devices(BELL_QASM, shots=0)


# ---------------------------------------------------------------------------
# Live calibration takes precedence, and says so
# ---------------------------------------------------------------------------


def test_live_calibration_overrides_the_static_table() -> None:
    """Supplied live figures must drive the projection and relabel the row.

    Catches the device rows being accepted and then ignored, which would show
    'live' provenance next to numbers computed from the spec sheet — exactly
    the projection-as-measurement failure this module exists to avoid.
    """
    live_rows = [
        {
            "id": "ibm_brisbane",
            "calibration": {
                "source": SOURCE_LIVE,
                "qubits": 127,
                "median_1q_error": 5.0e-2,  # deliberately terrible
                "median_2q_error": 1.0e-1,
                "median_t1_us": 220.0,
                "median_t2_us": 140.0,
                "queue_depth": 37,
                "note": "Read from the device's reported calibration at listing time.",
            },
        }
    ]

    live = _row("ibm_brisbane", recommend_devices(BELL_QASM, devices=live_rows))
    static = _row("ibm_brisbane", recommend_devices(BELL_QASM))

    assert live["calibration_source"] == SOURCE_LIVE
    assert live["queue_depth"] == 37
    assert live["inputs"]["median_2q_error"] == 1.0e-1
    assert (
        live["projection"]["estimated_success_probability"]
        < static["projection"]["estimated_success_probability"]
    )


def test_live_braket_rows_are_matched_by_arn_not_only_by_registry_id() -> None:
    """Live Braket calibration must not be dropped because the row is ARN-keyed.

    hardware._live_braket_devices() publishes row['id'] = the device ARN, while
    catalogue rows, live IBM rows and the Azure rows all use our registry id.
    Catches the row matcher comparing the registry id alone, which silently
    discards live calibration and live queue depth for ionq_aria, ionq_forte
    and rigetti_ankaa — and does so ONLY when AWS credentials exist, i.e. only
    when there is live data to lose, so every offline test stays green.
    """
    live_rows = [
        {
            "id": BRAKET_DEVICE_ARNS["ionq_aria"],
            "name": "Aria 1",
            "calibration": {
                "source": SOURCE_LIVE,
                "qubits": 25,
                "median_1q_error": 2.0e-2,  # deliberately far from the spec sheet
                "median_2q_error": 4.0e-2,
                "median_t1_us": 1.0e8,
                "median_t2_us": 1.0e6,
                "queue_depth": 11,
                "note": "Read from the device's reported properties at listing time.",
            },
        }
    ]

    row = _row("ionq_aria", recommend_devices(BELL_QASM, devices=live_rows))

    assert row["calibration_source"] == SOURCE_LIVE
    assert row["queue_depth"] == 11
    assert row["inputs"]["median_2q_error"] == 4.0e-2


def test_unavailable_live_row_falls_back_to_the_static_table() -> None:
    """A provider that answered with nothing must not erase what we do know.

    Catches a caller-supplied 'unavailable' summary being taken at face value,
    which would drop a well-known device out of the ranking whenever the vendor
    SDK had a bad minute.
    """
    rows = [
        {
            "id": "ibm_brisbane",
            "calibration": {"source": SOURCE_UNAVAILABLE, "note": "", "queue_depth": None},
        }
    ]

    row = _row("ibm_brisbane", recommend_devices(BELL_QASM, devices=rows))
    assert row["calibration_source"] == SOURCE_STATIC
    assert row["rankable"] is True


# ---------------------------------------------------------------------------
# The projection function on its own
# ---------------------------------------------------------------------------


def test_missing_error_figure_yields_no_probability_rather_than_a_default() -> None:
    """An absent 2Q error must produce None, not a silent survival of 1.0.

    Catches ``(1 - (error or 0)) ** n`` style defaulting, which reports a
    perfect two-qubit gate whenever the calibration is incomplete — the most
    flattering possible answer at exactly the moment we know least.
    """
    result = project_success_probability(
        one_qubit_gates=4,
        two_qubit_gates=3,
        median_1q_error=1e-4,
        median_2q_error=None,
        width=2,
    )

    assert result["estimated_success_probability"] is None
    assert result["missing"] == ["median_2q_error"]

    # With no two-qubit gates in the circuit, the same missing figure is not
    # needed and must not block the projection.
    ok = project_success_probability(
        one_qubit_gates=4,
        two_qubit_gates=0,
        median_1q_error=1e-4,
        median_2q_error=None,
        width=1,
    )
    assert ok["estimated_success_probability"] == pytest.approx((1 - 1e-4) ** 4)


def test_decoherence_term_is_separable_and_only_ever_lowers_the_projection() -> None:
    """The coherence factor must be reported apart from the gate term.

    Catches the two being multiplied together before reporting, which would
    leave a reader unable to see that a short, clean circuit on Rigetti is
    limited by its 14us T2 rather than by its gate errors.
    """
    gates_only = project_success_probability(
        one_qubit_gates=10,
        two_qubit_gates=5,
        median_1q_error=1.5e-3,
        median_2q_error=1.5e-2,
        width=2,
    )
    with_idle = project_success_probability(
        one_qubit_gates=10,
        two_qubit_gates=5,
        median_1q_error=1.5e-3,
        median_2q_error=1.5e-2,
        width=2,
        duration_us=20.0,
        coherence_us=14.0,
    )

    assert gates_only["coherence_survival"] is None
    assert 0.0 < with_idle["coherence_survival"] < 1.0
    assert with_idle["gate_survival"] == pytest.approx(gates_only["gate_survival"])
    assert (
        with_idle["estimated_success_probability"]
        < gates_only["estimated_success_probability"]
    )


def test_out_of_range_error_probability_is_rejected() -> None:
    """A fidelity mistakenly passed where an error was expected must not pass.

    Catches a vendor schema change that starts reporting fidelity (0.99) in the
    error field: ``(1 - 0.99) ** n`` would silently project catastrophe, and
    ``(1 - 1.5) ** n`` would oscillate in sign. Both are worse than an error.
    """
    with pytest.raises(ValueError, match="median_2q_error"):
        project_success_probability(
            one_qubit_gates=1,
            two_qubit_gates=1,
            median_1q_error=1e-4,
            median_2q_error=1.5,
            width=2,
        )


# ---------------------------------------------------------------------------
# Candidate list
# ---------------------------------------------------------------------------


def test_default_candidates_track_the_hardware_dispatch_table() -> None:
    """A newly wired device must appear in recommendations automatically.

    Catches a second, hand-maintained device list drifting away from
    hardware.BACKEND_PROVIDER, which is how a device ends up submittable but
    invisible to the recommendation that is supposed to cover 'every device we
    reach'.
    """
    expected = set(BACKEND_PROVIDER) - {"ibm_quantum"}
    assert set(DEFAULT_CANDIDATES) == expected

    result = recommend_devices(BELL_QASM)
    covered = {row["backend"] for row in result["ranked"]} | {
        row["backend"] for row in result["unrankable"]
    }
    assert covered == expected


def test_empty_candidate_list_is_rejected() -> None:
    """An empty ranking is a bug report, not an answer.

    Catches ``backends=[]`` quietly returning an empty ranking that a caller
    would render as 'no device is suitable for your circuit'.
    """
    with pytest.raises(ValueError, match="at least one device"):
        recommend_devices(BELL_QASM, backends=[])


def test_repeated_backend_is_counted_once() -> None:
    """One device named twice must occupy one rank, not two.

    Catches the candidate list being iterated without de-duplication, which
    puts the same machine at rank 1 and rank 2 with identical numbers — read
    by a user as two independent devices agreeing rather than one counted
    twice.
    """
    result = recommend_devices(BELL_QASM, backends=["ibm_brisbane", "ibm_brisbane"])

    assert [row["backend"] for row in result["ranked"]] == ["ibm_brisbane"]
    assert [row["rank"] for row in result["ranked"]] == [1]


# ---------------------------------------------------------------------------
# Caller mistakes must not be reported as device limitations
# ---------------------------------------------------------------------------


def test_unparseable_circuit_raises_rather_than_blaming_every_device() -> None:
    """A QASM typo is the user's, not ibm_brisbane's.

    Catches the per-device ``except ValueError`` around transpile_for
    swallowing a parse failure: every candidate then comes back unrankable with
    'the circuit could not be transpiled for this device' and an empty ranking,
    which a UI renders as 'no device we reach can run your circuit' — eight
    accusations against the hardware for one missing semicolon. It also means
    the same broken source is parsed once per candidate.
    """
    with pytest.raises(ValueError, match="[Cc]ould not parse"):
        recommend_devices("h q[0];")

    with pytest.raises(ValueError, match="empty"):
        recommend_devices("   ")


def test_out_of_range_optimization_level_raises() -> None:
    """An illegal optimisation level must fail loudly, not empty the ranking.

    Catches transpile_for's own ValueError being caught per device and
    rewritten as 'the circuit could not be transpiled for this device', which
    turns a caller's out-of-range argument into eight unrankable machines.
    """
    with pytest.raises(ValueError, match="optimization_level must be 0, 1, 2 or 3"):
        recommend_devices(BELL_QASM, optimization_level=9)


def test_negative_width_or_duration_is_rejected_by_the_projection() -> None:
    """A negative exposure must not return a 'probability' above 1.

    exp(-w*t/T) with a negative w or t is exp(+x): the function would hand back
    7e86 from a signature that promises a probability, and the cost objective
    would divide by it and rank that device first at essentially $0 per
    surviving shot. Catches the validation covering only the gate counts.
    """
    for bad in ({"width": -2}, {"duration_us": -1.0}, {"coherence_us": -1.0}):
        kwargs = {
            "one_qubit_gates": 1,
            "two_qubit_gates": 0,
            "median_1q_error": 1e-4,
            "median_2q_error": 1e-3,
            "width": 2,
            "duration_us": 10.0,
            "coherence_us": 100.0,
        }
        kwargs.update(bad)
        with pytest.raises(ValueError, match="non-negative"):
            project_success_probability(**kwargs)  # type: ignore[arg-type]


def test_model_declares_the_basis_expressibility_bias() -> None:
    """The gate counts compared across vendors are not in comparable gate sets.

    IonQ's gpi/gpi2/ms and Quantinuum's native set cannot be reached through
    Qiskit's basis_gates, so both are transpiled to universal u/cx: a Bell pair
    counts 3 one-qubit gates on IBM, 9 on Rigetti and 1 on IonQ. Catches this
    bias being left undeclared while the routing bias — which runs the other
    way — is the only one the response admits to.
    """
    result = recommend_devices(BELL_QASM)
    ignored = " ".join(result["model"]["ignores"]).lower()
    assert "basis" in ignored and "expressib" in ignored

    ibm = _row("ibm_brisbane", result)["inputs"]["one_qubit_gates"]
    ionq = _row("ionq_aria", result)["inputs"]["one_qubit_gates"]
    assert ibm > ionq, (
        "the asymmetry the docstring describes has changed; re-check the "
        "declared bias before trusting a cross-vendor gate-count comparison"
    )
