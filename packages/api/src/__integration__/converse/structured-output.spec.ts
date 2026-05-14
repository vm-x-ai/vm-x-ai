import { describe, expect, it } from 'vitest';
import {
  applyConverseStructuredOutput,
  CONVERSE_STRUCTURED_OUTPUT_TOOL_NAME,
} from '../../ai-provider/aws-bedrock-converse/openai-chat-completion.provider';
import type { ChatCompletionCreateParams } from 'openai/resources/index.js';

/**
 * T12: Bedrock Converse's native `outputConfig.textFormat` constrains
 * model output to a JSON schema directly on modern Claude models
 * (4.5+). Older Claudes and non-Claude families don't accept it, so
 * the gateway falls back to a synthetic tool whose `inputSchema.json`
 * is the schema and forces the model to call it. The response side
 * recognises the sentinel name and unwraps the tool input as message
 * content.
 */

const baseRequest = {
  messages: [{ role: 'user', content: 'hi' }],
} as ChatCompletionCreateParams;

function withJsonSchema(
  schema: Record<string, unknown> = { type: 'object' },
  extras: { name?: string; description?: string } = {}
): ChatCompletionCreateParams {
  return {
    ...baseRequest,
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: extras.name ?? 'X',
        ...(extras.description ? { description: extras.description } : {}),
        schema,
      },
    },
  } as ChatCompletionCreateParams;
}

describe('Chat→Converse structured output (T12)', () => {
  it('returns kind=native with outputConfig.textFormat for Claude 4.5+', () => {
    const out = applyConverseStructuredOutput(
      withJsonSchema(
        {
          type: 'object',
          properties: { city: { type: 'string' } },
          required: ['city'],
        },
        { name: 'CityCountry' }
      ),
      'us.anthropic.claude-haiku-4-5-20251001-v1:0',
      undefined
    );
    expect(out.kind).toBe('native');
    if (out.kind !== 'native') throw new Error('unreachable');
    expect(out.outputConfig.textFormat?.type).toBe('json_schema');
    const def = out.outputConfig.textFormat?.structure?.jsonSchema;
    expect(def?.name).toBe('CityCountry');
    // `JsonSchemaDefinition.schema` is wire-typed as a string; verify
    // we stringify the schema object on the way out.
    expect(typeof def?.schema).toBe('string');
    expect(JSON.parse(def?.schema ?? '{}')).toMatchObject({
      type: 'object',
      properties: { city: { type: 'string' } },
    });
  });

  it('falls back to kind=tool on older Claude 3.x models', () => {
    const out = applyConverseStructuredOutput(
      withJsonSchema(),
      'us.anthropic.claude-3-5-sonnet-20240620-v1:0',
      undefined
    );
    expect(out.kind).toBe('tool');
    if (out.kind !== 'tool') throw new Error('unreachable');
    expect(out.tools).toHaveLength(1);
    const synthetic = out.tools[0] as { toolSpec?: { name?: string } };
    expect(synthetic.toolSpec?.name).toBe(CONVERSE_STRUCTURED_OUTPUT_TOOL_NAME);
    expect(out.toolChoice).toEqual({
      tool: { name: CONVERSE_STRUCTURED_OUTPUT_TOOL_NAME },
    });
  });

  it('falls back to kind=tool on non-Claude families (Nova, Llama, Mistral)', () => {
    const out = applyConverseStructuredOutput(
      withJsonSchema(),
      'us.amazon.nova-pro-v1:0',
      undefined
    );
    expect(out.kind).toBe('tool');
  });

  it('preserves user-supplied tools alongside the synthetic one on fallback', () => {
    const userTool = {
      toolSpec: {
        name: 'get_weather',
        inputSchema: { json: {} as never },
      },
    };
    const out = applyConverseStructuredOutput(
      withJsonSchema(),
      'us.anthropic.claude-3-5-sonnet-20240620-v1:0',
      [userTool]
    );
    expect(out.kind).toBe('tool');
    if (out.kind !== 'tool') throw new Error('unreachable');
    expect(out.tools).toHaveLength(2);
    expect(
      (out.tools[0] as { toolSpec?: { name?: string } }).toolSpec?.name
    ).toBe('get_weather');
    expect(
      (out.tools[1] as { toolSpec?: { name?: string } }).toolSpec?.name
    ).toBe(CONVERSE_STRUCTURED_OUTPUT_TOOL_NAME);
  });

  it('is a no-op (kind=none) for response_format: text', () => {
    const out = applyConverseStructuredOutput(
      {
        ...baseRequest,
        response_format: { type: 'text' },
      } as ChatCompletionCreateParams,
      'us.anthropic.claude-haiku-4-5-20251001-v1:0',
      undefined
    );
    expect(out.kind).toBe('none');
  });

  it('is a no-op for response_format: json_object (no schema)', () => {
    const out = applyConverseStructuredOutput(
      {
        ...baseRequest,
        response_format: { type: 'json_object' } as never,
      } as ChatCompletionCreateParams,
      'us.anthropic.claude-haiku-4-5-20251001-v1:0',
      undefined
    );
    expect(out.kind).toBe('none');
  });
});
