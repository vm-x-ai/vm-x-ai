import { Inject, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import type { client as VaultClient, ApiResponseError } from 'node-vault';

@Injectable()
export class SecretService {
  constructor(
    @Inject('VAULT_CLIENT') private readonly vault: VaultClient,
    private readonly logger: PinoLogger
  ) {}

  async getSecret<T>(path: string): Promise<T | null> {
    try {
      const resp = await this.vault.read(`secret/data/${path}`);
      return resp.data.data; // KV v2 stores under data.data
    } catch (error) {
      if (this.isApiResponseError(error) && error.response.statusCode === 404) {
        this.logger.warn(`Secret ${path} not found`);
        return null;
      }
      this.logger.error({ error }, 'Failed to get secret');
      throw error;
    }
  }

  async setSecret<T>(path: string, data: T): Promise<T> {
    await this.vault.write(`secret/data/${path}`, { data });

    return data;
  }

  async upsertSecret<T>(
    path: string,
    dataFactory: () => Promise<T>
  ): Promise<T> {
    const secret = await this.getSecret<T>(path);
    if (!secret) {
      return await this.setSecret<T>(path, await dataFactory());
    }

    return secret;
  }

  private isApiResponseError(error: unknown): error is ApiResponseError {
    return typeof error === 'object' && error !== null && 'response' in error;
  }
}
