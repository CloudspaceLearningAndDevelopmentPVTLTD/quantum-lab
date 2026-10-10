"""Offline tests for fault-tolerant resource estimation.

Nothing here can be validated against a machine, because the machine does not
exist. So the tests pin two different things, and the second kind is why the
file is worth reading.

The first kind pins the MODEL'S MONOTONICITY: distance must grow when the
target tightens, grow when the physical error rate worsens, and the footprint
must grow as d squared. Those are the properties a reader will assume without
checking, and an inverted comparison or a stray ``floor`` would break them
while still returning a plausible-looking integer.

The second kind pins the HONESTY OF THE PAYLOAD. This module's output is a
projection dressed as a number, and the whole reason it is shippable is that
it says so in its own return value. A refactor that drops ``caveats``, or that
returns a distance of 4000 instead of refusing an above-threshold device,
would turn an honest estimate into a confident lie and no arithmetic test would
notice. Those tests are here for that.
"""

from __future__ import annotations

import math

import pytest

from app.quantum.resources import (
    DECODER_LAB_PHENOMENOLOGICAL_THRESHOLD,
    DECODER_LAB_THRESHOLD_AS_DEPOLARISING_P,
    DISTANCE_ACCEPTANCE_TOLERANCE,
    FACTORY_TILES_PER_UNIT,
    MAX_AUTO_FACTORIES,
    MAX_DISTANCE,
    QUBITS_PER_TILE_COEFFICIENT,
    SURFACE_CODE_THRESHOLD,
    ResourceEstimateError,
    distillation_levels,
    estimate_resources,
    logical_counts_from_qasm,
    logical_error_per_cycle,
    required_distance,
)


# ── logical_error_per_cycle ─────────────────────────────────────────────────


def test_logical_error_falls_exponentially_with_distance_below_threshold() -> None:
    """Catches a sign or exponent slip that would make a bigger code worse.

    p_L = A (p/p_th)^((d+1)/2) with p < p_th must FALL with d. If the exponent
    were written (d-1)/2, or the ratio inverted, every downstream qubit count
    would be wrong in the flattering direction and still look reasonable.
    """
    errors = [logical_error_per_cycle(d, 1e-3) for d in (3, 5, 7, 9, 11)]

    assert errors == sorted(errors, reverse=True)
    # Each two steps of d should cost one more factor of (p/p_th) = 0.1.
    for lower, higher in zip(errors, errors[1:]):
        assert higher == pytest.approx(lower * 0.1, rel=1e-9)

    # ANCHOR THE ABSOLUTE VALUE, not just the shape. The two checks above are
    # satisfied identically by the WRONG exponent (d-1)/2: it is also monotone
    # and also steps by one factor of 0.1 per two steps of d, so a suite that
    # only tests shape lets the off-by-one through while every qubit count comes
    # out a full code-distance rung too small. At d = 3 the exponent is
    # (3+1)/2 = 2, so p_L = 0.1 * (0.1)^2 = 1e-3; the (d-1)/2 version gives 1e-2.
    assert logical_error_per_cycle(3, 1e-3) == pytest.approx(1e-3, rel=1e-12)
    assert logical_error_per_cycle(5, 1e-3) == pytest.approx(1e-4, rel=1e-12)
    assert logical_error_per_cycle(7, 1e-4) == pytest.approx(0.1 * 1e-2**4, rel=1e-12)


def test_at_threshold_the_code_stops_helping() -> None:
    """At p = p_th the ratio is 1, so every distance gives the same error.

    Pinned because it is the exact reason ``required_distance`` refuses that
    regime rather than searching: the search would never terminate on merit.
    """
    at_threshold = [
        logical_error_per_cycle(d, SURFACE_CODE_THRESHOLD) for d in (3, 11, 51)
    ]

    assert at_threshold == pytest.approx([0.1, 0.1, 0.1])


def test_an_even_distance_is_refused() -> None:
    """(d+1)/2 only equals the true floor for odd d, and even d buys nothing.

    Accepting d = 4 would silently evaluate the formula at exponent 2.5, which
    is not a number of errors and not a code anybody builds.
    """
    with pytest.raises(ResourceEstimateError, match="odd integer"):
        logical_error_per_cycle(4, 1e-3)


# ── required_distance ───────────────────────────────────────────────────────


def test_distance_grows_as_the_target_logical_error_tightens() -> None:
    """The headline monotonicity: a stricter budget must buy a bigger code."""
    distances = [
        required_distance(target_logical_error=target, physical_error_rate=1e-3)
        for target in (1e-6, 1e-9, 1e-12, 1e-15)
    ]

    assert distances == sorted(distances)
    assert distances[0] < distances[-1]
    assert all(d % 2 == 1 for d in distances)

    # Hand-computed anchor, so the whole chain is pinned to an arithmetic fact
    # and not merely to its own internal consistency: at p/p_th = 0.1 a target
    # of 1e-12 needs 0.1 * 0.1^k <= 1e-12, i.e. k = (d+1)/2 >= 11, i.e. d = 21.
    # Every "does it meet its own target" test below is satisfied by a wrong
    # exponent too, because the solver and the model share it.
    assert required_distance(target_logical_error=1e-12, physical_error_rate=1e-3) == 21
    assert required_distance(target_logical_error=1e-3, physical_error_rate=1e-3) == 3


def test_distance_grows_as_the_physical_error_rate_approaches_threshold() -> None:
    """A worse device must need a bigger code for the same target.

    Catches the ratio being used the wrong way round, which would produce the
    comforting and wrong answer that noisier hardware needs less correction.
    """
    distances = [
        required_distance(target_logical_error=1e-12, physical_error_rate=p)
        for p in (1e-4, 5e-4, 1e-3, 3e-3, 5e-3)
    ]

    assert distances == sorted(distances)
    assert distances[0] < distances[-1]


def test_the_returned_distance_actually_meets_the_target_and_is_minimal() -> None:
    """The analytic seed is rounded, and this pins BOTH directions of that.

    ``(d+1)/2`` steps by one, so a seed landing one rung low returns a distance
    whose logical error is ten times the requested one. A seed landing one rung
    HIGH is the failure that actually shipped: ``log(1e-11)/log(0.1)`` evaluates
    to 11.000000000000002, ``ceil`` takes it to 12, and the walk — which only
    moves up — could never come back down, so d = 23 was returned where 21 is
    correct. Neither direction raises; both return a plausible odd integer.
    """
    for target in (1e-5, 1e-8, 1e-11, 3.3e-13, 1e-14):
        d = required_distance(target_logical_error=target, physical_error_rate=1e-3)

        # The tolerance is the module's own DISTANCE_ACCEPTANCE_TOLERANCE, and it
        # is load-bearing rather than sloppy: on a round target at the round
        # ratio p/p_th = 0.1, p_L(d) is a few ulps ABOVE a target it exactly
        # equals in real arithmetic (0.1 * 0.1**2 == 1.0000000000000002e-3). A
        # bare `<=` here demands the module walk past the correct distance to
        # the next rung, which is a 20% qubit over-count for nothing.
        assert logical_error_per_cycle(d, 1e-3) <= target * (
            1 + DISTANCE_ACCEPTANCE_TOLERANCE
        )
        # And it is the SMALLEST such odd distance: the next rung down must be
        # rejected BY THE MODULE'S OWN acceptance criterion, tolerance included.
        # Asserting a bare `> target` would let a one-rung overshoot pass
        # whenever the shortfall was only ulps wide — which is exactly the case
        # that produced the overshoot in the first place.
        if d > 3:
            assert logical_error_per_cycle(d - 2, 1e-3) > target * (
                1 + DISTANCE_ACCEPTANCE_TOLERANCE
            )


def test_a_physical_error_rate_at_threshold_is_refused_not_answered() -> None:
    """The single most important refusal in the module.

    Above threshold a larger code AMPLIFIES errors. A solver that kept
    searching would eventually hit the distance cap and could be "fixed" by
    raising the cap, producing a serene answer of d = 4001 for a device that
    cannot be error-corrected at all. That is the failure this refuses.
    """
    with pytest.raises(ResourceEstimateError, match="at or above the surface-code threshold"):
        required_distance(
            target_logical_error=1e-12, physical_error_rate=SURFACE_CODE_THRESHOLD
        )


def test_a_physical_error_rate_above_threshold_is_refused_too() -> None:
    """Same refusal, strictly above, including the decoder lab's 2.9%.

    2.9% is a real threshold — of the phenomenological model the decoder lab
    simulates — and someone will pass it here. It is above the circuit-level
    threshold this module uses, so it must be refused with an explanation
    rather than quietly answered.
    """
    with pytest.raises(ResourceEstimateError, match="Improve the physical error rate"):
        required_distance(
            target_logical_error=1e-12,
            physical_error_rate=DECODER_LAB_PHENOMENOLOGICAL_THRESHOLD,
        )


def test_an_unreachable_target_is_refused_rather_than_capped() -> None:
    """Near threshold the required distance explodes; say so, do not clamp.

    Returning MAX_DISTANCE silently would report a 101-distance machine that
    misses the target by many orders of magnitude.
    """
    with pytest.raises(ResourceEstimateError, match=f"at or below {MAX_DISTANCE}"):
        required_distance(target_logical_error=1e-18, physical_error_rate=9e-3)


# ── distillation_levels ─────────────────────────────────────────────────────


def test_distillation_levels_grow_as_the_state_target_tightens() -> None:
    """More T gates means a tighter per-state budget means more levels."""
    levels = [
        distillation_levels(target_state_error=t, physical_error_rate=1e-3)[0]
        for t in (1e-3, 1e-8, 1e-20)
    ]

    assert levels == sorted(levels)
    assert levels[0] == 0  # the raw state already meets a 1e-3 target
    assert levels[-1] > levels[0]


def test_one_distillation_round_is_priced_at_35_p_cubed() -> None:
    """Anchors the protocol's actual arithmetic, not merely its direction.

    The monotonicity test above passes just as happily against ``35 p^2`` or
    ``p^3`` — any decreasing map gives more levels for a tighter target. The
    15-to-1 block code is specifically ``35 p^3``: it fails only when three or
    more of fifteen inputs are faulty, and there are 35 such weight-3 patterns.
    Get the exponent wrong and every level count, factory tree and footprint in
    the module is wrong with it, silently.
    """
    levels, achieved = distillation_levels(
        target_state_error=1e-7, physical_error_rate=1e-3
    )

    assert levels == 1
    assert achieved == pytest.approx(35 * 1e-3**3)  # 3.5e-8, not 3.5e-5

    # Two rounds compose: 35 * (35 p^3)^3.
    two_levels, achieved_two = distillation_levels(
        target_state_error=1e-20, physical_error_rate=1e-3
    )

    assert two_levels == 2
    assert achieved_two == pytest.approx(35 * (35 * 1e-3**3) ** 3)


def test_distillation_that_cannot_converge_is_refused() -> None:
    """35 p^3 > p when p > ~0.17, so distillation makes states WORSE there.

    Iterating anyway would loop to the level cap and report a number. The
    refusal names the convergence condition so the caller learns why.
    """
    with pytest.raises(ResourceEstimateError, match="out of reach"):
        distillation_levels(target_state_error=1e-10, physical_error_rate=0.3)


# ── estimate_resources: footprint scaling ───────────────────────────────────


def test_physical_qubits_per_logical_is_two_d_squared() -> None:
    """The rotated-surface-code tile. Catches a d-squared becoming a 2d."""
    for p in (1e-4, 1e-3, 5e-3):
        estimate = estimate_resources(
            algorithm_qubits=100, t_count=0, logical_depth=1000, physical_error_rate=p
        )
        d = estimate["code_distance"]

        assert estimate["physical_qubits_per_logical"] == (
            QUBITS_PER_TILE_COEFFICIENT * d * d
        )


def test_total_physical_qubits_scale_as_d_squared_across_devices() -> None:
    """A worse device raises d, and the footprint must follow d^2, not d.

    Compares two runs with identical algorithms on different hardware: the
    ratio of qubit counts must track the ratio of d^2 once the (identical)
    tile count is divided out.
    """
    good = estimate_resources(
        algorithm_qubits=50, t_count=0, logical_depth=10_000, physical_error_rate=1e-4
    )
    bad = estimate_resources(
        algorithm_qubits=50, t_count=0, logical_depth=10_000, physical_error_rate=3e-3
    )

    assert bad["code_distance"] > good["code_distance"]
    assert bad["tiles"]["total"] == good["tiles"]["total"]  # same algorithm
    ratio = bad["physical_qubits"] / good["physical_qubits"]
    expected = (bad["code_distance"] / good["code_distance"]) ** 2

    assert ratio == pytest.approx(expected, rel=1e-9)


def test_the_footprint_is_tiles_times_the_tile_size() -> None:
    """Data + routing + factories, all charged at 2d^2. No tile goes unpriced."""
    estimate = estimate_resources(
        algorithm_qubits=200, t_count=1_000_000, logical_depth=1_000_000
    )
    tiles = estimate["tiles"]

    assert tiles["total"] == tiles["data"] + tiles["routing"] + tiles["factories"]
    assert estimate["physical_qubits"] == (
        tiles["total"] * estimate["physical_qubits_per_logical"]
    )
    assert tiles["factories"] > 0  # a million T gates must cost a factory


def test_a_tighter_total_budget_costs_more_qubits() -> None:
    """End-to-end monotonicity through the fixed-point distance solve.

    The solve is circular (cycles depend on d, d depends on cycles); a bug
    there could easily make the answer non-monotone in the budget without
    breaking any single-step test.
    """
    loose = estimate_resources(
        algorithm_qubits=100, t_count=0, logical_depth=100_000, target_total_error=1e-1
    )
    tight = estimate_resources(
        algorithm_qubits=100, t_count=0, logical_depth=100_000, target_total_error=1e-6
    )

    assert tight["code_distance"] >= loose["code_distance"]
    assert tight["physical_qubits"] > loose["physical_qubits"]


def test_the_solved_distance_actually_meets_the_allocated_budget() -> None:
    """The fixed point must be consistent, not merely terminate.

    Catches an iteration that returns the distance from before the last
    update, or a cycle count computed at a different d than the one returned —
    both of which under-count the total logical error while looking fine.
    """
    estimate = estimate_resources(
        algorithm_qubits=1000, t_count=0, logical_depth=1_000_000, physical_error_rate=1e-3
    )
    budget = estimate["budget"]

    assert budget["qec_achieved"] <= budget["qec_allocated"]
    assert estimate["algorithm_code_cycles"] == 1_000_000 * estimate["code_distance"]


# ── estimate_resources: runtime ─────────────────────────────────────────────


def test_runtime_is_cycles_times_the_cycle_time() -> None:
    """Catches a unit slip, the classic being microseconds read as seconds."""
    estimate = estimate_resources(
        algorithm_qubits=10, t_count=0, logical_depth=1000, code_cycle_seconds=1e-6
    )

    assert estimate["runtime_seconds"] == pytest.approx(
        estimate["code_cycles"] * 1e-6
    )


def test_a_trapped_ion_cycle_time_lengthens_the_runtime_proportionally() -> None:
    """The default cycle time is superconducting; ions are ~1000x slower.

    A caller who leaves the default on an ion machine gets an answer wrong by
    three orders of magnitude, so the parameter has to actually be honoured.
    """
    fast = estimate_resources(
        algorithm_qubits=10, t_count=0, logical_depth=1000, code_cycle_seconds=1e-6
    )
    slow = estimate_resources(
        algorithm_qubits=10, t_count=0, logical_depth=1000, code_cycle_seconds=1e-3
    )

    assert slow["code_cycles"] == fast["code_cycles"]
    assert slow["runtime_seconds"] == pytest.approx(fast["runtime_seconds"] * 1000)


def test_a_t_heavy_shallow_circuit_reports_a_distillation_bottleneck() -> None:
    """Auto-balancing is capped, and past the cap the truth must be visible.

    The failure this prevents: hiding a distillation-limited runtime by
    building an unbounded number of factories, so the payload shows a fast
    machine with an implausible qubit count and never says why.
    """
    estimate = estimate_resources(
        algorithm_qubits=20, t_count=10**9, logical_depth=100
    )

    assert estimate["magic_states"]["factories"] == MAX_AUTO_FACTORIES
    assert estimate["bottleneck"] == "distillation"
    assert estimate["distillation_code_cycles"] > estimate["algorithm_code_cycles"]
    assert estimate["code_cycles"] == estimate["distillation_code_cycles"]
    # And the REPORTED RUNTIME must be the stalled one. Without this the module
    # can show a distillation bottleneck in one field and quote the algorithm's
    # own (thousands of times shorter) runtime in the next, which is the
    # flattering number and the one a reader would repeat.
    assert estimate["runtime_seconds"] == pytest.approx(
        estimate["code_cycles"] * 1e-6
    )
    assert estimate["runtime_seconds"] > estimate["algorithm_code_cycles"] * 1e-6


def test_the_qec_budget_is_charged_over_the_distillation_stall_too() -> None:
    """The bug this file was written without: idle logical qubits still fail.

    On a distillation-bound circuit the algorithm finishes in a few thousand
    cycles and then the machine sits for BILLIONS more waiting on magic states.
    The logical qubits are live the whole time. An earlier version solved the
    code distance against the algorithm's cycles alone and reported
    ``qec_achieved`` over those cycles alone, so this exact input came back with
    d = 11, a serene "qec_achieved 0.0022 <= allocated 0.005", and a true
    logical error over the real runtime of 8250 — certain failure, 1.6 million
    times over budget, with a payload that said the budget was met.

    The assertion is not "d is 25"; it is that the reported achievement is
    computed over the SAME cycle count the runtime is, and that it fits.
    """
    estimate = estimate_resources(
        algorithm_qubits=20, t_count=10**9, logical_depth=100, physical_error_rate=1e-3
    )
    budget = estimate["budget"]

    assert estimate["bottleneck"] == "distillation"
    assert estimate["code_cycles"] > estimate["algorithm_code_cycles"]

    # The achieved figure must be the honest one: qubits x TOTAL cycles x p_L.
    per_cycle = logical_error_per_cycle(estimate["code_distance"], 1e-3)
    assert budget["qec_achieved"] == pytest.approx(20 * estimate["code_cycles"] * per_cycle)
    # ...and that honest figure must actually fit the allocation.
    assert budget["qec_achieved"] <= budget["qec_allocated"]
    assert budget["total_achieved"] <= budget["total_target"]


def test_every_estimate_keeps_its_own_total_error_promise() -> None:
    """Swept guard on the invariant, because one worked example is one example.

    Across bottleneck regimes, budget sizes and devices, the topological error
    RECOMPUTED FROM FIRST PRINCIPLES — logical qubits x the runtime's own cycle
    count x the per-cycle logical error at the returned distance — must fit the
    allocation. Recomputing rather than reading ``qec_achieved`` back is the
    point: a model that under-charges the stall reports a self-consistent
    payload, so checking the payload against itself passes happily while the
    real machine fails. This check has no such blind spot.
    """
    for qubits, t_count, depth in (
        (20, 10**9, 100),  # distillation-bound
        (6200, 2 * 10**9, 3 * 10**9),  # balanced
        (50, 0, 10**6),  # topological only
        (5, 10**6, 10),  # tiny and very T-heavy
        (1000, 10**3, 10**8),  # deep, T-light
    ):
        for target in (1e-1, 1e-2, 1e-4):
            for p in (1e-4, 1e-3, 5e-3):
                try:
                    estimate = estimate_resources(
                        algorithm_qubits=qubits,
                        t_count=t_count,
                        logical_depth=depth,
                        physical_error_rate=p,
                        target_total_error=target,
                    )
                except ResourceEstimateError:
                    # A refusal is a correct outcome here: near threshold with a
                    # tight budget no distance under MAX_DISTANCE reaches the
                    # target. The invariant is about estimates that ARE returned.
                    continue
                budget = estimate["budget"]
                where = (qubits, t_count, depth, target, p)

                # Recomputed, not read back. `code_cycles` is the runtime's own
                # cycle count, so this is the error the machine actually suffers.
                truth = (
                    qubits
                    * estimate["code_cycles"]
                    * logical_error_per_cycle(estimate["code_distance"], p)
                )

                assert truth <= budget["qec_allocated"], (where, truth)
                assert budget["qec_achieved"] == pytest.approx(truth), where
                assert budget["total_achieved"] <= budget["total_target"], where


def test_the_runtime_is_rendered_in_a_unit_a_human_can_judge() -> None:
    """'3.2e+11 seconds' hides whether an algorithm is practical; 'years' does not."""
    quick = estimate_resources(algorithm_qubits=5, t_count=0, logical_depth=10)
    forever = estimate_resources(
        algorithm_qubits=100, t_count=10**12, logical_depth=10**12
    )

    assert quick["runtime_human"].endswith(("us", "ms"))
    assert forever["runtime_human"].endswith("years")


def test_the_human_duration_never_falls_back_to_exponent_notation() -> None:
    """The function exists to avoid '3.2e+11'; it must not emit '5e+02 us'.

    With a ``{:.2g}`` format it did exactly that: 500 microseconds rendered as
    "5e+02 us" and 365 days as "3.6e+02 days", which is the same unreadable
    notation the function was written to replace, just wearing a unit. Only the
    years band, which is genuinely unbounded, may use an exponent.
    """
    from app.quantum.resources import _human_duration

    for seconds in (0.0, 1e-9, 5e-4, 9.9e-4, 0.5, 0.999, 59.9, 3599.0, 86399.0, 3.15e7):
        rendered = _human_duration(seconds)

        assert "e+" not in rendered and "e-" not in rendered, (seconds, rendered)

    assert _human_duration(5e-4) == "500 us"
    assert _human_duration(1.0) == "1 s"
    assert _human_duration(1e12).endswith("years")


# ── estimate_resources: magic states ────────────────────────────────────────


def test_a_clifford_only_circuit_builds_no_factory_and_says_so() -> None:
    """Zero T gates must cost zero factory tiles, and the payload must explain.

    A bare 0 in ``factories`` is ambiguous between "not needed" and "not
    modelled"; the note disambiguates, and a reader of the JSON should never
    have to guess which it was.
    """
    estimate = estimate_resources(algorithm_qubits=50, t_count=0, logical_depth=1000)

    assert estimate["tiles"]["factories"] == 0
    assert estimate["magic_states"]["modelled"] is False
    assert "t_count is 0" in estimate["magic_states"]["note"]
    assert estimate["budget"]["distillation_allocated"] == 0.0


def test_switching_magic_states_off_labels_the_answer_as_incomplete() -> None:
    """The dangerous case: a T-heavy circuit priced with factories disabled.

    That number is a topological-only figure and is far too small. It must
    carry that warning in the payload, because it will be read out of the
    payload and not out of the call site.
    """
    estimate = estimate_resources(
        algorithm_qubits=50, t_count=10**6, logical_depth=1000, model_magic_states=False
    )

    assert estimate["tiles"]["factories"] == 0
    assert "NOT a complete estimate" in estimate["magic_states"]["note"]


def test_a_multi_level_factory_is_charged_for_the_whole_15_to_1_tree() -> None:
    """A level-2 factory is 16 units, not 2. Catches the geometric sum collapsing.

    Fifteen level-1 units feed each level-2 unit, so an n-level factory is
    ``(15^n - 1)/14`` units: 1, 16, 241, 3616. Charging ``n`` units instead —
    an easy simplification to make while refactoring — under-counts a two-level
    factory's footprint by 8x and a three-level one by 80x, in a term that for
    T-heavy algorithms dominates the entire machine.
    """
    one_level = estimate_resources(
        algorithm_qubits=50, t_count=10**4, logical_depth=10**6, factory_count=1
    )
    two_level = estimate_resources(
        algorithm_qubits=50, t_count=10**13, logical_depth=10**6, factory_count=1
    )

    assert one_level["magic_states"]["distillation_levels"] == 1
    assert two_level["magic_states"]["distillation_levels"] == 2
    # One factory, so tiles_per_factory is exactly units * FACTORY_TILES_PER_UNIT.
    assert one_level["magic_states"]["tiles_per_factory"] == 1 * FACTORY_TILES_PER_UNIT
    assert two_level["magic_states"]["tiles_per_factory"] == 16 * FACTORY_TILES_PER_UNIT


def test_a_t_count_needing_no_distillation_admits_the_t_gates_were_free() -> None:
    """The quiet under-count: levels = 0 charges T gates no time and no space.

    With a loose budget and a handful of T gates the raw injected state already
    meets the per-state target, so no factory is built. The model then charges
    those T gates NOTHING — no tiles, no cycles — while ``modelled`` is still
    True. A reader seeing ``modelled: true, factories: 0`` would reasonably
    conclude the T cost had been priced and come out at zero. It was not priced
    at all, and the note has to say so.
    """
    estimate = estimate_resources(
        algorithm_qubits=10, t_count=5, logical_depth=100, physical_error_rate=1e-3
    )
    magic = estimate["magic_states"]

    assert magic["distillation_levels"] == 0
    assert magic["factories"] == 0
    assert estimate["distillation_code_cycles"] == 0
    assert magic["modelled"] is True  # T gates existed and were considered...
    assert "under-counts" in magic["note"]  # ...but cost nothing, and it says so.
    assert "No distillation needed" in magic["note"]


def test_an_explicit_factory_count_is_honoured_and_changes_the_runtime() -> None:
    """``factory_count`` must not be quietly ignored or silently capped.

    It is the one lever a caller has over the distillation bottleneck, and it is
    deliberately NOT bounded by MAX_AUTO_FACTORIES (that cap governs only the
    auto-balanced path). A version that dropped the argument would return the
    same runtime for one factory and for sixty-four, which is a wrong answer
    that looks like a right one.
    """
    one = estimate_resources(
        algorithm_qubits=20, t_count=10**9, logical_depth=100, factory_count=1
    )
    many = estimate_resources(
        algorithm_qubits=20, t_count=10**9, logical_depth=100, factory_count=64
    )

    assert one["magic_states"]["factories"] == 1
    assert many["magic_states"]["factories"] == 64  # above MAX_AUTO_FACTORIES, on purpose
    assert many["distillation_code_cycles"] < one["distillation_code_cycles"]
    assert many["tiles"]["factories"] > one["tiles"]["factories"]


def test_more_t_gates_need_more_distillation() -> None:
    """The per-state budget is the total divided by the T count.

    Catches the T count being dropped from the division, which would price a
    trillion-T algorithm the same as a thousand-T one.
    """
    small = estimate_resources(algorithm_qubits=50, t_count=10**3, logical_depth=10**5)
    large = estimate_resources(algorithm_qubits=50, t_count=10**12, logical_depth=10**5)

    # STRICTLY greater, not >=. If the T count were dropped from the division
    # both sides would come out EQUAL, and a >= assertion would sail past the
    # exact bug this test is named for.
    assert (
        large["magic_states"]["distillation_levels"]
        > small["magic_states"]["distillation_levels"]
    )
    assert large["tiles"]["factories"] > small["tiles"]["factories"]


# ── estimate_resources: the honesty of the payload ──────────────────────────


def test_the_assumptions_come_back_as_data_in_the_payload() -> None:
    """Every constant that moved the number must be reproducible from the result.

    Without this a caller gets a qubit count with no way to tell which
    threshold, tile size or cycle time produced it, and therefore no way to
    challenge it. That is the difference between an estimate and an assertion.
    """
    estimate = estimate_resources(
        algorithm_qubits=100,
        t_count=10**6,
        logical_depth=10**6,
        physical_error_rate=1e-3,
        code_cycle_seconds=2e-6,
    )
    assumptions = estimate["assumptions"]

    assert assumptions["surface_code_threshold"] == SURFACE_CODE_THRESHOLD
    assert assumptions["logical_error_prefactor"] == pytest.approx(0.1)
    assert assumptions["code_cycle_seconds"] == 2e-6
    assert "(d + 1) / 2" in assumptions["logical_error_model"]
    assert "Fowler" in assumptions["logical_error_model_source"]
    assert "FITTED" in assumptions["logical_error_model_source"]
    assert "15-to-1" in assumptions["distillation_protocol"]
    for key in (
        "qubits_per_tile",
        "cycles_per_logical_operation",
        "routing_tile_overhead",
        "factory_tiles_per_unit",
        "factory_cycles_per_state",
        "max_distance",
    ):
        assert key in assumptions

    # And the inputs are echoed, so the result is self-describing.
    assert estimate["inputs"]["physical_error_rate"] == 1e-3
    assert estimate["inputs"]["t_count"] == 10**6


def test_the_payload_calls_itself_an_order_of_magnitude_estimate() -> None:
    """The number will be copied out of this dict into a slide. The warning must go with it.

    A refactor that drops these two fields turns a projection into what looks
    like a measurement, which is the one failure this module cannot tolerate.
    """
    estimate = estimate_resources(algorithm_qubits=10, t_count=100, logical_depth=100)

    assert estimate["estimate_kind"] == "order_of_magnitude"
    assert "order-of-magnitude" in estimate["disclaimer"].lower()
    assert "not measured" in estimate["disclaimer"].lower() or (
        "no part of this was measured" in estimate["disclaimer"].lower()
    )


def test_the_caveats_name_the_specific_things_the_model_ignores() -> None:
    """Generic hedging is worthless; the reader needs the actual omissions.

    Routing, the single global error rate, the hand-picked factory constants
    and the fitted threshold each move the answer by a large factor, and each
    must be named rather than covered by "results may vary".
    """
    caveats = " ".join(
        estimate_resources(algorithm_qubits=10, t_count=100, logical_depth=100)["caveats"]
    ).lower()

    assert "routing" in caveats
    assert "worst qubit" in caveats
    assert "fitted" in caveats
    assert "factory" in caveats or "factories" in caveats
    assert "order of magnitude" in caveats
    # The direction of the error has to be named too, not just its existence.
    # "Constants are approximate" is useless to a reader deciding whether to
    # trust a number; "these counts are a floor, 1.6x optimistic against the
    # cited paper" tells them which way to be wrong.
    assert "optimistic" in caveats
    assert "floor" in caveats


def test_the_payload_explains_why_it_disagrees_with_the_decoder_lab() -> None:
    """Two pages on one site showing 1% and 2.9% must explain themselves.

    Otherwise the most careful reader — the one who checks both — is the one
    who concludes the platform does not know its own numbers.
    """
    assumptions = estimate_resources(
        algorithm_qubits=10, t_count=0, logical_depth=100
    )["assumptions"]

    assert (
        assumptions["decoder_lab_threshold_per_channel"]
        == DECODER_LAB_PHENOMENOLOGICAL_THRESHOLD
    )
    # Both conventions, because the decoder lab's 2.9% is a PER-CHANNEL rate and
    # thresholdGuide divides by channelRate(1) = 2/3 before drawing it. Exposing
    # only the 2.9% invites the reader to compare a per-channel rate against this
    # module's depolarising p, which is the confusion the note exists to prevent.
    assert assumptions["decoder_lab_threshold_depolarising_p"] == pytest.approx(
        DECODER_LAB_THRESHOLD_AS_DEPOLARISING_P
    )
    assert assumptions["decoder_lab_threshold_depolarising_p"] == pytest.approx(0.0435, abs=1e-4)
    note = assumptions["decoder_lab_threshold_note"].lower()
    assert "phenomenological" in note
    assert "circuit-level" in note
    assert "per-channel" in note


def test_the_whole_payload_is_json_safe() -> None:
    """It is destined for a FastAPI response; a numpy scalar or a set would 500."""
    import json

    estimate = estimate_resources(
        algorithm_qubits=100, t_count=10**9, logical_depth=10**8
    )

    assert json.loads(json.dumps(estimate))["code_distance"] == estimate["code_distance"]


# ── estimate_resources: refusals ────────────────────────────────────────────


def test_an_above_threshold_device_is_refused_before_any_arithmetic() -> None:
    """Same refusal as required_distance, reached through the public entry point."""
    with pytest.raises(ResourceEstimateError, match="at or above the surface-code threshold"):
        estimate_resources(
            algorithm_qubits=10,
            t_count=0,
            logical_depth=100,
            physical_error_rate=SURFACE_CODE_THRESHOLD,
        )


def test_the_threshold_refusal_wins_over_the_distillation_refusal() -> None:
    """Pins that the guard at the TOP of estimate_resources is the one that fires.

    The check is duplicated: once at the top of ``estimate_resources`` and once
    inside ``required_distance``. The previous version of this file claimed to
    pin the outer one and could not, because at p = 1% both produce the same
    message — delete the outer check and every test still passed.

    p = 30% separates them. It is above the code threshold AND above the ~17%
    where 15-to-1 distillation stops converging, and distillation is solved
    first. So with the outer guard the caller is told the true root cause (the
    device is above threshold and cannot be error-corrected at all); without it
    they are told their magic states are out of reach, which is a symptom and
    sends them off optimising the wrong thing.
    """
    with pytest.raises(ResourceEstimateError, match="at or above the surface-code threshold"):
        estimate_resources(
            algorithm_qubits=10,
            t_count=100,
            logical_depth=100,
            physical_error_rate=0.3,
        )


@pytest.mark.parametrize(
    "kwargs,match",
    [
        ({"physical_error_rate": float("nan")}, "physical_error_rate must be a finite"),
        ({"code_cycle_seconds": float("nan")}, "code_cycle_seconds must be a finite"),
        ({"code_cycle_seconds": float("inf")}, "code_cycle_seconds must be a finite"),
        ({"threshold": float("nan")}, "threshold must be a finite"),
    ],
)
def test_non_finite_inputs_are_refused_by_name(kwargs: dict, match: str) -> None:
    """NaN slips past every ``<`` and ``>=`` guard, because NaN compares False.

    Two distinct failures this prevents:

    * A NaN ``physical_error_rate`` used to pass the positivity check AND the
      at-threshold check, travel all the way into ``required_distance`` and die
      at ``math.ceil`` with "cannot convert float NaN to integer" — a message
      naming neither the field nor the caller's mistake.
    * A NaN or infinite ``code_cycle_seconds`` used not to raise at all. It put
      ``Infinity``/``NaN`` into ``runtime_seconds``, and ``json.dumps`` emits
      those as bare tokens that are NOT valid JSON and that ``JSON.parse`` in a
      browser rejects outright. The payload has to be serialisable by
      construction, not by luck.
    """
    base = {"algorithm_qubits": 10, "t_count": 10, "logical_depth": 10}
    base.update(kwargs)

    with pytest.raises(ResourceEstimateError, match=match):
        estimate_resources(**base)


def test_a_nan_physical_error_rate_is_refused_by_required_distance_directly() -> None:
    """The public entry point must refuse it too, not only estimate_resources."""
    with pytest.raises(ResourceEstimateError, match="finite"):
        required_distance(target_logical_error=1e-12, physical_error_rate=float("nan"))


def test_every_payload_number_survives_a_strict_json_round_trip() -> None:
    """``allow_nan=False`` is what a strict client actually does.

    ``json.dumps`` defaults to ``allow_nan=True`` and will happily emit
    ``Infinity``, so the existing JSON-safety test passes on a payload no
    browser can parse. This pins the strict behaviour instead.
    """
    import json

    estimate = estimate_resources(
        algorithm_qubits=100, t_count=10**9, logical_depth=10**8
    )

    json.dumps(estimate, allow_nan=False)


@pytest.mark.parametrize(
    "kwargs,match",
    [
        ({"algorithm_qubits": 0}, "algorithm_qubits"),
        ({"algorithm_qubits": -5}, "algorithm_qubits"),
        ({"t_count": -1}, "t_count"),
        ({"logical_depth": 0}, "logical_depth"),
        ({"target_total_error": 0.0}, "target_total_error"),
        ({"target_total_error": 1.0}, "target_total_error"),
        ({"code_cycle_seconds": 0.0}, "code_cycle_seconds"),
        ({"factory_count": 0}, "factory_count"),
    ],
)
def test_nonsense_inputs_are_refused_by_name(kwargs: dict, match: str) -> None:
    """Each refusal names the offending field, so a 400 is actionable.

    A bare "invalid input" from a function with nine keyword arguments costs
    the caller a guessing game.
    """
    base = {"algorithm_qubits": 10, "t_count": 10, "logical_depth": 10}
    base.update(kwargs)

    with pytest.raises(ResourceEstimateError, match=match):
        estimate_resources(**base)


# ── sanity against the published literature ─────────────────────────────────


def test_a_shor_scale_problem_lands_in_the_published_order_of_magnitude() -> None:
    """The only external check available: does it agree to within ~10x?

    Gidney and Ekera (2021) factor RSA-2048 with ~20 million physical qubits in
    ~8 hours at p = 1e-3. Their construction is heavily optimised in ways this
    model knows nothing about, so the assertion is deliberately a band of two
    orders of magnitude, not a match. It exists to catch a change that moves
    the answer to thousands or to quintillions — the kind of error a monotonic
    test cannot see because it breaks every case equally.
    """
    estimate = estimate_resources(
        algorithm_qubits=6200,
        t_count=2 * 10**9,
        logical_depth=3 * 10**9,
        physical_error_rate=1e-3,
        target_total_error=1e-2,
    )

    assert 10**6 <= estimate["physical_qubits"] <= 10**9
    assert 15 <= estimate["code_distance"] <= 45
    assert math.isfinite(estimate["runtime_seconds"])


# ── logical_counts_from_qasm ────────────────────────────────────────────────

CLIFFORD_ONLY = """OPENQASM 2.0;
include "qelib1.inc";
qreg q[3];
h q[0];
cx q[0],q[1];
s q[1];
sdg q[2];
cz q[1],q[2];
x q[0];
"""

T_AND_TOFFOLI = """OPENQASM 2.0;
include "qelib1.inc";
qreg q[3];
h q[0];
t q[1];
tdg q[2];
ccx q[0],q[1],q[2];
cx q[0],q[1];
"""

ONE_ROTATION = """OPENQASM 2.0;
include "qelib1.inc";
qreg q[1];
rz(0.3) q[0];
"""

CUSTOM_GATE = """OPENQASM 2.0;
include "qelib1.inc";
qreg q[2];
gate mystery a { t a; }
mystery q[0];
h q[1];
"""


def test_a_clifford_only_circuit_has_a_t_count_of_zero() -> None:
    """The entire point of the surface code: Clifford gates are transversal.

    Charging them would inflate every estimate and, worse, would make a
    Clifford circuit look like it needs a magic-state factory.
    """
    counts = logical_counts_from_qasm(CLIFFORD_ONLY)

    assert counts["t_count"] == 0
    assert counts["algorithm_qubits"] == 3
    assert counts["t_count_breakdown"]["unrecognised_gates"] == []


def test_t_gates_and_toffolis_are_priced_at_their_known_costs() -> None:
    """t + tdg + one Toffoli = 2 + 4 magic states, with H and CX free.

    Catches ``tdg`` being missed (it is as non-Clifford as ``t``) and the
    Toffoli being charged as a single T, which would under-count every
    arithmetic-heavy algorithm by 4x.
    """
    counts = logical_counts_from_qasm(T_AND_TOFFOLI)
    breakdown = counts["t_count_breakdown"]

    assert breakdown["direct_t_gates"] == 2
    assert breakdown["toffoli_gates"] == 1
    assert breakdown["rotations"] == 0
    assert counts["t_count"] == 2 + 4


def test_an_arbitrary_rotation_is_charged_for_synthesis_not_treated_as_free() -> None:
    """rz(0.3) has no exact Clifford+T form; it costs ~3 log2(1/eps) T gates.

    Treating rotations as free is the single easiest way to under-estimate a
    variational or Trotterised circuit by two orders of magnitude.
    """
    counts = logical_counts_from_qasm(ONE_ROTATION, rotation_synthesis_error=1e-10)

    assert counts["t_count"] == counts["t_count_breakdown"]["t_per_rotation"]
    assert counts["t_count"] > 100


def test_tightening_the_synthesis_error_raises_the_t_count_logarithmically() -> None:
    """3 log2(1/eps): ten more orders of magnitude costs ~100 more T gates.

    Catches the log being dropped (making the cost constant) or written as a
    power (making it astronomically large).
    """
    loose = logical_counts_from_qasm(ONE_ROTATION, rotation_synthesis_error=1e-5)
    tight = logical_counts_from_qasm(ONE_ROTATION, rotation_synthesis_error=1e-15)

    delta = tight["t_count"] - loose["t_count"]

    assert delta > 0
    assert delta == pytest.approx(3 * math.log2(10**10), rel=0.05)


def test_an_unrecognised_gate_is_charged_rather_than_silently_dropped() -> None:
    """The failure mode that would make this module quietly lie.

    A gate name the module has never seen could be non-Clifford. Treating it
    as free removes real cost from the estimate with no trace. It is charged
    as a rotation instead, and named in the payload so the over-charge is
    visible and correctable.
    """
    counts = logical_counts_from_qasm(CUSTOM_GATE)
    breakdown = counts["t_count_breakdown"]

    assert breakdown["unrecognised_gates"] == ["mystery"]
    assert breakdown["unrecognised_instances"] == 1
    assert counts["t_count"] == breakdown["t_per_rotation"]


def test_a_circuit_feeds_straight_into_an_estimate() -> None:
    """The intended end-to-end path: QASM in, physical qubits out."""
    counts = logical_counts_from_qasm(T_AND_TOFFOLI)
    estimate = estimate_resources(
        algorithm_qubits=counts["algorithm_qubits"],
        t_count=counts["t_count"],
        logical_depth=counts["logical_depth"],
    )

    assert estimate["physical_qubits"] > 0
    assert estimate["magic_states"]["modelled"] is True


def test_unparsable_source_is_refused_as_a_caller_error() -> None:
    """A ResourceEstimateError, not a raw parser exception, so routers map a 400."""
    with pytest.raises(ResourceEstimateError, match="could not parse"):
        logical_counts_from_qasm("this is not a circuit")


def test_a_nonsense_synthesis_error_is_refused() -> None:
    """eps >= 1 would make log2(1/eps) <= 0 and hand back a negative T count."""
    with pytest.raises(ResourceEstimateError, match="rotation_synthesis_error"):
        logical_counts_from_qasm(ONE_ROTATION, rotation_synthesis_error=1.0)
