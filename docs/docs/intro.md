---
sidebar_position: 1
---

# Introduction to VM-X AI

**VM-X AI** is a **multi-surface AI gateway** that sits between your applications and every major LLM provider. Send your traffic in the SDK shape you already use — OpenAI Chat Completions, OpenAI Responses, or Anthropic Messages — and VM-X routes it to the right provider, converts the wire format when the client and upstream don't match natively, enforces capacity, and writes a request-level audit row to Postgres for every call.

## What is VM-X AI?

VM-X AI is a server + UI that acts as a **routing, conversion, and management layer** for AI workloads. It enables you to:

- **Three client surfaces, one gateway**: Speak OpenAI Chat Completions, OpenAI Responses, or Anthropic Messages — VM-X converts between surfaces when needed and preserves the upstream wire format verbatim when it doesn't.
- **Centralize AI access**: Manage credentials, capacity, and routing for every provider in one place.
- **Intelligent routing**: Route requests dynamically based on token count, tool usage, error rates, or any expression over the request shape.
- **Automatic fallback**: Cascade through alternative connections when a primary provider errors or runs out of capacity.
- **Capacity & prioritization**: Per-connection and per-resource RPM/TPM limits with weighted prioritization across resources.
- **Usage analytics**: Every request is stored in the Postgres `request_audit` table and rolled up on demand into dashboards.
- **SDK compatibility**: Drop-in for the OpenAI, Anthropic, Vercel AI, LangChain, and Claude Agent SDKs.

## The Problem We Solve

As AI adoption grows, organizations face several critical challenges:

### 1. **Provider Fragmentation**

Managing multiple AI providers (OpenAI, Anthropic, Google, Groq, AWS Bedrock) requires:

- Different SDKs and authentication methods
- Separate rate limiting and capacity management
- Manual failover logic in application code
- Inconsistent error handling

### 2. **Cost Optimization**

Without intelligent routing, you may:

- Use expensive models for simple tasks
- Miss opportunities to use cost-effective providers
- Lack visibility into actual usage and costs

### 3. **Reliability and Availability**

Single points of failure can cause:

- Service disruptions when a provider is down
- No automatic failover mechanisms
- Difficult capacity planning and scaling

### 4. **Security and Compliance**

Managing AI credentials and access requires:

- Secure credential storage and encryption
- Audit trails for compliance
- Fine-grained access control
- API key management

### 5. **Observability**

Understanding AI usage patterns requires:

- Request-level audit logs in Postgres for usage analysis and capacity planning
- OpenTelemetry traces, metrics, and logs for application-level observability (decoupled from usage data)
- Integration with existing observability stacks
- Cost attribution and analysis

## Key Benefits

### 🎯 **Centralized Management**

- Single API endpoint for all AI providers
- Unified credential management with encryption
- Consistent interface regardless of provider

### 🚀 **Intelligent Routing**

- Route based on request characteristics (token count, error rates, tools usage)
- Support for complex routing rules with advanced expressions
- Traffic splitting for A/B testing and gradual rollouts

### 🔄 **High Availability**

- Automatic fallback to alternative providers
- Configurable fallback chains
- Resilience to provider outages

### 📊 **Capacity Control**

- Define custom capacity limits (RPM, TPM) per connection
- Resource-level capacity enforcement
- Prioritization algorithms for fair capacity allocation

### 🔐 **Security First**

- AWS KMS or Libsodium encryption for credentials
- API key management with resource-level access control
- Complete audit trail for all requests
- OIDC Federated Login support for enterprise SSO

### 📈 **Observability**

- Every request stored in the Postgres `request_audit` table; usage dashboards query this table directly
- OpenTelemetry integration for distributed tracing, application metrics, and structured logs
- Optional export to Jaeger / Prometheus / Loki / Grafana (or any OTel-compatible backend)
- Application-level observability is fully decoupled from usage analytics — disabling OTel does not affect audit/usage data

### 🔌 **OpenAI Compatibility**

- Use the standard OpenAI SDK
- Drop-in replacement for OpenAI API
- No code changes required to switch providers

## When to Use VM-X AI

VM-X AI is ideal for:

### ✅ **Multi-Provider Strategies**

- You use multiple AI providers and want to optimize costs and performance
- You need to route requests intelligently based on workload characteristics
- You want to avoid vendor lock-in

### ✅ **Enterprise Requirements**

- You need comprehensive audit logs for compliance
- You require fine-grained capacity management and prioritization
- You need secure credential management with encryption

### ✅ **High Availability Needs**

- You cannot afford downtime from provider outages
- You need automatic failover mechanisms
- You want to distribute load across multiple providers

### ✅ **Cost Optimization**

- You want to use cost-effective providers for appropriate workloads
- You need visibility into usage patterns and costs
- You want to enforce capacity limits to control spending

### ✅ **Observability and Monitoring**

- You need detailed metrics and traces for AI workloads
- You want to integrate with existing observability stacks (Datadog, Prometheus, etc.)
- You need request-level audit data for capacity planning and cost attribution

## Supported AI Providers

VM-X AI currently supports seven providers, each implemented with **per-surface converter classes** under `packages/api/src/ai-provider/<provider>/`:

- **OpenAI** — GPT and o-series. Native on Chat Completions and Responses; Anthropic Messages traffic is converted via Responses.
- **Anthropic** — Claude models, native Messages SDK with full feature support (`cache_control`, extended `thinking`, server tools, …).
- **Google Gemini** — native `@google/genai` SDK. Tools, file inputs, and web search use Gemini-native shapes (`googleSearch.timeRangeFilter`, `code_execution`, etc.).
- **Groq** — high-performance Llama / Mixtral / Gemma inference. Native Responses API support.
- **Perplexity** — search-augmented Sonar models with citations. Native Responses API support; web search via `tools[].filters`.
- **AWS Bedrock (Converse)** — every Bedrock foundation model (Claude, Llama, Mistral, Nova, …) under the unified Converse API.
- **AWS Bedrock-Invoke** — Claude on AWS via `InvokeModel` with full Anthropic Messages passthrough (cache markers, `thinking`, server tools survive).

For each provider, the gateway picks the converter matching the **inbound surface** the client called:

- [`chat-completion.provider.ts`](https://github.com/vm-x-ai/open-vm-x-ai/tree/main/packages/api/src/ai-provider) — inbound OpenAI Chat Completions
- [`openai-response.provider.ts`](https://github.com/vm-x-ai/open-vm-x-ai/tree/main/packages/api/src/ai-provider) — inbound OpenAI Responses
- [`anthropic-messages.provider.ts`](https://github.com/vm-x-ai/open-vm-x-ai/tree/main/packages/api/src/ai-provider) — inbound Anthropic Messages

When the inbound surface matches the upstream natively, the gateway forwards the upstream payload **verbatim** (no normalization of provider quirks). Live integration specs in [`packages/api/src/__integration__/providers/`](https://github.com/vm-x-ai/open-vm-x-ai/tree/main/packages/api/src/__integration__/providers) are the source of truth for every cell.

See the [LLM Providers](./integrations/providers/index.md) index for the side-by-side capability matrix and per-provider pages.

## Supported Surfaces

VM-X exposes three completion endpoints. Any provider can be reached through any of them; the matching converter handles the surface conversion:

- **OpenAI Chat Completions** — `POST /v1/completion/{ws}/{env}/chat/completions`
- **OpenAI Responses** — `POST /v1/completion/{ws}/{env}/responses` (typed-events surface; `web_search` tool, not `web_search_preview`)
- **Anthropic Messages** — `POST /v1/completion/{ws}/{env}/anthropic/messages` (also exposed at `…/anthropic/v1/messages`); passes through verbatim to Anthropic + Bedrock-Invoke

Every request can carry a [`vmx` envelope](./features/api/vmx-envelope.md) (correlation ID, metadata, timeouts, `resourceConfigOverrides`) or a `__vmx_passthrough` marker. `vmx.providerArgs` injects provider-native fields directly into the upstream payload without going through the converter — handy for surface-specific knobs your SDK doesn't expose.

See [API Endpoints](./features/api/index.md) for the contract and client examples.

## Key Concepts

VM-X AI is organized around several key concepts:

- **Workspaces**: Top-level isolation for different organizations or teams
- **Environments**: Isolation within workspaces (e.g., production, staging, development)
- **AI Connections**: Provider credentials and capacity configuration
- **AI Resources**: Logical endpoints with routing and fallback rules
- **Users & Roles**: Fine-grained access control with policy-based permissions
- **API Keys**: Authentication tokens scoped to resources and environments
- **Playground**: Per-environment in-UI tester for all three surfaces and every connection (see [Playground](./features/playground.md))

## Architecture Overview

VM-X AI consists of:

- **API Server** (NestJS) — handles request conversion, routing, fallback, capacity, audit, and admin APIs. Local port `3030`; in-container port `3000`.
- **UI Application** (Next.js) — admin console + playground. Local port `3001`.
- **PostgreSQL** — single source of truth for configuration and the `request_audit` table; usage dashboards aggregate this table on demand.
- **Redis** (cluster mode, 3 nodes) — capacity / prioritization counters and short-lived caches.
- **AWS KMS or Libsodium** — encryption for connection credentials at rest.
- **OpenTelemetry** (optional) — application observability via OTel collector → Jaeger / Prometheus / Loki / Grafana (or any OTel backend). Fully decoupled from the audit pipeline; disabling OTel does not affect usage data.

## Next Steps

Ready to get started? Check out:

- [Core Components](./core-components.md) - Learn about AI Connections and AI Resources
- [Architecture](./architecture.md) - Understand the technical stack
- [Getting Started](./getting-started.md) - Deploy VM-X AI locally with Docker Compose
- [Deployment Guides](./deployment/minikube.md) - Deploy to Kubernetes or AWS
