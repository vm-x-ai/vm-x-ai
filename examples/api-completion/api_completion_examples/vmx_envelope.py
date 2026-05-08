"""Runnable mirror of the docs at `docs/docs/features/api/vmx-envelope.md`.

Run with:

    pnpm exec nx run api-completion-example:vmx-envelope
"""

from __future__ import annotations

import anthropic
from openai import OpenAI

from .config import load


def openai_envelope(cfg) -> None:
    client = OpenAI(api_key=cfg.api_key, base_url=cfg.base_completion_url)
    response = client.chat.completions.create(
        model=cfg.openai_resource,
        messages=[{"role": "user", "content": "Hello!"}],
        extra_body={
            "vmx": {
                "correlationId": "agent-run-1",
                "metadata": {"team": "growth", "user_id": "u_42"},
                "timeoutMs": 15_000,
            }
        },
    )
    response_dict = response.model_dump()
    metrics = response_dict.get("vmx", {}).get("metrics")
    print(f"[openai_envelope] -> text={response.choices[0].message.content!r} "
          f"metrics={metrics}")


def anthropic_envelope(cfg) -> None:
    if not cfg.anthropic_resource:
        print("[anthropic_envelope] skipped (no anthropic resource)")
        return
    client = anthropic.Anthropic(api_key=cfg.api_key, base_url=cfg.base_anthropic_url)
    message = client.messages.create(
        model=cfg.anthropic_resource,
        max_tokens=128,
        messages=[{"role": "user", "content": "Say hi."}],
        extra_body={
            "vmx": {
                "correlationId": "agent-run-1",
                "metadata": {"team": "growth"},
            }
        },
    )
    print(f"[anthropic_envelope] -> "
          f"{''.join(b.text for b in message.content if b.type == 'text')!r}")


def perplexity_provider_args(cfg) -> None:
    """Perplexity recency + domain filters via vmx.providerArgs."""
    if not cfg.perplexity_resource:
        print("[perplexity_provider_args] skipped (no perplexity resource)")
        return
    client = OpenAI(api_key=cfg.api_key, base_url=cfg.base_completion_url)
    response = client.chat.completions.create(
        model=cfg.perplexity_resource,
        messages=[{"role": "user", "content": "Latest TypeScript release?"}],
        extra_body={
            "vmx": {
                "providerArgs": {
                    "search_recency_filter": "week",
                    "search_domain_filter": ["github.com"],
                }
            }
        },
    )
    citations = getattr(response, "citations", None) or []
    print(f"[perplexity_provider_args] citations={len(citations)} "
          f"text_preview={response.choices[0].message.content[:80]!r}")


def resource_config_overrides(cfg) -> None:
    """Override the primary model for one call via connectionName."""
    client = OpenAI(api_key=cfg.api_key, base_url=cfg.base_completion_url)
    response = client.chat.completions.create(
        model=cfg.openai_resource,
        messages=[{"role": "user", "content": "Reply with literally 'overridden'."}],
        extra_body={
            "vmx": {
                "resourceConfigOverrides": {
                    "model": {
                        "provider": "openai",
                        "model": "gpt-4o-mini",
                        "connectionName": "openai",
                    }
                }
            }
        },
    )
    # x-vmx-model header confirms which model was used after the override.
    print(f"[resource_config_overrides] "
          f"text={response.choices[0].message.content!r}")


def vmx_passthrough_anthropic(cfg) -> None:
    """Cross-format carrier: send chat-completions request that ends up on
    Anthropic, with cache_control rid-along on __vmx_passthrough.

    Tests the docs' "private __vmx_passthrough envelope" claim. With the
    seeded openai+anthropic resources both pointing at separate providers,
    we can't easily steer a chat-completions call to anthropic without a
    fallback config. So this test just verifies the gateway accepts the
    field without rejecting it.
    """
    client = OpenAI(api_key=cfg.api_key, base_url=cfg.base_completion_url)
    response = client.chat.completions.create(
        model=cfg.openai_resource,
        messages=[{"role": "user", "content": "Hello."}],
        extra_body={
            "__vmx_passthrough": {
                "anthropic": {
                    "cache_control": {"type": "ephemeral"},
                    "top_k": 10,
                }
            }
        },
    )
    print(f"[vmx_passthrough_anthropic] accepted; "
          f"text={response.choices[0].message.content!r}")


def main() -> None:
    cfg = load()
    openai_envelope(cfg)
    anthropic_envelope(cfg)
    perplexity_provider_args(cfg)
    resource_config_overrides(cfg)
    vmx_passthrough_anthropic(cfg)


if __name__ == "__main__":
    main()
