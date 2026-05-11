import { describe, expect, it } from 'vitest';
import { filterAuditResponseHeaders } from './audit.service';

/**
 * Unit tests for {@link filterAuditResponseHeaders}. This helper is
 * the last line of defence against credential leaks into the
 * `request_audit.response_headers` JSONB column. Providers occasionally
 * echo `set-cookie`, `authorization`, or AWS session-token material on
 * error paths; the gateway must scrub those before persisting an
 * audit row that any workspace member can read.
 */
describe('filterAuditResponseHeaders', () => {
  it('returns null on null/undefined input', () => {
    expect(filterAuditResponseHeaders(null)).toBeNull();
    expect(filterAuditResponseHeaders(undefined)).toBeNull();
  });

  it('returns an empty object for an empty headers map', () => {
    expect(filterAuditResponseHeaders({})).toEqual({});
  });

  it('preserves benign headers untouched', () => {
    const out = filterAuditResponseHeaders({
      'content-type': 'application/json',
      'x-request-id': 'req_abc',
      'x-ratelimit-remaining': '42',
    });
    expect(out).toEqual({
      'content-type': 'application/json',
      'x-request-id': 'req_abc',
      'x-ratelimit-remaining': '42',
    });
  });

  it.each([
    'authorization',
    'Authorization',
    'AUTHORIZATION',
    'x-api-key',
    'X-Api-Key',
    'x-auth',
    'x-auth-token',
    'cookie',
    'Cookie',
    'set-cookie',
    'Set-Cookie',
    'proxy-authorization',
    'x-amz-security-token',
  ])('strips sensitive header `%s` regardless of case', (header) => {
    const out = filterAuditResponseHeaders({
      [header]: 'secret-value',
      'x-safe': 'keep',
    });
    expect(out).toEqual({ 'x-safe': 'keep' });
  });

  it('does NOT strip headers whose name merely contains a sensitive substring', () => {
    // The pattern is anchored with ^...$ — `x-authorization-policy`
    // shouldn't be confused with `authorization` itself. This guards
    // against over-aggressive filtering that would hide useful
    // metadata headers from the audit row.
    const out = filterAuditResponseHeaders({
      'x-authorization-policy': 'public',
      'x-cookie-domain': 'example.com',
    });
    expect(out).toEqual({
      'x-authorization-policy': 'public',
      'x-cookie-domain': 'example.com',
    });
  });

  it('removes sensitive headers while preserving the original (no mutation)', () => {
    const input = {
      authorization: 'Bearer abc',
      'x-request-id': 'rid',
    };
    const out = filterAuditResponseHeaders(input);
    expect(out).toEqual({ 'x-request-id': 'rid' });
    // The caller's object must be untouched — audit emission shouldn't
    // mutate the response headers that downstream code may still read.
    expect(input).toEqual({
      authorization: 'Bearer abc',
      'x-request-id': 'rid',
    });
  });

  it('handles many headers without dropping legitimate ones', () => {
    const headers: Record<string, string> = {};
    for (let i = 0; i < 50; i++) headers[`x-meta-${i}`] = String(i);
    headers.authorization = 'leak';
    const out = filterAuditResponseHeaders(headers);
    expect(out).not.toHaveProperty('authorization');
    expect(Object.keys(out!).length).toBe(50);
  });
});
