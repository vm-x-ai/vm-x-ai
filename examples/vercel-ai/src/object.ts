// `generateObject` — structured output validated against a Zod schema.
// Runs through VM-X just like a plain text generation; the SDK adds
// the JSON-schema constraint on the underlying request.

import { createOpenAI } from '@ai-sdk/openai';
import { generateObject } from 'ai';
import { z } from 'zod';
import { load } from './config.js';

async function main(): Promise<void> {
  const cfg = load();
  const vmx = createOpenAI({
    baseURL: cfg.openaiBaseUrl,
    apiKey: cfg.apiKey,
  });

  const { object, usage } = await generateObject({
    model: vmx.chat(cfg.openaiResource),
    schema: z.object({
      recipe: z.object({
        name: z.string(),
        ingredients: z.array(z.string()),
        steps: z.array(z.string()),
      }),
    }),
    prompt: 'Generate a short recipe for tomato soup.',
  });

  console.log(`[object] recipe -> ${JSON.stringify(object, null, 2)}`);
  console.log(`[object] usage -> ${JSON.stringify(usage)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
