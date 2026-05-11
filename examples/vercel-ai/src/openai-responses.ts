// Vercel AI SDK against VM-X's /responses endpoint.
//
// `vmx.responses(model)` selects the OpenAI Responses transport — the
// SDK appends `/responses` to the baseURL. Same auth + same resource-
// name model field as the chat-completions example.

import { createOpenAI } from '@ai-sdk/openai';
import { generateText } from 'ai';
import { load } from './config.js';

async function main(): Promise<void> {
  const cfg = load();
  const vmx = createOpenAI({
    baseURL: cfg.openaiBaseUrl,
    apiKey: cfg.apiKey,
  });

  const { text, usage } = await generateText({
    model: vmx.responses(cfg.openaiResource),
    prompt: 'Say hi in three words.',
  });

  console.log(`[openai-responses] text -> ${JSON.stringify(text)}`);
  console.log(`[openai-responses] usage -> ${JSON.stringify(usage)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
