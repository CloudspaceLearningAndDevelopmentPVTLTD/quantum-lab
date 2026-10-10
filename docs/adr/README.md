# Decision records

Short write-ups of calls that look arbitrary from the outside and are not. Each one names the
failure that motivated it, because a decision without its failure is just a preference, and a
preference is the kind of thing a newcomer reverses on a quiet afternoon.

Every ADR here is **accepted and live in the code**. If you are about to undo one, the ADR is the
argument you have to beat.

| # | Decision | One-line reason |
| --- | --- | --- |
| [0001](0001-no-light-dark-for-design-tokens.md) | No `light-dark()` in the design tokens | A custom property's computed value is an unresolved token stream; the canvas gets a literal string and paints nothing |
| [0002](0002-button-only-violet-fill-token.md) | A button-only violet fill token | `--q-violet` is read at runtime by visualizations and is chart series 1, so it could not be darkened for contrast |
| [0003](0003-qubit-0-is-the-lsb-with-msb-first-labels.md) | Qubit 0 is the LSB, labels print MSB-first | Two paths render the same histogram; Qiskit's convention is the one the world already reads |
| [0004](0004-exact-pi-fractions-in-qasm-export.md) | Exact π fractions in QASM export | `toFixed(6)` drifted a teleportation circuit's probabilities ~5e-8 per round trip |
| [0005](0005-entitlements-are-enforced-server-side-only.md) | Entitlements are enforced server-side only | Every gate in the product was once a client component; the paid track was served in full to `curl` |
| [0006](0006-lesson-bodies-are-server-only-modules.md) | Lesson bodies live in server-only modules | A bundler cannot drop a property of a reachable object literal, so the paid course shipped in every page's JS |
| [0007](0007-canvas-colours-are-read-at-runtime.md) | Canvases resolve colour from CSS custom properties at runtime | `ctx.fillStyle` takes a colour string, not a variable — hardcoding one is how a light theme paints black on black |
| [0008](0008-invite-tokens-are-random-and-hashed-not-hmac.md) | Invite tokens are random + hashed, not an HMAC | Single use is the property that matters, and single use needs a row anyway |
| [0009](0009-the-tutor-degrades-in-three-visible-tiers.md) | The tutor degrades in three tiers, and says which one answered | "You always get a reply" is only honest if the reply's provenance is on screen |

## Writing another one

Keep it to one page. The template is: **Context** (what was true), **The failure** (what actually
went wrong, with a number if there is one), **Decision**, **Consequences** (including the ones you
do not like), **What must not be undone**.

Do not write an ADR for a decision nobody would reverse. The list is useful because everything on
it is genuinely reversible by a well-meaning person who does not know what happened.
