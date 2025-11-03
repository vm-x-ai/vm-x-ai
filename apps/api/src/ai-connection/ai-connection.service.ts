import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { DatabaseService } from '../storage/database.service';
import { WorkspaceService } from '../workspace/workspace.service';
import { Cache, CACHE_MANAGER } from '@nestjs/cache-manager';
import { AIConnectionEntity } from './entities/ai-connection.entity';
import { throwServiceError } from '../error';
import { ErrorCode } from '../error-code';
import { CreateAIConnectionDto } from './dto/create-ai-connection.dto';
import { UserEntity } from '../users/entities/user.entity';
import { UpdateAIConnectionDto } from './dto/update-ai-connection.dto';
import { sql } from 'kysely';
import { AIProviderService } from '../ai-provider/ai-provider.service';
import { AIProviderDto } from '../ai-provider/dto/ai-provider.dto';
import { aiProviderConfigSchemaValidator } from '../ai-provider/ai-provider-config.schema';
import { EncryptionService } from '../vault/encryption.service';
import { JSONSchema7 } from 'json-schema';
import { v4 as uuidv4 } from 'uuid';
import { PinoLogger } from 'nestjs-pino';

const MASKED_VALUE = '********';

@Injectable()
export class AIConnectionService {
  private preloadedConnections: Record<
    string,
    { entity: AIConnectionEntity; fetchedAt: number }
  > = {};

  constructor(
    private readonly logger: PinoLogger,
    private readonly db: DatabaseService,
    private readonly workspaceService: WorkspaceService,
    private readonly aiProviderService: AIProviderService,
    private readonly encryptionService: EncryptionService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache
  ) {
    this.preload();
  }

  private async preload() {
    this.logger.info('Preloading AI connections');
    const connections = await this.getAll(false, true);
    for (const connection of connections) {
      this.preloadedConnections[connection.connectionId] = {
        entity: connection,
        fetchedAt: Date.now(),
      };
    }
    this.logger.info(
      {
        count: connections.length,
      },
      'Preloaded AI connections'
    );
  }

  public async getAll(
    includesUsers = false,
    decrypt = false
  ): Promise<AIConnectionEntity[]> {
    const connections = await this.db.reader
      .selectFrom('aiConnections')
      .selectAll('aiConnections')
      .$if(includesUsers, this.db.includeEntityControlUsers('aiConnections'))
      .orderBy('createdAt', 'desc')
      .execute();

    if (decrypt) {
      return await Promise.all(
        connections.map(async (connection) => {
          const provider = this.aiProviderService.get(connection.provider);
          if (!provider) {
            return connection;
          }
          await this.decryptSecretFields(
            provider.provider,
            connection.connectionId,
            connection.config
          );

          return connection;
        })
      );
    }

    return this.hideSecretValuesFromConnections(connections);
  }

  public async getById(
    workspaceId: string,
    environmentId: string,
    connectionId: string,
    includesUser: boolean,
    decrypt: boolean
  ): Promise<AIConnectionEntity>;

  public async getById<T extends false>(
    workspaceId: string,
    environmentId: string,
    connectionId: string,
    includesUser: boolean,
    decrypt: boolean,
    throwOnNotFound: T
  ): Promise<AIConnectionEntity | undefined>;

  public async getById<T extends true>(
    workspaceId: string,
    environmentId: string,
    connectionId: string,
    includesUser: boolean,
    decrypt: boolean,
    throwOnNotFound: T
  ): Promise<AIConnectionEntity>;

  public async getById(
    workspaceId: string,
    environmentId: string,
    connectionId: string,
    includesUser = false,
    decrypt = false,
    throwOnNotFound = true
  ): Promise<AIConnectionEntity | undefined> {
    const shouldRevalidate = await this.shouldRevalidate(
      workspaceId,
      environmentId,
      connectionId,
      includesUser
    );
    if (decrypt && !shouldRevalidate) {
      return this.preloadedConnections[connectionId]?.entity;
    }

    const aiConnection = await this.db.reader
      .selectFrom('aiConnections')
      .selectAll('aiConnections')
      .$if(includesUser, this.db.includeEntityControlUsers('aiConnections'))
      .where('workspaceId', '=', workspaceId)
      .where('environmentId', '=', environmentId)
      .where('connectionId', '=', connectionId)
      .executeTakeFirst();

    if (throwOnNotFound && !aiConnection) {
      throwServiceError(
        HttpStatus.NOT_FOUND,
        ErrorCode.AI_CONNECTION_NOT_FOUND,
        {
          connectionId,
        }
      );
    }

    if (decrypt && aiConnection && aiConnection.config) {
      const provider = this.aiProviderService.get(aiConnection.provider);
      if (!provider) {
        throwServiceError(
          HttpStatus.BAD_REQUEST,
          ErrorCode.AI_PROVIDER_NOT_FOUND,
          {
            id: aiConnection.provider,
          }
        );
      }

      await this.decryptSecretFields(
        provider.provider,
        connectionId,
        aiConnection.config
      );

      this.preloadedConnections[connectionId] = {
        entity: aiConnection,
        fetchedAt: Date.now(),
      };
    }

    return aiConnection;
  }

  public async getAllByMemberUserId(
    workspaceId: string,
    environmentId: string,
    userId: string,
    includesUser = false
  ): Promise<AIConnectionEntity[]> {
    const connections = await this.db.reader
      .selectFrom('aiConnections')
      .selectAll('aiConnections')
      .$if(includesUser, this.db.includeEntityControlUsers('aiConnections'))
      .innerJoin(
        'workspaceUsers',
        'aiConnections.workspaceId',
        'workspaceUsers.workspaceId'
      )
      .where('aiConnections.workspaceId', '=', workspaceId)
      .where('aiConnections.environmentId', '=', environmentId)
      .where('workspaceUsers.userId', '=', userId)
      .execute();

    return this.hideSecretValuesFromConnections(connections);
  }

  public async getByMemberUserId(
    workspaceId: string,
    environmentId: string,
    connectionId: string,
    userId: string,
    includesUser: boolean
  ): Promise<AIConnectionEntity>;

  public async getByMemberUserId<T extends false>(
    workspaceId: string,
    environmentId: string,
    connectionId: string,
    userId: string,
    includesUser: boolean,
    throwOnNotFound: T
  ): Promise<AIConnectionEntity | undefined>;

  public async getByMemberUserId<T extends true>(
    workspaceId: string,
    environmentId: string,
    connectionId: string,
    userId: string,
    includesUser: boolean,
    throwOnNotFound: T
  ): Promise<AIConnectionEntity>;

  public async getByMemberUserId(
    workspaceId: string,
    environmentId: string,
    connectionId: string,
    userId: string,
    includesUser: boolean,
    throwOnNotFound = true
  ): Promise<AIConnectionEntity | undefined> {
    const aiConnection = await this.db.reader
      .selectFrom('aiConnections')
      .selectAll('aiConnections')
      .innerJoin(
        'workspaceUsers',
        'aiConnections.workspaceId',
        'workspaceUsers.workspaceId'
      )
      .where('workspaceUsers.userId', '=', userId)
      .where('aiConnections.workspaceId', '=', workspaceId)
      .where('aiConnections.environmentId', '=', environmentId)
      .where('aiConnections.connectionId', '=', connectionId)
      .$if(includesUser, this.db.includeEntityControlUsers('aiConnections'))
      .executeTakeFirst();

    if (throwOnNotFound && !aiConnection) {
      throwServiceError(
        HttpStatus.NOT_FOUND,
        ErrorCode.AI_CONNECTION_NOT_FOUND,
        {
          connectionId,
        }
      );
    }

    if (!aiConnection) return aiConnection;

    const provider = this.aiProviderService.get(aiConnection.provider);
    if (!provider) {
      throwServiceError(
        HttpStatus.BAD_REQUEST,
        ErrorCode.AI_PROVIDER_NOT_FOUND,
        {
          id: aiConnection.provider,
        }
      );
    }

    return this.hideSecretFields(provider.provider, aiConnection);
  }

  public async create(
    workspaceId: string,
    environmentId: string,
    payload: CreateAIConnectionDto,
    user: UserEntity
  ): Promise<AIConnectionEntity> {
    await this.workspaceService.throwIfNotWorkspaceMember(workspaceId, user.id);
    const provider = this.aiProviderService.get(payload.provider);
    if (!provider) {
      throwServiceError(
        HttpStatus.BAD_REQUEST,
        ErrorCode.AI_PROVIDER_NOT_FOUND,
        {
          id: payload.provider,
        }
      );
    }

    await this.validateProviderConfig(provider.provider, payload);
    const connectionId = uuidv4();
    await this.encryptSecretFields(
      workspaceId,
      environmentId,
      connectionId,
      provider.provider,
      payload.config
    );

    const connection = await this.db.writer
      .insertInto('aiConnections')
      .values({
        ...payload,
        connectionId,
        workspaceId,
        environmentId,
        config: payload.config ? JSON.stringify(payload.config) : null,
        capacity: payload.capacity ? JSON.stringify(payload.capacity) : null,
        allowedModels: payload.allowedModels
          ? JSON.stringify(payload.allowedModels)
          : null,
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    return this.hideSecretFields(provider.provider, connection);
  }

  public async update(
    workspaceId: string,
    environmentId: string,
    connectionId: string,
    payload: UpdateAIConnectionDto,
    user: UserEntity
  ): Promise<AIConnectionEntity> {
    await this.workspaceService.throwIfNotWorkspaceMember(workspaceId, user.id);
    const existingConnection = await this.getById(
      workspaceId,
      environmentId,
      connectionId,
      false,
      false
    );
    const provider = this.aiProviderService.get(existingConnection.provider);
    if (!provider) {
      throwServiceError(
        HttpStatus.BAD_REQUEST,
        ErrorCode.AI_PROVIDER_NOT_FOUND,
        {
          id: existingConnection.provider,
        }
      );
    }

    if (payload.config) {
      await this.validateProviderConfig(provider.provider, {
        provider: existingConnection.provider,
        config: payload.config,
      });
      await this.encryptSecretFields(
        workspaceId,
        environmentId,
        connectionId,
        provider.provider,
        payload.config
      );
    }

    const aiConnection = await this.db.writer
      .updateTable('aiConnections')
      .set({
        ...payload,
        allowedModels: payload.allowedModels
          ? JSON.stringify(payload.allowedModels)
          : undefined,
        capacity: payload.capacity
          ? JSON.stringify(payload.capacity)
          : undefined,
        config: payload.config ? JSON.stringify(payload.config) : undefined,
        updatedBy: user.id,
        updatedAt: new Date(),
      })
      .where('workspaceId', '=', workspaceId)
      .where('environmentId', '=', environmentId)
      .where('connectionId', '=', connectionId)
      .returningAll()
      .executeTakeFirstOrThrow();

    await this.cache.mset([
      {
        key: this.getAIConnectionCacheKey(
          workspaceId,
          environmentId,
          connectionId,
          true
        ),
        value: Date.now(),
      },
      {
        key: this.getAIConnectionCacheKey(
          workspaceId,
          environmentId,
          connectionId,
          false
        ),
        value: Date.now(),
      },
    ]);

    return this.hideSecretFields(provider.provider, aiConnection);
  }

  public async delete(
    workspaceId: string,
    environmentId: string,
    connectionId: string,
    user: UserEntity
  ): Promise<void> {
    await this.workspaceService.throwIfNotWorkspaceMember(workspaceId, user.id);
    await this.db.writer.transaction().execute(async (tx) => {
      const connectionIdPattern = `%${connectionId}%`;
      await tx
        .deleteFrom('aiResources')
        .where('workspaceId', '=', workspaceId)
        .where('environmentId', '=', environmentId)
        .where((eb) =>
          eb.or([
            eb(sql`COALESCE(model::text, '')`, 'like', connectionIdPattern),
            eb(
              sql`COALESCE(fallback_models::text, '')`,
              'like',
              connectionIdPattern
            ),
            eb(
              sql`COALESCE(secondary_models::text, '')`,
              'like',
              connectionIdPattern
            ),
            eb(sql`COALESCE(routing::text, '')`, 'like', connectionIdPattern),
          ])
        )
        .execute();

      await tx
        .deleteFrom('aiConnections')
        .where('workspaceId', '=', workspaceId)
        .where('environmentId', '=', environmentId)
        .where('connectionId', '=', connectionId)
        .execute();
    });

    await this.cache.mset([
      {
        key: this.getAIConnectionCacheKey(
          workspaceId,
          environmentId,
          connectionId,
          true
        ),
        value: Date.now(),
      },
      {
        key: this.getAIConnectionCacheKey(
          workspaceId,
          environmentId,
          connectionId,
          false
        ),
        value: Date.now(),
      },
    ]);
  }

  private async validateProviderConfig(
    providerConfig: AIProviderDto,
    payload: Pick<AIConnectionEntity, 'provider' | 'config'>
  ) {
    const validator = aiProviderConfigSchemaValidator.compile(
      providerConfig.config.connection.form
    );
    const valid = validator(payload.config ?? {});
    if (!valid) {
      throwServiceError(
        HttpStatus.BAD_REQUEST,
        ErrorCode.AI_CONNECTION_CONFIG_INVALID,
        {
          error: validator.errors
            ?.map((error) => error.message || error.keyword)
            .join(', '),
        },
        {
          validationErrors: validator.errors,
        }
      );
    }
  }

  private async encryptSecretFields(
    workspaceId: string,
    environmentId: string,
    connectionId: string,
    providerConfig: AIProviderDto,
    config?: AIConnectionEntity['config']
  ) {
    const existingConnection = await this.getById(
      workspaceId,
      environmentId,
      connectionId,
      false,
      false,
      false
    );

    for (const [key, def] of Object.entries(
      providerConfig.config.connection.form.properties ?? {}
    )) {
      if ((def as JSONSchema7).format === 'secret') {
        if (
          config &&
          key in config &&
          typeof config[key] === 'string' &&
          !config[key].startsWith('****')
        ) {
          config[key] = await this.encryptionService.encrypt(
            config[key],
            connectionId
          );
        } else if (
          config &&
          existingConnection?.config &&
          key in existingConnection.config
        ) {
          config[key] = existingConnection.config[key];
        }
      }
    }
  }

  private hideSecretFields(
    providerConfig: AIProviderDto,
    connection: AIConnectionEntity
  ) {
    for (const [key, def] of Object.entries(
      providerConfig.config.connection.form.properties ?? {}
    )) {
      if ((def as JSONSchema7).format === 'secret') {
        if (
          connection.config &&
          key in connection.config &&
          typeof connection.config[key] === 'string'
        ) {
          connection.config[key] = MASKED_VALUE;
        }
      }
    }

    return connection;
  }

  private hideSecretValuesFromConnections(
    connections: AIConnectionEntity[]
  ): AIConnectionEntity[] {
    return connections.map((connection) => {
      const provider = this.aiProviderService.get(connection.provider);
      if (!provider) {
        return connection;
      }

      return this.hideSecretFields(provider.provider, connection);
    });
  }

  private async decryptSecretFields(
    providerConfig: AIProviderDto,
    connectionId: string,
    config?: AIConnectionEntity['config']
  ) {
    for (const [key, def] of Object.entries(
      providerConfig.config.connection.form.properties ?? {}
    )) {
      if ((def as JSONSchema7).format === 'secret') {
        if (config && key in config && typeof config[key] === 'string') {
          config[key] = await this.encryptionService.decrypt(
            config[key],
            connectionId
          );
        }
      }
    }
  }

  private async shouldRevalidate(
    workspaceId: string,
    environmentId: string,
    connectionId: string,
    includesUser: boolean
  ) {
    const cacheKey = this.getAIConnectionCacheKey(
      workspaceId,
      environmentId,
      connectionId,
      includesUser
    );
    const revalidateAt = await this.cache.get<number>(cacheKey);
    if (
      revalidateAt &&
      this.preloadedConnections[connectionId] &&
      revalidateAt > this.preloadedConnections[connectionId]?.fetchedAt
    ) {
      this.logger.info(
        {
          revalidateAt,
          fetchedAt: this.preloadedConnections[connectionId]?.fetchedAt,
        },
        `AI Connection ${connectionId} changed`
      );
      return true;
    }

    return false;
  }

  private getAIConnectionCacheKey(
    workspaceId: string,
    environmentId: string,
    connectionId: string,
    includesUser: boolean
  ) {
    return `ai-connection:${workspaceId}:${environmentId}:${connectionId}${
      includesUser ? ':includesUser' : ''
    }:revalidate`;
  }
}
