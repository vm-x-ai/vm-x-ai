import { describe, expect, it } from 'vitest';
import { canonicalAnthropicToBedrockInvoke } from '../../ai-provider/adapters/anthropic-messages.adapter';
import {
  anthropicResponseToChatCompletion,
  anthropicStreamToChatCompletionChunks,
  openAIRequestToAnthropic,
} from '../../ai-provider/anthropic/openai-chat-completion.provider';
import { CompletionError } from '../../gateway/completion.types';
import type { AnthropicMessagesRequest } from '../../gateway/anthropic/anthropic.types';
import type {
  ChatCompletionChunk,
  ChatCompletionCreateParams,
} from 'openai/resources/index.js';
import type {
  Message,
  RawMessageStreamEvent,
} from '@anthropic-ai/sdk/resources/messages';

const MODEL = {
  model: 'claude-opus-4-7',
  provider: 'anthropic',
} as never;

/**
 * Adapter tests covering the OpenAI → Anthropic conversion path used
 * by `AWSBedrockInvokeProvider` (when format='openai') and by the
 * native `AnthropicProvider` (always). The Anthropic → OpenAI side is
 * exercised via `anthropic-converter.spec.ts`; this file focuses on
 * the adapter's specific guarantees:
 *
 *   1. Cache_control / thinking / top_k / service_tier from the
 *      passthrough envelope are reattached to the Anthropic body.
 *   2. OpenAI-specific extras (parallel_tool_calls, reasoning_effort,
 *      service_tier) are translated to the equivalent Anthropic field.
 *   3. The streaming converter handles thinking_delta and
 *      signature_delta without dropping reasoning content.
 */

describe('anthropic-messages.adapter / openAIRequestToAnthropic', () => {
  it('reattaches passthrough envelope fields onto the Anthropic body', () => {
    const request = {
      model: 'claude-opus-4-7',
      max_tokens: 1024,
      messages: [{ role: 'user', content: 'hi' }],
      __vmx_passthrough: {
        anthropic: {
          cache_control: { type: 'ephemeral', ttl: '1h' },
          thinking: { type: 'enabled', budget_tokens: 2000 },
          top_k: 50,
          service_tier: 'standard_only',
        },
      },
    } as unknown as ChatCompletionCreateParams;

    const out = openAIRequestToAnthropic(request);
    expect(out.cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
    expect(out.thinking).toEqual({ type: 'enabled', budget_tokens: 2000 });
    expect(out.top_k).toBe(50);
    expect(out.service_tier).toBe('standard_only');
  });

  it('maps reasoning_effort=high to thinking config when no explicit thinking is set', () => {
    const out = openAIRequestToAnthropic({
      model: 'claude-opus-4-7',
      max_tokens: 4096,
      messages: [{ role: 'user', content: 'hi' }],
      reasoning_effort: 'high',
    } as unknown as ChatCompletionCreateParams);
    expect(out.thinking).toBeDefined();
    expect(out.thinking?.type).toBe('enabled');
    // Centralised effort/budget table: `high = 16384`, then clamped
    // to `max_tokens - 1` so the thinking budget never exceeds the
    // request's generation cap.
    expect((out.thinking as { budget_tokens?: number }).budget_tokens).toBe(
      4096 - 1
    );
  });

  it('does not override an explicit passthrough thinking with the OpenAI mapping', () => {
    const request = {
      model: 'claude-opus-4-7',
      max_tokens: 4096,
      messages: [{ role: 'user', content: 'hi' }],
      reasoning_effort: 'low',
      __vmx_passthrough: {
        anthropic: {
          thinking: { type: 'adaptive' },
        },
      },
    } as unknown as ChatCompletionCreateParams;
    const out = openAIRequestToAnthropic(request);
    expect(out.thinking).toEqual({ type: 'adaptive' });
  });

  it('forwards `strict` on Chat function tools to Anthropic Tool', () => {
    const out = openAIRequestToAnthropic({
      model: 'claude-haiku-4-5',
      max_tokens: 100,
      messages: [{ role: 'user', content: 'hi' }],
      tools: [
        {
          type: 'function',
          function: {
            name: 'lookup',
            parameters: { type: 'object', properties: {} },
            strict: true,
          },
        },
      ],
    } as unknown as ChatCompletionCreateParams);
    expect(out.tools).toHaveLength(1);
    const tool = out.tools![0] as { strict?: boolean };
    expect(tool.strict).toBe(true);
  });

  it('omits `strict` on Chat function tools when the caller did not set it', () => {
    const out = openAIRequestToAnthropic({
      model: 'claude-haiku-4-5',
      max_tokens: 100,
      messages: [{ role: 'user', content: 'hi' }],
      tools: [
        {
          type: 'function',
          function: {
            name: 'lookup',
            parameters: { type: 'object', properties: {} },
          },
        },
      ],
    } as unknown as ChatCompletionCreateParams);
    const tool = out.tools![0] as { strict?: boolean };
    expect('strict' in tool).toBe(false);
  });

  it('json_schema → output_config.format on Claude 4.5+ (no synthetic tool)', () => {
    const out = openAIRequestToAnthropic({
      model: 'claude-haiku-4-5',
      max_tokens: 100,
      messages: [{ role: 'user', content: 'hi' }],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'answer',
          schema: { type: 'object', properties: { x: { type: 'number' } } },
        },
      },
    } as unknown as ChatCompletionCreateParams);
    expect(out.output_config?.format).toEqual({
      type: 'json_schema',
      schema: { type: 'object', properties: { x: { type: 'number' } } },
    });
    // No synthetic tool / forced tool_choice for the native path.
    expect(out.tools ?? []).toHaveLength(0);
    expect(out.tool_choice).toBeUndefined();
  });

  it('json_schema → synthetic tool on legacy Claude (pre-4.5) models', () => {
    const out = openAIRequestToAnthropic({
      model: 'claude-3-haiku-20240307',
      max_tokens: 100,
      messages: [{ role: 'user', content: 'hi' }],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'answer',
          schema: { type: 'object', properties: { x: { type: 'number' } } },
        },
      },
    } as unknown as ChatCompletionCreateParams);
    expect(out.output_config).toBeUndefined();
    expect(out.tools).toHaveLength(1);
    expect(out.tools![0]).toMatchObject({ name: '__vmx_structured_output__' });
    expect(out.tool_choice).toMatchObject({
      type: 'tool',
      name: '__vmx_structured_output__',
    });
  });

  it('translates parallel_tool_calls=false to tool_choice.disable_parallel_tool_use', () => {
    const out = openAIRequestToAnthropic({
      model: 'claude-haiku-4-5',
      max_tokens: 100,
      messages: [{ role: 'user', content: 'hi' }],
      tools: [
        {
          type: 'function',
          function: { name: 'noop', parameters: { type: 'object' } },
        },
      ],
      tool_choice: 'auto',
      parallel_tool_calls: false,
    } as unknown as ChatCompletionCreateParams);
    expect(out.tool_choice).toMatchObject({
      type: 'auto',
      disable_parallel_tool_use: true,
    });
  });

  it('preserves prior assistant thinking blocks for multi-turn continuity', () => {
    const out = openAIRequestToAnthropic({
      model: 'claude-opus-4-7',
      max_tokens: 1024,
      messages: [
        { role: 'user', content: 'first turn' },
        {
          role: 'assistant',
          content: 'Here is my answer.',
          reasoning: {
            thinking: 'Internal reasoning for the answer.',
            signature: 'sig-abc',
          },
        } as never,
        { role: 'user', content: 'second turn' },
      ],
    } as unknown as ChatCompletionCreateParams);

    const assistantContent = out.messages.find((m) => m.role === 'assistant')
      ?.content as Array<{ type: string }>;
    expect(assistantContent.find((b) => b.type === 'thinking')).toMatchObject({
      type: 'thinking',
      thinking: 'Internal reasoning for the answer.',
      signature: 'sig-abc',
    });
  });
});

describe('anthropic-messages.adapter / anthropicResponseToChatCompletion', () => {
  it('surfaces thinking blocks via message.reasoning extension', () => {
    const response = {
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      container: null,
      model: 'claude-opus-4-7',
      content: [
        {
          type: 'thinking',
          thinking: 'My reasoning',
          signature: 'sig-1',
        },
        { type: 'text', text: 'Hello!', citations: null },
      ],
      stop_reason: 'end_turn',
      stop_sequence: null,
      stop_details: null,
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        cache_creation_input_tokens: null,
        cache_read_input_tokens: null,
        cache_creation: null,
        server_tool_use: null,
        service_tier: null,
        inference_geo: null,
      },
    } as unknown as Message;

    const completion = anthropicResponseToChatCompletion(response, MODEL);
    const reasoning = (
      completion.choices[0].message as unknown as Record<string, unknown>
    ).reasoning as { thinking?: string; signature?: string };
    expect(reasoning).toEqual({
      thinking: 'My reasoning',
      signature: 'sig-1',
      redacted: undefined,
    });
    expect(completion.choices[0].message.content).toBe('Hello!');
  });

  it('surfaces cache_creation_input_tokens via prompt_tokens_details extension', () => {
    const response = {
      id: 'msg_2',
      type: 'message',
      role: 'assistant',
      container: null,
      model: 'claude-opus-4-7',
      content: [{ type: 'text', text: 'hi', citations: null }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      stop_details: null,
      usage: {
        input_tokens: 1000,
        output_tokens: 5,
        cache_creation_input_tokens: 200,
        cache_read_input_tokens: 500,
        cache_creation: {
          ephemeral_5m_input_tokens: 150,
          ephemeral_1h_input_tokens: 50,
        },
        server_tool_use: null,
        service_tier: null,
        inference_geo: null,
      },
    } as unknown as Message;

    const completion = anthropicResponseToChatCompletion(response, MODEL);
    const ptdExt = completion.usage?.prompt_tokens_details as unknown as
      | Record<string, unknown>
      | undefined;
    expect(ptdExt?.cached_tokens).toBe(500);
    expect(ptdExt?.cache_creation_input_tokens).toBe(200);
    expect(ptdExt?.cache_creation).toEqual({
      ephemeral_5m_input_tokens: 150,
      ephemeral_1h_input_tokens: 50,
    });
  });

  it('maps refusal stop_reason to content_filter finish + populates refusal field', () => {
    const response = {
      id: 'msg_3',
      type: 'message',
      role: 'assistant',
      container: null,
      model: 'claude-opus-4-7',
      content: [],
      stop_reason: 'refusal',
      stop_sequence: null,
      stop_details: {
        type: 'refusal',
        category: 'cyber',
        explanation: 'Cannot help with that.',
      },
      usage: {
        input_tokens: 10,
        output_tokens: 0,
        cache_creation_input_tokens: null,
        cache_read_input_tokens: null,
        cache_creation: null,
        server_tool_use: null,
        service_tier: null,
        inference_geo: null,
      },
    } as unknown as Message;

    const completion = anthropicResponseToChatCompletion(response, MODEL);
    expect(completion.choices[0].finish_reason).toBe('content_filter');
    expect(completion.choices[0].message.refusal).toBe(
      'Cannot help with that.'
    );
  });
});

describe('anthropic-messages.adapter / streaming', () => {
  async function collect(
    eventSource: AsyncIterable<RawMessageStreamEvent>
  ): Promise<ChatCompletionChunk[]> {
    const chunks: ChatCompletionChunk[] = [];
    for await (const c of anthropicStreamToChatCompletionChunks(eventSource, {
      model: 'claude-opus-4-7',
      requestId: 'req-1',
    })) {
      chunks.push(c);
    }
    return chunks;
  }

  async function* events(...e: RawMessageStreamEvent[]) {
    for (const ev of e) yield ev;
  }

  it('emits thinking_delta as delta.reasoning so reasoning content is not lost', async () => {
    const chunks = await collect(
      events(
        {
          type: 'message_start',
          message: {
            id: 'msg_1',
            type: 'message',
            role: 'assistant',
            container: null,
            model: 'claude-opus-4-7',
            content: [],
            stop_reason: null,
            stop_sequence: null,
            stop_details: null,
            usage: {
              input_tokens: 10,
              output_tokens: 0,
              cache_creation_input_tokens: null,
              cache_read_input_tokens: null,
              cache_creation: null,
              server_tool_use: null,
              service_tier: null,
              inference_geo: null,
            },
          },
        } as unknown as RawMessageStreamEvent,
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'thinking', thinking: '', signature: '' },
        } as unknown as RawMessageStreamEvent,
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'thinking_delta', thinking: 'reasoning step 1' },
        } as unknown as RawMessageStreamEvent,
        {
          type: 'content_block_stop',
          index: 0,
        } as unknown as RawMessageStreamEvent,
        {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn', stop_sequence: null },
          usage: { output_tokens: 5 } as never,
        } as unknown as RawMessageStreamEvent,
        { type: 'message_stop' } as unknown as RawMessageStreamEvent
      )
    );
    const reasoningDelta = chunks.find(
      (c) =>
        (c.choices[0]?.delta as Record<string, unknown> | undefined)?.reasoning
    );
    expect(reasoningDelta).toBeDefined();
    expect(
      (
        (reasoningDelta?.choices[0]?.delta as Record<string, unknown>)
          .reasoning as { thinking?: string }
      ).thinking
    ).toBe('reasoning step 1');

    // Final chunk should also carry accumulated reasoning on the
    // finish chunk so the audit row + non-streaming round-trip see it.
    const finalChunk = chunks[chunks.length - 1];
    expect(
      (
        (finalChunk.choices[0].delta as Record<string, unknown>).reasoning as {
          thinking?: string;
        }
      ).thinking
    ).toBe('reasoning step 1');
  });

  it('surfaces cache_creation_input_tokens from message_start onto the final usage chunk', async () => {
    const chunks = await collect(
      events(
        {
          type: 'message_start',
          message: {
            id: 'msg_x',
            type: 'message',
            role: 'assistant',
            container: null,
            model: 'claude-opus-4-7',
            content: [],
            stop_reason: null,
            stop_sequence: null,
            stop_details: null,
            usage: {
              input_tokens: 1000,
              output_tokens: 0,
              cache_creation_input_tokens: 200,
              cache_read_input_tokens: 100,
              cache_creation: {
                ephemeral_5m_input_tokens: 150,
                ephemeral_1h_input_tokens: 50,
              },
              server_tool_use: {
                web_search_requests: 2,
                web_fetch_requests: 0,
              },
              service_tier: null,
              inference_geo: null,
            },
          },
        } as unknown as RawMessageStreamEvent,
        {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn', stop_sequence: null },
          usage: { output_tokens: 5 } as never,
        } as unknown as RawMessageStreamEvent,
        { type: 'message_stop' } as unknown as RawMessageStreamEvent
      )
    );
    const final = chunks[chunks.length - 1];
    const usageExt = final.usage as unknown as Record<string, unknown>;
    const ptd = (
      usageExt as { prompt_tokens_details?: Record<string, unknown> }
    ).prompt_tokens_details;
    expect(ptd?.cache_creation_input_tokens).toBe(200);
    expect(ptd?.cache_creation).toEqual({
      ephemeral_5m_input_tokens: 150,
      ephemeral_1h_input_tokens: 50,
    });
    expect(usageExt.server_tool_use).toEqual({
      web_search_requests: 2,
      web_fetch_requests: 0,
    });
  });
});

describe('anthropic-messages.adapter / rejectExternalImageUrls option', () => {
  // The Bedrock-Invoke provider can't fetch external image URLs, so it
  // turns the adapter's URL-source path into a hard 400 at the gateway
  // boundary. Native Anthropic accepts `{type:'url',url}` so the
  // default behaviour stays permissive.
  const externalImageRequest = {
    model: 'claude-opus-4-7',
    max_tokens: 100,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'caption this' },
          {
            type: 'image_url',
            image_url: { url: 'https://example.com/cat.jpg' },
          },
        ],
      },
    ],
  } as unknown as ChatCompletionCreateParams;

  it('emits {type:"url"} source by default (native Anthropic shape)', () => {
    const out = openAIRequestToAnthropic(externalImageRequest);
    const userContent = out.messages[0].content as Array<{
      type: string;
      source?: { type: string; url?: string };
    }>;
    const imageBlock = userContent.find((b) => b.type === 'image');
    expect(imageBlock?.source).toEqual({
      type: 'url',
      url: 'https://example.com/cat.jpg',
    });
  });

  it('throws CompletionError when rejectExternalImageUrls=true', () => {
    expect(() =>
      openAIRequestToAnthropic(externalImageRequest, {
        rejectExternalImageUrls: true,
      })
    ).toThrow(CompletionError);

    try {
      openAIRequestToAnthropic(externalImageRequest, {
        rejectExternalImageUrls: true,
      });
    } catch (err) {
      expect(err).toBeInstanceOf(CompletionError);
      const data = (err as CompletionError).data;
      expect(data.statusCode).toBe(400);
      expect(data.openAICompatibleError?.code).toBe(
        'aws_bedrock_invoke_image_url_unsupported'
      );
    }
  });

  it('still accepts base64 data URLs when rejectExternalImageUrls=true', () => {
    const dataUrlRequest = {
      ...externalImageRequest,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'caption this' },
            {
              type: 'image_url',
              image_url: { url: 'data:image/png;base64,aGVsbG8=' },
            },
          ],
        },
      ],
    } as unknown as ChatCompletionCreateParams;

    const out = openAIRequestToAnthropic(dataUrlRequest, {
      rejectExternalImageUrls: true,
    });
    const userContent = out.messages[0].content as Array<{
      type: string;
      source?: { type: string };
    }>;
    expect(userContent.find((b) => b.type === 'image')?.source?.type).toBe(
      'base64'
    );
  });
});

describe('anthropic-messages.adapter / canonicalAnthropicToBedrockInvoke', () => {
  // The wire helper strips request-envelope fields the InvokeModel
  // command carries elsewhere (`model`/`stream`) and gateway-internal
  // scaffolding the upstream would 400 on (`vmx`, `__vmx_passthrough`),
  // then adds the `anthropic_version` discriminator.
  const ANTHROPIC_VERSION = 'bedrock-2023-05-31';

  it('strips model/stream and adds anthropic_version', () => {
    const canonical = {
      model: 'claude-opus-4-7',
      stream: true,
      max_tokens: 1024,
      messages: [{ role: 'user', content: 'hi' }],
    } as AnthropicMessagesRequest;

    const wire = canonicalAnthropicToBedrockInvoke(
      canonical,
      ANTHROPIC_VERSION
    );
    expect(wire).not.toHaveProperty('model');
    expect(wire).not.toHaveProperty('stream');
    expect(wire.anthropic_version).toBe(ANTHROPIC_VERSION);
    expect(wire.max_tokens).toBe(1024);
    expect(wire.messages).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('strips vmx + __vmx_passthrough envelope fields', () => {
    const canonical = {
      model: 'claude-opus-4-7',
      max_tokens: 100,
      messages: [{ role: 'user', content: 'hi' }],
      vmx: { correlationId: 'abc-123', metadata: { tenant: 't1' } },
      __vmx_passthrough: { anthropic: { top_k: 50 } },
    } as unknown as AnthropicMessagesRequest;

    const wire = canonicalAnthropicToBedrockInvoke(
      canonical,
      ANTHROPIC_VERSION
    );
    expect(wire).not.toHaveProperty('vmx');
    expect(wire).not.toHaveProperty('__vmx_passthrough');
  });

  it('preserves cache_control / thinking / tools / system fields verbatim', () => {
    const canonical = {
      model: 'claude-opus-4-7',
      max_tokens: 4096,
      system: [{ type: 'text', text: 'You are helpful.' }],
      messages: [{ role: 'user', content: 'hi' }],
      thinking: { type: 'enabled', budget_tokens: 2000 },
      cache_control: { type: 'ephemeral', ttl: '1h' },
      top_k: 50,
      service_tier: 'standard_only',
      tools: [
        { name: 'noop', description: 'd', input_schema: { type: 'object' } },
      ],
    } as unknown as AnthropicMessagesRequest;

    const wire = canonicalAnthropicToBedrockInvoke(
      canonical,
      ANTHROPIC_VERSION
    );
    expect(wire.thinking).toEqual({ type: 'enabled', budget_tokens: 2000 });
    expect(wire.cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
    expect(wire.top_k).toBe(50);
    expect(wire.service_tier).toBe('standard_only');
    expect(wire.tools).toEqual([
      { name: 'noop', description: 'd', input_schema: { type: 'object' } },
    ]);
    expect(wire.system).toEqual([{ type: 'text', text: 'You are helpful.' }]);
  });
});
