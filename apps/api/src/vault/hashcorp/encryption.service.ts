import { Injectable, Inject } from '@nestjs/common';
import type { client as VaultClient } from 'node-vault';
import { VAULT_KEY } from './consts';
import { EncryptionServiceBase } from '../encryption.service.base';

@Injectable()
export class HashcorpEncryptionService extends EncryptionServiceBase {
  constructor(@Inject('VAULT_CLIENT') private readonly vault: VaultClient) {
    super();
  }

  async encrypt(plaintext: string, context?: Record<string, string>): Promise<string> {
    const res = await this.vault.write(`transit/encrypt/${VAULT_KEY}`, {
      plaintext: Buffer.from(plaintext, 'utf8').toString('base64'),
      context: context ? Buffer.from(JSON.stringify(context)).toString('base64') : undefined,
    });
    return res.data.ciphertext;
  }

  async decrypt(ciphertext: string, context?: Record<string, string>): Promise<string> {
    const res = await this.vault.write(`transit/decrypt/${VAULT_KEY}`, {
      ciphertext,
      context: context ? Buffer.from(JSON.stringify(context)).toString('base64') : undefined,
    });
    return Buffer.from(res.data.plaintext, 'base64').toString('utf8');
  }
}
