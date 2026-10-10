package ai.qubit16.app.widget

/**
 * A small, hand-picked, offline mirror of a few entries from
 * apps/web/lib/glossary/terms.ts — not a sync of the whole 62-term glossary,
 * on purpose. The widget has no network access and no JS bridge into the web
 * app's storage (they are different engines by design; that separation is
 * what keeps the TWA architecture simple), so this list is deliberately
 * small, curated for "good on a home screen", and manually kept in step with
 * the real glossary rather than automated — a wrong or stale tip here is a
 * cosmetic annoyance, not a broken feature, so the cost of drift is low and
 * the cost of a build-time sync pipeline for ~20 short strings is not worth
 * paying.
 *
 * If a term's `short` wording changes meaningfully in the web glossary,
 * update its copy here too. Each `path` must be a real fragment on
 * /glossary — glossary/terms.test.ts on the web side does not know this file
 * exists, so this is not enforced by a test; check it by hand.
 */
data class GlossaryTip(val term: String, val short: String, val path: String)

object GlossaryTips {
    val ALL: List<GlossaryTip> = listOf(
        GlossaryTip(
            "Superposition",
            "Not “both states at once” — it's a single, definite state that simply isn't one of the basis states you chose to measure in.",
            "#superposition",
        ),
        GlossaryTip(
            "Entanglement",
            "A correlation so strong the whole has a definite state while the parts don't — but no message can travel through it.",
            "#entanglement",
        ),
        GlossaryTip(
            "Amplitude",
            "Unlike a probability, an amplitude can be negative. Two paths to the same outcome can cancel — that's interference.",
            "#amplitude",
        ),
        GlossaryTip(
            "Quantum tunnelling",
            "A particle crossing a barrier it classically couldn't climb. Your flash drive relies on it right now.",
            "#tunneling",
        ),
        GlossaryTip(
            "Bell state",
            "The simplest entangled pair: one Hadamard, one CNOT. Measure either qubit and the other's result is fixed.",
            "#bell-state",
        ),
        GlossaryTip(
            "Qubit",
            "Better pictured as a direction than a switch — a continuum of possible states, one classical bit out on measurement.",
            "#qubit",
        ),
        GlossaryTip(
            "Interference",
            "The actual source of quantum speedups: an algorithm arranged so wrong answers cancel and right ones reinforce.",
            "#interference",
        ),
        GlossaryTip(
            "Decoherence",
            "Nothing mysteriously collapses — information just leaks into the environment. It's the main engineering obstacle in the field.",
            "#decoherence",
        ),
        GlossaryTip(
            "No-cloning theorem",
            "There is no process that copies an arbitrary unknown quantum state. It follows straight from linearity.",
            "#no-cloning",
        ),
        GlossaryTip(
            "Grover's algorithm",
            "Finds a marked item among N in about √N steps — but it's a rotation, not a search, so it can overshoot.",
            "#grover",
        ),
        GlossaryTip(
            "Shor's algorithm",
            "Factors integers in polynomial time by finding a period with a quantum Fourier transform. Still needs a machine that doesn't exist yet.",
            "#shor",
        ),
        GlossaryTip(
            "Quantum teleportation",
            "Moves a qubit's state using a shared Bell pair and two classical bits. The original is destroyed — no message beats light speed.",
            "#teleportation",
        ),
        GlossaryTip(
            "Uncertainty principle",
            "A property of the state itself, not clumsy measurement: a narrow position wave is necessarily a broad momentum one.",
            "#uncertainty-principle",
        ),
        GlossaryTip(
            "Phase kickback",
            "A controlled gate on an eigenstate target puts the phase on the CONTROL qubit instead. Backwards — and behind most quantum speedups.",
            "#phase-kickback",
        ),
        GlossaryTip(
            "Surface code",
            "The leading error-correcting code candidate: laid out on a 2D grid, needing only nearest-neighbour interactions.",
            "#surface-code",
        ),
        GlossaryTip(
            "Error threshold",
            "Below this physical error rate, a bigger code makes logical errors RARER. Above it, a bigger code just collects more errors.",
            "#threshold",
        ),
        GlossaryTip(
            "VQE",
            "Prepares a trial state, measures its energy, and lets a classical optimiser tune it — hybrid quantum-classical computing.",
            "#vqe",
        ),
        GlossaryTip(
            "Wave–particle duality",
            "Electrons sent one at a time still build an interference pattern — until you check which slit they went through.",
            "#wave-particle-duality",
        ),
        GlossaryTip(
            "Post-quantum cryptography",
            "Classical cryptography built to resist quantum attack, running on hardware you already own. NIST standardised three schemes in 2024.",
            "#post-quantum-cryptography",
        ),
        GlossaryTip(
            "Bloch sphere",
            "Every state of a single qubit is one point on this sphere, and every single-qubit gate is a rotation of it.",
            "#bloch-sphere",
        ),
    )

    /** A stable, deterministic pick for a given day — same tip all day, everywhere. */
    fun forDayOfYear(dayOfYear: Int): GlossaryTip = ALL[((dayOfYear - 1) % ALL.size + ALL.size) % ALL.size]
}
