"""Claude Agent SDK with an in-process custom tool, routed through VM-X.

The agent calls a Python function via the in-process MCP server the SDK
creates for us; the model's tool calls + tool results flow through the
agentic loop transparently.

Run with:

    pnpm exec nx run claude-agent-sdk-python-example:tools
"""

from __future__ import annotations

import asyncio

from claude_agent_sdk import (
    ClaudeAgentOptions,
    create_sdk_mcp_server,
    query,
    tool,
)

from .config import load, options_env


@tool("get_weather", "Get the current weather for a city", {"city": str})
async def get_weather(args: dict) -> dict:
    city = (args.get("city") or "").lower()
    if "são paulo" in city or "sao paulo" in city:
        result = "São Paulo: 22°C, cloudy"
    elif "rio" in city:
        result = "Rio de Janeiro: 28°C, sunny"
    else:
        result = f"{args.get('city', 'unknown')}: temperature unknown"
    return {"content": [{"type": "text", "text": result}]}


async def main() -> None:
    cfg = load()
    server = create_sdk_mcp_server(
        name="weather", version="1.0.0", tools=[get_weather]
    )

    options = ClaudeAgentOptions(
        env=options_env(cfg),
        model=cfg.anthropic_resource,
        mcp_servers={"weather": server},
        allowed_tools=["mcp__weather__get_weather"],
    )

    prompt = (
        "What is the weather in São Paulo and Rio de Janeiro? "
        "Use the get_weather tool for each city."
    )
    async for message in query(prompt=prompt, options=options):
        msg_type = type(message).__name__
        content = getattr(message, "content", None) or getattr(
            getattr(message, "message", None), "content", None
        )
        if content is None or not isinstance(content, list):
            continue
        for block in content:
            text = getattr(block, "text", None)
            if text:
                print(f"[{msg_type}] -> {text}")
                continue
            name = getattr(block, "name", None)
            inp = getattr(block, "input", None)
            if name is not None:
                print(f"[{msg_type}] tool_use -> {name}({inp!r})")


if __name__ == "__main__":
    asyncio.run(main())
