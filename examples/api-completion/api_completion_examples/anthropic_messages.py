"""Runnable mirror of the docs at `docs/docs/features/api/anthropic-messages.md`.

Run with:

    pnpm exec nx run api-completion-example:anthropic-messages
"""

from __future__ import annotations

import json

import anthropic

from .config import load


def _client(cfg) -> anthropic.Anthropic:
    return anthropic.Anthropic(
        api_key=cfg.api_key,
        base_url=cfg.base_anthropic_url,
    )


def _text(message) -> str:
    return "".join(b.text for b in message.content if b.type == "text")


def quick_start(cfg) -> None:
    client = _client(cfg)
    message = client.messages.create(
        model=cfg.anthropic_resource,
        max_tokens=512,
        messages=[{"role": "user", "content": "Hello!"}],
    )
    print(f"[quick_start] -> {_text(message)!r}")


def system_prompt(cfg) -> None:
    client = _client(cfg)
    message = client.messages.create(
        model=cfg.anthropic_resource,
        max_tokens=256,
        system="You are a concise senior engineer.",
        messages=[{"role": "user", "content": "Why are mutexes hard?"}],
    )
    print(f"[system_prompt] -> {_text(message)[:80]!r}")


def multi_turn(cfg) -> None:
    client = _client(cfg)
    message = client.messages.create(
        model=cfg.anthropic_resource,
        max_tokens=128,
        messages=[
            {"role": "user", "content": "My name is Lucas."},
            {"role": "assistant", "content": "Hello, Lucas."},
            {"role": "user", "content": "What's my name?"},
        ],
    )
    print(f"[multi_turn] -> {_text(message)!r}")


def tool_use_round_trip(cfg) -> None:
    client = _client(cfg)
    tools = [
        {
            "name": "get_weather",
            "description": "Get the current weather in a city",
            "input_schema": {
                "type": "object",
                "properties": {"location": {"type": "string"}},
                "required": ["location"],
            },
        }
    ]
    first = client.messages.create(
        model=cfg.anthropic_resource,
        max_tokens=512,
        tools=tools,
        tool_choice={"type": "any"},
        messages=[{"role": "user", "content": "Weather in Tokyo?"}],
    )
    tu = next((b for b in first.content if b.type == "tool_use"), None)
    assert tu is not None, "expected a tool_use block"
    final = client.messages.create(
        model=cfg.anthropic_resource,
        max_tokens=512,
        tools=tools,
        messages=[
            {"role": "user", "content": "Weather in Tokyo?"},
            {"role": "assistant", "content": [b.model_dump() for b in first.content]},
            {
                "role": "user",
                "content": [
                    {
                        "type": "tool_result",
                        "tool_use_id": tu.id,
                        "content": json.dumps({"temp_c": 22, "conditions": "clear"}),
                    }
                ],
            },
        ],
    )
    print(f"[tool_use_round_trip] tool={tu.name} input={tu.input} "
          f"-> {_text(final)[:80]!r}")


def cache_control(cfg) -> None:
    client = _client(cfg)
    system_block = (
        "You are answering questions about a single, large document. " * 200
    )
    first = client.messages.create(
        model=cfg.anthropic_resource,
        max_tokens=128,
        system=[
            {
                "type": "text",
                "text": system_block,
                "cache_control": {"type": "ephemeral"},
            }
        ],
        messages=[{"role": "user", "content": "Who's it about?"}],
    )
    second = client.messages.create(
        model=cfg.anthropic_resource,
        max_tokens=128,
        system=[
            {
                "type": "text",
                "text": system_block,
                "cache_control": {"type": "ephemeral"},
            }
        ],
        messages=[{"role": "user", "content": "Three keywords?"}],
    )
    print(f"[cache_control] write={first.usage.cache_creation_input_tokens} "
          f"read={second.usage.cache_read_input_tokens}")


def thinking(cfg) -> None:
    """Adaptive thinking on Claude Haiku 4.5 (the seeded resource).

    Haiku 4.5 supports adaptive thinking. The model decides how much
    to think; we just check that we got back at least one thinking
    block alongside the final text.
    """
    client = _client(cfg)
    message = client.messages.create(
        model=cfg.anthropic_resource,
        max_tokens=2048,
        thinking={"type": "enabled", "budget_tokens": 1024},
        messages=[
            {
                "role": "user",
                "content": "Quick: prove there are infinitely many primes.",
            }
        ],
    )
    has_thinking = any(b.type == "thinking" for b in message.content)
    print(f"[thinking] thinking_block={has_thinking} text_len={len(_text(message))}")


def server_tool_web_search(cfg) -> None:
    client = _client(cfg)
    message = client.messages.create(
        model=cfg.anthropic_resource,
        max_tokens=2048,
        messages=[
            {"role": "user", "content": "Latest TypeScript release? Cite sources."}
        ],
        tools=[
            {
                "type": "web_search_20250305",
                "name": "web_search",
                "max_uses": 2,
            }
        ],
    )
    has_search = any(
        b.type in {"web_search_tool_result", "server_tool_use"}
        for b in message.content
    )
    print(f"[server_tool_web_search] used_tool={has_search} "
          f"text_preview={_text(message)[:80]!r}")


def streaming_text(cfg) -> None:
    client = _client(cfg)
    text = ""
    chunks = 0
    with client.messages.stream(
        model=cfg.anthropic_resource,
        max_tokens=512,
        messages=[{"role": "user", "content": "Stream the word 'streamed' once."}],
    ) as stream:
        for chunk in stream.text_stream:
            chunks += 1
            text += chunk
    print(f"[streaming_text] chunks={chunks} text={text!r}")


def betas_lift(cfg) -> None:
    """`betas` body field becomes the `anthropic-beta` header on the wire.

    The seeded Haiku resource doesn't use any beta features for the
    interleaved-thinking flag specifically, so the call should still
    succeed even if the beta is irrelevant — we just verify the gateway
    accepts the body field.
    """
    client = _client(cfg)
    message = client.messages.create(
        model=cfg.anthropic_resource,
        max_tokens=512,
        messages=[{"role": "user", "content": "Say hi."}],
        extra_body={"betas": ["interleaved-thinking-2025-05-14"]},
    )
    print(f"[betas_lift] accepted; text={_text(message)[:60]!r}")


def vmx_metadata(cfg) -> None:
    client = _client(cfg)
    message = client.messages.create(
        model=cfg.anthropic_resource,
        max_tokens=512,
        messages=[{"role": "user", "content": "Summarise: VM-X is a gateway."}],
        extra_body={
            "vmx": {
                "correlationId": "summarizer-2026-05-10",
                "metadata": {"team": "growth", "user_id": "u_42"},
                "timeoutMs": 25_000,
            }
        },
    )
    response_dict = message.model_dump()
    vmx = response_dict.get("vmx", {})
    metrics = vmx.get("metrics")
    print(f"[vmx_metadata] -> text={_text(message)[:60]!r} metrics={metrics}")


def main() -> None:
    cfg = load()
    if not cfg.anthropic_resource:
        print("[anthropic_messages] no anthropic resource configured — skipping all")
        return
    quick_start(cfg)
    system_prompt(cfg)
    multi_turn(cfg)
    tool_use_round_trip(cfg)
    cache_control(cfg)
    thinking(cfg)
    server_tool_web_search(cfg)
    streaming_text(cfg)
    betas_lift(cfg)
    vmx_metadata(cfg)


if __name__ == "__main__":
    main()
