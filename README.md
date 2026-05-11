# VM-X AI

**VM-X AI** is a comprehensive management layer for AI workloads, designed to centralize and optimize your interactions with multiple AI providers. Whether you're building applications that need to route requests intelligently, manage capacity across providers, or ensure high availability through fallback mechanisms, VM-X AI provides the infrastructure and tools you need.

## What is VM-X AI?

VM-X AI is a server and UI application that acts as a **routing and management layer** for AI workloads. It enables you to:

- **Centralize AI Access**: Manage all your AI provider credentials and connections in one place
- **Intelligent Routing**: Route requests to different providers based on dynamic conditions (token count, error rates, request characteristics)
- **Automatic Fallback**: Ensure high availability by automatically falling back to alternative providers when primary ones fail
- **Capacity Management**: Define and enforce custom capacity limits (RPM, TPM) per connection and resource
- **Prioritization**: Allocate capacity across multiple resources using sophisticated prioritization algorithms
- **Usage Analytics**: Track every request with comprehensive audit logs and time-series metrics
- **OpenAI Compatibility**: Use the standard OpenAI SDK to connect to VM-X and access any supported provider

## Key Features

- **Provider Abstraction**: Unified interface for OpenAI, Anthropic, Google Gemini, Groq, Perplexity, AWS Bedrock (Converse), and AWS Bedrock-Invoke (Anthropic on AWS)
- **Three Completion Endpoints**: Chat Completions, Anthropic Messages (native passthrough), and Responses — pick the SDK, the gateway converts shapes when the upstream doesn't match
- **Dynamic Routing**: Route requests based on token count, error rates, tool usage, and content analysis
- **Automatic Fallback**: Seamless failover to backup providers when primary providers fail
- **Per-Model Tuning**: Per-model `maxRetries`, `timeoutMs`, and secondary-model multi-answer fan-out
- **Provider Args Passthrough**: Caller `vmx.providerArgs` escape hatch for provider-only fields without giving up routing/fallback
- **Capacity Prioritization**: Intelligent capacity allocation using adaptive token scaling
- **Batch Processing**: Process thousands of requests with capacity-aware scheduling
- **Workspace & Environment Isolation**: Multi-tenant architecture with fine-grained access control
- **OpenTelemetry Support**: Export traces and metrics to any OpenTelemetry-compatible platform

## Quick Start

The fastest way to get started is using Docker Compose:

```bash
# Clone the repository
git clone https://github.com/vm-x-ai/vm-x-ai.git
cd vm-x-ai

# Start all services
docker-compose -f examples/docker-compose/default.docker-compose.yml up -d
```

Access the UI at `http://localhost:3001` and the API at `http://localhost:3000`.

For detailed setup instructions, see the [Getting Started Guide](https://vm-x-ai.github.io/docs/getting-started).

## Documentation

📚 **Complete documentation is available at [https://vm-x-ai.github.io/](https://vm-x-ai.github.io/)**

The documentation includes:

- **Introduction**: Overview of VM-X AI and its capabilities
- **Architecture**: Technical stack and system design
- **Getting Started**: Local deployment with Docker Compose
- **Deployment Guides**: Kubernetes (Minikube, AWS EKS) and AWS ECS
- **Features**: AI Connections, AI Resources, Routing, Fallback, Capacity, Prioritization, Batch Completion
- **Security**: Users, Roles, and Policy management
- **Integrations**: LangChain integration
- **LLM Providers**: Supported providers and feature matrix

## Supported Providers

VM-X AI supports seven AI providers:

- **OpenAI**: GPT and o-series models
- **Anthropic**: Claude models, native SDK with full feature passthrough (`cache_control`, extended `thinking`, server tools)
- **Google Gemini**: via Google's OpenAI-compatible endpoint
- **Groq**: high-performance Llama / Mixtral / Gemma inference
- **Perplexity**: search-augmented Sonar models with citations
- **AWS Bedrock (Converse)**: every Bedrock foundation model under the unified Converse API
- **AWS Bedrock-Invoke**: Claude on AWS via the InvokeModel API with full Anthropic Messages passthrough

See the [Provider Documentation](https://vm-x-ai.github.io/docs/integrations/providers/) for details.

## Tech Stack

- **Backend**: NestJS (Node.js)
- **Frontend**: Next.js (React)
- **Database**: PostgreSQL (also stores `request_audit` — usage analytics + cost tracking query directly from there)
- **Cache/Queue**: Redis
- **Encryption**: AWS KMS / Libsodium
- **Observability**: OpenTelemetry

## Development

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup and contribution guidelines.

### Quick Development Setup

1. Install dependencies: `pnpm install`
2. Start services: `docker-compose up -d`
3. Configure `.env.local` files (see [CONTRIBUTING.md](./CONTRIBUTING.md))
4. Start dev servers: `pnpm nx serve api` and `pnpm nx serve ui`

## License

[MIT License](./LICENSE)

## Links

- **Documentation**: [https://vm-x-ai.github.io/](https://vm-x-ai.github.io/)
- **GitHub**: [https://github.com/vm-x-ai/vm-x-ai](https://github.com/vm-x-ai/vm-x-ai)
- **Helm Repository**: [https://vm-x-ai.github.io/vm-x-ai/helm/](https://vm-x-ai.github.io/vm-x-ai/helm/)

---

Built with [Nx](https://nx.dev) - Smart, Fast and Extensible Build System
