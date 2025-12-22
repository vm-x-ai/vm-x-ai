---
sidebar_position: 1
---

# Introduction to VM-X AI

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

- Request-level audit logs
- Time-series metrics for capacity planning
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

- Every request stored in audit logs
- Time-series metrics for usage analysis
- OpenTelemetry integration for distributed tracing
- Export to QuestDB, AWS Timestream, or any OpenTelemetry-compatible backend

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
- You need time-series data for capacity planning

## Supported AI Providers

VM-X AI currently supports the following AI providers:

- **Amazon Bedrock** - AWS managed AI service
- **Anthropic** - Claude models
- **Google Gemini** - Google's AI models
- **Groq** - High-performance inference
- **OpenAI** - GPT models

## Supported Operations

Currently, VM-X AI supports:

- **Chat Completions API** - The standard chat completion endpoint compatible with OpenAI's API

Future versions will support additional operations like embeddings, fine-tuning, and more.

## Key Concepts

VM-X AI is organized around several key concepts:

- **Workspaces**: Top-level isolation for different organizations or teams
- **Environments**: Isolation within workspaces (e.g., production, staging, development)
- **AI Connections**: Provider credentials and capacity configuration
- **AI Resources**: Logical endpoints with routing and fallback rules
- **Users & Roles**: Fine-grained access control with policy-based permissions
- **API Keys**: Authentication tokens scoped to resources and environments

## Architecture Overview

VM-X AI consists of:

- **API Server** (NestJS) - Backend service handling all AI requests, routing, and management
- **UI Application** (Next.js) - Web interface for configuration and monitoring
- **PostgreSQL** - Primary database for configuration and audit logs
- **QuestDB / AWS Timestream** - Time-series database for usage metrics
- **Redis** - Caching and capacity tracking
- **AWS KMS / Libsodium** - Encryption for sensitive credentials

## Next Steps

Ready to get started? Check out:

- [Core Components](./core-components.md) - Learn about AI Connections and AI Resources
- [Architecture](./architecture.md) - Understand the technical stack
- [Getting Started](./getting-started.md) - Deploy VM-X AI locally with Docker Compose
- [Deployment Guides](../deployment/minikube) - Deploy to Kubernetes or AWS
