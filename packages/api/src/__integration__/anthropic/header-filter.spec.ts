import { describe, expect, it } from 'vitest';
import { filterAnthropicHeaders } from '../../ai-provider/anthropic/shared';

/**
 * T4: `filterAnthropicHeaders` was being called with no arguments on
 * the non-streaming path, dropping every upstream header. The fix
 * threads the SDK's `withResponse()`-returned `Response.headers`
 * through. This spec pins the filter's behaviour: rename the
 * `anthropic-ratelimit-*` family to OpenAI-shape `x-ratelimit-*`,
 * preserve `x-request-id`, drop unrelated headers.
 */

describe('filterAnthropicHeaders (T4)', () => {
  it('returns empty object when called with no headers', () => {
    expect(filterAnthropicHeaders()).toEqual({});
  });

  it('passes through x-request-id verbatim', () => {
    const h = new Headers();
    h.set('x-request-id', 'req_abc');
    expect(filterAnthropicHeaders(h)).toMatchObject({
      'x-request-id': 'req_abc',
    });
  });

  it('renames anthropic-ratelimit-* to x-ratelimit-* on the canonical four', () => {
    const h = new Headers();
    h.set('anthropic-ratelimit-tokens-limit', '40000');
    h.set('anthropic-ratelimit-tokens-reset', '2026-05-09T18:00:00Z');
    h.set('anthropic-ratelimit-requests-limit', '50');
    h.set('anthropic-ratelimit-requests-reset', '2026-05-09T18:00:00Z');
    const out = filterAnthropicHeaders(h);
    expect(out).toMatchObject({
      'x-ratelimit-limit-tokens': '40000',
      'x-ratelimit-reset-tokens': '2026-05-09T18:00:00Z',
      'x-ratelimit-limit-requests': '50',
      'x-ratelimit-reset-requests': '2026-05-09T18:00:00Z',
    });
  });

  it('drops unrelated upstream headers', () => {
    const h = new Headers();
    h.set('content-type', 'application/json');
    h.set('server', 'cloudflare');
    h.set('cf-ray', '12345-IAD');
    const out = filterAnthropicHeaders(h);
    expect(out['content-type']).toBeUndefined();
    expect(out['server']).toBeUndefined();
    expect(out['cf-ray']).toBeUndefined();
  });

  it('preserves any unknown anthropic-ratelimit-* key under the original name', () => {
    const h = new Headers();
    h.set('anthropic-ratelimit-input-tokens-remaining', '99');
    const out = filterAnthropicHeaders(h);
    // Not in the rename map → kept under original key.
    expect(out['anthropic-ratelimit-input-tokens-remaining']).toBe('99');
  });
});
