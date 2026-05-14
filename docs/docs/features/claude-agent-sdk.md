---
sidebar_position: 7
---

# Claude Agent SDK Integration

The [Claude Agent SDK](https://docs.claude.com/en/docs/agent-sdk/overview)
(Python `claude-agent-sdk`, TypeScript `@anthropic-ai/claude-agent-sdk`)
talks to a VM-X gateway by setting two environment variables:
`ANTHROPIC_BASE_URL` (the gateway's `/anthropic` prefix) and
`ANTHROPIC_API_KEY` (your VM-X API key). The SDK spawns the Claude
Code CLI as a child process; the CLI reads those env vars and sends
its requests to VM-X just like any other Anthropic-Messages client.

For the underlying URL pattern, auth header forms, and `vmx` envelope
shape, see the [API overview](./api/index.md) and the
[`vmx` envelope reference](./api/vmx-envelope.md). This page only
covers the Claude-Agent-SDK-specific bits.

The gateway exposes the **Anthropic Messages surface** as a
multi-provider entry point — every provider (Anthropic, OpenAI,
Gemini, Groq, Perplexity, AWS Bedrock-Invoke, AWS Bedrock-Converse)
now ships an `anthropic-messages.provider.ts` converter. That means
your Agent-SDK requests can transparently land on a non-Anthropic
upstream as long as the target model supports the agent payload
(see [Cross-provider targeting](#cross-provider-targeting) below).

## Overview

The Claude Agent SDK is a thin wrapper around the Claude Code CLI
binary. The SDK exposes a `query()` async iterable that returns
`system` / `assistant` / `user` / `result` events; you read them as
the agent loop progresses. Tools, MCP servers, and Skills are all
configured through the SDK's options object.

Because the SDK delegates the actual HTTP work to the CLI, the
integration story is simple:

1. Set `ANTHROPIC_BASE_URL` to the VM-X `/anthropic` prefix.
2. Set `ANTHROPIC_API_KEY` to your VM-X API key.
3. Pass your VM-X **AI Resource name** as `model`.

The CLI then hits VM-X's `…/anthropic/v1/messages` route (which the
gateway exposes as an alias for the canonical `…/anthropic/messages`),
and every request flows through VM-X's routing, fallback, capacity,
and audit pipeline.

## Model requirements

The Claude Code CLI sends modern Anthropic features on every
request — `output_config.effort`, `context_management`, and others.
Your VM-X AI Resource must therefore route to a Claude model that
accepts those parameters (Sonnet 4.6 or later, or Opus 4.5+). The
default `anthropic` resource in the example seed points at Haiku 4.5,
which **does not support `output_config.effort`** and will reject
agent-SDK requests with a 400.

The example seed creates a separate resource `anthropic-agent` pinned
to a model that accepts the full agent payload — point the SDK at
that resource (or at any resource you've configured to route to a
compatible model).

## Installation

### Python

```bash
pip install claude-agent-sdk
```

The Python package requires the Claude Code CLI binary to be installed
separately and available on `PATH`. See
[the install guide](https://docs.claude.com/en/docs/agent-sdk/python).

### TypeScript

```bash
pnpm add @anthropic-ai/claude-agent-sdk zod
```

The TypeScript package ships platform-specific native binaries via
optional npm dependencies (`@anthropic-ai/claude-agent-sdk-linux-x64-gnu`,
`-linux-x64-musl`, `-darwin-arm64`, etc.). If the binary that matches
your platform isn't installed or doesn't run (e.g. the musl binary on
a glibc host), point the SDK at your system `claude` binary via the
`pathToClaudeCodeExecutable` option — see the examples below.

## Basic Usage

### Python

```python
import asyncio
import os

from claude_agent_sdk import ClaudeAgentOptions, query

workspace_id = "your-workspace-id"
environment_id = "your-environment-id"
resource_name = "your-resource-name"  # AI Resource name, NOT a claude-* id
api_key = os.environ["VMX_API_KEY"]

base_url = (
    f"http://localhost:3030/api/v1/completion/"
    f"{workspace_id}/{environment_id}/anthropic"
)

async def main() -> None:
    options = ClaudeAgentOptions(
        env={
            **os.environ,                     # inherit PATH, HOME, …
            "ANTHROPIC_BASE_URL": base_url,
            "ANTHROPIC_API_KEY": api_key,
        },
        model=resource_name,
    )

    async for message in query(prompt="Hello!", options=options):
        if type(message).__name__ == "AssistantMessage":
            for block in message.content:
                if getattr(block, "text", None):
                    print(block.text)

asyncio.run(main())
```

### TypeScript

```ts
import { query } from '@anthropic-ai/claude-agent-sdk';

const workspaceId = 'your-workspace-id';
const environmentId = 'your-environment-id';
const resourceName = 'your-resource-name';
const apiKey = process.env.VMX_API_KEY!;

const baseUrl = `http://localhost:3030/api/v1/completion/${workspaceId}/${environmentId}/anthropic`;

for await (const message of query({
  prompt: 'Hello!',
  options: {
    env: {
      ...(process.env as Record<string, string>),
      ANTHROPIC_BASE_URL: baseUrl,
      ANTHROPIC_API_KEY: apiKey,
    },
    model: resourceName,
    // Only needed if the bundled native binary doesn't match your
    // platform — e.g. musl binary on a glibc host.
    pathToClaudeCodeExecutable: process.env.CLAUDE_CLI_PATH,
  },
})) {
  if (message.type === 'assistant') {
    for (const block of message.message.content) {
      if (block.type === 'text') console.log(block.text);
    }
  }
}
```

### `ANTHROPIC_BASE_URL`

The Claude CLI auto-appends `/v1/messages` to whatever you set, so the
URL must end at `…/anthropic` — VM-X exposes `…/anthropic/v1/messages`
as an alias for the canonical `…/anthropic/messages` route, so the
SDK's appended path resolves correctly.

## Tool use (in-process MCP)

The SDK can host MCP servers in your own process, exposing Python or
TypeScript functions to the agent as tools. The model's tool calls +
tool results flow through the agent loop transparently — VM-X just
sees the Anthropic Messages requests and responses.

### Python

```python
from claude_agent_sdk import (
    ClaudeAgentOptions, create_sdk_mcp_server, query, tool,
)

@tool("get_weather", "Get the current weather for a city", {"city": str})
async def get_weather(args: dict) -> dict:
    return {"content": [{"type": "text", "text": f"22°C in {args['city']}"}]}

server = create_sdk_mcp_server(name="weather", version="1.0.0", tools=[get_weather])

options = ClaudeAgentOptions(
    env={..., "ANTHROPIC_BASE_URL": base_url, "ANTHROPIC_API_KEY": api_key},
    model=resource_name,
    mcp_servers={"weather": server},
    allowed_tools=["mcp__weather__get_weather"],
)

async for msg in query(prompt="What's the weather in São Paulo?", options=options):
    ...
```

### TypeScript

```ts
import { createSdkMcpServer, query, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

const getWeather = tool(
  'get_weather',
  'Get the current weather for a city.',
  { city: z.string() },
  async ({ city }) => ({
    content: [{ type: 'text', text: `22°C in ${city}` }],
  }),
);

const server = createSdkMcpServer({
  name: 'weather',
  version: '1.0.0',
  tools: [getWeather],
});

for await (const message of query({
  prompt: "What's the weather in São Paulo?",
  options: {
    env: { ...process.env, ANTHROPIC_BASE_URL: baseUrl, ANTHROPIC_API_KEY: apiKey },
    model: resourceName,
    mcpServers: { weather: server },
    allowedTools: ['mcp__weather__get_weather'],
  },
})) {
  ...
}
```

## Streaming, MCP, Skills

The SDK's `query()` async iterable **is** the stream — there is no
separate `stream` flag. Each message arrives as the agent loop runs:

- `system` — initialization event (model, tools, etc.)
- `assistant` — model output (text blocks and tool_use blocks)
- `user` — tool results coming back from your `execute` functions
- `result` — final result event with usage/cost

External MCP servers (stdio/SSE/HTTP) and
[Skills](https://docs.claude.com/en/docs/agent-sdk/skills) are also
supported via `mcpServers` and the SDK's setting-sources mechanism.
Both flow through VM-X identically; the gateway just sees Anthropic
Messages requests.

## Sending a `vmx` envelope

VM-X reads its envelope fields from the **request body** under a `vmx`
key. The Claude Agent SDK delegates HTTP to the Claude Code CLI as a
child process, which fully controls each request body — so the body
route isn't available from the SDK.

Instead, VM-X reads two envelope fields **from request headers**:

| Header                          | Maps to               |
| ------------------------------- | --------------------- |
| `x-vmx-correlation-id: <value>` | `vmx.correlationId`   |
| `x-vmx-metadata-<key>: <value>` | `vmx.metadata[<key>]` |

And the Claude Code CLI honors the
[`ANTHROPIC_CUSTOM_HEADERS`](https://code.claude.com/docs/en/env-vars)
env var (newline-separated `Name: Value` pairs) — so you can attach
those headers to every outgoing agent request:

### Python

```python
import time
from claude_agent_sdk import ClaudeAgentOptions, query

custom_headers = "\n".join([
    f"x-vmx-correlation-id: agent-run-{int(time.time() * 1000)}",
    "x-vmx-metadata-team: growth",
    "x-vmx-metadata-user_id: u_42",
])

options = ClaudeAgentOptions(
    env={
        **os.environ,
        "ANTHROPIC_BASE_URL": base_url,
        "ANTHROPIC_API_KEY": api_key,
        "ANTHROPIC_CUSTOM_HEADERS": custom_headers,
    },
    model=resource_name,
)

async for msg in query(prompt="...", options=options):
    ...
```

### TypeScript

```ts
import { query } from '@anthropic-ai/claude-agent-sdk';

const customHeaders = [`x-vmx-correlation-id: agent-run-${Date.now()}`, 'x-vmx-metadata-team: growth', 'x-vmx-metadata-user_id: u_42'].join('\n');

for await (const msg of query({
  prompt: '...',
  options: {
    env: {
      ...(process.env as Record<string, string>),
      ANTHROPIC_BASE_URL: baseUrl,
      ANTHROPIC_API_KEY: apiKey,
      ANTHROPIC_CUSTOM_HEADERS: customHeaders,
    },
    model: resourceName,
  },
})) {
  // …
}
```

VM-X echoes the resolved `correlationId` back on the response's
`x-vmx-correlation-id` header and indexes the `metadata` map for
Audit/Usage filtering. Body-side `vmx` fields would win over headers
on key collision (not applicable here — the CLI doesn't send a body
`vmx` field).

### Limitations

`correlationId` + `metadata` cover request tracing and Audit/Usage
filtering — enough for most agent workloads. The body-only envelope
fields (`resourceConfigOverrides`, `providerArgs`,
`secondaryModelIndex`, `timeoutMs`) are not header-readable. For
per-request model / routing overrides with an agent workload, use the
raw Anthropic SDK directly (which lets you reach the body); use the
Agent SDK for the agentic-loop use cases where the resource's static
configuration is sufficient.

## Cross-provider targeting

Because the gateway's `/anthropic` surface is multi-provider, you can
point the Agent SDK at an AI Resource whose connection is **not**
Anthropic. The gateway's per-provider `anthropic-messages.provider.ts`
converters translate the canonical request body to each upstream's
native shape (and the response back), preserving the Anthropic wire
format end-to-end on the client side.

The agent CLI is opinionated about the request shape it sends —
`output_config.effort`, `context_management`, tool-use blocks — so
the upstream model must accept that payload. In practice:

| Connection                 | Agent SDK works?                                                                   |
| -------------------------- | ---------------------------------------------------------------------------------- |
| Anthropic                  | Yes, with Sonnet 4.6+ / Opus 4.5+ (Haiku rejects `output_config.effort`).          |
| AWS Bedrock-Invoke         | Yes, on Claude models with the agent-payload features enabled.                     |
| AWS Bedrock-Converse       | Yes — the Converse adapter maps `output_config` / cache markers / server tools.    |
| OpenAI                     | Yes if you route to a reasoning model (the adapter pivots `effort` → `reasoning`). |
| Gemini / Groq / Perplexity | Yes if the chosen model accepts the converted tool-use payload.                    |

If you change connection providers, just repoint your VM-X **AI
Resource** at a new connection — the Agent SDK config (`model`,
`ANTHROPIC_BASE_URL`, `ANTHROPIC_API_KEY`) does not change. See
[Anthropic Messages: provider matrix](./api/anthropic-messages.md)
for the full conversion details.

## Example projects

Complete runnable examples are in
[`examples/claude-agent-sdk-python`](https://github.com/vm-x-ai/vm-x-ai/tree/main/examples/claude-agent-sdk-python)
and
[`examples/claude-agent-sdk-ts`](https://github.com/vm-x-ai/vm-x-ai/tree/main/examples/claude-agent-sdk-ts).
Each ships:

- `quickstart` — hello-world `query()` call
- `tools` — in-process MCP server with a custom tool
- `vmx-envelope` — attach `correlationId` + `metadata` to every
  outgoing request via `ANTHROPIC_CUSTOM_HEADERS`

To get started:

```bash
# Python
pnpm exec nx run claude-agent-sdk-python-example:setup
pnpm exec nx run claude-agent-sdk-python-example:quickstart
pnpm exec nx run claude-agent-sdk-python-example:tools
pnpm exec nx run claude-agent-sdk-python-example:vmx-envelope

# TypeScript
pnpm exec nx run claude-agent-sdk-ts-example:setup
pnpm exec nx run claude-agent-sdk-ts-example:quickstart
pnpm exec nx run claude-agent-sdk-ts-example:tools
pnpm exec nx run claude-agent-sdk-ts-example:vmx-envelope
```

The TypeScript example reads `CLAUDE_CLI_PATH` from the environment for
the binary override — set it to `$(which claude)` if the bundled native
binary doesn't run on your platform.

## Troubleshooting

### `400 — This model does not support the effort parameter.`

The Claude Code CLI sends `output_config.effort` on every request. The
upstream Claude model your AI Resource routes to must accept that
parameter — that means Sonnet 4.6 or later, or Opus 4.5+. Haiku models
will reject the request.

If you see this error, point your resource at a supported model (or
configure a separate agent-tier resource and pass its name as
`model`).

### `Native binary not found at …/claude-agent-sdk-linux-x64-musl/claude`

The TypeScript SDK ships platform-specific binaries via optional npm
deps. If the matching one is installed but doesn't run on your host
(typically: musl binary on a glibc Linux distro), pass
`pathToClaudeCodeExecutable: '/path/to/claude'` to `query()`'s
`options` so the SDK spawns your system-installed Claude Code CLI.

### Hanging / no output

If the CLI hangs without producing output, point the SDK at a Claude
model that accepts the agent-CLI payload (see the model-requirements
section above) — the SDK retries indefinitely on transient errors and
can mask the underlying 400 from a misconfigured resource.

## Why VM-X for the Claude Agent SDK?

Putting VM-X in front of the Claude Agent SDK gives you:

- **Centralized auth + audit** — agent sessions reuse the same VM-X
  API keys and produce the same audit rows as your other Claude
  traffic. No second credential to manage.
- **Routing + fallback** — the resource layer can route agent traffic
  to AWS Bedrock-Invoke when Anthropic is throttled, all without
  changing the agent code.
- **Capacity and cost controls** — agent runs participate in the
  same per-resource capacity buckets as your interactive completion
  traffic. The dashboard's usage analytics include agent sessions.
- **Provider abstraction** — your agent code stays pinned to the
  Anthropic Messages shape; VM-X can dispatch through Anthropic
  directly or through Bedrock-Invoke based on resource configuration.
