---
sidebar_position: 8
---

# AWS Bedrock-Invoke (Anthropic on AWS)

The `aws-bedrock-invoke` provider runs Claude on AWS Bedrock through
the [InvokeModel API](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_InvokeModel.html), which accepts the **full Anthropic
Messages request shape on the wire**.

Use this provider (instead of [`aws-bedrock`](./aws-bedrock.md)) when:

- You want Claude on AWS infrastructure for compliance / cost / region
  reasons, **and**
- You need Anthropic-only features the Bedrock Converse shape can't
  express — `cache_control`, extended `thinking`, server tools
  (`web_search_*`, `code_execution_*`, `bash_*`, `text_editor_*`,
  `computer_*`), `service_tier`, refusal stop details, citation
  attribution.

For non-Claude models on Bedrock (Llama, Mistral, Nova, Titan, …) use
the [`aws-bedrock`](./aws-bedrock.md) provider instead — it speaks the
unified Converse API.

## Connection config

Same shape as the [`aws-bedrock`](./aws-bedrock.md) provider — IAM
role assumption with `region` + `iamRoleArn`, plus the optional
`guardrailConfig` block (T21):

| Field             | Required | Description                                                                                                                 |
| ----------------- | :------: | --------------------------------------------------------------------------------------------------------------------------- |
| `region`          |   yes    | AWS region (e.g. `us-east-1`).                                                                                              |
| `iamRoleArn`      |   yes    | ARN of the IAM role VM-X assumes for every request.                                                                         |
| `guardrailConfig` |    no    | Bedrock Guardrails. Same shape as the Converse provider; `trace` is normalised to InvokeModel's uppercase enum at dispatch. |

```jsonc
{
  "provider": "aws-bedrock-invoke",
  "config": {
    "region": "us-east-1",
    "iamRoleArn": "arn:aws:iam::123456789012:role/vm-x-ai-bedrock-role"
  }
}
```

The same CloudFormation template works
([`packages/api/assets/aws/cfn/bedrock-iam-role.yaml`](https://github.com/vm-x-ai/vm-x-ai/blob/main/packages/api/assets/aws/cfn/bedrock-iam-role.yaml)).

Credentials are cached per `(workspaceId, environmentId, iamRoleArn)`
triple, exactly like the Converse provider.

## Endpoint passthrough — the headline feature

| Client request shape   | What hits the wire                                                                                                                                                                                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Anthropic Messages** | **Verbatim.** Body is forwarded to InvokeModel with `anthropic_version: 'bedrock-2023-05-31'` injected; `model` and `stream` are stripped (the Bedrock Invoke command carries those out-of-band). The gateway-internal `vmx` / `__vmx_passthrough` envelopes are stripped too. |
| Chat Completions       | Direct Chat Completions ↔ Anthropic Messages converter (single hop). `__vmx_passthrough.anthropic` envelope re-attached so cache markers / thinking / server tools survive.                                                                                                    |
| Responses              | Direct Responses ↔ Anthropic Messages converter (single hop — same converter used by the native Anthropic provider, since Bedrock-Invoke speaks Anthropic on the wire).                                                                                                        |

This is the only AWS provider where the gateway commits to
**input-side passthrough** for `/anthropic/messages` requests.
Everything Anthropic ships under their wire schema works end-to-end —
including features that don't exist on the Bedrock Converse API.

## Capabilities

| Capability                       | Status                                                                                                    |
| -------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Streaming                        | ✅                                                                                                        |
| Function / tool calling          | ✅                                                                                                        |
| Vision                           | ✅ — base64 / data-URL sources only (see notes)                                                           |
| Documents (`document` blocks)    | ✅ — PDFs (and other formats Anthropic accepts) round-trip via base64 (T8)                                |
| Prompt caching (`cache_control`) | ✅ — cost service applies the published 1.25× / 2× cache-write multipliers                                |
| Extended thinking                | ✅ — `thinking` and `redacted_thinking` blocks both round-trip (T8)                                       |
| Server tools                     | ✅ — `web_search_*` / `code_execution_*` / `bash_*` / `text_editor_*` / `computer_*`                      |
| MCP servers (`mcp_servers[]`)    | ✅ — re-emitted on the wire body (T8)                                                                     |
| `service_tier`                   | ✅                                                                                                        |
| Refusal stop details             | ✅                                                                                                        |
| Beta opt-ins (`anthropic_beta`)  | ✅ — `betas[]` on the canonical body lifts to `anthropic_beta` (underscore) on the InvokeModel body (T10) |

## Models

Pass any Claude model id Bedrock exposes
(`anthropic.claude-haiku-4-5-v1:0`,
`anthropic.claude-sonnet-4-6-v1:0`,
`anthropic.claude-opus-4-7-v1:0`, …) or a cross-region inference
profile id (`us.anthropic.claude-...`).

The gateway asserts the model id matches the Claude family before
dispatch — if you point an `aws-bedrock-invoke` connection at a
non-Claude model, you'll get a `400` rather than a confusing
provider-side error.

## Notes

- **External image URLs are not supported** (T23). Bedrock-Invoke's
  Anthropic API can't fetch URLs server-side, so the gateway
  pre-flights image content blocks and rejects URL sources with a
  clean 400 (`aws_bedrock_invoke_image_url_unsupported`). Convert
  images to base64 / data URLs before sending, or route the request
  through [`aws-bedrock`](./aws-bedrock.md) Converse (which fetches
  URLs server-side).
- **Beta opt-ins on the wire body** (T10): the canonical Anthropic
  shape uses `betas: [...]`, but Bedrock-Invoke's body schema expects
  the underscore form `anthropic_beta: [...]`. The gateway renames
  the field at dispatch — you can keep using `betas` (or the
  `anthropic-beta` HTTP header on the native Anthropic provider) on
  the way in.
- **`vmx` field strip:** Bedrock InvokeModel rejects unknown top-level
  fields with a 400. The gateway strips both `vmx` (correlationId /
  metadata / providerArgs / …) and `__vmx_passthrough` (cross-format
  carrier) before sending.
- **Mid-stream errors capture `providerRequestPayload`** — Anthropic
  throttling / model-stream / validation exceptions emitted partway
  through a stream still write a complete audit row, including the
  exact wire body that triggered the error.
- **Compare to `aws-bedrock`:** the Converse provider supports every
  Bedrock model but loses Anthropic-only features in conversion.
  Use Converse for Llama / Mistral / Nova / Titan; use Invoke for
  Claude when you need cache markers, extended thinking, or server
  tools.
