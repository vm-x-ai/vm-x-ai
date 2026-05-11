import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { DatabaseService } from '../storage/database.service';
import { Cache, CACHE_MANAGER } from '@nestjs/cache-manager';
import { ApiKeyEntity } from './entities/api-key.entity';
import { throwServiceError } from '../error';
import { ErrorCode } from '../error-code';
import { CreateApiKeyDto } from './dto/create-api-key.dto';
import { UserEntity } from '../users/entities/user.entity';
import { nanoid } from 'nanoid';
import { UpdateApiKeyDto } from './dto/update-api-key.dto';
import { CreatedApiKeyDto } from './dto/created-api-key.dto';
import { createHash } from 'crypto';
import { ListApiKeyDto } from './dto/list-api-key.dto';
import { GetApiKeyDto } from './dto/get-api-key.dto';
import { sql, Transaction } from 'kysely';
import { DB } from '../storage/entities.generated';
import { camelCaseEmbeds } from '../storage/embed-case';

@Injectable()
export class ApiKeyService {
  constructor(
    private readonly db: DatabaseService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache
  ) {}

  public async getAll({
    workspaceId,
    environmentId,
    includesUsers,
  }: ListApiKeyDto): Promise<ApiKeyEntity[]> {
    const apiKeys = await this.db.reader
      .selectFrom('apiKeys')
      .selectAll('apiKeys')
      .$if(!!includesUsers, this.db.includeEntityControlUsers('apiKeys'))
      .$if(!!workspaceId, (qb) =>
        qb.where('apiKeys.workspaceId', '=', workspaceId as string)
      )
      .$if(!!environmentId, (qb) =>
        qb.where('apiKeys.environmentId', '=', environmentId as string)
      )
      .orderBy('createdAt', 'desc')
      .execute();

    return apiKeys.map(({ hash, ...apiKey }) =>
      camelCaseEmbeds(apiKey, ['createdByUser', 'updatedByUser'])
    );
  }

  public async getById(payload: GetApiKeyDto): Promise<ApiKeyEntity>;

  public async getById<T extends false>(
    payload: GetApiKeyDto,
    throwOnNotFound: T
  ): Promise<ApiKeyEntity | undefined>;

  public async getById<T extends true>(
    payload: GetApiKeyDto,
    throwOnNotFound: T
  ): Promise<ApiKeyEntity>;

  public async getById(
    { workspaceId, environmentId, apiKeyId, includesUsers }: GetApiKeyDto,
    throwOnNotFound = true
  ): Promise<ApiKeyEntity | undefined> {
    const apiKey = await this.cache.wrap(
      this.getApiKeyCacheKey(
        workspaceId,
        environmentId,
        apiKeyId,
        !!includesUsers
      ),
      async () => {
        const row = await this.db.reader
          .selectFrom('apiKeys')
          .selectAll('apiKeys')
          .$if(!!includesUsers, this.db.includeEntityControlUsers('apiKeys'))
          .where('workspaceId', '=', workspaceId)
          .where('environmentId', '=', environmentId)
          .where('apiKeyId', '=', apiKeyId)
          .executeTakeFirst();
        return row
          ? camelCaseEmbeds(row, ['createdByUser', 'updatedByUser'])
          : undefined;
      }
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

  public async getByIds(apiKeyIds: string[]): Promise<ApiKeyEntity[]> {
    if (apiKeyIds.length === 0) return [];
    return await this.db.reader
      .selectFrom('apiKeys')
      .selectAll('apiKeys')
      .where('apiKeyId', 'in', apiKeyIds)
      .execute();
  }

  public async create(
    workspaceId: string,
    environmentId: string,
    payload: CreateApiKeyDto,
    user: UserEntity
  ): Promise<CreatedApiKeyDto> {
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
      this.getApiKeyHashCacheKey(workspaceId, environmentId, apiKey.hash),
    ]);

    const { hash, ...rest } = apiKey;
    return rest;
  }

  public async appendResource(
    workspaceId: string,
    environmentId: string,
    apiKeyIds: string[],
    resourceId: string,
    tx?: Transaction<DB>
  ): Promise<void> {
    const updatedApiKeys = await (tx ?? this.db.writer)
      .updateTable('apiKeys')
      .set({
        resources: sql`
          (
            SELECT jsonb_agg(DISTINCT e)
            FROM jsonb_array_elements_text(
              resources || ${JSON.stringify([resourceId])}::jsonb
            ) AS t(e)
          )
        `,
      })
      .where('workspaceId', '=', workspaceId)
      .where('environmentId', '=', environmentId)
      .where('apiKeyId', 'in', apiKeyIds)
      .returning(['apiKeyId', 'hash'])
      .execute();

    await this.cache.mdel(
      updatedApiKeys.flatMap(({ apiKeyId, hash }) => [
        this.getApiKeyCacheKey(workspaceId, environmentId, apiKeyId, true),
        this.getApiKeyCacheKey(workspaceId, environmentId, apiKeyId, false),
        this.getApiKeyHashCacheKey(workspaceId, environmentId, hash),
      ])
    );
  }

  public async delete(
    workspaceId: string,
    environmentId: string,
    apiKeyId: string
  ): Promise<void> {
    const apiKey = await this.db.reader
      .selectFrom('apiKeys')
      .selectAll('apiKeys')
      .where('workspaceId', '=', workspaceId)
      .where('environmentId', '=', environmentId)
      .where('apiKeyId', '=', apiKeyId)
      .executeTakeFirst();

    if (!apiKey) {
      throwServiceError(HttpStatus.NOT_FOUND, ErrorCode.API_KEY_NOT_FOUND, {
        apiKeyId,
      });
    }

    await this.db.writer
      .deleteFrom('apiKeys')
      .where('workspaceId', '=', workspaceId)
      .where('environmentId', '=', environmentId)
      .where('apiKeyId', '=', apiKeyId)
      .execute();

    await this.cache.mdel([
      this.getApiKeyCacheKey(workspaceId, environmentId, apiKeyId, true),
      this.getApiKeyCacheKey(workspaceId, environmentId, apiKeyId, false),
      this.getApiKeyHashCacheKey(workspaceId, environmentId, apiKey.hash),
    ]);
  }

  public async deleteResourceFromApiKeys(
    workspaceId: string,
    environmentId: string,
    resourceId: string,
    tx?: Transaction<DB>
  ): Promise<void> {
    const updatedApiKeys = await (tx ?? this.db.writer)
      .updateTable('apiKeys')
      .set({
        resources: sql`
        (
          SELECT jsonb_agg(DISTINCT e)
          FROM jsonb_array_elements_text(
            resources 
          ) AS t(e)
         WHERE e != ${sql.lit(resourceId)}
        )
      `,
      })
      .where('workspaceId', '=', workspaceId)
      .where('environmentId', '=', environmentId)
      .where(sql`COALESCE(resources::text, '')`, 'like', `%${resourceId}%`)
      .returning(['apiKeyId', 'hash'])
      .execute();

    await this.cache.mdel(
      updatedApiKeys.flatMap(({ apiKeyId, hash }) => [
        this.getApiKeyCacheKey(workspaceId, environmentId, apiKeyId, true),
        this.getApiKeyCacheKey(workspaceId, environmentId, apiKeyId, false),
        this.getApiKeyHashCacheKey(workspaceId, environmentId, hash),
      ])
    );
  }

  public async verify(
    apiKey: string,
    workspaceId: string,
    environmentId: string,
    resource: string
  ): Promise<ApiKeyEntity | undefined> {
    const computedHash = await this.computeHash(apiKey);
    const entity = await this.cache.wrap(
      this.getApiKeyHashCacheKey(workspaceId, environmentId, computedHash),
      () =>
        this.db.reader
          .selectFrom('apiKeys')
          .selectAll('apiKeys')
          .where('hash', '=', computedHash)
          .where('workspaceId', '=', workspaceId)
          .where('environmentId', '=', environmentId)
          .where('enabled', '=', true)
          .executeTakeFirst()
    );

    if (!entity) return undefined;

    if (!entity.resources.includes(resource)) {
      throwServiceError(
        HttpStatus.FORBIDDEN,
        ErrorCode.API_KEY_RESOURCE_NOT_AUTHORIZED,
        {
          resource,
        }
      );
    }

    const { hash, ...rest } = entity;
    return rest;
  }

  private async computeHash(apiKey: string): Promise<string> {
    return createHash('sha256').update(apiKey).digest('base64');
  }

  private maskKey(generatedKey: string): string {
    return `${generatedKey.slice(0, 6)}${'*'.repeat(20)}${generatedKey.slice(
      -4
    )}`;
  }

  private getApiKeyHashCacheKey(
    workspaceId: string,
    environmentId: string,
    hash: string
  ) {
    return `api-key:hash:${workspaceId}:${environmentId}:${hash}`;
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
