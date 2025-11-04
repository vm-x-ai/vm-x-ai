import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { DatabaseService } from '../storage/database.service';
import { WorkspaceService } from '../workspace/workspace.service';
import { Cache, CACHE_MANAGER } from '@nestjs/cache-manager';
import { ApiKeyEntity } from './entities/api-key.entity';
import { throwServiceError } from '../error';
import { ErrorCode } from '../error-code';
import { CreateApiKeyDto } from './dto/create-api-key.dto';
import { UserEntity } from '../users/entities/user.entity';
import argon2 from 'argon2';
import { nanoid } from 'nanoid';
import { UpdateApiKeyDto } from './dto/update-api-key.dto';
import { CreatedApiKeyDto } from './dto/created-api-key.dto';

@Injectable()
export class ApiKeyService {
  constructor(
    private readonly db: DatabaseService,
    private readonly workspaceService: WorkspaceService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache
  ) {}

  public async getAll(includesUsers = false): Promise<ApiKeyEntity[]> {
    const apiKeys = await this.db.reader
      .selectFrom('apiKeys')
      .selectAll('apiKeys')
      .$if(includesUsers, this.db.includeEntityControlUsers('apiKeys'))
      .orderBy('createdAt', 'desc')
      .execute();

    return apiKeys.map(({ hash, ...apiKey }) => apiKey);
  }

  public async getById(
    workspaceId: string,
    environmentId: string,
    apiKeyId: string,
    includesUser: boolean
  ): Promise<ApiKeyEntity>;

  public async getById<T extends false>(
    workspaceId: string,
    environmentId: string,
    apiKeyId: string,
    includesUser: boolean,
    throwOnNotFound: T
  ): Promise<ApiKeyEntity | undefined>;

  public async getById<T extends true>(
    workspaceId: string,
    environmentId: string,
    apiKeyId: string,
    includesUser: boolean,
    throwOnNotFound: T
  ): Promise<ApiKeyEntity>;

  public async getById(
    workspaceId: string,
    environmentId: string,
    apiKeyId: string,
    includesUser = false,
    throwOnNotFound = true
  ): Promise<ApiKeyEntity | undefined> {
    const apiKey = await this.cache.wrap(
      this.getApiKeyCacheKey(
        workspaceId,
        environmentId,
        apiKeyId,
        includesUser
      ),
      () =>
        this.db.reader
          .selectFrom('apiKeys')
          .selectAll('apiKeys')
          .$if(includesUser, this.db.includeEntityControlUsers('apiKeys'))
          .where('workspaceId', '=', workspaceId)
          .where('environmentId', '=', environmentId)
          .where('apiKeyId', '=', apiKeyId)
          .executeTakeFirst()
    );

    if (throwOnNotFound && !apiKey) {
      throwServiceError(HttpStatus.NOT_FOUND, ErrorCode.API_KEY_NOT_FOUND, {
        apiKeyId,
      });
    }

    if (!apiKey) return apiKey;
    const { hash, ...rest } = apiKey;
    return rest;
  }

  public async getAllByMemberUserId(
    workspaceId: string,
    environmentId: string,
    userId: string,
    includesUser = false
  ): Promise<ApiKeyEntity[]> {
    const apiKeys = await this.db.reader
      .selectFrom('apiKeys')
      .selectAll('apiKeys')
      .$if(includesUser, this.db.includeEntityControlUsers('apiKeys'))
      .innerJoin(
        'workspaceUsers',
        'apiKeys.workspaceId',
        'workspaceUsers.workspaceId'
      )
      .where('apiKeys.workspaceId', '=', workspaceId)
      .where('apiKeys.environmentId', '=', environmentId)
      .where('workspaceUsers.userId', '=', userId)
      .execute();

    return apiKeys.map(({ hash, ...apiKey }) => apiKey);
  }

  public async getByMemberUserId(
    workspaceId: string,
    environmentId: string,
    apiKeyId: string,
    userId: string,
    includesUser: boolean
  ): Promise<ApiKeyEntity>;

  public async getByMemberUserId<T extends false>(
    workspaceId: string,
    environmentId: string,
    apiKeyId: string,
    userId: string,
    includesUser: boolean,
    throwOnNotFound: T
  ): Promise<ApiKeyEntity | undefined>;

  public async getByMemberUserId<T extends true>(
    workspaceId: string,
    environmentId: string,
    apiKeyId: string,
    userId: string,
    includesUser: boolean,
    throwOnNotFound: T
  ): Promise<ApiKeyEntity>;

  public async getByMemberUserId(
    workspaceId: string,
    environmentId: string,
    apiKeyId: string,
    userId: string,
    includesUser: boolean,
    throwOnNotFound = true
  ): Promise<ApiKeyEntity | undefined> {
    const apiKey = await this.db.reader
      .selectFrom('apiKeys')
      .selectAll('apiKeys')
      .innerJoin(
        'workspaceUsers',
        'apiKeys.workspaceId',
        'workspaceUsers.workspaceId'
      )
      .where('workspaceUsers.userId', '=', userId)
      .where('apiKeys.workspaceId', '=', workspaceId)
      .where('apiKeys.environmentId', '=', environmentId)
      .where('apiKeys.apiKeyId', '=', apiKeyId)
      .$if(includesUser, this.db.includeEntityControlUsers('apiKeys'))
      .executeTakeFirst();

    if (throwOnNotFound && !apiKey) {
      throwServiceError(HttpStatus.NOT_FOUND, ErrorCode.API_KEY_NOT_FOUND, {
        apiKeyId,
      });
    }

    return apiKey;
  }

  public async create(
    workspaceId: string,
    environmentId: string,
    payload: CreateApiKeyDto,
    user: UserEntity
  ): Promise<CreatedApiKeyDto> {
    await this.workspaceService.throwIfNotWorkspaceMember(workspaceId, user.id);
    const apiKeyValue = nanoid(64);

    const apiKey = await this.db.writer
      .insertInto('apiKeys')
      .values({
        ...payload,
        workspaceId,
        environmentId,
        hash: await this.computeHash(apiKeyValue),
        maskedKey: this.maskKey(apiKeyValue),
        resources: JSON.stringify(payload.resources),
        labels: payload.labels ? JSON.stringify(payload.labels) : null,
        capacity: payload.capacity ? JSON.stringify(payload.capacity) : null,
        enforceCapacity: payload.enforceCapacity,
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    const { hash, ...rest } = apiKey;
    return { ...rest, apiKeyValue };
  }

  public async update(
    workspaceId: string,
    environmentId: string,
    apiKeyId: string,
    payload: UpdateApiKeyDto,
    user: UserEntity
  ): Promise<ApiKeyEntity> {
    await this.workspaceService.throwIfNotWorkspaceMember(workspaceId, user.id);

    const apiKey = await this.db.writer
      .updateTable('apiKeys')
      .set({
        ...payload,
        labels: payload.labels ? JSON.stringify(payload.labels) : undefined,
        capacity: payload.capacity
          ? JSON.stringify(payload.capacity)
          : undefined,
        resources: payload.resources
          ? JSON.stringify(payload.resources)
          : undefined,
        updatedBy: user.id,
        updatedAt: new Date(),
      })
      .where('workspaceId', '=', workspaceId)
      .where('environmentId', '=', environmentId)
      .where('apiKeyId', '=', apiKeyId)
      .returningAll()
      .executeTakeFirstOrThrow();

    await this.cache.mdel([
      this.getApiKeyCacheKey(workspaceId, environmentId, apiKeyId, true),
      this.getApiKeyCacheKey(workspaceId, environmentId, apiKeyId, false),
    ]);

    const { hash, ...rest } = apiKey;
    return rest;
  }

  public async delete(
    workspaceId: string,
    environmentId: string,
    apiKeyId: string,
    user: UserEntity
  ): Promise<void> {
    await this.workspaceService.throwIfNotWorkspaceMember(workspaceId, user.id);
    await this.db.writer
      .deleteFrom('apiKeys')
      .where('workspaceId', '=', workspaceId)
      .where('environmentId', '=', environmentId)
      .where('apiKeyId', '=', apiKeyId)
      .execute();

    await this.cache.mdel([
      this.getApiKeyCacheKey(workspaceId, environmentId, apiKeyId, true),
      this.getApiKeyCacheKey(workspaceId, environmentId, apiKeyId, false),
    ]);
  }

  public async verify(apiKey: string): Promise<ApiKeyEntity | undefined> {
    const verifyHash = await this.computeHash(apiKey);

    const entity = await this.db.reader
      .selectFrom('apiKeys')
      .selectAll('apiKeys')
      .where('hash', '=', verifyHash)
      .executeTakeFirst();

    if (!entity) return undefined;

    await this.db.writer
      .updateTable('apiKeys')
      .set({
        lastUsedAt: new Date(),
      })
      .where('workspaceId', '=', entity.workspaceId)
      .where('environmentId', '=', entity.environmentId)
      .where('apiKeyId', '=', entity.apiKeyId)
      .execute();

    const { hash, ...rest } = entity;
    return rest;
  }

  private async computeHash(apiKey: string): Promise<string> {
    return argon2.hash(apiKey);
  }

  private maskKey(generatedKey: string): string {
    return `${generatedKey.slice(0, 6)}${'*'.repeat(20)}${generatedKey.slice(
      -4
    )}`;
  }

  private getApiKeyCacheKey(
    workspaceId: string,
    environmentId: string,
    apiKeyId: string,
    includesUser: boolean
  ) {
    return `api-key:${workspaceId}:${environmentId}:${apiKeyId}${
      includesUser ? ':includesUser' : ''
    }`;
  }
}
