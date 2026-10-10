"""Offline tests for parameterised circuits and bounded sweeps.

There are three kinds of assertion in this file and only the first one is
interesting.

THE ORDERING TESTS. ``QuantumCircuit.parameters`` is sorted alphabetically by
name, not by the order the ``input`` declarations appear in the source, and the
V2 pubs consume the value array in that same alphabetical order. An
implementation that emits values in source order produces a job that succeeds,
returns a full set of counts, and describes a landscape belonging to a different
pair of angles. Nothing in the result reveals it, no exception is raised, and
the numbers look entirely reasonable. ``test_values_bind_alphabetically_not_in_
source_order`` runs the circuit on a simulator and asserts on the measured
bitstring precisely so that the check does not depend on believing a claim about
Qiskit's internals — if Qiskit ever changed the sort, this test would fail
rather than the platform quietly returning wrong physics.

THE BOUND TESTS. A sweep is ONE submission and therefore one quota unit, which
is the feature and also the hazard: ``num: 100000`` looks the same as ``num: 8``
in a request body. Every refusal is asserted to NAME its limit, because a bare
"invalid sweep" leaves the caller guessing at which knob to turn.

THE ORDINARY VALIDATION TESTS. Typo'd parameter names, missing values, NaN.
These fail loudly and anyone using the feature once would find them; they are
here so a refactor cannot quietly drop them.
"""

from __future__ import annotations

import math
from typing import Any

import pytest

from app.quantum.parameters import (
    MAX_PARAMETERS,
    MAX_SWEEP_POINTS,
    MAX_SWEEP_TOTAL_SHOTS,
    ParameterError,
    binding_order,
    estimate_sweep_cost,
    estimator_pub_arrays,
    normalise_inputs,
    parse_parameterised_qasm,
    parse_sweep,
    per_point_counts,
    sweep_values,
)

# theta is declared FIRST and alpha SECOND, on purpose: binding order is
# alphabetical, so the correct value array is [alpha, theta] — the reverse of
# how a reader of the source would write them down.
TWO_PARAM_QASM = """OPENQASM 3.0;
include "stdgates.inc";
input float[64] theta;
input float[64] alpha;
qubit[1] q;
bit[1] c;
rx(theta) q[0];
rz(alpha) q[0];
c = measure q;
"""

ONE_PARAM_QASM = """OPENQASM 3.0;
include "stdgates.inc";
input float[64] theta;
qubit[1] q;
bit[1] c;
rx(theta) q[0];
c = measure q;
"""

PLACEHOLDER_QASM = """OPENQASM 3.0;
include "stdgates.inc";
qubit[1] q;
bit[1] c;
rx({theta}) q[0];
c = measure q;
"""


# ── parsing ─────────────────────────────────────────────────────────────────


def test_qasm3_input_declarations_become_parameters() -> None:
    """``input float[64] theta;`` is the spec's own spelling and must work.

    If this breaks, the recommended route into the whole feature is gone and
    the placeholder convention is all that is left.
    """
    parsed = parse_parameterised_qasm(ONE_PARAM_QASM)

    assert parsed["parameters"] == ["theta"]
    assert parsed["num_qubits"] == 1
    assert [p.name for p in parsed["circuit"].parameters] == ["theta"]


def test_reported_parameter_order_is_alphabetical_not_source_order() -> None:
    """The reported order must be the BINDING order, not the reading order.

    theta is declared first in the source and alpha second. Reporting
    ``["theta", "alpha"]`` here would be the natural thing to implement and
    would make every downstream value array wrong by a transposition.
    """
    parsed = parse_parameterised_qasm(TWO_PARAM_QASM)

    assert parsed["parameters"] == ["alpha", "theta"]


def test_parameter_expressions_in_an_angle_survive() -> None:
    """``rz(2*theta + pi/4)`` must parse; refusing arithmetic would make every
    circuit the web app exports unusable, since it writes angles as fractions
    of pi."""
    parsed = parse_parameterised_qasm(
        """OPENQASM 3.0;
include "stdgates.inc";
input float[64] theta;
qubit[1] q;
rz(2*theta + pi/4) q[0];
"""
    )

    assert parsed["parameters"] == ["theta"]


def test_placeholders_are_rewritten_into_input_declarations() -> None:
    """``rx({theta})`` is what a caller templating a string reaches for first."""
    parsed = parse_parameterised_qasm(PLACEHOLDER_QASM)

    assert parsed["parameters"] == ["theta"]
    assert "input float[64] theta;" in parsed["qasm"]
    assert "{theta}" not in parsed["qasm"]


def test_a_placeholder_for_an_already_declared_input_is_not_declared_twice() -> None:
    """A source that mixes both spellings must not emit a duplicate declaration.

    Two ``input float[64] theta;`` lines is a parse error, so a caller who wrote
    the declaration AND used braces would be refused for a problem this module
    created.
    """
    normalised = normalise_inputs(
        """OPENQASM 3.0;
include "stdgates.inc";
input float[64] theta;
qubit[1] q;
rx({theta}) q[0];
"""
    )

    assert normalised.count("input float[64] theta;") == 1
    assert "{theta}" not in normalised


def test_placeholder_declaration_lands_after_the_include() -> None:
    """An ``input`` before ``include "stdgates.inc";`` still parses today, but
    putting the generated line where a human would put it keeps the normalised
    source diffable against the original."""
    normalised = normalise_inputs(PLACEHOLDER_QASM)
    lines = [line.strip() for line in normalised.splitlines()]

    assert lines.index("input float[64] theta;") == lines.index('include "stdgates.inc";') + 1


def test_openqasm2_is_refused_with_a_message_naming_openqasm3() -> None:
    """OpenQASM 2 cannot carry a free parameter and the reader has no hook.

    The failure mode this prevents is a caller spending an afternoon on a
    sentinel-substitution workaround because the error only said "could not
    parse".
    """
    with pytest.raises(ParameterError) as excinfo:
        parse_parameterised_qasm(
            """OPENQASM 2.0;
include "qelib1.inc";
qreg q[1];
rx({theta}) q[0];
"""
        )

    assert "OpenQASM 3" in str(excinfo.value)


def test_openqasm2_behind_a_block_comment_is_still_refused_by_dialect() -> None:
    """A ``/* generated by ... */`` banner must not hide the version line.

    The dialect guard originally skipped only ``//`` comments, so a QASM 2 file
    from any exporter — they all write a block-comment banner — sailed past it
    into ``qasm3.loads`` and came back with a syntax error about ``qreg``. That
    is precisely the message the guard exists to replace, and it appeared only
    for machine-generated sources, which are the ones a user is least able to
    debug.
    """
    with pytest.raises(ParameterError) as excinfo:
        parse_parameterised_qasm(
            """/* Generated by qiskit 1.2 */
OPENQASM 2.0;
include "qelib1.inc";
qreg q[1];
rx({theta}) q[0];
"""
        )

    assert "OpenQASM 3" in str(excinfo.value)


def test_a_circuit_with_no_free_parameters_is_refused() -> None:
    """Sweeping a fully bound circuit would run the same point N times at N
    times the cost, which is never what anybody meant."""
    with pytest.raises(ParameterError) as excinfo:
        parse_parameterised_qasm(
            'OPENQASM 3.0;\ninclude "stdgates.inc";\nqubit[1] q;\nh q[0];\n'
        )

    assert "no free parameters" in str(excinfo.value)


def test_empty_source_is_refused_before_the_parser_sees_it() -> None:
    """An empty body reaching qasm3.loads produces a stack trace, not a 400."""
    with pytest.raises(ParameterError):
        parse_parameterised_qasm("   \n  ")


def test_unparseable_source_raises_parameter_error_not_a_bare_exception() -> None:
    """Qiskit's importers can raise BaseException-derived panics; one escaping
    here would take down the request instead of returning a 400."""
    with pytest.raises(ParameterError):
        parse_parameterised_qasm(
            'OPENQASM 3.0;\ninput float[64] theta;\nthis is not a circuit\n'
        )


def test_too_many_parameters_is_refused_by_name() -> None:
    """Bounded before anything allocates per-parameter."""
    names = [f"p{index:02d}" for index in range(MAX_PARAMETERS + 1)]
    source = (
        'OPENQASM 3.0;\ninclude "stdgates.inc";\n'
        + "".join(f"input float[64] {name};\n" for name in names)
        + "qubit[1] q;\n"
        + "".join(f"rz({name}) q[0];\n" for name in names)
    )

    with pytest.raises(ParameterError) as excinfo:
        parse_parameterised_qasm(source)

    assert str(MAX_PARAMETERS) in str(excinfo.value)


# ── the ordering test that matters ──────────────────────────────────────────


def test_values_bind_alphabetically_not_in_source_order() -> None:
    """THE test. Run the sweep and read the qubit; do not trust a claim.

    theta drives ``rx`` and is declared first; alpha drives ``rz`` and is
    declared second. The point asks for theta = pi, alpha = 0, so the qubit is
    flipped and every shot must read '1'.

    An implementation that emitted values in SOURCE order would hand [pi, 0] to
    a circuit that binds [alpha, theta], putting pi into the phase gate and 0
    into the flip. The job would succeed, all 256 shots would come back, and
    every one of them would read '0'. That is the failure this asserts against:
    not a crash, a plausible wrong answer.
    """
    from qiskit.primitives import StatevectorSampler

    parsed = parse_parameterised_qasm(TWO_PARAM_QASM)
    names = binding_order(parsed["circuit"])
    points = parse_sweep({"points": [{"theta": math.pi, "alpha": 0.0}]}, names)
    values = sweep_values(points, names)

    assert names == ["alpha", "theta"]
    assert values == [[0.0, math.pi]]

    result = StatevectorSampler(seed=11).run([(parsed["circuit"], values)], shots=256).result()
    counts = result[0].data.c.get_counts()

    assert counts == {"1": 256}


def test_sweep_values_rows_follow_the_given_order_exactly() -> None:
    """The projection is positional; a transposition here is undetectable
    downstream."""
    points = [{"alpha": 1.0, "theta": 2.0}, {"alpha": 3.0, "theta": 4.0}]

    assert sweep_values(points, ["theta", "alpha"]) == [[2.0, 1.0], [4.0, 3.0]]
    assert sweep_values(points, ["alpha", "theta"]) == [[1.0, 2.0], [3.0, 4.0]]


def test_sweep_values_refuses_a_short_row() -> None:
    """Binding a row shorter than the parameter list is the exact failure this
    module exists to prevent, so it is re-checked at the last moment even though
    parse_sweep already covers it."""
    with pytest.raises(ParameterError) as excinfo:
        sweep_values([{"alpha": 1.0}], ["alpha", "theta"])

    assert "theta" in str(excinfo.value)


def test_sweep_values_refuses_an_empty_point_list() -> None:
    """An empty rows list used to come back as ``[]``.

    That is a pub with nothing to bind. Qiskit's reaction is version-dependent
    rather than a guaranteed refusal, and a job that measures nothing still
    takes a queue slot and still pays the Braket per-task fee — a bill for no
    data, produced by a function that returned successfully.
    """
    with pytest.raises(ParameterError):
        sweep_values([], ["theta"])


# ── sweep specifications: explicit points ───────────────────────────────────


def test_explicit_points_keep_their_order() -> None:
    """An optimiser trajectory is a sweep whose order is the whole meaning."""
    points = parse_sweep({"points": [{"theta": 0.3}, {"theta": 0.1}, {"theta": 0.2}]}, ["theta"])

    assert [point["theta"] for point in points] == [0.3, 0.1, 0.2]


def test_a_typo_in_a_point_name_is_refused_and_names_the_parameters() -> None:
    """Unknown keys are silently ignored by dict lookup, so a typo'd 'thetaa'
    would leave theta unbound and Qiskit would complain about the circuit rather
    than about the point."""
    with pytest.raises(ParameterError) as excinfo:
        parse_sweep({"points": [{"thetaa": 0.3}]}, ["theta"])

    assert "thetaa" in str(excinfo.value)
    assert "theta" in str(excinfo.value)


def test_a_point_missing_a_parameter_is_refused_by_index() -> None:
    """With 40 points and one short, the index is the only usable diagnostic."""
    with pytest.raises(ParameterError) as excinfo:
        parse_sweep({"points": [{"a": 0.0, "b": 0.0}, {"a": 1.0}]}, ["a", "b"])

    assert "points[1]" in str(excinfo.value)


def test_nan_and_infinity_are_refused() -> None:
    """A NaN angle reaches the device as a rotation, runs, costs money and
    returns noise — no error anywhere in the chain."""
    for bad in (float("nan"), float("inf"), float("-inf")):
        with pytest.raises(ParameterError):
            parse_sweep({"points": [{"theta": bad}]}, ["theta"])


def test_a_boolean_is_not_a_number_here() -> None:
    """bool is an int in Python, so True would otherwise bind as 1.0 radians."""
    with pytest.raises(ParameterError):
        parse_sweep({"points": [{"theta": True}]}, ["theta"])


def test_too_many_explicit_points_is_refused_and_names_the_limit() -> None:
    """A sweep is one job, so the point count is the bill."""
    too_many = [{"theta": 0.0} for _ in range(MAX_SWEEP_POINTS + 1)]

    with pytest.raises(ParameterError) as excinfo:
        parse_sweep({"points": too_many}, ["theta"])

    assert str(MAX_SWEEP_POINTS) in str(excinfo.value)


def test_points_and_ranges_together_are_refused() -> None:
    """There is no defensible reading of which one wins, and guessing one would
    run a sweep the caller did not describe."""
    with pytest.raises(ParameterError):
        parse_sweep(
            {
                "points": [{"theta": 0.0}],
                "ranges": [{"parameter": "theta", "start": 0.0, "stop": 1.0, "num": 2}],
            },
            ["theta"],
        )


def test_neither_points_nor_ranges_is_refused_with_both_shapes_named() -> None:
    """The message is the documentation a caller reads first."""
    with pytest.raises(ParameterError) as excinfo:
        parse_sweep({}, ["theta"])

    assert "points" in str(excinfo.value)
    assert "ranges" in str(excinfo.value)


# ── sweep specifications: ranges ────────────────────────────────────────────


def test_a_range_includes_its_endpoint_exactly() -> None:
    """The last point must BE ``stop``, bit for bit, on a case that discriminates.

    This test used to scan 0..pi in 5 steps, which proves nothing: for those
    bounds ``start + step * (num - 1)`` rounds back to ``math.pi`` exactly, so
    an accumulating implementation passed it. The cases below are two where
    accumulation genuinely misses — both land on 3.1415926535897936, one ulp
    past pi — so deleting the ``values.append(stop)`` line in ``_linspace``
    fails this test rather than sliding through it.

    A user who asked for pi and reads back something that is not pi reasonably
    concludes the platform is lying about what it ran, and on a Bloch-angle scan
    the endpoint is usually the interesting point.
    """
    for start, num in ((0.1, 4), (0.0, 26)):
        # The failure this pins: the accumulated endpoint is NOT stop here.
        step = (math.pi - start) / (num - 1)
        assert start + step * (num - 1) != math.pi

        points = parse_sweep(
            {"ranges": [{"parameter": "theta", "start": start, "stop": math.pi, "num": num}]},
            ["theta"],
        )

        assert points[0]["theta"] == start
        assert points[-1]["theta"] == math.pi
        assert len(points) == num


def test_num_one_holds_a_parameter_at_start() -> None:
    """Holding one axis fixed while sweeping another is the common 2-D case;
    the midpoint would be a surprise."""
    points = parse_sweep(
        {"ranges": [{"parameter": "theta", "start": 0.7, "stop": 99.0, "num": 1}]},
        ["theta"],
    )

    assert points == [{"theta": 0.7}]


def test_product_varies_the_last_range_fastest() -> None:
    """Row-major, so the point list reshapes to (num_0, num_1).

    A caller drawing a heat map has to know which index is which, and the
    opposite convention would transpose every figure the platform produces
    without ever raising.
    """
    points = parse_sweep(
        {
            "ranges": [
                {"parameter": "a", "start": 0.0, "stop": 1.0, "num": 2},
                {"parameter": "b", "start": 10.0, "stop": 20.0, "num": 2},
            ]
        },
        ["a", "b"],
    )

    assert points == [
        {"a": 0.0, "b": 10.0},
        {"a": 0.0, "b": 20.0},
        {"a": 1.0, "b": 10.0},
        {"a": 1.0, "b": 20.0},
    ]


def test_zip_pairs_the_ith_value_of_each_range() -> None:
    """A diagonal cut through the landscape is a path, not a grid, and the
    product of two 40-point ranges is 1600 points rather than 40."""
    points = parse_sweep(
        {
            "combine": "zip",
            "ranges": [
                {"parameter": "a", "start": 0.0, "stop": 1.0, "num": 3},
                {"parameter": "b", "start": 10.0, "stop": 12.0, "num": 3},
            ],
        },
        ["a", "b"],
    )

    assert points == [
        {"a": 0.0, "b": 10.0},
        {"a": 0.5, "b": 11.0},
        {"a": 1.0, "b": 12.0},
    ]


def test_zip_with_mismatched_lengths_is_refused() -> None:
    """Python's zip() truncates silently, which would drop the tail of the
    longer range and run a shorter scan than the caller asked for."""
    with pytest.raises(ParameterError) as excinfo:
        parse_sweep(
            {
                "combine": "zip",
                "ranges": [
                    {"parameter": "a", "start": 0.0, "stop": 1.0, "num": 3},
                    {"parameter": "b", "start": 0.0, "stop": 1.0, "num": 5},
                ],
            },
            ["a", "b"],
        )

    assert "same num" in str(excinfo.value)


def test_a_parameter_without_a_range_is_refused() -> None:
    """An unbound parameter fails at submission with a message about the
    circuit, long after the caller has left the sweep form."""
    with pytest.raises(ParameterError) as excinfo:
        parse_sweep(
            {"ranges": [{"parameter": "a", "start": 0.0, "stop": 1.0, "num": 2}]}, ["a", "b"]
        )

    assert "b" in str(excinfo.value)
    assert "num: 1" in str(excinfo.value)


def test_a_duplicate_range_is_refused() -> None:
    """Two ranges for one parameter: the second would silently win."""
    with pytest.raises(ParameterError):
        parse_sweep(
            {
                "ranges": [
                    {"parameter": "a", "start": 0.0, "stop": 1.0, "num": 2},
                    {"parameter": "a", "start": 5.0, "stop": 6.0, "num": 2},
                ]
            },
            ["a"],
        )


def test_a_range_for_an_undeclared_parameter_is_refused() -> None:
    """Sweeping 'phi' on a circuit that has no phi would leave theta unbound and
    waste the whole submission."""
    with pytest.raises(ParameterError) as excinfo:
        parse_sweep(
            {"ranges": [{"parameter": "phi", "start": 0.0, "stop": 1.0, "num": 2}]}, ["theta"]
        )

    assert "phi" in str(excinfo.value)


def test_a_product_that_explodes_is_refused_with_the_shape_and_the_limit() -> None:
    """This is the unbounded-bill case: two innocent-looking 20-point ranges are
    400 points, and the refusal has to show the multiplication so the caller can
    see where the number came from."""
    with pytest.raises(ParameterError) as excinfo:
        parse_sweep(
            {
                "ranges": [
                    {"parameter": "a", "start": 0.0, "stop": 1.0, "num": 20},
                    {"parameter": "b", "start": 0.0, "stop": 1.0, "num": 20},
                ]
            },
            ["a", "b"],
        )

    message = str(excinfo.value)
    assert "400" in message
    assert "20 x 20" in message
    assert str(MAX_SWEEP_POINTS) in message


def test_a_single_huge_num_is_refused_before_it_is_expanded() -> None:
    """num: 100000 must not allocate 100000 dicts on the way to being refused."""
    with pytest.raises(ParameterError) as excinfo:
        parse_sweep(
            {"ranges": [{"parameter": "a", "start": 0.0, "stop": 1.0, "num": 100000}]}, ["a"]
        )

    assert str(MAX_SWEEP_POINTS) in str(excinfo.value)


def test_a_non_integer_num_is_refused() -> None:
    """num: 8.5 would become 8 under int() and run a scan of a different
    resolution than the one requested."""
    with pytest.raises(ParameterError):
        parse_sweep(
            {"ranges": [{"parameter": "a", "start": 0.0, "stop": 1.0, "num": 8.5}]}, ["a"]
        )


def test_an_explicit_null_combine_means_absent_but_a_typo_still_does_not() -> None:
    """Null handling must match the rest of the field, and only for null.

    ``points: null`` and ``ranges: null`` were already read as absent, but
    ``combine: null`` was refused with a message accusing the caller of a typo —
    so any client that serialises unset optional fields as null got a 400 for a
    knob it never touched. The distinction that has to survive: an explicit null
    is "I did not choose", while ``"zipp"`` is a typo and defaulting it to
    "product" would turn a 3-point path into a 9-point grid at 3x the bill.
    """
    ranges = [
        {"parameter": "a", "start": 0.0, "stop": 1.0, "num": 3},
        {"parameter": "b", "start": 0.0, "stop": 1.0, "num": 3},
    ]

    assert len(parse_sweep({"ranges": ranges, "combine": None}, ["a", "b"])) == 9

    with pytest.raises(ParameterError):
        parse_sweep({"ranges": ranges, "combine": ""}, ["a", "b"])


def test_a_bad_combine_is_refused_rather_than_defaulted() -> None:
    """Falling back to 'product' on a typo'd 'zipp' turns a 40-point path into a
    1600-point grid and a 40x bill."""
    with pytest.raises(ParameterError):
        parse_sweep(
            {
                "combine": "zipp",
                "ranges": [{"parameter": "a", "start": 0.0, "stop": 1.0, "num": 2}],
            },
            ["a"],
        )


# ── the two pub shapes that fail without raising ────────────────────────────


def test_estimator_pub_gives_every_observable_at_every_point() -> None:
    """The outer product, not the diagonal, and the physics must come out right.

    ⟨Z⟩ of rx(theta)|0> is cos(theta): 1, 0, -1 at theta = 0, pi/2, pi. ⟨X⟩ is
    0 throughout. A pub built from a FLAT observables array and a flat value
    array broadcasts element-wise whenever the two lengths coincide, returning
    ⟨Z⟩ at point 0 and ⟨X⟩ at point 1 and nothing else — three numbers that
    look exactly like a sweep and are a diagonal through one.
    """
    import numpy as np
    from qiskit.primitives import StatevectorEstimator
    from qiskit.quantum_info import SparsePauliOp

    circuit = parse_parameterised_qasm(ONE_PARAM_QASM)["circuit"].remove_final_measurements(
        inplace=False
    )
    names = binding_order(circuit)
    points = parse_sweep(
        {"ranges": [{"parameter": "theta", "start": 0.0, "stop": math.pi, "num": 3}]}, names
    )
    operators = [SparsePauliOp.from_list([("Z", 1.0)]), SparsePauliOp.from_list([("X", 1.0)])]

    column, row = estimator_pub_arrays(operators, sweep_values(points, names))
    evs = StatevectorEstimator().run([(circuit, column, row)]).result()[0].data.evs

    assert evs.shape == (2, 3)
    assert np.allclose(evs[0], [1.0, 0.0, -1.0], atol=1e-9)
    assert np.allclose(evs[1], [0.0, 0.0, 0.0], atol=1e-9)


def test_per_point_counts_does_not_merge_the_landscape() -> None:
    """``BitArray.get_counts()`` on a swept result aggregates every point.

    The three points here are rx(0), rx(pi/2) and rx(pi) — 100% '0', a coin
    flip, and 100% '1'. Aggregated they are an indistinguishable ~50/50, which
    is also what a broken sweep, a dead qubit and a completely different circuit
    all look like. This asserts the shape of the landscape survives.
    """
    from qiskit.primitives import StatevectorSampler

    parsed = parse_parameterised_qasm(ONE_PARAM_QASM)
    names = parsed["parameters"]
    points = parse_sweep(
        {"ranges": [{"parameter": "theta", "start": 0.0, "stop": math.pi, "num": 3}]}, names
    )
    values = sweep_values(points, names)

    result = StatevectorSampler(seed=3).run([(parsed["circuit"], values)], shots=100).result()
    counts = per_point_counts(result[0].data.c, len(values))

    assert len(counts) == 3
    assert counts[0] == {"0": 100}
    assert counts[2] == {"1": 100}
    # The middle point is the coin flip, and it is the one the aggregate hides.
    assert set(counts[1]) == {"0", "1"}


def test_per_point_counts_refuses_a_length_mismatch() -> None:
    """If the result does not have one entry per point, the counts cannot be
    attributed to points and any alignment would be a guess presented as data."""

    class _Bits:
        shape = (2,)

        def __getitem__(self, index: int) -> "_Bits":
            return self

        def get_counts(self) -> dict[str, int]:
            return {"0": 1}

    with pytest.raises(ParameterError) as excinfo:
        per_point_counts(_Bits(), 5)

    assert "5 points" in str(excinfo.value)


def test_per_point_counts_keeps_the_index_when_one_point_cannot_be_read() -> None:
    """A dropped entry would re-label every point after it; an empty dict does
    not."""

    class _Bits:
        shape = (3,)

        def __getitem__(self, index: int) -> Any:
            if index == 1:
                raise RuntimeError("unreadable")
            return self

        def get_counts(self) -> dict[str, int]:
            return {"0": 4}

    assert per_point_counts(_Bits(), 3) == [{"0": 4}, {}, {"0": 4}]


def test_per_point_counts_refuses_an_unswept_scalar_result() -> None:
    """The hole the shape guard originally left open, checked against real Qiskit.

    A 0-d ``BitArray`` is what comes back when the values reached the primitive
    as a flat row rather than an array of rows — the sweep never happened. The
    guard tested ``len(shape) >= 1`` and so skipped this case entirely; the loop
    then returned ``[{}, {}, {}]`` with no exception. That reads as "the sweep
    ran and every point was empty", which is a missing landscape dressed up as a
    measured one, on exactly the path that has already spent the money.
    """
    from qiskit.primitives import StatevectorSampler

    parsed = parse_parameterised_qasm(ONE_PARAM_QASM)
    # A FLAT value row, not a list of rows: one point, not a sweep.
    result = StatevectorSampler(seed=5).run([(parsed["circuit"], [math.pi])], shots=10).result()
    data = result[0].data.c

    assert data.shape == ()
    with pytest.raises(ParameterError) as excinfo:
        per_point_counts(data, 3)
    assert "3 points" in str(excinfo.value)

    # One point genuinely is one point, and must still read out.
    assert per_point_counts(data, 1) == [{"1": 10}]


def test_per_point_counts_refuses_a_container_it_cannot_index_at_all() -> None:
    """Every point unreadable is not a landscape with gaps; it is no landscape.

    An object with no ``.shape`` reaches the read loop with no guard in front of
    it. Returning ``num_points`` empty dicts would let a caller plot nothing and
    call it a result, so total failure is now an error while a single bad point
    is still an empty dict at the right index.
    """

    class _NotABitArray:
        def __getitem__(self, index: int) -> Any:
            raise TypeError("not subscriptable")

    with pytest.raises(ParameterError) as excinfo:
        per_point_counts(_NotABitArray(), 3)

    assert "_NotABitArray" in str(excinfo.value)


def test_estimator_pub_arrays_refuses_empty_inputs() -> None:
    """An empty column or row produces a pub that raises deep inside Qiskit with
    a message about broadcasting rather than about the request."""
    with pytest.raises(ParameterError):
        estimator_pub_arrays([], [[0.0]])
    with pytest.raises(ParameterError):
        estimator_pub_arrays(["op"], [])


def test_estimator_pub_arrays_refuses_ragged_rows() -> None:
    """numpy would build an object array from ragged rows and the pub would
    bind garbage."""
    with pytest.raises(ParameterError):
        estimator_pub_arrays(["op"], [[0.0, 1.0], [0.0]])


# ── cost ────────────────────────────────────────────────────────────────────


def test_cost_reports_the_multiplier_and_a_readable_summary() -> None:
    """'40 points x 4096 shots' is the sentence a caller must see before
    spending; a bare total_shots does not convey that it is 40x their usual
    run."""
    cost = estimate_sweep_cost(40, 4096)

    assert cost["points"] == 40
    assert cost["multiplier"] == 40
    assert cost["total_shots"] == 163840
    assert cost["summary"] == "40 points x 4096 shots = 163,840 shots (estimated)"
    assert cost["is_estimate"] is True


def test_cost_charges_the_task_fee_once_for_the_sweep() -> None:
    """The single per-task fee instead of one per point is most of the saving on
    Braket; reporting the comparison is the justification for the feature."""
    cost = estimate_sweep_cost(10, 1000, per_shot_usd=0.00003, task_fee_usd=0.3)

    assert cost["estimated_task_fee_usd"] == 0.3
    assert cost["estimated_usd"] == pytest.approx(10 * 1000 * 0.00003 + 0.3)
    assert cost["estimated_usd_if_submitted_separately"] == pytest.approx(
        10 * 1000 * 0.00003 + 0.3 * 10
    )


def test_the_saving_ships_with_the_caveat_that_it_is_unverified_on_braket() -> None:
    """The per-task-fee saving is the number a launch post would lift.

    It is only real if the vendor runs the sweep as ONE task, which has been
    verified for Qiskit Runtime's V2 pub contract and NOT for Braket or Azure —
    Braket binds OpenQASM ``inputs`` per task. Without the caveat travelling in
    the payload, the honest hedge lives in a docstring nobody renders and the
    platform quotes a saving it has not measured.
    """
    caveat = estimate_sweep_cost(10, 1000, per_shot_usd=0.00003, task_fee_usd=0.3)["caveat"]

    assert "Braket" in caveat
    assert "NOT verified" in caveat


def test_an_unpriced_vendor_reports_none_not_zero() -> None:
    """Quantinuum bills in H-System Credits. Reporting 0.0 would read as 'free'
    with an invoice attached — the exact dishonesty this codebase avoids
    everywhere else."""
    cost = estimate_sweep_cost(8, 1024, per_shot_usd=None)

    assert cost["estimated_usd"] is None
    assert cost["estimated_usd_if_submitted_separately"] is None
    assert cost["total_shots"] == 8192


def test_the_total_shot_ceiling_catches_what_the_point_ceiling_misses() -> None:
    """256 points is legal and 20000 shots is legal, but 5.1M shots together is
    not: the point ceiling alone does not bound the bill."""
    with pytest.raises(ParameterError) as excinfo:
        estimate_sweep_cost(MAX_SWEEP_POINTS, 20000)

    assert str(MAX_SWEEP_TOTAL_SHOTS) in str(excinfo.value)


def test_zero_shots_and_zero_points_are_refused() -> None:
    """A zero here would make the summary read '0 points x 0 shots' and the
    caller conclude the sweep was free."""
    with pytest.raises(ParameterError):
        estimate_sweep_cost(0, 1024)
    with pytest.raises(ParameterError):
        estimate_sweep_cost(4, 0)


# ── the whole path ──────────────────────────────────────────────────────────


def test_parse_sweep_and_values_line_up_end_to_end() -> None:
    """The shape a caller hands to a V2 pub: (num_points, num_parameters), in
    the circuit's own binding order."""
    parsed = parse_parameterised_qasm(TWO_PARAM_QASM)
    names = parsed["parameters"]
    points = parse_sweep(
        {
            "ranges": [
                {"parameter": "theta", "start": 0.0, "stop": math.pi, "num": 4},
                {"parameter": "alpha", "start": 0.0, "stop": 1.0, "num": 2},
            ]
        },
        names,
    )
    values = sweep_values(points, names)

    assert len(values) == 8
    assert all(len(row) == 2 for row in values)
    # names is ["alpha", "theta"]; the ranges were listed theta-first, so a
    # value array that echoed the RANGE order would be transposed here.
    assert values[0] == [0.0, 0.0]
    assert values[1] == [1.0, 0.0]
    assert estimate_sweep_cost(len(values), 1024)["total_shots"] == 8192
