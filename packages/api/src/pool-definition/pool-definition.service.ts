import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { DatabaseService } from '../storage/database.service';
import { Cache, CACHE_MANAGER } from '@nestjs/cache-manager';
import { PoolDefinitionEntity } from './entities/pool-definition.entity';
import { ErrorCode } from '../error-code';
import { throwServiceError } from '../error';
import { UserEntity } from '../users/entities/user.entity';
import { UpsertPoolDefinitionDto } from './dto/upsert-pool-definition.dto';
import { GetPoolDefinitionDto } from './dto/get-pool-definition.dto';
import { Transaction } from 'kysely';
import { DB } from '../storage/entities.generated';
import { camelCaseEmbeds } from '../storage/embed-case';

@Injectable()
export class PoolDefinitionService {
  constructor(
    private readonly db: DatabaseService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache
  ) {}

  public async getAll(includesUsers = false): Promise<PoolDefinitionEntity[]> {
    const rows = await this.db.reader
      .selectFrom('poolDefinitions')
      .selectAll('poolDefinitions')
      .$if(includesUsers, this.db.includeEntityControlUsers('poolDefinitions'))
      .orderBy('createdAt', 'desc')
      .execute();
    return rows.map((row) =>
      camelCaseEmbeds(row, ['createdByUser', 'updatedByUser'])
    );
  }

  public async getById(
    payload: GetPoolDefinitionDto
  ): Promise<PoolDefinitionEntity>;

  public async getById<T extends false>(
    payload: GetPoolDefinitionDto,
    throwOnNotFound: T
  ): Promise<PoolDefinitionEntity | undefined>;

  public async getById<T extends true>(
    payload: GetPoolDefinitionDto,
    throwOnNotFound: T
  ): Promise<PoolDefinitionEntity>;

  public async getById(
    { workspaceId, environmentId, includesUsers }: GetPoolDefinitionDto,
    throwOnNotFound = false
  ): Promise<PoolDefinitionEntity | undefined> {
    const poolDefinition = await this.cache.wrap(
      this.getPoolDefinitionCacheKey(
        workspaceId,
        environmentId,
        !!includesUsers
      ),
      async () => {
        const row = await this.db.reader
          .selectFrom('poolDefinitions')
          .selectAll('poolDefinitions')
          .$if(
            !!includesUsers,
            this.db.includeEntityControlUsers('poolDefinitions')
          )
          .where('workspaceId', '=', workspaceId)
          .where('environmentId', '=', environmentId)
          .executeTakeFirst();
        return row
          ? camelCaseEmbeds(row, ['createdByUser', 'updatedByUser'])
          : undefined;
      }
    );

    if (throwOnNotFound && !poolDefinition) {
      throwServiceError(
        HttpStatus.NOT_FOUND,
        ErrorCode.POOL_DEFINITION_NOT_FOUND,
        {
          workspaceId,
          environmentId,
        }
      );
    }

    return poolDefinition;
  }

  public async upsert(
    workspaceId: string,
    environmentId: string,
    payload: UpsertPoolDefinitionDto,
    user: UserEntity,
    tx?: Transaction<DB>
  ): Promise<PoolDefinitionEntity> {
    const poolDefinition = await (tx ?? this.db.writer)
      .insertInto('poolDefinitions')
      .values({
        ...payload,
        workspaceId,
        environmentId,
        definition: JSON.stringify(payload.definition),
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returningAll()
      .onConflict((oc) =>
        oc
          .column('workspaceId')
          .column('environmentId')
          .doUpdateSet({
            definition: JSON.stringify(payload.definition),
            updatedBy: user.id,
            updatedAt: new Date(),
          })
      )
      .executeTakeFirstOrThrow();

    await this.cache.mdel([
      this.getPoolDefinitionCacheKey(workspaceId, environmentId, true),
      this.getPoolDefinitionCacheKey(workspaceId, environmentId, false),
    ]);

    return poolDefinition;
  }

  public async delete(
    workspaceId: string,
    environmentId: string
  ): Promise<void> {
    await this.db.writer
      .deleteFrom('poolDefinitions')
      .where('workspaceId', '=', workspaceId)
      .where('environmentId', '=', environmentId)
      .execute();

    await this.cache.mdel([
      this.getPoolDefinitionCacheKey(workspaceId, environmentId, true),
      this.getPoolDefinitionCacheKey(workspaceId, environmentId, false),
    ]);
  }

  private getPoolDefinitionCacheKey(
    workspaceId: string,
    environmentId: string,
    includesUser: boolean
  ) {
    return `pool-definition:${workspaceId}:${environmentId}${
      includesUser ? ':includesUser' : ''
    }`;
  }
}
