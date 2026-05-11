import { describe, expect, it, vi } from 'vitest';
import { PinoLogger } from 'nestjs-pino';
import type { ChatCompletionCreateParams } from 'openai/resources/index.js';
import { TokenService } from './token.service';

/**
 * Unit tests for {@link TokenService} — the gateway uses this for
 * pre-flight token estimation that drives capacity gating and routing.
 * Under-counting would let oversized requests bypass capacity limits;
 * over-counting would unfairly throttle traffic. Both are billing-
 * adjacent regressions.
 */
function makeService(): TokenService {
  // PinoLogger is only used for boot-time logging in the constructor;
  // a no-op stub keeps the test suite quiet.
  const logger = {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as PinoLogger;
  return new TokenService(logger);
}

const baseParams = (
  messages: ChatCompletionCreateParams['messages']
): ChatCompletionCreateParams =>
  ({ model: 'gpt-4o-mini', messages } as ChatCompletionCreateParams);

describe('TokenService.getRequestTokens', () => {
  const service = makeService();

  it('returns a positive count for a simple user message', () => {
    const tokens = service.getRequestTokensFromChatCompletions(
      baseParams([{ role: 'user', content: 'Hello, world!' }])
    );
    expect(tokens).toBeGreaterThan(0);
  });

  it('grows monotonically with the number of messages', () => {
    const one = service.getRequestTokensFromChatCompletions(
      baseParams([{ role: 'user', content: 'aaa' }])
    );
    const two = service.getRequestTokensFromChatCompletions(
      baseParams([
        { role: 'user', content: 'aaa' },
        { role: 'assistant', content: 'bbb' },
      ])
    );
    expect(two).toBeGreaterThan(one);
  });

  it('skips null / undefined message fields without throwing', () => {
    // The shape of a real message can include `name: undefined` after
    // a converter pass; tiktoken would otherwise blow up on a non-
    // string input — confirm the service tolerates it.
    expect(() =>
      service.getRequestTokensFromChatCompletions(
        baseParams([{ role: 'user', content: 'hi', name: undefined } as never])
      )
    ).not.toThrow();
  });

  it('counts tool_calls JSON contents (assistant turn)', () => {
    const withTools = service.getRequestTokensFromChatCompletions(
      baseParams([
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: {
                name: 'lookup_user',
                arguments: '{"id":"abc-123"}',
              },
            },
          ],
        } as never,
      ])
    );
    const withoutTools = service.getRequestTokensFromChatCompletions(
      baseParams([{ role: 'assistant', content: '' }])
    );
    expect(withTools).toBeGreaterThan(withoutTools);
  });

  it('counts array-content (Responses API typed content blocks)', () => {
    // After Responses → ChatCompletions conversion, `content` can be an
    // array of `{type:'text', text}` parts. tiktoken treats that as an
    // unencodable input directly; the service must flatten first.
    const arrayContent = service.getRequestTokensFromChatCompletions(
      baseParams([
        {
          role: 'user',
          content: [
            { type: 'text', text: 'hello ' },
            { type: 'text', text: 'world' },
          ],
        } as never,
      ])
    );
    const stringContent = service.getRequestTokensFromChatCompletions(
      baseParams([{ role: 'user', content: 'hello world' }])
    );
    // Flattened-array form should produce roughly the same count as
    // the equivalent string (within a couple of tokens for the join).
    expect(Math.abs(arrayContent - stringContent)).toBeLessThan(5);
  });

  it('does not count the bytes of non-text content parts (image_url, file)', () => {
    // Images don't contribute text tokens — under-counting by a few
    // tokens for vision input is the documented behaviour. Confirm the
    // service doesn't crash and produces a finite count.
    const tokens = service.getRequestTokensFromChatCompletions(
      baseParams([
        {
          role: 'user',
          content: [
            { type: 'text', text: 'describe the image' },
            { type: 'image_url', image_url: { url: 'https://x.test/a.png' } },
          ],
        } as never,
      ])
    );
    expect(tokens).toBeGreaterThan(0);
    expect(Number.isFinite(tokens)).toBe(true);
  });

  it('adds a token for a `name` field on the message', () => {
    const withName = service.getRequestTokensFromChatCompletions(
      baseParams([{ role: 'user', content: 'hi', name: 'alice' } as never])
    );
    const withoutName = service.getRequestTokensFromChatCompletions(
      baseParams([{ role: 'user', content: 'hi' }])
    );
    expect(withName).toBeGreaterThan(withoutName);
  });

  it('accepts an empty messages array (system priming only)', () => {
    const tokens = service.getRequestTokensFromChatCompletions(baseParams([]));
    // Implementation seeds with `numTokens = 3`; an empty conversation
    // should still return that priming overhead, not zero or NaN.
    expect(tokens).toBe(3);
  });
});
