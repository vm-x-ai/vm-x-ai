import { describe, expect, it } from 'vitest';
import { PinoLogger } from 'nestjs-pino';
import { ConfigService } from '@nestjs/config';
import { AWSBedrockConverseDispatcher } from '../../ai-provider/aws-bedrock-converse/shared';
import type { ConverseStreamOutput } from '@aws-sdk/client-bedrock-runtime';
import type { ChatCompletionChunk } from 'openai/resources/index.js';
import type { AIResourceModelConfigEntity } from '../../ai-resource/common/model.entity';

/**
 * T13: stream `reasoningContent` deltas were silently dropped on the
 * Chat→Converse path even though the non-streaming response preserved
 * them. The fix adds a `delta.reasoningContent` branch in
 * `streamConverseToChatCompletionChunks` that surfaces text + signature
 * on `delta.reasoning`.
 *
 * The converter is module-private to `openai-chat-completion.provider`;
 * we reach in via a module-internal import that the test runner
 * resolves the same way the production code does.
 */

import { __TEST_ONLY__streamConverseToChatCompletionChunks } from '../../ai-provider/aws-bedrock-converse/openai-chat-completion.provider';

async function* iter(
  events: ConverseStreamOutput[]
): AsyncIterable<ConverseStreamOutput> {
  for (const e of events) yield e;
}

async function drain<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const e of stream) out.push(e);
  return out;
}

describe('Chat→Converse stream reasoning deltas (T13)', () => {
  // Construct the dispatcher manually with stubbed deps — avoids the
  // `@nestjs/testing` dependency-checks lint rule that fires when
  // tests reach for the NestJS DI container instead of plain `new`.
  const stubLogger = {
    setContext: () => undefined,
    info: () => undefined,
    error: () => undefined,
  } as unknown as PinoLogger;
  const stubConfig = { get: () => undefined } as unknown as ConfigService;
  const dispatcher = new AWSBedrockConverseDispatcher(stubLogger, stubConfig);

  function callConvertStream(
    events: ConverseStreamOutput[]
  ): AsyncIterable<ChatCompletionChunk> {
    const model = {
      model: 'us.anthropic.claude-haiku-4-5',
    } as AIResourceModelConfigEntity;
    return __TEST_ONLY__streamConverseToChatCompletionChunks(
      iter(events),
      model,
      'req-1',
      dispatcher
    );
  }

  it('emits delta.reasoning.thinking on reasoningContent.text deltas', async () => {
    const chunks = await drain(
      callConvertStream([
        { messageStart: { role: 'assistant' } },
        {
          contentBlockDelta: {
            contentBlockIndex: 0,
            delta: { reasoningContent: { text: 'considering options...' } },
          },
        },
      ] as ConverseStreamOutput[])
    );
    const reasoningChunk = chunks.find(
      (c) =>
        (c.choices?.[0]?.delta as { reasoning?: { thinking?: string } })
          ?.reasoning?.thinking
    );
    expect(reasoningChunk).toBeDefined();
    expect(
      (
        reasoningChunk!.choices[0].delta as {
          reasoning?: { thinking?: string };
        }
      ).reasoning?.thinking
    ).toBe('considering options...');
  });

  it('emits delta.reasoning.signature on reasoningContent.signature deltas', async () => {
    const chunks = await drain(
      callConvertStream([
        { messageStart: { role: 'assistant' } },
        {
          contentBlockDelta: {
            contentBlockIndex: 0,
            delta: { reasoningContent: { signature: 'sig-stream' } },
          },
        },
      ] as ConverseStreamOutput[])
    );
    const sigChunk = chunks.find(
      (c) =>
        (c.choices?.[0]?.delta as { reasoning?: { signature?: string } })
          ?.reasoning?.signature
    );
    expect(sigChunk).toBeDefined();
    expect(
      (sigChunk!.choices[0].delta as { reasoning?: { signature?: string } })
        .reasoning?.signature
    ).toBe('sig-stream');
  });
});
