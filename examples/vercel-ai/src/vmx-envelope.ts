// Sending VM-X envelope fields through the Vercel AI SDK.
//
// The Vercel AI SDK provider packages don't expose an `extraBody` hook
// — but they do accept a custom `fetch` function. We use that to
// intercept the outgoing request, parse the JSON body, splice in a
// `vmx` envelope, and re-send. The same wrapper works for both the
// OpenAI provider (`vmx.chat()` / `vmx.responses()`) and the Anthropic
// provider (`vmxAnthropic(...)`).

import { createOpenAI } from '@ai-sdk/openai';
import { generateText } from 'ai';
import { load } from './config.js';

/**
 * Wrap `globalThis.fetch` so every JSON request body gets an extra
 * `vmx` field. Anything in the original body wins on a key collision.
 */
function withVmxEnvelope(
  vmx: Record<string, unknown>
): typeof globalThis.fetch {
  return async (input, init) => {
    if (init?.body && typeof init.body === 'string') {
      try {
        const parsed = JSON.parse(init.body);
        const next = { vmx, ...parsed };
        init = { ...init, body: JSON.stringify(next) };
      } catch {
        // Body wasn't JSON (multipart, FormData, etc.) — leave it alone.
      }
    }
    return globalThis.fetch(input, init);
  };
}

async function main(): Promise<void> {
  const cfg = load();
  const vmx = withVmxEnvelope({
    // Correlation id for end-to-end tracing — surfaces on the
    // response's `x-vmx-correlation-id` header + every audit row.
    correlationId: `vercel-ai-example-${Date.now()}`,
    // Free-form metadata — searchable in the Audit + Usage dashboards.
    metadata: {
      team: 'growth',
      user_id: 'u_42',
      feature: 'vercel-ai-vmx-example',
    },
    // Per-request timeout (ms), clamped to a 10-minute gateway max.
    timeoutMs: 15_000,
  });

  const provider = createOpenAI({
    baseURL: cfg.openaiBaseUrl,
    apiKey: cfg.apiKey,
    fetch: vmx,
  });

  const { text, response } = await generateText({
    model: provider.chat(cfg.openaiResource),
    prompt: 'Say hi in three words.',
  });

  console.log(`[vmx-envelope] text -> ${JSON.stringify(text)}`);
  // VM-X surfaces the resolved correlationId + which model+provider
  // actually ran via response headers; the SDK exposes them on
  // `response.headers`.
  const headers = response.headers ?? {};
  console.log(
    `[vmx-envelope] x-vmx-correlation-id -> ${headers['x-vmx-correlation-id']}`
  );
  console.log(`[vmx-envelope] x-vmx-model -> ${headers['x-vmx-model']}`);
  console.log(`[vmx-envelope] x-vmx-provider -> ${headers['x-vmx-provider']}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
