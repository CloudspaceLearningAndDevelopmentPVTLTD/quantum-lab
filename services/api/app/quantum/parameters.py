"""Free parameters in a circuit, and bounded sweeps over them.

WHY THIS MODULE EXISTS
----------------------
A single circuit at a single parameter point is not an experiment. The things
people actually run — a Bloch-angle scan, a VQE ansatz landscape, a Trotter
step-count study — are the *same* circuit evaluated at many points. Before this
module the only way to express that here was N separate submissions: N queue
positions, N quota units, and on Braket N x $0.30 in per-task fees for what the
vendor would have run as one task.

The Qiskit side is free. Both V2 primitives take a parameter-value array in the
pub — ``sampler.run([(isa_circuit, values)])`` — and evaluate every row of it
inside one job. What was missing was everything on this side of the wire:
parsing a circuit that still has free parameters, validating a sweep
specification, and building the value array in the one order that is correct.

HOW FAR THE ONE-JOB SAVING HAS ACTUALLY BEEN CHECKED — READ THIS BEFORE QUOTING
------------------------------------------------------------------------------
VERIFIED: the V2 pub parameter-array contract, against ``qiskit.primitives``
(``StatevectorSampler`` and ``StatevectorEstimator``) in
``tests/test_parameters.py``. That is the same pub contract ``SamplerV2`` and
``EstimatorV2`` implement on IBM hardware through Qiskit Runtime, so the
one-job claim is well founded FOR IBM and is still an inference rather than an
observation: nothing here has been through an IBM queue.

NOT VERIFIED, AND DO NOT ADVERTISE: that Amazon Braket (IonQ, Rigetti) or Azure
Quantum accepts a multi-point parameter array as a SINGLE task. Braket binds
its OpenQASM ``inputs`` per task, so a sweep on Braket may well still be N tasks
and N x $0.30 in per-task fees. Nothing in this module assumes otherwise — it
builds arrays and counts points, it does not submit — but
:func:`estimate_sweep_cost`'s
``estimated_usd_if_submitted_separately`` is arithmetic on rates the caller
supplies, NOT a claim that the saving is realised on the vendor in question.
Somebody has to check Braket and Azure before that number is shown to a user as
a saving rather than as a comparison.

THE ORDER IS THE WHOLE GAME
---------------------------
``QuantumCircuit.parameters`` is sorted ALPHABETICALLY BY NAME, not by order of
appearance in the source. A circuit written::

    input float[64] theta;   // declared first
    input float[64] alpha;   // declared second
    rz(theta) q[0];
    rx(alpha) q[0];

binds ``values[0]`` to **alpha** and ``values[1]`` to **theta**. An
implementation that reads the ``input`` declarations in source order and emits
values in that order is wrong, and it is wrong in the worst available way: the
job succeeds, every shot comes back, and the numbers are a perfectly plausible
scan of a landscape nobody asked about. There is no way to detect it from the
result. That is why this module never passes positional values around — a sweep
point is a ``{name: value}`` dict right up until :func:`sweep_values` projects
it through the circuit's own parameter order, and why
``tests/test_parameters.py`` pins the alphabetical-vs-source-order case against
a real simulator rather than against an assertion about Qiskit's internals.

WHICH SPELLINGS ARE SUPPORTED, AND WHICH ARE NOT
------------------------------------------------
1. **OpenQASM 3 ``input`` declarations — supported, and the recommended form.**
   ``input float[64] theta;`` is the spelling the OpenQASM 3 specification has
   for exactly this, and ``qiskit-qasm3-import`` (already a hard dependency of
   this service; see :func:`app.quantum.runner.parse_qasm`) turns each one into
   a ``Parameter``. Arithmetic in the angle works too: ``rz(2*theta + pi/4)``
   parses into a ``ParameterExpression``. Nothing needed inventing, so nothing
   was invented.

2. **``{theta}`` placeholders — supported, as a convenience, by rewriting.**
   Templating a circuit by string interpolation is what people reach for first,
   and refusing it would mean a caller who already has ``rz({theta}) q[0];``
   must learn a declaration syntax to use the feature. :func:`normalise_inputs`
   rewrites ``{theta}`` to ``theta`` and injects the matching ``input`` line, so
   this route is a thin pre-pass over route 1 rather than a second parser.
   BE AWARE that the rewrite is TEXTUAL and its real rule is "every
   ``{identifier}`` anywhere in the source", which is wider than the comment
   case it is tempting to describe it as. Two consequences, both observed:

   * A ``{theta}`` inside a ``//`` or ``/* */`` comment is substituted too.
     Harmless — a comment stays a comment.
   * A legal OpenQASM 3 SET LITERAL of a single identifier is mangled.
     ``for int i in {a} { ... }`` is rewritten to ``for int i in a { ... }``
     and picks up a spurious ``input float[64] a;``. That source is valid
     OpenQASM 3 and this module corrupts it. It is not detected and not
     refused.

   So the placeholder convention is DEFINED ONLY for gate-angle position. A
   caller whose circuit contains braces anywhere else should use route 1 and
   declare its inputs. The narrower fix — a real tokeniser that knows where a
   brace may legally appear — was rejected as a second parser for a convenience
   spelling, which is the thing route 2 exists to avoid being.

3. **OpenQASM 2 with free parameters — NOT supported, and cannot be.**
   OpenQASM 2 has no notion of a free parameter and Qiskit's OpenQASM 2 reader
   has no hook to introduce one: ``QuantumCircuit.from_qasm_str`` returns a
   circuit whose angles are already floats. The rejected alternative was to
   substitute a unique sentinel float per placeholder, parse, then walk the
   circuit swapping any instruction parameter equal to the sentinel back into a
   ``Parameter``. It was rejected because it turns on float equality after the
   parser has folded arithmetic — ``rz(2*{theta})`` would fold and never match —
   so it would silently produce a circuit with fewer parameters than the caller
   declared. A refusal that names the problem is worth more than a rewrite that
   is right most of the time. Callers on QASM 2 get a message telling them to
   declare ``OPENQASM 3.0;``.

TWO MORE PLACES THE SHAPE BITES
-------------------------------
Getting the value array right is necessary and not sufficient. Two further
shape traps sit either side of it, both of which fail without raising, so
:func:`estimator_pub_arrays` and :func:`per_point_counts` exist to close them:

* An ``EstimatorPub`` broadcasts the observables shape against the
  parameter-values shape. A flat array of N observables and a sweep of P points
  raise loudly when ``N != P`` — and broadcast element-wise into a DIAGONAL
  when they happen to be equal.
* A swept Sampler result's ``BitArray`` has shape ``(P,)``, and
  ``.get_counts()`` on it merges every point's shots into one histogram. The
  sweep is silently gone.

WHAT THIS MODULE DELIBERATELY DOES NOT DO
-----------------------------------------
No HTTP, no routes, no vendor SDK, no submission. It does not transpile, and it
does not know what a backend is. It also does not price anything itself:
:func:`estimate_sweep_cost` takes the per-shot and per-task rates as arguments
rather than importing :mod:`app.quantum.transpile`, because a second copy of the
price table in a second module is a second thing to forget to update, and the
first symptom of the drift would be an under-quote.
"""

from __future__ import annotations

import itertools
import math
import re
from typing import Any, Sequence

#: A legal parameter name. Deliberately narrower than OpenQASM's identifier
#: rule: this name is echoed into error messages, injected verbatim into a
#: generated ``input`` declaration, and used as a JSON object key, so anything
#: exotic buys nothing and costs an injection surface.
_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,31}$")

#: A ``{theta}`` placeholder. Requires the braces to hug the identifier so that
#: a QASM 3 block body — ``gate foo a { x a; }`` — cannot match.
_PLACEHOLDER = re.compile(r"\{([A-Za-z_][A-Za-z0-9_]{0,31})\}")

#: An ``input`` declaration already present in the source, in any of the widths
#: the spec allows (``float[64]``, ``float``, ``angle[32]``). Used only to avoid
#: declaring the same name twice when a source mixes both spellings.
_INPUT_DECL = re.compile(
    r"^\s*input\s+(?:float|angle)\s*(?:\[\s*\d+\s*\])?\s+([A-Za-z_][A-Za-z0-9_]*)\s*;",
    re.MULTILINE,
)

#: Widest sweep the platform will accept, in total points.
#:
#: This is a BILL limit, not a technical one — the primitives would take more.
#: A sweep is one submission and therefore one quota unit, which is the point of
#: the feature and also the hazard: without a ceiling here, a caller who writes
#: ``num: 100000`` spends a hundred thousand circuits' worth of QPU time behind
#: a request that looks identical to a one-point run. 256 x 4096 shots is just
#: over a million shots, about $31 at IonQ's published per-shot rate — large
#: enough for a real 16x16 landscape, small enough that the refusal comes before
#: the invoice. A caller who genuinely needs more splits the sweep; the split
#: costs extra per-task fees, and that cost being visible is the intent.
MAX_SWEEP_POINTS = 256

#: Ceiling on points x shots, because ``MAX_SWEEP_POINTS`` alone does not bound
#: the bill: 256 points at this service's 20000-shot maximum is 5.1M shots.
#:
#: ENFORCED ONLY IN :func:`estimate_sweep_cost`. This module is pure and never
#: sees the shot count anywhere else, so a route that calls :func:`parse_sweep`
#: and :func:`sweep_values` and then submits WITHOUT calling
#: :func:`estimate_sweep_cost` is bounded at 256 points and not at all in shots.
#: Whoever wires this up must call the cost function on the request path, not
#: only when rendering a preview.
MAX_SWEEP_TOTAL_SHOTS = 2_000_000

#: Free parameters one circuit may carry. A 16-parameter product sweep with two
#: points per axis is already 65536 points, so this is never the binding limit
#: in practice; it exists so that a source which somehow yields thousands of
#: parameters is refused before a sweep is built over them.
#:
#: Note what it does NOT do: the check runs AFTER ``qasm3.loads``, so the parse
#: itself has already allocated. Bounding the source before parsing would mean
#: counting declarations with a regex and then disagreeing with the parser,
#: which is worse. The parser is the thing that has to survive hostile input
#: here, and that is its job, not this constant's.
MAX_PARAMETERS = 16

#: Ranges one sweep specification may list. Same reasoning as above.
MAX_RANGES = MAX_PARAMETERS


class ParameterError(ValueError):
    """A parameterised circuit or a sweep specification was rejected.

    Covers both halves of this module — the QASM that carries the parameters
    and the sweep that supplies their values — because to a caller they are one
    request and one 400.

    A ``ValueError`` so the routers' existing ``_guard`` maps it to a 400
    without a new branch: every one of these is the caller's input.
    """


# ── the circuit ─────────────────────────────────────────────────────────────


def normalise_inputs(qasm: str) -> str:
    """Rewrite ``{theta}`` placeholders into OpenQASM 3 ``input`` declarations.

    The two supported spellings are collapsed into one here so that only a
    single parser runs downstream. A source that already declares its inputs
    passes through untouched; a source that uses placeholders comes out with
    ``{theta}`` rewritten to ``theta`` and ``input float[64] theta;`` inserted
    after the last ``include`` line (or after the version line when there is no
    include, which is where a top-level declaration has to go).

    The substitution is textual and has no idea what a comment is — see the
    module docstring. Placeholders are defined only in gate-angle position.

    Args:
        qasm: The circuit source text, in either spelling or a mix of both.

    Returns:
        Source in which every free parameter has an ``input`` declaration.
        Returned unchanged when there is nothing to rewrite.

    Raises:
        ParameterError: When the source is empty.
    """
    if not qasm or not qasm.strip():
        raise ParameterError("The QASM source is empty.")

    found = _PLACEHOLDER.findall(qasm)
    if not found:
        return qasm

    already = set(_INPUT_DECL.findall(qasm))
    # dict.fromkeys, not set(), so the injected declarations keep the order the
    # placeholders appear in. That order has no effect on binding — binding is
    # alphabetical — but a human diffing the normalised source should see their
    # own circuit back.
    to_declare = [name for name in dict.fromkeys(found) if name not in already]

    body = _PLACEHOLDER.sub(r"\1", qasm)
    if not to_declare:
        return body

    declarations = [f"input float[64] {name};" for name in to_declare]

    lines = body.splitlines()
    insert_at = 0
    for index, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith("include") or stripped.upper().startswith("OPENQASM"):
            insert_at = index + 1
    return "\n".join(lines[:insert_at] + declarations + lines[insert_at:])


def parse_parameterised_qasm(qasm: str) -> dict[str, Any]:
    """Parse QASM that still carries free parameters.

    Args:
        qasm: OpenQASM 3 source using ``input`` declarations, ``{name}``
            placeholders, or both. OpenQASM 2 is refused when it carries
            placeholders — see the module docstring for why that is a refusal
            and not a workaround.

    Returns:
        ``{"circuit": QuantumCircuit, "parameters": [...], "num_qubits": int,
        "qasm": str}`` where ``parameters`` is in **binding order** — the
        circuit's own parameter order, which is alphabetical by name and is NOT
        the order the declarations appear in the source. ``qasm`` is the
        normalised source that was actually parsed, so a caller can show the
        user what the placeholders became.

    Raises:
        ParameterError: When the source is empty, is OpenQASM 2 with
            placeholders, cannot be parsed, carries no free parameters at all,
            or carries more than :data:`MAX_PARAMETERS` of them.
    """
    normalised = normalise_inputs(qasm)

    # Checked before the parser rather than after, because qasm3.loads on
    # OpenQASM 2 source fails with a syntax error about `qreg`, which sends the
    # caller looking for a typo instead of at the dialect.
    if _declares_qasm2(normalised):
        raise ParameterError(
            "Free parameters need OpenQASM 3: OpenQASM 2 has no way to express an unbound "
            "angle, and Qiskit's OpenQASM 2 reader returns a circuit whose angles are already "
            'numbers. Change the header to \'OPENQASM 3.0;\' and include "stdgates.inc".'
        )

    from qiskit import qasm3

    try:
        circuit = qasm3.loads(normalised)
    # Qiskit's importers can surface Rust panics as PanicException, which
    # derives from BaseException; letting one escape would take down the
    # request rather than returning a 400.
    except BaseException as exc:  # noqa: BLE001
        if isinstance(exc, (KeyboardInterrupt, SystemExit)):
            raise
        raise ParameterError(f"Could not parse the parameterised circuit: {exc}") from exc

    names = binding_order(circuit)
    if not names:
        raise ParameterError(
            "The circuit has no free parameters, so there is nothing to sweep. Declare one "
            "with 'input float[64] theta;' and use it in a gate angle, or submit the circuit "
            "through the ordinary single-point path."
        )
    if len(names) > MAX_PARAMETERS:
        raise ParameterError(
            f"At most {MAX_PARAMETERS} free parameters per circuit, got {len(names)}."
        )

    return {
        "circuit": circuit,
        "parameters": names,
        "num_qubits": circuit.num_qubits,
        "qasm": normalised,
    }


def binding_order(circuit: Any) -> list[str]:
    """Read the order a circuit's parameter values must be supplied in.

    Call this on the circuit you are actually submitting — the TRANSPILED one —
    rather than reusing the order from before transpilation. Transpilation does
    preserve parameters today, so the two agree, but the cost of recomputing is
    an attribute read and the cost of being wrong is a silently mis-bound sweep.

    Args:
        circuit: Any ``QuantumCircuit``.

    Returns:
        Parameter names in the order the V2 pub's value array is consumed —
        which is alphabetical, because that is how Qiskit sorts
        ``QuantumCircuit.parameters``.
    """
    return [parameter.name for parameter in circuit.parameters]


def _declares_qasm2(qasm: str) -> bool:
    """Detect an explicit OpenQASM 2 version header.

    Block comments are stripped before the scan, not just line comments. A
    source that opens with a ``/* generated by ... */`` banner — which is what
    every exporter writes — would otherwise slip past this check and reach
    ``qasm3.loads``, where it fails with a syntax error about ``qreg``. That is
    exactly the confusing message this function exists to replace, and it would
    have appeared only for the sources most likely to be machine-generated.

    Args:
        qasm: The circuit source text.

    Returns:
        True when the first meaningful statement declares OpenQASM 2.
    """
    without_block_comments = re.sub(r"/\*.*?\*/", " ", qasm, flags=re.DOTALL)
    for line in without_block_comments.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("//"):
            continue
        return stripped.replace(" ", "").upper().startswith("OPENQASM2")
    return False


# ── the sweep ───────────────────────────────────────────────────────────────


def parse_sweep(raw: Any, parameters: Sequence[str]) -> list[dict[str, float]]:
    """Validate a sweep specification against a circuit's parameters.

    Two shapes are accepted, and exactly one of them must be present:

    ``{"points": [{"theta": 0.0, "phi": 1.0}, ...]}``
        Explicit named points, kept in the order given. Use this for a scan
        that is not a grid — an optimiser trajectory, a hand-picked set.

    ``{"ranges": [{"parameter": "theta", "start": 0, "stop": 3.14159, "num": 8},
    ...], "combine": "product"}``
        A linspace per parameter. ``combine`` is ``"product"`` (default, the
        full grid) or ``"zip"`` (the i-th value of each range together, which
        requires every range to have the same ``num``).

        With ``"product"``, the LAST range listed varies fastest, so the point
        list reshapes to ``(num_0, num_1, ...)`` in row-major order. A caller
        drawing a heat map needs that fact and it is not guessable.

    Args:
        raw: The ``sweep`` field from the request.
        parameters: The circuit's parameter names, from
            :func:`binding_order`. Used to reject typos and missing values
            here, where the message can name the parameter, rather than letting
            Qiskit raise about an unbound parameter at submission time.

    Returns:
        The expanded points as ``{name: float}`` dicts, in evaluation order.
        Named dicts, not positional lists — see the module docstring.

    Raises:
        ParameterError: On a malformed specification, an unknown or missing
            parameter name, a non-finite value, or a point count above
            :data:`MAX_SWEEP_POINTS`.
    """
    if not isinstance(raw, dict):
        raise ParameterError(
            'sweep must be an object, either {"points": [...]} or {"ranges": [...]}.'
        )

    expected = list(parameters)
    if not expected:
        raise ParameterError("Cannot build a sweep for a circuit with no free parameters.")

    has_points = raw.get("points") is not None
    has_ranges = raw.get("ranges") is not None
    if has_points and has_ranges:
        raise ParameterError(
            "sweep must carry either 'points' or 'ranges', not both — with both present there "
            "is no defensible reading of which one wins."
        )
    if not has_points and not has_ranges:
        raise ParameterError(
            'sweep must carry either "points" (a list of {name: value} objects) or "ranges" '
            '(a list of {parameter, start, stop, num} objects).'
        )

    points = (
        _parse_explicit_points(raw["points"], expected)
        if has_points
        # `combine: null` means absent, for the same reason `points: null` does
        # above: a client that serialises its optional fields as null was
        # otherwise refused for a field it never set, with a message accusing it
        # of a typo. A MISSPELLED combine is still refused — see
        # test_a_bad_combine_is_refused_rather_than_defaulted — because
        # defaulting "zipp" to "product" turns a 40-point path into a 1600-point
        # grid, and only an explicit null is read as "I did not choose".
        else _expand_ranges(
            raw["ranges"],
            "product" if raw.get("combine") is None else raw["combine"],
            expected,
        )
    )

    # Checked again here even though both builders check as they go: the
    # explicit path can be short-circuited by a future caller and this is the
    # one invariant whose failure costs money.
    if len(points) > MAX_SWEEP_POINTS:
        raise ParameterError(
            f"A sweep may contain at most {MAX_SWEEP_POINTS} points, got {len(points)}."
        )
    return points


def _parse_explicit_points(raw: Any, expected: list[str]) -> list[dict[str, float]]:
    """Validate a list of named parameter points.

    Args:
        raw: The ``points`` field.
        expected: The circuit's parameter names.

    Returns:
        One ``{name: float}`` dict per point, in the order given.

    Raises:
        ParameterError: On any malformed, over-long, or incomplete point list.
    """
    if not isinstance(raw, list) or not raw:
        raise ParameterError("sweep.points must be a non-empty list of objects.")
    if len(raw) > MAX_SWEEP_POINTS:
        raise ParameterError(
            f"A sweep may contain at most {MAX_SWEEP_POINTS} points, got {len(raw)}. "
            "A sweep runs as ONE job, so this limit is what stands between a typo in 'num' "
            "and an unbounded bill; split the scan into several submissions if you need more."
        )

    expected_set = set(expected)
    points: list[dict[str, float]] = []

    for index, entry in enumerate(raw):
        if not isinstance(entry, dict):
            raise ParameterError(
                f'sweep.points[{index}] must be an object like {{"theta": 0.5}}, got '
                f"{type(entry).__name__}."
            )
        unknown = sorted(set(entry) - expected_set)
        if unknown:
            raise ParameterError(
                f"sweep.points[{index}] names {unknown} which the circuit does not declare. "
                f"Its parameters are {expected}."
            )
        missing = [name for name in expected if name not in entry]
        if missing:
            # Partial binding is the quiet failure: Qiskit would raise at
            # submission with a message about the circuit, not about the point,
            # and a caller would not know which of 40 points was short.
            raise ParameterError(
                f"sweep.points[{index}] is missing a value for {missing}. Every point must "
                f"give a value for every parameter: {expected}."
            )
        points.append(
            {name: _finite_float(entry[name], f"sweep.points[{index}].{name}") for name in expected}
        )

    return points


def _expand_ranges(raw: Any, combine: Any, expected: list[str]) -> list[dict[str, float]]:
    """Expand per-parameter linspace ranges into explicit points.

    Args:
        raw: The ``ranges`` field.
        combine: ``"product"`` or ``"zip"``.
        expected: The circuit's parameter names.

    Returns:
        One ``{name: float}`` dict per point, last range varying fastest under
        ``"product"``.

    Raises:
        ParameterError: On a malformed range, a duplicate or unknown parameter,
            a parameter left without a range, a bad ``combine``, mismatched
            lengths under ``"zip"``, or a total above :data:`MAX_SWEEP_POINTS`.
    """
    if combine not in ("product", "zip"):
        raise ParameterError(f'sweep.combine must be "product" or "zip", got {combine!r}.')
    if not isinstance(raw, list) or not raw:
        raise ParameterError("sweep.ranges must be a non-empty list of objects.")
    if len(raw) > MAX_RANGES:
        raise ParameterError(f"At most {MAX_RANGES} ranges per sweep, got {len(raw)}.")

    expected_set = set(expected)
    names: list[str] = []
    axes: list[list[float]] = []

    for index, entry in enumerate(raw):
        if not isinstance(entry, dict):
            raise ParameterError(f"sweep.ranges[{index}] must be an object.")

        name = entry.get("parameter")
        if not isinstance(name, str) or not _NAME.match(name.strip()):
            raise ParameterError(
                f"sweep.ranges[{index}].parameter must be an identifier, got {name!r}."
            )
        name = name.strip()
        if name not in expected_set:
            raise ParameterError(
                f"sweep.ranges[{index}] sweeps '{name}' which the circuit does not declare. "
                f"Its parameters are {expected}."
            )
        if name in names:
            raise ParameterError(
                f"sweep.ranges[{index}] sweeps '{name}' a second time. One range per parameter."
            )

        names.append(name)
        axes.append(_linspace(entry, index))

    missing = [name for name in expected if name not in names]
    if missing:
        # A parameter with no range would be left unbound, and an unbound
        # parameter is a submission-time failure with a message that points at
        # the circuit rather than at the sweep.
        raise ParameterError(
            f"No range given for {missing}. Every parameter the circuit declares needs one — "
            "use num: 1 to hold a parameter fixed."
        )

    if combine == "zip":
        lengths = {len(axis) for axis in axes}
        if len(lengths) != 1:
            raise ParameterError(
                'sweep.combine "zip" pairs the i-th value of each range, so every range must '
                f"have the same num; got {[len(axis) for axis in axes]}."
            )
        total = len(axes[0])
    else:
        total = math.prod(len(axis) for axis in axes)

    if total > MAX_SWEEP_POINTS:
        shape = " x ".join(str(len(axis)) for axis in axes)
        raise ParameterError(
            f"That sweep expands to {total} points ({shape}) and the maximum is "
            f"{MAX_SWEEP_POINTS}. A sweep runs as ONE job, so this limit is what stands "
            "between a typo in 'num' and an unbounded bill; reduce num, or split the scan "
            "into several submissions."
        )

    combos = zip(*axes) if combine == "zip" else itertools.product(*axes)
    return [dict(zip(names, values)) for values in combos]


def _linspace(entry: dict[str, Any], index: int) -> list[float]:
    """Build the values of one range.

    ``stop`` is inclusive and the final element is set to ``stop`` exactly
    rather than accumulated as ``start + step * (num - 1)``.

    BE PRECISE ABOUT HOW BIG THIS EFFECT IS, because it is easy to overstate:
    for most round ``num`` the accumulated endpoint happens to round back to
    ``stop`` bit for bit, and 0..pi in 5 steps is one of those. It is not
    universal. ``start=0.1, stop=pi, num=4`` accumulates to
    3.1415926535897936, and ``start=0, stop=pi, num=26`` to the same value —
    both one ulp past pi. So this is a small, intermittent discrepancy rather
    than a systematic one, and it is pinned here because a user who asked for pi
    and reads back something that is not pi reasonably concludes the platform is
    lying about what it ran. On a Bloch-angle scan the endpoint is usually the
    interesting point.

    Args:
        entry: The range object.
        index: Its position, for error messages.

    Returns:
        ``num`` floats from ``start`` to ``stop`` inclusive; ``[start]`` when
        ``num`` is 1.

    Raises:
        ParameterError: On a missing or non-finite bound, or a ``num`` that is
            not an integer in ``1..MAX_SWEEP_POINTS``.
    """
    where = f"sweep.ranges[{index}]"
    start = _finite_float(entry.get("start"), f"{where}.start")
    stop = _finite_float(entry.get("stop"), f"{where}.stop")

    num = entry.get("num")
    if isinstance(num, bool) or not isinstance(num, int):
        raise ParameterError(f"{where}.num must be an integer, got {num!r}.")
    if num < 1:
        raise ParameterError(f"{where}.num must be at least 1, got {num}.")
    if num > MAX_SWEEP_POINTS:
        raise ParameterError(
            f"{where}.num is {num} and a whole sweep may contain at most "
            f"{MAX_SWEEP_POINTS} points."
        )

    if num == 1:
        # Deliberately start, not the midpoint: "one point" means "hold it
        # here", and holding it at start is what the caller wrote down.
        return [start]

    step = (stop - start) / (num - 1)
    values = [start + step * i for i in range(num - 1)]
    values.append(stop)
    return values


def _finite_float(raw: Any, where: str) -> float:
    """Coerce one value to a finite float.

    Args:
        raw: The candidate value.
        where: Dotted path to the field, for the error message.

    Returns:
        The value as a float.

    Raises:
        ParameterError: When it is missing, is a bool, is not a number, or is
            NaN or infinite. NaN survives JSON in several encoders and would
            reach the device as a rotation angle, producing a job that runs,
            costs money and returns noise.
    """
    if isinstance(raw, bool) or not isinstance(raw, (int, float)):
        raise ParameterError(f"{where} must be a real number, got {raw!r}.")
    value = float(raw)
    if not math.isfinite(value):
        raise ParameterError(f"{where} must be finite, got {raw!r}.")
    return value


# ── the value array ─────────────────────────────────────────────────────────


def sweep_values(
    points: Sequence[dict[str, float]], parameters: Sequence[str]
) -> list[list[float]]:
    """Project named points onto the positional array the V2 pubs take.

    THIS IS THE STEP THAT IS EASY TO GET WRONG, and it is the reason every other
    function here traffics in names. ``QuantumCircuit.parameters`` is sorted
    alphabetically, so the pub's value array is consumed alphabetically too — a
    caller who emits values in the order the ``input`` declarations appear in
    the source gets a job that succeeds and a landscape that belongs to a
    different pair of angles. Nothing in the result reveals it.

    Pass ``parameters`` from :func:`binding_order` called on the circuit you are
    submitting, not a list you assembled yourself.

    Args:
        points: Output of :func:`parse_sweep`.
        parameters: Parameter names in binding order.

    Returns:
        A list of rows, shape ``(len(points), len(parameters))``, ready to go
        into a pub as ``(isa_circuit, values)`` for ``SamplerV2`` or
        ``(isa_circuit, observables, values)`` for ``EstimatorV2``.

    Raises:
        ParameterError: When a point does not cover every parameter. Reaching
            this means the points and the circuit disagree, which
            :func:`parse_sweep` should already have caught — it is re-checked
            because binding a short row is the failure this module exists to
            prevent.
    """
    names = list(parameters)
    if not names:
        raise ParameterError("sweep_values needs the circuit's parameter names, got none.")
    if not points:
        # An empty rows list is a pub with nothing to bind. Qiskit's reaction to
        # that is version-dependent — a zero-length BindingsArray rather than a
        # refusal — and a submitted job that measures nothing still occupies a
        # queue slot and, on Braket, still costs the per-task fee.
        raise ParameterError("A sweep needs at least one point, got an empty list.")

    rows: list[list[float]] = []
    for index, point in enumerate(points):
        missing = [name for name in names if name not in point]
        if missing:
            raise ParameterError(
                f"Sweep point {index} has no value for {missing}; the circuit binds "
                f"{names} in that order."
            )
        rows.append([float(point[name]) for name in names])
    return rows


def estimator_pub_arrays(
    operators: Sequence[Any], values: Sequence[Sequence[float]]
) -> tuple[Any, Any]:
    """Reshape observables and sweep values so an Estimator pub broadcasts.

    ``EstimatorPub`` broadcasts the observables shape against the
    parameter-values shape, and the two natural shapes DO NOT broadcast:
    :mod:`app.quantum.observables` submits one pub carrying a flat array of N
    observables, shape ``(N,)``, and a sweep of P points is shape ``(P,)``.
    Qiskit raises ``"The observables shape (2,) and the parameter values shape
    (3,) are not broadcastable"`` — which is at least loud, but only when
    ``N != P``. When they happen to be equal it broadcasts element-wise and
    silently evaluates observable *i* at point *i* only, returning P numbers
    that look like a sweep and are a diagonal.

    Making the observables a COLUMN and the values a ROW gives the full outer
    product, shape ``(N, P)``: every observable at every point.

    Args:
        operators: The layout-corrected operators from
            :func:`app.quantum.observables.observables_for_circuit`.
        values: Rows from :func:`sweep_values`.

    Returns:
        ``(observables_column, values_row)`` for
        ``estimator.run([(isa_circuit, observables_column, values_row)])``. The
        resulting ``result[0].data.evs`` has shape ``(len(operators),
        len(values))`` — observable-major, point-minor.

    Raises:
        ParameterError: When either argument is empty, or the rows are ragged.
    """
    import numpy as np

    if not operators:
        raise ParameterError("estimator_pub_arrays needs at least one observable.")
    if not values:
        raise ParameterError("estimator_pub_arrays needs at least one sweep point.")
    widths = {len(row) for row in values}
    if len(widths) != 1:
        raise ParameterError(
            f"Sweep value rows must all be the same width, got {sorted(widths)}."
        )

    # np.array(operators) would try to ITERATE each SparsePauliOp and build a
    # numeric array out of its terms; an explicit object array is the only way
    # to get a 2-D grid of operator objects.
    column = np.empty((len(operators), 1), dtype=object)
    for index, operator in enumerate(operators):
        column[index, 0] = operator

    row = np.asarray(values, dtype=float).reshape(1, len(values), widths.pop())
    return column, row


def per_point_counts(data_field: Any, num_points: int) -> list[dict[str, int]]:
    """Split a swept Sampler result into one histogram per point.

    THE TRAP THIS EXISTS FOR. A swept ``SamplerV2`` result's ``data.c`` is a
    ``BitArray`` of shape ``(P,)``, and calling ``.get_counts()`` on it —
    exactly what the single-point path does today — returns ONE histogram with
    every point's shots merged together. A 3-point scan of rx(0), rx(pi/2),
    rx(pi) that should read ``100% |0>``, ``50/50``, ``100% |1>`` comes back as
    a single ``{'0': 147, '1': 153}``. No exception, no warning, and the
    landscape is gone. The per-point histograms are only reachable by indexing
    the array first.

    Args:
        data_field: The ``BitArray`` for one classical register, e.g.
            ``result[0].data.c``.
        num_points: How many sweep points were submitted.

    Returns:
        ``num_points`` count dictionaries, in sweep order. A point whose
        histogram cannot be read comes back as ``{}`` rather than being
        dropped, so the list index still means the sweep index.

    Raises:
        ParameterError: When the result's leading axis does not match the sweep
            length, when the result is a single un-swept histogram, or when not
            one point could be read. All three mean the counts cannot be
            attributed to points, and guessing an alignment — or handing back a
            list of empty histograms — would present a missing landscape as a
            measured one.
    """
    if isinstance(num_points, bool) or not isinstance(num_points, int) or num_points < 1:
        raise ParameterError(f"num_points must be a positive integer, got {num_points!r}.")

    shape = getattr(data_field, "shape", None)
    if shape is not None and len(shape) == 0:
        # A 0-d BitArray is what a NON-swept submission returns: the values went
        # to the primitive as a flat row rather than an array of rows, so the
        # device ran one point. Checking only `len(shape) >= 1` skipped this
        # case entirely and the loop below then returned num_points empty dicts
        # with no error — a blank landscape that reads as "the sweep ran and
        # every point was empty" rather than "the sweep never happened".
        if num_points != 1:
            raise ParameterError(
                f"The result is a single un-swept histogram but {num_points} points were "
                "submitted: the parameter values did not reach the primitive as an array of "
                "rows, so there is no per-point landscape to recover."
            )
        return [dict(data_field.get_counts())]
    if shape is not None and shape[0] != num_points:
        raise ParameterError(
            f"The result has {shape[0]} entries but {num_points} points were submitted; "
            "the counts cannot be attributed to sweep points."
        )

    counts: list[dict[str, int]] = []
    unreadable = 0
    for index in range(num_points):
        try:
            counts.append(dict(data_field[index].get_counts()))
        except Exception:  # noqa: BLE001
            # An empty dict, never a dropped entry: the list index IS the sweep
            # index, and a shorter list would silently re-label every point
            # after the failure.
            unreadable += 1
            counts.append({})

    if unreadable == num_points:
        # One unreadable point among many is a gap in a landscape. EVERY point
        # unreadable is not a landscape at all — it means `data_field` was never
        # an indexable per-point container (a result object without `.shape`
        # reaches here with no guard above it), and returning a full list of
        # empty histograms would let a caller plot nothing and call it a result.
        raise ParameterError(
            f"None of the {num_points} sweep points could be read out of a "
            f"{type(data_field).__name__}; it does not look like a per-point BitArray."
        )
    return counts


# ── the price tag ───────────────────────────────────────────────────────────


def estimate_sweep_cost(
    num_points: int,
    shots: int,
    *,
    per_shot_usd: float | None = None,
    task_fee_usd: float | None = None,
) -> dict[str, Any]:
    """Describe what a sweep will cost, before it is spent.

    EVERY FIGURE HERE IS AN ESTIMATE, and the keys say so. The shot count is
    exact arithmetic; the dollar figures are the caller's published rate card
    multiplied out, not a quote, and the real invoice comes from the vendor. The
    rates are arguments rather than a table in this module on purpose — see the
    module docstring.

    Args:
        num_points: Points in the sweep, from ``len(parse_sweep(...))``.
        shots: Shots per point. Each point is measured independently, so the
            device runs ``num_points * shots`` shots in total.
        per_shot_usd: Published per-shot rate for the target vendor, e.g. from
            ``app.quantum.transpile.PER_SHOT_USD``. None when the vendor's rate
            is not known — Quantinuum bills in H-System Credits, not dollars —
            in which case the dollar fields come back None rather than 0.0,
            because "we cannot price this" and "this is free" are different
            answers and only one of them is honest.
        task_fee_usd: Published per-submission fee. Counted ONCE here, which is
            correct only if the vendor really does run the sweep as one task —
            true for IBM Qiskit Runtime, UNVERIFIED for Braket and Azure; see
            the module docstring. None means "this vendor has no per-task fee",
            NOT "the fee is unknown", and it reports as 0.0. That is the one
            place this function conflates absent with zero; there is currently
            no vendor in ``app.quantum.transpile.TASK_FEE_USD`` whose fee is
            unknown, and the moment there is, this argument needs the same
            None-means-unpriced treatment ``per_shot_usd`` has.

    Returns:
        ``{"points", "shots_per_point", "total_shots", "multiplier",
        "summary", "estimated_usd", "estimated_usd_if_submitted_separately",
        "estimated_task_fee_usd", "is_estimate", "caveat"}``. The dollar fields
        are None when ``per_shot_usd`` is None. ``caveat`` is the sentence that
        must travel with ``estimated_usd_if_submitted_separately`` wherever it
        is rendered.

    Raises:
        ParameterError: When the counts are not positive integers, or when
            ``num_points * shots`` exceeds :data:`MAX_SWEEP_TOTAL_SHOTS`.
    """
    if isinstance(num_points, bool) or not isinstance(num_points, int) or num_points < 1:
        raise ParameterError(f"num_points must be a positive integer, got {num_points!r}.")
    if isinstance(shots, bool) or not isinstance(shots, int) or shots < 1:
        raise ParameterError(f"shots must be a positive integer, got {shots!r}.")
    if num_points > MAX_SWEEP_POINTS:
        raise ParameterError(
            f"A sweep may contain at most {MAX_SWEEP_POINTS} points, got {num_points}."
        )

    total_shots = num_points * shots
    if total_shots > MAX_SWEEP_TOTAL_SHOTS:
        # The point ceiling alone does not bound the bill: 256 points at this
        # service's 20000-shot maximum is 5.1M shots.
        raise ParameterError(
            f"{num_points} points x {shots} shots is {total_shots} shots, above the "
            f"{MAX_SWEEP_TOTAL_SHOTS}-shot ceiling for a single sweep. Reduce the shots per "
            "point or the number of points."
        )

    estimated_usd: float | None = None
    separately: float | None = None
    fee: float | None = None
    if per_shot_usd is not None:
        fee = float(task_fee_usd or 0.0)
        estimated_usd = total_shots * float(per_shot_usd) + fee
        # What the same scan would have cost as num_points submissions: the
        # same shots, but the per-task fee every time. This is the number that
        # would justify the feature — IF the vendor runs the sweep as one task.
        # Verified for Qiskit Runtime, NOT for Braket or Azure, which is why it
        # ships with `caveat` rather than as a bare saving.
        separately = total_shots * float(per_shot_usd) + fee * num_points

    return {
        "points": num_points,
        "shots_per_point": shots,
        "total_shots": total_shots,
        # The factor by which this run is larger than a single-point run. Named
        # "multiplier" because that is what a caller needs to hear before
        # spending: "this is 40x the run you were about to make".
        "multiplier": num_points,
        "summary": f"{num_points} points x {shots} shots = {total_shots:,} shots (estimated)",
        "estimated_usd": estimated_usd,
        "estimated_usd_if_submitted_separately": separately,
        "estimated_task_fee_usd": fee,
        "is_estimate": True,
        # Shipped in the payload rather than left in a docstring because the
        # number above it is the one a marketing page would lift.
        "caveat": (
            "Shot arithmetic is exact; the dollar figures multiply out the rates the caller "
            "supplied and are not a quote. 'If submitted separately' assumes the vendor runs "
            "the whole sweep as ONE task — verified for IBM Qiskit Runtime's V2 primitives, "
            "NOT verified for Amazon Braket or Azure Quantum, where a sweep may still be one "
            "task per point and one per-task fee per point."
        ),
    }
