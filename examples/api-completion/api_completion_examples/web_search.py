"""Runnable mirror of the docs at `docs/docs/features/api/web-search.md`.

Run with:

    pnpm exec nx run api-completion-example:web-search
"""

from __future__ import annotations

import anthropic
from openai import BadRequestError, OpenAI

from .config import load


def openai_chat_completions_search(cfg) -> None:
    """OpenAI Chat Completions web search via gpt-*-search-preview models.

    The seeded `openai-search` resource pins gpt-5-search-api which is
    the OpenAI search-preview equivalent on the latest model line.
    """
    if not cfg.openai_search_resource:
        print("[openai_chat_completions_search] skipped (no openai-search resource)")
        return
    client = OpenAI(api_key=cfg.api_key, base_url=cfg.base_completion_url)
    try:
        response = client.chat.completions.create(
            model=cfg.openai_search_resource,
            messages=[
                {"role": "user", "content": "What's the latest TypeScript release?"}
            ],
            extra_body={"web_search_options": {"search_context_size": "medium"}},
        )
    except BadRequestError as exc:
        print(f"[openai_chat_completions_search] failed: {exc.message[:120]}")
        return
    citations = []
    msg = response.choices[0].message
    annotations = getattr(msg, "annotations", None) or []
    for ann in annotations:
        ann_dict = ann if isinstance(ann, dict) else ann.model_dump()
        if ann_dict.get("type") == "url_citation":
            citations.append(ann_dict.get("url_citation", {}).get("url"))
    print(f"[openai_chat_completions_search] citations={len(citations)} "
          f"first={citations[0] if citations else None}")


def openai_responses_search(cfg) -> None:
    """OpenAI Responses hosted web_search.

    Known gateway limitation: VM-X currently runs the Responses converter
    unconditionally for routing, and the converter rejects `web_search`
    because it has no Chat Completions equivalent. The doc claims this
    works as a native passthrough — capture the failure cleanly so the
    drift is visible.
    """
    if not cfg.openai_search_resource:
        print("[openai_responses_search] skipped (no openai-search resource)")
        return
    client = OpenAI(api_key=cfg.api_key, base_url=cfg.base_completion_url)
    try:
        response = client.responses.create(
            model=cfg.openai_search_resource,
            input="What's the latest TypeScript release?",
            tools=[{"type": "web_search"}],
        )
    except BadRequestError as exc:
        print(f"[openai_responses_search] gateway-blocked: {exc.message[:120]}")
        return
    text_parts = [
        part.text
        for item in response.output
        if item.type == "message"
        for part in item.content
        if part.type == "output_text"
    ]
    print(f"[openai_responses_search] text_preview={(''.join(text_parts))[:80]!r}")


def anthropic_messages_search(cfg) -> None:
    """Anthropic web_search_20250305 server tool via /anthropic/messages."""
    if not cfg.anthropic_resource:
        print("[anthropic_messages_search] skipped (no anthropic resource)")
        return
    client = anthropic.Anthropic(api_key=cfg.api_key, base_url=cfg.base_anthropic_url)
    message = client.messages.create(
        model=cfg.anthropic_resource,
        max_tokens=2048,
        messages=[
            {"role": "user", "content": "Latest TypeScript release? Cite sources."}
        ],
        tools=[
            {"type": "web_search_20250305", "name": "web_search", "max_uses": 2}
        ],
    )
    citations = []
    for block in message.content:
        if block.type == "text":
            for c in (getattr(block, "citations", None) or []):
                cdict = c if isinstance(c, dict) else c.model_dump()
                if cdict.get("url"):
                    citations.append(cdict["url"])
    has_search_block = any(
        b.type in {"web_search_tool_result", "server_tool_use"}
        for b in message.content
    )
    print(f"[anthropic_messages_search] tool_used={has_search_block} "
          f"citations={len(citations)}")


def perplexity_builtin_search(cfg) -> None:
    """Perplexity has search built into every model — no tool needed."""
    if not cfg.perplexity_resource:
        print("[perplexity_builtin_search] skipped (no perplexity resource)")
        return
    client = OpenAI(api_key=cfg.api_key, base_url=cfg.base_completion_url)
    response = client.chat.completions.create(
        model=cfg.perplexity_resource,
        messages=[{"role": "user", "content": "Latest TypeScript release?"}],
        extra_body={
            "vmx": {
                "providerArgs": {
                    "search_recency_filter": "week",
                    "search_domain_filter": ["github.com", "typescriptlang.org"],
                }
            }
        },
    )
    citations = getattr(response, "citations", None) or []
    print(f"[perplexity_builtin_search] citations={len(citations)} "
          f"first={citations[0] if citations else None}")


def gemini_google_search(cfg) -> None:
    """Gemini googleSearch tool — auto-routes to native @google/genai."""
    if not cfg.gemini_resource:
        print("[gemini_google_search] skipped (no gemini resource)")
        return
    client = OpenAI(api_key=cfg.api_key, base_url=cfg.base_completion_url)
    try:
        response = client.chat.completions.create(
            model=cfg.gemini_resource,
            messages=[
                {"role": "user", "content": "Latest news about Anthropic this week?"}
            ],
            extra_body={"tools": [{"googleSearch": {}}]},
        )
    except BadRequestError as exc:
        print(f"[gemini_google_search] failed: {exc.message[:120]}")
        return
    response_dict = response.model_dump()
    msg = response_dict.get("choices", [{}])[0].get("message", {})
    # Gemini's native grounding metadata lands on
    # `choices[0].message.grounding_metadata` with camelCase fields
    # (`groundingChunks` / `groundingSupports`) — VM-X forwards it
    # verbatim from the @google/genai SDK.
    grounding = msg.get("grounding_metadata") or {}
    chunks = grounding.get("groundingChunks", []) or []
    supports = grounding.get("groundingSupports", []) or []
    print(f"[gemini_google_search] groundingChunks={len(chunks)} "
          f"groundingSupports={len(supports)} "
          f"first_chunk={chunks[0]['web']['title'] if chunks else None}")


def main() -> None:
    cfg = load()
    openai_chat_completions_search(cfg)
    openai_responses_search(cfg)
    anthropic_messages_search(cfg)
    perplexity_builtin_search(cfg)
    gemini_google_search(cfg)


if __name__ == "__main__":
    main()
