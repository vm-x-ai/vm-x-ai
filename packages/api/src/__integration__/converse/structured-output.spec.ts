import { describe, expect, it } from 'vitest';
import {
  applyConverseStructuredOutput,
  CONVERSE_STRUCTURED_OUTPUT_TOOL_NAME,
} from '../../ai-provider/aws-bedrock-converse/shared';
import type { ChatCompletionCreateParams } from 'openai/resources/index.js';

/**
 * T12: Bedrock Converse has no native equivalent of OpenAI's
 * `response_format: json_schema` — the gateway needs to inject a
 * synthetic tool with the schema as `inputSchema.json` and force
 * the model to call it (mirroring the same trick the Anthropic
 * adapter has used for a while). The response side recognises the
 * sentinel name and unwraps the tool input as message content.
 */

describe('Chat→Converse json_schema synthetic tool (T12)', () => {
  it('appends the synthetic tool with the schema as inputSchema.json', () => {
    const out = applyConverseStructuredOutput(
      {
        model: 'us.anthropic.claude-haiku-4-5',
        messages: [{ role: 'user', content: 'hi' }],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'CityCountry',
            schema: {
              type: 'object',
              properties: { city: { type: 'string' } },
              required: ['city'],
            },
          },
        },
      } as ChatCompletionCreateParams,
      undefined
    );
    expect(out.applied).toBe(true);
    expect(out.tools).toBeDefined();
    expect(out.tools?.length).toBe(1);
    const synthetic = out.tools?.[0] as { toolSpec?: { name?: string } };
    expect(synthetic.toolSpec?.name).toBe(CONVERSE_STRUCTURED_OUTPUT_TOOL_NAME);
  });

  it('forces toolChoice to the synthetic tool', () => {
    const out = applyConverseStructuredOutput(
      {
        model: 'us.anthropic.claude-haiku-4-5',
        messages: [{ role: 'user', content: 'hi' }],
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'X', schema: { type: 'object' } },
        },
      } as ChatCompletionCreateParams,
      undefined
    );
    expect(out.toolChoice).toEqual({
      tool: { name: CONVERSE_STRUCTURED_OUTPUT_TOOL_NAME },
    });
  });

  it('preserves user-supplied tools alongside the synthetic one', () => {
    const userTool = {
      toolSpec: {
        name: 'get_weather',
        inputSchema: { json: {} as never },
      },
    };
    const out = applyConverseStructuredOutput(
      {
        model: 'x',
        messages: [{ role: 'user', content: 'hi' }],
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'X', schema: { type: 'object' } },
        },
      } as ChatCompletionCreateParams,
      [userTool]
    );
    expect(out.tools).toHaveLength(2);
    expect(
      (out.tools?.[0] as { toolSpec?: { name?: string } }).toolSpec?.name
    ).toBe('get_weather');
    expect(
      (out.tools?.[1] as { toolSpec?: { name?: string } }).toolSpec?.name
    ).toBe(CONVERSE_STRUCTURED_OUTPUT_TOOL_NAME);
  });

  it('is a no-op for response_format: text', () => {
    const out = applyConverseStructuredOutput(
      {
        model: 'x',
        messages: [{ role: 'user', content: 'hi' }],
        response_format: { type: 'text' },
      } as ChatCompletionCreateParams,
      undefined
    );
    expect(out.applied).toBe(false);
    expect(out.tools).toBeUndefined();
    expect(out.toolChoice).toBeUndefined();
  });

  it('is a no-op for response_format: json_object (no schema)', () => {
    const out = applyConverseStructuredOutput(
      {
        model: 'x',
        messages: [{ role: 'user', content: 'hi' }],
        response_format: { type: 'json_object' } as never,
      } as ChatCompletionCreateParams,
      undefined
    );
    expect(out.applied).toBe(false);
  });
});
