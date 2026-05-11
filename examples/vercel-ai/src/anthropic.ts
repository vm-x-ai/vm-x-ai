// Vercel AI SDK against VM-X's /anthropic/messages endpoint.
//
// `createAnthropic({ baseURL })` points the provider at the gateway's
// `…/anthropic` prefix — the SDK appends `/v1/messages` itself, which
// hits VM-X's `…/anthropic/v1/messages` alias. Anthropic-only features
// (cache_control, extended thinking, server tools) survive end-to-end
// when the resolved resource routes to a native Anthropic / Bedrock-
// Invoke provider.

import { createAnthropic } from '@ai-sdk/anthropic';
import { generateText } from 'ai';
import { load } from './config.js';

async function main(): Promise<void> {
  const cfg = load();
  if (!cfg.anthropicResource) {
    console.log('[anthropic] VMX_ANTHROPIC_RESOURCE not set — skipping.');
    return;
  }

  const vmx = createAnthropic({
    baseURL: cfg.anthropicBaseUrl,
    apiKey: cfg.apiKey,
  });

  const { text, usage } = await generateText({
    model: vmx(cfg.anthropicResource),
    prompt: 'Say hi in three words.',
  });

  console.log(`[anthropic] text -> ${JSON.stringify(text)}`);
  console.log(`[anthropic] usage -> ${JSON.stringify(usage)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
