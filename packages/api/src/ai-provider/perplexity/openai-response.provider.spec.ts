import { describe, expect, it, vi } from 'vitest';
import OpenAI from 'openai';
import type { ResponseCreateParams } from 'openai/resources/responses/responses';
import { PinoLogger } from 'nestjs-pino';
import {
  PerplexityResponseProvider,
  perplexitiseResponseTools,
} from './openai-response.provider';
import type { AIConnectionEntity } from '../../ai-connection/entities/ai-connection.entity';
import type { OpenAIConnectionConfig } from '../openai/shared';

/**
 * Class-layer test for {@link PerplexityResponseProvider}. It only
 * overrides `createClient` to point at Perplexity's OpenAI-compat
 * baseURL; the base behaviour (envelope strip, model substitution,
 * native stream branch, error mapping, `providerRequestPayload`
 * capture) is covered by `openai/openai-response.provider.spec.ts`.
 */

function makeLogger(): PinoLogger {
  return {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
    setContext: vi.fn(),
  } as unknown as PinoLogger;
}

function makeConnection(): AIConnectionEntity<OpenAIConnectionConfig> {
  return {
    connectionId: 'conn-1',
    config: { apiKey: 'pplx-test' },
  } as unknown as AIConnectionEntity<OpenAIConnectionConfig>;
}

class TestablePerplexityResponseProvider extends PerplexityResponseProvider {
  public callCreateClient(
    connection: AIConnectionEntity<OpenAIConnectionConfig>
  ): Promise<OpenAI> {
    return this.createClient(connection);
  }
}

describe('PerplexityResponseProvider', () => {
  it('createClient points at the Perplexity OpenAI-compat /v1 baseURL', async () => {
    const provider = new TestablePerplexityResponseProvider(makeLogger());
    const client = await provider.callCreateClient(makeConnection());
    expect(client).toBeInstanceOf(OpenAI);
    // Pin the *exact* baseURL including the `/v1` suffix. The
    // chat-completion sibling can omit the prefix because Perplexity
    // accepts the legacy `/chat/completions` path without a version
    // prefix, but the Responses endpoint is documented exclusively
    // under `/v1/responses` (with `/v1/agent` as its native alias).
    // The OpenAI SDK resolves `client.responses.create()` to
    // `${baseURL}/responses`, so dropping `/v1` here would POST to
    // `https://api.perplexity.ai/responses` and 404. This assertion
    // catches that class of regression.
    expect(client.baseURL).toBe('https://api.perplexity.ai/v1');
  });

  it('createClient rejects when the connection config has no API key', async () => {
    // The shared `createOpenAIClient` factory enforces this invariant
    // for every OpenAI-compat sibling. Pinning here guards against a
    // future Perplexity-specific override that forgets to delegate
    // (e.g. instantiating `new OpenAI(...)` directly).
    const provider = new TestablePerplexityResponseProvider(makeLogger());
    const noKey = {
      connectionId: 'conn-no-key',
      config: { apiKey: '' },
    } as unknown as Parameters<typeof provider.callCreateClient>[0];
    await expect(provider.callCreateClient(noKey)).rejects.toThrow();
  });
});

// ─── tools rewrite (Responses-canonical → Perplexity wire shape) ──────

describe('perplexitiseResponseTools', () => {
  // OpenAI Responses callers (the playground's webSearch toggle, custom
  // SDKs targeting our gateway) attach `{type:'web_search_preview'}`;
  // Perplexity's OpenAI-compat Responses surface only accepts
  // `{type:'web_search'}` (optionally with `filters`). Without this
  // rewrite Perplexity 400s with "unknown tool type" and the audit row
  // shows a confusing error that's actually our format-mismatch fault.
  // The function lives in the per-provider adapter (not the gateway
  // orchestrator) per the passthrough-fidelity rule: cross-provider
  // shape conversion is the provider's job, intra-format normalisation
  // is the BFF / SDK adapter's.

  it('renames the canonical OpenAI web_search_preview tool to Perplexity web_search', () => {
    const request = {
      model: 'sonar-pro',
      input: 'whatever',
      tools: [{ type: 'web_search_preview' }],
    } as unknown as ResponseCreateParams;
    const out = perplexitiseResponseTools(request);
    expect(out.tools).toEqual([{ type: 'web_search' }]);
    // Returns a fresh object so the caller's request literal isn't
    // mutated — same defensive copying pattern as the orchestrator's
    // body-merging helpers.
    expect(out).not.toBe(request);
  });

  it('preserves filters and any other fields when renaming', () => {
    const request = {
      model: 'sonar-pro',
      input: 'q',
      tools: [
        {
          type: 'web_search_preview',
          filters: { search_domain_filter: ['techcrunch.com'] },
        },
      ],
    } as unknown as ResponseCreateParams;
    const out = perplexitiseResponseTools(request);
    expect(out.tools).toEqual([
      {
        type: 'web_search',
        filters: { search_domain_filter: ['techcrunch.com'] },
      },
    ]);
  });

  it('passes through a Perplexity-native web_search tool unchanged (idempotent)', () => {
    // Callers that already target Perplexity natively (e.g. a tool
    // template with `{type:'web_search', filters:{...}}`) should land
    // on the wire unchanged — no double-rename, no extra fields.
    const request = {
      model: 'sonar-pro',
      input: 'q',
      tools: [{ type: 'web_search', filters: { foo: 'bar' } }],
    } as unknown as ResponseCreateParams;
    const out = perplexitiseResponseTools(request);
    expect(out).toBe(request);
  });

  it('passes through custom function tools and unsupported hosted tools unchanged', () => {
    // Non-search hosted tools (`code_interpreter`, `image_generation`,
    // …) are NOT silently stripped — Perplexity will reject them and
    // we want that error to reach the caller so they can fix their
    // resource config, instead of debugging a missing tool we ate.
    const request = {
      model: 'sonar-pro',
      input: 'q',
      tools: [
        {
          type: 'function',
          name: 'lookup',
          description: 'd',
          parameters: { type: 'object' },
          strict: false,
        },
        { type: 'code_interpreter' },
      ],
    } as unknown as ResponseCreateParams;
    const out = perplexitiseResponseTools(request);
    expect(out).toBe(request);
  });

  it('returns the input unchanged when tools is absent', () => {
    const request = {
      model: 'sonar-pro',
      input: 'q',
    } as unknown as ResponseCreateParams;
    const out = perplexitiseResponseTools(request);
    expect(out).toBe(request);
  });

  it('handles mixed tool arrays — only web_search_preview entries are renamed', () => {
    const request = {
      model: 'sonar-pro',
      input: 'q',
      tools: [
        {
          type: 'function',
          name: 'f',
          description: 'd',
          parameters: { type: 'object' },
          strict: false,
        },
        { type: 'web_search_preview' },
      ],
    } as unknown as ResponseCreateParams;
    const out = perplexitiseResponseTools(request);
    expect(out.tools).toEqual([
      {
        type: 'function',
        name: 'f',
        description: 'd',
        parameters: { type: 'object' },
        strict: false,
      },
      { type: 'web_search' },
    ]);
  });
});
