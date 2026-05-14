---
sidebar_position: 4
---

# Google Gemini

VM-X talks to Gemini through the native [`@google/genai`](https://www.npmjs.com/package/@google/genai)
SDK on every request. The previous OpenAI-compat endpoint
(`v1beta/openai`) was retired in favour of three per-surface converters
that translate directly between the caller's wire format (Chat
Completions, OpenAI Responses, or Anthropic Messages) and Gemini's
native `GenerateContentParameters`. There is no internal pivot to a
common format — each surface has its own converter, kept in
`packages/api/src/ai-provider/gemini/`.

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

Vertex AI (service-account credentials, project / location) is not yet
supported on the connection — only the Gemini API key path. Knobs that
are Vertex-only on Google's side (e.g. `excludeDomains`) consequently
have no destination today and are dropped by the converters.

The provider id is `gemini`, not `google`.

## Endpoint passthrough

| Client request shape | Converter file                       |
| -------------------- | ------------------------------------ |
| Chat Completions     | `openai-chat-completion.provider.ts` |
| OpenAI Responses     | `openai-response.provider.ts`        |
| Anthropic Messages   | `anthropic-messages.provider.ts`     |

All three converters dispatch through a shared `GeminiDispatcher` that
owns SDK instantiation, abort-signal composition, and error mapping.
Non-streaming and streaming are supported on every surface.

## Models

Pass any model id the Gemini API exposes (`gemini-2.5-flash`,
`gemini-2.5-flash-lite`, `gemini-2.5-pro`, the `gemini-3.*` preview
family, …). The default for new connections is `gemini-2.5-flash`.

Note: `gemini-2.5-flash` is thinking-enabled and may return its answer
inside thinking parts rather than visible `content`. If you need the
answer in `content` without configuring `reasoning_effort`, prefer
`gemini-2.5-flash-lite`.

## Capabilities

| Capability                     |                             Status                              |
| ------------------------------ | :-------------------------------------------------------------: |
| Streaming                      |                               yes                               |
| Function / tool calling        |               yes — OpenAI/Anthropic-shape tools                |
| Vision (`image_url`)           |                               yes                               |
| Documents (`input_file`)       |           yes — `file_data` (data URL) and `file_url`           |
| Audio (`input_audio`)          |                               yes                               |
| Reasoning (`reasoning_effort`) |         yes — mapped to `thinkingConfig.thinkingBudget`         |
| Structured output              | yes — `response_format` / `text.format` → `responseJsonSchema`  |
| Grounding (web search)         | yes — see [Web search and grounding](#web-search-and-grounding) |
| Code execution                 |           yes — see [Code execution](#code-execution)           |
| URL context                    |           yes — native `urlContext` tool passthrough            |
| File search                    |           yes — native `fileSearch` tool passthrough            |

## `providerArgs` — Gemini-native knobs

Fields the standard request body can't express are lifted onto
`GenerateContentConfig` from `vmx.providerArgs`. The allowlist
(`GEMINI_PROVIDER_ARG_KEYS` in `shared.ts`) covers:

`safetySettings`, `responseModalities`, `mediaResolution`,
`speechConfig`, `audioTimestamp`, `cachedContent`, `labels`,
`routingConfig`, `modelSelectionConfig`, `modelArmorConfig`,
`serviceTier`, `enableEnhancedCivicAnswers`, `imageConfig`,
`automaticFunctionCalling`.

```jsonc
{
  "vmx": {
    "providerArgs": {
      "safetySettings": [{ "category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_NONE" }],
      "labels": { "team": "search" }
    }
  }
}
```

`vmx.providerArgs.tools` is a special case: the orchestrator lifts it
onto the top-level `tools[]` of the outgoing body before the converter
runs, so any Gemini-native entries land alongside the caller's
OpenAI/Anthropic-shape tools and ride through the
[native-tool passthrough](#gemini-native-tool-passthrough).

## Gemini-native tool passthrough

Every surface's converter recognises Gemini-native tool descriptors and
forwards them verbatim onto `config.tools`. The recognised keys are:

`googleSearch`, `googleSearchRetrieval`, `urlContext`, `codeExecution`,
`fileSearch`, `computerUse`, `mcpServer`, `googleMaps`, `retrieval`,
`functionDeclarations`.

```jsonc
// Chat Completions, OpenAI Responses, or Anthropic Messages all accept
// this — drop the descriptor into tools[] alongside any function tools.
{
  "tools": [{ "googleSearch": { "timeRangeFilter": { "startTime": "2025-04-01T00:00:00Z", "endTime": "2025-05-01T00:00:00Z" } } }, { "urlContext": {} }]
}
```

This is the escape hatch for any Gemini-API field the cross-format
converter doesn't map (e.g. explicit `timeRangeFilter` second-precision
timestamps, `googleMaps`, `mcpServer`).

## Web search and grounding

Each cross-format surface accepts its own canonical web-search opt-in,
which the converter translates to `{ googleSearch: {} }`:

| Surface            | Opt-in                                                                       |
| ------------------ | ---------------------------------------------------------------------------- |
| Chat Completions   | `web_search_options: {}` (or a native `{ googleSearch }` entry in `tools[]`) |
| OpenAI Responses   | `tools: [{ type: 'web_search' }]` or `{ type: 'web_search_preview' }`        |
| Anthropic Messages | `tools: [{ type: 'web_search_20250305', name: 'web_search' }]`               |

### What survives the conversion

The only sub-field mapped onto Gemini today is
`search_recency_filter` (Perplexity-style `hour` / `day` / `week` /
`month` / `year`). It projects onto
`googleSearch.timeRangeFilter` as a second-precision ISO `Interval`
(`startTime` = now − window, `endTime` = now). Gemini's protobuf
`Timestamp` rejects fractional seconds with a 400, so the converter
strips the `.SSSZ` suffix.

### What gets dropped

The Gemini API has no equivalent for these — they are dropped silently:

- `user_location`
- `filters.allowed_domains`
- `filters.blocked_domains` (Gemini's `excludeDomains` is Vertex-only;
  Vertex isn't supported on the connection yet)
- `filters.search_domain_filter`
- OpenAI Chat Completions `web_search_options.search_context_size`
- OpenAI Chat Completions `web_search_options.user_location`

Callers needing any of those (or any other native-shape knob) can
supply a fully formed `{ googleSearch: { … } }` via either `tools[]`
directly or `vmx.providerArgs.tools`. That path bypasses the
cross-format converter entirely.

### Where grounding lands on the response

Grounding metadata is preserved verbatim and surfaced on every surface
under extension fields the SDK shapes leave room for:

- **Chat Completions** — top-level `vertex_ai_grounding_metadata`, plus
  `message.grounding_metadata` and `message.url_context_metadata`.
- **OpenAI Responses** — top-level `vertex_ai_grounding_metadata` and
  `grounding_metadata`; on the closing `response.completed` event when
  streaming.
- **Anthropic Messages** — top-level `vertex_ai_grounding_metadata` and
  `grounding_metadata`; on the closing `message_delta` event when
  streaming.

## Code execution

Native `{ codeExecution: {} }` rides through verbatim on every surface,
and OpenAI Responses' `{ type: 'code_interpreter' }` also maps to it.
Returned `executableCode` and `codeExecutionResult` parts surface on
the response:

- **Chat Completions** — synthetic `tool_calls` entries with
  `name: 'code_execution'`, plus the raw parts under
  `message.gemini_code_execution`.
- **OpenAI Responses** — native `code_interpreter_call` output items
  on the synchronous response.
- **Anthropic Messages** — folded into text content (no per-block
  channel on the Anthropic shape).

## Structured output

| Surface            | Field                                          | Mapped to                                 |
| ------------------ | ---------------------------------------------- | ----------------------------------------- |
| Chat Completions   | `response_format.type: 'json_schema'`          | `responseMimeType` + `responseJsonSchema` |
| Chat Completions   | `response_format.type: 'json_object'`          | `responseMimeType: 'application/json'`    |
| OpenAI Responses   | `text.format.type: 'json_schema'`              | `responseMimeType` + `responseJsonSchema` |
| OpenAI Responses   | `text.format.type: 'json_object'`              | `responseMimeType: 'application/json'`    |
| Anthropic Messages | `output_config.format` (`type: 'json_schema'`) | `responseMimeType` + `responseJsonSchema` |

## File content (documents, images, audio)

URLs lift onto Gemini media parts uniformly across every surface:

- `data:<mime>;base64,<data>` URLs → `inlineData` (mime + base64 read
  off the URL).
- HTTPS / `files/<id>` / GCS URIs → `fileData` with a fallback mime
  (`image/*`, `application/pdf`, `application/octet-stream`).

OpenAI Responses' `input_file` accepts `file_data` (data URL),
`file_url`, or `file_id`; all three lift onto a Gemini part.

## Notes

- `reasoning_effort` (`none` / `minimal` / `low` / `medium` / `high`)
  maps to Gemini's `thinkingConfig` via the shared token-budget tiers
  in `adapters/anthropic-reasoning.ts`. `none` and `minimal` disable
  thinking (`thinkingBudget: 0`).
- Multi-turn tool replay correlates `functionResponse.name` against
  the prior `functionCall.name` (not the OpenAI `call_id` / Anthropic
  `tool_use_id`) — all three converters pre-walk the input to build
  the id → name map.
- Live coverage for every mapping above lives in
  `packages/api/src/__integration__/providers/gemini.spec.ts`.
