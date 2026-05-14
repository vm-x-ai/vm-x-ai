import { describe, expect, it } from 'vitest';
import {
  ConverseCommandOutput,
  ConverseStreamOutput,
  StopReason,
} from '@aws-sdk/client-bedrock-runtime';
import type { RawMessageStreamEvent } from '@anthropic-ai/sdk/resources/messages';
import {
  requestAnthropicToConverse,
  responseConverseToAnthropic,
  streamConverseToAnthropic,
} from '../../ai-provider/aws-bedrock-converse/anthropic-messages.provider';
import type { AnthropicMessagesRequest } from '../../gateway/anthropic/anthropic.types';

/**
 * Adapter unit tests for the direct Anthropic ↔ Converse converter
 * (canonical owner: `aws-bedrock-converse/anthropic-messages.provider.ts`).
 * Three pure functions, no SDK dependency.
 */

describe('Anthropic → Converse request adapter', () => {
  it('maps a simple user message to a Converse message with text content', async () => {
    const out = await requestAnthropicToConverse(
      {
        model: 'claude',
        max_tokens: 64,
        messages: [{ role: 'user', content: 'hello' }],
      } as AnthropicMessagesRequest,
      'us.anthropic.claude-haiku-4-5'
    );
    expect(out.modelId).toBe('us.anthropic.claude-haiku-4-5');
    expect(out.inferenceConfig?.maxTokens).toBe(64);
    expect(out.messages).toEqual([
      { role: 'user', content: [{ text: 'hello' }] },
    ]);
  });

  it('maps top-level system to Converse system blocks', async () => {
    const out = await requestAnthropicToConverse(
      {
        model: 'claude',
        max_tokens: 16,
        messages: [{ role: 'user', content: 'hi' }],
        system: 'be brief',
      } as AnthropicMessagesRequest,
      'm'
    );
    expect(out.system).toEqual([{ text: 'be brief' }]);
  });

  it('maps tool_use + tool_result content blocks', async () => {
    const out = await requestAnthropicToConverse(
      {
        model: 'claude',
        max_tokens: 16,
        messages: [
          { role: 'user', content: 'weather?' },
          {
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: 'tu_1',
                name: 'get_weather',
                input: { location: 'Tokyo' },
              },
            ],
          },
          {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'tu_1',
                content: '15 °C',
              },
            ],
          },
        ],
      } as AnthropicMessagesRequest,
      'm'
    );

    expect(out.messages?.[1]).toMatchObject({
      role: 'assistant',
      content: [
        {
          toolUse: {
            toolUseId: 'tu_1',
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
            toolUseId: 'tu_1',
            content: [{ text: '15 °C' }],
            status: 'success',
          },
        },
      ],
    });
  });

  it('maps Anthropic tools and tool_choice variants', async () => {
    const out = await requestAnthropicToConverse(
      {
        model: 'claude',
        max_tokens: 16,
        messages: [{ role: 'user', content: 'pong' }],
        tools: [
          {
            name: 'get_weather',
            description: 'Weather lookup',
            input_schema: {
              type: 'object',
              properties: { location: { type: 'string' } },
              required: ['location'],
            },
          },
        ],
        tool_choice: { type: 'auto' },
      } as AnthropicMessagesRequest,
      'm'
    );
    expect(out.toolConfig?.tools?.[0]).toMatchObject({
      toolSpec: { name: 'get_weather' },
    });
    expect(out.toolConfig?.toolChoice).toMatchObject({ auto: {} });
  });

  it('forwards top_k via additionalModelRequestFields', async () => {
    const out = await requestAnthropicToConverse(
      {
        model: 'claude',
        max_tokens: 16,
        messages: [{ role: 'user', content: 'pong' }],
        top_k: 50,
      } as AnthropicMessagesRequest,
      'm'
    );
    expect(out.additionalModelRequestFields).toMatchObject({ top_k: 50 });
  });
});

describe('Converse → Anthropic response adapter', () => {
  it('maps text + toolUse content blocks back to Anthropic blocks', () => {
    const resp: ConverseCommandOutput = {
      $metadata: { requestId: 'req_1', extendedRequestId: 'req_1' } as never,
      output: {
        message: {
          role: 'assistant',
          content: [
            { text: 'Tool result coming.' },
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

    const out = responseConverseToAnthropic(resp, 'claude-haiku-4-5');
    expect(out.type).toBe('message');
    expect(out.role).toBe('assistant');
    expect(out.stop_reason).toBe('tool_use');
    expect(out.content).toHaveLength(2);
    const tool = out.content.find(
      (b) => (b as { type?: string }).type === 'tool_use'
    );
    expect(tool).toMatchObject({
      type: 'tool_use',
      id: 'tu_1',
      name: 'get_weather',
      input: { location: 'Tokyo' },
    });
    expect(out.usage?.input_tokens).toBe(10);
  });

  it('maps stopReason MAX_TOKENS to max_tokens', () => {
    const resp: ConverseCommandOutput = {
      $metadata: { requestId: 'req_1' } as never,
      output: { message: { role: 'assistant', content: [{ text: '...' }] } },
      stopReason: StopReason.MAX_TOKENS,
      usage: {
        inputTokens: 10,
        outputTokens: 100,
        totalTokens: 110,
      } as never,
      metrics: { latencyMs: 0 } as never,
    } as ConverseCommandOutput;
    const out = responseConverseToAnthropic(resp, 'm');
    expect(out.stop_reason).toBe('max_tokens');
  });
});

describe('Converse → Anthropic stream adapter', () => {
  async function* synth(events: ConverseStreamOutput[]) {
    for (const e of events) yield e;
  }

  it('emits message_start → text deltas → message_delta + message_stop', async () => {
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
          usage: {
            inputTokens: 5,
            outputTokens: 2,
            totalTokens: 7,
          },
          metrics: { latencyMs: 0 } as never,
        },
      },
    ];

    const out: RawMessageStreamEvent[] = [];
    for await (const e of streamConverseToAnthropic(
      synth(events),
      'claude-haiku-4-5'
    )) {
      out.push(e);
    }

    const types = out.map((e) => e.type);
    expect(types).toContain('message_start');
    expect(types.some((t) => t === 'content_block_start')).toBe(true);
    expect(types.filter((t) => t === 'content_block_delta')).toHaveLength(2);
    expect(types).toContain('content_block_stop');
    expect(types).toContain('message_delta');
    expect(types).toContain('message_stop');

    // Reconstructed text should be the concatenated deltas.
    const text = out
      .filter((e) => e.type === 'content_block_delta')
      .map((e) => {
        const d = (e as { delta?: { type?: string; text?: string } }).delta;
        return d?.type === 'text_delta' ? d.text ?? '' : '';
      })
      .join('');
    expect(text).toBe('Hello world');

    // Final message_delta carries usage.
    const delta = out.find((e) => e.type === 'message_delta') as {
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    expect(delta.usage?.input_tokens).toBe(5);
    expect(delta.usage?.output_tokens).toBe(2);
  });

  it('translates Converse toolUse stream events to input_json_delta', async () => {
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
    ];

    const out: RawMessageStreamEvent[] = [];
    for await (const e of streamConverseToAnthropic(synth(events), 'm')) {
      out.push(e);
    }
    const argsDeltas = out
      .filter((e) => e.type === 'content_block_delta')
      .map((e) => {
        const d = (
          e as {
            delta?: { type?: string; partial_json?: string };
          }
        ).delta;
        return d?.type === 'input_json_delta' ? d.partial_json ?? '' : '';
      })
      .join('');
    expect(() => JSON.parse(argsDeltas)).not.toThrow();
    expect(JSON.parse(argsDeltas)).toEqual({ location: 'Tokyo' });
  });
});

describe('Anthropic → Converse request adapter — audit follow-ups', () => {
  it('F-F1: base64 image with unknown media_type raises 400', async () => {
    await expect(
      requestAnthropicToConverse(
        {
          model: 'claude',
          max_tokens: 16,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: 'image/avif',
                    data: 'AAAA',
                  },
                } as never,
              ],
            },
          ],
        } as AnthropicMessagesRequest,
        'm'
      )
    ).rejects.toMatchObject({
      data: { statusCode: 400 },
    });
  });

  it('F-F1: base64 image with jpeg uses inferred format', async () => {
    const out = await requestAnthropicToConverse(
      {
        model: 'claude',
        max_tokens: 16,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/jpeg',
                  data: 'AAAA',
                },
              } as never,
            ],
          },
        ],
      } as AnthropicMessagesRequest,
      'm'
    );
    expect(out.messages?.[0].content?.[0]).toMatchObject({
      image: { format: 'jpeg' },
    });
  });

  it('F-F3: base64 PDF document maps to Converse document block', async () => {
    const pdfBytes = Buffer.from('%PDF-1.4', 'utf-8').toString('base64');
    const out = await requestAnthropicToConverse(
      {
        model: 'claude',
        max_tokens: 16,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'document',
                source: {
                  type: 'base64',
                  media_type: 'application/pdf',
                  data: pdfBytes,
                },
                title: 'report.pdf',
              } as never,
            ],
          },
        ],
      } as AnthropicMessagesRequest,
      'm'
    );
    const block = out.messages?.[0].content?.[0] as {
      document?: { format?: string; name?: string };
    };
    expect(block.document?.format).toBe('pdf');
    expect(block.document?.name).toBe('report.pdf');
  });

  it('F-F3: text-source document maps to Converse document with text source', async () => {
    const out = await requestAnthropicToConverse(
      {
        model: 'claude',
        max_tokens: 16,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'document',
                source: {
                  type: 'text',
                  media_type: 'text/plain',
                  data: 'hello document',
                },
              } as never,
            ],
          },
        ],
      } as AnthropicMessagesRequest,
      'm'
    );
    const block = out.messages?.[0].content?.[0] as {
      document?: { format?: string; source?: { text?: string } };
    };
    expect(block.document?.source?.text).toBe('hello document');
    expect(block.document?.format).toBe('txt');
  });

  it('F-F3: content-source document concatenates text blocks', async () => {
    const out = await requestAnthropicToConverse(
      {
        model: 'claude',
        max_tokens: 16,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'document',
                source: {
                  type: 'content',
                  content: [
                    { type: 'text', text: 'first chunk' },
                    { type: 'text', text: 'second chunk' },
                  ],
                },
              } as never,
            ],
          },
        ],
      } as AnthropicMessagesRequest,
      'm'
    );
    const block = out.messages?.[0].content?.[0] as {
      document?: { source?: { text?: string } };
    };
    expect(block.document?.source?.text).toBe('first chunk\nsecond chunk');
  });

  it("F-F3: HTTPS document URL raises 400 (Converse can't fetch documents)", async () => {
    await expect(
      requestAnthropicToConverse(
        {
          model: 'claude',
          max_tokens: 16,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'document',
                  source: {
                    type: 'url',
                    url: 'https://example.com/file.pdf',
                  },
                } as never,
              ],
            },
          ],
        } as AnthropicMessagesRequest,
        'm'
      )
    ).rejects.toMatchObject({
      data: { statusCode: 400 },
    });
  });

  it('F-F5: redacted_thinking content block maps to reasoningContent.redactedContent', async () => {
    const out = await requestAnthropicToConverse(
      {
        model: 'claude',
        max_tokens: 16,
        messages: [
          {
            role: 'assistant',
            content: [
              {
                type: 'redacted_thinking',
                data: Buffer.from('opaque-blob').toString('base64'),
              } as never,
            ],
          },
        ],
      } as AnthropicMessagesRequest,
      'm'
    );
    const block = out.messages?.[0].content?.[0] as {
      reasoningContent?: { redactedContent?: Buffer };
    };
    expect(block.reasoningContent?.redactedContent).toBeDefined();
    expect(block.reasoningContent?.redactedContent?.toString('utf-8')).toBe(
      'opaque-blob'
    );
  });

  it('F-F6: tool with empty input_schema uses the canonical empty-object default', async () => {
    const out = await requestAnthropicToConverse(
      {
        model: 'claude',
        max_tokens: 16,
        messages: [{ role: 'user', content: 'hi' }],
        tools: [
          {
            name: 'zero_arg',
            description: 'no params',
            input_schema: {} as never,
          },
        ],
      } as AnthropicMessagesRequest,
      'm'
    );
    const tool = out.toolConfig?.tools?.[0] as {
      toolSpec?: {
        inputSchema?: { json?: { type?: string; properties?: unknown } };
      };
    };
    expect(tool.toolSpec?.inputSchema?.json).toMatchObject({
      type: 'object',
      properties: {},
    });
  });

  it('F-F11: tool_result content with text+image+document maps multipart', async () => {
    const out = await requestAnthropicToConverse(
      {
        model: 'claude',
        max_tokens: 16,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'tu_1',
                content: [
                  { type: 'text', text: 'caption' },
                  {
                    type: 'image',
                    source: {
                      type: 'base64',
                      media_type: 'image/png',
                      data: 'AAAA',
                    },
                  },
                  {
                    type: 'document',
                    source: {
                      type: 'text',
                      media_type: 'text/plain',
                      data: 'inline doc',
                    },
                  },
                ],
              } as never,
            ],
          },
        ],
      } as AnthropicMessagesRequest,
      'm'
    );
    const tr = (
      out.messages?.[0].content?.[0] as {
        toolResult?: { content?: Array<Record<string, unknown>> };
      }
    ).toolResult;
    expect(tr?.content).toHaveLength(3);
    expect(tr?.content?.[0]).toEqual({ text: 'caption' });
    expect(tr?.content?.[1]).toMatchObject({
      image: { format: 'png' },
    });
    expect(tr?.content?.[2]).toMatchObject({
      document: { source: { text: 'inline doc' } },
    });
  });

  it('F-M1: req.metadata.user_id propagates to requestMetadata', async () => {
    const out = await requestAnthropicToConverse(
      {
        model: 'claude',
        max_tokens: 16,
        messages: [{ role: 'user', content: 'hi' }],
        metadata: { user_id: 'opaque-uid-123' },
      } as AnthropicMessagesRequest,
      'm'
    );
    expect(out.requestMetadata).toEqual({ user_id: 'opaque-uid-123' });
  });

  it('F-M4: stop_sequences request includes additionalModelResponseFieldPaths for stop_sequence', async () => {
    const out = await requestAnthropicToConverse(
      {
        model: 'claude',
        max_tokens: 16,
        messages: [{ role: 'user', content: 'hi' }],
        stop_sequences: ['STOP'],
      } as AnthropicMessagesRequest,
      'm'
    );
    expect(out.additionalModelResponseFieldPaths).toEqual(['/stop_sequence']);
  });

  it('F-M11: empty content array gets a placeholder block', async () => {
    const out = await requestAnthropicToConverse(
      {
        model: 'claude',
        max_tokens: 16,
        messages: [{ role: 'user', content: [] }],
      } as AnthropicMessagesRequest,
      'm'
    );
    expect(out.messages?.[0].content).toEqual([{ text: '(no content)' }]);
  });
});

describe('Converse → Anthropic response adapter — audit follow-ups', () => {
  it('F-F4: text block carries citations: null', () => {
    const resp: ConverseCommandOutput = {
      $metadata: {} as never,
      output: { message: { role: 'assistant', content: [{ text: 'hi' }] } },
      stopReason: StopReason.END_TURN,
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } as never,
      metrics: { latencyMs: 0 } as never,
    } as ConverseCommandOutput;
    const out = responseConverseToAnthropic(resp, 'm');
    expect(out.content[0]).toMatchObject({
      type: 'text',
      text: 'hi',
      citations: null,
    });
  });

  it('F-F4: tool_use block carries caller: { type: "direct" }', () => {
    const resp: ConverseCommandOutput = {
      $metadata: {} as never,
      output: {
        message: {
          role: 'assistant',
          content: [
            {
              toolUse: {
                toolUseId: 'tu_1',
                name: 'foo',
                input: {} as never,
              },
            },
          ],
        },
      },
      stopReason: StopReason.TOOL_USE,
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } as never,
      metrics: { latencyMs: 0 } as never,
    } as ConverseCommandOutput;
    const out = responseConverseToAnthropic(resp, 'm');
    expect(out.content[0]).toMatchObject({
      type: 'tool_use',
      caller: { type: 'direct' },
    });
  });

  it('F-F5: reasoningContent.redactedContent surfaces as redacted_thinking block', () => {
    const blob = Buffer.from('redacted-payload');
    const resp: ConverseCommandOutput = {
      $metadata: {} as never,
      output: {
        message: {
          role: 'assistant',
          content: [
            {
              reasoningContent: {
                redactedContent: blob,
              },
            },
          ],
        },
      },
      stopReason: StopReason.END_TURN,
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } as never,
      metrics: { latencyMs: 0 } as never,
    } as ConverseCommandOutput;
    const out = responseConverseToAnthropic(resp, 'm');
    const block = out.content[0] as { type?: string; data?: string };
    expect(block.type).toBe('redacted_thinking');
    expect(Buffer.from(block.data ?? '', 'base64').toString('utf-8')).toBe(
      'redacted-payload'
    );
  });

  it('F-F10: Message has container, stop_details (null) and full Usage shape', () => {
    const resp: ConverseCommandOutput = {
      $metadata: {} as never,
      output: { message: { role: 'assistant', content: [{ text: 'hi' }] } },
      stopReason: StopReason.END_TURN,
      usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 } as never,
      metrics: { latencyMs: 0 } as never,
    } as ConverseCommandOutput;
    const out = responseConverseToAnthropic(resp, 'm');
    expect(out.container).toBeNull();
    expect(out.stop_details).toBeNull();
    expect(out.usage).toMatchObject({
      input_tokens: 5,
      output_tokens: 2,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      cache_creation: null,
      server_tool_use: null,
      service_tier: null,
      inference_geo: null,
    });
  });

  it('F-M4: stop_sequence populated when stopReason is STOP_SEQUENCE and additionalModelResponseFields carries it', () => {
    const resp: ConverseCommandOutput = {
      $metadata: {} as never,
      output: { message: { role: 'assistant', content: [{ text: 'hi' }] } },
      stopReason: StopReason.STOP_SEQUENCE,
      additionalModelResponseFields: { stop_sequence: 'STOP' } as never,
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } as never,
      metrics: { latencyMs: 0 } as never,
    } as ConverseCommandOutput;
    const out = responseConverseToAnthropic(resp, 'm');
    expect(out.stop_reason).toBe('stop_sequence');
    expect(out.stop_sequence).toBe('STOP');
  });

  it('F-M5: cacheDetails breakdown maps to usage.cache_creation', () => {
    const resp: ConverseCommandOutput = {
      $metadata: {} as never,
      output: { message: { role: 'assistant', content: [{ text: 'hi' }] } },
      stopReason: StopReason.END_TURN,
      usage: {
        inputTokens: 100,
        outputTokens: 2,
        totalTokens: 102,
        cacheWriteInputTokens: 80,
        cacheDetails: [
          { ttl: '5m', inputTokens: 30 },
          { ttl: '1h', inputTokens: 50 },
        ],
      } as never,
      metrics: { latencyMs: 0 } as never,
    } as ConverseCommandOutput;
    const out = responseConverseToAnthropic(resp, 'm');
    expect(out.usage?.cache_creation).toEqual({
      ephemeral_5m_input_tokens: 30,
      ephemeral_1h_input_tokens: 50,
    });
  });

  it('F-M10: GUARDRAIL_INTERVENED maps to refusal with stop_details', () => {
    const resp: ConverseCommandOutput = {
      $metadata: {} as never,
      output: { message: { role: 'assistant', content: [{ text: '' }] } },
      stopReason: StopReason.GUARDRAIL_INTERVENED,
      usage: { inputTokens: 1, outputTokens: 0, totalTokens: 1 } as never,
      metrics: { latencyMs: 0 } as never,
    } as ConverseCommandOutput;
    const out = responseConverseToAnthropic(resp, 'm');
    expect(out.stop_reason).toBe('refusal');
    expect(out.stop_details).toMatchObject({ type: 'refusal' });
  });
});

describe('Converse → Anthropic stream adapter — audit follow-ups', () => {
  async function* synth(events: ConverseStreamOutput[]) {
    for (const e of events) yield e;
  }

  it('F-F10: message_start.message.usage has all 8 fields populated', async () => {
    const events: ConverseStreamOutput[] = [
      { messageStart: { role: 'assistant' } },
      { messageStop: { stopReason: StopReason.END_TURN } },
    ];
    const out: RawMessageStreamEvent[] = [];
    for await (const e of streamConverseToAnthropic(synth(events), 'm')) {
      out.push(e);
    }
    const start = out.find((e) => e.type === 'message_start') as unknown as {
      message?: {
        usage?: Record<string, unknown>;
        container?: unknown;
        stop_details?: unknown;
      };
    };
    expect(start.message?.container).toBeNull();
    expect(start.message?.stop_details).toBeNull();
    expect(start.message?.usage).toMatchObject({
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      cache_creation: null,
      server_tool_use: null,
      service_tier: null,
      inference_geo: null,
    });
  });

  it('F-F4: streamed content_block_start emits TextBlock with citations: null', async () => {
    const events: ConverseStreamOutput[] = [
      { messageStart: { role: 'assistant' } },
      {
        contentBlockDelta: {
          contentBlockIndex: 0,
          delta: { text: 'hi' },
        },
      },
      { contentBlockStop: { contentBlockIndex: 0 } },
      { messageStop: { stopReason: StopReason.END_TURN } },
    ];
    const out: RawMessageStreamEvent[] = [];
    for await (const e of streamConverseToAnthropic(synth(events), 'm')) {
      out.push(e);
    }
    const cbStart = out.find((e) => e.type === 'content_block_start') as {
      content_block?: { type?: string; citations?: unknown };
    };
    expect(cbStart.content_block).toMatchObject({
      type: 'text',
      citations: null,
    });
  });

  it('F-F4: streamed content_block_start for tool_use emits caller: direct', async () => {
    const events: ConverseStreamOutput[] = [
      { messageStart: { role: 'assistant' } },
      {
        contentBlockStart: {
          contentBlockIndex: 0,
          start: { toolUse: { toolUseId: 'tu_1', name: 'foo' } },
        },
      },
      { contentBlockStop: { contentBlockIndex: 0 } },
      { messageStop: { stopReason: StopReason.TOOL_USE } },
    ];
    const out: RawMessageStreamEvent[] = [];
    for await (const e of streamConverseToAnthropic(synth(events), 'm')) {
      out.push(e);
    }
    const cbStart = out.find((e) => e.type === 'content_block_start') as {
      content_block?: { type?: string; caller?: { type?: string } };
    };
    expect(cbStart.content_block?.type).toBe('tool_use');
    expect(cbStart.content_block?.caller).toEqual({ type: 'direct' });
  });

  it('F-L5: reasoningContent.signature delta emits signature_delta', async () => {
    const events: ConverseStreamOutput[] = [
      { messageStart: { role: 'assistant' } },
      {
        contentBlockDelta: {
          contentBlockIndex: 0,
          delta: { reasoningContent: { text: 'thinking...' } },
        },
      },
      {
        contentBlockDelta: {
          contentBlockIndex: 0,
          delta: { reasoningContent: { signature: 'sig-1' } as never },
        },
      },
      { contentBlockStop: { contentBlockIndex: 0 } },
      { messageStop: { stopReason: StopReason.END_TURN } },
    ];
    const out: RawMessageStreamEvent[] = [];
    for await (const e of streamConverseToAnthropic(synth(events), 'm')) {
      out.push(e);
    }
    const sigDelta = out
      .filter((e) => e.type === 'content_block_delta')
      .find(
        (e) =>
          (e as { delta?: { type?: string } }).delta?.type === 'signature_delta'
      ) as { delta?: { type?: string; signature?: string } };
    expect(sigDelta).toBeDefined();
    expect(sigDelta.delta?.signature).toBe('sig-1');
  });

  it('F-M6: stop_sequence from messageStop.additionalModelResponseFields surfaces in message_delta', async () => {
    const events: ConverseStreamOutput[] = [
      { messageStart: { role: 'assistant' } },
      {
        contentBlockDelta: {
          contentBlockIndex: 0,
          delta: { text: 'hi STOP' },
        },
      },
      { contentBlockStop: { contentBlockIndex: 0 } },
      {
        messageStop: {
          stopReason: StopReason.STOP_SEQUENCE,
          additionalModelResponseFields: { stop_sequence: 'STOP' } as never,
        },
      },
    ];
    const out: RawMessageStreamEvent[] = [];
    for await (const e of streamConverseToAnthropic(synth(events), 'm')) {
      out.push(e);
    }
    const delta = out.find((e) => e.type === 'message_delta') as {
      delta?: { stop_reason?: string; stop_sequence?: string };
    };
    expect(delta.delta?.stop_reason).toBe('stop_sequence');
    expect(delta.delta?.stop_sequence).toBe('STOP');
  });
});
