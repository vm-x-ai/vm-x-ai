import { describe, expect, it } from 'vitest';
import { openAIRequestToAnthropic } from '../../ai-provider/adapters/anthropic-messages.adapter';
import type { ChatCompletionCreateParams } from 'openai/resources/index.js';

/**
 * T8: OpenAI Chat `file` content parts (PDF data URLs) used to be
 * silently dropped on the way to Anthropic. The fix maps them onto
 * Anthropic `document` blocks so PDFs round-trip through
 * Chat→Anthropic→Invoke and Chat→native-Anthropic.
 */

describe('Chat→Anthropic file part → document block (T8)', () => {
  it('emits a document block for an OpenAI file part with base64 PDF data URL', () => {
    const out = openAIRequestToAnthropic({
      model: 'claude',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'summarise this' },
            {
              type: 'file',
              file: {
                file_data: 'data:application/pdf;base64,JVBERi0xLjQK',
                filename: 'spec.pdf',
              },
            },
          ],
        },
      ],
    } as unknown as ChatCompletionCreateParams);
    const userMsg = out.messages.find((m) => m.role === 'user');
    const blocks = userMsg?.content as Array<{
      type?: string;
      source?: { type?: string; media_type?: string; data?: string };
      title?: string;
    }>;
    const doc = blocks?.find((b) => b.type === 'document');
    expect(doc).toBeDefined();
    expect(doc?.source).toMatchObject({
      type: 'base64',
      media_type: 'application/pdf',
      data: 'JVBERi0xLjQK',
    });
    expect(doc?.title).toBe('spec.pdf');
  });

  it('preserves the surrounding text part alongside the document', () => {
    const out = openAIRequestToAnthropic({
      model: 'claude',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'before' },
            {
              type: 'file',
              file: {
                file_data: 'data:application/pdf;base64,AAAA',
              },
            },
            { type: 'text', text: 'after' },
          ],
        },
      ],
    } as unknown as ChatCompletionCreateParams);
    const userMsg = out.messages.find((m) => m.role === 'user');
    const blocks = userMsg?.content as Array<{ type?: string }>;
    const types = blocks?.map((b) => b.type);
    expect(types).toEqual(['text', 'document', 'text']);
  });

  it('omits the document when file part lacks a base64 data URL (file_id-only)', () => {
    const out = openAIRequestToAnthropic({
      model: 'claude',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'hi' },
            { type: 'file', file: { file_id: 'file_abc' } },
          ],
        },
      ],
    } as unknown as ChatCompletionCreateParams);
    const userMsg = out.messages.find((m) => m.role === 'user');
    const blocks = userMsg?.content as Array<{ type?: string }>;
    const types = blocks?.map((b) => b.type);
    expect(types).toEqual(['text']);
  });
});
