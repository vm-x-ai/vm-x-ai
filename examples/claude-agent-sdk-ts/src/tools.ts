// Claude Agent SDK with an in-process custom tool, routed through
// VM-X. `createSdkMcpServer` exposes our tool to the agent loop via
// an embedded MCP server; the model's tool calls + tool results flow
// through transparently.

import {
  createSdkMcpServer,
  query,
  tool,
} from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { load, optionsEnv } from './config.js';

const getWeather = tool(
  'get_weather',
  'Get the current weather for a city.',
  { city: z.string().describe('City name') },
  async ({ city }) => {
    let text: string;
    const lc = city.toLowerCase();
    if (lc.includes('são paulo') || lc.includes('sao paulo')) {
      text = 'São Paulo: 22°C, cloudy';
    } else if (lc.includes('rio')) {
      text = 'Rio de Janeiro: 28°C, sunny';
    } else {
      text = `${city}: temperature unknown`;
    }
    return { content: [{ type: 'text', text }] };
  }
);

async function main(): Promise<void> {
  const cfg = load();
  const server = createSdkMcpServer({
    name: 'weather',
    version: '1.0.0',
    tools: [getWeather],
  });

  const prompt =
    'What is the weather in São Paulo and Rio de Janeiro? ' +
    'Use the get_weather tool for each city.';

  for await (const message of query({
    prompt,
    options: {
      env: optionsEnv(cfg),
      model: cfg.anthropicResource,
      mcpServers: { weather: server },
      allowedTools: ['mcp__weather__get_weather'],
      ...(cfg.pathToClaudeCodeExecutable
        ? { pathToClaudeCodeExecutable: cfg.pathToClaudeCodeExecutable }
        : {}),
    },
  })) {
    if (message.type === 'assistant') {
      for (const block of message.message.content) {
        if (block.type === 'text') {
          console.log(`[assistant text] -> ${block.text}`);
        } else if (block.type === 'tool_use') {
          console.log(
            `[assistant tool_use] -> ${block.name}(${JSON.stringify(
              block.input
            )})`
          );
        }
      }
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
