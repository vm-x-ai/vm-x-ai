import { describe, expect, it } from 'vitest';
import type {
  ChatCompletion,
  ChatCompletionChunk,
} from 'openai/resources/index.js';
import type { ResponseStreamEvent } from 'openai/resources/responses/responses';
import { hasKeys, requiredEnv } from '../helpers/env';
import {
  buildBedrockInvokeProvider,
  buildOpenAIProvider,
  makeConnection,
  makeModel,
} from '../helpers/factories';
import {
  chatCompletionStreamToResponseStream,
  chatCompletionToResponse,
  responsesRequestToChatCompletion,
} from '../../gateway/responses/responses-converter';
import { isAsyncIterable } from '../../utils/async';

const TIMEOUT = 60_000;

/**
 * End-to-end Responses API integration: drive a real provider's chat
 * completion through the request converter on the way in and the response
 * converter on the way out, asserting the events that multi-turn agent
 * loops actually switch on.
 *
 * This complements `responses/converter.spec.ts` (which uses synthetic
 * streams) by confirming the converter handles the real-world cadence
 * and shape of provider chunks — variable token boundaries, separated
 * usage chunks, role-only first chunks, etc.
 */

const RUN_OPENAI = hasKeys('OPENAI_API_KEY');
const RUN_BEDROCK = hasKeys('AWS_BEDROCK_ROLE_ARN', 'AWS_REGION');

const OPENAI_MODEL = process.env.OPENAI_TEST_MODEL ?? 'gpt-4o-mini';
const BEDROCK_INVOKE_MODEL =
  process.env.BEDROCK_INVOKE_TEST_MODEL ??
  'us.anthropic.claude-haiku-4-5-20251001-v1:0';

describe.skipIf(!RUN_OPENAI)(
  'Responses API end-to-end via OpenAI (live)',
  () => {
    const provider = buildOpenAIProvider();
    const connection = makeConnection('openai', {
      apiKey: RUN_OPENAI ? requiredEnv('OPENAI_API_KEY') : '',
    });
    const model = makeModel('openai', OPENAI_MODEL);

    it(
      'non-streaming: Responses request → chat → Response with usage details',
      async () => {
        const chatRequest = responsesRequestToChatCompletion({
          model: 'default',
          input: 'Reply with exactly the word: pong',
          temperature: 0,
          max_output_tokens: 16,
        });
        const completionResponse = await provider.openAICompletion(
          chatRequest,
          connection,
          model
        );
        expect(isAsyncIterable(completionResponse.data)).toBe(false);

        const chat = completionResponse.data as ChatCompletion;
        const response = chatCompletionToResponse(
          chat,
          'resp_e2e_1',
          Math.floor(Date.now() / 1000),
          OPENAI_MODEL
        );

        expect(response.status).toBe('completed');
        expect(response.output.length).toBeGreaterThan(0);
        const messageItem = response.output.find((i) => i.type === 'message');
        expect(
          messageItem,
          'response missing message output item'
        ).toBeDefined();
        expect(response.usage?.input_tokens).toBeGreaterThan(0);
        expect(response.usage?.output_tokens).toBeGreaterThan(0);
        // Detail fields should be present even if zero.
        expect(response.usage?.input_tokens_details).toBeDefined();
        expect(response.usage?.output_tokens_details).toBeDefined();
      },
      TIMEOUT
    );

    it(
      'streaming: real provider chunks → Responses event sequence',
      async () => {
        const chatRequest = responsesRequestToChatCompletion({
          model: 'default',
          input: 'Count from 1 to 3, separated by commas. No other text.',
          stream: true,
          temperature: 0,
          max_output_tokens: 32,
        });
        const completionResponse = await provider.openAICompletion(
          chatRequest as typeof chatRequest & { stream: true },
          connection,
          model
        );
        expect(isAsyncIterable(completionResponse.data)).toBe(true);

        const events: ResponseStreamEvent[] = [];
        for await (const ev of chatCompletionStreamToResponseStream(
          completionResponse.data as AsyncIterable<ChatCompletionChunk>,
          'resp_e2e_stream',
          Math.floor(Date.now() / 1000),
          OPENAI_MODEL
        )) {
          events.push(ev);
        }

        const types = events.map((e) => (e as { type?: string }).type);

        // The exact event types a streaming agent dispatcher reacts to:
        expect(types).toContain('response.created');
        expect(types).toContain('response.in_progress');
        expect(types).toContain('response.output_text.delta');
        expect(types).toContain('response.content_part.done');
        expect(types).toContain('response.completed');

        // Reconstructed text should be non-empty and contain the digits.
        const reconstructed = events
          .filter(
            (e) =>
              (e as { type?: string }).type === 'response.output_text.delta'
          )
          .map((e) => (e as { delta?: string }).delta ?? '')
          .join('');
        expect(reconstructed.length).toBeGreaterThan(0);
        expect(reconstructed).toMatch(/1.*2.*3/);

        // Final completed event must carry usage with input/output tokens.
        const completed = events.find(
          (e) => (e as { type?: string }).type === 'response.completed'
        ) as {
          response: {
            usage: { input_tokens: number; output_tokens: number };
          };
        };
        expect(completed).toBeDefined();
        expect(completed.response.usage.input_tokens).toBeGreaterThan(0);
        expect(completed.response.usage.output_tokens).toBeGreaterThan(0);
      },
      TIMEOUT
    );

    it(
      'tool calling: function_call_arguments deltas reach completion',
      async () => {
        const chatRequest = responsesRequestToChatCompletion({
          model: 'default',
          input: "What's the temperature in Tokyo? Use the get_weather tool.",
          stream: true,
          temperature: 0,
          tools: [
            {
              type: 'function',
              name: 'get_weather',
              description: 'Get the current weather in a city',
              parameters: {
                type: 'object',
                properties: {
                  location: { type: 'string' },
                },
                required: ['location'],
              },
              strict: null,
            },
          ] as unknown as Parameters<
            typeof responsesRequestToChatCompletion
          >[0]['tools'],
        });
        const completionResponse = await provider.openAICompletion(
          chatRequest as typeof chatRequest & { stream: true },
          connection,
          model
        );
        expect(isAsyncIterable(completionResponse.data)).toBe(true);

        const events: ResponseStreamEvent[] = [];
        for await (const ev of chatCompletionStreamToResponseStream(
          completionResponse.data as AsyncIterable<ChatCompletionChunk>,
          'resp_e2e_tool',
          Math.floor(Date.now() / 1000),
          OPENAI_MODEL
        )) {
          events.push(ev);
        }
        const types = events.map((e) => (e as { type?: string }).type);

        expect(types).toContain('response.output_item.added');
        expect(types).toContain('response.function_call_arguments.delta');
        expect(types).toContain('response.function_call_arguments.done');
        expect(types).toContain('response.completed');

        // Validate the accumulated arguments parse as JSON with `location`.
        const argsDeltas = events
          .filter(
            (e) =>
              (e as { type?: string }).type ===
              'response.function_call_arguments.delta'
          )
          .map((e) => (e as { delta?: string }).delta ?? '')
          .join('');
        expect(() => JSON.parse(argsDeltas)).not.toThrow();
        const parsed = JSON.parse(argsDeltas);
        expect(typeof parsed.location).toBe('string');
      },
      TIMEOUT
    );
  }
);

describe.skipIf(!RUN_BEDROCK)(
  'Responses API end-to-end via Bedrock Invoke (Claude on Anthropic Messages wire) (live)',
  () => {
    const provider = buildBedrockInvokeProvider();
    const connection = makeConnection('aws-bedrock-invoke', {
      iamRoleArn: RUN_BEDROCK ? requiredEnv('AWS_BEDROCK_ROLE_ARN') : '',
      region: RUN_BEDROCK ? requiredEnv('AWS_REGION') : 'us-east-1',
    });
    const model = makeModel('aws-bedrock-invoke', BEDROCK_INVOKE_MODEL);

    it(
      'streaming: Anthropic SSE → Responses events with usage',
      async () => {
        // The exact path agents take when targeting Claude on AWS:
        // bedrock/invoke/<claude> through the Responses API.
        const chatRequest = responsesRequestToChatCompletion({
          model: 'default',
          input: 'Reply with the single word "pong" and nothing else.',
          stream: true,
          temperature: 0,
          max_output_tokens: 16,
        });
        const completionResponse = await provider.openAICompletion(
          chatRequest as typeof chatRequest & { stream: true },
          connection,
          model
        );
        expect(isAsyncIterable(completionResponse.data)).toBe(true);

        const events: ResponseStreamEvent[] = [];
        for await (const ev of chatCompletionStreamToResponseStream(
          completionResponse.data as AsyncIterable<ChatCompletionChunk>,
          'resp_bedrock_e2e',
          Math.floor(Date.now() / 1000),
          BEDROCK_INVOKE_MODEL
        )) {
          events.push(ev);
        }
        const types = events.map((e) => (e as { type?: string }).type);

        // Verify the same event sequence multi-turn agent loops rely on.
        expect(types).toContain('response.created');
        expect(types).toContain('response.output_text.delta');
        expect(types).toContain('response.completed');

        const completed = events.find(
          (e) => (e as { type?: string }).type === 'response.completed'
        ) as {
          response: {
            usage: { input_tokens: number; output_tokens: number };
          };
        };
        expect(completed).toBeDefined();
        expect(completed.response.usage.input_tokens).toBeGreaterThan(0);
        expect(completed.response.usage.output_tokens).toBeGreaterThan(0);
      },
      TIMEOUT
    );
  }
);
