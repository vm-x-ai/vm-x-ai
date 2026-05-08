import { describe, expect, it, vi } from 'vitest';
import { PinoLogger } from 'nestjs-pino';
import { RequestAuditService } from '../../audit/audit.service';
import type { DatabaseService } from '../../storage/database.service';
import type { CreateRequestAuditDto } from '../../audit/dto/create-audit.dto';

/**
 * Integration tests for the multimodal sanitiser inside
 * {@link RequestAuditService.push}. The sanitiser runs synchronously
 * on every push() and replaces base64 image / audio / file bytes with
 * a metadata-only summary so the `request_audit.request_payload` JSONB
 * column doesn't bloat with attachments.
 *
 * The buffer is internal but the test reads it directly — the audit
 * push lifecycle is enough seam for end-to-end verification of the
 * sanitisation transform across every shape we ship support for:
 * OpenAI (image_url + input_audio + file), Anthropic (image base64 +
 * url, tool_result), and Bedrock Converse (image, document).
 */

const tinyPng =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=';

function makeService(): {
  service: RequestAuditService;
  buffer: () => Array<{ payload: Record<string, unknown> }>;
} {
  const logger = {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as PinoLogger;
  // The test never triggers a flush(); the sanitiser runs in push()
  // and writes to the in-memory buffer. A throwing DatabaseService
  // catches accidental flushes (e.g. if a future test pushes >25
  // entries and the threshold flush fires).
  const db = {
    writer: {
      transaction: () => ({
        execute: () => {
          throw new Error(
            'flush() unexpectedly called — sanitisation tests should never trip a DB write'
          );
        },
      }),
    },
  } as unknown as DatabaseService;
  const service = new RequestAuditService(logger, db);
  return {
    service,
    buffer: () =>
      (
        service as unknown as {
          buffer: Array<{ payload: Record<string, unknown> }>;
        }
      ).buffer,
  };
}

const basePayload = (requestPayload: unknown): CreateRequestAuditDto =>
  ({
    workspaceId: 'ws-1',
    environmentId: 'env-1',
    requestId: 'req-1',
    timestamp: new Date(),
    type: 'completion',
    statusCode: 200,
    requestPayload,
    responseData: null,
    responseHeaders: null,
  } as unknown as CreateRequestAuditDto);

describe('RequestAuditService sanitisation', () => {
  describe('OpenAI image_url', () => {
    it('replaces a data: URL with byteSize + sha256 + truncated:true', () => {
      const { service, buffer } = makeService();
      service.push(
        basePayload({
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: 'describe this' },
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:image/png;base64,${tinyPng}`,
                  },
                },
              ],
            },
          ],
        })
      );
      const part = (
        (buffer()[0].payload.requestPayload as Record<string, unknown>)
          .messages as Array<{ content: Array<Record<string, unknown>> }>
      )[0].content[1];
      expect(part).toMatchObject({
        type: 'image_url',
        mediaType: 'image/png',
        truncated: true,
      });
      expect((part as { byteSize: number }).byteSize).toBeGreaterThan(0);
      expect((part as { sha256?: string }).sha256).toMatch(/^[a-f0-9]{64}$/);
    });

    it('marks an external URL as image/external with byteSize 0', () => {
      const { service, buffer } = makeService();
      service.push(
        basePayload({
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image_url',
                  image_url: { url: 'https://example.com/cat.jpg' },
                },
              ],
            },
          ],
        })
      );
      const part = (
        (buffer()[0].payload.requestPayload as Record<string, unknown>)
          .messages as Array<{ content: Array<Record<string, unknown>> }>
      )[0].content[0];
      expect(part).toMatchObject({
        type: 'image_url',
        mediaType: 'image/external',
        byteSize: 0,
        truncated: true,
      });
    });

    it('handles flattened image_url-as-string shape (some SDKs do this)', () => {
      const { service, buffer } = makeService();
      service.push(
        basePayload({
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image_url',
                  image_url: `data:image/jpeg;base64,${tinyPng}`,
                },
              ],
            },
          ],
        })
      );
      const part = (
        (buffer()[0].payload.requestPayload as Record<string, unknown>)
          .messages as Array<{ content: Array<Record<string, unknown>> }>
      )[0].content[0];
      expect(part).toMatchObject({
        type: 'image_url',
        mediaType: 'image/jpeg',
      });
    });
  });

  describe('OpenAI input_audio', () => {
    it('replaces audio bytes with audio/<format> summary', () => {
      const { service, buffer } = makeService();
      service.push(
        basePayload({
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'input_audio',
                  input_audio: { data: tinyPng, format: 'wav' },
                },
              ],
            },
          ],
        })
      );
      const part = (
        (buffer()[0].payload.requestPayload as Record<string, unknown>)
          .messages as Array<{ content: Array<Record<string, unknown>> }>
      )[0].content[0];
      expect(part).toMatchObject({
        type: 'input_audio',
        mediaType: 'audio/wav',
        truncated: true,
      });
    });
  });

  describe('OpenAI file', () => {
    it('replaces file bytes with file/<ext> summary', () => {
      const { service, buffer } = makeService();
      service.push(
        basePayload({
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'file',
                  file: { file_data: tinyPng, filename: 'report.pdf' },
                },
              ],
            },
          ],
        })
      );
      const part = (
        (buffer()[0].payload.requestPayload as Record<string, unknown>)
          .messages as Array<{ content: Array<Record<string, unknown>> }>
      )[0].content[0];
      expect(part).toMatchObject({
        type: 'file',
        mediaType: 'file/pdf',
        truncated: true,
      });
    });

    it('still produces a sanitised mediaType when filename has no extension', () => {
      // With no dot, `split('.').pop()` returns the whole filename —
      // the sanitiser strips path-traversal chars but keeps the bare
      // word as the suffix. Confirms the "filename uses dot-extension"
      // assumption isn't a crash path.
      const { service, buffer } = makeService();
      service.push(
        basePayload({
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'file',
                  file: { file_data: tinyPng, filename: 'noext' },
                },
              ],
            },
          ],
        })
      );
      const part = (
        (buffer()[0].payload.requestPayload as Record<string, unknown>)
          .messages as Array<{ content: Array<Record<string, unknown>> }>
      )[0].content[0];
      expect((part as { mediaType: string }).mediaType).toMatch(/^file\//);
    });
  });

  describe('Anthropic image blocks', () => {
    it('summarises a base64 source with the declared media_type', () => {
      const { service, buffer } = makeService();
      service.push(
        basePayload({
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: 'image/png',
                    data: tinyPng,
                  },
                },
              ],
            },
          ],
        })
      );
      const part = (
        (buffer()[0].payload.requestPayload as Record<string, unknown>)
          .messages as Array<{ content: Array<Record<string, unknown>> }>
      )[0].content[0];
      expect(part).toMatchObject({
        type: 'image',
        mediaType: 'image/png',
        truncated: true,
      });
    });

    it('summarises a url source as image/external with no bytes', () => {
      const { service, buffer } = makeService();
      service.push(
        basePayload({
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: { type: 'url', url: 'https://x.test/y.jpg' },
                },
              ],
            },
          ],
        })
      );
      const part = (
        (buffer()[0].payload.requestPayload as Record<string, unknown>)
          .messages as Array<{ content: Array<Record<string, unknown>> }>
      )[0].content[0];
      expect(part).toMatchObject({
        type: 'image',
        mediaType: 'image/external',
        byteSize: 0,
      });
    });

    it('walks tool_result.content arrays so embedded images are scrubbed too', () => {
      const { service, buffer } = makeService();
      service.push(
        basePayload({
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: 'tu_1',
                  content: [
                    { type: 'text', text: 'see attachment' },
                    {
                      type: 'image',
                      source: {
                        type: 'base64',
                        media_type: 'image/png',
                        data: tinyPng,
                      },
                    },
                  ],
                },
              ],
            },
          ],
        })
      );
      const tr = (
        (buffer()[0].payload.requestPayload as Record<string, unknown>)
          .messages as Array<{ content: Array<Record<string, unknown>> }>
      )[0].content[0] as { content: Array<Record<string, unknown>> };
      expect(tr.content[0]).toMatchObject({
        type: 'text',
        text: 'see attachment',
      });
      expect(tr.content[1]).toMatchObject({
        type: 'image',
        mediaType: 'image/png',
        truncated: true,
      });
    });
  });

  describe('Bedrock Converse blocks', () => {
    it('replaces image bytes with bytesSummary', () => {
      const { service, buffer } = makeService();
      service.push(
        basePayload({
          messages: [
            {
              role: 'user',
              content: [
                {
                  image: {
                    format: 'png',
                    source: { bytes: tinyPng },
                  },
                },
              ],
            },
          ],
        })
      );
      const part = (
        (buffer()[0].payload.requestPayload as Record<string, unknown>)
          .messages as Array<{ content: Array<Record<string, unknown>> }>
      )[0].content[0];
      const summary = (
        part as { image: { source: { bytesSummary: Record<string, unknown> } } }
      ).image.source.bytesSummary;
      expect(summary).toMatchObject({ truncated: true });
      expect(summary.byteSize).toBeGreaterThan(0);
      expect(summary.sha256).toMatch(/^[a-f0-9]{64}$/);
    });

    it('replaces document bytes with bytesSummary while preserving format/name', () => {
      const { service, buffer } = makeService();
      service.push(
        basePayload({
          messages: [
            {
              role: 'user',
              content: [
                {
                  document: {
                    format: 'pdf',
                    name: 'whitepaper',
                    source: { bytes: tinyPng },
                  },
                },
              ],
            },
          ],
        })
      );
      const part = (
        (buffer()[0].payload.requestPayload as Record<string, unknown>)
          .messages as Array<{ content: Array<Record<string, unknown>> }>
      )[0].content[0];
      const doc = (part as { document: Record<string, unknown> }).document;
      expect(doc.format).toBe('pdf');
      expect(doc.name).toBe('whitepaper');
      expect(
        (doc.source as { bytesSummary: Record<string, unknown> }).bytesSummary
      ).toMatchObject({ truncated: true });
    });
  });

  describe('Responses-API input shape', () => {
    it('walks the `input` array (not `messages`) for sanitisation', () => {
      const { service, buffer } = makeService();
      service.push(
        basePayload({
          input: [
            {
              role: 'user',
              content: [
                {
                  type: 'input_image',
                  image_url: `data:image/png;base64,${tinyPng}`,
                },
              ],
            },
          ],
        })
      );
      const part = (
        (buffer()[0].payload.requestPayload as Record<string, unknown>)
          .input as Array<{ content: Array<Record<string, unknown>> }>
      )[0].content[0];
      expect(part).toMatchObject({
        type: 'input_image',
        mediaType: 'image/png',
      });
    });
  });

  describe('passthrough cases', () => {
    it('leaves text-only messages unchanged', () => {
      const { service, buffer } = makeService();
      const original = {
        messages: [{ role: 'user', content: 'plain text only' }],
      };
      service.push(basePayload(original));
      expect(buffer()[0].payload.requestPayload).toEqual(original);
    });

    it('leaves null/undefined requestPayload unchanged', () => {
      const { service, buffer } = makeService();
      service.push(basePayload(null));
      expect(buffer()[0].payload.requestPayload).toBeNull();
    });
  });

  describe('responseHeaders scrubbing', () => {
    it('strips Authorization / set-cookie before storing', () => {
      const { service, buffer } = makeService();
      service.push({
        ...basePayload(null),
        responseHeaders: {
          authorization: 'Bearer leaked',
          'set-cookie': 'session=leak',
          'x-request-id': 'rid-1',
        },
      } as CreateRequestAuditDto);
      expect(buffer()[0].payload.responseHeaders).toEqual({
        'x-request-id': 'rid-1',
      });
    });
  });

  describe('media-type sanitisation', () => {
    it('caps file extension length at 32 chars', () => {
      const { service, buffer } = makeService();
      const longExt = 'a'.repeat(64);
      service.push(
        basePayload({
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'file',
                  file: {
                    file_data: tinyPng,
                    filename: `attack.${longExt}`,
                  },
                },
              ],
            },
          ],
        })
      );
      const part = (
        (buffer()[0].payload.requestPayload as Record<string, unknown>)
          .messages as Array<{ content: Array<Record<string, unknown>> }>
      )[0].content[0];
      const mediaType = (part as { mediaType: string }).mediaType;
      // `file/` prefix (5 chars) + max 32 from the suffix.
      expect(mediaType.length).toBeLessThanOrEqual('file/'.length + 32);
    });

    it('strips path-traversal / control chars from a hostile audio format', () => {
      const { service, buffer } = makeService();
      service.push(
        basePayload({
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'input_audio',
                  input_audio: {
                    data: tinyPng,
                    format: '../etc/passwd\n; DROP',
                  },
                },
              ],
            },
          ],
        })
      );
      const part = (
        (buffer()[0].payload.requestPayload as Record<string, unknown>)
          .messages as Array<{ content: Array<Record<string, unknown>> }>
      )[0].content[0];
      expect((part as { mediaType: string }).mediaType).toMatch(
        /^audio\/[a-z0-9+-]*$/
      );
    });
  });
});
