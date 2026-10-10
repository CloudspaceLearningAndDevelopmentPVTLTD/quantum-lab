"""A static Python mirror of the Qubit16 course structure.

The course itself is defined in TypeScript: lesson metadata in
``apps/web/lib/lessons/index.ts`` and lesson bodies in
``apps/web/lib/lessons/bodies/*.ts``. The agent service is Python and cannot
import those modules, so the
parts it needs to *reason* about — slugs, titles, levels, reading times, the
prerequisite graph and the concepts each lesson teaches — are duplicated here.

IMPORTANT: this file is a mirror and must be kept in step with the TypeScript
course definition. Whenever a lesson is added, renamed, re-levelled or its
prerequisites change on the web side, update the corresponding entry here. A
drift test in ``tests/test_tools_extra.py`` reads the TypeScript sources with
plain string matching and fails if a slug listed below no longer exists there,
so the mirror cannot silently rot — but the test only catches *removals and
renames*, not changed minutes or prerequisites, which still need a human eye.

Nothing in this module touches the network, the filesystem or an API key.
"""

from __future__ import annotations

from typing import Any

__all__ = [
    "LESSONS",
    "VISUALIZATIONS",
    "CONCEPT_DEPENDENCIES",
    "TRACKS",
    "LESSON_SLUGS",
    "get_lesson",
    "lessons_in_track",
    "prerequisites_of",
    "unlocked_lessons",
    "concept_chain",
    "lesson_for_concept",
]

#: The two tracks, in the order the site presents them.
TRACKS: tuple[str, ...] = ("foundations", "advanced")

#: Every lesson in the course, in canonical (navigation) order.
#:
#: Keys mirror the TypeScript ``Lesson`` interface: ``slug`` is the stable id
#: used in URLs and in the browser's progress payload, ``level`` is one of
#: ``Beginner``/``Intermediate``/``Advanced``, ``minutes`` is the estimated
#: reading time, ``prerequisites`` are the slugs that should be read first, and
#: ``summary`` is the lesson's one-line subtitle from the site.
LESSONS: list[dict[str, Any]] = [
    {
        "id": "what-is-a-qubit",
        "slug": "what-is-a-qubit",
        "title": "What Is a Qubit?",
        "level": "Beginner",
        "minutes": 8,
        "track": "foundations",
        "prerequisites": [],
        "summary": (
            "A bit is a switch. A qubit is a direction. Getting that difference "
            "straight is most of the battle."
        ),
        "concepts": ["qubit", "superposition", "amplitude"],
    },
    {
        "id": "superposition-and-measurement",
        "slug": "superposition-and-measurement",
        "title": "Superposition & Measurement",
        "level": "Beginner",
        "minutes": 10,
        "track": "foundations",
        "prerequisites": ["what-is-a-qubit"],
        "summary": (
            "Measurement is not a passive reading. It is the most violent thing "
            "you can do to a quantum state."
        ),
        "concepts": ["superposition", "measurement", "born rule", "collapse"],
    },
    {
        "id": "interference",
        "slug": "interference",
        "title": "Interference: Where the Power Comes From",
        "level": "Beginner",
        "minutes": 10,
        "track": "foundations",
        "prerequisites": ["superposition-and-measurement"],
        "summary": (
            'Not "it tries every answer at once" — but "it arranges for the '
            'wrong answers to cancel".'
        ),
        "concepts": ["interference", "phase", "amplitude"],
    },
    {
        # EVAL FINDING (tutor eval, 2026-08): this lesson EXISTED in the course
        # and in the RAG index but was absent from this mirror, so
        # recommend_next_lesson could never surface it, get_learner_profile
        # scored progress out of 10 lessons instead of 11, and
        # lesson_for_concept("tunneling") returned None even though
        # CONCEPT_DEPENDENCIES has always had a "tunneling" node. The symptom
        # looked like a retrieval failure; the cause was a missing entry.
        # Field values copied from apps/web/lib/lessons/index.ts.
        "id": "tunneling",
        "slug": "tunneling",
        "title": "Quantum Tunneling",
        "level": "Intermediate",
        "minutes": 12,
        "track": "foundations",
        "prerequisites": ["superposition-and-measurement"],
        "summary": (
            "A particle with too little energy to climb the wall comes out the "
            "other side anyway — and nothing was borrowed to do it."
        ),
        "concepts": ["tunneling", "wavefunction", "barrier"],
    },
    {
        "id": "gates-and-circuits",
        "slug": "gates-and-circuits",
        "title": "Gates & Circuits",
        "level": "Intermediate",
        "minutes": 12,
        "track": "foundations",
        "prerequisites": ["interference"],
        "summary": (
            "Every quantum gate is a rotation. Every circuit is a sequence of "
            "rotations you can read left to right."
        ),
        "concepts": ["gates", "unitary", "hadamard", "cnot", "bloch sphere"],
    },
    {
        "id": "entanglement",
        "slug": "entanglement",
        "title": "Entanglement",
        "level": "Intermediate",
        "minutes": 12,
        "track": "foundations",
        "prerequisites": ["gates-and-circuits"],
        "summary": (
            "Two qubits with a definite joint state and no definite individual "
            "states — and it is not the correlation you think."
        ),
        "concepts": ["entanglement", "bell state", "ghz state", "no cloning"],
    },
    {
        "id": "grover",
        "slug": "grover",
        "title": "Grover's Search",
        "level": "Advanced",
        "minutes": 15,
        "track": "foundations",
        "prerequisites": ["entanglement"],
        "summary": (
            "Find a needle in an unsorted haystack of N items in about sqrt(N) "
            "steps — and understand why it is sqrt(N) and not better."
        ),
        "concepts": ["grover", "oracle", "amplitude amplification", "search"],
    },
    {
        "id": "inside-a-quantum-computer",
        "slug": "inside-a-quantum-computer",
        "title": "Inside a Quantum Computer",
        "level": "Intermediate",
        "minutes": 12,
        "track": "foundations",
        "prerequisites": ["gates-and-circuits"],
        "summary": (
            "The qubit is a circuit you could see with the naked eye, the "
            "gates are microwave pulses, and the famous golden chandelier is "
            "not the computer — it is the refrigerator."
        ),
        "concepts": [
            "transmon",
            "josephson junction",
            "microwave pulses",
            "dilution refrigerator",
            "dispersive readout",
        ],
    },
    {
        "id": "shor",
        "slug": "shor",
        "title": "Shor's Algorithm",
        "level": "Advanced",
        "minutes": 18,
        "track": "advanced",
        "prerequisites": ["grover"],
        "summary": (
            "Factoring is not the quantum part. Finding the period of a function "
            "is — everything else is number theory you could do on a laptop."
        ),
        "concepts": ["shor", "qft", "period finding", "factoring", "phase"],
    },
    {
        "id": "error-correction",
        "slug": "error-correction",
        "title": "Quantum Error Correction",
        "level": "Advanced",
        "minutes": 20,
        "track": "advanced",
        "prerequisites": ["shor"],
        "summary": (
            "You cannot copy a qubit and you cannot look at it to check it. "
            "Error correction works anyway, and how it dodges that is beautiful."
        ),
        "concepts": ["error correction", "decoherence", "no cloning", "stabilizer"],
    },
    {
        "id": "vqe-and-nisq",
        "slug": "vqe-and-nisq",
        "title": "NISQ Algorithms and VQE",
        "level": "Advanced",
        "minutes": 16,
        "track": "advanced",
        "prerequisites": ["gates-and-circuits"],
        "summary": (
            "What can you do with a few hundred noisy qubits and no error "
            'correction? Honestly: less than we hoped, and the reasons matter.'
        ),
        "concepts": ["vqe", "nisq", "decoherence", "variational", "gates"],
    },
    {
        "id": "quantum-cryptography",
        "slug": "quantum-cryptography",
        "title": "Quantum Cryptography",
        "level": "Advanced",
        "minutes": 14,
        "track": "advanced",
        "prerequisites": ["entanglement"],
        "summary": (
            "You cannot stop an eavesdropper listening. You can make listening "
            "leave marks that physics guarantees you will find."
        ),
        "concepts": ["cryptography", "bb84", "no cloning", "entanglement", "measurement"],
    },
    {
        "id": "quantum-machine-learning",
        "slug": "quantum-machine-learning",
        "title": "Quantum Machine Learning",
        "level": "Advanced",
        "minutes": 16,
        "track": "advanced",
        "prerequisites": ["vqe-and-nisq"],
        "summary": (
            "A parameterised circuit is an ML model trained by a classical "
            "optimiser. No proven advantage on classical data yet — here is "
            "what is actually known."
        ),
        "concepts": ["qml", "data encoding", "quantum kernel", "variational", "nisq"],
    },
    {
        "id": "qaoa-and-optimization",
        "slug": "qaoa-and-optimization",
        "title": "QAOA and Quantum Optimization",
        "level": "Advanced",
        "minutes": 16,
        "track": "advanced",
        "prerequisites": ["vqe-and-nisq"],
        "summary": (
            "An alternating circuit that tilts a superposition toward good "
            "cuts of a graph. Whether it can ever beat classical optimisers "
            "is — honestly — still unknown."
        ),
        "concepts": ["qaoa", "maxcut", "cost hamiltonian", "mixer", "optimization"],
    },
    {
        "id": "post-quantum-cryptography",
        "slug": "post-quantum-cryptography",
        "title": "Post-Quantum Cryptography",
        "level": "Advanced",
        "minutes": 18,
        "track": "advanced",
        "prerequisites": ["shor", "quantum-cryptography"],
        "summary": (
            "The migration away from RSA is already running in your browser. "
            "What replaced it, why lattices have no period for Shor to find, "
            "and why 'post-quantum' is a status, not a proof."
        ),
        "concepts": ["post-quantum", "lattice", "lwe", "ml-kem", "harvest now decrypt later", "shor"],
    },
]

#: Canonical lesson order, as slugs.
LESSON_SLUGS: list[str] = [lesson["slug"] for lesson in LESSONS]

#: The eight interactive visualizations, mirrored from
#: ``apps/web/components/ui/Hero.tsx`` and ``apps/web/app/visualizations/``.
#: ``concepts`` lists what each one actually teaches, so a tool can point a
#: learner at the demo that matches the idea they are stuck on.
VISUALIZATIONS: list[dict[str, Any]] = [
    {
        "slug": "double-slit",
        "title": "The Double-Slit Experiment",
        "level": "Beginner",
        "concepts": ["interference", "measurement", "superposition"],
        "lessons": ["interference"],
    },
    {
        "slug": "superposition",
        "title": "Superposition & Measurement",
        "level": "Beginner",
        "concepts": ["superposition", "measurement", "collapse", "born rule"],
        "lessons": ["superposition-and-measurement", "what-is-a-qubit"],
    },
    {
        "slug": "bloch-sphere",
        "title": "The Bloch Sphere",
        "level": "Beginner",
        "concepts": ["qubit", "bloch sphere", "phase", "gates"],
        "lessons": ["what-is-a-qubit", "gates-and-circuits"],
    },
    {
        "slug": "entanglement",
        "title": "Entanglement",
        "level": "Intermediate",
        "concepts": ["entanglement", "bell state", "correlation"],
        "lessons": ["entanglement"],
    },
    {
        "slug": "tunneling",
        "title": "Quantum Tunneling",
        "level": "Intermediate",
        "concepts": ["tunneling", "wavefunction", "barrier"],
        "lessons": ["what-is-a-qubit"],
    },
    {
        "slug": "grover",
        "title": "Grover's Search",
        "level": "Intermediate",
        "concepts": ["grover", "amplitude amplification", "oracle", "search"],
        "lessons": ["grover"],
    },
    {
        "slug": "qft",
        "title": "Quantum Fourier Transform",
        "level": "Advanced",
        "concepts": ["qft", "phase", "period finding"],
        "lessons": ["shor"],
    },
    {
        "slug": "decoherence",
        "title": "Decoherence",
        "level": "Advanced",
        "concepts": ["decoherence", "noise", "error correction"],
        "lessons": ["error-correction", "vqe-and-nisq"],
    },
]

#: What each concept presupposes. This is deliberately finer-grained than the
#: lesson prerequisite graph: a recommender walking it backwards from a stated
#: goal ("I want to understand Shor") can find the *earliest* idea the learner
#: has not met yet, rather than simply handing back the next unread lesson.
CONCEPT_DEPENDENCIES: dict[str, list[str]] = {
    "qubit": [],
    "amplitude": ["qubit"],
    "superposition": ["qubit", "amplitude"],
    "measurement": ["superposition"],
    "born rule": ["measurement", "amplitude"],
    "collapse": ["measurement"],
    "phase": ["amplitude", "superposition"],
    "interference": ["superposition", "phase", "measurement"],
    "unitary": ["qubit"],
    "gates": ["interference", "unitary"],
    "hadamard": ["gates"],
    "cnot": ["gates"],
    "bloch sphere": ["qubit", "phase"],
    "entanglement": ["gates", "cnot"],
    "bell state": ["entanglement"],
    "ghz state": ["bell state"],
    "correlation": ["entanglement"],
    "no cloning": ["entanglement", "measurement"],
    "oracle": ["gates", "phase"],
    "amplitude amplification": ["interference", "oracle"],
    "search": ["amplitude amplification"],
    "grover": ["entanglement", "amplitude amplification", "oracle"],
    "qft": ["phase", "interference", "gates"],
    "period finding": ["qft"],
    "factoring": ["period finding"],
    "shor": ["grover", "qft", "period finding", "factoring"],
    "decoherence": ["superposition", "measurement"],
    "noise": ["decoherence"],
    "stabilizer": ["entanglement", "measurement"],
    "error correction": ["shor", "decoherence", "no cloning", "stabilizer"],
    "variational": ["gates"],
    "nisq": ["decoherence", "gates"],
    "vqe": ["gates", "nisq", "variational"],
    "bb84": ["measurement", "no cloning"],
    "cryptography": ["entanglement", "no cloning", "bb84"],
    "tunneling": ["wavefunction", "superposition"],
    "wavefunction": ["qubit"],
    # The tunneling lesson's third concept. Without it concept_chain("barrier")
    # is a KeyError-shaped miss and lesson_for_concept cannot resolve it.
    "barrier": ["tunneling"],
    # Quantum machine learning builds directly on the variational stack: the
    # classifier loop IS the VQE loop with a loss function, and the encoding
    # step is what fixes the model class.
    "data encoding": ["qubit", "amplitude", "gates"],
    "qml": ["vqe", "variational", "data encoding"],
    "quantum kernel": ["data encoding", "measurement"],
}


def get_lesson(slug: str) -> dict[str, Any] | None:
    """Look up a single lesson by its slug.

    Args:
        slug: The lesson slug, e.g. ``"gates-and-circuits"``. Matching is
            case-insensitive and tolerant of surrounding whitespace.

    Returns:
        The lesson dict from :data:`LESSONS`, or ``None`` if no lesson has that
        slug.
    """
    key = (slug or "").strip().lower()
    if not key:
        return None
    for lesson in LESSONS:
        if lesson["slug"] == key:
            return lesson
    return None


def lessons_in_track(track: str) -> list[dict[str, Any]]:
    """List the lessons belonging to one track, in course order.

    Args:
        track: ``"foundations"`` or ``"advanced"``.

    Returns:
        The matching lesson dicts, or ``[]`` for an unknown track name.
    """
    key = (track or "").strip().lower()
    return [lesson for lesson in LESSONS if lesson["track"] == key]


def prerequisites_of(slug: str, *, transitive: bool = False) -> list[str]:
    """List the lessons that should be read before a given lesson.

    Args:
        slug: The lesson slug to inspect.
        transitive: When ``True``, follow the prerequisite chain all the way
            back to the first lesson and return the full ordered path instead of
            only the immediate parents.

    Returns:
        Lesson slugs. Direct prerequisites in declaration order, or — with
        ``transitive=True`` — every ancestor in course order. Unknown slugs
        yield ``[]``.
    """
    lesson = get_lesson(slug)
    if lesson is None:
        return []
    if not transitive:
        return list(lesson["prerequisites"])

    seen: set[str] = set()
    stack: list[str] = list(lesson["prerequisites"])
    while stack:
        current = stack.pop()
        if current in seen:
            continue
        seen.add(current)
        parent = get_lesson(current)
        if parent is not None:
            stack.extend(parent["prerequisites"])
    return [s for s in LESSON_SLUGS if s in seen]


def unlocked_lessons(completed: set[str]) -> list[str]:
    """Find the lessons a learner is ready to start right now.

    A lesson is unlocked when every one of its prerequisites is complete and the
    lesson itself is not. The first lesson of the course has no prerequisites,
    so a learner with no progress at all still gets a sensible answer.

    Args:
        completed: Slugs the learner has finished. Anything unrecognised is
            ignored rather than treated as an error.

    Returns:
        Unlocked slugs in canonical course order.
    """
    done = {str(s).strip().lower() for s in (completed or set())}
    return [
        lesson["slug"]
        for lesson in LESSONS
        if lesson["slug"] not in done and all(p in done for p in lesson["prerequisites"])
    ]


def concept_chain(concept: str) -> list[str]:
    """Return every concept a target concept presupposes, foundations first.

    Walks :data:`CONCEPT_DEPENDENCIES` backwards from ``concept`` and returns
    the transitive closure ordered so that a concept always appears after
    everything it depends on. Cycles and unknown names are handled without
    raising.

    Args:
        concept: The target concept, e.g. ``"shor"``.

    Returns:
        The prerequisite concepts in learning order, followed by ``concept``
        itself. An unknown concept yields ``[]``.
    """
    key = (concept or "").strip().lower()
    if key not in CONCEPT_DEPENDENCIES:
        return []

    ordered: list[str] = []
    visiting: set[str] = set()

    def visit(name: str) -> None:
        if name in ordered or name in visiting:
            return
        visiting.add(name)
        for parent in CONCEPT_DEPENDENCIES.get(name, []):
            visit(parent)
        visiting.discard(name)
        if name not in ordered:
            ordered.append(name)

    visit(key)
    return ordered


def lesson_for_concept(concept: str) -> str | None:
    """Find the earliest lesson that teaches a concept.

    Args:
        concept: A concept name as used in :data:`CONCEPT_DEPENDENCIES` or in a
            lesson's ``concepts`` list.

    Returns:
        The slug of the first lesson in course order whose ``concepts`` include
        it, or ``None`` when no lesson covers it.
    """
    key = (concept or "").strip().lower()
    if not key:
        return None
    for lesson in LESSONS:
        if key in lesson["concepts"]:
            return lesson["slug"]
    for lesson in LESSONS:
        if key == lesson["slug"]:
            return lesson["slug"]
    return None
