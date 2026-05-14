import { describe, expect, it } from 'vitest';
import {
  openAIRequestToGemini,
  geminiResponseToOpenAIChat,
} from './openai-chat-completion.provider';
import {
  FunctionCallingConfigMode,
  FinishReason as GeminiFinishReason,
  type GenerateContentResponse,
} from '@google/genai';

/**
 * Converter-level tests for the new Gemini-native chat-completion
 * provider. Class-level dispatch is exercised end-to-end by the live
 * `__integration__/providers/gemini.spec.ts` (skipped without
 * `GEMINI_API_KEY`); these specs pin the pure request/response
 * mapping in both directions.
 */

describe('openAIRequestToGemini', () => {
  it('lifts string `system` and `developer` content into systemInstruction', () => {
    const out = openAIRequestToGemini({
      model: 'gemini-2.5-flash',
      messages: [
        { role: 'system', content: 'You are helpful.' },
        { role: 'developer', content: 'Be terse.' },
        { role: 'user', content: 'hi' },
      ],
    });
    expect(out.config?.systemInstruction).toEqual({
      role: 'user',
      parts: [{ text: 'You are helpful.\n\nBe terse.' }],
    });
    expect(out.contents).toEqual([{ role: 'user', parts: [{ text: 'hi' }] }]);
  });

  it('maps image_url data URLs onto inlineData parts', () => {
    const out = openAIRequestToGemini({
      model: 'gemini-2.5-flash',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'describe' },
            {
              type: 'image_url',
              image_url: { url: 'data:image/png;base64,AAAA' },
            },
          ],
        },
      ],
    });
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

  it('coalesces consecutive tool responses into a single user turn', () => {
    const out = openAIRequestToGemini({
      model: 'gemini-2.5-flash',
      messages: [
        { role: 'user', content: 'q' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_a',
              type: 'function',
              function: { name: 'a', arguments: '{}' },
            },
            {
              id: 'call_b',
              type: 'function',
              function: { name: 'b', arguments: '{}' },
            },
          ],
        },
        { role: 'tool', tool_call_id: 'call_a', content: 'r1' },
        { role: 'tool', tool_call_id: 'call_b', content: 'r2' },
      ],
    });
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

  it('resolves functionResponse.name from prior assistant tool_calls (not tool_call_id)', () => {
    // Gemini correlates `functionResponse.name` against the prior
    // `functionCall.name`. Using `tool_call_id` (the OpenAI handle)
    // breaks the round-trip — the model can't match the response back
    // to the call.
    const out = openAIRequestToGemini({
      model: 'gemini-2.5-flash',
      messages: [
        { role: 'user', content: 'q' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_xyz',
              type: 'function',
              function: { name: 'lookup_weather', arguments: '{}' },
            },
          ],
        },
        { role: 'tool', tool_call_id: 'call_xyz', content: '72F' },
      ],
    });
    const contents = out.contents as Array<{
      role?: string;
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

  it('falls back to tool_call_id when no prior assistant turn declares the tool', () => {
    // Defensive: a malformed conversation with a tool message but no
    // matching tool_call should not crash; just pass the id through as
    // the name so the upstream returns a sensible error.
    const out = openAIRequestToGemini({
      model: 'gemini-2.5-flash',
      messages: [{ role: 'tool', tool_call_id: 'orphan', content: 'x' }],
    });
    const contents = out.contents as Array<{
      parts?: Array<{ functionResponse?: { name?: string } }>;
    }>;
    expect(
      contents.flatMap((c) => c.parts ?? [])[0]?.functionResponse?.name
    ).toBe('orphan');
  });

  it('replays reasoning blocks from prior assistant turns as thought parts', () => {
    const out = openAIRequestToGemini({
      model: 'gemini-2.5-flash',
      messages: [
        { role: 'user', content: 'q' },
        {
          role: 'assistant',
          content: 'final',
          reasoning: { thinking: 'thinking text', signature: 'sig1' },
        } as never,
      ],
    });
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

  it('lifts input_audio data URL into inlineData with the correct mime type', () => {
    const out = openAIRequestToGemini({
      model: 'gemini-2.5-flash',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'input_audio',
              input_audio: { data: 'AAAA', format: 'wav' },
            },
          ],
        } as never,
      ],
    });
    const parts = (
      out.contents as Array<{
        parts?: Array<{
          inlineData?: { mimeType?: string; data?: string };
        }>;
      }>
    )[0].parts;
    expect(parts?.[0].inlineData).toEqual({
      mimeType: 'audio/wav',
      data: 'AAAA',
    });
  });

  it('maps stop sequences and filters empty strings', () => {
    const out = openAIRequestToGemini({
      model: 'gemini-2.5-flash',
      messages: [{ role: 'user', content: 'q' }],
      stop: ['END', '', 'STOP'],
    });
    expect(out.config?.stopSequences).toEqual(['END', 'STOP']);
  });

  it('forwards frequency_penalty, presence_penalty, seed when set', () => {
    const out = openAIRequestToGemini({
      model: 'gemini-2.5-flash',
      messages: [{ role: 'user', content: 'q' }],
      frequency_penalty: 0.3,
      presence_penalty: 0.4,
      seed: 42,
    });
    expect(out.config?.frequencyPenalty).toBe(0.3);
    expect(out.config?.presencePenalty).toBe(0.4);
    expect(out.config?.seed).toBe(42);
  });

  it('forwards logprobs flag and top_logprobs count', () => {
    const out = openAIRequestToGemini({
      model: 'gemini-2.5-flash',
      messages: [{ role: 'user', content: 'q' }],
      logprobs: true,
      top_logprobs: 5,
    });
    expect(out.config?.responseLogprobs).toBe(true);
    expect(out.config?.logprobs).toBe(5);
  });

  it('strips the __vmx_passthrough envelope from the converted request', () => {
    const out = openAIRequestToGemini({
      model: 'gemini-2.5-flash',
      messages: [{ role: 'user', content: 'q' }],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      __vmx_passthrough: { anthropic: { top_k: 50 } } as any,
    } as never);
    expect(
      (out as unknown as Record<string, unknown>).__vmx_passthrough
    ).toBeUndefined();
  });

  it('translates function tools into functionDeclarations with JSON Schema parameters', () => {
    const out = openAIRequestToGemini({
      model: 'gemini-2.5-flash',
      messages: [{ role: 'user', content: 'q' }],
      tools: [
        {
          type: 'function',
          function: {
            name: 'lookup',
            description: 'd',
            parameters: { type: 'object', properties: {} },
          },
        },
      ],
    });
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

  it('forwards native Gemini tool descriptors (googleSearch, urlContext) verbatim', () => {
    const out = openAIRequestToGemini({
      model: 'gemini-2.5-flash',
      messages: [{ role: 'user', content: 'q' }],
      tools: [{ googleSearch: {} } as never, { urlContext: {} } as never],
    });
    expect(out.config?.tools).toEqual([
      { googleSearch: {} },
      { urlContext: {} },
    ]);
  });

  it('injects googleSearch when web_search_options is set', () => {
    const out = openAIRequestToGemini({
      model: 'gemini-2.5-flash',
      messages: [{ role: 'user', content: 'q' }],
      web_search_options: {},
    });
    expect(out.config?.tools).toEqual([{ googleSearch: {} }]);
  });

  it('maps reasoning_effort=high into a thinkingConfig with budget', () => {
    const out = openAIRequestToGemini({
      model: 'gemini-2.5-flash',
      messages: [{ role: 'user', content: 'q' }],
      reasoning_effort: 'high',
      max_completion_tokens: 8192,
    });
    expect(out.config?.thinkingConfig?.includeThoughts).toBe(true);
    expect(out.config?.thinkingConfig?.thinkingBudget).toBeGreaterThan(0);
  });

  it('translates response_format json_schema into responseMimeType + responseJsonSchema', () => {
    const out = openAIRequestToGemini({
      model: 'gemini-2.5-flash',
      messages: [{ role: 'user', content: 'q' }],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'Reply',
          schema: { type: 'object' },
        },
      },
    });
    expect(out.config?.responseMimeType).toBe('application/json');
    expect(out.config?.responseJsonSchema).toEqual({ type: 'object' });
  });

  it('maps tool_choice=required to functionCallingConfig ANY', () => {
    const out = openAIRequestToGemini({
      model: 'gemini-2.5-flash',
      messages: [{ role: 'user', content: 'q' }],
      tools: [
        {
          type: 'function',
          function: { name: 'noop', parameters: { type: 'object' } },
        },
      ],
      tool_choice: 'required',
    });
    expect(out.config?.toolConfig?.functionCallingConfig?.mode).toBe(
      FunctionCallingConfigMode.ANY
    );
  });
});

describe('geminiResponseToOpenAIChat', () => {
  it('maps text + functionCall + thought parts into a ChatCompletion choice', () => {
    const response = {
      responseId: 'resp_1',
      candidates: [
        {
          content: {
            role: 'model',
            parts: [
              { text: 'hello', thought: false },
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
          groundingMetadata: { webSearchQueries: ['q'] },
        },
      ],
      usageMetadata: {
        promptTokenCount: 10,
        responseTokenCount: 5,
        thoughtsTokenCount: 3,
        totalTokenCount: 18,
      },
    } as unknown as GenerateContentResponse;
    const completion = geminiResponseToOpenAIChat(response, 'gemini-2.5-flash');
    expect(completion.id).toBe('resp_1');
    expect(completion.choices[0].message.content).toBe('hello');
    expect(completion.choices[0].message.tool_calls).toHaveLength(1);
    expect(
      (
        completion.choices[0].message.tool_calls?.[0] as {
          function?: { name?: string };
        }
      )?.function?.name
    ).toBe('lookup');
    expect(completion.choices[0].finish_reason).toBe('tool_calls');
    expect(
      (
        completion.choices[0].message as unknown as {
          reasoning?: { thinking?: string; signature?: string };
        }
      ).reasoning
    ).toMatchObject({ thinking: 'reasoning', signature: 'sig' });
    expect(
      (completion as unknown as { vertex_ai_grounding_metadata?: unknown })
        .vertex_ai_grounding_metadata
    ).toEqual({ webSearchQueries: ['q'] });
    expect(completion.usage?.prompt_tokens).toBe(10);
    // `completion_tokens` rolls up visible response + thinking (OpenAI
    // semantics); the thinking subset is also reported under
    // `completion_tokens_details.reasoning_tokens`.
    expect(completion.usage?.completion_tokens).toBe(8);
  });

  it('maps SAFETY finish reason to content_filter + refusal', () => {
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
    const completion = geminiResponseToOpenAIChat(response, 'gemini-2.5-flash');
    expect(completion.choices[0].finish_reason).toBe('content_filter');
    expect(completion.choices[0].message.refusal).toBe(
      'blocked by safety policy'
    );
  });

  it('surfaces a prompt-level block (no candidate) as content_filter', () => {
    // Gemini reports input-side safety blocks via `promptFeedback.blockReason`
    // and ships *no candidate*. The candidate-only mapper would default to
    // `stop`; the provider promotes the top-level prompt feedback to
    // `content_filter` so OpenAI clients can route to their refusal path.
    const response = {
      promptFeedback: {
        blockReason: 'SAFETY',
        blockReasonMessage: 'prompt rejected',
      },
      usageMetadata: { promptTokenCount: 12 },
    } as unknown as GenerateContentResponse;
    const completion = geminiResponseToOpenAIChat(response, 'gemini-2.5-flash');
    expect(completion.choices[0].finish_reason).toBe('content_filter');
    expect(completion.choices[0].message.refusal).toBe('prompt rejected');
  });

  it('rolls thoughtsTokenCount into completion_tokens (OpenAI semantics)', () => {
    // OpenAI's `completion_tokens` is the full visible+invisible output
    // tally. Reasoning tokens are then surfaced under
    // `completion_tokens_details.reasoning_tokens` — they should still be
    // counted in `completion_tokens`.
    const response = {
      candidates: [
        {
          content: { parts: [{ text: 'hi' }] },
          finishReason: GeminiFinishReason.STOP,
        },
      ],
      usageMetadata: {
        promptTokenCount: 4,
        responseTokenCount: 2,
        thoughtsTokenCount: 7,
        totalTokenCount: 13,
      },
    } as unknown as GenerateContentResponse;
    const completion = geminiResponseToOpenAIChat(response, 'gemini-2.5-flash');
    expect(completion.usage?.prompt_tokens).toBe(4);
    expect(completion.usage?.completion_tokens).toBe(9);
    expect(completion.usage?.completion_tokens_details?.reasoning_tokens).toBe(
      7
    );
  });
});

describe('openAIRequestToGemini (assistant refusal)', () => {
  it('lifts a top-level assistant refusal string into a text part', () => {
    const out = openAIRequestToGemini({
      model: 'gemini-2.5-flash',
      messages: [
        { role: 'user', content: 'q' },
        {
          role: 'assistant',
          content: null,
          refusal: 'I cannot help with that.',
        },
      ],
    });
    const contents = out.contents as Array<{
      role?: string;
      parts?: Array<{ text?: string }>;
    }>;
    const modelTurn = contents.find((c) => c.role === 'model');
    expect(modelTurn?.parts?.[0].text).toBe('I cannot help with that.');
  });

  it('lifts a refusal content-part on the assistant array into a text part', () => {
    const out = openAIRequestToGemini({
      model: 'gemini-2.5-flash',
      messages: [
        { role: 'user', content: 'q' },
        {
          role: 'assistant',
          content: [
            { type: 'refusal', refusal: 'declined' } as never,
            { type: 'text', text: 'sorry' },
          ],
        },
      ],
    });
    const contents = out.contents as Array<{
      role?: string;
      parts?: Array<{ text?: string }>;
    }>;
    const modelTurn = contents.find((c) => c.role === 'model');
    expect(modelTurn?.parts?.map((p) => p.text)).toEqual(['declined', 'sorry']);
  });
});
