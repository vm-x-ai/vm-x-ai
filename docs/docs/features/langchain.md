---
sidebar_position: 5
---

# LangChain Integration

VM-X AI works with LangChain out of the box. Point `ChatOpenAI` at the
`/chat/completions` endpoint, or `ChatAnthropic` at the
`/anthropic/messages` endpoint — both flow through the same gateway,
sharing the routing, fallback, capacity, and audit pipeline.

For the underlying URL pattern, auth header forms, and `vmx` envelope
shape, see the [API overview](./api/index.md) and the
[`vmx` envelope reference](./api/vmx-envelope.md). This page only
covers the LangChain-specific bits.

## Overview

LangChain can connect to VM-X AI two ways:

- `ChatOpenAI` (from `langchain-openai`) → `/chat/completions`. Most
  common — broadest provider compatibility behind a single endpoint.
- `ChatAnthropic` (from `langchain-anthropic`) → `/anthropic/messages`.
  Use when you need Anthropic-native features that have no OpenAI
  equivalent (`cache_control`, extended `thinking`, server tools, etc.).

Either way you get:

- All LangChain features (agents, chains, tools)
- VM-X AI's routing and fallback
- Centralized AI management

## Installation

Install LangChain with OpenAI support:

```bash
pip install langchain[openai]>=0.3.27
```

## Basic Usage

### Simple Chat (OpenAI-compatible endpoint)

The OpenAI SDK that backs `ChatOpenAI` sends `Authorization: Bearer <key>`,
which is one of the two header forms VM-X accepts (the other being
`x-api-key`). No extra config needed.

```python
import os
from langchain_openai import ChatOpenAI

workspace_id = "your-workspace-id"
environment_id = "your-environment-id"
resource_name = "your-resource-name"
api_key = os.getenv("VMX_AI_API_KEY")

base_url = f"http://localhost:3000/v1/completion/{workspace_id}/{environment_id}"

model = ChatOpenAI(
    model=resource_name,  # Your AI Resource name
    api_key=api_key,
    base_url=base_url,
)

response = model.invoke("What is the weather in São Paulo?")
print(response.content)
```

### Anthropic-shape endpoint (`ChatAnthropic`)

If your application is already standardised on `langchain-anthropic`,
point `ChatAnthropic` at the `/anthropic/messages` endpoint. The
Anthropic SDK appends `/v1/messages` to the configured `base_url`, so
strip the trailing `/messages` from the path you'd use with cURL — VM-X
exposes the prefix at `…/anthropic`.

```bash
pip install langchain-anthropic>=0.3
```

```python
import os
from langchain_anthropic import ChatAnthropic

workspace_id = "your-workspace-id"
environment_id = "your-environment-id"
resource_name = "your-resource-name"
api_key = os.getenv("VMX_AI_API_KEY")

# Anthropic SDK appends `/v1/messages`; we end the base_url at `/anthropic`.
base_url = f"http://localhost:3000/v1/completion/{workspace_id}/{environment_id}/anthropic"

model = ChatAnthropic(
    model=resource_name,  # AI Resource name (NOT a claude-* model id)
    api_key=api_key,
    base_url=base_url,
    max_tokens=1024,
)

response = model.invoke("What is the weather in São Paulo?")
print(response.content)
```

This path keeps Anthropic-only features (`cache_control`, extended
`thinking`, server tools, `top_k`, `service_tier`, …) intact end-to-end
when the resolved provider is Anthropic or Bedrock-Invoke. See the
[Anthropic Messages endpoint reference](./api/index.md#format-passthrough--what-survives-end-to-end)
for the passthrough matrix.

## Advanced Usage with Agents

### Creating an Agent with Tools

```python
import json
import os
from langchain.agents import create_agent
from langchain_core.messages import (
    AIMessage,
    FunctionMessage,
    HumanMessage,
    SystemMessage,
    ToolMessage,
)
from langchain_openai import ChatOpenAI


def get_weather(city: str) -> str:
    """Get weather for a given city."""
    if city.lower() == "são paulo":
        return "It's always cloudy in São Paulo!"
    elif city.lower() == "rio de janeiro":
        return "It's always sunny in Rio de Janeiro!"
    else:
        return "I don't know the weather in this city."


def main():
    workspace_id = "8eab8372-a0ae-4856-9d6e-ad8589499c80"
    environment_id = "c24ff5a5-40f1-417c-919d-b627f06060b0"
    resource_name = "openai"
    api_key = os.getenv("VMX_AI_API_KEY")
    base_url = f"http://localhost:3000/v1/completion/{workspace_id}/{environment_id}"

    model = ChatOpenAI(
        model=resource_name,  # It will use the resource model/routing configuration
        api_key=api_key,
        base_url=base_url,
        streaming=True,
    )

    agent = create_agent(
        model=model,
        tools=[get_weather],
        system_prompt="You are a helpful assistant",
    )

    result = agent.stream(
        {
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "You are a helpful assistant, always provide "
                        "a fun fact about the asked location"
                    ),
                },
                {
                    "role": "user",
                    "content": "what is the weather in São Paulo and Rio de Janeiro",
                },
            ]
        }
    )

    for chunk in result:
        if "model" in chunk:
            for message in chunk["model"]["messages"]:
                print("-" * 30)
                match message:
                    case HumanMessage():
                        print("User Message:")
                        print(message.content)
                    case AIMessage():
                        print("AI Message:")
                        if message.tool_calls:
                            for tool_call in message.tool_calls:
                                print("Tool Call:")
                                print(json.dumps(tool_call))
                        else:
                            print(message.content)
                    case SystemMessage():
                        print("System Instruction:")
                        print(message.content)
                    case ToolMessage():
                        print("Tool Result:")
                        print(message.model_dump_json())
                    case FunctionMessage():
                        print("Function Result:")
                        print(message.model_dump_json())
                print("-" * 30)


if __name__ == "__main__":
    main()
```

## Overriding Resource Configuration

You can override the resource's model/routing configuration for specific
requests by passing a `vmx` field through `extra_body` (Python). See the
[`vmx` envelope reference](./api/vmx-envelope.md) for the full field
list — `correlationId`, `metadata`, `timeoutMs`, `providerArgs`,
`secondaryModelIndex`, `resourceConfigOverrides`.

```python
from langchain_openai import ChatOpenAI

model = ChatOpenAI(
    model="router",  # Resource name
    api_key=api_key,
    base_url=base_url,
    extra_body={
        "vmx": {
            # Override the resource model/routing configuration
            "resourceConfigOverrides": {
                "model": {
                    "provider": "aws-bedrock",
                    "model": "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
                    "connectionId": "f0fb0a42-6b31-424e-ae85-2ee6ffdeff65",
                }
            }
        }
    },
    streaming=True,
)
```

## Streaming

VM-X AI supports streaming responses:

```python
model = ChatOpenAI(
    model=resource_name,
    api_key=api_key,
    base_url=base_url,
    streaming=True,
)

for chunk in model.stream("Tell me a story"):
    print(chunk.content, end="", flush=True)
```

## Benefits of Using VM-X AI with LangChain

### 1. Centralized Management

- Manage all AI providers in one place
- No need to change code when switching providers
- Consistent API across all providers

### 2. Intelligent Routing

- Automatically route requests based on conditions
- Use cost-effective providers for appropriate workloads
- Optimize performance and costs

### 3. High Availability

- Automatic fallback to alternative providers
- Resilience to provider outages
- No code changes needed

### 4. Observability

- Complete audit trail of all requests
- Usage metrics and analytics
- Integration with OpenTelemetry

### 5. Capacity Management

- Enforce rate limits and capacity constraints
- Prioritize resources based on business needs
- Control costs effectively

## Example Project

A complete example is available in the [examples/langchain](https://github.com/vm-x-ai/vm-x-ai/tree/main/examples/langchain) directory.

The example includes:

- Agent creation with tools
- Streaming support
- Resource configuration overrides
- Error handling

To get started with the example:

```bash
cd examples/langchain
pip install -e .
python -m langchain_vmx_example
```

## Troubleshooting

### Connection Issues

If you encounter connection issues:

1. **Verify Base URL**: Ensure the base URL includes workspace and environment IDs
2. **Check API Key**: Verify the API key is correct and has access to the resource
3. **Check Resource**: Ensure the resource name matches your AI Resource

### Authentication Errors

If you get authentication errors:

1. **Check API Key**: Verify the API key is valid
2. **Check Resource Access**: Ensure the API key has access to the resource
3. **Check Workspace/Environment**: Verify workspace and environment IDs are correct

### Model Not Found

If you get "model not found" errors:

1. **Check Resource Name**: Verify the resource name matches exactly
2. **Check Environment**: Ensure you're using the correct environment ID
3. **Check Resource Status**: Verify the resource is enabled and configured correctly
