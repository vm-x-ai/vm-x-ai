import { Injectable } from '@nestjs/common';
import { EncryptionServiceBase } from '../encryption.service.base';
import {
  KmsKeyringNode,
  buildClient,
  CommitmentPolicy,
} from '@aws-crypto/client-node';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AwsKmsEncryptionService extends EncryptionServiceBase {
  private readonly client: ReturnType<typeof buildClient>;
  private readonly keyring: KmsKeyringNode;

  constructor(private readonly configService: ConfigService) {
    super();

    this.client = buildClient(CommitmentPolicy.REQUIRE_ENCRYPT_REQUIRE_DECRYPT);

    const kmsKeyId = this.configService.getOrThrow<string>(
      'VAULT_AWS_KMS_KEY_ID'
    );

    this.keyring = new KmsKeyringNode({
      generatorKeyId: kmsKeyId,
      keyIds: [kmsKeyId],
    });
  }

  async encrypt(
    plaintext: string,
    context?: Record<string, string>
  ): Promise<string> {
    const { result } = await this.client.encrypt(this.keyring, plaintext, {
      encryptionContext: context,
    });

    return Buffer.from(result).toString('base64');
  }

  async decrypt(
    ciphertext: string,
    context?: Record<string, string>
  ): Promise<string> {
    const { plaintext, messageHeader } = await this.client.decrypt(
      this.keyring,
      Buffer.from(ciphertext, 'base64')
    );

    Object.entries(context ?? {}).forEach(([key, value]) => {
      if (messageHeader.encryptionContext[key] !== value)
        throw new Error('Encryption Context does not match expected values');
    });

    return Buffer.from(plaintext).toString('utf8');
  }
}
