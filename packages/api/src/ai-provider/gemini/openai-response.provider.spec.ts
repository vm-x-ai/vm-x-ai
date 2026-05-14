import { describe, expect, it } from 'vitest';
import {
  geminiResponseToResponses,
  requestResponsesToGemini,
  streamGeminiToResponses,
} from './openai-response.provider';
import {
  FunctionCallingConfigMode,
  FinishReason as GeminiFinishReason,
  type GenerateContentResponse,
} from '@google/genai';
import type {
  ResponseCreateParams,
  ResponseStreamEvent,
} from 'openai/resources/responses/responses.js';

/**
 * Converter-level tests for the Gemini-native Responses provider.
 * Class-level dispatch is exercised end-to-end by the live
 * `__integration__/providers/gemini.spec.ts` (skipped without
 * `GEMINI_API_KEY`); these specs pin the pure request/response/stream
 * mapping.
 */

const baseReq = (
  overrides: Partial<ResponseCreateParams> = {}
): ResponseCreateParams =>
  ({
    model: 'gemini-2.5-flash',
    input: 'hi',
    ...overrides,
  } as ResponseCreateParams);

describe('requestResponsesToGemini', () => {
  it('lifts string instructions into systemInstruction', () => {
    const out = requestResponsesToGemini(
      baseReq({ instructions: 'Be terse.' })
    );
    expect(out.config?.systemInstruction).toEqual({
      role: 'user',
      parts: [{ text: 'Be terse.' }],
    });
    expect(out.contents).toEqual([{ role: 'user', parts: [{ text: 'hi' }] }]);
  });

  it('maps a string input to a single user content', () => {
    const out = requestResponsesToGemini(baseReq({ input: 'hello' }));
    expect(out.contents).toEqual([
      { role: 'user', parts: [{ text: 'hello' }] },
    ]);
  });

  it('lifts input_text + input_image data URL into text + inlineData parts', () => {
    const out = requestResponsesToGemini(
      baseReq({
        input: [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: 'describe' },
              {
                type: 'input_image',
                image_url: 'data:image/png;base64,AAAA',
              },
            ],
          },
        ] as never,
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

  it('resolves function_call_output.name from prior function_call (not call_id)', () => {
    // Gemini correlates `functionResponse.name` against the prior
    // `functionCall.name`. Falling back to `call_id` breaks the
    // round-trip — the model can't match the response to the call.
    const out = requestResponsesToGemini(
      baseReq({
        input: [
          {
            role: 'user',
            content: [{ type: 'input_text', text: 'q' }],
          },
          {
            type: 'function_call',
            id: 'fc_1',
            call_id: 'call_xyz',
            name: 'lookup_weather',
            arguments: '{}',
          },
          {
            type: 'function_call_output',
            call_id: 'call_xyz',
            output: '72F',
          },
        ] as never,
      })
    );
    const contents = out.contents as Array<{
      parts?: Array<{
        functionResponse?: { id?: string; name?: string };
      }>;
    }>;
    const fnResp = contents
      .flatMap((c) => c.parts ?? [])
      .find((p) => p.functionResponse)?.functionResponse;
    expect(fnResp?.id).toBe('call_xyz');
    expect(fnResp?.name).toBe('lookup_weather');
  });

  it('falls back to call_id when no prior function_call declares the tool', () => {
    const out = requestResponsesToGemini(
      baseReq({
        input: [
          {
            type: 'function_call_output',
            call_id: 'orphan',
            output: 'x',
          },
        ] as never,
      })
    );
    const contents = out.contents as Array<{
      parts?: Array<{ functionResponse?: { name?: string } }>;
    }>;
    expect(
      contents.flatMap((c) => c.parts ?? [])[0]?.functionResponse?.name
    ).toBe('orphan');
  });

  it('coalesces consecutive function_call_output items into a single user turn', () => {
    const out = requestResponsesToGemini(
      baseReq({
        input: [
          {
            type: 'function_call',
            id: 'fc_a',
            call_id: 'a',
            name: 'a',
            arguments: '{}',
          },
          {
            type: 'function_call',
            id: 'fc_b',
            call_id: 'b',
            name: 'b',
            arguments: '{}',
          },
          { type: 'function_call_output', call_id: 'a', output: 'r1' },
          { type: 'function_call_output', call_id: 'b', output: 'r2' },
        ] as never,
      })
    );
    const contents = out.contents as Array<{
      role?: string;
      parts?: Array<{ functionResponse?: unknown }>;
    }>;
    const toolTurn = contents.find(
      (c) => Array.isArray(c.parts) && c.parts.some((p) => p.functionResponse)
    );
    expect(toolTurn?.role).toBe('user');
    expect(toolTurn?.parts).toHaveLength(2);
  });

  it('lifts a reasoning input item with summary + encrypted_content as a thought part', () => {
    const out = requestResponsesToGemini(
      baseReq({
        input: [
          {
            type: 'reasoning',
            id: 'rs_1',
            summary: [{ type: 'summary_text', text: 'thinking text' }],
            encrypted_content: 'sig1',
          },
        ] as never,
      })
    );
    const contents = out.contents as Array<{
      role?: string;
      parts?: Array<{
        thought?: boolean;
        thoughtSignature?: string;
        text?: string;
      }>;
    }>;
    const modelTurn = contents.find((c) => c.role === 'model');
    const thoughtPart = modelTurn?.parts?.find((p) => p.thought === true);
    expect(thoughtPart?.text).toBe('thinking text');
    expect(thoughtPart?.thoughtSignature).toBe('sig1');
  });

  it('maps tool_choice=required to functionCallingConfig ANY', () => {
    const out = requestResponsesToGemini(
      baseReq({
        tools: [
          {
            type: 'function',
            name: 'noop',
            parameters: { type: 'object' },
          },
        ] as never,
        tool_choice: 'required',
      })
    );
    expect(out.config?.toolConfig?.functionCallingConfig?.mode).toBe(
      FunctionCallingConfigMode.ANY
    );
  });

  it('maps tool_choice named function to functionCallingConfig ANY + allowlist', () => {
    const out = requestResponsesToGemini(
      baseReq({
        tools: [
          {
            type: 'function',
            name: 'lookup',
            parameters: { type: 'object' },
          },
        ] as never,
        tool_choice: { type: 'function', name: 'lookup' } as never,
      })
    );
    const cfg = out.config?.toolConfig?.functionCallingConfig;
    expect(cfg?.mode).toBe(FunctionCallingConfigMode.ANY);
    expect(cfg?.allowedFunctionNames).toEqual(['lookup']);
  });

  it('translates text.format json_schema into responseMimeType + responseJsonSchema', () => {
    const out = requestResponsesToGemini(
      baseReq({
        text: {
          format: {
            type: 'json_schema',
            name: 'Reply',
            schema: { type: 'object' },
          },
        } as never,
      })
    );
    expect(out.config?.responseMimeType).toBe('application/json');
    expect(out.config?.responseJsonSchema).toEqual({ type: 'object' });
  });

  it('maps web_search and code_interpreter hosted tools to native Gemini tools', () => {
    const out = requestResponsesToGemini(
      baseReq({
        tools: [
          { type: 'web_search_preview' } as never,
          { type: 'code_interpreter' } as never,
        ],
      })
    );
    expect(out.config?.tools).toEqual([
      { googleSearch: {} },
      { codeExecution: {} },
    ]);
  });

  it('maps web_search filters.search_recency_filter onto googleSearch.timeRangeFilter', () => {
    const out = requestResponsesToGemini(
      baseReq({
        tools: [
          {
            type: 'web_search',
            filters: { search_recency_filter: 'week' },
          } as never,
        ],
      })
    );
    const search = (
      out.config?.tools as Array<{
        googleSearch?: {
          timeRangeFilter?: { startTime: string; endTime: string };
        };
      }>
    )?.[0]?.googleSearch;
    expect(search?.timeRangeFilter).toBeDefined();
    // Gemini rejects fractional seconds — the helper strips `.SSSZ`
    // back to second precision. Both timestamps must match `...Z`
    // with no decimal point in the seconds field.
    expect(search!.timeRangeFilter!.startTime).toMatch(/Z$/);
    expect(search!.timeRangeFilter!.startTime).not.toContain('.');
    expect(search!.timeRangeFilter!.endTime).toMatch(/Z$/);
    expect(search!.timeRangeFilter!.endTime).not.toContain('.');
    const startMs = Date.parse(search!.timeRangeFilter!.startTime);
    const endMs = Date.parse(search!.timeRangeFilter!.endTime);
    // Window should be ~7 days; allow a few seconds of slack for test
    // timing drift (start/end are computed at separate `Date` reads).
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    expect(Math.abs(endMs - startMs - sevenDaysMs)).toBeLessThan(2_000);
  });

  it('drops web_search subfields with no Gemini-API equivalent (user_location, allowed_domains, blocked_domains, search_domain_filter)', () => {
    // None of these map onto Gemini-API `googleSearch` knobs (`excludeDomains`
    // exists but is Vertex-AI-only, which our connection config doesn't
    // currently support). Silently dropped — the resulting tool is bare.
    const out = requestResponsesToGemini(
      baseReq({
        tools: [
          {
            type: 'web_search',
            user_location: {
              type: 'approximate',
              city: 'Paris',
              country: 'FR',
            },
            filters: {
              allowed_domains: ['anthropic.com'],
              blocked_domains: ['example.test'],
              search_domain_filter: ['techcrunch.com'],
            },
          } as never,
        ],
      })
    );
    expect(out.config?.tools).toEqual([{ googleSearch: {} }]);
  });

  it('passes through Gemini-native tool entries unchanged (escape hatch for vmx.providerArgs.tools)', () => {
    // The orchestrator merges `vmx.providerArgs.tools` into the top-level
    // `tools[]` before this converter runs, so a Gemini-native tool entry
    // like `{googleSearch: {excludeDomains: [...]}}` arrives here mixed
    // in with OpenAI-shape entries. The converter must passthrough native
    // shapes verbatim instead of dropping them as "unknown hosted tool".
    // This is how callers reach Vertex-side knobs (`excludeDomains`,
    // `blockingConfidence`) and Gemini-side knobs (`timeRangeFilter`
    // with explicit dates) the cross-format converter can't synthesise.
    const out = requestResponsesToGemini(
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
          } as never,
          {
            type: 'function',
            name: 'lookup',
            description: 'd',
            parameters: { type: 'object', properties: {} },
          } as never,
        ],
      })
    );
    // The native googleSearch entry rides through with all its
    // subfields; function tools still aggregate onto a
    // functionDeclarations Tool at the end.
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

  it('forwards function tools as functionDeclarations with JSON Schema parameters', () => {
    const out = requestResponsesToGemini(
      baseReq({
        tools: [
          {
            type: 'function',
            name: 'lookup',
            description: 'd',
            parameters: { type: 'object', properties: {} },
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

  it('maps reasoning.effort=high into a thinkingConfig with budget', () => {
    const out = requestResponsesToGemini(
      baseReq({
        reasoning: { effort: 'high' } as never,
        max_output_tokens: 8192,
      })
    );
    expect(out.config?.thinkingConfig?.includeThoughts).toBe(true);
    expect(out.config?.thinkingConfig?.thinkingBudget).toBeGreaterThan(0);
  });

  it('strips the __vmx_passthrough envelope from the converted request', () => {
    const out = requestResponsesToGemini(
      baseReq({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        __vmx_passthrough: { anthropic: { top_k: 50 } } as any,
      } as never)
    );
    expect(
      (out as unknown as Record<string, unknown>).__vmx_passthrough
    ).toBeUndefined();
  });
});

describe('geminiResponseToResponses', () => {
  const request: ResponseCreateParams = baseReq();

  it('maps text + functionCall + thought parts into output[]', () => {
    const response = {
      responseId: 'resp_1',
      candidates: [
        {
          content: {
            role: 'model',
            parts: [
              { text: 'hello' },
              { text: 'reasoning', thought: true, thoughtSignature: 'sig' },
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
        totalTokenCount: 18,
      },
    } as unknown as GenerateContentResponse;
    const result = geminiResponseToResponses(
      response,
      'gemini-2.5-flash',
      request
    );
    expect(result.id).toBe('resp_1');
    // Reasoning leads the output list, then message, then function_call.
    expect(result.output[0].type).toBe('reasoning');
    expect(
      (result.output[0] as { encrypted_content?: string }).encrypted_content
    ).toBe('sig');
    const message = result.output.find((o) => o.type === 'message') as {
      content?: Array<{ type: string; text?: string }>;
    };
    expect(message?.content?.[0]?.text).toBe('hello');
    const fnCall = result.output.find((o) => o.type === 'function_call') as {
      name?: string;
      call_id?: string;
      arguments?: string;
    };
    expect(fnCall?.name).toBe('lookup');
    expect(fnCall?.call_id).toBe('call_a');
    expect(fnCall?.arguments).toBe('{"q":"x"}');
    expect(result.status).toBe('completed');
    // `output_tokens` should include reasoning (Responses semantics).
    expect(result.usage?.output_tokens).toBe(8);
    expect(result.usage?.output_tokens_details?.reasoning_tokens).toBe(3);
  });

  it('maps MAX_TOKENS to status=incomplete + reason=max_output_tokens', () => {
    const response = {
      candidates: [
        {
          content: { parts: [{ text: 'cut off' }] },
          finishReason: GeminiFinishReason.MAX_TOKENS,
        },
      ],
      usageMetadata: {},
    } as unknown as GenerateContentResponse;
    const result = geminiResponseToResponses(
      response,
      'gemini-2.5-flash',
      request
    );
    expect(result.status).toBe('incomplete');
    expect(result.incomplete_details).toEqual({ reason: 'max_output_tokens' });
  });

  it('maps SAFETY to status=incomplete + reason=content_filter', () => {
    const response = {
      candidates: [
        {
          content: { parts: [] },
          finishReason: GeminiFinishReason.SAFETY,
        },
      ],
      usageMetadata: {},
    } as unknown as GenerateContentResponse;
    const result = geminiResponseToResponses(
      response,
      'gemini-2.5-flash',
      request
    );
    expect(result.status).toBe('incomplete');
    expect(result.incomplete_details).toEqual({ reason: 'content_filter' });
  });

  it('promotes a prompt-level block (no candidate) to content_filter', () => {
    // Gemini reports input-side safety blocks via `promptFeedback.blockReason`
    // and ships *no candidate*. Without the promotion, the converter
    // would default to `status: 'completed'` and lose the refusal signal.
    const response = {
      promptFeedback: {
        blockReason: 'SAFETY',
        blockReasonMessage: 'prompt rejected',
      },
      usageMetadata: { promptTokenCount: 12 },
    } as unknown as GenerateContentResponse;
    const result = geminiResponseToResponses(
      response,
      'gemini-2.5-flash',
      request
    );
    expect(result.status).toBe('incomplete');
    expect(result.incomplete_details).toEqual({ reason: 'content_filter' });
  });

  it('echoes parallel_tool_calls from the request when explicitly set', () => {
    const response = {
      candidates: [
        {
          content: { parts: [{ text: 'hi' }] },
          finishReason: GeminiFinishReason.STOP,
        },
      ],
      usageMetadata: {},
    } as unknown as GenerateContentResponse;
    const result = geminiResponseToResponses(
      response,
      'gemini-2.5-flash',
      baseReq({ parallel_tool_calls: false })
    );
    expect(result.parallel_tool_calls).toBe(false);
  });

  it('maps groundingMetadata chunks + supports to url_citation annotations on the first output_text', () => {
    const response = {
      candidates: [
        {
          content: {
            role: 'model',
            parts: [{ text: 'Paris is the capital of France.' }],
          },
          finishReason: GeminiFinishReason.STOP,
          groundingMetadata: {
            groundingChunks: [
              {
                web: { uri: 'https://example.com/a', title: 'Source A' },
              },
              {
                web: { uri: 'https://example.com/b', title: 'Source B' },
              },
            ],
            groundingSupports: [
              {
                segment: { startIndex: 0, endIndex: 5 },
                groundingChunkIndices: [0],
              },
              {
                segment: { startIndex: 6, endIndex: 30 },
                groundingChunkIndices: [1],
              },
            ],
          },
        },
      ],
      usageMetadata: {},
    } as unknown as GenerateContentResponse;
    const result = geminiResponseToResponses(
      response,
      'gemini-2.5-flash',
      request
    );
    const message = result.output.find((o) => o.type === 'message') as {
      content?: Array<{ type: string; annotations?: unknown[] }>;
    };
    const annotations = message?.content?.[0]?.annotations as Array<{
      type: string;
      url: string;
      title: string;
      start_index: number;
      end_index: number;
    }>;
    expect(annotations).toHaveLength(2);
    expect(annotations[0]).toEqual({
      type: 'url_citation',
      url: 'https://example.com/a',
      title: 'Source A',
      start_index: 0,
      end_index: 5,
    });
    expect(annotations[1]).toEqual({
      type: 'url_citation',
      url: 'https://example.com/b',
      title: 'Source B',
      start_index: 6,
      end_index: 30,
    });
  });

  it('falls back to chunk-only annotations when groundingSupports is absent', () => {
    const response = {
      candidates: [
        {
          content: { role: 'model', parts: [{ text: 'hi' }] },
          finishReason: GeminiFinishReason.STOP,
          groundingMetadata: {
            groundingChunks: [{ web: { uri: 'https://x.test', title: 'X' } }],
          },
        },
      ],
      usageMetadata: {},
    } as unknown as GenerateContentResponse;
    const result = geminiResponseToResponses(
      response,
      'gemini-2.5-flash',
      request
    );
    const message = result.output.find((o) => o.type === 'message') as {
      content?: Array<{ annotations?: Array<{ url: string }> }>;
    };
    expect(message?.content?.[0]?.annotations).toEqual([
      {
        type: 'url_citation',
        url: 'https://x.test',
        title: 'X',
        start_index: 0,
        end_index: 0,
      },
    ]);
  });

  // ─── Gemini-native grounding extension fields ─────────────────────
  //
  // Parity contract: the Chat Completions converter surfaces the raw
  // `groundingMetadata` payload as `vertex_ai_grounding_metadata` /
  // `grounding_metadata` extension fields on the response, and direct
  // API consumers rely on those to render source rank, segment
  // provenance, and other Gemini-native bits that don't fit the
  // OpenAI `url_citation` shape. The Responses converter needs to
  // expose the same fields so the playground's Gemini-on-Responses
  // path doesn't drop them.

  it('attaches grounding_metadata + vertex_ai_grounding_metadata extension fields to the response', () => {
    const grounding = {
      groundingChunks: [{ web: { uri: 'https://e.test', title: 'E' } }],
      webSearchQueries: ['who is the president of the USA?'],
    };
    const response = {
      candidates: [
        {
          content: { role: 'model', parts: [{ text: 'Biden.' }] },
          finishReason: GeminiFinishReason.STOP,
          groundingMetadata: grounding,
        },
      ],
      usageMetadata: {},
    } as unknown as GenerateContentResponse;
    const result = geminiResponseToResponses(
      response,
      'gemini-2.5-flash',
      request
    ) as {
      grounding_metadata?: unknown;
      vertex_ai_grounding_metadata?: unknown;
    };
    // Both keys carry the same payload — `vertex_ai_grounding_metadata`
    // mirrors the Chat Completions converter (Vertex-style alias) and
    // `grounding_metadata` matches Gemini's native field name. Direct
    // API consumers can read whichever they target.
    expect(result.grounding_metadata).toEqual(grounding);
    expect(result.vertex_ai_grounding_metadata).toEqual(grounding);
  });

  it('attaches url_context_metadata + prompt_feedback when Gemini emits them', () => {
    const response = {
      candidates: [
        {
          content: { role: 'model', parts: [{ text: 'ok' }] },
          finishReason: GeminiFinishReason.STOP,
          urlContextMetadata: {
            urlMetadata: [{ retrievedUrl: 'https://a.b' }],
          },
        },
      ],
      promptFeedback: { blockReason: undefined, safetyRatings: [] },
      usageMetadata: {},
    } as unknown as GenerateContentResponse;
    const result = geminiResponseToResponses(
      response,
      'gemini-2.5-flash',
      request
    ) as { url_context_metadata?: unknown; prompt_feedback?: unknown };
    expect(result.url_context_metadata).toEqual({
      urlMetadata: [{ retrievedUrl: 'https://a.b' }],
    });
    expect(result.prompt_feedback).toEqual({
      blockReason: undefined,
      safetyRatings: [],
    });
  });

  it('omits the extension fields when the candidate has no grounding', () => {
    const response = {
      candidates: [
        {
          content: { role: 'model', parts: [{ text: 'no search' }] },
          finishReason: GeminiFinishReason.STOP,
        },
      ],
      usageMetadata: {},
    } as unknown as GenerateContentResponse;
    const result = geminiResponseToResponses(
      response,
      'gemini-2.5-flash',
      request
    ) as {
      grounding_metadata?: unknown;
      vertex_ai_grounding_metadata?: unknown;
    };
    expect(result.grounding_metadata).toBeUndefined();
    expect(result.vertex_ai_grounding_metadata).toBeUndefined();
  });
});

describe('streamGeminiToResponses', () => {
  async function collect(
    src: AsyncIterable<ResponseStreamEvent>
  ): Promise<ResponseStreamEvent[]> {
    const out: ResponseStreamEvent[] = [];
    for await (const ev of src) out.push(ev);
    return out;
  }

  async function* fromArray<T>(items: T[]): AsyncIterable<T> {
    for (const item of items) yield item;
  }

  it('emits the full event sequence for a simple text response', async () => {
    const chunks: GenerateContentResponse[] = [
      {
        candidates: [
          {
            content: { role: 'model', parts: [{ text: 'hel' }] },
          },
        ],
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
      streamGeminiToResponses(fromArray(chunks), 'gemini-2.5-flash', baseReq())
    );
    const types = events.map((e) => e.type);
    expect(types[0]).toBe('response.created');
    expect(types[1]).toBe('response.in_progress');
    expect(types).toContain('response.output_item.added');
    expect(types).toContain('response.content_part.added');
    expect(types).toContain('response.output_text.delta');
    expect(types).toContain('response.output_text.done');
    expect(types).toContain('response.content_part.done');
    expect(types).toContain('response.output_item.done');
    expect(types[types.length - 1]).toBe('response.completed');
    // Sequence numbers must be monotonic.
    const seqs = events.map((e) => e.sequence_number);
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]).toBeGreaterThan(seqs[i - 1]);
    }
    // Final completed event carries the assembled output snapshot.
    const last = events[events.length - 1] as {
      type: string;
      response: { output: Array<{ type: string }>; output_text: string };
    };
    expect(last.response.output).toHaveLength(1);
    expect(last.response.output[0].type).toBe('message');
    expect(last.response.output_text).toBe('hello');
  });

  it('uses the real function name on the closing function_call events', async () => {
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
      streamGeminiToResponses(fromArray(chunks), 'gemini-2.5-flash', baseReq())
    );
    const argsDone = events.find(
      (e) => e.type === 'response.function_call_arguments.done'
    ) as { name?: string; arguments?: string } | undefined;
    expect(argsDone?.name).toBe('lookup_weather');
    expect(argsDone?.arguments).toBe('{"city":"Tokyo"}');
    const fnDone = events.find(
      (e) =>
        e.type === 'response.output_item.done' &&
        (e as { item?: { type?: string } }).item?.type === 'function_call'
    ) as { item?: { name?: string; call_id?: string } } | undefined;
    expect(fnDone?.item?.name).toBe('lookup_weather');
    expect(fnDone?.item?.call_id).toBe('call_a');
  });

  it('emits the canonical reasoning summary event sequence for thought parts', async () => {
    const chunks: GenerateContentResponse[] = [
      {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [{ text: 'think', thought: true }],
            },
          },
        ],
      } as unknown as GenerateContentResponse,
      {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [
                { text: 'ing more', thought: true, thoughtSignature: 'sig-1' },
              ],
            },
          },
        ],
      } as unknown as GenerateContentResponse,
      {
        candidates: [
          {
            content: { role: 'model', parts: [{ text: 'answer' }] },
            finishReason: GeminiFinishReason.STOP,
          },
        ],
        usageMetadata: {},
      } as unknown as GenerateContentResponse,
    ];
    const events = await collect(
      streamGeminiToResponses(fromArray(chunks), 'gemini-2.5-flash', baseReq())
    );

    // The reasoning lifecycle events must appear in order and before
    // the text message events.
    const reasoningEvents = events.filter(
      (e) =>
        e.type.startsWith('response.reasoning_summary_') ||
        (e.type === 'response.output_item.added' &&
          (e as { item?: { type?: string } }).item?.type === 'reasoning') ||
        (e.type === 'response.output_item.done' &&
          (e as { item?: { type?: string } }).item?.type === 'reasoning')
    );
    expect(reasoningEvents.map((e) => e.type)).toEqual([
      'response.output_item.added',
      'response.reasoning_summary_part.added',
      'response.reasoning_summary_text.delta',
      'response.reasoning_summary_text.delta',
      'response.reasoning_summary_text.done',
      'response.reasoning_summary_part.done',
      'response.output_item.done',
    ]);

    const deltas = reasoningEvents.filter(
      (e) => e.type === 'response.reasoning_summary_text.delta'
    ) as Array<{ delta: string; summary_index: number }>;
    expect(deltas.map((d) => d.delta)).toEqual(['think', 'ing more']);
    expect(deltas.every((d) => d.summary_index === 0)).toBe(true);

    const textDone = reasoningEvents.find(
      (e) => e.type === 'response.reasoning_summary_text.done'
    ) as { text: string };
    expect(textDone.text).toBe('thinking more');

    const reasoningDone = reasoningEvents[reasoningEvents.length - 1] as {
      item?: {
        type?: string;
        encrypted_content?: string;
        status?: string;
        summary?: Array<{ text: string }>;
      };
    };
    expect(reasoningDone.item?.type).toBe('reasoning');
    expect(reasoningDone.item?.encrypted_content).toBe('sig-1');
    expect(reasoningDone.item?.status).toBe('completed');
    expect(reasoningDone.item?.summary?.[0]?.text).toBe('thinking more');

    // Sequence numbers across the entire stream are strictly monotonic.
    const seqs = events.map((e) => e.sequence_number);
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]).toBeGreaterThan(seqs[i - 1]);
    }

    // The completed snapshot carries the reasoning item before the
    // message item.
    const completed = events[events.length - 1] as {
      response: { output: Array<{ type: string }> };
    };
    expect(completed.response.output[0].type).toBe('reasoning');
    expect(completed.response.output[1].type).toBe('message');
  });

  it('emits url_citation annotation events and bundles them on the closing text_done', async () => {
    const chunks: GenerateContentResponse[] = [
      {
        candidates: [
          {
            content: { role: 'model', parts: [{ text: 'Paris' }] },
          },
        ],
      } as unknown as GenerateContentResponse,
      {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [{ text: ' is in France.' }],
            },
            // Gemini repeats the full groundingMetadata payload on
            // each chunk; the converter must dedupe so a citation
            // does not fire twice.
            groundingMetadata: {
              groundingChunks: [
                {
                  web: { uri: 'https://example.org/a', title: 'A' },
                },
              ],
              groundingSupports: [
                {
                  segment: { startIndex: 0, endIndex: 19 },
                  groundingChunkIndices: [0],
                },
              ],
            },
          },
        ],
      } as unknown as GenerateContentResponse,
      {
        candidates: [
          {
            content: { role: 'model', parts: [] },
            finishReason: GeminiFinishReason.STOP,
            groundingMetadata: {
              groundingChunks: [
                {
                  web: { uri: 'https://example.org/a', title: 'A' },
                },
              ],
              groundingSupports: [
                {
                  segment: { startIndex: 0, endIndex: 19 },
                  groundingChunkIndices: [0],
                },
              ],
            },
          },
        ],
        usageMetadata: {},
      } as unknown as GenerateContentResponse,
    ];
    const events = await collect(
      streamGeminiToResponses(fromArray(chunks), 'gemini-2.5-flash', baseReq())
    );

    const annotationEvents = events.filter(
      (e) => e.type === 'response.output_text.annotation.added'
    ) as Array<{
      annotation_index: number;
      content_index: number;
      output_index: number;
      annotation: { type: string; url: string };
      item_id: string;
    }>;
    expect(annotationEvents).toHaveLength(1);
    expect(annotationEvents[0].annotation).toEqual({
      type: 'url_citation',
      url: 'https://example.org/a',
      title: 'A',
      start_index: 0,
      end_index: 19,
    });
    expect(annotationEvents[0].annotation_index).toBe(0);
    expect(annotationEvents[0].content_index).toBe(0);

    // The annotation event must reference the message item that
    // received the text deltas.
    const partAdded = events.find(
      (e) => e.type === 'response.content_part.added'
    ) as { item_id: string; output_index: number };
    expect(annotationEvents[0].item_id).toBe(partAdded.item_id);
    expect(annotationEvents[0].output_index).toBe(partAdded.output_index);

    // The annotation must also arrive between text deltas (or at
    // worst, between the second delta and the closing text_done).
    const annotationIdx = events.findIndex(
      (e) => e.type === 'response.output_text.annotation.added'
    );
    const textDoneIdx = events.findIndex(
      (e) => e.type === 'response.output_text.done'
    );
    expect(annotationIdx).toBeGreaterThan(-1);
    expect(annotationIdx).toBeLessThan(textDoneIdx);

    const partDone = events.find(
      (e) => e.type === 'response.content_part.done'
    ) as {
      part: { annotations: Array<{ url: string }> };
    };
    expect(partDone.part.annotations).toHaveLength(1);
    expect(partDone.part.annotations[0].url).toBe('https://example.org/a');

    const completed = events[events.length - 1] as {
      response: {
        output: Array<{
          type: string;
          content?: Array<{ annotations?: Array<{ url: string }> }>;
        }>;
      };
    };
    const finalMessage = completed.response.output.find(
      (o) => o.type === 'message'
    );
    expect(finalMessage?.content?.[0]?.annotations).toHaveLength(1);
    expect(finalMessage?.content?.[0]?.annotations?.[0].url).toBe(
      'https://example.org/a'
    );
  });

  it('surfaces grounding_metadata + vertex_ai_grounding_metadata on the response.completed event', async () => {
    // Streaming parity with the non-stream converter — the
    // accumulator captures `groundingMetadata` from the last chunk
    // that carried it, and the closing `response.completed` event's
    // `response` object must expose it under both extension keys so
    // direct API consumers can render Gemini-native provenance
    // alongside the OpenAI-shape `url_citation` annotations.
    const grounding = {
      groundingChunks: [{ web: { uri: 'https://e.test', title: 'E' } }],
      webSearchQueries: ['biden age'],
    };
    const chunks: GenerateContentResponse[] = [
      {
        candidates: [{ content: { role: 'model', parts: [{ text: 'tok' }] } }],
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
      streamGeminiToResponses(fromArray(chunks), 'gemini-2.5-flash', baseReq())
    );
    const completed = events[events.length - 1] as {
      type: string;
      response: {
        grounding_metadata?: unknown;
        vertex_ai_grounding_metadata?: unknown;
      };
    };
    expect(completed.type).toBe('response.completed');
    expect(completed.response.grounding_metadata).toEqual(grounding);
    expect(completed.response.vertex_ai_grounding_metadata).toEqual(grounding);
  });

  it('maps MAX_TOKENS at stream end to status=incomplete + max_output_tokens', async () => {
    const chunks: GenerateContentResponse[] = [
      {
        candidates: [
          {
            content: { role: 'model', parts: [{ text: 'partial' }] },
            finishReason: GeminiFinishReason.MAX_TOKENS,
          },
        ],
        usageMetadata: {},
      } as unknown as GenerateContentResponse,
    ];
    const events = await collect(
      streamGeminiToResponses(fromArray(chunks), 'gemini-2.5-flash', baseReq())
    );
    const completed = events[events.length - 1] as {
      type: string;
      response: {
        status: string;
        incomplete_details: { reason: string } | null;
      };
    };
    expect(completed.type).toBe('response.completed');
    expect(completed.response.status).toBe('incomplete');
    expect(completed.response.incomplete_details).toEqual({
      reason: 'max_output_tokens',
    });
  });
});
