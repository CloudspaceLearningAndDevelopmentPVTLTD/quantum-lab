"""Every advertised capability is reachable, and every reachable one is priced.

This file exists because of a specific recurring defect in this codebase: a
module gets written, its tests pass in isolation, and nothing ever calls it. The
entitlement helpers had zero callers. The env validation never executed. And
``app/quantum/azure.py`` — 485 lines — was reachable only through
``azure_available()``, which the backend registry used to decide whether to grey
out two entries it then could not submit to.

So these tests do not check behaviour. They check that the registry, the
provider map, the pricing table and the transpiler agree with each other, by
deriving one from the other rather than restating both. Adding a backend without
finishing the job fails here.

Nothing here needs a vendor SDK, credentials or a network: every assertion is
about the service's own tables.
"""

from __future__ import annotations

import pytest

from app.quantum import hardware, transpile as transpile_mod
from app.quantum.backends import list_backends


def _hardware_backend_ids() -> list[str]:
    """Every id the registry advertises as real hardware.

    Returns:
        The backend ids with ``kind == "hardware"``.
    """
    return [backend.id for backend in list_backends() if backend.kind == "hardware"]


def test_the_registry_advertises_some_hardware() -> None:
    """Guard the guards: an empty list would pass every test below vacuously."""
    assert len(_hardware_backend_ids()) >= 5


def test_every_advertised_hardware_backend_has_a_provider() -> None:
    """A backend the picker offers must be one ``submit_job`` can dispatch.

    THE BUG: ``azure_quantinuum_h1`` and ``azure_ionq_aria`` were in the
    registry and absent from BACKEND_PROVIDER, so selecting either gave
    "'azure_quantinuum_h1' is not a hardware backend" — a 400 for a device the
    service had just offered.
    """
    missing = [
        backend_id
        for backend_id in _hardware_backend_ids()
        if backend_id not in hardware.BACKEND_PROVIDER
    ]
    assert not missing, (
        f"advertised in the registry but not routable by submit_job: {missing}. "
        "Add them to hardware.BACKEND_PROVIDER or stop advertising them."
    )


def test_provider_for_resolves_every_advertised_backend() -> None:
    """The same check through the public function the routes actually call."""
    for backend_id in _hardware_backend_ids():
        provider = hardware.provider_for(backend_id)
        assert provider in (
            hardware.PROVIDER_IBM,
            hardware.PROVIDER_BRAKET,
            hardware.PROVIDER_AZURE,
        ), f"{backend_id} resolved to unknown provider '{provider}'"


def test_every_azure_backend_maps_to_a_real_azure_target() -> None:
    """Our stable ids must translate to the target strings Azure expects.

    ``azure_quantinuum_h1`` is ours; ``quantinuum.qpu.h1-1`` is Microsoft's.
    Submitting the former verbatim would be rejected by the workspace.
    """
    from app.quantum.azure import AZURE_TARGETS

    known = {target["id"] for target in AZURE_TARGETS}
    azure_ids = [
        backend_id
        for backend_id in _hardware_backend_ids()
        if hardware.BACKEND_PROVIDER.get(backend_id) == hardware.PROVIDER_AZURE
    ]
    assert azure_ids, "no Azure backends advertised; this test proves nothing"
    for backend_id in azure_ids:
        target = hardware.AZURE_BACKEND_TARGETS.get(backend_id)
        assert target is not None, f"{backend_id} has no Azure target mapping"
        assert target in known, f"{backend_id} maps to unknown Azure target '{target}'"


def test_every_hardware_backend_is_priced() -> None:
    """No paid device may fall through to the simulator's zero rate.

    THE BUG: ``vendor_for`` defaults an unknown id to ``"simulator"``, and five
    hardware ids were missing from BACKEND_VENDOR — ibm_kyiv, ibm_sherbrooke,
    ionq_forte and both Azure targets. ``/api/hardware/estimate`` therefore
    answered ``is_free: true`` with the note "No charge: simulators run locally"
    for an IonQ Forte submission. The user sees free, the invoice does not.
    """
    mispriced = [
        backend_id
        for backend_id in _hardware_backend_ids()
        if transpile_mod.vendor_for(backend_id) == "simulator"
    ]
    assert not mispriced, (
        f"hardware backends priced as simulators (i.e. free): {mispriced}. "
        "Add them to transpile.BACKEND_VENDOR."
    )


def test_a_paid_device_is_never_reported_as_free() -> None:
    """The end-to-end version of the check above, through estimate_cost."""
    for backend_id in _hardware_backend_ids():
        estimate = transpile_mod.estimate_cost(backend_id, 1000, 5)
        if backend_id.startswith("ibm"):
            # IBM's open plan really is free of charge; it is metered in
            # QPU-seconds. That is the one honest zero here.
            assert estimate["is_free"] is True
            continue
        assert estimate["is_free"] is False, (
            f"{backend_id} was reported as free: {estimate['note']}"
        )


def test_an_unpriceable_vendor_says_so_instead_of_saying_free() -> None:
    """Quantinuum bills in credits, so 'we do not know' beats a made-up number.

    A zero total with ``is_free: false`` is the deliberate shape: there is no
    dollar figure to report, and the note has to carry the warning instead.
    """
    estimate = transpile_mod.estimate_cost("azure_quantinuum_h1", 1000, 5)
    assert estimate["estimated_total"] == 0.0
    assert estimate["is_free"] is False
    assert "NOT free" in estimate["note"]
    assert "Credits" in estimate["note"]


def test_every_hardware_backend_has_a_basis_gate_set() -> None:
    """Transpiling for an unknown backend silently used the universal set."""
    for backend_id in _hardware_backend_ids():
        gates = transpile_mod.basis_gates_for(backend_id)
        assert gates, f"{backend_id} has no basis gates"


def test_the_azure_submit_and_poll_functions_are_actually_reachable() -> None:
    """The 485-line module has callers now, and this is what proves it.

    Without credentials the call must fail with MissingDependency naming what to
    set — NOT with "unknown provider" or "not a hardware backend", which is what
    it did when the dispatch was missing. The distinction is the whole point:
    one message means "configure me", the other means "this was never wired up".
    """
    with pytest.raises(hardware.MissingDependency) as submitted:
        hardware.submit_job("", "azure_quantinuum_h1", 100, hardware.PROVIDER_AZURE)
    assert "azure" in str(submitted.value).lower()

    with pytest.raises(hardware.MissingDependency) as polled:
        hardware.poll_job(hardware.PROVIDER_AZURE, "some-job-id")
    assert "azure" in str(polled.value).lower()


def test_azure_targets_appear_in_the_device_list() -> None:
    """``/api/hardware/devices`` used to omit Azure entirely.

    The registry offered the backends and the device list did not mention them,
    so the hardware page could not render a card for a device it would let you
    pick. Without credentials the rows are catalogue rows marked unavailable,
    which is the correct honest answer.
    """
    devices = hardware.list_hardware_devices()
    providers = {device["provider"] for device in devices}
    assert "quantinuum" in providers, (
        f"no Quantinuum device in the list; providers were {sorted(providers)}"
    )
    quantinuum = [d for d in devices if d["provider"] == "quantinuum"]
    for device in quantinuum:
        assert device["available"] is False
        assert device["source"] == "catalogue"
        assert device["reason"], "an unavailable device must say why"


def test_every_selectable_device_in_the_catalogue_is_routable() -> None:
    """A device the catalogue offers as available must be one we can submit to.

    THE BUG THIS CATCHES: the tests above check the REGISTRY
    (``list_backends()``) against ``BACKEND_PROVIDER``. The device picker does
    not read the registry — it reads ``GET /api/hardware/devices``, which is
    ``list_hardware_devices()``, a different table built from a different
    source. Azure rows in it came straight from ``list_azure_targets()`` keyed
    by Microsoft's target string, so the catalogue advertised
    ``quantinuum.qpu.h1-1`` as an available device while every route downstream
    only understood ``azure_quantinuum_h1``.

    The visible failure was identical to the one the registry tests were
    written to prevent — "'quantinuum.qpu.h1-1' is not a hardware backend" for
    a device the service had just offered — reached by a path those tests did
    not cover.

    A device may be listed and unavailable: that is how an unconfigured
    provider, or a target this service has not wired up, is honestly reported.
    What it may not be is listed, marked available, and unsubmittable.
    """
    unroutable = []
    for device in hardware.list_hardware_devices():
        if not device.get("available"):
            continue
        try:
            hardware.provider_for(str(device["id"]))
        except ValueError:
            unroutable.append(device["id"])

    assert not unroutable, (
        f"offered as available but submit_job cannot dispatch them: {unroutable}. "
        "Either map the id in hardware.BACKEND_PROVIDER or mark the row unavailable."
    )


def test_unwired_azure_targets_are_listed_but_refused_with_a_reason() -> None:
    """A workspace target we have not wired up is shown, not hidden, and not offered.

    Hiding it would leave an operator wondering why their workspace's emulator
    is missing; offering it would fail at submission with a message about an
    unknown backend id they never typed. Listed-and-refused, with the reason,
    is the only honest option.
    """
    rows = {str(d["id"]): d for d in hardware.list_hardware_devices()}

    # `ionq.simulator` is in AZURE_TARGETS and deliberately not in
    # AZURE_BACKEND_TARGETS. If it is ever wired up, this test should be
    # updated to name whichever target is then the unwired one.
    unwired = rows.get("ionq.simulator")
    assert unwired is not None, "the unwired Azure targets should still be listed"
    assert unwired["available"] is False
    assert "not wired into this service" in str(unwired.get("reason", ""))


def test_wired_azure_targets_are_listed_under_our_stable_id() -> None:
    """The catalogue speaks the registry's language, not Microsoft's."""
    ids = {str(d["id"]) for d in hardware.list_hardware_devices()}

    assert "azure_quantinuum_h1" in ids
    assert "quantinuum.qpu.h1-1" not in ids

    # The vendor's own spelling is kept alongside, for finding the job in
    # Microsoft's portal.
    row = next(d for d in hardware.list_hardware_devices() if d["id"] == "azure_quantinuum_h1")
    assert row["vendor_target"] == "quantinuum.qpu.h1-1"
