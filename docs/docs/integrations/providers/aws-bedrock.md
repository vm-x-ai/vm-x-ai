---
sidebar_position: 7
---

# AWS Bedrock (Converse)

The `aws-bedrock` provider talks to [AWS Bedrock's **Converse**
API](https://docs.aws.amazon.com/bedrock/latest/userguide/conversation-inference.html) — the unified shape that supports every
foundation model on Bedrock (Claude, Llama, Mistral, Cohere, Amazon
Nova, Titan, …).

For Claude-specific features that only Anthropic Messages can express
(`cache_control`, `thinking`, server tools, …), use the dedicated
[`aws-bedrock-invoke`](./aws-bedrock-invoke.md) provider instead — it
goes through the InvokeModel API with the full Anthropic body
preserved.

## Connection config

Bedrock uses **IAM role assumption**, not an API key. Provide the
ARN of a role VM-X can assume; the role needs Bedrock permissions
on the region you target.

| Field                       | Required | Description                                                                                                                                                      |
| --------------------------- | :------: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `region`                    |   yes    | AWS region (e.g. `us-east-1`).                                                                                                                                   |
| `iamRoleArn`                |   yes    | ARN of the IAM role VM-X assumes for every request.                                                                                                              |
| `performanceConfig.latency` |    no    | `'standard'` (default) or `'optimized'` — applied to every Converse call (T22). `'optimized'` opts the request into Bedrock's lower-latency tier when supported. |
| `guardrailConfig`           |    no    | Bedrock Guardrails to apply on every call (T21). See below.                                                                                                      |

### Guardrails (`guardrailConfig`)

When set, every Converse call attaches the supplied guardrail. Trace
output defaults to `'enabled'` so the audit row records the
guardrail's assessments.

| Subfield              | Required (within `guardrailConfig`) | Description                                              |
| --------------------- | :---------------------------------: | -------------------------------------------------------- |
| `guardrailIdentifier` |                 yes                 | Guardrail ID or full ARN.                                |
| `guardrailVersion`    |                 yes                 | `'DRAFT'` or a published version string.                 |
| `trace`               |                 no                  | `'enabled'` (default) / `'disabled'` / `'enabled_full'`. |

```jsonc
{
  "provider": "aws-bedrock",
  "config": {
    "region": "us-east-1",
    "iamRoleArn": "arn:aws:iam::123456789012:role/vm-x-ai-bedrock-role",
    "performanceConfig": { "latency": "optimized" },
    "guardrailConfig": {
      "guardrailIdentifier": "abc123def456",
      "guardrailVersion": "1",
      "trace": "enabled"
    }
  }
}
```

A CloudFormation template that creates the role with the right trust
policy is included in the repo at [`packages/api/assets/aws/cfn/bedrock-iam-role.yaml`](https://github.com/vm-x-ai/vm-x-ai/blob/main/packages/api/assets/aws/cfn/bedrock-iam-role.yaml).

### Credential caching

The first request per `(workspaceId, environmentId, iamRoleArn)`
triple assumes the role. The resulting STS credentials are cached
in-process for their full TTL minus a safety margin, so subsequent
requests skip the round-trip. The cache key includes `workspaceId` +
`environmentId` so a connection in workspace A never re-uses
workspace B's credentials.

## Endpoint passthrough

All three input shapes use **direct one-hop converters** into the
Bedrock Converse wire format — no internal ChatCompletion pivot.

| Client request shape | What hits the wire                                                                                  |
| -------------------- | --------------------------------------------------------------------------------------------------- |
| Chat Completions     | Direct Chat Completions ↔ Converse converter.                                                       |
| Anthropic Messages   | Direct Anthropic ↔ Converse converter (use `aws-bedrock-invoke` for Anthropic-feature passthrough). |
| Responses            | Direct Responses ↔ Converse converter.                                                              |

## Capabilities

| Capability                         | Status                                                                                                                                                              |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Streaming                          | ✅                                                                                                                                                                  |
| Streaming reasoning content        | ✅ — `reasoningContent` deltas surface on `delta.reasoning` (T13)                                                                                                   |
| Function / tool calling            | ✅ via `toolConfig` (OpenAI tools shape is mapped automatically)                                                                                                    |
| `tool_choice: 'none'`              | ✅ — strips `tools` from the wire request entirely (Converse has no native equivalent; T11)                                                                         |
| Structured outputs (`json_schema`) | ✅ — synthesised as a Converse tool with the supplied schema; the response side unwraps the JSON back into `content` (T12)                                          |
| Vision (image content blocks)      | ✅                                                                                                                                                                  |
| Documents (`document` blocks)      | ✅ — base64 PDFs / DOCX / CSV / etc. routed to the SDK's `BytesMember`; format inferred from filename / MIME                                                        |
| Prompt caching (`cache_control`)   | ✅ — `cache_control` markers from the cross-format converter become Converse-native `cachePoint` blocks (T1)                                                        |
| Reasoning (`reasoning_content`)    | ✅ on supporting models (Claude, Llama 4)                                                                                                                           |
| Cross-region inference profiles    | Pass the inference-profile model id directly (e.g. `us.anthropic.claude-...`)                                                                                       |
| Performance config                 | ✅ — `performanceConfig.latency` from the connection (T22)                                                                                                          |
| Guardrails                         | ✅ — `guardrailConfig` from the connection (T21)                                                                                                                    |
| Capability gate                    | ✅ — pre-flight 400 when a known no-tool-support model receives `tools` (T19; covers Titan, Mixtral 8×7B, Mistral 7B, Llama 3 8B/70B, Llama 3.2 1B/3B, DeepSeek-R1) |

## `providerArgs` — Bedrock-native fields

Bedrock's Converse API accepts an
`additionalModelRequestFields` object for model-specific knobs the
unified Converse shape can't express. Send these via `providerArgs`:

```jsonc
{
  "vmx": {
    "providerArgs": {
      "additionalModelRequestFields": {
        "top_k": 50,
        "anthropic_beta": ["computer-use-2025-01-24"]
      }
    }
  }
}
```

> Note: `cache_control` markers are **not** sent via
> `additionalModelRequestFields` — Bedrock ignores them there. The
> gateway maps them onto Converse-native `cachePoint` blocks inside
> `messages[]` / `system[]` / `tools[]` automatically.

## Models

Any model id Bedrock exposes in your region — pass the full Bedrock
model id (`anthropic.claude-haiku-4-5-v1:0`,
`amazon.nova-pro-v1:0`, `meta.llama3-1-405b-instruct-v1:0`, …) or a
cross-region inference profile id.

## Audit row fields specific to Bedrock Converse

T24 surfaces Bedrock's observability fields onto the audit row via
the response headers stream:

- `x-bedrock-latency-ms` — `metrics.latencyMs` from the Converse
  response, the upstream's reported latency for the call.
- `x-bedrock-invoked-model-id` — `trace.promptRouter.invokedModelId`
  when the request resolved through a Bedrock prompt router (the
  actual model the router dispatched to).

The cache breakdown (`cache_creation_input_tokens` / `cached_tokens`)
flows through the same `prompt_tokens_details` shape the native
Anthropic and Bedrock-Invoke providers populate, so cost calculations
match across the three Anthropic-bearing paths.

## Notes

- **SSRF protection:** image / document URLs in the request body are
  hop-fetched server-side (Bedrock requires inline bytes for
  non-S3 sources). The gateway calls `assertSafeOutboundUrl()` on
  every URL — RFC1918, AWS IMDS, loopback, and IPv6 link-local
  hosts are blocked with a 400.
- **Image fetch failures:** if VM-X can't download an image referenced
  by `image_url`, the request fails fast with a `bad_image_url` error
  rather than sending an incomplete payload to Bedrock.
- **Per-region capacity:** Bedrock quotas are per-region — set up
  separate AI Connections per region you serve, with their own
  capacity entries.
- **`file_id` references are not supported** — Bedrock has no
  equivalent storage layer. Provide `file_data` (base64) or a data
  URL on `file` content parts.
