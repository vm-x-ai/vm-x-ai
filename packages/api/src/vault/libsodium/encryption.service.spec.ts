import { beforeAll, describe, expect, it } from 'vitest';
import sodium from 'libsodium-wrappers';
import { ConfigService } from '@nestjs/config';
import { LibsodiumEncryptionService } from './encryption.service';

/**
 * Unit tests for {@link LibsodiumEncryptionService}. The vault wraps
 * AI-connection credentials (API keys) at rest, so any encryption
 * regression here is a credential exposure incident.
 *
 * The tests exercise the round-trip through real libsodium — no mock
 * — because the only thing worth testing is that the cryptographic
 * pairing actually composes correctly.
 */
async function makeService(
  keyB64?: string
): Promise<LibsodiumEncryptionService> {
  await sodium.ready;
  const key =
    keyB64 ??
    sodium.to_base64(
      sodium.randombytes_buf(
        sodium.crypto_aead_xchacha20poly1305_ietf_KEYBYTES
      ),
      sodium.base64_variants.ORIGINAL
    );
  const config = {
    getOrThrow: (k: string) => {
      if (k === 'LIBSODIUM_ENCRYPTION_KEY') return key;
      throw new Error(`Missing config: ${k}`);
    },
  } as unknown as ConfigService;
  const service = new LibsodiumEncryptionService(config);
  await service.onModuleInit();
  return service;
}

describe('LibsodiumEncryptionService', () => {
  let service: LibsodiumEncryptionService;

  beforeAll(async () => {
    service = await makeService();
  });

  it('round-trips plaintext through encrypt → decrypt', async () => {
    const plaintext = 'sk-secret-api-key-abcdef0123456789';
    const ciphertext = await service.encrypt(plaintext);
    expect(ciphertext).not.toContain(plaintext);
    const decoded = await service.decrypt(ciphertext);
    expect(decoded).toBe(plaintext);
  });

  it('produces a different ciphertext on each call (random nonce)', async () => {
    const plaintext = 'same-input';
    const a = await service.encrypt(plaintext);
    const b = await service.encrypt(plaintext);
    expect(a).not.toBe(b);
    // …but both still decrypt back to the original.
    expect(await service.decrypt(a)).toBe(plaintext);
    expect(await service.decrypt(b)).toBe(plaintext);
  });

  it('binds the encryption context — mismatched context fails decrypt', async () => {
    const plaintext = 'ctx-bound';
    const ciphertext = await service.encrypt(plaintext, {
      workspaceId: 'ws-1',
    });
    // Same ciphertext, different context → AEAD authentication tag
    // rejects the decryption attempt.
    await expect(
      service.decrypt(ciphertext, { workspaceId: 'ws-2' })
    ).rejects.toBeTruthy();
  });

  it('decrypts when the same context is supplied', async () => {
    const plaintext = 'ctx-bound-2';
    const ciphertext = await service.encrypt(plaintext, {
      workspaceId: 'ws-A',
      environmentId: 'env-X',
    });
    const decoded = await service.decrypt(ciphertext, {
      workspaceId: 'ws-A',
      environmentId: 'env-X',
    });
    expect(decoded).toBe(plaintext);
  });

  it('rejects a tampered ciphertext (AEAD authentication)', async () => {
    const ciphertext = await service.encrypt('whatever');
    // Flip a byte inside the ciphertext envelope and ensure decrypt
    // refuses to return forged plaintext.
    const decoded = Buffer.from(ciphertext, 'base64').toString('utf8');
    const obj = JSON.parse(decoded);
    // Mutate the first character of the inner ciphertext.
    obj.ciphertext = obj.ciphertext.startsWith('A')
      ? 'B' + obj.ciphertext.slice(1)
      : 'A' + obj.ciphertext.slice(1);
    const tampered = Buffer.from(JSON.stringify(obj)).toString('base64');
    await expect(service.decrypt(tampered)).rejects.toBeTruthy();
  });

  it('handles empty plaintext', async () => {
    const ciphertext = await service.encrypt('');
    expect(await service.decrypt(ciphertext)).toBe('');
  });

  it('handles unicode + multi-byte plaintext', async () => {
    const plaintext = 'Olá 🔑 — chave secreta';
    const ciphertext = await service.encrypt(plaintext);
    expect(await service.decrypt(ciphertext)).toBe(plaintext);
  });

  it('rejects ciphertext that is not valid base64-wrapped JSON', async () => {
    await expect(service.decrypt('not-real-ciphertext')).rejects.toBeTruthy();
  });
});
