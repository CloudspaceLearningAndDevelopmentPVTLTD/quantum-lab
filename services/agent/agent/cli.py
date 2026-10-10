"""Interactive terminal REPL for the QuantumMind tutor.

Run it with::

    python -m agent.cli

Commands:
    /level <beginner|intermediate|advanced>   change the teaching depth
    /help                                     show the command list
    /quit                                     exit

Without a provider key (``GEMINI_API_KEY``, ``GROQ_API_KEY``, or
``ANTHROPIC_API_KEY``) the REPL prints setup instructions and offers a
degraded mode that answers from the local knowledge base, so it stays useful
offline.
"""

from __future__ import annotations

import sys
from typing import Any

from agent import core
from agent.tools import _search_concepts_impl

__all__ = ["main", "run_repl"]

_DIM = "\033[2m"
_BOLD = "\033[1m"
_RESET = "\033[0m"

_LEVELS = ("beginner", "intermediate", "advanced")

_HELP = """Commands:
  /level <beginner|intermediate|advanced>   set the teaching depth
  /help                                     show this message
  /quit                                     exit
Anything else is sent to the tutor."""


def _dim(text: str) -> str:
    """Wrap text in ANSI dim styling.

    Args:
        text: The text to style.

    Returns:
        The text with dim escape codes, or unchanged if stdout is not a TTY.
    """
    if not sys.stdout.isatty():
        return text
    return f"{_DIM}{text}{_RESET}"


def _bold(text: str) -> str:
    """Wrap text in ANSI bold styling.

    Args:
        text: The text to style.

    Returns:
        The text with bold escape codes, or unchanged if stdout is not a TTY.
    """
    if not sys.stdout.isatty():
        return text
    return f"{_BOLD}{text}{_RESET}"


def run_repl(level: str = "beginner", degraded: bool = False) -> int:
    """Run the interactive tutoring loop until the user quits.

    Args:
        level: Initial learner level.
        degraded: When ``True``, skip the LLM entirely and answer from the
            local knowledge base only.

    Returns:
        A process exit code (always 0).
    """
    history: list[dict[str, str]] = []

    print(_bold("QuantumMind — Qubit16 tutor"))
    if degraded:
        print(_dim("Degraded mode: answering from the local knowledge base only."))
    print(_dim(f"Level: {level}. Type /help for commands, /quit to exit."))
    print()

    while True:
        try:
            raw = input(_bold("you > ")).strip()
        except (EOFError, KeyboardInterrupt):
            print()
            return 0

        if not raw:
            continue

        if raw.startswith("/"):
            command, _, argument = raw[1:].partition(" ")
            command = command.lower()
            argument = argument.strip().lower()

            if command in {"quit", "exit", "q"}:
                return 0
            if command == "help":
                print(_HELP)
                print()
                continue
            if command == "level":
                if argument in _LEVELS:
                    level = argument
                    print(_dim(f"Level set to {level}."))
                else:
                    print(_dim(f"Unknown level {argument!r}. Choose one of: {', '.join(_LEVELS)}."))
                print()
                continue

            print(_dim(f"Unknown command /{command}. Type /help."))
            print()
            continue

        if degraded:
            print()
            print(_search_concepts_impl(raw))
            print()
            print(_dim("(knowledge base only — no API key configured)"))
            print()
            continue

        try:
            result: dict[str, Any] = core.ask(raw, level=level, history=history)
        except RuntimeError as exc:
            print()
            print(str(exc))
            print()
            continue
        except Exception as exc:  # noqa: BLE001 - keep the REPL alive
            print()
            print(_dim(f"Error talking to the tutor: {type(exc).__name__}: {exc}"))
            print()
            continue

        reply = result.get("reply", "")
        tools_used = result.get("tools_used", [])

        print()
        print(reply)
        if tools_used:
            print(_dim(f"tools used: {', '.join(tools_used)}"))
        else:
            print(_dim("tools used: none"))
        print()

        history.append({"role": "user", "content": raw})
        history.append({"role": "assistant", "content": reply})


def main() -> int:
    """Entry point for ``python -m agent.cli``.

    Returns:
        A process exit code.
    """
    if core.is_configured():
        return run_repl()

    print(core.SETUP_MESSAGE)
    print()
    try:
        answer = input("Start in degraded mode (knowledge base only)? [Y/n] ").strip().lower()
    except (EOFError, KeyboardInterrupt):
        print()
        return 1

    if answer in {"", "y", "yes"}:
        print()
        return run_repl(degraded=True)

    return 1


if __name__ == "__main__":
    raise SystemExit(main())
