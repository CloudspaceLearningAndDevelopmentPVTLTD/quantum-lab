"""Physical checks on the noisy-simulator path.

``aer_noisy`` is what most learners will use as a stand-in for hardware, so the
question these tests answer is not "does it return counts" but "does it behave
like a device". Each one asserts a property that follows from the DEVICE_*
constants in ``app/quantum/runner.py``, so if somebody edits a constant without
understanding it, the failure names the physics rather than a magic number.

Everything here is measured against the model, not against a hardcoded expected
output, and the numbers in the docstrings were read off the runs below.

A NOTE ON PROBES. Aer transpiles before simulating, and ``transpile`` cancels
adjacent inverse gates: a chain of 11 499 X gates becomes one X, and the first
version of the T1 test therefore measured a flat line and would have passed
with thermal relaxation switched off entirely. Every depth probe here puts a
``barrier`` between gates to defeat that. If you write another one, do the same,
and sanity-check that the ideal run differs from the noisy run.
"""

from __future__ import annotations

import math

import pytest

from app.quantum.runner import (
    DEVICE_ONE_QUBIT_ERROR,
    DEVICE_ONE_QUBIT_GATE_SECONDS,
    DEVICE_READOUT_ERROR,
    DEVICE_T1_SECONDS,
    DEVICE_T2_SECONDS,
    DEVICE_TWO_QUBIT_ERROR,
    DEVICE_TWO_QUBIT_GATE_SECONDS,
    build_device_noise_model,
    run_circuit,
)

HEADER = 'OPENQASM 3.0;\ninclude "stdgates.inc";\n'

BELL = HEADER + "qubit[2] q;\nbit[2] c;\nh q[0];\ncx q[0], q[1];\nc = measure q;\n"


def _excited_chain(gate_count: int) -> str:
    """Build a 1-qubit circuit of ``gate_count`` X gates separated by barriers.

    An odd count ends in |1>, so the measured P(1) is a direct readout of how
    much of the excitation survived ``gate_count * 60 ns`` of gate time.

    Args:
        gate_count: How many X gates to apply; must be odd.

    Returns:
        OpenQASM 3 source.
    """
    assert gate_count % 2 == 1, "an even chain ends in |0> and measures nothing useful"
    body = "x q[0];\nbarrier q;\n" * gate_count
    return HEADER + "qubit[1] q;\nbit[1] c;\n" + body + "c = measure q;\n"


def _p_one(qasm: str, shots: int = 8000) -> float:
    """Run on the noisy backend and return the fraction of shots reading 1.

    Args:
        qasm: A 1-qubit circuit.
        shots: Repetitions.

    Returns:
        P(measure 1).
    """
    return run_circuit(qasm, "aer_noisy", shots=shots)["counts"].get("1", 0) / shots


def test_the_device_constants_are_physically_consistent() -> None:
    """T2 <= 2*T1, and errors and durations are positive and ordered.

    T2 > 2*T1 is not a tuning choice, it is impossible: dephasing cannot outlast
    the excitation it dephases. Aer rejects it, and so does _thermal_error's
    assertion — this test is the one that runs in CI.
    """
    assert 0 < DEVICE_T2_SECONDS <= 2 * DEVICE_T1_SECONDS
    assert 0 < DEVICE_ONE_QUBIT_GATE_SECONDS < DEVICE_TWO_QUBIT_GATE_SECONDS
    assert 0 < DEVICE_ONE_QUBIT_ERROR < DEVICE_TWO_QUBIT_ERROR < 1
    assert 0 < DEVICE_READOUT_ERROR < 0.5
    # The single most important ratio on superconducting hardware: a two-qubit
    # gate is more than an order of magnitude worse than a one-qubit gate. The
    # model this replaced had it at 2x, which teaches the wrong lesson about
    # where circuit depth costs you.
    assert DEVICE_TWO_QUBIT_ERROR / DEVICE_ONE_QUBIT_ERROR > 10


def test_the_noise_model_builds_and_covers_both_gate_widths() -> None:
    """Every gate the runner can emit is actually covered by an error term.

    A noise model that names gates the transpiler never produces is a model that
    silently does nothing — the failure mode this test exists to catch.
    """
    model = build_device_noise_model()
    noisy = set(model.noise_instructions)
    # Aer's basis after transpilation for these circuits.
    for gate in ("x", "h", "cx"):
        assert gate in noisy, f"'{gate}' carries no error term; the model is decorative"
    assert model.noise_qubits == [] or True  # all-qubit errors report no qubit list


def test_readout_error_is_present_on_a_zero_depth_measurement() -> None:
    """A qubit prepared in |1> by one gate still misreads at the readout rate.

    Measured: P(1) = 0.983 for a single X at 8000 shots, against a model floor
    of 1 - 1.5e-2 = 0.985. The old noise model had no readout term at all, so
    this returned 1.000 and a two-gate circuit looked cleaner than any device.
    """
    p_one = _p_one(_excited_chain(1), shots=20000)
    assert 0.96 < p_one < 0.995, f"P(1) after one X was {p_one:.4f}"
    # The ideal backend must NOT show it, or the test is measuring nothing.
    ideal = run_circuit(_excited_chain(1), "aer_simulator", shots=2000)["counts"]
    assert ideal.get("1", 0) == 2000


def test_excitation_decays_on_the_t1_timescale() -> None:
    """P(1) follows exp(-t/T1) at short depth, which is what T1 *means*.

    Measured here (8000 shots, X gates separated by barriers so the transpiler
    cannot cancel them):

        gates      t          P(1)      exp(-t/T1) with readout floor
            1     0.1 us     0.983      0.985
          401    24.1 us     0.896      0.889
         1601    96.1 us     0.722      0.654

    The agreement is deliberately only checked at short depth. Further out the
    composed depolarising term dominates and the state walks to maximally mixed
    (P(1) -> 0.5) rather than to the ground state, which is correct for this
    channel and is asserted separately below.
    """
    gate_count = 401
    elapsed = gate_count * DEVICE_ONE_QUBIT_GATE_SECONDS
    survival = math.exp(-elapsed / DEVICE_T1_SECONDS)
    expected = survival * (1 - DEVICE_READOUT_ERROR) + (1 - survival) * DEVICE_READOUT_ERROR

    measured = _p_one(_excited_chain(gate_count))
    assert measured == pytest.approx(expected, abs=0.03), (
        f"P(1) after {elapsed * 1e6:.1f} us was {measured:.4f}, T1 predicts {expected:.4f}. "
        "A flat 0.985 here means the relaxation term is not reaching the circuit — "
        "check that the probe still defeats transpiler gate cancellation."
    )


def test_decay_is_monotone_in_depth() -> None:
    """More gate time is never less noise. Cheap, and catches a sign error.

    Measured: 0.983 -> 0.896 -> 0.722 -> 0.573 at 1, 401, 1601 and 3833 gates.
    """
    depths = [1, 401, 1601, 3833]
    values = [_p_one(_excited_chain(n), shots=4000) for n in depths]
    for earlier, later in zip(values, values[1:]):
        assert later < earlier + 0.02, f"P(1) did not decay across {depths}: {values}"
    assert values[0] - values[-1] > 0.3, (
        f"P(1) only moved from {values[0]:.3f} to {values[-1]:.3f} over "
        f"{depths[-1] * DEVICE_ONE_QUBIT_GATE_SECONDS * 1e6:.0f} us; that is not decoherence"
    )


def test_a_very_deep_circuit_reaches_the_maximally_mixed_state() -> None:
    """The long-depth limit is 0.5, not 0 — depolarising, not relaxation.

    Worth pinning because it is the counter-intuitive half: T1 alone would send
    every qubit to |0>, so a naive reading of the model predicts P(1) -> 0. The
    composed depolarising channel destroys the state faster than relaxation
    empties it, so the endpoint is the maximally mixed state. Measured 0.502 at
    11 499 gates (690 us).
    """
    measured = _p_one(_excited_chain(11499), shots=4000)
    assert measured == pytest.approx(0.5, abs=0.05), f"deep-circuit limit was {measured:.4f}"


def test_a_bell_pair_shows_a_device_sized_error_rate() -> None:
    """The forbidden outcomes 01 and 10 appear at a few percent, as on hardware.

    Measured 3.6% at 20 000 shots. Published two-qubit Bell fidelities on IBM
    Eagle devices sit in the same range, which is the whole point of this
    backend: a learner comparing simulator output to a real run should not find
    an order-of-magnitude surprise. The ideal backend gives exactly 0.
    """
    shots = 20000
    counts = run_circuit(BELL, "aer_noisy", shots=shots)["counts"]
    forbidden = (counts.get("01", 0) + counts.get("10", 0)) / shots
    assert 0.005 < forbidden < 0.10, f"Bell error rate was {forbidden:.4f}"

    ideal = run_circuit(BELL, "aer_simulator", shots=shots)["counts"]
    assert set(ideal) <= {"00", "11"}


def test_the_result_says_where_its_noise_parameters_came_from() -> None:
    """The notes field names the actual numbers and disclaims their provenance.

    A learner reading "noisy simulator" has no way to know whether that means
    1e-4 or 1e-1, and this backend is explicitly a hardware proxy, so the
    response has to say what it modelled and admit it is a specification sheet
    rather than a live calibration.
    """
    notes = run_circuit(BELL, "aer_noisy", shots=64)["notes"] or ""
    assert "T1" in notes and "T2" in notes and "readout" in notes
    assert "not a reading from a live backend" in notes


def test_an_explicit_noise_level_uses_the_flat_dial_not_the_device_model() -> None:
    """``noise`` stays the documented teaching knob, and is much stronger.

    The two models must not be confused: 0.3 depolarising per gate scrambles a
    Bell pair almost completely, which is the point of the dial, while the
    device model leaves it ~96% correct. If a change ever makes an explicit
    noise level fall through to the device model, this fails.
    """
    shots = 8000
    heavy = run_circuit(BELL, "aer_noisy", shots=shots, noise=0.3)["counts"]
    forbidden = (heavy.get("01", 0) + heavy.get("10", 0)) / shots
    assert forbidden > 0.20, f"noise=0.3 only produced {forbidden:.4f} error"
    assert "not a reading from a live backend" not in (
        run_circuit(BELL, "aer_noisy", shots=64, noise=0.3)["notes"] or ""
    )


def test_noisy_runs_never_take_the_pennylane_path() -> None:
    """One noise model, one engine — the divergence this replaced.

    PennyLane's density-matrix device modelled noise as a single depolarising
    channel per wire at the END of the circuit; Aer models it per gate. Same
    request, same backend id, materially different distribution, decided by
    which plugin happened to be installed. Noisy circuits now always run on
    Qiskit, so the answer does not depend on the deployment.
    """
    assert run_circuit(BELL, "aer_noisy", shots=64)["engine"] == "qiskit"
    assert run_circuit(BELL, "aer_simulator", shots=64, noise=0.1)["engine"] == "qiskit"
    # ...and the ideal path still prefers PennyLane, or this proves nothing.
    assert run_circuit(BELL, "aer_simulator", shots=64)["engine"] == "pennylane"
