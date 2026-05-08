/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../storage/database.service';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PinoLogger } from 'nestjs-pino';
import { ListAuditQueryDto, ListAuditResponseDto } from './dto/list-audit.dto';
import { UserEntity } from '../users/entities/user.entity';
import { CreateRequestAuditDto } from './dto/create-audit.dto';
import { RequestAuditEntity } from './entities/audit.entity';
import { sql } from 'kysely';
import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'crypto';

// `OmitType` from `@nestjs/mapped-types` returns a class whose static type
// loses the original property declarations once you intersect it with
// `& { id: string }`, so spelling the buffer payload out as the full
// `RequestAuditEntity` keeps strict-mode `tsc` happy without any casts.
type BufferItem = {
  payload: RequestAuditEntity;
  attempts?: number;
};

@Injectable()
export class RequestAuditService {
  private buffer: BufferItem[] = [];
  private flushing = false;

  constructor(
    private readonly logger: PinoLogger,
    private readonly db: DatabaseService
  ) {}

  public async get(
    workspaceId: string,
    environmentId: string,
    query: ListAuditQueryDto,
    user: UserEntity
  ): Promise<ListAuditResponseDto> {
    const pageSize = query.pageSize ?? 100;
    const pageIndex = query.pageIndex ?? 0;
    // `metadataFilters` arrives URL-encoded as a JSON object whose
    // values are either single strings (legacy single-value filter) or
    // string arrays (multi-value filter from the unified UI). Both
    // shapes normalise to `string[]` so the SQL builder is uniform —
    // a single value still goes through `IN (...)` with one element.
    const metadataFilters: Record<string, string[]> = {};
    if (query.metadataFilters) {
      try {
        const parsed = JSON.parse(query.metadataFilters);
        if (parsed && typeof parsed === 'object') {
          for (const [k, v] of Object.entries(parsed)) {
            if (typeof v === 'string' && v) {
              metadataFilters[k] = [v];
            } else if (Array.isArray(v)) {
              const filtered = v.filter(
                (entry): entry is string =>
                  typeof entry === 'string' && entry.length > 0
              );
              if (filtered.length > 0) metadataFilters[k] = filtered;
            }
          }
        }
      } catch {
        // Malformed JSON falls through silently — matches the rest of the
        // permissive query-param parsing in this DTO.
      }
    }
    if (query.metadataKey && query.metadataValue) {
      metadataFilters[query.metadataKey] = [
        ...(metadataFilters[query.metadataKey] ?? []),
        query.metadataValue,
      ];
    }
    const metadataEntries = Object.entries(metadataFilters);

    const data = await this.db.reader
      .selectFrom('requestAudit')
      .selectAll('requestAudit')
      .select([sql<number>`COUNT(*) OVER ()`.as('total')])
      .innerJoin(
        'workspaceUsers',
        'requestAudit.workspaceId',
        'workspaceUsers.workspaceId'
      )
      .where('requestAudit.workspaceId', '=', workspaceId)
      .where('requestAudit.environmentId', '=', environmentId)
      .where('workspaceUsers.userId', '=', user.id)
      .$if(!!query.type, (qb) =>
        qb.where('requestAudit.type', '=', query.type!)
      )
      .$if(!!query.connectionId, (qb) =>
        qb.where('requestAudit.connectionId', '=', query.connectionId!)
      )
      .$if(!!query.resourceId, (qb) =>
        qb.where('requestAudit.resourceId', '=', query.resourceId!)
      )
      .$if(!!query.requestId, (qb) =>
        qb.where('requestAudit.requestId', '=', query.requestId!)
      )
      .$if(!!query.model, (qb) =>
        qb.where('requestAudit.model', '=', query.model!)
      )
      .$if(!!query.statusCode, (qb) =>
        qb.where('requestAudit.statusCode', '=', query.statusCode!)
      )
      .$if(!!query.startDate, (qb) =>
        qb.where('requestAudit.timestamp', '>=', query.startDate!)
      )
      .$if(!!query.endDate, (qb) =>
        qb.where('requestAudit.timestamp', '<=', query.endDate!)
      )
      .$if(metadataEntries.length > 0, (qb) =>
        metadataEntries.reduce(
          (acc, [k, vs]) =>
            acc.where(sql`request_audit.metadata->>${sql.lit(k)}`, 'in', vs),
          qb
        )
      )
      .orderBy('requestAudit.timestamp', 'desc')
      .limit(pageSize)
      .offset(pageIndex * pageSize)
      .execute();

    return {
      total: data[0]?.total ?? 0,
      pageIndex,
      pageSize,
      // Kysely's column types (JsonValue for jsonb, etc.) don't quite match
      // the class-validator-decorated entity shape, but the runtime structure
      // is compatible — class-transformer round-trips on the controller side.
      data: data.map(({ total, ...item }) => item) as RequestAuditEntity[],
    };
  }

  /**
   * Returns the distinct metadata keys observed in requestAudit rows for
   * the workspace/environment. Used by the audit UI to populate the dynamic
   * metadata-filter selector. Range-restricted to recent rows so the GIN
   * index on `metadata` stays useful even when the table is huge.
   */
  public async getMetadataKeys(
    workspaceId: string,
    environmentId: string,
    user: UserEntity,
    sinceDays = 30
  ): Promise<string[]> {
    const since = new Date();
    since.setDate(since.getDate() - sinceDays);

    const rows = await this.db.reader
      .selectFrom('requestAuditMetadata')
      .innerJoin(
        'workspaceUsers',
        'requestAuditMetadata.workspaceId',
        'workspaceUsers.workspaceId'
      )
      .where('requestAuditMetadata.workspaceId', '=', workspaceId)
      .where('requestAuditMetadata.environmentId', '=', environmentId)
      .where('workspaceUsers.userId', '=', user.id)
      .where('requestAuditMetadata.timestamp', '>=', since)
      .select('requestAuditMetadata.key')
      .distinct()
      .orderBy('requestAuditMetadata.key')
      .execute();

    return rows.map((r) => r.key);
  }

  /**
   * Returns the distinct values observed for a given metadata key in the
   * workspace/environment over the recent window. Capped at 1000 values
   * to keep the autocomplete payload bounded — for high-cardinality keys
   * (request_id, correlationId-as-metadata, etc.) the user can still
   * type freely thanks to the UI's `freeSolo`.
   */
  public async getMetadataValues(
    workspaceId: string,
    environmentId: string,
    key: string,
    user: UserEntity,
    sinceDays = 30
  ): Promise<string[]> {
    const since = new Date();
    since.setDate(since.getDate() - sinceDays);

    const rows = await this.db.reader
      .selectFrom('requestAuditMetadata')
      .innerJoin(
        'workspaceUsers',
        'requestAuditMetadata.workspaceId',
        'workspaceUsers.workspaceId'
      )
      .where('requestAuditMetadata.workspaceId', '=', workspaceId)
      .where('requestAuditMetadata.environmentId', '=', environmentId)
      .where('workspaceUsers.userId', '=', user.id)
      .where('requestAuditMetadata.timestamp', '>=', since)
      .where('requestAuditMetadata.key', '=', key)
      .select('requestAuditMetadata.value')
      .distinct()
      .orderBy('requestAuditMetadata.value')
      .limit(1000)
      .execute();

    return rows.map((r) => r.value);
  }

  public push(payload: CreateRequestAuditDto) {
    this.buffer.push({
      payload: {
        ...payload,
        id: uuidv4(),
        // Strip base64 bytes from multimodal message parts before
        // storing — replace with a metadata-only summary so audit rows
        // stay small (and don't carry PII'd / sensitive bytes around).
        // The live request to the provider keeps the full bytes; only
        // this audit-row copy is sanitized.
        requestPayload: payload.requestPayload
          ? (sanitizeMultimodalRequestPayload(
              payload.requestPayload
            ) as typeof payload.requestPayload)
          : payload.requestPayload,
        // `providerRequestPayload` is the body the provider's SDK saw
        // post-conversion (or unchanged on passthrough). Same sanitiser
        // applies — it walks both `messages` and `input` array shapes.
        providerRequestPayload: payload.providerRequestPayload
          ? sanitizeMultimodalRequestPayload(payload.providerRequestPayload)
          : payload.providerRequestPayload,
        // Strip auth headers / cookies the provider may have echoed
        // back. The audit row never needs them and we don't want
        // upstream credentials sitting in JSONB.
        responseHeaders: filterAuditResponseHeaders(
          payload.responseHeaders as Record<string, string> | null | undefined
        ),
      },
    });

    if (this.buffer.length >= 25) {
      this.flush();
    }
  }

  @Cron(CronExpression.EVERY_10_SECONDS, { name: 'request-audit-flush' })
  public async flush() {
    if (this.buffer.length === 0 || this.flushing) {
      return;
    }

    this.flushing = true;
    const bufferLength = this.buffer.length;
    const transit = [...this.buffer];

    try {
      await this.db.writer.transaction().execute(async (trx) => {
        await trx
          .insertInto('requestAudit')
          .values(
            transit.map(({ payload }) => ({
              ...payload,
              requestPayload: JSON.stringify(payload.requestPayload),
              providerRequestPayload:
                payload.providerRequestPayload !== undefined &&
                payload.providerRequestPayload !== null
                  ? JSON.stringify(payload.providerRequestPayload)
                  : null,
              responseData: JSON.stringify(payload.responseData),
              responseHeaders: JSON.stringify(payload.responseHeaders),
              events: JSON.stringify(payload.events),
              metadata: payload.metadata
                ? JSON.stringify(payload.metadata)
                : null,
              cost: payload.cost ? JSON.stringify(payload.cost) : null,
              errorCount: payload.errorCount ?? 0,
              successCount: payload.successCount ?? 0,
            }))
          )
          .execute();

        const metadataRows = transit.flatMap(({ payload }) => {
          if (!payload.metadata) return [];
          return Object.entries(payload.metadata)
            .filter(
              ([, value]) =>
                value !== null && value !== undefined && value !== ''
            )
            .map(([key, value]) => ({
              auditId: payload.id,
              key,
              value: String(value),
              workspaceId: payload.workspaceId,
              environmentId: payload.environmentId,
              timestamp: payload.timestamp,
              connectionId: payload.connectionId ?? null,
              resourceId: payload.resourceId ?? null,
              provider: payload.provider ?? null,
              model: payload.model ?? null,
              promptTokens: payload.promptTokens ?? null,
              outputTokens: payload.outputTokens ?? null,
              totalTokens: payload.totalTokens ?? null,
              cachedTokens: payload.cachedTokens ?? null,
              reasoningTokens: payload.reasoningTokens ?? null,
              requestDuration: payload.requestDuration ?? null,
              totalCost: payload.cost?.totalCost ?? null,
              errorCount: payload.errorCount ?? 0,
              successCount: payload.successCount ?? 0,
            }));
        });

        if (metadataRows.length > 0) {
          await trx
            .insertInto('requestAuditMetadata')
            .values(metadataRows)
            .execute();
        }
      });
      this.logger.info(`Flushed ${transit.length} items`);

      this.buffer.splice(0, bufferLength);
    } catch (error) {
      this.logger.error(`Failed to flush completion audit: ${error}`);
      this.buffer.splice(0, bufferLength);
      // `attempts` is undefined on first-time failures. The previous
      // `item.attempts && item.attempts > 3` predicate short-circuits
      // to undefined (falsy) for those items, so they matched
      // *neither* the drop nor the retry filter and were silently
      // discarded. `(item.attempts ?? 0)` treats first-time failures
      // as attempt 0 so they correctly join the retry queue.
      const MAX_RETRIES = 3;
      const dropItems = transit.filter(
        (item) => (item.attempts ?? 0) > MAX_RETRIES
      );
      this.logger.error(`Dropped ${dropItems.length} items`);
      const retryItems = transit.filter(
        (item) => (item.attempts ?? 0) <= MAX_RETRIES
      );
      this.buffer.push(
        ...retryItems.map((item) => ({
          ...item,
          attempts: (item.attempts ?? 0) + 1,
        }))
      );
      this.logger.error(`Pushed ${retryItems.length} items back to buffer`);
      this.logger.error(`Buffer now has ${this.buffer.length} items`);
    } finally {
      this.flushing = false;
    }
  }
}

/**
 * Walk a `CompletionRequestDto`-shaped payload and replace any multimodal
 * `content[]` entry that carries inline bytes (`data:` URL or `base64`
 * field) with a metadata-only summary `{ type, mediaType, byteSize, sha256 }`.
 *
 * Why: a 50 MB image-attached chat request would otherwise bloat the
 * `request_audit.request_payload` JSONB column with redundant bytes the
 * audit table never needs to render. We keep enough metadata to identify
 * what was sent (mime type, size, content hash) for compliance + drift
 * investigation, drop the bytes themselves.
 */
function sanitizeMultimodalRequestPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object') return payload;
  const cloned: Record<string, unknown> = {
    ...(payload as Record<string, unknown>),
  };
  const messages = cloned.messages;
  if (Array.isArray(messages)) {
    cloned.messages = messages.map(sanitizeMessage);
  }
  // OpenAI Responses-API uses `input` instead of `messages`. Same shape.
  const input = cloned.input;
  if (Array.isArray(input)) {
    cloned.input = input.map(sanitizeMessage);
  }
  return cloned;
}

function sanitizeMessage(message: unknown): unknown {
  if (!message || typeof message !== 'object') return message;
  const m = message as Record<string, unknown>;
  if (Array.isArray(m.content)) {
    return { ...m, content: m.content.map(sanitizeContentPart) };
  }
  return message;
}

function sanitizeContentPart(part: unknown): unknown {
  if (!part || typeof part !== 'object') return part;
  const p = part as Record<string, unknown>;
  // Text parts pass through unchanged.
  if (
    p.type === 'text' ||
    p.type === 'output_text' ||
    p.type === 'input_text'
  ) {
    return part;
  }
  // OpenAI / AI-SDK image_url style:
  //   { type: 'image_url', image_url: { url: 'data:image/png;base64,...' } }
  if (p.type === 'image_url' || p.type === 'input_image') {
    return summarizePart(part, extractImageUrl(p));
  }
  // OpenAI input_audio:
  //   { type: 'input_audio', input_audio: { data: '<base64>', format: 'wav' } }
  if (p.type === 'input_audio') {
    const audio = (p.input_audio ?? {}) as Record<string, unknown>;
    const data = typeof audio.data === 'string' ? audio.data : '';
    return summarizePart(part, {
      mediaType: `audio/${sanitizeMediaSuffix(audio.format)}`,
      bytes: decodeBase64Length(data),
      sha256: data ? sha256(data) : undefined,
    });
  }
  // Generic file (OpenAI files / AI-SDK file part):
  //   { type: 'file', file: { file_data: '<base64>', filename, ... } }
  if (p.type === 'file') {
    const file = (p.file ?? {}) as Record<string, unknown>;
    const data = typeof file.file_data === 'string' ? file.file_data : '';
    const filename =
      typeof file.filename === 'string' ? (file.filename as string) : '';
    const ext = filename.split('.').pop();
    return summarizePart(part, {
      mediaType: ext ? `file/${sanitizeMediaSuffix(ext)}` : 'file/unknown',
      bytes: decodeBase64Length(data),
      sha256: data ? sha256(data) : undefined,
    });
  }
  // Anthropic image blocks (used both standalone and inside
  // `tool_result.content`):
  //   { type: 'image', source: { type: 'base64', media_type, data } }
  //   { type: 'image', source: { type: 'url', url } }
  if (p.type === 'image') {
    return summarizePart(part, extractAnthropicImage(p));
  }
  // Anthropic tool_use blocks may carry inline media inside `input`
  // structured arguments — keep as-is (small structured data).
  // Anthropic tool_result blocks: content can be a string or an
  // array of text/image blocks. Walk the array so embedded images
  // are replaced with summaries.
  if (p.type === 'tool_result' && Array.isArray(p.content)) {
    return {
      ...p,
      content: (p.content as unknown[]).map(sanitizeContentPart),
    };
  }
  // Bedrock Converse `image` block:
  //   { image: { format: 'png', source: { bytes: <base64> } } }
  if (p.image && typeof p.image === 'object') {
    const img = p.image as Record<string, unknown>;
    const source = (img.source ?? {}) as Record<string, unknown>;
    const data = typeof source.bytes === 'string' ? source.bytes : '';
    return {
      ...p,
      image: {
        format: img.format,
        source: {
          // Replace the bytes with a metadata summary; the rest of
          // the block (format, etc.) survives so the audit row still
          // tells you what was sent.
          bytesSummary: {
            byteSize: decodeBase64Length(data),
            sha256: data ? sha256(data) : undefined,
            truncated: true,
          },
        },
      },
    };
  }
  // Bedrock Converse `document` block:
  //   { document: { format, name, source: { bytes: <base64> } } }
  if (p.document && typeof p.document === 'object') {
    const doc = p.document as Record<string, unknown>;
    const source = (doc.source ?? {}) as Record<string, unknown>;
    const data = typeof source.bytes === 'string' ? source.bytes : '';
    return {
      ...p,
      document: {
        format: doc.format,
        name: doc.name,
        source: {
          bytesSummary: {
            byteSize: decodeBase64Length(data),
            sha256: data ? sha256(data) : undefined,
            truncated: true,
          },
        },
      },
    };
  }
  return part;
}

/**
 * Anthropic image block extractor — handles both `base64` and `url`
 * source variants.
 */
function extractAnthropicImage(p: Record<string, unknown>): {
  mediaType: string;
  bytes: number;
  sha256?: string;
} {
  const source = (p.source ?? {}) as Record<string, unknown>;
  if (source.type === 'base64') {
    const data = typeof source.data === 'string' ? source.data : '';
    const mt =
      typeof source.media_type === 'string'
        ? (source.media_type as string)
        : 'image/unknown';
    return {
      mediaType: mt,
      bytes: decodeBase64Length(data),
      sha256: data ? sha256(data) : undefined,
    };
  }
  // URL source — record no bytes.
  return { mediaType: 'image/external', bytes: 0, sha256: undefined };
}

/**
 * Strip control / path-traversal characters out of an
 * attacker-controlled file extension or audio format so the audit's
 * `mediaType` field is never pollutable. Doesn't preserve case
 * because mime types are conventionally lowercase.
 */
function sanitizeMediaSuffix(value: unknown): string {
  if (typeof value !== 'string') return 'unknown';
  const cleaned = value.replace(/[^a-z0-9+-]/gi, '').toLowerCase();
  // Cap at 32 chars — even the longest legitimate MIME suffix
  // (`vnd.openxmlformats-officedocument.spreadsheetml.sheet`) fits
  // well under this. Prevents attacker-controlled extensions from
  // bloating audit-row `mediaType` columns.
  return (cleaned || 'unknown').slice(0, 32);
}

/**
 * Drop response headers that could leak credentials before they hit
 * the audit JSONB column. Providers occasionally echo back tokens or
 * set-cookie material on error paths; we never need them in audit.
 */
const SENSITIVE_HEADER_PATTERN =
  /^(authorization|x-api-key|x-auth(-token)?|cookie|set-cookie|proxy-authorization|x-amz-security-token)$/i;

export function filterAuditResponseHeaders(
  headers: Record<string, string> | null | undefined
): Record<string, string> | null {
  if (!headers) return null;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (SENSITIVE_HEADER_PATTERN.test(key)) continue;
    out[key] = value;
  }
  return out;
}

function extractImageUrl(p: Record<string, unknown>): {
  mediaType: string;
  bytes: number;
  sha256?: string;
} {
  // OpenAI accepts both:
  //   image_url: { url: '...' }   (canonical object form)
  //   image_url: '...'            (some SDKs flatten to a string)
  // Support both so the sanitiser doesn't silently drop bytes when a
  // client used the flattened shape.
  const raw = p.image_url;
  let url = '';
  if (typeof raw === 'string') {
    url = raw;
  } else if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    if (typeof obj.url === 'string') url = obj.url;
  }

  if (url.startsWith('data:')) {
    const [meta, base64] = url.slice(5).split(',', 2);
    const [mediaType] = meta.split(';');
    return {
      mediaType: mediaType || 'image/unknown',
      bytes: decodeBase64Length(base64 ?? ''),
      sha256: base64 ? sha256(base64) : undefined,
    };
  }
  // External URL — keep the URL but record no bytes.
  return {
    mediaType: 'image/external',
    bytes: 0,
    sha256: undefined,
  };
}

function summarizePart(
  original: unknown,
  summary: { mediaType: string; bytes: number; sha256?: string }
): unknown {
  const o = original as Record<string, unknown>;
  return {
    type: o.type,
    mediaType: summary.mediaType,
    byteSize: summary.bytes,
    sha256: summary.sha256,
    truncated: true,
  };
}

function decodeBase64Length(b64: string): number {
  // Base64 expands 3 bytes → 4 chars. Each '=' padding char trims 1 byte.
  if (!b64) return 0;
  const padding = (b64.match(/=+$/)?.[0] ?? '').length;
  return Math.floor((b64.length * 3) / 4) - padding;
}

/**
 * Maximum byte budget the sanitiser will hash per payload part. Above
 * this, we hash the prefix + the byte-length suffix instead — keeps
 * audit-row identity stable for the realistic re-send case (same
 * client, same image) without paying SHA-256 cost on a 50 MB upload
 * for every audit push. Marked with `…` in the digest so consumers
 * can tell prefix-hashed payloads apart from full-hash ones.
 */
const SHA256_PREFIX_LIMIT = 64 * 1024;

function sha256(b64: string): string {
  // Hash the raw base64 string (cheap, no decode) — gives a stable
  // identifier across requests with the same payload without doing
  // base64 → bytes → digest in the hot path.
  if (b64.length <= SHA256_PREFIX_LIMIT) {
    return createHash('sha256').update(b64).digest('hex');
  }
  // For very large payloads, hash the first 64 KB plus a length
  // suffix so two different 60 MB images don't collide on the
  // identical prefix.
  const digest = createHash('sha256')
    .update(b64.slice(0, SHA256_PREFIX_LIMIT))
    .update(`:len=${b64.length}`)
    .digest('hex');
  return `${digest}…`;
}
