"""Attach `vmx` envelope fields to every outgoing agent request via
the Claude Code CLI's `ANTHROPIC_CUSTOM_HEADERS` env var.

The CLI reads `ANTHROPIC_CUSTOM_HEADERS` (newline-separated
`Name: Value` pairs) and forwards the headers verbatim. VM-X maps
the `x-vmx-*` headers back onto a `vmx` envelope on the canonical
request body.

Only `correlationId` and `metadata` are header-readable today.
Body-only fields (`resourceConfigOverrides`, `providerArgs`,
`secondaryModelIndex`, `timeoutMs`) aren't available with the Agent
SDK because the CLI fully owns the request body.

Run with:

    pnpm exec nx run claude-agent-sdk-python-example:vmx-envelope
"""

from __future__ import annotations

import asyncio
import time

from claude_agent_sdk import ClaudeAgentOptions, query

from .config import load, options_env


def vmx_header_env(headers: dict[str, str]) -> str:
    return "\n".join(f"{k}: {v}" for k, v in headers.items())


async def main() -> None:
    cfg = load()

    env = options_env(cfg)
    env["ANTHROPIC_CUSTOM_HEADERS"] = vmx_header_env(
        {
            "x-vmx-correlation-id": (
                f"claude-agent-sdk-python-example-{int(time.time() * 1000)}"
            ),
            "x-vmx-metadata-team": "growth",
            "x-vmx-metadata-user_id": "u_42",
            "x-vmx-metadata-feature": "claude-agent-sdk-python-vmx-example",
        }
    )

    options = ClaudeAgentOptions(env=env, model=cfg.anthropic_resource)

    async for message in query(prompt="Say hi in three words.", options=options):
        content = getattr(message, "content", None) or getattr(
            getattr(message, "message", None), "content", None
        )
        if not isinstance(content, list):
            continue
        for block in content:
            text = getattr(block, "text", None)
            if text:
                print(f"[{type(message).__name__}] -> {text}")


if __name__ == "__main__":
    asyncio.run(main())
