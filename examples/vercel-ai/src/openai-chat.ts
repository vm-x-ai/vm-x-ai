// Vercel AI SDK against VM-X's /chat/completions endpoint.
//
// `createOpenAI({ baseURL })` points the provider at the VM-X gateway;
// `.chat(model)` selects the chat-completions transport (the SDK
// appends `/chat/completions` to the baseURL). The `model` is the
// VM-X AI Resource name, not an upstream provider model id.

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
    model: vmx.chat(cfg.openaiResource),
    prompt: 'Say hi in three words.',
  });

  console.log(`[openai-chat] text -> ${JSON.stringify(text)}`);
  console.log(`[openai-chat] usage -> ${JSON.stringify(usage)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
