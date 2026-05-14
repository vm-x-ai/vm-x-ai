import { describe, expect, it } from 'vitest';
import {
  requestAnthropicToGemini,
  geminiResponseToAnthropic,
  streamGeminiToAnthropic,
} from './anthropic-messages.provider';
import {
  FunctionCallingConfigMode,
  FinishReason as GeminiFinishReason,
  type GenerateContentResponse,
} from '@google/genai';
import type { AnthropicMessagesRequest } from '../../gateway/anthropic/anthropic.types';
import type { RawMessageStreamEvent } from '@anthropic-ai/sdk/resources/messages';

/**
 * Converter-level tests for the Gemini-native Anthropic Messages
 * provider. Class-level dispatch is exercised end-to-end by
 * `__integration__/live-flow/anthropic-messages.spec.ts` (Gemini is in
 * `LIVE_PROVIDERS`); these specs pin the pure request / response /
 * stream mapping so the wire-shape stays glued to the Anthropic SDK.
 */

const baseReq = (
  overrides: Partial<AnthropicMessagesRequest> = {}
): AnthropicMessagesRequest =>
  ({
    model: 'gemini-2.5-flash',
    max_tokens: 256,
    messages: [{ role: 'user', content: 'hi' }],
    ...overrides,
  } as AnthropicMessagesRequest);

describe('requestAnthropicToGemini', () => {
  it('lifts string `system` into systemInstruction', () => {
    const out = requestAnthropicToGemini(baseReq({ system: 'Be terse.' }));
    expect(out.config?.systemInstruction).toEqual({
      role: 'user',
      parts: [{ text: 'Be terse.' }],
    });
    expect(out.contents).toEqual([{ role: 'user', parts: [{ text: 'hi' }] }]);
  });

  it('lifts an array `system` of TextBlockParam into systemInstruction (concatenated)', () => {
    const out = requestAnthropicToGemini(
      baseReq({
        system: [
          { type: 'text', text: 'first' },
          { type: 'text', text: 'second' },
        ] as never,
      })
    );
    expect(out.config?.systemInstruction).toEqual({
      role: 'user',
      parts: [{ text: 'first\n\nsecond' }],
    });
  });

  it('maps base64 image_url into inlineData parts', () => {
    const out = requestAnthropicToGemini(
      baseReq({
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'describe' },
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/png',
                  data: 'AAAA',
                },
              },
            ] as never,
          },
        ],
      })
    );
    expect(out.contents).toEqual([
      {
        role: 'user',
        parts: [
          { text: 'describe' },
          { inlineData: { mimeType: 'image/png', data: 'AAAA' } },
        ],
      },
    ]);
  });

  it('lifts URL image source into a fileData part with the image fallback mime', () => {
    const out = requestAnthropicToGemini(
      baseReq({
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'url', url: 'https://x/y.png' },
              },
            ] as never,
          },
        ],
      })
    );
    const parts = (out.contents as Array<{ parts?: unknown[] }>)[0].parts;
    expect(parts).toEqual([
      { fileData: { fileUri: 'https://x/y.png', mimeType: 'image/*' } },
    ]);
  });

  it('maps base64 PDF document source into inlineData parts', () => {
    const out = requestAnthropicToGemini(
      baseReq({
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'document',
                source: {
                  type: 'base64',
                  media_type: 'application/pdf',
                  data: 'PDFDATA',
                },
              },
            ] as never,
          },
        ],
      })
    );
    const parts = (out.contents as Array<{ parts?: unknown[] }>)[0].parts;
    expect(parts).toEqual([
      { inlineData: { mimeType: 'application/pdf', data: 'PDFDATA' } },
    ]);
  });

  it('maps plain-text document source into a text part with optional title header', () => {
    const out = requestAnthropicToGemini(
      baseReq({
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'document',
                title: 'Memo',
                source: {
                  type: 'text',
                  media_type: 'text/plain',
                  data: 'hello',
                },
              },
            ] as never,
          },
        ],
      })
    );
    const parts = (
      out.contents as Array<{ parts?: Array<{ text?: string }> }>
    )[0].parts;
    expect(parts?.[0]?.text).toBe('# Memo\n\nhello');
  });

  it('resolves tool_result.name from prior assistant tool_use block (not tool_use_id)', () => {
    // Gemini correlates `functionResponse.name` against the prior
    // `functionCall.name`. Using `tool_use_id` (the Anthropic handle)
    // breaks the round-trip — the model can't match the response back
    // to the call.
    const out = requestAnthropicToGemini(
      baseReq({
        messages: [
          { role: 'user', content: "What's the weather in Tokyo?" },
          {
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: 'tu_xyz',
                name: 'lookup_weather',
                input: { city: 'Tokyo' },
              },
            ] as never,
          },
          {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'tu_xyz',
                content: '72F',
              },
            ] as never,
          },
        ],
      })
    );
    const contents = out.contents as Array<{
      parts?: Array<{ functionResponse?: { id?: string; name?: string } }>;
    }>;
    const fnResp = contents
      .flatMap((c) => c.parts ?? [])
      .find((p) => p.functionResponse)?.functionResponse;
    expect(fnResp?.id).toBe('tu_xyz');
    expect(fnResp?.name).toBe('lookup_weather');
  });

  it('falls back to tool_use_id when no prior tool_use block declares the tool', () => {
    const out = requestAnthropicToGemini(
      baseReq({
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'orphan',
                content: 'x',
              },
            ] as never,
          },
        ],
      })
    );
    const fnResp = (
      out.contents as Array<{
        parts?: Array<{ functionResponse?: { name?: string } }>;
      }>
    )
      .flatMap((c) => c.parts ?? [])
      .find((p) => p.functionResponse)?.functionResponse;
    expect(fnResp?.name).toBe('orphan');
  });

  it('lifts thinking blocks (with signature) into thought parts on the model turn', () => {
    const out = requestAnthropicToGemini(
      baseReq({
        messages: [
          { role: 'user', content: 'q' },
          {
            role: 'assistant',
            content: [
              {
                type: 'thinking',
                thinking: 'reasoning text',
                signature: 'sig1',
              },
              { type: 'text', text: 'final' },
            ] as never,
          },
        ],
      })
    );
    const modelTurn = (
      out.contents as Array<{
        role?: string;
        parts?: Array<{
          text?: string;
          thought?: boolean;
          thoughtSignature?: string;
        }>;
      }>
    ).find((c) => c.role === 'model');
    expect(modelTurn?.parts?.[0]).toEqual({
      text: 'reasoning text',
      thought: true,
      thoughtSignature: 'sig1',
    });
    expect(modelTurn?.parts?.[1]).toEqual({ text: 'final' });
  });

  it('maps tool_choice variants onto functionCallingConfig modes', () => {
    const auto = requestAnthropicToGemini(
      baseReq({ tool_choice: { type: 'auto' } as never })
    );
    expect(auto.config?.toolConfig?.functionCallingConfig?.mode).toBe(
      FunctionCallingConfigMode.AUTO
    );

    const any = requestAnthropicToGemini(
      baseReq({ tool_choice: { type: 'any' } as never })
    );
    expect(any.config?.toolConfig?.functionCallingConfig?.mode).toBe(
      FunctionCallingConfigMode.ANY
    );

    const none = requestAnthropicToGemini(
      baseReq({ tool_choice: { type: 'none' } as never })
    );
    expect(none.config?.toolConfig?.functionCallingConfig?.mode).toBe(
      FunctionCallingConfigMode.NONE
    );

    const named = requestAnthropicToGemini(
      baseReq({ tool_choice: { type: 'tool', name: 'lookup' } as never })
    );
    expect(named.config?.toolConfig?.functionCallingConfig?.mode).toBe(
      FunctionCallingConfigMode.ANY
    );
    expect(
      named.config?.toolConfig?.functionCallingConfig?.allowedFunctionNames
    ).toEqual(['lookup']);
  });

  it('translates custom tools into functionDeclarations with JSON Schema parameters', () => {
    const out = requestAnthropicToGemini(
      baseReq({
        tools: [
          {
            name: 'lookup',
            description: 'd',
            input_schema: { type: 'object', properties: {} },
          },
        ] as never,
      })
    );
    expect(out.config?.tools).toEqual([
      {
        functionDeclarations: [
          {
            name: 'lookup',
            description: 'd',
            parametersJsonSchema: { type: 'object', properties: {} },
          },
        ],
      },
    ]);
  });

  it('maps Anthropic server tool families onto their Gemini equivalents', () => {
    const out = requestAnthropicToGemini(
      baseReq({
        tools: [
          { type: 'web_search_20250305', name: 'web_search' },
          { type: 'code_execution_20250825', name: 'code_execution' },
        ] as never,
      })
    );
    expect(out.config?.tools).toEqual([
      { googleSearch: {} },
      { codeExecution: {} },
    ]);
  });

  it('maps thinking.enabled / disabled onto thinkingConfig', () => {
    const enabled = requestAnthropicToGemini(
      baseReq({
        thinking: { type: 'enabled', budget_tokens: 4096 },
      })
    );
    expect(enabled.config?.thinkingConfig).toEqual({
      includeThoughts: true,
      thinkingBudget: 4096,
    });

    const disabled = requestAnthropicToGemini(
      baseReq({ thinking: { type: 'disabled' } as never })
    );
    expect(disabled.config?.thinkingConfig).toEqual({
      includeThoughts: false,
      thinkingBudget: 0,
    });
  });

  it('forwards temperature / top_p / top_k / max_tokens / stop_sequences', () => {
    const out = requestAnthropicToGemini(
      baseReq({
        temperature: 0.3,
        top_p: 0.9,
        top_k: 5,
        max_tokens: 128,
        stop_sequences: ['END'],
      })
    );
    expect(out.config?.temperature).toBe(0.3);
    expect(out.config?.topP).toBe(0.9);
    expect(out.config?.topK).toBe(5);
    expect(out.config?.maxOutputTokens).toBe(128);
    expect(out.config?.stopSequences).toEqual(['END']);
  });

  it('lifts redacted_thinking blocks into an empty thought part carrying the signed blob', () => {
    const out = requestAnthropicToGemini(
      baseReq({
        messages: [
          { role: 'user', content: 'q' },
          {
            role: 'assistant',
            content: [{ type: 'redacted_thinking', data: 'opaque' }] as never,
          },
        ],
      })
    );
    const modelTurn = (
      out.contents as Array<{
        role?: string;
        parts?: Array<{
          text?: string;
          thought?: boolean;
          thoughtSignature?: string;
        }>;
      }>
    ).find((c) => c.role === 'model');
    expect(modelTurn?.parts?.[0]).toEqual({
      text: '',
      thought: true,
      thoughtSignature: 'opaque',
    });
  });

  it('splits multimodal tool_result content into response.output (text) and parts[] (binary)', () => {
    const out = requestAnthropicToGemini(
      baseReq({
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'tu_1',
                content: [
                  { type: 'text', text: 'description follows' },
                  {
                    type: 'image',
                    source: {
                      type: 'base64',
                      media_type: 'image/png',
                      data: 'IMGBYTES',
                    },
                  },
                ],
              },
            ] as never,
          },
        ],
      })
    );
    const fr = (
      out.contents as Array<{
        parts?: Array<{
          functionResponse?: {
            response?: { output?: string };
            parts?: unknown[];
          };
        }>;
      }>
    )
      .flatMap((c) => c.parts ?? [])
      .find((p) => p.functionResponse)?.functionResponse;
    expect(fr?.response?.output).toBe('description follows');
    expect(fr?.parts).toEqual([
      { inlineData: { mimeType: 'image/png', data: 'IMGBYTES' } },
    ]);
  });
});

describe('geminiResponseToAnthropic', () => {
  it('maps text + functionCall + thought parts into content[] blocks with all 8 usage fields', () => {
    const response = {
      responseId: 'resp_1',
      candidates: [
        {
          content: {
            role: 'model',
            parts: [
              { text: 'reasoning', thought: true, thoughtSignature: 'sig' },
              { text: 'hello' },
              {
                functionCall: {
                  id: 'call_a',
                  name: 'lookup',
                  args: { q: 'x' },
                },
              },
            ],
          },
          finishReason: GeminiFinishReason.STOP,
        },
      ],
      usageMetadata: {
        promptTokenCount: 10,
        responseTokenCount: 5,
        thoughtsTokenCount: 3,
        cachedContentTokenCount: 2,
        totalTokenCount: 20,
      },
    } as unknown as GenerateContentResponse;
    const out = geminiResponseToAnthropic(response, 'gemini-2.5-flash');
    expect(out.id).toBe('resp_1');
    expect(out.type).toBe('message');
    expect(out.role).toBe('assistant');
    expect(out.container).toBeNull();
    // Reasoning first, then text, then tool_use; stop_reason follows
    // the function-call promotion path (STOP + hasFunctionCall = tool_use).
    expect(out.content[0]).toMatchObject({
      type: 'thinking',
      thinking: 'reasoning',
      signature: 'sig',
    });
    const textBlock = out.content.find((b) => b.type === 'text') as {
      text?: string;
      citations?: unknown;
    };
    expect(textBlock?.text).toBe('hello');
    expect(textBlock?.citations).toBeNull();
    const toolUse = out.content.find((b) => b.type === 'tool_use') as {
      id?: string;
      name?: string;
      input?: Record<string, unknown>;
      caller?: { type?: string };
    };
    expect(toolUse?.id).toBe('call_a');
    expect(toolUse?.name).toBe('lookup');
    expect(toolUse?.input).toEqual({ q: 'x' });
    expect(toolUse?.caller).toEqual({ type: 'direct' });
    expect(out.stop_reason).toBe('tool_use');
    expect(out.stop_details).toBeNull();
    // Usage rolls reasoning into output_tokens (Anthropic semantics)
    // and exposes all 8 fields (nulls where unknown).
    expect(out.usage.input_tokens).toBe(10);
    expect(out.usage.output_tokens).toBe(8);
    expect(out.usage.cache_read_input_tokens).toBe(2);
    expect(out.usage.cache_creation_input_tokens).toBeNull();
    expect(out.usage.cache_creation).toBeNull();
    expect(out.usage.server_tool_use).toBeNull();
    expect(out.usage.service_tier).toBeNull();
    expect(out.usage.inference_geo).toBeNull();
  });

  it('maps SAFETY finishReason onto stop_reason=refusal + populated stop_details', () => {
    const response = {
      candidates: [
        {
          content: { parts: [] },
          finishReason: GeminiFinishReason.SAFETY,
          finishMessage: 'blocked by safety policy',
        },
      ],
      usageMetadata: {},
    } as unknown as GenerateContentResponse;
    const out = geminiResponseToAnthropic(response, 'gemini-2.5-flash');
    expect(out.stop_reason).toBe('refusal');
    expect(out.stop_details).toEqual({
      type: 'refusal',
      category: null,
      explanation: 'blocked by safety policy',
    });
  });

  it('maps MAX_TOKENS finishReason onto stop_reason=max_tokens', () => {
    const response = {
      candidates: [
        {
          content: { parts: [{ text: 'partial' }] },
          finishReason: GeminiFinishReason.MAX_TOKENS,
        },
      ],
      usageMetadata: {},
    } as unknown as GenerateContentResponse;
    const out = geminiResponseToAnthropic(response, 'gemini-2.5-flash');
    expect(out.stop_reason).toBe('max_tokens');
  });

  it('synthesises a `msg_` id when the SDK response has no responseId', () => {
    const response = {
      candidates: [
        {
          content: { parts: [{ text: 'hi' }] },
          finishReason: GeminiFinishReason.STOP,
        },
      ],
      usageMetadata: {},
    } as unknown as GenerateContentResponse;
    const out = geminiResponseToAnthropic(response, 'gemini-2.5-flash');
    expect(out.id.startsWith('msg_')).toBe(true);
  });

  // ─── Gemini-native grounding extension fields ─────────────────────
  //
  // Same parity contract as the Responses converter — Gemini's
  // grounding payload is exposed under `grounding_metadata` AND
  // `vertex_ai_grounding_metadata` on the Anthropic-shape message so
  // callers driving Gemini through `/anthropic/messages` (the
  // playground's Anthropic tab, plus any direct API consumer using
  // an Anthropic SDK against our gateway) see the same Gemini-native
  // provenance the OpenAI Chat Completions and Responses converters
  // already surface.

  it('attaches grounding_metadata + vertex_ai_grounding_metadata extension fields when Gemini grounds the answer', () => {
    const grounding = {
      groundingChunks: [{ web: { uri: 'https://e.test', title: 'E' } }],
      webSearchQueries: ['biden age'],
    };
    const response = {
      candidates: [
        {
          content: { parts: [{ text: 'Biden.' }] },
          finishReason: GeminiFinishReason.STOP,
          groundingMetadata: grounding,
        },
      ],
      usageMetadata: {},
    } as unknown as GenerateContentResponse;
    const out = geminiResponseToAnthropic(response, 'gemini-2.5-flash') as {
      grounding_metadata?: unknown;
      vertex_ai_grounding_metadata?: unknown;
    };
    expect(out.grounding_metadata).toEqual(grounding);
    expect(out.vertex_ai_grounding_metadata).toEqual(grounding);
  });

  it('attaches url_context_metadata + prompt_feedback when Gemini emits them', () => {
    const response = {
      candidates: [
        {
          content: { parts: [{ text: 'ok' }] },
          finishReason: GeminiFinishReason.STOP,
          urlContextMetadata: {
            urlMetadata: [{ retrievedUrl: 'https://a.b' }],
          },
        },
      ],
      promptFeedback: { blockReason: undefined, safetyRatings: [] },
      usageMetadata: {},
    } as unknown as GenerateContentResponse;
    const out = geminiResponseToAnthropic(response, 'gemini-2.5-flash') as {
      url_context_metadata?: unknown;
      prompt_feedback?: unknown;
    };
    expect(out.url_context_metadata).toEqual({
      urlMetadata: [{ retrievedUrl: 'https://a.b' }],
    });
    expect(out.prompt_feedback).toEqual({
      blockReason: undefined,
      safetyRatings: [],
    });
  });

  it('omits the grounding extension fields when the candidate has no groundingMetadata', () => {
    const response = {
      candidates: [
        {
          content: { parts: [{ text: 'no search' }] },
          finishReason: GeminiFinishReason.STOP,
        },
      ],
      usageMetadata: {},
    } as unknown as GenerateContentResponse;
    const out = geminiResponseToAnthropic(response, 'gemini-2.5-flash') as {
      grounding_metadata?: unknown;
      vertex_ai_grounding_metadata?: unknown;
    };
    expect(out.grounding_metadata).toBeUndefined();
    expect(out.vertex_ai_grounding_metadata).toBeUndefined();
  });
});

async function collect(
  src: AsyncIterable<RawMessageStreamEvent>
): Promise<RawMessageStreamEvent[]> {
  const out: RawMessageStreamEvent[] = [];
  for await (const ev of src) out.push(ev);
  return out;
}

async function* fromArray<T>(items: T[]): AsyncIterable<T> {
  for (const item of items) yield item;
}

describe('streamGeminiToAnthropic', () => {
  it('emits the full event sequence for a simple text response (all 8 usage fields on message_start)', async () => {
    const chunks: GenerateContentResponse[] = [
      {
        candidates: [{ content: { role: 'model', parts: [{ text: 'hel' }] } }],
      } as unknown as GenerateContentResponse,
      {
        candidates: [
          {
            content: { role: 'model', parts: [{ text: 'lo' }] },
            finishReason: GeminiFinishReason.STOP,
          },
        ],
        usageMetadata: {
          promptTokenCount: 1,
          responseTokenCount: 2,
          totalTokenCount: 3,
        },
      } as unknown as GenerateContentResponse,
    ];
    const events = await collect(
      streamGeminiToAnthropic(fromArray(chunks), 'gemini-2.5-flash')
    );
    const types = events.map((e) => e.type);
    expect(types[0]).toBe('message_start');
    expect(types).toContain('content_block_start');
    expect(types).toContain('content_block_delta');
    expect(types).toContain('content_block_stop');
    expect(types).toContain('message_delta');
    expect(types[types.length - 1]).toBe('message_stop');

    const start = events[0] as Extract<
      RawMessageStreamEvent,
      { type: 'message_start' }
    >;
    expect(start.message.id.startsWith('msg_')).toBe(true);
    expect(start.message.container).toBeNull();
    expect(start.message.stop_reason).toBeNull();
    expect(start.message.stop_details).toBeNull();
    // All 8 usage fields populated (zero / null) on message_start.
    expect(Object.keys(start.message.usage).sort()).toEqual(
      [
        'cache_creation',
        'cache_creation_input_tokens',
        'cache_read_input_tokens',
        'inference_geo',
        'input_tokens',
        'output_tokens',
        'server_tool_use',
        'service_tier',
      ].sort()
    );

    const messageDelta = events.find(
      (e) => e.type === 'message_delta'
    ) as Extract<RawMessageStreamEvent, { type: 'message_delta' }>;
    expect(messageDelta.delta.stop_reason).toBe('end_turn');
    expect(messageDelta.usage.output_tokens).toBe(2);
  });

  it('closes the text block before opening a tool_use block (sequential blocks)', async () => {
    const chunks: GenerateContentResponse[] = [
      {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [
                { text: 'calling now' },
                {
                  functionCall: {
                    id: 'call_a',
                    name: 'lookup',
                    args: { q: 'x' },
                  },
                },
              ],
            },
            finishReason: GeminiFinishReason.STOP,
          },
        ],
        usageMetadata: {},
      } as unknown as GenerateContentResponse,
    ];
    const events = await collect(
      streamGeminiToAnthropic(fromArray(chunks), 'gemini-2.5-flash')
    );
    // The text block must close before tool_use opens.
    const textStop = events.findIndex(
      (e) =>
        e.type === 'content_block_stop' && (e as { index?: number }).index === 0
    );
    const toolStart = events.findIndex(
      (e) =>
        e.type === 'content_block_start' &&
        (e as { content_block?: { type?: string } }).content_block?.type ===
          'tool_use'
    );
    expect(textStop).toBeGreaterThanOrEqual(0);
    expect(toolStart).toBeGreaterThanOrEqual(0);
    expect(textStop).toBeLessThan(toolStart);
  });

  it('closes the thinking block (with signature_delta) before opening the text block', async () => {
    const chunks: GenerateContentResponse[] = [
      {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [
                { text: 'reasoning', thought: true, thoughtSignature: 'sig1' },
                { text: 'final' },
              ],
            },
            finishReason: GeminiFinishReason.STOP,
          },
        ],
        usageMetadata: {},
      } as unknown as GenerateContentResponse,
    ];
    const events = await collect(
      streamGeminiToAnthropic(fromArray(chunks), 'gemini-2.5-flash')
    );
    // thinking opens at index 0, text at index 1.
    const blockStarts = events.filter((e) => e.type === 'content_block_start');
    expect(
      (blockStarts[0] as { content_block?: { type?: string } }).content_block
        ?.type
    ).toBe('thinking');
    expect((blockStarts[0] as { index?: number }).index).toBe(0);
    expect(
      (blockStarts[1] as { content_block?: { type?: string } }).content_block
        ?.type
    ).toBe('text');
    expect((blockStarts[1] as { index?: number }).index).toBe(1);
    // signature_delta on the thinking block before its stop.
    const sigDelta = events.find(
      (e) =>
        e.type === 'content_block_delta' &&
        (e as { delta?: { type?: string } }).delta?.type === 'signature_delta'
    );
    expect(sigDelta).toBeDefined();
    const thinkingStopIdx = events.findIndex(
      (e) =>
        e.type === 'content_block_stop' && (e as { index?: number }).index === 0
    );
    const textStartIdx = events.findIndex(
      (e) =>
        e.type === 'content_block_start' &&
        (e as { index?: number }).index === 1
    );
    expect(thinkingStopIdx).toBeGreaterThanOrEqual(0);
    expect(thinkingStopIdx).toBeLessThan(textStartIdx);
    // Text block stop must reference index 1, not 0 — guards against
    // the prior bug that always closed text at index 0.
    const textStop = events.find(
      (e) =>
        e.type === 'content_block_stop' && (e as { index?: number }).index === 1
    );
    expect(textStop).toBeDefined();
  });

  it('emits the full tool_use args as a single input_json_delta and promotes stop_reason to tool_use', async () => {
    const chunks: GenerateContentResponse[] = [
      {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [
                {
                  functionCall: {
                    id: 'call_a',
                    name: 'lookup_weather',
                    args: { city: 'Tokyo' },
                  },
                },
              ],
            },
            finishReason: GeminiFinishReason.STOP,
          },
        ],
        usageMetadata: {},
      } as unknown as GenerateContentResponse,
    ];
    const events = await collect(
      streamGeminiToAnthropic(fromArray(chunks), 'gemini-2.5-flash')
    );
    const argsDelta = events.find(
      (e) =>
        e.type === 'content_block_delta' &&
        (e as { delta?: { type?: string } }).delta?.type === 'input_json_delta'
    );
    expect(argsDelta).toBeDefined();
    const partial = (argsDelta as { delta?: { partial_json?: string } }).delta
      ?.partial_json;
    expect(partial).toBe('{"city":"Tokyo"}');
    const messageDelta = events.find(
      (e) => e.type === 'message_delta'
    ) as Extract<RawMessageStreamEvent, { type: 'message_delta' }>;
    expect(messageDelta.delta.stop_reason).toBe('tool_use');
  });

  it('maps SAFETY finishReason at stream end to stop_reason=refusal', async () => {
    const chunks: GenerateContentResponse[] = [
      {
        candidates: [
          {
            content: { role: 'model', parts: [] },
            finishReason: GeminiFinishReason.SAFETY,
          },
        ],
        usageMetadata: {},
      } as unknown as GenerateContentResponse,
    ];
    const events = await collect(
      streamGeminiToAnthropic(fromArray(chunks), 'gemini-2.5-flash')
    );
    const messageDelta = events.find(
      (e) => e.type === 'message_delta'
    ) as Extract<RawMessageStreamEvent, { type: 'message_delta' }>;
    expect(messageDelta.delta.stop_reason).toBe('refusal');
  });

  it('surfaces grounding_metadata + vertex_ai_grounding_metadata on the closing message_delta', async () => {
    // Streaming parity with the non-stream converter — the accumulator
    // captures `groundingMetadata` from any chunk that carries it
    // (typically the last) and the closing `message_delta` exposes it
    // under both extension keys. Without this, callers driving Gemini
    // through `/anthropic/messages` lose the source-rank / segment
    // provenance the OpenAI-side converters already expose.
    const grounding = {
      groundingChunks: [{ web: { uri: 'https://e.test', title: 'E' } }],
      webSearchQueries: ['biden age'],
    };
    const chunks: GenerateContentResponse[] = [
      {
        candidates: [
          { content: { role: 'model', parts: [{ text: 'Biden.' }] } },
        ],
      } as unknown as GenerateContentResponse,
      {
        candidates: [
          {
            content: { role: 'model', parts: [] },
            finishReason: GeminiFinishReason.STOP,
            groundingMetadata: grounding,
          },
        ],
        usageMetadata: {},
      } as unknown as GenerateContentResponse,
    ];
    const events = await collect(
      streamGeminiToAnthropic(fromArray(chunks), 'gemini-2.5-flash')
    );
    const messageDelta = events.find(
      (e) => e.type === 'message_delta'
    ) as Extract<RawMessageStreamEvent, { type: 'message_delta' }> & {
      grounding_metadata?: unknown;
      vertex_ai_grounding_metadata?: unknown;
    };
    expect(messageDelta.grounding_metadata).toEqual(grounding);
    expect(messageDelta.vertex_ai_grounding_metadata).toEqual(grounding);
  });

  it('does not attach grounding extension fields when no chunk carried groundingMetadata', async () => {
    const chunks: GenerateContentResponse[] = [
      {
        candidates: [{ content: { role: 'model', parts: [{ text: 'pong' }] } }],
      } as unknown as GenerateContentResponse,
      {
        candidates: [
          {
            content: { role: 'model', parts: [] },
            finishReason: GeminiFinishReason.STOP,
          },
        ],
        usageMetadata: {},
      } as unknown as GenerateContentResponse,
    ];
    const events = await collect(
      streamGeminiToAnthropic(fromArray(chunks), 'gemini-2.5-flash')
    );
    const messageDelta = events.find(
      (e) => e.type === 'message_delta'
    ) as Extract<RawMessageStreamEvent, { type: 'message_delta' }> & {
      grounding_metadata?: unknown;
      vertex_ai_grounding_metadata?: unknown;
    };
    expect(messageDelta.grounding_metadata).toBeUndefined();
    expect(messageDelta.vertex_ai_grounding_metadata).toBeUndefined();
  });
});

describe('requestAnthropicToGemini — server tool fidelity', () => {
  it('maps web_search and web_fetch onto Gemini built-in tools', () => {
    const out = requestAnthropicToGemini(
      baseReq({
        tools: [
          { type: 'web_search_20260209', name: 'web_search' },
          { type: 'web_fetch_20260309', name: 'web_fetch' },
        ] as never,
      })
    );
    expect(out.config?.tools).toEqual([
      { googleSearch: {} },
      { urlContext: {} },
    ]);
  });

  it('passes through Gemini-native tool entries unchanged (vmx.providerArgs.tools escape hatch)', () => {
    // Anthropic's `web_search_20250305` carries `user_location`,
    // `allowed_domains`, `blocked_domains`, `max_uses` — none of which
    // map to a Gemini-API knob (Vertex-only `excludeDomains` excepted).
    // Callers needing those knobs override via `vmx.providerArgs.tools`;
    // the orchestrator merges that into the top-level body so a native
    // `{googleSearch: {timeRangeFilter, excludeDomains}}` entry rides
    // alongside the Anthropic-shape tools. The converter must
    // passthrough the native shape verbatim rather than route it
    // through `classifyAnthropicServerTool` (which would 400 it as an
    // "unknown" server tool).
    const out = requestAnthropicToGemini(
      baseReq({
        tools: [
          {
            googleSearch: {
              excludeDomains: ['example.test'],
              timeRangeFilter: {
                startTime: '2026-01-01T00:00:00Z',
                endTime: '2026-02-01T00:00:00Z',
              },
            },
          },
          {
            name: 'lookup',
            description: 'd',
            input_schema: { type: 'object', properties: {} },
          },
        ] as never,
      })
    );
    expect(out.config?.tools).toEqual([
      {
        googleSearch: {
          excludeDomains: ['example.test'],
          timeRangeFilter: {
            startTime: '2026-01-01T00:00:00Z',
            endTime: '2026-02-01T00:00:00Z',
          },
        },
      },
      {
        functionDeclarations: [
          {
            name: 'lookup',
            description: 'd',
            parametersJsonSchema: { type: 'object', properties: {} },
          },
        ],
      },
    ]);
  });

  it('maps the code_execution family across all known versions to codeExecution', () => {
    const out = requestAnthropicToGemini(
      baseReq({
        tools: [
          { type: 'code_execution_20250522', name: 'code_execution' },
          { type: 'code_execution_20250825', name: 'code_execution' },
          { type: 'code_execution_20260120', name: 'code_execution' },
        ] as never,
      })
    );
    expect(out.config?.tools).toEqual([
      { codeExecution: {} },
      { codeExecution: {} },
      { codeExecution: {} },
    ]);
  });

  it.each([
    ['bash_20250124', 'bash'],
    ['text_editor_20250728', 'str_replace_based_edit_tool'],
    ['memory_20250818', 'memory'],
    ['tool_search_tool_bm25_20251119', 'tool_search_tool_bm25'],
  ])(
    'rejects unsupported server tool %s with anthropic_server_tool_unsupported_on_gemini',
    (type, name) => {
      expect(() =>
        requestAnthropicToGemini(baseReq({ tools: [{ type, name }] as never }))
      ).toThrowError(
        expect.objectContaining({
          data: expect.objectContaining({
            statusCode: 400,
            retryable: false,
            openAICompatibleError: expect.objectContaining({
              code: 'anthropic_server_tool_unsupported_on_gemini',
            }),
          }),
        })
      );
    }
  );

  it('lifts a web_search_tool_result history block into a plain text part', () => {
    const out = requestAnthropicToGemini(
      baseReq({
        messages: [
          { role: 'user', content: 'who won?' },
          {
            role: 'assistant',
            content: [
              {
                type: 'web_search_tool_result',
                tool_use_id: 'srv_1',
                content: [
                  {
                    type: 'web_search_result',
                    title: 'Result A',
                    url: 'https://a.example/r',
                    encrypted_content: 'enc',
                  },
                ],
              },
            ] as never,
          },
        ],
      })
    );
    const contents = out.contents as Array<{
      role?: string;
      parts?: Array<{ text?: string }>;
    }>;
    const modelTurn = contents.find((c) => c.role === 'model');
    const text = (modelTurn?.parts ?? []).map((p) => p.text ?? '').join('');
    expect(text).toContain('[web_search_tool_result]');
    expect(text).toContain('Result A');
    expect(text).toContain('https://a.example/r');
  });

  it('lifts a code_execution_tool_result history block carrying stdout / stderr', () => {
    const out = requestAnthropicToGemini(
      baseReq({
        messages: [
          { role: 'user', content: 'compute' },
          {
            role: 'assistant',
            content: [
              {
                type: 'code_execution_tool_result',
                tool_use_id: 'srv_2',
                content: {
                  type: 'code_execution_result',
                  return_code: 0,
                  stdout: 'hello',
                  stderr: '',
                  content: [],
                },
              },
            ] as never,
          },
        ],
      })
    );
    const contents = out.contents as Array<{
      role?: string;
      parts?: Array<{ text?: string }>;
    }>;
    const modelTurn = contents.find((c) => c.role === 'model');
    const text = (modelTurn?.parts ?? []).map((p) => p.text ?? '').join('');
    expect(text).toContain('[code_execution_tool_result]');
    expect(text).toContain('exit 0');
    expect(text).toContain('stdout:\nhello');
  });
});
