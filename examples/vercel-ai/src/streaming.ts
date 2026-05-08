// `streamText` — token-by-token streaming through VM-X. Same provider
// configuration as the non-streaming example; the only difference is
// reading `.textStream` instead of awaiting `.text`.

import { createOpenAI } from '@ai-sdk/openai';
import { streamText } from 'ai';
import { load } from './config.js';

async function main(): Promise<void> {
  const cfg = load();
  const vmx = createOpenAI({
    baseURL: cfg.openaiBaseUrl,
    apiKey: cfg.apiKey,
  });

  const stream = streamText({
    model: vmx.chat(cfg.openaiResource),
    prompt: 'Write a two-sentence story about a robot learning to garden.',
  });

  process.stdout.write('[streaming] ');
  for await (const chunk of stream.textStream) {
    process.stdout.write(chunk);
  }
  process.stdout.write('\n');

  const usage = await stream.usage;
  console.log(`[streaming] usage -> ${JSON.stringify(usage)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
