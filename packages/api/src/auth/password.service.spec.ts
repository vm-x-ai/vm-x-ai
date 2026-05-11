import { describe, expect, it } from 'vitest';
import { PasswordService } from './password.service';

/**
 * Unit tests for {@link PasswordService} — covers the argon2 wrapper.
 * The service is a thin shim, but it sits on the auth-critical path:
 * a regression here breaks login + password reset flows.
 */
describe('PasswordService', () => {
  const service = new PasswordService();

  describe('hash', () => {
    it('returns an argon2-formatted string', async () => {
      const hash = await service.hash('hunter2');
      // argon2 hashes start with $argon2 (v0 / id / d / i variants).
      expect(hash).toMatch(/^\$argon2[a-z]*\$/);
    });

    it('produces distinct hashes for the same plaintext (salt randomised)', async () => {
      const a = await service.hash('same-password');
      const b = await service.hash('same-password');
      expect(a).not.toBe(b);
    });

    it('handles empty string and unicode input', async () => {
      const h1 = await service.hash('');
      const h2 = await service.hash('hünter🔐2');
      expect(h1).toMatch(/^\$argon2/);
      expect(h2).toMatch(/^\$argon2/);
    });
  });

  describe('verify', () => {
    it('returns true for matching plaintext + hash', async () => {
      const hash = await service.hash('correct-horse-battery-staple');
      await expect(
        service.verify('correct-horse-battery-staple', hash)
      ).resolves.toBe(true);
    });

    it('returns false for wrong plaintext', async () => {
      const hash = await service.hash('correct-horse-battery-staple');
      await expect(service.verify('wrong-password', hash)).resolves.toBe(false);
    });

    it('returns false on case mismatch (verify is case-sensitive)', async () => {
      const hash = await service.hash('Password1');
      await expect(service.verify('password1', hash)).resolves.toBe(false);
    });

    it('rejects with an error on a malformed hash format', async () => {
      // argon2's verify throws on a string that doesn't look like an
      // argon2 encoded hash — guards against accidentally storing a
      // bcrypt or plaintext value where argon2 is expected.
      await expect(
        service.verify('any', 'not-an-argon2-hash')
      ).rejects.toBeTruthy();
    });
  });
});
