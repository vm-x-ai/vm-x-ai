import { describe, expect, it } from 'vitest';
import { TokenService } from '../token/token.service';
import type { PinoLogger } from 'nestjs-pino';

const stubLogger = {
  info: () => undefined,
  debug: () => undefined,
  warn: () => undefined,
  error: () => undefined,
} as unknown as PinoLogger;

describe('TokenService — per-format counters', () => {
  const svc = new TokenService(stubLogger);

  it('OpenAI Chat Completions counter handles string content', () => {
    const n = svc.getRequestTokensFromChatCompletions({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'hello world' }],
    });
    expect(n).toBeGreaterThan(0);
  });

  it('Anthropic counter handles string + content-block messages, system, tools', () => {
    const n = svc.getRequestTokensFromAnthropic({
      model: 'claude',
      max_tokens: 64,
      system: 'be brief',
      messages: [
        { role: 'user', content: 'hello' },
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'hi there' }] as never,
        },
      ],
      tools: [
        {
          name: 'get_weather',
          description: 'Get weather',
          input_schema: {
            type: 'object',
            properties: { location: { type: 'string' } },
            required: ['location'],
          },
        } as never,
      ],
    });
    expect(n).toBeGreaterThan(0);
  });

  it('Anthropic counter handles array `system` (TextBlockParam[])', () => {
    const n = svc.getRequestTokensFromAnthropic({
      model: 'claude',
      max_tokens: 32,
      system: [
        { type: 'text', text: 'rule 1' },
        { type: 'text', text: 'rule 2' },
      ] as never,
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(n).toBeGreaterThan(0);
  });

  it('Responses counter handles string `input`', () => {
    const n = svc.getRequestTokens({
      model: 'gpt-4o',
      input: 'hello',
    } as never);
    expect(n).toBeGreaterThan(0);
  });

  it('Responses counter handles array `input` items + instructions + tools', () => {
    const n = svc.getRequestTokens({
      model: 'gpt-4o',
      instructions: 'be brief',
      input: [
        {
          role: 'user',
          content: [{ type: 'input_text', text: 'hello world' }],
        },
      ] as never,
      tools: [
        {
          type: 'function',
          name: 'get_weather',
          parameters: { type: 'object' },
        },
      ] as never,
    } as never);
    expect(n).toBeGreaterThan(0);
  });

  it('Anthropic counter scales monotonically with message length', () => {
    const small = svc.getRequestTokensFromAnthropic({
      model: 'c',
      max_tokens: 1,
      messages: [{ role: 'user', content: 'hi' }],
    });
    const large = svc.getRequestTokensFromAnthropic({
      model: 'c',
      max_tokens: 1,
      messages: [
        {
          role: 'user',
          content: 'hi '.repeat(500),
        },
      ],
    });
    expect(large).toBeGreaterThan(small);
  });
});
