import { describe, expect, it } from 'vitest';
import {
  buildNativeGeminiTools,
  dispatchNativeGeminiStream,
  needsNativeGeminiPath,
} from '../../ai-provider/gemini/native.helpers';
import { CompletionError } from '../../gateway/completion.types';
import type { ChatCompletionCreateParams } from 'openai/resources/index.js';
import type { AIConnectionEntity } from '../../ai-connection/entities/ai-connection.entity';
import type { OpenAIConnectionConfig } from '../../ai-provider/openai/shared';

/**
 * Native-path triggers and tool-injection rules. The original T5
 * branch (silent demote of `stream: true`) was replaced by an actual
 * streaming dispatcher; the asserts here cover the surface that
 * decides which path the request takes and what `tools[]` ultimately
 * lands on the @google/genai call.
 */

describe('needsNativeGeminiPath', () => {
  const baseRequest: ChatCompletionCreateParams = {
    model: 'gemini-2.5-flash-lite',
    messages: [{ role: 'user', content: 'hi' }],
  };

  it('returns false when there are no Gemini-only tools and no web_search_options', () => {
    expect(needsNativeGeminiPath(baseRequest)).toBe(false);
  });

  it('returns true when web_search_options is set', () => {
    expect(
      needsNativeGeminiPath({
        ...baseRequest,
        web_search_options: {},
      })
    ).toBe(true);
  });

  it('returns true when tools contain a Gemini-native key (googleSearch)', () => {
    expect(
      needsNativeGeminiPath({
        ...baseRequest,
        tools: [{ googleSearch: {} } as never],
      })
    ).toBe(true);
  });

  it('returns false for plain function tools', () => {
    expect(
      needsNativeGeminiPath({
        ...baseRequest,
        tools: [
          {
            type: 'function',
            function: { name: 'lookup', parameters: { type: 'object' } },
          },
        ],
      })
    ).toBe(false);
  });
});

describe('buildNativeGeminiTools', () => {
  const baseRequest: ChatCompletionCreateParams = {
    model: 'gemini-2.5-flash-lite',
    messages: [{ role: 'user', content: 'hi' }],
  };

  it('returns undefined when neither tools nor web_search_options are set', () => {
    expect(buildNativeGeminiTools(baseRequest)).toBeUndefined();
  });

  it('injects { googleSearch: {} } when web_search_options is set and no tools given', () => {
    const tools = buildNativeGeminiTools({
      ...baseRequest,
      web_search_options: {},
    });
    expect(tools).toEqual([{ googleSearch: {} }]);
  });

  it('does not double-inject when googleSearch is already in the tools list', () => {
    const tools = buildNativeGeminiTools({
      ...baseRequest,
      web_search_options: {},
      tools: [{ googleSearch: {} } as never],
    });
    expect(tools).toEqual([{ googleSearch: {} }]);
  });

  it('keeps function declarations alongside the injected googleSearch tool', () => {
    const tools = buildNativeGeminiTools({
      ...baseRequest,
      web_search_options: {},
      tools: [
        {
          type: 'function',
          function: {
            name: 'lookup',
            description: 'tool',
            parameters: { type: 'object' } as never,
          },
        },
      ],
    });
    expect(tools).toEqual([
      {
        functionDeclarations: [
          {
            name: 'lookup',
            description: 'tool',
            parameters: { type: 'object' },
          },
        ],
      },
      { googleSearch: {} },
    ]);
  });
});

describe('dispatchNativeGeminiStream connection validation', () => {
  it('throws a 400 CompletionError when the connection has no API key', async () => {
    const connection = {
      connectionId: 'c1',
      config: {} as OpenAIConnectionConfig,
    } as AIConnectionEntity<OpenAIConnectionConfig>;
    const request: ChatCompletionCreateParams = {
      model: 'gemini-2.5-flash-lite',
      stream: true,
      messages: [{ role: 'user', content: 'hi' }],
      web_search_options: {},
    };
    await expect(
      dispatchNativeGeminiStream(request, connection, 'gemini-2.5-flash-lite')
    ).rejects.toBeInstanceOf(CompletionError);
  });
});
