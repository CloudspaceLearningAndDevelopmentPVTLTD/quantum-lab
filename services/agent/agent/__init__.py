"""Qubit16 AI tutor agent service.

This package contains the agentic layer of Qubit16: an LLM tutor
("QuantumMind") that teaches quantum computing by actually running circuits
instead of guessing at their outcomes.

Layout:
    config      Settings loaded from the environment / .env.
    prompts     System prompt and per-level guidance.
    knowledge   Dependency-free mini knowledge base of quantum concepts.
    tools       Tool implementations (usable standalone, no API key needed).
    core        LangChain agent construction and the ``ask`` entry point.
    server      FastAPI HTTP surface.
    cli         Interactive REPL.

Only :mod:`agent.core` and :mod:`agent.server` require ``ANTHROPIC_API_KEY``,
and they only complain when they are actually called.
"""

__all__ = ["__version__"]

__version__ = "0.1.0"
