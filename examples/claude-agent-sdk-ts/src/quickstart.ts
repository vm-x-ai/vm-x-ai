// Hello-world Claude Agent SDK call through a VM-X gateway.
//
// `query()` returns an async iterable that yields system / assistant /
// user / result messages as the agent loop runs. We only print the
// assistant's text blocks here.

import { query } from '@anthropic-ai/claude-agent-sdk';
import { load, optionsEnv } from './config.js';

async function main(): Promise<void> {
  const cfg = load();

  for await (const message of query({
    prompt: 'Say hi in three words.',
    options: {
      env: optionsEnv(cfg),
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
