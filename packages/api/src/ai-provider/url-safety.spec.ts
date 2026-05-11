import { describe, expect, it } from 'vitest';
import { CompletionError } from '../gateway/completion.types';
import { assertSafeOutboundUrl } from './url-safety';

/**
 * SSRF protection. Any URL that comes from a client payload — image_url,
 * Anthropic `document.source.url`, etc. — is fetched server-side, so a
 * regression here would let a request body reach internal services
 * (the gateway's own Postgres, Redis, AWS instance metadata, etc.).
 */
describe('assertSafeOutboundUrl', () => {
  describe('allowed', () => {
    it('passes for plain https URLs', () => {
      expect(() =>
        assertSafeOutboundUrl('https://example.com/picture.png')
      ).not.toThrow();
    });

    it('passes for plain http URLs', () => {
      expect(() =>
        assertSafeOutboundUrl('http://example.com/x.jpg')
      ).not.toThrow();
    });

    it('passes for inline data: URLs (no network hop)', () => {
      expect(() =>
        assertSafeOutboundUrl('data:image/png;base64,AAAA')
      ).not.toThrow();
    });

    it('passes for public IPs that look private but are not (e.g. 11.x)', () => {
      expect(() => assertSafeOutboundUrl('https://11.0.0.1/x')).not.toThrow();
    });

    it('passes for hostnames with mixed case', () => {
      expect(() =>
        assertSafeOutboundUrl('https://Example.COM/y')
      ).not.toThrow();
    });
  });

  describe('blocked schemes', () => {
    it.each([
      ['file:///etc/passwd'],
      ['ftp://example.com/'],
      ['javascript:alert(1)'],
      ['gopher://internal/'],
    ])('rejects %s', (url) => {
      expect(() => assertSafeOutboundUrl(url)).toThrow(CompletionError);
    });
  });

  describe('blocked hostnames (instance metadata + loopback)', () => {
    it.each([
      ['https://localhost/x'],
      ['http://127.0.0.1/x'],
      ['http://0.0.0.0/x'],
      ['http://169.254.169.254/latest/meta-data/'], // AWS IMDS
      ['http://[::1]/x'], // IPv6 loopback
    ])('rejects %s', (url) => {
      expect(() => assertSafeOutboundUrl(url)).toThrow(CompletionError);
    });

    it('rejects all 127.0.0.0/8 addresses', () => {
      expect(() => assertSafeOutboundUrl('http://127.5.6.7/x')).toThrow(
        CompletionError
      );
      expect(() => assertSafeOutboundUrl('http://127.99.88.77/x')).toThrow(
        CompletionError
      );
    });
  });

  describe('blocked private IPv4 ranges', () => {
    it.each([
      ['http://10.0.0.5/x'],
      ['http://10.255.255.255/x'],
      ['http://192.168.1.1/x'],
      ['http://172.16.0.1/x'],
      ['http://172.20.5.5/x'],
      ['http://172.31.255.255/x'],
      ['http://169.254.1.2/x'], // link-local outside IMDS
    ])('rejects %s', (url) => {
      expect(() => assertSafeOutboundUrl(url)).toThrow(CompletionError);
    });

    it('does NOT reject 172.15.x or 172.32.x (outside RFC1918)', () => {
      expect(() => assertSafeOutboundUrl('http://172.15.0.1/x')).not.toThrow();
      expect(() => assertSafeOutboundUrl('http://172.32.0.1/x')).not.toThrow();
    });
  });

  describe('blocked IPv6', () => {
    it('rejects fe80:: link-local addresses', () => {
      expect(() => assertSafeOutboundUrl('http://[fe80::1]/x')).toThrow(
        CompletionError
      );
    });
  });

  describe('malformed input', () => {
    it('throws CompletionError on a non-URL string', () => {
      expect(() => assertSafeOutboundUrl('not a url')).toThrow(CompletionError);
    });

    it('throws on empty string', () => {
      expect(() => assertSafeOutboundUrl('')).toThrow(CompletionError);
    });

    it('throws on a relative URL (no protocol)', () => {
      expect(() => assertSafeOutboundUrl('/no-host/path')).toThrow(
        CompletionError
      );
    });
  });

  describe('error metadata', () => {
    it('attaches a 400 status and the unsafe_outbound_url code', () => {
      try {
        assertSafeOutboundUrl('http://localhost/x');
      } catch (err) {
        expect(err).toBeInstanceOf(CompletionError);
        const ce = err as CompletionError;
        expect(ce.data.statusCode).toBe(400);
        expect(ce.data.openAICompatibleError?.code).toBe('unsafe_outbound_url');
        expect(ce.data.openAICompatibleError?.type).toBe('invalid_request');
      }
    });

    it('threads message/content-part indices into the error param', () => {
      try {
        assertSafeOutboundUrl('http://localhost/x', {
          messageIndex: 2,
          contentPartIndex: 1,
        });
      } catch (err) {
        const ce = err as CompletionError;
        expect(ce.data.openAICompatibleError?.param).toBe(
          'messages[2].content[1]'
        );
      }
    });

    it('omits the param when context is incomplete', () => {
      try {
        assertSafeOutboundUrl('http://localhost/x', { messageIndex: 0 });
      } catch (err) {
        const ce = err as CompletionError;
        expect(ce.data.openAICompatibleError?.param).toBeUndefined();
      }
    });
  });
});
