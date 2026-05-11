import { expect } from 'vitest';
import type {
  ChatCompletion,
  ChatCompletionChunk,
} from 'openai/resources/index.js';
import { isAsyncIterable } from '../../utils/async';
import type { CompletionResponse } from '../../ai-provider/ai-provider.types';

export type CollectedStream = {
  chunks: ChatCompletionChunk[];
  text: string;
  toolCalls: Array<{
    id: string;
    name: string;
    arguments: string;
  }>;
  finishReason: string | null;
  usage: ChatCompletionChunk['usage'];
};

/**
 * Drain an async iterable of ChatCompletionChunks and reconstruct the final
 * assistant message. Mirrors what an OpenAI-SDK consumer would compose.
 */
export async function collectStream(
  data: AsyncIterable<ChatCompletionChunk>
): Promise<CollectedStream> {
  const chunks: ChatCompletionChunk[] = [];
  let text = '';
  let finishReason: string | null = null;
  let usage: ChatCompletionChunk['usage'];
  // tool calls are streamed in deltas keyed by index; accumulate.
  const toolCallsByIndex = new Map<
    number,
    { id?: string; name: string; arguments: string }
  >();

  for await (const chunk of data) {
    chunks.push(chunk);
    if (chunk.usage) usage = chunk.usage;

    const choice = chunk.choices?.[0];
    if (!choice) continue;

    if (typeof choice.delta?.content === 'string') {
      text += choice.delta.content;
    }
    if (choice.delta?.tool_calls?.length) {
      for (const tc of choice.delta.tool_calls) {
        const idx = tc.index;
        const acc = toolCallsByIndex.get(idx) ?? { name: '', arguments: '' };
        if (tc.id) acc.id = tc.id;
        if (tc.function?.name) acc.name = tc.function.name;
        if (tc.function?.arguments) acc.arguments += tc.function.arguments;
        toolCallsByIndex.set(idx, acc);
      }
    }
    if (choice.finish_reason) finishReason = choice.finish_reason;
  }

  const toolCalls = [...toolCallsByIndex.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, v]) => ({
      id: v.id ?? '',
      name: v.name,
      arguments: v.arguments,
    }));

  return { chunks, text, toolCalls, finishReason, usage };
}

export function assertNonEmptyText(
  text: string,
  contextLabel = 'response'
): void {
  expect(text, `${contextLabel} text was empty`).toBeTruthy();
  expect(
    text.trim().length,
    `${contextLabel} text was whitespace`
  ).toBeGreaterThan(0);
}

export function assertUsageNonZero(
  usage: ChatCompletion['usage'] | ChatCompletionChunk['usage']
): void {
  expect(usage, 'usage missing').toBeDefined();
  expect(usage!.prompt_tokens).toBeGreaterThan(0);
  expect(usage!.completion_tokens).toBeGreaterThan(0);
  expect(usage!.total_tokens).toBeGreaterThan(0);
}

export function assertToolCall(
  toolCalls:
    | Array<{ id: string; name: string; arguments: string }>
    | ChatCompletion['choices'][number]['message']['tool_calls']
    | undefined,
  expectedName: string
): void {
  expect(toolCalls, 'no tool calls in response').toBeTruthy();
  expect(toolCalls!.length).toBeGreaterThan(0);
  // OpenAI shape: ChatCompletionMessageToolCall has function.name; our
  // collected shape has name directly. Handle both.
  const first = toolCalls![0] as {
    id?: string;
    name?: string;
    arguments?: string;
    type?: string;
    function?: { name: string; arguments: string };
  };
  const name = first.name ?? first.function?.name;
  const args = first.arguments ?? first.function?.arguments;
  expect(name, 'tool call name').toBe(expectedName);
  expect(args, 'tool call arguments').toBeTruthy();
  // Should be valid JSON
  expect(() => JSON.parse(args!)).not.toThrow();
}

/**
 * Convenience: split a `CompletionResponse` into its streaming/non-streaming
 * variants without runtime confusion.
 */
export async function expectNonStreaming(
  response: CompletionResponse
): Promise<ChatCompletion> {
  expect(isAsyncIterable(response.data)).toBe(false);
  return response.data as ChatCompletion;
}

export async function expectStreaming(
  response: CompletionResponse
): Promise<AsyncIterable<ChatCompletionChunk>> {
  expect(isAsyncIterable(response.data)).toBe(true);
  return response.data as AsyncIterable<ChatCompletionChunk>;
}

/**
 * Parse the assistant text as JSON and validate shape for structured-output
 * tests. Throws an assertion failure with the offending payload so debugging
 * a real model regression is straightforward.
 */
export function assertStructuredOutput<T>(
  content: string | null | undefined,
  validator: (parsed: unknown) => parsed is T
): T {
  expect(content, 'structured output content was empty').toBeTruthy();
  let parsed: unknown;
  try {
    parsed = JSON.parse(content!);
  } catch (err) {
    throw new Error(
      `structured output was not valid JSON: ${(err as Error).message}\n` +
        `content: ${content}`
    );
  }
  expect(
    validator(parsed),
    `structured output did not match expected shape; got: ${JSON.stringify(
      parsed
    )}`
  ).toBe(true);
  return parsed as T;
}
