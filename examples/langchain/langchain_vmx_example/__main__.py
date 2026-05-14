"""LangChain example.

Points `ChatOpenAI` (from `langchain-openai`) at the VM-X gateway's
OpenAI Chat Completions surface and walks through an agent + tool
call. The gateway preserves the OpenAI wire format verbatim, so
LangChain talks to it exactly the way it talks to OpenAI itself —
the only difference is `base_url` and using the VM-X **resource
name** in `model` (the gateway resolves the resource to an upstream
provider / model id).

Required environment variables:

- ``VMX_AI_API_KEY``    — VM-X API key
- ``VMX_WORKSPACE_ID``  — target workspace UUID
- ``VMX_ENVIRONMENT_ID`` — target environment UUID
- ``VMX_RESOURCE_NAME`` — name of the AI Resource to route through
                          (defaults to ``openai``)
- ``VMX_BASE_URL``      — defaults to ``http://localhost:3030/api``
                          (the local dev API: port 3030 with the
                          ``/api`` base path). For a deployed gateway,
                          set this to your gateway origin.
"""

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
    api_key = os.environ.get("VMX_AI_API_KEY")
    workspace_id = os.environ.get("VMX_WORKSPACE_ID")
    environment_id = os.environ.get("VMX_ENVIRONMENT_ID")
    resource_name = os.environ.get("VMX_RESOURCE_NAME", "openai")
    gateway_base = os.environ.get("VMX_BASE_URL", "http://localhost:3030/api")

    missing = [
        name
        for name, val in (
            ("VMX_AI_API_KEY", api_key),
            ("VMX_WORKSPACE_ID", workspace_id),
            ("VMX_ENVIRONMENT_ID", environment_id),
        )
        if not val
    ]
    if missing:
        raise SystemExit(
            "Missing required env vars: "
            + ", ".join(missing)
            + "\nSet them in your shell or in `examples/langchain/.env.local` "
            "before running the example."
        )

    # The OpenAI SDK appends `/chat/completions` to `base_url`, so the
    # base_url stops one segment short of the full gateway path:
    # `…/v1/completion/{workspace}/{environment}`.
    base_url = (
        f"{gateway_base}/v1/completion/{workspace_id}/{environment_id}"
    )

    model = ChatOpenAI(
        # The resource name — NOT an upstream model id. The gateway
        # resolves the resource to the configured provider/model and
        # applies any routing/fallback rules attached to it.
        model=resource_name,
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
                    case _:
                        print("Unknown message")
                        print(message)
                print("-" * 30)


if __name__ == "__main__":
    main()
