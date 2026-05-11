---
sidebar_position: 4
---

# Google Gemini

VM-X talks to Gemini through two paths, picked **per request** by
the gateway:

- **Default — Google's OpenAI-compatible endpoint** at
  `https://generativelanguage.googleapis.com/v1beta/openai`. Covers
  the bulk of features (streaming, function tools, vision via
  `image_url`, structured outputs, `reasoning_effort`).
- **Native `@google/genai` SDK** for grounded flows — auto-selected
  when the request carries one of Gemini's tool descriptors that the
  compat shim doesn't know how to forward
  ([see below](#native-google-genai-fallback)).

## Connection config

| Field    | Required | Description                                                                               |
| -------- | :------: | ----------------------------------------------------------------------------------------- |
| `apiKey` |   yes    | Gemini API key. Create one in [Google AI Studio](https://aistudio.google.com/app/apikey). |

```jsonc
{
  "provider": "gemini",
  "config": { "apiKey": "AIza..." }
}
```

> The provider id is `gemini`, not `google`.

## Endpoint passthrough

| Client request shape | What hits the wire                                                                      |
| -------------------- | --------------------------------------------------------------------------------------- |
| Chat Completions     | Verbatim on the OpenAI-compat endpoint, or routed to the native SDK for grounded flows. |
| Anthropic Messages   | Direct Anthropic ↔ Chat Completions converter (single hop — no internal pivot).         |
| Responses            | Direct Responses ↔ Chat Completions converter (single hop — no internal pivot).         |

Both non-Chat input shapes ultimately land on Gemini's wire format
(Chat Completions on the compat endpoint), so the same native-fallback
trigger applies — sending a `googleSearch` tool through the Anthropic
or Responses cell still routes to the native `@google/genai` SDK once
the converter has produced a Chat-Completions body.

## Capabilities

| Capability                     |                                 Status                                 |
| ------------------------------ | :--------------------------------------------------------------------: |
| Streaming                      |                                   ✅                                   |
| Function / tool calling        |                    ✅ — OpenAI-shape `tools` array                     |
| Vision (`image_url`)           |                                   ✅                                   |
| Reasoning (`reasoning_effort`) | ✅ — Gemini 2.5 Flash / Pro accept `reasoning_effort: low/medium/high` |
| Grounding (web search)         |    ✅ — see [native fallback](#native-google-genai-fallback) below     |

## `providerArgs` — common Gemini-native fields

When you need Gemini-only knobs that don't survive Google's
OpenAI-compat layer:

```jsonc
{
  "vmx": {
    "providerArgs": {
      "safetySettings": [{ "category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_NONE" }],
      "reasoning_effort": "low"
    }
  }
}
```

## Models

Pass any Gemini model id Google exposes via the OpenAI-compat
endpoint (`gemini-2.5-flash`, `gemini-2.5-pro`, …). The default for
new connections is `gemini-2.5-flash`.

## Native `@google/genai` fallback {#native-google-genai-fallback}

Google's OpenAI-compat shim drops grounding metadata silently and
400s on Gemini-only tool descriptors, so VM-X auto-routes the request
through the native `@google/genai` SDK whenever **any** of the
following tool keys appears in `tools[]`:

- `googleSearch`
- `googleSearchRetrieval`
- `urlContext`
- `codeExecution`
- `fileSearch`

The portable opt-in `web_search_options` from OpenAI Chat Completions
also triggers the native path (the gateway maps it onto a synthetic
`{ googleSearch: {} }` tool descriptor).

The native path returns OpenAI-shape `ChatCompletion` /
`ChatCompletionChunk` data so callers downstream of the gateway don't
need a special branch — grounding metadata is surfaced both at the
top level (`vertex_ai_grounding_metadata`) and on the assistant
message (`message.grounding_metadata`).

### Supported subset (intentionally narrow)

The native path exists to surface grounding metadata for the tools
above. It does **not** cover:

- Multi-modal content parts (`image_url`, `input_audio`, `file`,
  `input_file`) — only `text` parts cross the boundary. Send vision
  requests on the OpenAI-compat path instead (omit the native-tool
  descriptor).
- `tool` / `function` role messages — function-tool round-trips stay
  on the OpenAI-compat path.
- `executableCode` / `codeExecutionResult` response parts.
- `thoughtSignature` round-trip.
- `thinkingConfig` derived from `reasoning_effort`.
- `safetySettings` (only via `vmx.providerArgs` on the compat path).
- `responseSchema` / `responseModalities` / `speechConfig` /
  `mediaResolution` / `videoMetadata`.
- `safetyRatings` / `promptFeedback` / fine-grained `finishReason` —
  the response mapper hard-codes `'tool_calls'` or `'stop'` and drops
  the rest.
- Per-modality usage breakdown.

Streaming and non-streaming are both supported on the native path —
streaming chunks get translated into OpenAI `ChatCompletionChunk`
events (with grounding attached to the closing chunk).

If you need any of the unsupported items above, keep your request on
the OpenAI-compat path by avoiding the trigger keys in `tools[]`.
Expanding native parity (multimodal Parts, function-tool round-trips,
schema-shaped output, etc.) is a follow-up tracked in
`gemini/native.helpers.ts`'s top-of-file docstring.

## Notes

- Google's OpenAI-compat endpoint **rejects unknown top-level fields**
  with a 400. The gateway strips its `vmx` and `__vmx_passthrough`
  envelopes before send.
- Unlike OpenAI, Gemini does not honour `tools[].function.strict: null`.
  When using the Responses endpoint with tools, VM-X omits the field
  rather than passing `null`.
