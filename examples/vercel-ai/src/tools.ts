// Multi-step tool use through VM-X. `generateText` runs the agentic
// loop: model emits tool calls, our `execute` runs locally, the result
// flows back, the model produces a final answer. `stopWhen` caps the
// loop depth so a runaway model can't burn tokens forever.

import { createOpenAI } from '@ai-sdk/openai';
import { generateText, stepCountIs, tool } from 'ai';
import { z } from 'zod';
import { load } from './config.js';

async function main(): Promise<void> {
  const cfg = load();
  const vmx = createOpenAI({
    baseURL: cfg.openaiBaseUrl,
    apiKey: cfg.apiKey,
  });

  const result = await generateText({
    model: vmx.chat(cfg.openaiResource),
    stopWhen: stepCountIs(5),
    tools: {
      getWeather: tool({
        description: 'Get the current weather for a city.',
        inputSchema: z.object({
          city: z.string().describe('City name'),
        }),
        execute: async ({ city }) => {
          if (city.toLowerCase().includes('são paulo')) {
            return { tempC: 22, conditions: 'cloudy', city };
          }
          if (city.toLowerCase().includes('rio')) {
            return { tempC: 28, conditions: 'sunny', city };
          }
          return { tempC: 18, conditions: 'unknown', city };
        },
      }),
    },
    prompt: 'What is the weather in São Paulo and Rio de Janeiro?',
  });

  console.log(`[tools] text -> ${JSON.stringify(result.text)}`);
  console.log(`[tools] steps -> ${result.steps.length}`);
  for (const [i, step] of result.steps.entries()) {
    if (step.toolCalls.length) {
      console.log(
        `[tools] step ${i} tool calls -> ${JSON.stringify(
          step.toolCalls.map((c) => ({ name: c.toolName, input: c.input }))
        )}`
      );
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
