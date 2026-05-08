"""Runnable mirror of the docs at `docs/docs/features/api/responses.md`.

Run with:

    pnpm exec nx run api-completion-example:responses
"""

from __future__ import annotations

import json

from openai import BadRequestError, OpenAI

from .config import load


def _client(cfg) -> OpenAI:
    return OpenAI(api_key=cfg.api_key, base_url=cfg.base_completion_url)


def _extract_text(response) -> str:
    """Concatenate every output_text content part."""
    out = []
    for item in response.output:
        if item.type == "message":
            for part in item.content:
                if part.type == "output_text":
                    out.append(part.text)
    return "".join(out)


def quick_start(cfg) -> None:
    client = _client(cfg)
    response = client.responses.create(
        model=cfg.openai_resource,
        input="Hello!",
        instructions="Be concise.",
    )
    print(f"[quick_start] -> {_extract_text(response)!r}")


def multi_message_input(cfg) -> None:
    client = _client(cfg)
    response = client.responses.create(
        model=cfg.openai_resource,
        input=[
            {
                "type": "message",
                "role": "user",
                "content": [{"type": "input_text", "text": "My name is Lucas."}],
            },
            {
                "type": "message",
                "role": "assistant",
                "content": [
                    {"type": "output_text", "text": "Hello, Lucas. How can I help?"}
                ],
            },
            {
                "type": "message",
                "role": "user",
                "content": [{"type": "input_text", "text": "What's my name?"}],
            },
        ],
    )
    print(f"[multi_message_input] -> {_extract_text(response)!r}")


def function_tools(cfg) -> tuple[OpenAI, object]:
    client = _client(cfg)
    response = client.responses.create(
        model=cfg.openai_resource,
        input="Weather in Tokyo?",
        tools=[
            {
                "type": "function",
                "name": "get_weather",
                "description": "Get current weather for a city.",
                "parameters": {
                    "type": "object",
                    "properties": {"location": {"type": "string"}},
                    "required": ["location"],
                },
            }
        ],
        tool_choice="required",
    )
    fc = next((o for o in response.output if o.type == "function_call"), None)
    assert fc is not None, "expected a function_call output item"
    print(f"[function_tools] {fc.name}({fc.arguments})")
    return client, fc


def tool_round_trip(cfg, client: OpenAI, fc) -> None:
    final = client.responses.create(
        model=cfg.openai_resource,
        input=[
            {
                "type": "message",
                "role": "user",
                "content": [{"type": "input_text", "text": "Weather in Tokyo?"}],
            },
            fc.model_dump(),
            {
                "type": "function_call_output",
                "call_id": fc.call_id,
                "output": json.dumps({"temp_c": 22, "conditions": "clear"}),
            },
        ],
    )
    print(f"[tool_round_trip] -> {_extract_text(final)!r}")


def reasoning_effort(cfg) -> None:
    """The seeded openai resource uses gpt-4o-mini, which doesn't support
    reasoning. Skip with a note rather than fail — the doc snippet itself
    needs a reasoning-capable resource.
    """
    print("[reasoning_effort] skipped (gpt-4o-mini doesn't support reasoning)")


def web_search(cfg) -> None:
    """Hosted web_search needs a search-capable OpenAI model.

    The seeded `openai-search` resource pins `gpt-5-search-api` for that
    purpose. The general-purpose `openai` resource (gpt-4o-mini) doesn't
    support hosted tools.
    """
    if not cfg.openai_search_resource:
        print("[web_search] skipped: no openai-search resource seeded")
        return
    client = _client(cfg)
    try:
        response = client.responses.create(
            model=cfg.openai_search_resource,
            input="What's the latest version of TypeScript? Cite sources.",
            tools=[{"type": "web_search"}],
        )
    except BadRequestError as exc:
        print(f"[web_search] failed: {exc.message[:120]}")
        return
    text = _extract_text(response)
    has_search_call = any(
        getattr(o, "type", None) in {"web_search_call", "web_search"}
        for o in response.output
    )
    print(f"[web_search] used_tool={has_search_call} text_preview={text[:80]!r}")


def streaming(cfg) -> None:
    client = _client(cfg)
    stream = client.responses.create(
        model=cfg.openai_resource,
        input="Stream the word 'streamed' once.",
        stream=True,
    )
    deltas = 0
    text = ""
    seen_completed = False
    for event in stream:
        if event.type == "response.output_text.delta":
            deltas += 1
            text += event.delta
        elif event.type == "response.completed":
            seen_completed = True
    print(f"[streaming] deltas={deltas} completed={seen_completed} text={text!r}")


def vmx_metadata(cfg) -> None:
    client = _client(cfg)
    response = client.responses.create(
        model=cfg.openai_resource,
        input="Pick a number 1-10.",
        extra_body={
            "vmx": {
                "correlationId": "agent-run-2026-05-10-abc",
                "metadata": {"team": "growth", "experiment": "exp_42"},
                "timeoutMs": 30_000,
            }
        },
    )
    response_dict = response.model_dump()
    vmx = response_dict.get("vmx", {})
    print(f"[vmx_metadata] -> text={_extract_text(response)!r} "
          f"vmx_metrics={vmx.get('metrics')}")


def main() -> None:
    cfg = load()
    quick_start(cfg)
    multi_message_input(cfg)
    client, fc = function_tools(cfg)
    tool_round_trip(cfg, client, fc)
    reasoning_effort(cfg)
    web_search(cfg)
    streaming(cfg)
    vmx_metadata(cfg)


if __name__ == "__main__":
    main()
