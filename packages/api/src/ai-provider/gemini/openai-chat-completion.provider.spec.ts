import { describe, expect, it, vi, beforeEach } from 'vitest';
import OpenAI from 'openai';
import { GeminiChatCompletionProvider } from './openai-chat-completion.provider';
import { PinoLogger } from 'nestjs-pino';
import type { AIConnectionEntity } from '../../ai-connection/entities/ai-connection.entity';
import type { AIResourceModelConfigEntity } from '../../ai-resource/common/model.entity';
import type { OpenAIConnectionConfig } from '../openai/shared';
import type {
  ChatCompletion,
  ChatCompletionCreateParams,
} from 'openai/resources/index.js';

// Mock the native helpers so we don't actually call the @google/genai
// SDK. Each test programs the spies as needed.
const nativeSpies = {
  needs: vi.fn<(...args: unknown[]) => boolean>(() => false),
  dispatch: vi.fn<(...args: unknown[]) => unknown>(),
  dispatchStream: vi.fn<(...args: unknown[]) => unknown>(),
};
vi.mock('./native.helpers', () => ({
  needsNativeGeminiPath: (...args: unknown[]) => nativeSpies.needs(...args),
  dispatchNativeGemini: (...args: unknown[]) => nativeSpies.dispatch(...args),
  dispatchNativeGeminiStream: (...args: unknown[]) =>
    nativeSpies.dispatchStream(...args),
}));

/**
 * Class-layer tests for {@link GeminiChatCompletionProvider}.
 *
 * Pins the Gemini-specific behaviour the base OpenAI tests don't
 * cover:
 *  - createClient points at Gemini's OpenAI-compat baseURL
 *  - the OpenAI-compat-vs-native router (`needsNativeGeminiPath`)
 *    decides which dispatch path runs
 *  - native streaming and non-streaming paths each get their helper
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
    config: { apiKey: 'AIza-test' },
  } as unknown as AIConnectionEntity<OpenAIConnectionConfig>;
}

function makeModel(
  model = 'gemini-2.5-flash-lite'
): AIResourceModelConfigEntity {
  return { model } as AIResourceModelConfigEntity;
}

class TestableGeminiProvider extends GeminiChatCompletionProvider {
  public callCreateClient(
    connection: AIConnectionEntity<OpenAIConnectionConfig>
  ): Promise<OpenAI> {
    return this.createClient(connection);
  }
}

describe('GeminiChatCompletionProvider', () => {
  beforeEach(() => {
    nativeSpies.needs.mockReset().mockReturnValue(false);
    nativeSpies.dispatch.mockReset();
    nativeSpies.dispatchStream.mockReset();
  });

  it('createClient points at the Gemini OpenAI-compat baseURL', async () => {
    const provider = new TestableGeminiProvider(makeLogger());
    const client = await provider.callCreateClient(makeConnection());
    expect(client).toBeInstanceOf(OpenAI);
    expect(client.baseURL).toContain('generativelanguage.googleapis.com');
    expect(client.baseURL).toContain('/v1beta/openai');
  });

  it('compat path: needsNativeGeminiPath=false → falls through to base OpenAI handle()', async () => {
    nativeSpies.needs.mockReturnValue(false);
    const provider = new TestableGeminiProvider(makeLogger());

    // Stub the base class's HTTP call so we don't actually reach Gemini.
    const baseHandleSpy = vi.spyOn(
      Object.getPrototypeOf(Object.getPrototypeOf(provider)),
      'handle'
    );
    baseHandleSpy.mockResolvedValue({
      data: { id: 'cmpl_1' } as ChatCompletion,
      headers: {},
      providerRequestPayload: {},
    });

    const request: ChatCompletionCreateParams = {
      model: 'gemini-2.5-flash-lite',
      messages: [{ role: 'user', content: 'ping' }],
    };
    await provider.handle(request, makeConnection(), makeModel());
    expect(baseHandleSpy).toHaveBeenCalledOnce();
    expect(nativeSpies.dispatch).not.toHaveBeenCalled();
    expect(nativeSpies.dispatchStream).not.toHaveBeenCalled();
    baseHandleSpy.mockRestore();
  });

  it('native path (non-streaming): routes through dispatchNativeGemini when the request needs it', async () => {
    nativeSpies.needs.mockReturnValue(true);
    nativeSpies.dispatch.mockResolvedValue({
      data: { id: 'cmpl_1' } as ChatCompletion,
      providerRequestPayload: { native: true },
    });
    const provider = new TestableGeminiProvider(makeLogger());

    const request: ChatCompletionCreateParams = {
      model: 'gemini-2.5-flash-lite',
      messages: [{ role: 'user', content: 'ping' }],
      tools: [
        { type: 'function', function: { name: 'googleSearch' } as never },
      ],
    };
    const result = await provider.handle(
      request,
      makeConnection(),
      makeModel()
    );
    expect(nativeSpies.dispatch).toHaveBeenCalledOnce();
    expect(nativeSpies.dispatchStream).not.toHaveBeenCalled();
    expect(result.providerRequestPayload).toEqual({ native: true });
  });

  it('native path (streaming): routes through dispatchNativeGeminiStream', async () => {
    nativeSpies.needs.mockReturnValue(true);
    nativeSpies.dispatchStream.mockResolvedValue({
      data: (async function* () {
        yield {} as never;
      })(),
      providerRequestPayload: { native: true },
    });
    const provider = new TestableGeminiProvider(makeLogger());

    const request: ChatCompletionCreateParams = {
      model: 'gemini-2.5-flash-lite',
      messages: [{ role: 'user', content: 'ping' }],
      stream: true,
      tools: [
        { type: 'function', function: { name: 'googleSearch' } as never },
      ],
    };
    await provider.handle(request, makeConnection(), makeModel());
    expect(nativeSpies.dispatchStream).toHaveBeenCalledOnce();
    expect(nativeSpies.dispatch).not.toHaveBeenCalled();
  });
});
