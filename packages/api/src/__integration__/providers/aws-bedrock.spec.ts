import { describe, expect, it } from 'vitest';
import type { ChatCompletionCreateParams } from 'openai/resources/index.js';
import { hasKeys, requiredEnv } from '../helpers/env';
import {
  buildBedrockProvider,
  makeConnection,
  makeModel,
} from '../helpers/factories';
import {
  reasoningPrompt,
  simplePrompt,
  toolCallPrompt,
} from '../helpers/scenarios';
import {
  assertNonEmptyText,
  assertToolCall,
  assertUsageNonZero,
  collectStream,
  expectNonStreaming,
  expectStreaming,
} from '../helpers/assertions';
import { isAsyncIterable } from '../../utils/async';

const SHOULD_RUN = hasKeys('AWS_BEDROCK_ROLE_ARN', 'AWS_REGION');
const TEST_MODEL =
  process.env.BEDROCK_TEST_MODEL ??
  'us.anthropic.claude-haiku-4-5-20251001-v1:0';
const TIMEOUT = 60_000;

describe.skipIf(!SHOULD_RUN)('AWS Bedrock Converse provider (live)', () => {
  const provider = buildBedrockProvider();
  const connection = makeConnection('aws-bedrock', {
    iamRoleArn: SHOULD_RUN ? requiredEnv('AWS_BEDROCK_ROLE_ARN') : '',
    region: SHOULD_RUN ? requiredEnv('AWS_REGION') : 'us-east-1',
  });
  const model = makeModel('aws-bedrock', TEST_MODEL);

  it(
    'simple completion (non-streaming)',
    async () => {
      const response = await provider.openAICompletion(
        { ...simplePrompt },
        connection,
        model
      );
      const data = await expectNonStreaming(response);
      assertNonEmptyText(data.choices[0].message.content ?? '');
      assertUsageNonZero(data.usage);
    },
    TIMEOUT
  );

  it(
    'simple completion (streaming)',
    async () => {
      const response = await provider.openAICompletion(
        { ...simplePrompt, stream: true },
        connection,
        model
      );
      const stream = await expectStreaming(response);
      const collected = await collectStream(stream);
      assertNonEmptyText(collected.text);
      assertUsageNonZero(collected.usage);
    },
    TIMEOUT
  );

  it(
    'tool calling (non-streaming)',
    async () => {
      const response = await provider.openAICompletion(
        { ...toolCallPrompt },
        connection,
        model
      );
      const data = await expectNonStreaming(response);
      assertToolCall(data.choices[0].message.tool_calls, 'get_weather');
    },
    TIMEOUT
  );

  it(
    'tool calling (streaming)',
    async () => {
      const response = await provider.openAICompletion(
        { ...toolCallPrompt, stream: true },
        connection,
        model
      );
      const stream = await expectStreaming(response);
      const collected = await collectStream(stream);
      assertToolCall(collected.toolCalls, 'get_weather');
    },
    TIMEOUT
  );

  // ─── Anthropic Messages format (live) ─────────────────────────────
  // Exercises the direct Anthropic↔Converse cell against real Bedrock.
  // Each test asserts on the canonical wire-shape invariants the
  // recent audit added: TextBlock.citations === null, ToolUseBlock.caller
  // === { type: 'direct' }, Usage carries the full 8-field shape.

  it(
    'anthropicMessages: simple non-streaming Message wire shape',
    async () => {
      const response = await provider.anthropicMessages(
        {
          model: TEST_MODEL,
          max_tokens: 32,
          messages: [
            {
              role: 'user',
              content: 'Reply with exactly the word: pong',
            },
          ],
          temperature: 0,
        },
        connection,
        model
      );
      expect(isAsyncIterable(response.data)).toBe(false);
      const msg = response.data as {
        type?: string;
        role?: string;
        content?: Array<{ type?: string; text?: string; citations?: unknown }>;
        usage?: { input_tokens?: number; output_tokens?: number };
        container?: unknown;
      };
      expect(msg.type).toBe('message');
      expect(msg.role).toBe('assistant');
      expect(msg.container).toBeNull();
      const text = msg.content?.find((b) => b.type === 'text');
      expect(text?.citations).toBeNull();
      expect(
        (msg.usage?.input_tokens ?? 0) + (msg.usage?.output_tokens ?? 0)
      ).toBeGreaterThan(0);
    },
    TIMEOUT
  );

  it(
    'anthropicMessages: streaming Message events with message_start/delta/stop',
    async () => {
      const response = await provider.anthropicMessages(
        {
          model: TEST_MODEL,
          max_tokens: 32,
          stream: true,
          messages: [
            {
              role: 'user',
              content: 'Reply with exactly the word: pong',
            },
          ],
          temperature: 0,
        },
        connection,
        model
      );
      expect(isAsyncIterable(response.data)).toBe(true);
      const stream = response.data as AsyncIterable<{
        type?: string;
        [k: string]: unknown;
      }>;
      const events: Array<{ type?: string; [k: string]: unknown }> = [];
      let text = '';
      for await (const event of stream) {
        events.push(event);
        const d = (event as { delta?: { type?: string; text?: string } }).delta;
        if (
          event.type === 'content_block_delta' &&
          d?.type === 'text_delta' &&
          typeof d.text === 'string'
        ) {
          text += d.text;
        }
      }
      const types = events.map((e) => e.type);
      expect(types).toContain('message_start');
      expect(types).toContain('content_block_delta');
      expect(types).toContain('message_delta');
      expect(types).toContain('message_stop');
      assertNonEmptyText(text);
    },
    TIMEOUT
  );

  it(
    'anthropicMessages: tool calling (non-streaming) emits caller: direct',
    async () => {
      const response = await provider.anthropicMessages(
        {
          model: TEST_MODEL,
          max_tokens: 256,
          messages: [
            {
              role: 'user',
              content:
                "What's the current temperature in Tokyo? Use the get_weather tool.",
            },
          ],
          tools: [
            {
              name: 'get_weather',
              description: 'Get the current weather in a city',
              input_schema: {
                type: 'object',
                properties: {
                  location: { type: 'string' },
                },
                required: ['location'],
              },
            },
          ],
          tool_choice: { type: 'auto' },
          temperature: 0,
        },
        connection,
        model
      );
      expect(isAsyncIterable(response.data)).toBe(false);
      const msg = response.data as {
        stop_reason?: string;
        content?: Array<{
          type?: string;
          name?: string;
          caller?: { type?: string };
        }>;
      };
      expect(msg.stop_reason).toBe('tool_use');
      const toolUse = msg.content?.find((b) => b.type === 'tool_use');
      expect(toolUse?.name).toBe('get_weather');
      expect(toolUse?.caller).toEqual({ type: 'direct' });
    },
    TIMEOUT
  );

  it(
    'anthropicMessages: multipart user content (text + base64 image)',
    async () => {
      // Tiny 1x1 red PNG so the request body stays small.
      const oneByOnePng =
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
      const response = await provider.anthropicMessages(
        {
          model: TEST_MODEL,
          max_tokens: 32,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: 'What colour is this single pixel?' },
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: 'image/png',
                    data: oneByOnePng,
                  },
                },
              ],
            },
          ],
          temperature: 0,
        },
        connection,
        model
      );
      expect(isAsyncIterable(response.data)).toBe(false);
      const msg = response.data as {
        content?: Array<{ type?: string; text?: string }>;
      };
      const text = (msg.content ?? [])
        .filter((b) => b.type === 'text')
        .map((b) => b.text ?? '')
        .join('');
      assertNonEmptyText(text);
    },
    TIMEOUT
  );

  it(
    'anthropicMessages: tool_result follow-up multi-turn',
    async () => {
      const response = await provider.anthropicMessages(
        {
          model: TEST_MODEL,
          max_tokens: 128,
          messages: [
            {
              role: 'user',
              content: "What's the temperature in Tokyo?",
            },
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
          tools: [
            {
              name: 'get_weather',
              description: 'Get the current weather in a city',
              input_schema: {
                type: 'object',
                properties: { location: { type: 'string' } },
                required: ['location'],
              },
            },
          ],
          temperature: 0,
        },
        connection,
        model
      );
      expect(isAsyncIterable(response.data)).toBe(false);
      const msg = response.data as {
        content?: Array<{ type?: string; text?: string }>;
      };
      const text = (msg.content ?? [])
        .filter((b) => b.type === 'text')
        .map((b) => b.text ?? '')
        .join('');
      assertNonEmptyText(text);
    },
    TIMEOUT
  );

  it(
    'anthropicMessages: invalid model bubbles a CompletionError with providerRequestPayload',
    async () => {
      const badModel = {
        model: 'us.anthropic.NOPE-NOT-A-MODEL-v1:0',
      } as typeof model;
      await expect(
        provider.anthropicMessages(
          {
            model: 'placeholder',
            max_tokens: 16,
            messages: [{ role: 'user', content: 'hi' }],
          },
          connection,
          badModel
        )
      ).rejects.toMatchObject({
        data: {
          providerRequestPayload: expect.objectContaining({
            modelId: 'us.anthropic.NOPE-NOT-A-MODEL-v1:0',
          }),
        },
      });
    },
    TIMEOUT
  );

  it(
    'openAICompletion: multipart user content (text + image_url data URL) routes through inferConverseImageFormat',
    async () => {
      // 8x8 solid-red PNG — Anthropic's vision pipeline on Bedrock rejects
      // 1x1 transparent PNGs as "Could not process image"; this is the
      // smallest payload that survives the data-URL → ImageBlock path.
      const tinyPngBase64 =
        'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFWEXHbQSACj/P8Fu7N9hAAAAAElFTkSuQmCC';
      const response = await provider.openAICompletion(
        {
          model: 'placeholder',
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: 'Briefly describe this image.' },
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:image/png;base64,${tinyPngBase64}`,
                  },
                },
              ],
            },
          ],
          max_tokens: 64,
          temperature: 0,
        } as ChatCompletionCreateParams,
        connection,
        model
      );
      const data = await expectNonStreaming(response);
      assertNonEmptyText(data.choices[0].message.content ?? '');
      assertUsageNonZero(data.usage);
    },
    TIMEOUT
  );

  it.skip(
    'openAICompletion: json_schema streaming on fallback-tier model unwraps synthetic tool args as content',
    async () => {
      // The Chat→Converse adapter's synthetic-tool fallback fires when
      // the model doesn't match `modelSupportsOutputConfig()` (regex
      // matches Claude 4.5+). On Bedrock today every still-active
      // Anthropic model either:
      //   1. matches the regex (Claude 4.5+ and Sonnet 4.0's
      //      `20250514` minor — regex's `\d{2,}` group catches the
      //      date), so the native `outputConfig.format` path runs;
      //   2. is marked Legacy / EOL (Claude 3.5 Haiku/Sonnet, Claude 3
      //      Opus), so AWS returns a 400 `invalid model identifier` or
      //      a Legacy-access-denied error.
      // The synthetic-tool fallback PATH itself is fully exercised by
      // the unit-test suite under `aws-bedrock-converse/`. This live
      // cell is skipped until Anthropic ships a Bedrock model on a
      // version that the regex misses (e.g. a hypothetical Claude
      // 4.4.x). Skip rather than delete so the intent is preserved.
    },
    TIMEOUT
  );

  it(
    'openAICompletion: reasoning_effort=medium maps to thinking.budget_tokens and emits reasoning content',
    async () => {
      // Sonnet 4.5 is the only consistently-available Bedrock model that
      // honours `thinking` and surfaces reasoningContent in the Converse
      // response — Haiku 4.5 routes the budget but doesn't always emit
      // a reasoning block.
      const thinkingModel = makeModel(
        'aws-bedrock',
        'us.anthropic.claude-sonnet-4-5-20250929-v1:0'
      );
      const response = await provider.openAICompletion(
        {
          ...reasoningPrompt,
          reasoning_effort: 'medium',
        } as ChatCompletionCreateParams,
        connection,
        thinkingModel
      );
      const data = await expectNonStreaming(response);
      assertNonEmptyText(data.choices[0].message.content ?? '');
      assertUsageNonZero(data.usage);
      const message = data.choices[0].message as unknown as {
        reasoning?: {
          thinking?: string;
          signature?: string;
          redacted?: string[];
        };
      };
      expect(message.reasoning).toBeDefined();
      const hasThinkingText =
        typeof message.reasoning?.thinking === 'string' &&
        message.reasoning.thinking.trim().length > 0;
      const hasRedacted =
        Array.isArray(message.reasoning?.redacted) &&
        (message.reasoning?.redacted?.length ?? 0) > 0;
      expect(hasThinkingText || hasRedacted).toBe(true);
    },
    TIMEOUT
  );
});
