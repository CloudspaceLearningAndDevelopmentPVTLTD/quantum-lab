"""Offline tests for the per-device calibration summaries.

Same discipline as test_hardware.py: no network, no vendor SDKs, credentials
cleared up front. The live-extraction paths are exercised with hand-built fakes
shaped like the qiskit ``BackendV2.target`` and Braket ``AwsDevice.properties``
objects, because the honesty rule under test — a summary only says 'live' when
a provider object actually yielded figures — must hold regardless of which SDK
version is installed.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.core.config import settings
from app.quantum import calibration, hardware

_CREDENTIAL_ENV_VARS = (
    "IBM_QUANTUM_TOKEN",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_PROFILE",
    "AWS_ROLE_ARN",
    "BRAKET_S3_BUCKET",
)

_SUMMARY_KEYS = {
    "source",
    "qubits",
    "median_1q_error",
    "median_2q_error",
    "median_t1_us",
    "median_t2_us",
    "queue_depth",
    "note",
}


@pytest.fixture(autouse=True)
def _no_credentials(monkeypatch: pytest.MonkeyPatch) -> None:
    """Clear every vendor credential so the tests are deterministic.

    Args:
        monkeypatch: pytest's environment patcher.
    """
    for name in _CREDENTIAL_ENV_VARS:
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(settings, "ibm_quantum_token", None, raising=False)
    monkeypatch.setattr(settings, "aws_access_key_id", None, raising=False)


# ---------------------------------------------------------------------------
# The static typical-values table
# ---------------------------------------------------------------------------


def test_static_calibration_is_labelled_typical() -> None:
    """A table hit is 'static' and its note says the values are typical."""
    summary = calibration.static_calibration("ibm_brisbane")

    assert set(summary) == _SUMMARY_KEYS
    assert summary["source"] == "static"
    assert "typical" in summary["note"].lower()
    assert "not a live calibration" in summary["note"].lower()


def test_static_calibration_unknown_device_is_unavailable() -> None:
    """An unknown id gets 'unavailable', never invented numbers."""
    summary = calibration.static_calibration("acme_qpu_9000")

    assert summary["source"] == "unavailable"
    assert summary["median_2q_error"] is None
    assert summary["median_t1_us"] is None


def test_static_table_values_are_physically_plausible() -> None:
    """Every table row: errors are probabilities, times positive, 1Q <= 2Q."""
    for device_id, row in calibration.STATIC_CALIBRATIONS.items():
        summary = calibration.static_calibration(device_id)
        assert 0 < summary["median_1q_error"] < 1, device_id
        assert 0 < summary["median_2q_error"] < 1, device_id
        # On every real QPU two-qubit gates are the noisier ones; a table row
        # violating that is a transcription mistake, not a discovery.
        assert summary["median_1q_error"] <= summary["median_2q_error"], device_id
        assert summary["median_t1_us"] > 0, device_id
        assert summary["median_t2_us"] > 0, device_id
        assert summary["qubits"] == row["qubits"]


# ---------------------------------------------------------------------------
# The device listing without credentials: static/unavailable only, never live
# ---------------------------------------------------------------------------


def test_listing_without_credentials_never_claims_live_calibration() -> None:
    """Every catalogue row carries a summary, and none of them says 'live'."""
    devices = hardware.list_hardware_devices()

    assert devices
    for device in devices:
        summary = device.get("calibration")
        assert summary is not None, f"{device['id']} has no calibration summary"
        assert summary["source"] in ("static", "unavailable"), device["id"]

    by_id = {device["id"]: device for device in devices}
    assert by_id["ibm_brisbane"]["calibration"]["source"] == "static"
    assert by_id["ionq_aria"]["calibration"]["source"] == "static"
    # Trapped-ion coherence should dwarf superconducting coherence in the
    # table, or the table has been mangled.
    assert (
        by_id["ionq_aria"]["calibration"]["median_t1_us"]
        > by_id["ibm_brisbane"]["calibration"]["median_t1_us"]
    )


def test_devices_route_serialises_calibration() -> None:
    """The HTTP layer keeps the field: pydantic must not strip it silently."""
    # The API's HTTP dependencies are optional in this test environment; the
    # extraction and honesty tests above run regardless.
    pytest.importorskip("fastapi")
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as client:
        response = client.get("/api/hardware/devices")

    assert response.status_code == 200
    rows = response.json()
    assert rows
    for row in rows:
        assert "calibration" in row
        assert row["calibration"]["source"] in ("static", "unavailable")


# ---------------------------------------------------------------------------
# Live IBM extraction from a Target-shaped fake
# ---------------------------------------------------------------------------


def _fake_ibm_backend() -> SimpleNamespace:
    """Build a BackendV2-shaped fake with known medians.

    1Q errors {1e-4, 2e-4, 3e-4} -> median 2e-4; 2Q errors {8e-3, 1e-2} ->
    median 9e-3; T1 {100us, 200us, 300us} -> 200us; T2 {50us, 150us, 250us}
    -> 150us.
    """
    qubit_props = [
        SimpleNamespace(t1=100e-6, t2=50e-6),
        SimpleNamespace(t1=200e-6, t2=150e-6),
        SimpleNamespace(t1=300e-6, t2=250e-6),
    ]
    target = {
        "sx": {
            (0,): SimpleNamespace(error=1e-4),
            (1,): SimpleNamespace(error=2e-4),
            (2,): SimpleNamespace(error=3e-4),
        },
        "ecr": {
            (0, 1): SimpleNamespace(error=8e-3),
            (1, 2): SimpleNamespace(error=1e-2),
        },
        # Measurement carries no error attribute here; it must be skipped, not
        # crash the extraction.
        "measure": {(0,): SimpleNamespace(error=None)},
    }

    class FakeTarget(dict):
        qubit_properties = qubit_props

    return SimpleNamespace(target=FakeTarget(target), num_qubits=3)


def test_ibm_calibration_reads_medians_from_target() -> None:
    """The fake's known medians come back, labelled 'live'."""
    summary = calibration.ibm_calibration(_fake_ibm_backend(), queue_depth=7)

    assert summary is not None
    assert summary["source"] == "live"
    assert summary["median_1q_error"] == pytest.approx(2e-4)
    assert summary["median_2q_error"] == pytest.approx(9e-3)
    assert summary["median_t1_us"] == pytest.approx(200.0)
    assert summary["median_t2_us"] == pytest.approx(150.0)
    assert summary["queue_depth"] == 7
    assert summary["qubits"] == 3


def test_ibm_calibration_refuses_live_label_without_data() -> None:
    """A target with no figures returns None so the caller serves 'static'."""

    class EmptyTarget(dict):
        qubit_properties: list = []

    backend = SimpleNamespace(target=EmptyTarget(), num_qubits=5)
    assert calibration.ibm_calibration(backend) is None


def test_ibm_calibration_swallows_broken_backend() -> None:
    """A backend whose target explodes degrades to None, never raises."""

    class Exploding:
        @property
        def target(self) -> None:
            raise RuntimeError("vendor schema changed again")

    assert calibration.ibm_calibration(Exploding()) is None


# ---------------------------------------------------------------------------
# Live Braket extraction from provider-properties fakes
# ---------------------------------------------------------------------------


def _fake_ionq_device() -> SimpleNamespace:
    """IonQ-style provider block: mean fidelities plus T1/T2 in seconds."""
    props = SimpleNamespace(
        paradigm=SimpleNamespace(qubitCount=25),
        provider=SimpleNamespace(
            fidelity={"1Q": {"mean": 0.9995}, "2Q": {"mean": 0.996}},
            timing={"T1": 100.0, "T2": 1.0},
        ),
        standardized=None,
    )
    device = SimpleNamespace(properties=props)
    device.queue_depth = lambda: SimpleNamespace(quantum_tasks={"Normal": "3", "Priority": "1"})
    return device


def test_braket_calibration_reads_ionq_provider_block() -> None:
    """Fidelity means become error rates; seconds become microseconds."""
    summary = calibration.braket_calibration(_fake_ionq_device())

    assert summary is not None
    assert summary["source"] == "live"
    assert summary["median_1q_error"] == pytest.approx(1 - 0.9995)
    assert summary["median_2q_error"] == pytest.approx(1 - 0.996)
    assert summary["median_t1_us"] == pytest.approx(100.0 * 1e6)
    assert summary["median_t2_us"] == pytest.approx(1.0 * 1e6)
    assert summary["queue_depth"] == 4
    assert summary["qubits"] == 25


def test_braket_calibration_unrecognised_schema_returns_none() -> None:
    """A device exposing neither schema yields None, not a hollow 'live'."""
    device = SimpleNamespace(
        properties=SimpleNamespace(paradigm=SimpleNamespace(qubitCount=84))
    )
    device.queue_depth = lambda: (_ for _ in ()).throw(RuntimeError("no queue info"))
    assert calibration.braket_calibration(device) is None
