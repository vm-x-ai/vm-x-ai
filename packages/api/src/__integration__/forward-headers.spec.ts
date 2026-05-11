import { describe, expect, it } from 'vitest';
import { extractCallerForwardHeaders } from '../ai-provider/forward-headers';

/**
 * Caller-header forwarding allowlist. Lets callers opt into sending
 * `anthropic-beta` / `openai-beta` / `X-Goog-User-Project` / etc.
 * through the gateway to upstream providers. `Authorization` is
 * intentionally excluded — forwarding it would let callers override
 * the gateway's connection-level upstream key.
 */
describe('extractCallerForwardHeaders', () => {
  it('keeps allow-listed headers and lowercases keys', () => {
    const out = extractCallerForwardHeaders({
      'OpenAI-Organization': 'org_X',
      'OpenAI-Project': 'proj_Y',
      'OpenAI-Beta': 'assistants=v2',
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'interleaved-thinking-2025-05-14',
      'X-Goog-User-Project': 'gcp-project-1',
      'x-client-request-id': 'req-1',
      'idempotency-key': 'idem-1',
    });
    expect(out).toEqual({
      'openai-organization': 'org_X',
      'openai-project': 'proj_Y',
      'openai-beta': 'assistants=v2',
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'interleaved-thinking-2025-05-14',
      'x-goog-user-project': 'gcp-project-1',
      'x-client-request-id': 'req-1',
      'idempotency-key': 'idem-1',
    });
  });

  it('does NOT forward Authorization — would override gateway upstream key', () => {
    const out = extractCallerForwardHeaders({
      Authorization: 'Bearer caller-key',
      'anthropic-beta': 'context-management-2025-06-27',
    });
    expect(out).toEqual({
      'anthropic-beta': 'context-management-2025-06-27',
    });
    expect(out).not.toHaveProperty('authorization');
  });

  it('drops non-allowlist headers (content-type, host, cookies)', () => {
    const out = extractCallerForwardHeaders({
      'content-type': 'application/json',
      host: 'gateway.example.com',
      cookie: 'session=abc',
      'x-api-key': 'caller-key',
    });
    expect(out).toEqual({});
  });

  it('joins multi-value headers with a comma + space', () => {
    const out = extractCallerForwardHeaders({
      'anthropic-beta': [
        'interleaved-thinking-2025-05-14',
        'compact-2026-01-12',
      ],
    });
    expect(out['anthropic-beta']).toBe(
      'interleaved-thinking-2025-05-14, compact-2026-01-12'
    );
  });

  it('returns {} for undefined / empty input', () => {
    expect(extractCallerForwardHeaders(undefined)).toEqual({});
    expect(extractCallerForwardHeaders({})).toEqual({});
  });

  it('skips undefined-valued entries', () => {
    const out = extractCallerForwardHeaders({
      'anthropic-version': undefined,
      'openai-beta': 'x=1',
    });
    expect(out).toEqual({ 'openai-beta': 'x=1' });
  });
});
