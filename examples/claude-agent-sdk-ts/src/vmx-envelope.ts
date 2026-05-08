// Attach `vmx` envelope fields to every outgoing agent request via
// the Claude Code CLI's `ANTHROPIC_CUSTOM_HEADERS` env var. The CLI
// reads that env (newline-separated `Name: Value` pairs) and forwards
// the headers verbatim. VM-X maps the `x-vmx-*` headers back onto a
// `vmx` envelope on the canonical request body.
//
// Only `correlationId` and `metadata` are header-readable today.
// Body-only fields (`resourceConfigOverrides`, `providerArgs`,
// `secondaryModelIndex`, `timeoutMs`) aren't available with the
// Agent SDK because the CLI fully owns the request body.

import { query } from '@anthropic-ai/claude-agent-sdk';
import { load, optionsEnv } from './config.js';

function vmxHeaderEnv(headers: Record<string, string>): string {
  return Object.entries(headers)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
}

async function main(): Promise<void> {
  const cfg = load();

  const env = optionsEnv(cfg);
  env.ANTHROPIC_CUSTOM_HEADERS = vmxHeaderEnv({
    'x-vmx-correlation-id': `claude-agent-sdk-ts-example-${Date.now()}`,
    'x-vmx-metadata-team': 'growth',
    'x-vmx-metadata-user_id': 'u_42',
    'x-vmx-metadata-feature': 'claude-agent-sdk-ts-vmx-example',
  });

  for await (const message of query({
    prompt: 'Say hi in three words.',
    options: {
      env,
      model: cfg.anthropicResource,
      ...(cfg.pathToClaudeCodeExecutable
        ? { pathToClaudeCodeExecutable: cfg.pathToClaudeCodeExecutable }
        : {}),
    },
  })) {
    if (message.type === 'assistant') {
      for (const block of message.message.content) {
        if (block.type === 'text') {
          console.log(`[assistant] -> ${block.text}`);
        }
      }
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
