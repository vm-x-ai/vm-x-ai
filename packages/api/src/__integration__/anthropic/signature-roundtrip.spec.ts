import { describe, expect, it } from 'vitest';
import {
  requestAnthropicToResponses,
  responseResponsesToAnthropic,
} from '../../ai-provider/openai/anthropic-messages.provider';
import {
  requestResponsesToAnthropic,
  responseAnthropicToResponses,
} from '../../ai-provider/anthropic/openai-response.provider';
import {
  requestResponsesToConverse,
  responseConverseToResponses,
} from '../../ai-provider/aws-bedrock-converse/openai-response.provider';
import type { AnthropicMessagesRequest } from '../../gateway/anthropic/anthropic.types';
import type { Message as AnthropicMessage } from '@anthropic-ai/sdk/resources/messages';
import type {
  ResponseCreateParams,
  ResponseInputItem,
} from 'openai/resources/responses/responses.js';
import type {
  ConverseCommandOutput,
  StopReason,
} from '@aws-sdk/client-bedrock-runtime';

/**
 * T2: stop hard-coding `signature: ''` on every Responses-touching
 * converter. The signature carries Anthropic's signed-thinking blob;
 * dropping it broke multi-turn extended-thinking continuity. The fix
 * routes the signature via the OpenAI Responses item's
 * `encrypted_content` field — round-trippable across the gateway.
 */

describe('Anthropic ↔ OpenAI Responses signature round-trip (T2)', () => {
  it('Anth→Resp request: `thinking` block emits reasoning item with encrypted_content', () => {
    const out = requestAnthropicToResponses({
      model: 'claude',
      max_tokens: 64,
      messages: [
        {
          role: 'assistant',
          content: [
            {
              type: 'thinking',
              thinking: 'I should be careful here.',
              signature: 'sig-abc-123',
            },
          ],
        },
      ],
    } as AnthropicMessagesRequest);
    const items = out.input as ResponseInputItem[];
    const reasoning = items.find(
      (i) => (i as { type?: string }).type === 'reasoning'
    ) as
      | (ResponseInputItem & {
          encrypted_content?: string;
          summary?: Array<{ text?: string }>;
        })
      | undefined;
    expect(reasoning).toBeDefined();
    expect(reasoning?.encrypted_content).toBe('sig-abc-123');
    expect(reasoning?.summary?.[0]?.text).toBe('I should be careful here.');
  });

  it('Anth→Resp request: `redacted_thinking` round-trips via sentinel-prefixed encrypted_content', () => {
    const out = requestAnthropicToResponses({
      model: 'claude',
      max_tokens: 64,
      messages: [
        {
          role: 'assistant',
          content: [
            {
              type: 'redacted_thinking',
              data: 'opaque-blob-data',
            } as never,
          ],
        },
      ],
    } as AnthropicMessagesRequest);
    const items = out.input as ResponseInputItem[];
    const reasoning = items.find(
      (i) => (i as { type?: string }).type === 'reasoning'
    ) as (ResponseInputItem & { encrypted_content?: string }) | undefined;
    expect(reasoning?.encrypted_content).toBe(
      '__vmx_redacted__:opaque-blob-data'
    );
  });

  it('Resp→Anth response: encrypted_content materialises as `thinking.signature`', () => {
    const anth = responseResponsesToAnthropic(
      {
        id: 'resp_x',
        output: [
          {
            type: 'reasoning',
            id: 'rs_1',
            summary: [{ type: 'summary_text', text: 'thought process' }],
            encrypted_content: 'sig-xyz',
          },
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'final answer' }],
          },
        ],
      } as never,
      'claude'
    );
    const thinking = (
      anth.content as Array<{
        type?: string;
        signature?: string;
        thinking?: string;
      }>
    ).find((b) => b.type === 'thinking');
    expect(thinking?.signature).toBe('sig-xyz');
    expect(thinking?.thinking).toBe('thought process');
  });

  it('Resp→Anth response: sentinel-prefixed encrypted_content materialises as redacted_thinking', () => {
    const anth = responseResponsesToAnthropic(
      {
        id: 'resp_x',
        output: [
          {
            type: 'reasoning',
            id: 'rs_1',
            summary: [],
            encrypted_content: '__vmx_redacted__:abcdef',
          },
        ],
      } as never,
      'claude'
    );
    const block = (anth.content as Array<{ type?: string; data?: string }>)[0];
    expect(block.type).toBe('redacted_thinking');
    expect(block.data).toBe('abcdef');
  });
});

describe('OpenAI Responses ↔ Anthropic signature round-trip (T2)', () => {
  it('Resp→Anth request: prior reasoning item materialises as `thinking` with signature', () => {
    const body = requestResponsesToAnthropic({
      model: 'claude',
      input: [
        {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'prior reply' }],
        },
        {
          type: 'reasoning',
          id: 'rs_1',
          summary: [{ type: 'summary_text', text: 'prior reasoning' }],
          encrypted_content: 'sig-resp-1',
        },
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'now what?' }],
        },
      ],
    } as ResponseCreateParams);
    const assistant = body.messages.find((m) => m.role === 'assistant');
    expect(assistant).toBeDefined();
    const thinking = (
      assistant?.content as Array<{ type?: string; signature?: string }>
    ).find((b) => b.type === 'thinking');
    expect(thinking?.signature).toBe('sig-resp-1');
  });

  it('Anth→Resp response: assistant `thinking.signature` surfaces as encrypted_content', () => {
    const resp = responseAnthropicToResponses(
      {
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model: 'claude',
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 5, output_tokens: 3 } as never,
        content: [
          {
            type: 'thinking',
            thinking: 'thinking text',
            signature: 'sig-real',
          },
          { type: 'text', text: 'answer' },
        ],
      } as unknown as AnthropicMessage,
      'resp_1',
      0,
      'claude'
    );
    const reasoning = resp.output?.find(
      (o) => (o as { type?: string }).type === 'reasoning'
    ) as { encrypted_content?: string } | undefined;
    expect(reasoning?.encrypted_content).toBe('sig-real');
  });

  it('Anth→Resp response: redacted_thinking surfaces as sentinel encrypted_content', () => {
    const resp = responseAnthropicToResponses(
      {
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model: 'claude',
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 5, output_tokens: 3 } as never,
        content: [{ type: 'redacted_thinking', data: 'rb-data' } as never],
      } as unknown as AnthropicMessage,
      'resp_1',
      0,
      'claude'
    );
    const reasoning = resp.output?.find(
      (o) => (o as { type?: string }).type === 'reasoning'
    ) as { encrypted_content?: string } | undefined;
    expect(reasoning?.encrypted_content).toBe('__vmx_redacted__:rb-data');
  });
});

describe('Bedrock-Converse Resp adapter signature round-trip (T2)', () => {
  it('Resp→Converse request: prior reasoning item carries signature into reasoningContent', () => {
    const body = requestResponsesToConverse(
      {
        model: 'us.anthropic.claude-haiku-4-5',
        input: [
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'prior' }],
          },
          {
            type: 'reasoning',
            id: 'rs_1',
            summary: [{ type: 'summary_text', text: 'prior thinking' }],
            encrypted_content: 'sig-bedrock',
          },
          {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'next' }],
          },
        ],
      } as ResponseCreateParams,
      'us.anthropic.claude-haiku-4-5'
    );
    const assistant = body.messages?.find((m) => m.role === 'assistant');
    const reasoning = (
      assistant?.content as Array<{
        reasoningContent?: { reasoningText?: { signature?: string } };
      }>
    ).find((b) => b.reasoningContent);
    expect(reasoning?.reasoningContent?.reasoningText?.signature).toBe(
      'sig-bedrock'
    );
  });

  it('Converse→Resp response: reasoningContent.signature surfaces as encrypted_content', () => {
    const resp = responseConverseToResponses(
      {
        $metadata: { requestId: 'req-1' },
        output: {
          message: {
            role: 'assistant',
            content: [
              {
                reasoningContent: {
                  reasoningText: {
                    text: 'thinking',
                    signature: 'sig-bd-resp',
                  },
                },
              },
              { text: 'answer' },
            ],
          },
        },
        stopReason: 'end_turn' as StopReason,
        usage: {
          inputTokens: 5,
          outputTokens: 3,
          totalTokens: 8,
        },
      } as ConverseCommandOutput,
      'resp_xyz',
      0,
      'us.anthropic.claude-haiku-4-5'
    );
    const reasoning = resp.output?.find(
      (o) => (o as { type?: string }).type === 'reasoning'
    ) as { encrypted_content?: string } | undefined;
    expect(reasoning?.encrypted_content).toBe('sig-bd-resp');
  });
});
