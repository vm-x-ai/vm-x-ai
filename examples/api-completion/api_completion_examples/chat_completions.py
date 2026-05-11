"""Runnable mirror of the docs at `docs/docs/features/api/chat-completions.md`.

Every snippet shown in that doc is exercised here against the local
gateway. Run with:

    pnpm exec nx run api-completion-example:chat-completions

Each scenario logs a one-line summary so the test pass is visible. If
the gateway is up and `setup` has been run, the whole file should finish
in a few seconds.
"""

from __future__ import annotations

import json

from openai import OpenAI

from .config import load


def _client(cfg) -> OpenAI:
    return OpenAI(api_key=cfg.api_key, base_url=cfg.base_completion_url)


def quick_start(cfg) -> None:
    client = _client(cfg)
    response = client.chat.completions.create(
        model=cfg.openai_resource,
        messages=[{"role": "user", "content": "Hello!"}],
    )
    print(f"[quick_start] -> {response.choices[0].message.content!r}")


def system_and_multi_turn(cfg) -> None:
    client = _client(cfg)
    response = client.chat.completions.create(
        model=cfg.openai_resource,
        messages=[
            {"role": "system", "content": "You are a concise senior engineer."},
            {"role": "user", "content": "My name is Lucas."},
            {"role": "assistant", "content": "Got it, Lucas."},
            {"role": "user", "content": "What's my name?"},
        ],
    )
    print(f"[system_and_multi_turn] -> {response.choices[0].message.content!r}")


def tool_calling(cfg) -> None:
    client = _client(cfg)
    tools = [
        {
            "type": "function",
            "function": {
                "name": "get_weather",
                "description": "Get the current weather for a city.",
                "parameters": {
                    "type": "object",
                    "properties": {"location": {"type": "string"}},
                    "required": ["location"],
                },
            },
        }
    ]

    first = client.chat.completions.create(
        model=cfg.openai_resource,
        messages=[{"role": "user", "content": "Weather in Tokyo?"}],
        tools=tools,
        tool_choice="required",
    )
    tool_calls = first.choices[0].message.tool_calls or []
    assert tool_calls, "expected the model to emit a tool_call"
    tc = tool_calls[0]
    weather = {"temp_c": 22, "conditions": "clear"}

    final = client.chat.completions.create(
        model=cfg.openai_resource,
        messages=[
            {"role": "user", "content": "Weather in Tokyo?"},
            first.choices[0].message,
            {"role": "tool", "tool_call_id": tc.id, "content": json.dumps(weather)},
        ],
        tools=tools,
    )
    print(f"[tool_calling] tool_call={tc.function.name}({tc.function.arguments}) "
          f"-> {final.choices[0].message.content!r}")


def streaming(cfg) -> None:
    client = _client(cfg)
    stream = client.chat.completions.create(
        model=cfg.openai_resource,
        messages=[{"role": "user", "content": "Stream the word 'streamed' once."}],
        stream=True,
    )
    chunks = 0
    text = ""
    for chunk in stream:
        chunks += 1
        delta = (chunk.choices[0].delta.content if chunk.choices else "") or ""
        text += delta
    print(f"[streaming] received {chunks} chunks, text={text!r}")


def json_object_mode(cfg) -> None:
    client = _client(cfg)
    response = client.chat.completions.create(
        model=cfg.openai_resource,
        messages=[
            {"role": "system", "content": "Respond ONLY in valid JSON."},
            {
                "role": "user",
                "content": "Give me a 3-key object describing TypeScript.",
            },
        ],
        response_format={"type": "json_object"},
    )
    payload = json.loads(response.choices[0].message.content or "{}")
    print(f"[json_object_mode] keys={sorted(payload.keys())}")


def json_schema_mode(cfg) -> None:
    client = _client(cfg)
    response = client.chat.completions.create(
        model=cfg.openai_resource,
        messages=[{"role": "user", "content": "Pick a city in: Brazil."}],
        response_format={
            "type": "json_schema",
            "json_schema": {
                "name": "country",
                "strict": True,
                "schema": {
                    "type": "object",
                    "properties": {
                        "city": {"type": "string"},
                        "country_code": {"type": "string"},
                    },
                    "required": ["city", "country_code"],
                    "additionalProperties": False,
                },
            },
        },
    )
    payload = json.loads(response.choices[0].message.content or "{}")
    print(f"[json_schema_mode] -> {payload}")


def vmx_metadata(cfg) -> None:
    client = _client(cfg)
    response = client.chat.completions.create(
        model=cfg.openai_resource,
        messages=[{"role": "user", "content": "Summarise: VM-X is a gateway."}],
        extra_body={
            "vmx": {
                "correlationId": "summarizer-job-2026-05-10-abc",
                "metadata": {
                    "team": "growth",
                    "feature": "summarizer",
                    "user_id": "u_42",
                },
                "timeoutMs": 20_000,
            }
        },
    )
    # Server echoes a `vmx` object on the response.
    response_dict = response.model_dump()
    vmx = response_dict.get("vmx", {})
    print(f"[vmx_metadata] -> assistant={response.choices[0].message.content!r} "
          f"vmx_metrics={vmx.get('metrics')}")


def main() -> None:
    cfg = load()
    quick_start(cfg)
    system_and_multi_turn(cfg)
    tool_calling(cfg)
    streaming(cfg)
    json_object_mode(cfg)
    json_schema_mode(cfg)
    vmx_metadata(cfg)


if __name__ == "__main__":
    main()
