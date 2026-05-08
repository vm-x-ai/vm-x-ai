import { describe, expect, it } from 'vitest';
import {
  applyVmxHeadersToCanonical,
  mergeVmxFromHeaders,
  parseVmxHeaders,
} from './vmx-headers';

describe('parseVmxHeaders', () => {
  it('returns undefined when no vmx headers are present', () => {
    expect(parseVmxHeaders({ host: 'localhost', 'x-other': 'value' })).toBe(
      undefined
    );
    expect(parseVmxHeaders({})).toBe(undefined);
  });

  it('reads correlationId from x-vmx-correlation-id', () => {
    expect(parseVmxHeaders({ 'x-vmx-correlation-id': 'corr-123' })).toEqual({
      correlationId: 'corr-123',
    });
  });

  it('reads metadata from x-vmx-metadata-* headers (case-insensitive)', () => {
    expect(
      parseVmxHeaders({
        'x-vmx-metadata-team': 'growth',
        'X-Vmx-Metadata-User_id': 'u_42',
      })
    ).toEqual({
      metadata: { team: 'growth', user_id: 'u_42' },
    });
  });

  it('combines correlationId + multiple metadata keys', () => {
    expect(
      parseVmxHeaders({
        'x-vmx-correlation-id': 'corr-1',
        'x-vmx-metadata-team': 'growth',
        'x-vmx-metadata-env': 'prod',
        'x-other': 'ignored',
      })
    ).toEqual({
      correlationId: 'corr-1',
      metadata: { team: 'growth', env: 'prod' },
    });
  });

  it('uses the first value when a header has multiple values', () => {
    expect(
      parseVmxHeaders({
        'x-vmx-correlation-id': ['first', 'second'],
        'x-vmx-metadata-team': ['growth', 'platform'],
      })
    ).toEqual({
      correlationId: 'first',
      metadata: { team: 'growth' },
    });
  });

  it('ignores the empty-suffix metadata header `x-vmx-metadata-`', () => {
    expect(parseVmxHeaders({ 'x-vmx-metadata-': 'oops' })).toBe(undefined);
  });
});

describe('mergeVmxFromHeaders', () => {
  it('returns body verbatim when no header vmx is provided', () => {
    const body = { correlationId: 'body-corr', metadata: { a: '1' } };
    expect(mergeVmxFromHeaders(body, undefined)).toBe(body);
  });

  it('uses header values when the body has no vmx', () => {
    expect(
      mergeVmxFromHeaders(undefined, {
        correlationId: 'hdr',
        metadata: { team: 'growth' },
      })
    ).toEqual({ correlationId: 'hdr', metadata: { team: 'growth' } });
  });

  it('body wins over headers on key collision', () => {
    expect(
      mergeVmxFromHeaders(
        { correlationId: 'body-corr' },
        { correlationId: 'hdr-corr' }
      )
    ).toEqual({ correlationId: 'body-corr' });
  });

  it('unions metadata maps; body wins on key collision', () => {
    expect(
      mergeVmxFromHeaders(
        { metadata: { team: 'body-team', a: '1' } },
        { metadata: { team: 'hdr-team', b: '2' } }
      )
    ).toEqual({ metadata: { team: 'body-team', a: '1', b: '2' } });
  });

  it('preserves body-only fields that have no header equivalent', () => {
    const body = {
      correlationId: 'body-corr',
      timeoutMs: 25_000,
      resourceConfigOverrides: { description: 'test' },
    };
    expect(mergeVmxFromHeaders(body, { metadata: { team: 'growth' } })).toEqual(
      {
        correlationId: 'body-corr',
        timeoutMs: 25_000,
        resourceConfigOverrides: { description: 'test' },
        metadata: { team: 'growth' },
      }
    );
  });
});

describe('applyVmxHeadersToCanonical', () => {
  it('merges header vmx onto the canonical payload', () => {
    const canonical = {
      model: 'res-1',
      input: [],
      vmx: { correlationId: 'body-corr' },
    } as unknown as {
      vmx?: { correlationId?: string; metadata?: Record<string, string> };
    };
    applyVmxHeadersToCanonical(canonical, {
      'x-vmx-correlation-id': 'hdr',
      'x-vmx-metadata-team': 'growth',
    });
    // body correlationId wins, metadata comes in from headers
    expect(canonical.vmx).toEqual({
      correlationId: 'body-corr',
      metadata: { team: 'growth' },
    });
  });

  it('no-ops when headers are undefined', () => {
    const canonical = { vmx: { correlationId: 'unchanged' } };
    applyVmxHeadersToCanonical(canonical, undefined);
    expect(canonical.vmx).toEqual({ correlationId: 'unchanged' });
  });

  it('no-ops when no vmx headers are present', () => {
    const canonical = { vmx: { correlationId: 'unchanged' } };
    applyVmxHeadersToCanonical(canonical, { host: 'localhost' });
    expect(canonical.vmx).toEqual({ correlationId: 'unchanged' });
  });

  it('seeds vmx when the canonical had none', () => {
    const canonical = {} as { vmx?: { correlationId?: string } };
    applyVmxHeadersToCanonical(canonical, {
      'x-vmx-correlation-id': 'hdr-only',
    });
    expect(canonical.vmx).toEqual({ correlationId: 'hdr-only' });
  });
});
