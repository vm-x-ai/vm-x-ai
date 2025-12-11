import { Injectable, OnModuleInit } from '@nestjs/common';
import { EncryptionServiceBase } from '../encryption.service.base';
import { ConfigService } from '@nestjs/config';
import sodium from 'libsodium-wrappers';

@Injectable()
export class LibsodiumEncryptionService
  extends EncryptionServiceBase
  implements OnModuleInit
{
  private readonly encryptionKey: string;

  constructor(private readonly configService: ConfigService) {
    super();

    this.encryptionKey = this.configService.getOrThrow<string>(
      'LIBSODIUM_ENCRYPTION_KEY'
    );
  }

  async onModuleInit() {
    await sodium.ready;
  }

  async encrypt(
    plaintext: string,
    context?: Record<string, string>
  ): Promise<string> {
    const nonce = sodium.randombytes_buf(
      sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES
    );
    const contextData = sodium.from_string(JSON.stringify(context ?? {}));

    const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
      sodium.from_string(plaintext),
      contextData,
      null,
      nonce,
      sodium.from_base64(this.encryptionKey, sodium.base64_variants.ORIGINAL)
    );

    const ciphertextBase64 = sodium.to_base64(ciphertext);
    const nonceBase64 = sodium.to_base64(nonce);

    return Buffer.from(
      JSON.stringify({
        ciphertext: ciphertextBase64,
        nonce: nonceBase64,
      })
    ).toString('base64');
  }

  async decrypt(
    ciphertext: string,
    context?: Record<string, string>
  ): Promise<string> {
    const encryptedData = Buffer.from(ciphertext, 'base64');
    const { ciphertext: ciphertextBase64, nonce: nonceBase64 } = JSON.parse(
      encryptedData.toString('utf8')
    );
    const plaintextBytes = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
      null,
      sodium.from_base64(ciphertextBase64),
      sodium.from_string(JSON.stringify(context ?? {})),
      sodium.from_base64(nonceBase64),
      sodium.from_base64(this.encryptionKey, sodium.base64_variants.ORIGINAL)
    );

    return sodium.to_string(plaintextBytes);
  }
}
