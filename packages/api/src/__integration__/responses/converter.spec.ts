import { describe, it, expect } from 'vitest';
import type {
  ChatCompletion,
  ChatCompletionChunk,
} from 'openai/resources/index.js';
import type { ResponseStreamEvent } from 'openai/resources/responses/responses';
import {
  chatCompletionStreamToResponseStream,
  chatCompletionToResponse,
  responsesRequestToChatCompletion,
} from '../../gateway/responses/responses-converter';

/**
 * Converter unit tests — no API keys required, runs unconditionally.
 *
 * These guard the Responses-API endpoint against silent regressions in the
 * event shape that multi-turn agent loops depend on.
 */
describe('responses-converter / request → chat completion', () => {
  it('maps a string input to a single user message', () => {
    const out = responsesRequestToChatCompletion({
      model: 'default',
      input: 'hello',
    });
    expect(out.messages).toHaveLength(1);
    expect(out.messages[0]).toMatchObject({ role: 'user', content: 'hello' });
  });

  it('prepends instructions as a system message', () => {
    const out = responsesRequestToChatCompletion({
      model: 'default',
      input: 'hi',
      instructions: 'You are terse.',
    });
    expect(out.messages[0]).toMatchObject({
      role: 'system',
      content: 'You are terse.',
    });
    expect(out.messages[1]).toMatchObject({ role: 'user', content: 'hi' });
  });

  it('handles function_call + function_call_output input items', () => {
    const out = responsesRequestToChatCompletion({
      model: 'default',
      input: [
        { type: 'message', role: 'user', content: 'weather in Tokyo?' },
        {
          type: 'function_call',
          call_id: 'call_1',
          name: 'get_weather',
          arguments: '{"city":"Tokyo"}',
        },
        {
          type: 'function_call_output',
          call_id: 'call_1',
          output: '15°C cloudy',
        },
      ] as never,
    });

    // Expect: user message, assistant with tool_calls, tool message
    expect(out.messages[0]).toMatchObject({ role: 'user' });
    expect(out.messages[1]).toMatchObject({
      role: 'assistant',
      tool_calls: [
        {
          id: 'call_1',
          type: 'function',
          function: { name: 'get_weather' },
        },
      ],
    });
    expect(out.messages[2]).toMatchObject({
      role: 'tool',
      tool_call_id: 'call_1',
      content: '15°C cloudy',
    });
  });

  it('maps text.format json_schema to response_format', () => {
    const out = responsesRequestToChatCompletion({
      model: 'default',
      input: 'hi',
      text: {
        format: {
          type: 'json_schema',
          name: 'AnswerSchema',
          schema: { type: 'object' },
        },
        // class-validator's IsObject is loose here
      } as unknown as Parameters<
        typeof responsesRequestToChatCompletion
      >[0]['text'],
    });
    expect(out.response_format).toMatchObject({
      type: 'json_schema',
      json_schema: { name: 'AnswerSchema' },
    });
  });

  it('maps reasoning.effort onto reasoning_effort', () => {
    const out = responsesRequestToChatCompletion({
      model: 'default',
      input: 'hi',
      reasoning: { effort: 'high' },
    });
    expect((out as { reasoning_effort?: string }).reasoning_effort).toBe(
      'high'
    );
  });

  it('maps function tools', () => {
    const out = responsesRequestToChatCompletion({
      model: 'default',
      input: 'hi',
      tools: [
        {
          type: 'function',
          name: 'get_weather',
          description: 'Get the weather',
          parameters: { type: 'object' },
          strict: null,
        },
      ] as unknown as Parameters<
        typeof responsesRequestToChatCompletion
      >[0]['tools'],
    });
    expect(out.tools).toHaveLength(1);
    expect(out.tools![0]).toMatchObject({
      type: 'function',
      function: { name: 'get_weather' },
    });
  });

  it('raises 400 on non-function tool types instead of silently dropping', () => {
    // Server-side Responses-API tools (web_search_preview, file_search,
    // computer_use_preview, mcp, etc.) have no Chat Completions
    // equivalent. Surfacing a 400 is more useful than silently dropping
    // — the model would otherwise be unable to invoke the tool with no
    // signal back to the client.
    expect(() =>
      responsesRequestToChatCompletion({
        model: 'default',
        input: 'hi',
        tools: [
          {
            type: 'web_search_preview',
          },
        ] as unknown as Parameters<
          typeof responsesRequestToChatCompletion
        >[0]['tools'],
      })
    ).toThrow(/web_search_preview/);
  });
});

describe('responses-converter / chat completion → response', () => {
  it('converts assistant text into a message output item', () => {
    const chat: ChatCompletion = {
      id: 'cc_1',
      object: 'chat.completion',
      created: 1700000000,
      model: 'gpt-4o-mini',
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          logprobs: null,
          message: {
            role: 'assistant',
            content: 'pong',
            refusal: null,
          },
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 1,
        total_tokens: 11,
        prompt_tokens_details: { cached_tokens: 0 },
        completion_tokens_details: { reasoning_tokens: 0 },
      } as ChatCompletion['usage'],
    };

    const r = chatCompletionToResponse(
      chat,
      'resp_1',
      1700000000,
      'gpt-4o-mini'
    );
    expect(r.id).toBe('resp_1');
    expect(r.status).toBe('completed');
    expect(r.output).toHaveLength(1);
    expect(r.output[0].type).toBe('message');
    expect(r.usage?.input_tokens).toBe(10);
    expect(r.usage?.output_tokens).toBe(1);
  });

  it('converts tool calls into function_call output items', () => {
    const chat: ChatCompletion = {
      id: 'cc_2',
      object: 'chat.completion',
      created: 1700000000,
      model: 'gpt-4o-mini',
      choices: [
        {
          index: 0,
          finish_reason: 'tool_calls',
          logprobs: null,
          message: {
            role: 'assistant',
            content: '',
            refusal: null,
            tool_calls: [
              {
                id: 'call_xyz',
                type: 'function',
                function: {
                  name: 'get_weather',
                  arguments: '{"city":"Tokyo"}',
                },
              },
            ],
          },
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
      } as ChatCompletion['usage'],
    };

    const r = chatCompletionToResponse(
      chat,
      'resp_2',
      1700000000,
      'gpt-4o-mini'
    );
    expect(r.output.some((i) => i.type === 'function_call')).toBe(true);
    const fc = r.output.find((i) => i.type === 'function_call') as {
      type: 'function_call';
      call_id: string;
      name: string;
      arguments: string;
    };
    expect(fc.call_id).toBe('call_xyz');
    expect(fc.name).toBe('get_weather');
    expect(JSON.parse(fc.arguments)).toEqual({ city: 'Tokyo' });
  });
});

describe('responses-converter / chat completion stream → response stream', () => {
  async function* synthStream(
    chunks: ChatCompletionChunk[]
  ): AsyncIterable<ChatCompletionChunk> {
    for (const c of chunks) yield c;
  }

  function makeTextChunk(text: string): ChatCompletionChunk {
    return {
      id: 'cc_stream',
      object: 'chat.completion.chunk',
      created: 1700000000,
      model: 'gpt-4o-mini',
      choices: [
        {
          index: 0,
          delta: { role: 'assistant', content: text },
          finish_reason: null,
        },
      ],
    };
  }

  function makeFinalChunk(): ChatCompletionChunk {
    return {
      id: 'cc_stream',
      object: 'chat.completion.chunk',
      created: 1700000000,
      model: 'gpt-4o-mini',
      choices: [
        {
          index: 0,
          delta: {},
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: 5,
        completion_tokens: 2,
        total_tokens: 7,
      } as ChatCompletionChunk['usage'],
    };
  }

  it('emits the canonical text-streaming events that agent loops switch on', async () => {
    const events: ResponseStreamEvent[] = [];
    for await (const ev of chatCompletionStreamToResponseStream(
      synthStream([
        makeTextChunk('Hello'),
        makeTextChunk(' world'),
        makeFinalChunk(),
      ]),
      'resp_stream',
      1700000000,
      'gpt-4o-mini'
    )) {
      events.push(ev);
    }
    const types = events.map((e) => (e as { type?: string }).type);
    expect(types).toContain('response.created');
    expect(types).toContain('response.in_progress');
    expect(types).toContain('response.output_item.added');
    expect(types).toContain('response.content_part.added');
    expect(types).toContain('response.output_text.delta');
    expect(types).toContain('response.output_text.done');
    expect(types).toContain('response.content_part.done');
    expect(types).toContain('response.output_item.done');
    expect(types).toContain('response.completed');

    // Deltas should reconstruct the full text.
    const deltas = events.filter(
      (e) => (e as { type?: string }).type === 'response.output_text.delta'
    );
    const reconstructed = deltas
      .map((d) => (d as { delta?: string }).delta ?? '')
      .join('');
    expect(reconstructed).toBe('Hello world');

    // The completed event should carry usage with input/output_tokens.
    const completed = events.find(
      (e) => (e as { type?: string }).type === 'response.completed'
    ) as {
      response: { usage: { input_tokens: number; output_tokens: number } };
    };
    expect(completed.response.usage.input_tokens).toBe(5);
    expect(completed.response.usage.output_tokens).toBe(2);
  });

  it('emits function_call_arguments deltas for tool-call streams', async () => {
    const toolStartChunk: ChatCompletionChunk = {
      id: 'cc_tool',
      object: 'chat.completion.chunk',
      created: 1700000000,
      model: 'gpt-4o-mini',
      choices: [
        {
          index: 0,
          delta: {
            role: 'assistant',
            tool_calls: [
              {
                index: 0,
                id: 'call_1',
                type: 'function',
                function: { name: 'get_weather', arguments: '' },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    };
    const toolArgChunk: ChatCompletionChunk = {
      id: 'cc_tool',
      object: 'chat.completion.chunk',
      created: 1700000000,
      model: 'gpt-4o-mini',
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                function: { arguments: '{"city":"Tokyo"}' },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    };
    const finalChunk: ChatCompletionChunk = {
      id: 'cc_tool',
      object: 'chat.completion.chunk',
      created: 1700000000,
      model: 'gpt-4o-mini',
      choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
      usage: {
        prompt_tokens: 8,
        completion_tokens: 6,
        total_tokens: 14,
      } as ChatCompletionChunk['usage'],
    };

    const events: ResponseStreamEvent[] = [];
    for await (const ev of chatCompletionStreamToResponseStream(
      synthStream([toolStartChunk, toolArgChunk, finalChunk]),
      'resp_tool',
      1700000000,
      'gpt-4o-mini'
    )) {
      events.push(ev);
    }
    const types = events.map((e) => (e as { type?: string }).type);
    expect(types).toContain('response.function_call_arguments.delta');
    expect(types).toContain('response.function_call_arguments.done');
    expect(types).toContain('response.completed');
  });
});
