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
  it('maps a simple string `input` to a user message with text block', async () => {
    const out = await requestResponsesToConverse(
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

  it('maps `instructions` to system blocks', async () => {
    const out = await requestResponsesToConverse(
      {
        model: 'm',
        input: 'pong',
        instructions: 'be brief',
      } as ResponseCreateParams,
      'm'
    );
    expect(out.system).toEqual([{ text: 'be brief' }]);
  });

  it('maps function_call + function_call_output items to toolUse / toolResult blocks', async () => {
    const out = await requestResponsesToConverse(
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

  it('maps Responses function tools to Converse toolSpec', async () => {
    const out = await requestResponsesToConverse(
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

  it('maps tool_choice variants', async () => {
    const auto = await requestResponsesToConverse(
      {
        model: 'm',
        input: 'x',
        tool_choice: 'auto',
        tools: [{ type: 'function', name: 't', parameters: {} }] as never,
      } as ResponseCreateParams,
      'm'
    );
    expect(auto.toolConfig?.toolChoice).toMatchObject({ auto: {} });

    const required = await requestResponsesToConverse(
      {
        model: 'm',
        input: 'x',
        tool_choice: 'required',
        tools: [{ type: 'function', name: 't', parameters: {} }] as never,
      } as ResponseCreateParams,
      'm'
    );
    expect(required.toolConfig?.toolChoice).toMatchObject({ any: {} });

    const named = await requestResponsesToConverse(
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

  it('maps reasoning.effort to thinking budget', async () => {
    const out = await requestResponsesToConverse(
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

describe('Responses → Converse request adapter (audit fixes)', () => {
  it('H2: tool_choice.allowed_tools filters the emitted Converse tool list', async () => {
    const out = await requestResponsesToConverse(
      {
        model: 'm',
        input: 'pick one',
        tools: [
          { type: 'function', name: 'a', parameters: { type: 'object' } },
          { type: 'function', name: 'b', parameters: { type: 'object' } },
          { type: 'function', name: 'c', parameters: { type: 'object' } },
        ] as never,
        tool_choice: {
          type: 'allowed_tools',
          mode: 'auto',
          tools: [{ type: 'function', name: 'b' }],
        } as never,
      } as ResponseCreateParams,
      'm'
    );
    const names = (out.toolConfig?.tools ?? []).flatMap((t) =>
      (t as { toolSpec?: { name?: string } }).toolSpec?.name
        ? [(t as { toolSpec: { name: string } }).toolSpec.name]
        : []
    );
    expect(names).toEqual(['b']);
    // allowed_tools collapses to `auto` on the Converse side since
    // Converse has no native allowlist knob.
    expect(out.toolConfig?.toolChoice).toMatchObject({ auto: {} });
  });

  it('M2: zero-arg tool gets the canonical empty-object JSON schema', async () => {
    const out = await requestResponsesToConverse(
      {
        model: 'm',
        input: 'x',
        tools: [{ type: 'function', name: 't' }] as never,
      } as ResponseCreateParams,
      'm'
    );
    const tool = (out.toolConfig?.tools ?? [])[0] as
      | { toolSpec?: { inputSchema?: { json?: unknown } } }
      | undefined;
    expect(tool?.toolSpec?.inputSchema?.json).toMatchObject({
      type: 'object',
      properties: {},
    });
  });

  it('H4: data-URL image with unsupported MIME raises 400', async () => {
    await expect(
      requestResponsesToConverse(
        {
          model: 'm',
          input: [
            {
              type: 'message',
              role: 'user',
              content: [
                {
                  type: 'input_image',
                  image_url: 'data:image/svg+xml;base64,PHN2Zy8+',
                },
              ],
            },
          ] as never,
        } as ResponseCreateParams,
        'm'
      )
    ).rejects.toMatchObject({
      data: expect.objectContaining({ statusCode: 400 }),
    });
  });

  it('M3: input_file with HTTPS url raises 400', async () => {
    await expect(
      requestResponsesToConverse(
        {
          model: 'm',
          input: [
            {
              type: 'message',
              role: 'user',
              content: [
                {
                  type: 'input_file',
                  file_url: 'https://example.com/doc.pdf',
                  filename: 'doc.pdf',
                },
              ],
            },
          ] as never,
        } as ResponseCreateParams,
        'm'
      )
    ).rejects.toMatchObject({
      data: expect.objectContaining({ statusCode: 400 }),
    });
  });

  it('M6: empty assistant content yields a placeholder text block', async () => {
    const out = await requestResponsesToConverse(
      {
        model: 'm',
        input: [
          {
            type: 'message',
            role: 'assistant',
            content: [],
          },
          {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'next' }],
          },
        ] as never,
      } as ResponseCreateParams,
      'm'
    );
    const assistant = out.messages?.find((m) => m.role === 'assistant');
    expect(assistant?.content).toEqual([{ text: '(no content)' }]);
  });

  it('H5: text.format=json_schema on non-output-config model emits the synthetic tool', async () => {
    const out = await requestResponsesToConverse(
      {
        model: 'm',
        input: 'pong',
        text: {
          format: {
            type: 'json_schema',
            name: 'ResultEnvelope',
            schema: {
              type: 'object',
              properties: { ok: { type: 'boolean' } },
              required: ['ok'],
            },
          },
        } as never,
      } as ResponseCreateParams,
      // a non-Claude-4.5 model id so we exercise the synthetic-tool
      // fallback rather than the native outputConfig branch.
      'us.amazon.nova-pro-v1:0'
    );
    const toolNames = (out.toolConfig?.tools ?? []).flatMap((t) =>
      (t as { toolSpec?: { name?: string } }).toolSpec?.name
        ? [(t as { toolSpec: { name: string } }).toolSpec.name]
        : []
    );
    expect(toolNames).toContain('__vmx_structured_output__');
    expect(out.toolConfig?.toolChoice).toMatchObject({
      tool: { name: '__vmx_structured_output__' },
    });
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

  it('H1: MAX_TOKENS surfaces incomplete_details.reason=max_output_tokens', () => {
    const resp: ConverseCommandOutput = {
      $metadata: {} as never,
      output: { message: { role: 'assistant', content: [{ text: '...' }] } },
      stopReason: StopReason.MAX_TOKENS,
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } as never,
      metrics: { latencyMs: 0 } as never,
    } as ConverseCommandOutput;
    const out = responseConverseToResponses(resp, 'r', 0, 'm');
    expect(out.incomplete_details).toEqual({ reason: 'max_output_tokens' });
  });

  it('H1: GUARDRAIL_INTERVENED surfaces incomplete_details.reason=content_filter', () => {
    const resp: ConverseCommandOutput = {
      $metadata: {} as never,
      output: { message: { role: 'assistant', content: [{ text: '' }] } },
      stopReason: StopReason.GUARDRAIL_INTERVENED,
      usage: { inputTokens: 1, outputTokens: 0, totalTokens: 1 } as never,
      metrics: { latencyMs: 0 } as never,
    } as ConverseCommandOutput;
    const out = responseConverseToResponses(resp, 'r', 0, 'm');
    expect(out.status).toBe('incomplete');
    expect(out.incomplete_details).toEqual({ reason: 'content_filter' });
  });

  it('H1: END_TURN leaves incomplete_details as null', () => {
    const resp: ConverseCommandOutput = {
      $metadata: {} as never,
      output: { message: { role: 'assistant', content: [{ text: 'ok' }] } },
      stopReason: StopReason.END_TURN,
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } as never,
      metrics: { latencyMs: 0 } as never,
    } as ConverseCommandOutput;
    const out = responseConverseToResponses(resp, 'r', 0, 'm');
    expect(out.status).toBe('completed');
    expect(out.incomplete_details).toBeNull();
  });

  it('H5: synthetic structured-output tool unwraps to output_text and completed status', () => {
    const resp: ConverseCommandOutput = {
      $metadata: {} as never,
      output: {
        message: {
          role: 'assistant',
          content: [
            {
              toolUse: {
                toolUseId: 'tu_so',
                name: '__vmx_structured_output__',
                input: { ok: true } as never,
              },
            },
          ],
        },
      },
      stopReason: StopReason.TOOL_USE,
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } as never,
      metrics: { latencyMs: 0 } as never,
    } as ConverseCommandOutput;
    const out = responseConverseToResponses(
      resp,
      'r',
      0,
      'm',
      undefined,
      /* structuredOutputApplied */ true
    );
    expect(out.status).toBe('completed');
    const message = out.output.find((o) => o.type === 'message') as
      | { content?: Array<{ type: string; text?: string }> }
      | undefined;
    expect(message?.content?.[0]?.type).toBe('output_text');
    expect(message?.content?.[0]?.text).toBe('{"ok":true}');
    expect(out.output.find((o) => o.type === 'function_call')).toBeUndefined();
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

  it('M1: MAX_TOKENS stop reason emits response.incomplete (not completed) with details', async () => {
    const events: ConverseStreamOutput[] = [
      { messageStart: { role: 'assistant' } },
      {
        contentBlockDelta: {
          contentBlockIndex: 0,
          delta: { text: 'truncated' },
        },
      },
      { contentBlockStop: { contentBlockIndex: 0 } },
      { messageStop: { stopReason: StopReason.MAX_TOKENS } },
      {
        metadata: {
          usage: { inputTokens: 1, outputTokens: 100, totalTokens: 101 },
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
    expect(types).toContain('response.incomplete');
    expect(types).not.toContain('response.completed');

    const terminal = out.find(
      (e) => (e as { type?: string }).type === 'response.incomplete'
    ) as {
      response: {
        status: string;
        incomplete_details: { reason?: string } | null;
      };
    };
    expect(terminal.response.status).toBe('incomplete');
    expect(terminal.response.incomplete_details?.reason).toBe(
      'max_output_tokens'
    );
  });

  it('M4: reasoning stream brackets summary text with summary_part.added/.done', async () => {
    const events: ConverseStreamOutput[] = [
      { messageStart: { role: 'assistant' } },
      {
        contentBlockDelta: {
          contentBlockIndex: 0,
          delta: { reasoningContent: { text: 'thinking' } as never },
        },
      },
      {
        contentBlockDelta: {
          contentBlockIndex: 0,
          delta: { reasoningContent: { signature: 'sig' } as never },
        },
      },
      { contentBlockStop: { contentBlockIndex: 0 } },
      {
        contentBlockDelta: {
          contentBlockIndex: 1,
          delta: { text: 'answer' },
        },
      },
      { contentBlockStop: { contentBlockIndex: 1 } },
      { messageStop: { stopReason: StopReason.END_TURN } },
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
    expect(types).toContain('response.reasoning_summary_part.added');
    expect(types).toContain('response.reasoning_summary_text.delta');
    expect(types).toContain('response.reasoning_summary_text.done');
    expect(types).toContain('response.reasoning_summary_part.done');
    // Bracket ordering: part.added before .delta; .done after text.done.
    const addedIdx = types.indexOf('response.reasoning_summary_part.added');
    const firstDeltaIdx = types.indexOf(
      'response.reasoning_summary_text.delta'
    );
    const textDoneIdx = types.indexOf('response.reasoning_summary_text.done');
    const partDoneIdx = types.indexOf('response.reasoning_summary_part.done');
    expect(addedIdx).toBeLessThan(firstDeltaIdx);
    expect(partDoneIdx).toBeGreaterThan(textDoneIdx);
  });

  it('H5 streaming: structured-output tool deltas re-emit as output_text deltas', async () => {
    const events: ConverseStreamOutput[] = [
      { messageStart: { role: 'assistant' } },
      {
        contentBlockStart: {
          contentBlockIndex: 0,
          start: {
            toolUse: {
              toolUseId: 'tu_so',
              name: '__vmx_structured_output__',
            },
          },
        },
      },
      {
        contentBlockDelta: {
          contentBlockIndex: 0,
          delta: { toolUse: { input: '{"ok":' } },
        },
      },
      {
        contentBlockDelta: {
          contentBlockIndex: 0,
          delta: { toolUse: { input: 'true}' } },
        },
      },
      { contentBlockStop: { contentBlockIndex: 0 } },
      { messageStop: { stopReason: StopReason.TOOL_USE } },
    ];

    const out: ResponseStreamEvent[] = [];
    for await (const e of streamConverseToResponses(
      synth(events),
      'r',
      0,
      'm',
      undefined,
      /* structuredOutputApplied */ true
    )) {
      out.push(e);
    }
    const types = out.map((e) => (e as { type?: string }).type);
    expect(types).toContain('response.output_text.delta');
    expect(types).not.toContain('response.function_call_arguments.delta');
    expect(types).toContain('response.completed');
    expect(types).not.toContain('response.incomplete');

    const reconstructed = out
      .filter(
        (e) => (e as { type?: string }).type === 'response.output_text.delta'
      )
      .map((e) => (e as { delta?: string }).delta ?? '')
      .join('');
    expect(reconstructed).toBe('{"ok":true}');
  });
});
