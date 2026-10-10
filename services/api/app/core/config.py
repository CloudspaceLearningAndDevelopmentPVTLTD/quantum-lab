"""Application configuration loaded from the environment and an optional .env file."""

from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime settings for the Qubit16 API.

    Every field can be supplied as an environment variable of the same name
    (case-insensitive) or via a ``.env`` file sitting next to the process CWD.
    Secrets default to ``None`` so the service starts fine without them; the
    backends that need them simply report themselves as unavailable.
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        extra="ignore",
        case_sensitive=False,
    )

    anthropic_api_key: str | None = None
    ibm_quantum_token: str | None = None
    aws_access_key_id: str | None = None

    # ── IBM Quantum Platform addressing ──────────────────────────────────
    # A token alone is not enough to reach a real IBM account any more.
    #
    # The legacy `ibm_quantum` channel (the one that took a bare token and
    # resolved hub/group/project for you) was retired in 2025. Its successor,
    # `ibm_quantum_platform`, addresses work to a **service instance** on IBM
    # Cloud, identified by a CRN like
    #
    #     crn:v1:bluemix:public:quantum-computing:us-east:a/<account>:<guid>::
    #
    # Omitting it is not a hard error, which is exactly why it went unnoticed:
    # the SDK falls back to enumerating every instance the token can see and
    # picking one. On an account with a single instance that silently works.
    # On an account with several — the normal shape once an organisation has
    # both an Open plan and a paid one — it picks the first, so a submission
    # meant for paid hardware can land on a queue with a different allowance
    # and a different bill, and a poll issued against the other instance
    # answers "job not found" for a job that plainly exists. Setting this
    # makes the target explicit and also skips the enumeration round trip on
    # every service construction.
    #
    # Unset stays supported and unchanged: single-instance accounts and local
    # development keep working with just a token.
    ibm_quantum_instance: str | None = None

    #: Overridable for IBM Cloud regions other than the SDK default
    #: (e.g. "eu-de"). Ignored when None.
    ibm_quantum_region: str | None = None

    #: The channel to open. Only override to pin a non-default deployment;
    #: `ibm_quantum_platform` is the current public channel.
    ibm_quantum_channel: str = "ibm_quantum_platform"

    #: OPTIONAL shared secret. Unset (the default) means this service is
    #: entirely unauthenticated, exactly as it has always been. Set it and every
    #: request must carry it in the X-Quantum-Lab-Secret header. Read
    #: app/core/security.py before turning this on — the browser currently calls
    #: this API directly, and a secret a browser holds is not a secret.
    api_shared_secret: str | None = None

    allowed_origins: str = "http://localhost:3000"
    default_backend: str = "aer_simulator"
    max_shots: int = 20000
    max_qubits: int = 24

    @property
    def origins_list(self) -> list[str]:
        """Return ``allowed_origins`` split on commas, stripped and de-blanked.

        SECURITY FIX (audit finding CORS-1). A wildcard is refused outright.

        The middleware in ``app.main`` sets ``allow_credentials=True``, and
        ``ALLOWED_ORIGINS=*`` combined with that is credentialed any-origin
        access: any page on the internet could call this API from a visitor's
        browser and read the response. It is one character to type in a
        deployment console and it looks like "allow everything, it's only a
        simulator" — which is why it fails loudly here rather than being
        silently narrowed to something the operator did not ask for.

        Returns:
            The list of CORS origins configured for this deployment.

        Raises:
            ValueError: If any entry is ``*``. The service refuses to start.
        """
        origins = [origin.strip() for origin in self.allowed_origins.split(",") if origin.strip()]
        if any(origin == "*" for origin in origins):
            raise ValueError(
                "ALLOWED_ORIGINS may not contain '*'. This API sends CORS "
                "responses with allow_credentials=True, and a wildcard origin "
                "combined with credentials lets any site on the internet call "
                "it from a visitor's browser. Set ALLOWED_ORIGINS to your app "
                "origin, e.g. ALLOWED_ORIGINS=https://your-domain.example "
                "(comma-separate several)."
            )
        return origins


settings = Settings()
