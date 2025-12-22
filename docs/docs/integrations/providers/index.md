---
sidebar_position: 1
---

# LLM Providers

VM-X AI supports multiple LLM providers through a unified OpenAI-compatible API. This allows you to use any supported provider with the same interface, while leveraging VM-X AI's routing, fallback, and capacity management features.

## Supported Providers

VM-X AI currently supports the following providers:

- **OpenAI** - GPT-4, GPT-3.5, and other OpenAI models
- **Anthropic** - Claude models (Haiku, Sonnet, Opus)
- **Google Gemini** - Gemini models (Flash, Pro)
- **Groq** - Fast inference with various open-source models
- **AWS Bedrock** - Access to multiple models through AWS Bedrock

## Feature Matrix

The following table compares features across all supported providers:

| Feature                    | OpenAI  | Anthropic | Google Gemini | Groq    | AWS Bedrock |
| -------------------------- | ------- | --------- | ------------- | ------- | ----------- |
| **Authentication**         | API Key | API Key   | API Key       | API Key | IAM Role    |
| **Streaming**              | ✅      | ✅        | ✅            | ✅      | ✅          |
| **Tools/Function Calling** | ✅      | ✅        | ✅            | ✅      | ✅          |
| **Non-Streaming**          | ✅      | ✅        | ✅            | ✅      | ✅          |
| **OpenAI-Compatible API**  | ✅      | ✅        | ✅            | ✅      | ✅          |
| **Rate Limit Handling**    | ✅      | ✅        | ✅            | ✅      | ✅          |
| **Error Retry Logic**      | ✅      | ✅        | ✅            | ✅      | ✅          |
| **Usage Tracking**         | ✅      | ✅        | ✅            | ✅      | ✅          |
| **Multiple Models**        | ✅      | ✅        | ✅            | ✅      | ✅          |

### Feature Descriptions

- **Authentication**: Method used to authenticate with the provider

  - **API Key**: Standard API key authentication
  - **IAM Role**: AWS IAM role-based authentication (Bedrock only)

- **Streaming**: Support for Server-Sent Events (SSE) streaming responses

- **Tools/Function Calling**: Support for function calling and tool usage

- **Non-Streaming**: Support for standard request/response (non-streaming) mode

- **OpenAI-Compatible API**: Uses OpenAI-compatible API format for consistency

- **Rate Limit Handling**: Automatic handling of rate limit errors with retry logic

- **Error Retry Logic**: Automatic retry for transient errors (5xx, rate limits)

- **Usage Tracking**: Token usage tracking (prompt, completion, total tokens)

- **Multiple Models**: Support for multiple models from the same provider

## Common Features

All providers support:

- **Unified API**: Same OpenAI-compatible interface across all providers
- **VM-X AI Features**: Routing, fallback, capacity management, prioritization
- **Error Handling**: Consistent error handling and retry logic
- **Usage Tracking**: Token usage tracking and metrics
- **Streaming**: Real-time streaming responses
- **Tools**: Function calling and tool usage

## Getting Started

1. **Create an AI Connection**: Set up authentication for your chosen provider(s)
2. **Create an AI Resource**: Configure which provider/model to use
3. **Use the OpenAI SDK**: Connect using the standard OpenAI SDK with VM-X AI's endpoint

For detailed provider-specific documentation, see the individual provider pages.

## Next Steps

- **OpenAI Provider** - Configure OpenAI connections
- **Anthropic Provider** - Configure Anthropic connections
- **Google Gemini Provider** - Configure Gemini connections
- **Groq Provider** - Configure Groq connections
- **AWS Bedrock Provider** - Configure AWS Bedrock connections
- **AI Connections** - Learn about AI Connections
- **AI Resources** - Learn about AI Resources
