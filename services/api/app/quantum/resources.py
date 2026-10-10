"""Fault-tolerant resource estimation: physical qubits and runtime for an algorithm.

WHAT THIS ANSWERS, AND WHAT IT DOES NOT
---------------------------------------
"How many physical qubits and how much wall-clock time would this algorithm
need under surface-code error correction?" is the question every quantum
algorithms paper ends on, and it is the one question you cannot answer by
running anything: the machine does not exist. So it is answered by a model.

**This module is an order-of-magnitude model and nothing more.** Every number
it returns should be read as "about 10^N", not as a figure with two significant
digits. The payload says so in its own fields (``estimate_kind``,
``disclaimer``, ``caveats``) precisely so that a number lifted out of this API
and pasted into a slide carries its own health warning. If you need a figure
you would defend in a paper, use this to decide whether the answer is millions
or billions of qubits, then do the real layout work.

THE MODEL
---------
*Logical error rate.* For a rotated surface code of odd distance ``d`` under
circuit-level depolarising noise of strength ``p``, the probability that one
logical qubit suffers a logical error in one code cycle is taken as

    p_L(d) = A * (p / p_th) ** ((d + 1) / 2)

with ``A ≈ 0.1`` and a threshold ``p_th ≈ 1e-2``. This is the standard fitted
form from Fowler, Mariantoni, Martinis and Cleland, *Surface codes: towards
practical large-scale quantum computation*, Phys. Rev. A 86, 032324 (2012),
Sec. XI. The exponent is the number of errors needed to produce an undetected
logical fault, ``⌊(d+1)/2⌋``; for odd ``d`` the floor is exact and this module
only ever uses odd ``d``.

``A`` and ``p_th`` are **fitted to simulations of a particular decoder and a
particular noise model**. They are not derived, they are not universal, and a
different decoder or a biased-noise device moves both. Treat the constants as
inputs, which is why they are parameters of :func:`logical_error_per_cycle`.

*Footprint.* One logical qubit is one surface-code "tile" of ``2 * d * d``
physical qubits (``d*d`` data plus ``d*d - 1`` measure qubits, rounded up).
Routing space, magic-state factories and the ancilla region for lattice
surgery are extra; see below.

*Time.* One logical operation via lattice surgery takes about ``d`` code
cycles, and a code cycle is about a microsecond on superconducting hardware
(far slower on trapped ions — pass ``code_cycle_seconds`` rather than trusting
the default).

*Magic states.* Every non-Clifford gate consumes one distilled magic state.
Distillation is modelled with the 15-to-1 block code, whose output error for
input error ``p`` is about ``35 * p**3`` (Bravyi and Kitaev, Phys. Rev. A 71,
022316 (2005)). Levels are stacked until the per-state error fits the budget.
Factory footprint and throughput are taken as flat tile counts in the spirit of
Litinski, *A Game of Surface Codes*, Quantum 3, 128 (2019) — see
:data:`FACTORY_TILES_PER_UNIT` for exactly how crude that is.

WHERE THIS DISAGREES WITH /workbench/decoder-lab, AND WHY
---------------------------------------------------------
``apps/web/lib/qec/session.ts`` holds a per-channel threshold of **2.9%** and
draws its guide line at the corresponding depolarising ``p`` of **~4.35%**
(``thresholdGuide`` divides by ``channelRate(1) = 2/3``). This module uses
**1%**. That is not an inconsistency to be reconciled; they are thresholds of
two different noise models and both numbers are right for their own model.

* The decoder lab simulates *phenomenological* noise: data qubits depolarise
  between rounds and syndrome measurements flip, and nothing else. There are
  two noise locations per qubit per round, so the code tolerates a lot.
* Resource estimation has to assume *circuit-level* noise: every gate, every
  idle step and every measurement inside the syndrome-extraction circuit is its
  own noise location, an order of magnitude more of them, and the threshold
  drops accordingly to the well-known ~0.5–1%.

Using the decoder lab's number here would under-estimate ``d``, and therefore
under-estimate qubit counts, by a large factor. All three constants are exported
(:data:`SURFACE_CODE_THRESHOLD`,
:data:`DECODER_LAB_PHENOMENOLOGICAL_THRESHOLD` and
:data:`DECODER_LAB_THRESHOLD_AS_DEPOLARISING_P`) so that a caller comparing the
two pages is told, rather than left to discover a contradiction — and so that
the per-channel and depolarising conventions are not silently compared against
each other.

WHAT IS DELIBERATELY NOT MODELLED
---------------------------------
Stated here rather than buried, because a resource estimate that looks more
precise than it is would be worse than shipping none:

* **Layout and routing.** Real qubit counts depend on whether you pick a
  compact, intermediate or fast block layout, and the difference is a factor of
  two to three. This module applies one flat multiplier
  (:data:`ROUTING_TILE_OVERHEAD`) as a stand-in. That multiplier is not a
  layout.
* **Non-uniform noise.** ``p`` is one number for the whole device. Real devices
  have a worst qubit, and the code distance is set by the worst region.
* **Distillation detail.** Factory tile counts and cycle counts are flat
  constants; the real figures depend on the ``(d_X, d_Z, d_m)`` variant chosen
  and on the layout, and were not re-derived here.
* **Decoder throughput.** The estimate assumes the decoder keeps up with the
  syndrome stream. A decoder that falls behind adds a backlog that this model
  cannot see.
* **Everything about the control system**, cryogenics, wiring and classical
  compute. Those often dominate cost in practice and appear nowhere here.
"""

from __future__ import annotations

import math
from typing import Any

#: Circuit-level depolarising threshold for the surface code.
#:
#: Fowler et al. (2012) put it near 0.57% for a full circuit-level model with a
#: minimum-weight matching decoder; 1% is the round number the resource-
#: estimation literature (and the Azure/Google roadmaps) habitually quotes. 1%
#: is used here because it is the value the ``A = 0.1`` prefactor below is
#: usually quoted alongside, and mixing a prefactor fitted at one threshold
#: with another threshold is worse than using the round pair together.
#:
#: Using the OPTIMISTIC end of the published range makes this module's qubit
#: counts optimistic. That is the wrong direction for a sales number and the
#: right direction for "even under favourable assumptions you need N qubits".
SURFACE_CODE_THRESHOLD = 0.01

#: Prefactor ``A`` in ``p_L = A (p/p_th)^((d+1)/2)``. Fitted, not derived.
#:
#: Fowler et al.'s own fit is nearer ``A = 0.03`` alongside ``p_th = 0.57%``.
#: This module uses the round pair (0.1, 1%) that the resource-estimation
#: literature quotes, for the reason given on :data:`SURFACE_CODE_THRESHOLD`.
#:
#: HOW MUCH THAT COSTS, stated plainly because the two deviations pull in
#: opposite directions and it would be easy to imply they cancel. They do not:
#: at ``p = 1e-3`` and ``d = 21`` this module gives ``p_L = 1e-12`` where
#: Fowler's own constants give ``1.45e-10``, 145x worse — so reaching a 1e-12
#: target with their pair needs ``d = 27``, not 21. Physical qubits go as
#: ``d^2``, so this module's footprints are roughly 1.6x OPTIMISTIC against the
#: source it cites. Read every number here as a floor.
LOGICAL_ERROR_PREFACTOR = 0.1

#: The decoder lab's phenomenological threshold, as a PER-CHANNEL error rate.
#:
#: ``apps/web/lib/qec/session.ts`` holds 0.029 as ``perChannel`` and then returns
#: ``perChannel / channelRate(1)`` from ``thresholdGuide``, i.e. it divides by
#: 2/3 to convert a per-channel rate into a depolarising ``p``. So the line the
#: page actually draws sits near 4.35%, not 2.9%; 2.9% is the number before that
#: conversion. Both are recorded here because quoting only one of them is how a
#: reader ends up comparing a per-channel rate against this module's
#: depolarising ``p`` and concluding the platform contradicts itself.
#:
#: Exported only so callers comparing the two surfaces are told why they
#: differ; nothing in this module computes with either. See the module docstring.
DECODER_LAB_PHENOMENOLOGICAL_THRESHOLD = 0.029

#: The depolarising ``p`` the decoder lab's guide line is drawn at: 0.029 / (2/3).
DECODER_LAB_THRESHOLD_AS_DEPOLARISING_P = 0.029 / (2.0 / 3.0)

#: Seconds per surface-code cycle on superconducting hardware.
#:
#: A code cycle is a full round of syndrome extraction — order eight two-qubit
#: gates plus a measurement and reset. ~1 µs is the figure superconducting
#: roadmaps use. Trapped-ion cycles are 100–1000x longer, so an ion estimate
#: that leaves this at the default is wrong by that factor and will say the
#: wrong thing about runtime. Pass your own.
DEFAULT_CODE_CYCLE_SECONDS = 1e-6

#: Code cycles one logical operation costs, as a multiple of ``d``.
#:
#: A lattice-surgery merge-and-split takes ``d`` rounds of syndrome extraction
#: so that the measurement result is itself protected. Set to 1.0 (i.e. exactly
#: ``d`` cycles), which is the usual first-order accounting and ignores the
#: reaction-limited regime where clever scheduling does better.
CYCLES_PER_LOGICAL_OPERATION = 1.0

#: Physical qubits per surface-code tile, as a multiple of ``d*d``.
#:
#: A rotated distance-``d`` patch holds ``d*d`` data qubits and ``d*d - 1``
#: measure qubits. 2 is that, rounded up by one qubit per patch; at the
#: precision of this module the rounding is invisible.
QUBITS_PER_TILE_COEFFICIENT = 2

#: Ancilla/routing tiles as a fraction of data tiles.
#:
#: A stand-in for a layout, NOT a layout. Litinski's compact block spends
#: roughly one ancilla tile per two data tiles; his fast block spends more than
#: one per data tile and buys speed with it. 0.5 picks the frugal end, so the
#: estimate leans optimistic here too.
ROUTING_TILE_OVERHEAD = 0.5

#: Tiles occupied by one bottom-level 15-to-1 distillation unit.
#:
#: Litinski (2019) tabulates footprints of roughly 10–15 tiles for 15-to-1
#: units depending on the ``(d_X, d_Z, d_m)`` variant and how the output is
#: routed out. 12 is the middle of that range, picked by eye. **It was not
#: re-derived for this module and should not be quoted as if it were.** It is
#: also charged at the ALGORITHM distance, whereas real factories run their
#: first level at a lower distance — so this over-counts single-level factories
#: and under-counts the plumbing of multi-level ones.
FACTORY_TILES_PER_UNIT = 12

#: Code cycles one 15-to-1 unit takes to emit one output state, as a multiple
#: of ``d``. Around 6 in Litinski's tables; same caveat as the tile count.
FACTORY_CYCLES_PER_STATE = 6.0

#: Output error of one 15-to-1 round given input error ``p``: ``35 * p**3``.
#:
#: The leading term of the Bravyi–Kitaev 15-to-1 protocol, which fails only if
#: three or more of the fifteen inputs are faulty (there are 35 weight-3
#: error patterns it cannot correct). Ignores the error the distillation
#: CIRCUIT itself contributes, which is why real factories need their own
#: nontrivial code distance.
DISTILLATION_COEFFICIENT = 35.0
DISTILLATION_EXPONENT = 3

#: Most distillation levels to stack before declaring the target unreachable.
MAX_DISTILLATION_LEVELS = 4

#: Most factories to build when ``factory_count`` is left to auto-balance.
#:
#: Arbitrary. It exists so that a T-heavy circuit with a shallow logical depth
#: cannot silently turn the factory footprint into the entire answer — past
#: this point the estimate reports a distillation-limited runtime instead of
#: hiding the bottleneck inside a bigger machine.
MAX_AUTO_FACTORIES = 16

#: Relative slack when asking "does this distance meet the target?".
#:
#: p_L is evaluated in binary floating point, and the COMMON case lands exactly
#: on the boundary in real arithmetic and a few ulps above it in binary: a round
#: target like 1e-12 at the round ratio p/p_th = 0.1 gives
#: ``0.1 * 0.1**11 == 1.0000000000000006e-12``. Compared with a bare ``<=`` that
#: correct distance is REJECTED and the next rung up is returned — d = 23 where
#: d = 21 is right, which is a 20% over-count of physical qubits (they go as
#: d^2) manufactured entirely by binary representation, plus a tenfold
#: over-suppression of error nobody asked for.
#:
#: The rejected alternative was to round the exponent instead of the comparison.
#: That hides the same problem one layer down and breaks on non-round ratios.
#: One part in 10^9 is some eight orders of magnitude below this module's own
#: stated precision, so the slack cannot mask a real shortfall.
#:
#: Consequence worth knowing: ``budget.qec_achieved`` can therefore exceed
#: ``budget.qec_allocated`` by up to this fraction. That is representation
#: noise, not a budget violation.
DISTANCE_ACCEPTANCE_TOLERANCE = 1e-9

#: Largest code distance this module will return rather than refuse.
#:
#: Serious proposals live at d = 15–35. A request that needs d > 101 is not a
#: machine anybody is designing; returning the number would dress up "this does
#: not work" as an engineering answer.
MAX_DISTANCE = 101

#: T gates charged per arbitrary single-qubit rotation, as
#: ``ROTATION_T_SLOPE * log2(1/eps) + ROTATION_T_INTERCEPT``.
#:
#: Ross and Selinger's optimal-ancilla-free synthesis costs about
#: ``3 log2(1/eps)`` T gates plus lower-order terms. The intercept here is a
#: flat pad for those terms, chosen for roundness, not fitted.
ROTATION_T_SLOPE = 3.0
ROTATION_T_INTERCEPT = 10.0

#: T gates charged per Toffoli, using the measurement-assisted construction
#: (4 T) rather than the textbook decomposition (7 T).
T_GATES_PER_TOFFOLI = 4

#: Gate names that are Clifford (free under a surface code) or not gates at all.
_CLIFFORD_OR_FREE = frozenset(
    {
        "i",
        "id",
        "x",
        "y",
        "z",
        "h",
        "s",
        "sdg",
        "sx",
        "sxdg",
        "cx",
        "cz",
        "cy",
        "swap",
        "iswap",
        "ecr",
        "barrier",
        "measure",
        "reset",
        "delay",
        "snapshot",
    }
)

#: Gate names charged as one T state each.
_T_LIKE = frozenset({"t", "tdg"})

#: Gate names charged as a Toffoli.
_TOFFOLI_LIKE = frozenset({"ccx", "ccz", "cswap", "rccx"})

#: Gate names charged as an arbitrary rotation needing synthesis.
_ROTATION_LIKE = frozenset(
    {
        "rx", "ry", "rz", "p", "u1", "u2", "u3", "u",
        "crx", "cry", "crz", "cp", "cu1",
        "rxx", "ryy", "rzz", "rzx",
    }
)


class ResourceEstimateError(ValueError):
    """The requested estimate is outside the model's domain.

    A ``ValueError`` so the routers' existing ``_guard`` maps it to a 400
    without a new branch: every one of these is a caller input the model cannot
    honestly answer for, not an internal fault.
    """


def logical_error_per_cycle(
    distance: int,
    physical_error_rate: float,
    *,
    threshold: float = SURFACE_CODE_THRESHOLD,
    prefactor: float = LOGICAL_ERROR_PREFACTOR,
) -> float:
    """Probability one logical qubit fails in one code cycle.

    Evaluates ``A * (p / p_th) ** ((d + 1) / 2)``, the fitted form from Fowler
    et al. (2012). Below threshold this falls off exponentially in ``d``; at or
    above threshold it does not fall off at all, which is why the callers in
    this module refuse that regime instead of solving for ``d``.

    Args:
        distance: Code distance ``d``. Must be an odd integer of at least 3;
            the exponent ``(d+1)/2`` is only equal to ``⌊(d+1)/2⌋`` for odd
            ``d``, and even distances buy nothing anyway.
        physical_error_rate: Circuit-level depolarising error rate ``p``.
        threshold: Threshold ``p_th``. Defaults to
            :data:`SURFACE_CODE_THRESHOLD`.
        prefactor: Fitted constant ``A``. Defaults to
            :data:`LOGICAL_ERROR_PREFACTOR`.

    Returns:
        The per-logical-qubit, per-cycle logical error probability. This is a
        fitted extrapolation, not a measured quantity, and it is unreliable
        within a factor of a few of the threshold where the fit was never good.

    Raises:
        ResourceEstimateError: If ``distance`` is not an odd integer >= 3, or
            if ``physical_error_rate`` or ``threshold`` is not positive.
    """
    if not isinstance(distance, int) or distance < 3 or distance % 2 == 0:
        raise ResourceEstimateError(
            f"distance must be an odd integer of at least 3, got {distance!r}"
        )
    if physical_error_rate <= 0:
        raise ResourceEstimateError(
            f"physical_error_rate must be positive, got {physical_error_rate!r}"
        )
    if threshold <= 0:
        raise ResourceEstimateError(f"threshold must be positive, got {threshold!r}")

    return prefactor * (physical_error_rate / threshold) ** ((distance + 1) / 2)


def required_distance(
    *,
    target_logical_error: float,
    physical_error_rate: float,
    threshold: float = SURFACE_CODE_THRESHOLD,
    prefactor: float = LOGICAL_ERROR_PREFACTOR,
    max_distance: int = MAX_DISTANCE,
) -> int:
    """Smallest odd code distance whose per-cycle logical error meets a target.

    Inverts :func:`logical_error_per_cycle` analytically and then confirms the
    answer by evaluating it, rather than trusting the algebra near the rounding
    boundary: ``(d+1)/2`` is an integer step, so a floating-point solve that
    lands at 12.0000001 must round to 13 and not to 25.

    Args:
        target_logical_error: The per-logical-qubit, per-code-cycle error the
            caller can tolerate. Must be in ``(0, 1)``.
        physical_error_rate: Circuit-level depolarising error rate ``p``. Must
            be strictly below ``threshold``.
        threshold: Threshold ``p_th``. Defaults to
            :data:`SURFACE_CODE_THRESHOLD`.
        prefactor: Fitted constant ``A``.
        max_distance: Refuse rather than return a distance above this.

    Returns:
        An odd ``d >= 3``.

    Raises:
        ResourceEstimateError: If ``physical_error_rate`` is at or above the
            threshold — above threshold a bigger code is a WORSE code, so
            there is no ``d`` to return and returning a very large one would be
            an outright lie. Also raised if the target is not in ``(0, 1)`` or
            if no ``d <= max_distance`` reaches it.
    """
    if not 0.0 < target_logical_error < 1.0:
        raise ResourceEstimateError(
            f"target_logical_error must be in (0, 1), got {target_logical_error!r}"
        )
    # NaN first: every comparison with NaN is False, so a NaN would slip past
    # both guards below and only surface as "cannot convert float NaN to
    # integer" from math.ceil in the seed, which names neither the field nor the
    # caller's mistake.
    if not math.isfinite(physical_error_rate):
        raise ResourceEstimateError(
            f"physical_error_rate must be a finite number, got {physical_error_rate!r}"
        )
    if not math.isfinite(threshold):
        raise ResourceEstimateError(
            f"threshold must be a finite number, got {threshold!r}"
        )
    if physical_error_rate <= 0:
        raise ResourceEstimateError(
            f"physical_error_rate must be positive, got {physical_error_rate!r}"
        )
    if physical_error_rate >= threshold:
        raise ResourceEstimateError(
            f"physical_error_rate {physical_error_rate:.4g} is at or above the "
            f"surface-code threshold {threshold:.4g}; below threshold a larger "
            "code suppresses errors, at or above it a larger code amplifies "
            "them, so no code distance achieves the target. Improve the "
            "physical error rate first."
        )

    ratio = physical_error_rate / threshold
    # Analytic seed: A * ratio^((d+1)/2) <= target  ->  (d+1)/2 >= log(target/A)/log(ratio).
    # log(ratio) < 0 because ratio < 1, so the inequality flips on division.
    exponent = math.log(target_logical_error / prefactor) / math.log(ratio)
    # 2*ceil(x) - 1 is always odd, so no parity correction is needed here.
    seed = 2 * math.ceil(max(exponent, 1.0)) - 1
    # Start ONE RUNG BELOW the analytic seed and let the verification walk
    # settle it. The division above is itself inexact: for a round target at a
    # round ratio it returns 11.000000000000002 where 11 is exact, ceil rounds
    # that to 12 and the seed lands at d = 23 when d = 21 is correct. Since the
    # walk only ever moves UP, an overshooting seed is permanent — so the seed
    # must be biased low and verified, not biased high and trusted. The extra
    # rung costs one evaluation of a closed-form expression.
    distance = max(3, seed - 2)

    # Walk up from the seed. Two steps at most in practice; the loop exists so
    # a floating-point seed that lands one rung low cannot return a distance
    # that silently misses the target.
    #
    # The comparison carries DISTANCE_ACCEPTANCE_TOLERANCE because the seed is
    # not the only thing floating point disturbs: on a round target at a round
    # ratio, p_L(d) lands a few ulps ABOVE a target it exactly equals in real
    # arithmetic, and a bare `<=` then walks past the correct distance to the
    # next rung. See that constant for the worked case.
    acceptable = target_logical_error * (1.0 + DISTANCE_ACCEPTANCE_TOLERANCE)
    while distance <= max_distance:
        if logical_error_per_cycle(
            distance, physical_error_rate, threshold=threshold, prefactor=prefactor
        ) <= acceptable:
            return distance
        distance += 2

    raise ResourceEstimateError(
        f"no code distance at or below {max_distance} reaches a per-cycle logical "
        f"error of {target_logical_error:.3g} at p = {physical_error_rate:.3g}. "
        "The physical error rate is too close to threshold, or the error budget "
        "is too tight for this many logical operations."
    )


def distillation_levels(
    *,
    target_state_error: float,
    physical_error_rate: float,
    coefficient: float = DISTILLATION_COEFFICIENT,
    exponent: int = DISTILLATION_EXPONENT,
    max_levels: int = MAX_DISTILLATION_LEVELS,
) -> tuple[int, float]:
    """Levels of 15-to-1 distillation needed to reach a magic-state error.

    Each level maps input error ``e`` to ``coefficient * e**exponent``. This
    models the protocol's *logical* failure only; it charges nothing for the
    errors the distillation circuit itself introduces, which in a real design
    is what forces the factory to run at its own nontrivial code distance.
    Level counts from this function are therefore a floor, not a figure.

    Args:
        target_state_error: Error each consumed magic state may carry.
        physical_error_rate: Error of the raw injected state, taken to equal
            the physical gate error. Real state injection is typically WORSE
            than the gate error, so this is optimistic.
        coefficient: The ``35`` in ``35 p^3``.
        exponent: The ``3`` in ``35 p^3``.
        max_levels: Refuse beyond this many levels.

    Returns:
        ``(levels, achieved_error)``. ``levels`` is 0 when the raw state
        already meets the target — which happens only for very loose budgets
        and is worth noticing rather than hiding behind a mandatory level.

    Raises:
        ResourceEstimateError: If the target is unreachable within
            ``max_levels``, or if either input is not positive.
    """
    if target_state_error <= 0:
        raise ResourceEstimateError(
            f"target_state_error must be positive, got {target_state_error!r}"
        )
    if physical_error_rate <= 0:
        raise ResourceEstimateError(
            f"physical_error_rate must be positive, got {physical_error_rate!r}"
        )

    error = physical_error_rate
    for level in range(max_levels + 1):
        if error <= target_state_error:
            return level, error
        error = coefficient * error**exponent

    raise ResourceEstimateError(
        f"magic states of error {target_state_error:.3g} are out of reach: "
        f"{max_levels} levels of 15-to-1 distillation from p = "
        f"{physical_error_rate:.3g} reach only {error:.3g}. Distillation "
        "converges only when 35*p^2 < 1, so a physical error rate near or "
        "above ~17% never distils at all."
    )


def estimate_resources(
    *,
    algorithm_qubits: int,
    t_count: int,
    logical_depth: int,
    physical_error_rate: float = 1e-3,
    target_total_error: float = 1e-2,
    code_cycle_seconds: float = DEFAULT_CODE_CYCLE_SECONDS,
    factory_count: int | None = None,
    model_magic_states: bool = True,
    threshold: float = SURFACE_CODE_THRESHOLD,
    prefactor: float = LOGICAL_ERROR_PREFACTOR,
) -> dict[str, Any]:
    """Estimate the fault-tolerant cost of an algorithm, to an order of magnitude.

    The budget is split in two: half to topological (surface-code) failure and
    half to magic-state distillation, the even split being conventional rather
    than optimal. The code distance is then found by fixed point, because the
    number of code cycles depends on ``d`` (each logical operation costs ``d``
    cycles, each magic state ``FACTORY_CYCLES_PER_STATE * d``) while ``d``
    depends on the number of code cycles — iterating is honest about that
    circularity where a single closed-form pass would hide it.

    The topological budget is charged over the WHOLE runtime, distillation
    stalls included, because the logical qubits are live and failing while the
    algorithm waits for magic states.

    Args:
        algorithm_qubits: Logical qubits the algorithm needs, ancillas
            included. Must be at least 1.
        t_count: Non-Clifford gates, each consuming one distilled magic state.
            May be 0, in which case no factory is built and the estimate is
            purely topological.
        logical_depth: Sequential logical operations — the critical path, not
            the total gate count. If you only have a total, you are
            over-estimating runtime by however much parallelism the algorithm
            has. Must be at least 1.
        physical_error_rate: Circuit-level depolarising error rate ``p``, one
            number for the whole device. Must be strictly below ``threshold``.
        target_total_error: Probability the whole computation is allowed to
            fail. Must be in ``(0, 1)``.
        code_cycle_seconds: Wall-clock seconds per syndrome-extraction round.
            The superconducting default is wrong for ions by two to three
            orders of magnitude.
        factory_count: Magic-state factories to build. ``None`` auto-balances
            so distillation roughly keeps pace with the algorithm, capped at
            :data:`MAX_AUTO_FACTORIES`.
        model_magic_states: When False, factories are omitted entirely and the
            whole budget goes to the code. Useful for a Clifford-only circuit
            or for isolating the topological term; the payload records that
            the T cost was excluded so the number cannot be mistaken for a
            full estimate.
        threshold: Surface-code threshold ``p_th``.
        prefactor: Fitted constant ``A``.

    Returns:
        A JSON-safe dict. The load-bearing keys:

        * ``code_distance`` — odd ``d``.
        * ``physical_qubits_per_logical`` — ``2 * d * d``.
        * ``physical_qubits`` — total, including routing and factories.
        * ``runtime_seconds`` — and ``runtime_human``, ``code_cycles``.
        * ``magic_states`` — distillation levels, factory count and footprint.
        * ``budget`` — how ``target_total_error`` was split and what was
          actually achieved.
        * ``assumptions`` — every constant that went into the arithmetic, as
          data, so a caller can reproduce or challenge the number.
        * ``caveats`` — what the model ignores, in prose.
        * ``estimate_kind`` and ``disclaimer`` — the words
          "order of magnitude", carried in the payload so they survive being
          copied out of it.

    Raises:
        ResourceEstimateError: On any input outside the model's domain: a
            non-positive qubit count or depth, a negative T count, a
            ``physical_error_rate`` at or above threshold, a target error
            outside ``(0, 1)``, or a combination needing a distance above
            :data:`MAX_DISTANCE`.
    """
    if not isinstance(algorithm_qubits, int) or algorithm_qubits < 1:
        raise ResourceEstimateError(
            f"algorithm_qubits must be an integer of at least 1, got {algorithm_qubits!r}"
        )
    if not isinstance(t_count, int) or t_count < 0:
        raise ResourceEstimateError(
            f"t_count must be a non-negative integer, got {t_count!r}"
        )
    if not isinstance(logical_depth, int) or logical_depth < 1:
        raise ResourceEstimateError(
            f"logical_depth must be an integer of at least 1, got {logical_depth!r}"
        )
    if not 0.0 < target_total_error < 1.0:
        raise ResourceEstimateError(
            f"target_total_error must be in (0, 1), got {target_total_error!r}"
        )
    # Non-finite floats have to die here rather than downstream. A NaN
    # physical_error_rate passes every comparison below (every comparison with
    # NaN is False), reaches math.ceil inside required_distance and raises a bare
    # "cannot convert float NaN to integer" — a 500 with no field name in it. An
    # infinite or NaN code_cycle_seconds is worse: it does not raise at all, it
    # puts `Infinity` or `NaN` into runtime_seconds, and json.dumps emits those
    # as bare tokens that are not valid JSON and that JSON.parse in the browser
    # rejects. The payload must be serialisable by construction.
    for name, value in (
        ("physical_error_rate", physical_error_rate),
        ("code_cycle_seconds", code_cycle_seconds),
        ("threshold", threshold),
        ("prefactor", prefactor),
    ):
        if not math.isfinite(value):
            raise ResourceEstimateError(f"{name} must be a finite number, got {value!r}")
    if code_cycle_seconds <= 0:
        raise ResourceEstimateError(
            f"code_cycle_seconds must be positive, got {code_cycle_seconds!r}"
        )
    if factory_count is not None and (not isinstance(factory_count, int) or factory_count < 1):
        raise ResourceEstimateError(
            f"factory_count must be a positive integer or None, got {factory_count!r}"
        )
    # Checked here as well as inside required_distance so that the refusal
    # arrives before any of the arithmetic below, with the same message.
    if physical_error_rate >= threshold:
        raise ResourceEstimateError(
            f"physical_error_rate {physical_error_rate:.4g} is at or above the "
            f"surface-code threshold {threshold:.4g}; below threshold a larger "
            "code suppresses errors, at or above it a larger code amplifies "
            "them, so no code distance achieves the target. Improve the "
            "physical error rate first."
        )

    include_t = model_magic_states and t_count > 0
    # An even split. Not optimal — the optimum trades a smaller d against more
    # distillation levels and depends on the algorithm — but a documented
    # arbitrary split beats an undocumented clever one at this precision.
    qec_budget = target_total_error * (0.5 if include_t else 1.0)
    distillation_budget = target_total_error - qec_budget

    # Distillation levels are solved BEFORE the distance, and depend on neither
    # it nor the cycle count: the per-state target is set purely by the budget
    # and the T count. That is what lets the distance fixed point below price
    # the distillation schedule at each candidate d.
    levels = 0
    achieved_state_error = 0.0
    if include_t:
        levels, achieved_state_error = distillation_levels(
            target_state_error=distillation_budget / t_count,
            physical_error_rate=physical_error_rate,
        )

    distance, code_cycles, distillation_cycles, factories = _solve_distance(
        algorithm_qubits=algorithm_qubits,
        logical_depth=logical_depth,
        qec_budget=qec_budget,
        physical_error_rate=physical_error_rate,
        threshold=threshold,
        prefactor=prefactor,
        t_count=t_count if include_t else 0,
        levels=levels if include_t else 0,
        factory_count=factory_count,
    )

    qubits_per_logical = QUBITS_PER_TILE_COEFFICIENT * distance * distance
    data_tiles = algorithm_qubits
    routing_tiles = math.ceil(data_tiles * ROUTING_TILE_OVERHEAD)

    # A level-n factory is a tree: 15 level-(n-1) units feed each level-n unit,
    # so total units is the geometric sum (15^n - 1)/14. Fully pipelined reuse
    # would need fewer physical units than the tree; this over-counts
    # multi-level factories, which is the safe direction.
    units = (15**levels - 1) // 14 if include_t and levels else 0
    factory_tiles = factories * units * FACTORY_TILES_PER_UNIT

    total_tiles = data_tiles + routing_tiles + factory_tiles
    physical_qubits = total_tiles * qubits_per_logical

    # Distillation is assumed to overlap the computation perfectly, so the
    # runtime is the slower of the two rather than their sum. Perfect overlap
    # is optimistic: real schedules stall waiting for states.
    total_cycles = max(code_cycles, distillation_cycles)
    runtime_seconds = total_cycles * code_cycle_seconds

    # Charged over TOTAL_CYCLES, not over the algorithm's own cycles. Every
    # logical qubit is held — and error-corrected, and able to fail — for the
    # whole wall-clock life of the computation, including the stretch where the
    # algorithm is idle waiting on magic states. An earlier version of this
    # module charged only `code_cycles`; on a distillation-bound input (a T-heavy
    # shallow circuit) that under-reported the achieved logical error by six
    # orders of magnitude and returned a code distance that missed the budget
    # while the payload claimed it had been met. See `_solve_distance`.
    achieved_qec_error = (
        algorithm_qubits
        * total_cycles
        * logical_error_per_cycle(
            distance, physical_error_rate, threshold=threshold, prefactor=prefactor
        )
    )
    achieved_distillation_error = achieved_state_error * t_count if include_t else 0.0

    return {
        "estimate_kind": "order_of_magnitude",
        "disclaimer": (
            "Order-of-magnitude estimate from an analytic surface-code model. "
            "No part of this was measured on hardware. Read the numbers as "
            "powers of ten, not as figures with significant digits; see "
            "'caveats' for what the model ignores."
        ),
        "inputs": {
            "algorithm_qubits": algorithm_qubits,
            "t_count": t_count,
            "logical_depth": logical_depth,
            "physical_error_rate": physical_error_rate,
            "target_total_error": target_total_error,
            "code_cycle_seconds": code_cycle_seconds,
            "model_magic_states": model_magic_states,
        },
        "code_distance": distance,
        "physical_qubits_per_logical": qubits_per_logical,
        "physical_qubits": physical_qubits,
        "tiles": {
            "data": data_tiles,
            "routing": routing_tiles,
            "factories": factory_tiles,
            "total": total_tiles,
        },
        "code_cycles": total_cycles,
        "algorithm_code_cycles": code_cycles,
        "distillation_code_cycles": distillation_cycles,
        "runtime_seconds": runtime_seconds,
        "runtime_human": _human_duration(runtime_seconds),
        "bottleneck": (
            "distillation" if distillation_cycles > code_cycles else "algorithm"
        ),
        "magic_states": {
            "modelled": include_t,
            "states_required": t_count if include_t else 0,
            "distillation_levels": levels,
            "state_error_achieved": achieved_state_error,
            "factories": factories,
            "tiles_per_factory": (
                factory_tiles // factories if factories else 0
            ),
            "note": (
                (
                    "No distillation needed: the raw injected state error already "
                    "meets the per-state budget, so zero factories are built. Note "
                    "the T gates are then charged NO time and NO footprint at all, "
                    "which under-counts — a real machine still has to inject and "
                    "consume each state. Only very loose budgets or very small T "
                    "counts land here."
                    if levels == 0
                    else "15-to-1 distillation, p_out ~ 35 p_in^3. Factory "
                    "footprint and throughput are flat constants in the spirit of "
                    "Litinski (2019), not a derived layout."
                )
                if include_t
                else (
                    "No magic-state cost included: "
                    + ("t_count is 0." if t_count == 0 else "model_magic_states was False.")
                    + " This is a topological-only figure and is NOT a complete "
                    "estimate for a circuit containing non-Clifford gates."
                )
            ),
        },
        "budget": {
            "total_target": target_total_error,
            "split": "half topological, half distillation (conventional, not optimal)"
            if include_t
            else "all topological (no magic states modelled)",
            "qec_allocated": qec_budget,
            "qec_achieved": achieved_qec_error,
            "distillation_allocated": distillation_budget,
            "distillation_achieved": achieved_distillation_error,
            "total_achieved": achieved_qec_error + achieved_distillation_error,
        },
        "assumptions": {
            "logical_error_model": "p_L = A * (p / p_th) ^ ((d + 1) / 2)",
            "logical_error_model_source": (
                "Fowler, Mariantoni, Martinis, Cleland, Phys. Rev. A 86, 032324 "
                "(2012). A and p_th are FITTED to one decoder and one noise "
                "model; they are not derived and move with either."
            ),
            "surface_code_threshold": threshold,
            "logical_error_prefactor": prefactor,
            "qubits_per_tile": f"{QUBITS_PER_TILE_COEFFICIENT} * d^2 (rotated surface code)",
            "cycles_per_logical_operation": f"{CYCLES_PER_LOGICAL_OPERATION} * d (lattice surgery)",
            "routing_tile_overhead": ROUTING_TILE_OVERHEAD,
            "code_cycle_seconds": code_cycle_seconds,
            "distillation_protocol": "15-to-1, p_out = 35 * p_in^3 (Bravyi-Kitaev 2005)",
            "factory_tiles_per_unit": FACTORY_TILES_PER_UNIT,
            "factory_cycles_per_state": f"{FACTORY_CYCLES_PER_STATE} * d",
            "max_auto_factories": MAX_AUTO_FACTORIES,
            "max_distance": MAX_DISTANCE,
            "decoder_lab_threshold_per_channel": (
                DECODER_LAB_PHENOMENOLOGICAL_THRESHOLD
            ),
            "decoder_lab_threshold_depolarising_p": (
                DECODER_LAB_THRESHOLD_AS_DEPOLARISING_P
            ),
            "decoder_lab_threshold_note": (
                "/workbench/decoder-lab holds a per-channel threshold of 2.9% and "
                "draws its guide line at the equivalent depolarising p of ~4.35% "
                "(it divides by channelRate(1) = 2/3), because it simulates "
                "phenomenological noise (data depolarising plus measurement "
                "flips). This module uses 1% because resource estimation must "
                "assume circuit-level noise, where every gate and idle step inside "
                "syndrome extraction is a noise location. The numbers are "
                "thresholds of different models under different conventions, not a "
                "contradiction."
            ),
        },
        "caveats": [
            "Order of magnitude only. Do not quote these digits.",
            "Layout and routing are one flat multiplier, not a layout. Real "
            "compact-versus-fast block choices move the qubit count by 2-3x.",
            "The physical error rate is a single number for the whole device. "
            "Real devices have a worst qubit, and the distance is set by it.",
            "Magic-state factory tile counts and cycle counts are flat "
            "constants taken by eye from the literature, not re-derived, and "
            "are charged at the algorithm's code distance rather than the "
            "lower distance a real first-level factory would use.",
            "The threshold and prefactor are fitted constants, not physics. "
            "Near threshold the fit was never accurate and neither is this.",
            "The (A = 0.1, p_th = 1%) pair is the round one the resource-"
            "estimation literature quotes, not Fowler et al.'s own (0.03, "
            "0.57%). Their pair needs d = 27 where this module says 21 for a "
            "1e-12 target at p = 1e-3, so these qubit counts are roughly 1.6x "
            "OPTIMISTIC against the paper they cite. Treat them as a floor.",
            "Distillation is assumed to overlap the computation perfectly and "
            "the decoder is assumed to keep up with the syndrome stream. "
            "Both are optimistic; real schedules stall.",
            "Control electronics, cryogenics, wiring and classical decoding "
            "hardware are not counted at all, and often dominate real cost.",
        ],
    }


def _distillation_schedule(
    *,
    t_count: int,
    levels: int,
    distance: int,
    algorithm_cycles: int,
    factory_count: int | None,
) -> tuple[int, int]:
    """Factories to build and code cycles they take, at one candidate distance.

    Split out of :func:`estimate_resources` because the distance fixed point has
    to evaluate it at every candidate ``d``: a factory's throughput is
    ``FACTORY_CYCLES_PER_STATE * d`` cycles per state, so the distillation time
    grows with the very distance it helps determine.

    Args:
        t_count: Magic states the algorithm consumes.
        levels: Distillation levels from :func:`distillation_levels`. Zero means
            the raw injected state already met the budget, so no factory is
            built AND NO TIME IS CHARGED for the T gates — see the caveat in
            :func:`estimate_resources`, because that is an under-count.
        distance: Candidate code distance.
        algorithm_cycles: Code cycles the algorithm itself takes, used only to
            size the auto-balanced factory count.
        factory_count: Caller's fixed factory count, or ``None`` to auto-balance.

    Returns:
        ``(factories, distillation_cycles)``. Both are 0 when no distillation is
        performed.
    """
    if t_count <= 0 or levels <= 0:
        return 0, 0

    cycles_per_state = FACTORY_CYCLES_PER_STATE * distance
    if factory_count is not None:
        factories = factory_count
    else:
        # Auto: enough factories that distillation is not the bottleneck,
        # capped so a T-heavy shallow circuit cannot inflate the machine
        # without limit. Past the cap the caller reports the distillation
        # bottleneck instead of hiding it.
        #
        # Note this ratio is independent of `distance`: both the numerator
        # (cycles per state, ~d) and the denominator (algorithm cycles, ~d)
        # scale linearly in it. That is what keeps the fixed point below
        # monotone and therefore convergent.
        needed = math.ceil(t_count * cycles_per_state / max(algorithm_cycles, 1))
        factories = max(1, min(needed, MAX_AUTO_FACTORIES))

    return factories, math.ceil(t_count * cycles_per_state / factories)


def _solve_distance(
    *,
    algorithm_qubits: int,
    logical_depth: int,
    qec_budget: float,
    physical_error_rate: float,
    threshold: float,
    prefactor: float,
    t_count: int,
    levels: int,
    factory_count: int | None,
) -> tuple[int, int, int, int]:
    """Find the code distance and cycle counts that are consistent with each other.

    ``d`` depends on the number of code cycles (more cycles, more chances to
    fail, so a bigger code) and the number of code cycles depends on ``d``
    (each logical operation takes ``d`` rounds, and each magic state takes
    ``FACTORY_CYCLES_PER_STATE * d``). A single pass with a guessed ``d`` would
    silently under-count. Iterating to a fixed point is a few lines and makes
    the circularity visible.

    The distance is solved against the TOTAL runtime — ``max(algorithm,
    distillation)`` — not against the algorithm's own cycles. The logical qubits
    are live and failing for the whole wall-clock duration, so a
    distillation-bound circuit needs the bigger code that its stall time
    demands. Solving against the algorithm term alone is the rejected
    alternative: it is simpler and it silently under-protects exactly the
    T-heavy circuits that most need protecting.

    The map is monotone (a larger ``d`` gives more cycles, a tighter per-cycle
    target and so a larger candidate ``d``), so it converges from below in two
    or three steps.

    Args:
        algorithm_qubits: Logical qubits held for the whole computation.
        logical_depth: Sequential logical operations.
        qec_budget: Failure probability allotted to topological error.
        physical_error_rate: ``p``.
        threshold: ``p_th``.
        prefactor: ``A``.
        t_count: Magic states consumed, or 0 when they are not modelled.
        levels: Distillation levels, or 0 when none are performed.
        factory_count: Fixed factory count, or ``None`` to auto-balance.

    Returns:
        ``(distance, algorithm_cycles, distillation_cycles, factories)``, all
        consistent with each other.

    Raises:
        ResourceEstimateError: If no distance at or below :data:`MAX_DISTANCE`
            satisfies the budget, or if the iteration fails to settle (it has
            never been observed to, since the map is monotone, but a silent
            wrong answer would be worse than a loud one).
    """
    distance = 3
    for _ in range(64):
        algorithm_cycles = max(
            1, math.ceil(logical_depth * CYCLES_PER_LOGICAL_OPERATION * distance)
        )
        factories, distillation_cycles = _distillation_schedule(
            t_count=t_count,
            levels=levels,
            distance=distance,
            algorithm_cycles=algorithm_cycles,
            factory_count=factory_count,
        )
        total_cycles = max(algorithm_cycles, distillation_cycles)
        # No "budget so loose no code is needed" branch: qec_budget is below 1
        # by construction and algorithm_qubits * total_cycles is at least 3, so
        # the per-cycle target is always below 1/3 and required_distance always
        # has work to do. An earlier version carried that branch; it was dead
        # code that told the reader about a regime the module cannot enter.
        candidate = required_distance(
            target_logical_error=qec_budget / (algorithm_qubits * total_cycles),
            physical_error_rate=physical_error_rate,
            threshold=threshold,
            prefactor=prefactor,
        )
        if candidate <= distance:
            return distance, algorithm_cycles, distillation_cycles, factories
        distance = candidate

    raise ResourceEstimateError(
        "code distance did not converge; the requested budget sits on a "
        "boundary this model cannot resolve. Loosen target_total_error or "
        "improve physical_error_rate."
    )


def _human_duration(seconds: float) -> str:
    """Render a duration in the largest unit that keeps it above 1.

    Runtimes here span microseconds to millennia, and "3.2e+11 seconds" tells a
    reader nothing about whether the algorithm is practical. "10100 years"
    does.

    Args:
        seconds: A non-negative, finite duration.

    Returns:
        A short human-readable string. Three significant figures, rendered
        without an exponent inside a band: ``{:.2g}`` was the rejected
        alternative because it renders 500 us as "5e+02 us", which is the exact
        notation this function exists to avoid. Only the years band can exceed
        four digits, and there an exponent is the readable choice.
    """
    for limit, scale, unit in (
        (1e-3, 1e6, "us"),
        (1.0, 1e3, "ms"),
        (60.0, 1.0, "s"),
        (3600.0, 1 / 60, "min"),
        (86400.0, 1 / 3600, "hours"),
        (31557600.0, 1 / 86400, "days"),
    ):
        if seconds < limit:
            return f"{_plain_three_sig_figs(seconds * scale)} {unit}"
    return f"{seconds / 31557600:.3g} years"


def _plain_three_sig_figs(value: float) -> str:
    """Render a non-negative number to three significant figures, never in exponent form.

    Args:
        value: A finite, non-negative number.

    Returns:
        A decimal string with no exponent and no trailing zeros, e.g. ``"500"``,
        ``"1.1"``, ``"0.001"``.
    """
    if value <= 0:
        return "0"
    decimals = max(0, 2 - int(math.floor(math.log10(value))))
    text = f"{value:.{decimals}f}"
    # Strip trailing zeros only after a decimal point. A bare `.rstrip("0")`
    # turns "500" into "5" — the zeros there are significant digits, not
    # padding, and that silently divides the rendered duration by a hundred.
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text or "0"


def logical_counts_from_qasm(
    qasm: str, *, rotation_synthesis_error: float = 1e-10
) -> dict[str, Any]:
    """Read logical qubit count, T count and depth out of a circuit.

    A convenience for callers who have a circuit rather than three integers.
    The T count is the interesting part and the approximate part:

    * ``t`` and ``tdg`` cost one magic state each.
    * Toffoli-like gates cost :data:`T_GATES_PER_TOFFOLI`.
    * An arbitrary rotation (``rz``, ``rx``, ``u``, ...) has no exact
      Clifford+T form and must be SYNTHESISED, at about
      ``3 log2(1/eps) + c`` T gates. Every rotation is charged that price
      regardless of its angle, so a circuit full of ``rz(pi/2)`` — which is
      Clifford and free — is over-charged. Transpile to a Clifford+T basis
      first if that matters.
    * Everything Clifford is free, which is the whole point of the surface
      code.

    The depth returned is the circuit's gate depth, used as a stand-in for
    logical depth. That over-states the critical path for a circuit whose
    logical operations parallelise and under-states it for one whose T layers
    serialise. It is the cheapest honest proxy, not a measurement.

    Args:
        qasm: OpenQASM 3 (or 2) source.
        rotation_synthesis_error: Per-rotation synthesis error budget used to
            price arbitrary rotations. Tightening it raises the T count
            logarithmically.

    Returns:
        ``{"algorithm_qubits", "t_count", "logical_depth", "gate_counts",
        "t_count_breakdown", "approximations"}`` — the last being the prose
        list of what the T count assumed, so it travels with the number.

    Raises:
        ResourceEstimateError: If the source cannot be parsed, or if
            ``rotation_synthesis_error`` is not in ``(0, 1)``.
    """
    if not 0.0 < rotation_synthesis_error < 1.0:
        raise ResourceEstimateError(
            "rotation_synthesis_error must be in (0, 1), got "
            f"{rotation_synthesis_error!r}"
        )

    # Imported here, not at module scope: the arithmetic above is pure Python
    # and this module is imported by tests and tools that have no reason to
    # pay for a Qiskit import to call estimate_resources with three integers.
    from app.quantum.runner import parse_qasm

    try:
        circuit = parse_qasm(qasm)
    except ValueError as exc:
        raise ResourceEstimateError(f"could not parse the circuit: {exc}") from exc

    counts = {str(name): int(n) for name, n in circuit.count_ops().items()}
    per_rotation = math.ceil(
        ROTATION_T_SLOPE * math.log2(1.0 / rotation_synthesis_error) + ROTATION_T_INTERCEPT
    )

    direct = sum(n for name, n in counts.items() if name in _T_LIKE)
    toffoli = sum(n for name, n in counts.items() if name in _TOFFOLI_LIKE)
    rotations = sum(n for name, n in counts.items() if name in _ROTATION_LIKE)
    unknown = sorted(
        name
        for name in counts
        if name not in _T_LIKE
        and name not in _TOFFOLI_LIKE
        and name not in _ROTATION_LIKE
        and name not in _CLIFFORD_OR_FREE
    )
    # An unrecognised gate is charged as one rotation rather than as free. A
    # missed non-Clifford gate would drop real cost silently, which is the
    # failure this module most needs to avoid; over-charging a gate that turns
    # out to be Clifford is at least visible in `unrecognised_gates`.
    #
    # This is NOT a safe over-estimate in general, and saying otherwise would be
    # the dishonest version. One rotation's worth is an under-charge for any
    # multi-controlled gate: a `c3x` decomposes into several Toffolis and an
    # `mcx` over ten controls into far more, all priced here as a single
    # ~100-T rotation. Transpile to a basis this module knows before trusting a
    # T count whose `unrecognised_gates` list is non-empty.
    unknown_instances = sum(counts[name] for name in unknown)

    t_count = (
        direct
        + toffoli * T_GATES_PER_TOFFOLI
        + (rotations + unknown_instances) * per_rotation
    )

    return {
        "algorithm_qubits": int(circuit.num_qubits),
        "t_count": int(t_count),
        "logical_depth": int(circuit.depth()),
        "gate_counts": counts,
        "t_count_breakdown": {
            "direct_t_gates": direct,
            "toffoli_gates": toffoli,
            "t_per_toffoli": T_GATES_PER_TOFFOLI,
            "rotations": rotations,
            "t_per_rotation": per_rotation,
            "rotation_synthesis_error": rotation_synthesis_error,
            "unrecognised_gates": unknown,
            "unrecognised_instances": unknown_instances,
        },
        "approximations": [
            "Every arbitrary rotation is charged "
            f"{per_rotation} T gates (Ross-Selinger scaling, ~3 log2(1/eps)), "
            "regardless of angle. Clifford angles such as rz(pi/2) are free in "
            "reality and are over-charged here; transpile to Clifford+T first "
            "if that matters.",
            "Gates this module does not recognise are charged as ONE rotation "
            "each, not as free, so an unknown non-Clifford gate cannot silently "
            "vanish from the estimate. That is not a safe over-estimate: a "
            "multi-controlled gate such as c3x or mcx decomposes into many "
            "Toffolis and is UNDER-charged here. If 'unrecognised_gates' is "
            "non-empty, transpile to a Clifford+T basis before trusting the "
            "T count.",
            "logical_depth is the circuit's gate depth, used as a proxy for "
            "the fault-tolerant critical path. It is not a measurement of one.",
        ],
    }
