import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  type GenerateTextResult,
  type InferUIMessageChunk,
  type ToolSet,
  type UIMessage,
} from 'ai';

/**
 * Convert a {@link generateText} result into a Server-Sent-Event
 * response shaped like `streamText().toUIMessageStreamResponse()`, so
 * the same `useChat` hook renders streaming and non-streaming replies
 * identically.
 *
 * The execute callback writes every chunk synchronously — no awaits,
 * no smoothing — so the entire reply lands on the wire in a single
 * burst and `useChat` shows the message in one shot instead of
 * animating it token-by-token. That matches the playground's
 * Streaming-toggle-off semantics: the user gets a non-streaming
 * upstream call, and a non-animated UI render.
 */
export function nonStreamingResultToUIMessageStreamResponse<
  TOOLS extends ToolSet = ToolSet,
  UI_MESSAGE extends UIMessage = UIMessage
>(
  result: GenerateTextResult<TOOLS, never>,
  options: {
    originalMessages?: UI_MESSAGE[];
    sendReasoning?: boolean;
    messageMetadata?: UI_MESSAGE['metadata'];
  } = {}
): Response {
  const stream = createUIMessageStream<UI_MESSAGE>({
    originalMessages: options.originalMessages,
    execute: ({ writer }) => {
      if (options.sendReasoning && result.reasoningText) {
        const rid = 'reasoning-0';
        writer.write({ type: 'reasoning-start', id: rid });
        writer.write({
          type: 'reasoning-delta',
          id: rid,
          delta: result.reasoningText,
        });
        writer.write({ type: 'reasoning-end', id: rid });
      }
      const tid = 'text-0';
      writer.write({ type: 'text-start', id: tid });
      writer.write({ type: 'text-delta', id: tid, delta: result.text });
      writer.write({ type: 'text-end', id: tid });
      if (options.messageMetadata) {
        // The metadata chunk type is inferred from UI_MESSAGE; cast
        // through `InferUIMessageChunk<UI_MESSAGE>` so the writer
        // accepts callers' arbitrary metadata shapes without forcing
        // every BFF route to plumb a typed UIMessage generic through.
        writer.write({
          type: 'message-metadata',
          messageMetadata: options.messageMetadata,
        } as InferUIMessageChunk<UI_MESSAGE>);
      }
    },
  });
  return createUIMessageStreamResponse({ stream });
}
