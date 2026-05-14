import { describe, expect, it } from 'vitest';
import { requestAnthropicToConverse } from '../../ai-provider/aws-bedrock-converse/anthropic-messages.provider';
import { requestResponsesToConverse } from '../../ai-provider/aws-bedrock-converse/openai-response.provider';
import { requestAnthropicToResponses } from '../../ai-provider/openai/anthropic-messages.provider';
import type { AnthropicMessagesRequest } from '../../gateway/anthropic/anthropic.types';
import type { ResponseCreateParams } from 'openai/resources/responses/responses.js';

/**
 * T11: Bedrock Converse has no native `tool_choice: 'none'` — the
 * Anthropic semantic ("model must not call any tool") is achieved by
 * stripping `tools` from the request entirely. Anth→OpenAI Responses
 * has a literal `'none'` string OpenAI honours, so map there instead
 * of returning `undefined`.
 */

const baseTools = {
  tools: [
    {
      name: 'echo',
      description: 'echo input',
      input_schema: { type: 'object', properties: {} },
    },
  ],
} as const;

describe('Anthropic→Converse tool_choice none (T11)', () => {
  it('strips tools when tool_choice.type === "none"', async () => {
    const out = await requestAnthropicToConverse(
      {
        model: 'claude',
        max_tokens: 64,
        messages: [{ role: 'user', content: 'hi' }],
        tools: baseTools.tools as unknown as AnthropicMessagesRequest['tools'],
        tool_choice: { type: 'none' },
      } as AnthropicMessagesRequest,
      'us.anthropic.claude-haiku-4-5'
    );
    expect(out.toolConfig).toBeUndefined();
  });

  it('still emits tools when tool_choice.type === "auto"', async () => {
    const out = await requestAnthropicToConverse(
      {
        model: 'claude',
        max_tokens: 64,
        messages: [{ role: 'user', content: 'hi' }],
        tools: baseTools.tools as unknown as AnthropicMessagesRequest['tools'],
        tool_choice: { type: 'auto' },
      } as AnthropicMessagesRequest,
      'us.anthropic.claude-haiku-4-5'
    );
    expect(out.toolConfig?.tools).toHaveLength(1);
  });
});

describe('Resp→Converse tool_choice none (T11)', () => {
  it('strips tools when tool_choice === "none"', async () => {
    const out = await requestResponsesToConverse(
      {
        model: 'us.anthropic.claude-haiku-4-5',
        input: 'hi',
        tools: [
          {
            type: 'function',
            name: 'echo',
            description: 'echo',
            parameters: { type: 'object' },
          },
        ] as never,
        tool_choice: 'none',
      } as ResponseCreateParams,
      'us.anthropic.claude-haiku-4-5'
    );
    expect(out.toolConfig).toBeUndefined();
  });
});

describe('Anth→OAI Responses tool_choice none (T11)', () => {
  it('maps Anthropic tool_choice.type:none to literal "none" string', () => {
    const out = requestAnthropicToResponses({
      model: 'claude',
      max_tokens: 64,
      messages: [{ role: 'user', content: 'hi' }],
      tools: baseTools.tools as unknown as AnthropicMessagesRequest['tools'],
      tool_choice: { type: 'none' },
    } as AnthropicMessagesRequest);
    expect(out.tool_choice).toBe('none');
  });
});
