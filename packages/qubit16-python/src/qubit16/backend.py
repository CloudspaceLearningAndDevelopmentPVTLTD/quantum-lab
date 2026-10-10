"""A ``BackendV2`` over a device row from ``GET /api/hardware/devices``.

WHAT THIS BACKEND HONESTLY IS
-----------------------------
It is a *handle*: a name, a qubit count, a vendor, and whatever availability
and calibration the device row carried. It is enough to construct a primitive
against and enough to print, and it is deliberately not pretending to be more.

WHAT IT IS NOT: A TRANSPILATION TARGET
--------------------------------------
``BackendV2.target`` is supposed to describe the device's instruction set,
coupling map, durations and errors so Qiskit can compile against it locally.
**We cannot build that from what the API serves.** The devices endpoint gives
an id, a vendor, a qubit count, a technology, availability, a queue depth and a
median-error calibration summary. It gives no coupling map and no basis gates,
so a Target built here would be a fabrication — and a fabricated coupling map
is the worst possible kind, because Qiskit would happily route a circuit onto
edges that do not exist and the resulting failure would look like a hardware
problem.

So :attr:`target` returns a Target with the right width and **no instructions**,
and the consequence is stated rather than hidden: ``transpile(qc, backend)``
against this object will not produce a device-native circuit. It does not need
to. **Transpilation happens server-side**: ``POST /api/hardware/submit`` takes
your circuit as OpenQASM 3 and compiles it against the real device with the
``optimization_level`` you asked for, and the submission response tells you the
depth and two-qubit-gate count of what actually ran.

If you want to see the compiled circuit before you spend anything, that is what
``POST /api/hardware/transpile`` is for — it is public and free.

The rejected alternative was shipping a static table of coupling maps for the
nine catalogued devices. It was rejected because IBM retires and re-calibrates
devices continuously, a stale coupling map is indistinguishable from a fresh
one at the call site, and a wrong one produces confident nonsense. Serving the
real coupling map from the API and building a Target from it is the right fix,
and it belongs on the server.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Mapping

from qiskit.providers import BackendV2, Options
from qiskit.transpiler import Target

if TYPE_CHECKING:  # pragma: no cover - typing only
    from .job import Qubit16Job
    from .provider import Qubit16Provider


class Qubit16Backend(BackendV2):
    """One real device, reachable through qubit16.

    Attributes:
        device: The raw device row, so a caller can read fields this class does
            not model without a second request.
        service: The provider that produced this backend. Named ``service`` to
            match ``QiskitRuntimeService``, which is the object this package's
            provider is a drop-in for.
    """

    def __init__(self, device: Mapping[str, Any], provider: Qubit16Provider) -> None:
        """Wrap a device row.

        Args:
            device: One entry from ``GET /api/hardware/devices``.
            provider: The provider to submit through.
        """
        super().__init__(
            name=str(device.get("id") or device.get("name") or "unknown"),
            description=str(device.get("note") or ""),
            backend_version="1",
        )
        self.device = dict(device)
        self.service = provider
        self._num_qubits = int(device.get("qubits") or 0)
        self._target: Target | None = None

    # ── BackendV2 contract ──────────────────────────────────────────────────

    @property
    def target(self) -> Target:
        """A Target with the right width and no instructions. See the module docstring.

        Returns:
            A ``Target`` carrying only ``num_qubits``. Its ``description`` says
            so in words, because the one place somebody will look when
            ``transpile()`` behaves oddly is the object they passed in.
        """
        if self._target is None:
            self._target = Target(
                num_qubits=self._num_qubits,
                description=(
                    f"{self.name}: width only. qubit16 does not serve a coupling map or basis "
                    "gates, so this Target carries no instructions and is NOT a transpilation "
                    "target. Circuits are transpiled server-side at submission."
                ),
            )
        return self._target

    @property
    def num_qubits(self) -> int:
        """Qubits the vendor publishes for this device.

        Returns:
            The count from the device row. Zero when the row did not carry
            one, which is the honest answer rather than a guess — a zero-width
            backend will fail loudly at the first circuit check.
        """
        return self._num_qubits

    @property
    def max_circuits(self) -> int:
        """How many circuits one submission carries.

        Returns:
            1. The wire format is one QASM document per job, so a list of pubs
            becomes a list of jobs — and each of those costs one unit of the
            monthly allowance. Reporting a larger number here would let Qiskit
            batch in a way the API cannot honour.
        """
        return 1

    @classmethod
    def _default_options(cls) -> Options:
        """Submission defaults.

        Returns:
            The same defaults the API applies when a field is omitted, so a
            caller reading this object and a caller reading ``docs/API.md``
            see one set of numbers. ``dynamical_decoupling`` and
            ``measurement_twirling`` default off because a run should be
            reproducible by default: the person comparing two runs should be
            the one who decided they differ.
        """
        return Options(
            shots=4096,
            optimization_level=1,
            dynamical_decoupling=False,
            measurement_twirling=False,
            resilience_level=1,
        )

    def run(self, run_input: Any, **options: Any) -> Qubit16Job:
        """Submit one circuit the legacy ``backend.run`` way.

        Provided so code written against ``backend.run(qc, shots=…)`` keeps
        working. **The result shape is the V2 primitive shape**, not the old
        ``qiskit.result.Result`` — ``job.result()[0].data.<creg>.get_counts()``
        rather than ``job.result().get_counts()``. Faking the old container on
        top of the new one would be a second result shape to keep correct, and
        ``Qubit16Job.counts()`` is the one-line convenience instead.

        Args:
            run_input: A ``QuantumCircuit``, or a list holding exactly one.
            **options: ``shots``, ``optimization_level``,
                ``dynamical_decoupling``, ``measurement_twirling``.

        Returns:
            A running job.

        Raises:
            ValueError: When more than one circuit is passed. Each circuit is a
                separate submission and a separate unit of the monthly
                allowance, so quietly enqueueing five jobs from one ``run()``
                call would spend an allowance the caller did not know they were
                spending. Loop and call ``run`` per circuit if that is what you
                want.
        """
        from .primitives import SamplerV2  # imported here to avoid a cycle

        circuits = run_input if isinstance(run_input, (list, tuple)) else [run_input]
        if len(circuits) != 1:
            raise ValueError(
                f"backend.run takes exactly one circuit here, got {len(circuits)}. Each circuit "
                "is one submission and one unit of your monthly hardware allowance, so this "
                "refuses rather than spending several at once. Loop over your circuits, or use "
                "SamplerV2 which makes the per-circuit cost explicit."
            )

        shots = options.pop("shots", None)
        sampler = SamplerV2(mode=self, options=options or None)
        return sampler.run([circuits[0]], shots=shots)

    # ── qubit16 extras ──────────────────────────────────────────────────────

    @property
    def provider_name(self) -> str:
        """Which vendor runs this device.

        Returns:
            ``ibm``, ``ionq``, ``rigetti`` or whatever the catalogue said. Note
            this is the *vendor*, not the API's routing provider: IonQ and
            Rigetti devices are submitted through ``braket``.
        """
        return str(self.device.get("provider") or "")

    @property
    def available(self) -> bool:
        """Whether the device row said the device can take work.

        Returns:
            The row's ``available`` flag, defaulting to True when absent. A
            False here is a snapshot from the last catalogue read, not a
            guarantee about the next minute.
        """
        return bool(self.device.get("available", True))

    @property
    def pending_jobs(self) -> int | None:
        """Queue depth when the vendor reported one.

        Returns:
            The pending job count, or None. **None is not zero** — it means the
            provider did not say, which is normal for catalogue rows served
            without live credentials.
        """
        value = self.device.get("pending_jobs")
        return int(value) if isinstance(value, (int, float)) else None

    @property
    def calibration(self) -> dict[str, Any] | None:
        """Median error and coherence figures, with their provenance.

        Returns:
            The calibration summary, or None. Read its ``source`` field before
            using it: ``live`` means queried from the vendor just now,
            ``static`` means the shipped table of vendor-published *typical*
            values — a projection, not a measurement of this device today — and
            ``unavailable`` means there is nothing truthful to show.
        """
        summary = self.device.get("calibration")
        return dict(summary) if isinstance(summary, Mapping) else None

    def __repr__(self) -> str:
        """A one-line description that says where the numbers came from.

        Returns:
            Something like
            ``<Qubit16Backend ibm_brisbane 127q ibm available source=live>``.
        """
        return (
            f"<Qubit16Backend {self.name} {self._num_qubits}q {self.provider_name} "
            f"{'available' if self.available else 'unavailable'} "
            f"source={self.device.get('source', 'unknown')}>"
        )


__all__ = ["Qubit16Backend"]
