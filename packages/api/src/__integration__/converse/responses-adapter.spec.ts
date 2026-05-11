import { describe, expect, it } from 'vitest';
import {
  ConverseCommandOutput,
  ConverseStreamOutput,
  StopReason,
} from '@aws-sdk/client-bedrock-runtime';
import type {
  ResponseCreateParams,
  ResponseStreamEvent,
} from 'openai/resources/responses/responses.js';
import {
  requestResponsesToConverse,
  responseConverseToResponses,
  streamConverseToResponses,
} from '../../ai-provider/aws-bedrock-converse/openai-response.provider';

/**
 * Adapter unit tests for the direct Responses ↔ Converse converter
 * (canonical owner: `aws-bedrock-converse/openai-response.provider.ts`).
 */

describe('Responses → Converse request adapter', () => {
  it('maps a simple string `input` to a user message with text block', () => {
    const out = requestResponsesToConverse(
      {
        model: 'claude',
        input: 'hello',
        max_output_tokens: 64,
      } as ResponseCreateParams,
      'us.anthropic.claude-haiku-4-5'
    );
    expect(out.modelId).toBe('us.anthropic.claude-haiku-4-5');
    expect(out.inferenceConfig?.maxTokens).toBe(64);
    expect(out.messages).toEqual([
      { role: 'user', content: [{ text: 'hello' }] },
    ]);
  });

  it('maps `instructions` to system blocks', () => {
    const out = requestResponsesToConverse(
      {
        model: 'm',
        input: 'pong',
        instructions: 'be brief',
      } as ResponseCreateParams,
      'm'
    );
    expect(out.system).toEqual([{ text: 'be brief' }]);
  });

  it('maps function_call + function_call_output items to toolUse / toolResult blocks', () => {
    const out = requestResponsesToConverse(
      {
        model: 'm',
        input: [
          {
            role: 'user',
            content: [{ type: 'input_text', text: 'weather?' }],
          },
          {
            type: 'function_call',
            id: 'fc_1',
            call_id: 'call_1',
            name: 'get_weather',
            arguments: JSON.stringify({ location: 'Tokyo' }),
          },
          {
            type: 'function_call_output',
            call_id: 'call_1',
            output: '15 °C',
          },
        ] as never,
      } as ResponseCreateParams,
      'm'
    );

    expect(out.messages?.[1]).toMatchObject({
      role: 'assistant',
      content: [
        {
          toolUse: {
            toolUseId: 'call_1',
            name: 'get_weather',
            input: { location: 'Tokyo' },
          },
        },
      ],
    });
    expect(out.messages?.[2]).toMatchObject({
      role: 'user',
      content: [
        {
          toolResult: {
            toolUseId: 'call_1',
            content: [{ text: '15 °C' }],
            status: 'success',
          },
        },
      ],
    });
  });

  it('maps Responses function tools to Converse toolSpec', () => {
    const out = requestResponsesToConverse(
      {
        model: 'm',
        input: 'pong',
        tools: [
          {
            type: 'function',
            name: 'get_weather',
            description: 'Weather lookup',
            parameters: {
              type: 'object',
              properties: { location: { type: 'string' } },
              required: ['location'],
            },
          },
        ] as never,
      } as ResponseCreateParams,
      'm'
    );
    expect(out.toolConfig?.tools?.[0]).toMatchObject({
      toolSpec: {
        name: 'get_weather',
        description: 'Weather lookup',
        inputSchema: { json: expect.objectContaining({ type: 'object' }) },
      },
    });
  });

  it('maps tool_choice variants', () => {
    const auto = requestResponsesToConverse(
      {
        model: 'm',
        input: 'x',
        tool_choice: 'auto',
        tools: [{ type: 'function', name: 't', parameters: {} }] as never,
      } as ResponseCreateParams,
      'm'
    );
    expect(auto.toolConfig?.toolChoice).toMatchObject({ auto: {} });

    const required = requestResponsesToConverse(
      {
        model: 'm',
        input: 'x',
        tool_choice: 'required',
        tools: [{ type: 'function', name: 't', parameters: {} }] as never,
      } as ResponseCreateParams,
      'm'
    );
    expect(required.toolConfig?.toolChoice).toMatchObject({ any: {} });

    const named = requestResponsesToConverse(
      {
        model: 'm',
        input: 'x',
        tool_choice: { type: 'function', name: 'pick_me' } as never,
        tools: [{ type: 'function', name: 'pick_me', parameters: {} }] as never,
      } as ResponseCreateParams,
      'm'
    );
    expect(named.toolConfig?.toolChoice).toMatchObject({
      tool: { name: 'pick_me' },
    });
  });

  it('maps reasoning.effort to thinking budget', () => {
    const out = requestResponsesToConverse(
      {
        model: 'm',
        input: 'pong',
        reasoning: { effort: 'high' },
      } as ResponseCreateParams,
      'm'
    );
    const thinking = (
      out.additionalModelRequestFields as
        | { thinking?: { type: string; budget_tokens: number } }
        | undefined
    )?.thinking;
    expect(thinking?.type).toBe('enabled');
    expect(thinking?.budget_tokens).toBeGreaterThan(0);
  });
});

describe('Converse → Responses response adapter', () => {
  it('maps text + toolUse content blocks to output items', () => {
    const resp: ConverseCommandOutput = {
      $metadata: { requestId: 'req_1', extendedRequestId: 'req_1' } as never,
      output: {
        message: {
          role: 'assistant',
          content: [
            { text: 'Result coming.' },
            {
              toolUse: {
                toolUseId: 'tu_1',
                name: 'get_weather',
                input: { location: 'Tokyo' },
              },
            },
          ],
        },
      },
      stopReason: StopReason.TOOL_USE,
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        cacheReadInputTokens: 0,
        cacheWriteInputTokens: 0,
      } as never,
      metrics: { latencyMs: 0 } as never,
    } as ConverseCommandOutput;

    const out = responseConverseToResponses(
      resp,
      'resp_1',
      1000,
      'claude-haiku-4-5'
    );
    expect(out.id).toBe('resp_1');
    expect(out.object).toBe('response');
    expect(out.status).toBe('completed');
    expect(out.output).toHaveLength(2);
    const fc = out.output.find((i) => i.type === 'function_call');
    expect(fc).toMatchObject({ name: 'get_weather' });
    expect(out.usage?.input_tokens).toBe(10);
    expect(out.usage?.output_tokens).toBe(5);
  });

  it('maps stopReason MAX_TOKENS to status incomplete', () => {
    const resp: ConverseCommandOutput = {
      $metadata: { requestId: 'r' } as never,
      output: { message: { role: 'assistant', content: [{ text: '...' }] } },
      stopReason: StopReason.MAX_TOKENS,
      usage: { inputTokens: 4, outputTokens: 100, totalTokens: 104 } as never,
      metrics: { latencyMs: 0 } as never,
    } as ConverseCommandOutput;
    const out = responseConverseToResponses(resp, 'r', 0, 'm');
    expect(out.status).toBe('incomplete');
  });
});

describe('Converse → Responses stream adapter', () => {
  async function* synth(events: ConverseStreamOutput[]) {
    for (const e of events) yield e;
  }

  it('emits response.created → output_text.delta → response.completed', async () => {
    const events: ConverseStreamOutput[] = [
      { messageStart: { role: 'assistant' } },
      {
        contentBlockDelta: {
          contentBlockIndex: 0,
          delta: { text: 'Hello' },
        },
      },
      {
        contentBlockDelta: {
          contentBlockIndex: 0,
          delta: { text: ' world' },
        },
      },
      { contentBlockStop: { contentBlockIndex: 0 } },
      { messageStop: { stopReason: StopReason.END_TURN } },
      {
        metadata: {
          usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 },
          metrics: { latencyMs: 0 } as never,
        },
      },
    ];

    const out: ResponseStreamEvent[] = [];
    for await (const e of streamConverseToResponses(
      synth(events),
      'resp_1',
      0,
      'm'
    )) {
      out.push(e);
    }

    const types = out.map((e) => (e as { type?: string }).type);
    expect(types).toContain('response.created');
    expect(types).toContain('response.in_progress');
    expect(types).toContain('response.output_item.added');
    expect(types).toContain('response.content_part.added');
    expect(types).toContain('response.output_text.delta');
    expect(types).toContain('response.output_text.done');
    expect(types).toContain('response.completed');

    const reconstructed = out
      .filter(
        (e) => (e as { type?: string }).type === 'response.output_text.delta'
      )
      .map((e) => (e as { delta?: string }).delta ?? '')
      .join('');
    expect(reconstructed).toBe('Hello world');

    const completed = out.find(
      (e) => (e as { type?: string }).type === 'response.completed'
    ) as {
      response: { usage: { input_tokens: number; output_tokens: number } };
    };
    expect(completed.response.usage.input_tokens).toBe(5);
    expect(completed.response.usage.output_tokens).toBe(2);
  });

  it('translates Converse toolUse stream events to function_call_arguments deltas', async () => {
    const events: ConverseStreamOutput[] = [
      { messageStart: { role: 'assistant' } },
      {
        contentBlockStart: {
          contentBlockIndex: 0,
          start: {
            toolUse: { toolUseId: 'tu_1', name: 'get_weather' },
          },
        },
      },
      {
        contentBlockDelta: {
          contentBlockIndex: 0,
          delta: { toolUse: { input: '{"location":' } },
        },
      },
      {
        contentBlockDelta: {
          contentBlockIndex: 0,
          delta: { toolUse: { input: '"Tokyo"}' } },
        },
      },
      { contentBlockStop: { contentBlockIndex: 0 } },
      { messageStop: { stopReason: StopReason.TOOL_USE } },
      {
        metadata: {
          usage: { inputTokens: 10, outputTokens: 6, totalTokens: 16 },
          metrics: { latencyMs: 0 } as never,
        },
      },
    ];

    const out: ResponseStreamEvent[] = [];
    for await (const e of streamConverseToResponses(
      synth(events),
      'r',
      0,
      'm'
    )) {
      out.push(e);
    }
    const types = out.map((e) => (e as { type?: string }).type);
    expect(types).toContain('response.function_call_arguments.delta');
    expect(types).toContain('response.function_call_arguments.done');
    expect(types).toContain('response.completed');

    const argsDeltas = out
      .filter(
        (e) =>
          (e as { type?: string }).type ===
          'response.function_call_arguments.delta'
      )
      .map((e) => (e as { delta?: string }).delta ?? '')
      .join('');
    expect(() => JSON.parse(argsDeltas)).not.toThrow();
    expect(JSON.parse(argsDeltas)).toEqual({ location: 'Tokyo' });
  });
});
