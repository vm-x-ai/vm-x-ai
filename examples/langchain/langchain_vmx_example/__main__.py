"""LangChain example."""

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
    return f"It's always sunny in {city}!"


def main():
    workspace_id = "8eab8372-a0ae-4856-9d6e-ad8589499c80"
    environment_id = "c24ff5a5-40f1-417c-919d-b627f06060b0"
    resource_id = "openai"
    api_key = os.getenv("VMX_AI_API_KEY")
    base_url = f"http://localhost:3000/v1/completion/{workspace_id}/{environment_id}/{resource_id}"

    model = ChatOpenAI(
        model="router", # It will use the resource model/routing configuration
        api_key=api_key,
        base_url=base_url,
        extra_body={
            "vmx": {
                # We can override the resource model/routing configuration
                "resourceConfigOverrides": {
                    "model": {
                        "provider": "aws-bedrock",
                        "model": "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
                        "connectionId": "f0fb0a42-6b31-424e-ae85-2ee6ffdeff65"
                    }
                }
            }
        },
        streaming=True
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
                {"role": "user", "content": "what is the weather in sf"},
            ]
        }
    )

    for chunk in result:
        if 'model' in chunk:
            for message in chunk['model']["messages"]:
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
