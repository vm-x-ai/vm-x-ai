import { Injectable } from '@nestjs/common';
import { getEncoding, Tiktoken } from 'js-tiktoken';
import { PinoLogger } from 'nestjs-pino';
import { ChatCompletionCreateParams } from 'openai/resources/index.js';
import type { ResponseCreateParams } from 'openai/resources/responses/responses.js';
import type { AnthropicMessagesRequest } from '../gateway/anthropic/anthropic.types';

@Injectable()
export class TokenService {
  private encoding: Tiktoken;

  constructor(private readonly logger: PinoLogger) {
    const startTime = Date.now();
    this.logger.info('Initializing token service');
    this.encoding = getEncoding('o200k_base');
    this.logger.info(
      {
        duration: Date.now() - startTime,
      },
      'Token service initialized'
    );
  }

  /**
   * **Default** request-token estimator. Takes the gateway's canonical
   * Responses-shape body. All three public endpoints normalize their
   * inbound bodies to Responses before reaching the orchestrator's
   * routing/gating step, so this is the single shape token counting
   * needs to support post-canonical-flip.
   *
   * Currently all three formats run through the same tiktoken
   * `o200k_base` encoder for accounting purposes — model-specific
   * tokenization is approximate either way without per-model encoders.
   * The per-format API surface (`getRequestTokensFromChatCompletions`
   * / `getRequestTokensFromAnthropic`) stays around for callers that
   * already hold a non-canonical shape and don't want to re-convert.
   */
  getRequestTokens(req: ResponseCreateParams): number {
    let n = 3;
    if (typeof req.instructions === 'string') {
      n += this.encoding.encode(req.instructions).length;
    }
    const inputItems = Array.isArray(req.input)
      ? req.input
      : [{ type: 'message', role: 'user', content: req.input ?? '' }];
    for (const item of inputItems) {
      n += this.tokenizeAny(item);
    }
    if (req.tools) n += this.encoding.encode(JSON.stringify(req.tools)).length;
    return n;
  }

  getRequestTokensFromAnthropic(req: AnthropicMessagesRequest): number {
    let n = 3;
    if (typeof req.system === 'string') {
      n += this.encoding.encode(req.system).length;
    } else if (Array.isArray(req.system)) {
      for (const block of req.system) {
        n += this.tokenizeAny(block);
      }
    }
    for (const m of req.messages) {
      n += this.tokenizeAny(m);
    }
    if (req.tools) n += this.encoding.encode(JSON.stringify(req.tools)).length;
    return n;
  }

  private tokenizeAny(value: unknown): number {
    if (value == null) return 0;
    return this.encoding.encode(this.toEncodableString(value)).length;
  }

  /**
   * Legacy Chat-Completions-shape token estimator. Used by callers
   * that hold a CC body and don't want to convert to Responses just
   * for an accounting count (today: only the integration test suite's
   * token-counter spec, which exercises the CC walk directly).
   */
  getRequestTokensFromChatCompletions(request: ChatCompletionCreateParams) {
    const tokensPerMessage = 3;
    const tokensPerName = 1;
    let numTokens = 3;

    for (const message of request.messages) {
      numTokens += tokensPerMessage;

      for (const [key, value] of Object.entries(message)) {
        if (key === 'tool_calls' && value) {
          numTokens += this.encoding.encode(JSON.stringify(value)).length;
          continue;
        }
        if (key === 'name') {
          numTokens += tokensPerName;
        }

        if (value === null || value === undefined) continue;
        numTokens += this.encoding.encode(this.toEncodableString(value)).length;
      }
    }

    return numTokens;
  }

  /**
   * Coerce a message field value into something `tiktoken.encode` can
   * actually consume (a plain string).
   *
   * The Chat Completions message shape allows `content` to be either a
   * string OR an array of content parts (`[{type:'text', text:'...'},
   * {type:'image_url', ...}]`). The Responses-API converter produces
   * the array form when the caller sends typed `input_text` / `output_text`
   * content blocks. tiktoken's `encode` calls `text.match` on its input,
   * so passing an array straight through throws "text.match is not a
   * function". Flatten arrays to their concatenated `text` parts;
   * stringify everything else.
   */
  private toEncodableString(value: unknown): string {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) {
      return value
        .map((part) => {
          if (typeof part === 'string') return part;
          if (
            part &&
            typeof part === 'object' &&
            'text' in part &&
            typeof (part as { text?: unknown }).text === 'string'
          ) {
            return (part as { text: string }).text;
          }
          // Object content parts other than text (image_url, file,
          // tool_use, tool_result, thinking, etc.) — fall back to
          // JSON.stringify so the bytes contribute to the count rather
          // than being silently dropped. Slight over-count from JSON
          // syntax is acceptable for accounting purposes.
          if (part && typeof part === 'object') return JSON.stringify(part);
          return '';
        })
        .join('\n');
    }
    if (value && typeof value === 'object') {
      // Message-like objects: prefer extracting `content` (string or
      // array) over a full JSON dump so token counts roughly match
      // the OpenAI-shape counter.
      const obj = value as { content?: unknown };
      if (typeof obj.content === 'string' || Array.isArray(obj.content)) {
        return this.toEncodableString(obj.content);
      }
      return JSON.stringify(value);
    }
    return JSON.stringify(value);
  }
}
