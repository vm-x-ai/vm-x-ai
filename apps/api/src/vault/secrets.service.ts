import { Inject, Injectable } from '@nestjs/common';
import { DatabaseService } from '../storage/database.service';
import {
  ENCRYPTION_SERVICE,
  type IEncryptionService,
} from './encryption.service.base';

@Injectable()
export class SecretService {
  constructor(
    private readonly db: DatabaseService,
    @Inject(ENCRYPTION_SERVICE)
    private readonly encryptionService: IEncryptionService
  ) {}

  async getSecret<T>(path: string): Promise<T | null> {
    const secret = await this.db.reader
      .selectFrom('globalSecrets')
      .selectAll('globalSecrets')
      .where('name', '=', path)
      .executeTakeFirst();

    if (!secret) {
      return null;
    }

    const decryptedValue = await this.encryptionService.decrypt(secret.value);

    try {
      return JSON.parse(decryptedValue) as T;
    } catch {
      return decryptedValue as T;
    }
  }

  async setSecret<T>(path: string, data: T): Promise<T> {
    const encryptedValue = await this.encryptionService.encrypt(
      JSON.stringify(data)
    );
    await this.db.writer
      .insertInto('globalSecrets')
      .values({
        name: path,
        value: encryptedValue,
        createdAt: new Date(),
      })
      .execute();

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
}
