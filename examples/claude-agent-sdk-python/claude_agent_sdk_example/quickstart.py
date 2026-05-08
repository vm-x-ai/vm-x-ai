"""Hello-world Claude Agent SDK call through a VM-X gateway.

Run with:

    pnpm exec nx run claude-agent-sdk-python-example:quickstart
"""

from __future__ import annotations

import asyncio

from claude_agent_sdk import ClaudeAgentOptions, query

from .config import load, options_env


async def main() -> None:
    cfg = load()
    options = ClaudeAgentOptions(
        env=options_env(cfg),
        model=cfg.anthropic_resource,
    )

    async for message in query(prompt="Say hi in three words.", options=options):
        # The SDK yields `system` (init), `assistant`, `user` (tool
        # results), and `result` messages. We only care about printing
        # assistant text here.
        msg_type = type(message).__name__
        content = getattr(message, "content", None) or getattr(
            getattr(message, "message", None), "content", None
        )
        if content is None:
            continue
        text_blocks = [
            getattr(b, "text", None)
            for b in (content if isinstance(content, list) else [])
            if getattr(b, "text", None) is not None
        ]
        if text_blocks:
            print(f"[{msg_type}] -> {''.join(text_blocks)}")


if __name__ == "__main__":
    asyncio.run(main())
