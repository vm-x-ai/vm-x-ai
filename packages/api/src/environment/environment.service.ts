import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { DatabaseService } from '../storage/database.service';
import { Cache, CACHE_MANAGER } from '@nestjs/cache-manager';
import { EnvironmentEntity } from './entities/environment.entity';
import { throwServiceError } from '../error';
import { ErrorCode } from '../error-code';
import { CreateEnvironmentDto } from './dto/create-environment.dto';
import { UserEntity } from '../users/entities/user.entity';
import { UpdateEnvironmentDto } from './dto/update-environment.dto';
import { ListEnvironmentDto } from './dto/list-environment.dto';
import { GetEnvironmentDto } from './dto/get-environment.dto';
import { camelCaseEmbeds } from '../storage/embed-case';

@Injectable()
export class EnvironmentService {
  constructor(
    private readonly db: DatabaseService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache
  ) {}

  public async getAll({
    workspaceId,
    includesUsers,
  }: ListEnvironmentDto): Promise<EnvironmentEntity[]> {
    const rows = await this.db.reader
      .selectFrom('environments')
      .selectAll('environments')
      .$if(!!includesUsers, this.db.includeEntityControlUsers('environments'))
      .$if(!!workspaceId, (qb) =>
        qb.where('environments.workspaceId', '=', workspaceId as string)
      )
      .orderBy('createdAt', 'desc')
      .execute();
    return rows.map((row) =>
      camelCaseEmbeds(row, ['createdByUser', 'updatedByUser'])
    );
  }

  public async getById(payload: GetEnvironmentDto): Promise<EnvironmentEntity>;

  public async getById<T extends false>(
    payload: GetEnvironmentDto,
    throwOnNotFound: T
  ): Promise<EnvironmentEntity | undefined>;

  public async getById<T extends true>(
    payload: GetEnvironmentDto,
    throwOnNotFound: T
  ): Promise<EnvironmentEntity>;

  public async getById(
    { workspaceId, environmentId, includesUsers }: GetEnvironmentDto,
    throwOnNotFound = true
  ): Promise<EnvironmentEntity | undefined> {
    const environment = await this.cache.wrap(
      this.getEnvironmentCacheKey(workspaceId, environmentId, !!includesUsers),
      async () => {
        const row = await this.db.reader
          .selectFrom('environments')
          .selectAll('environments')
          .$if(
            !!includesUsers,
            this.db.includeEntityControlUsers('environments')
          )
          .where('workspaceId', '=', workspaceId)
          .where('environmentId', '=', environmentId)
          .executeTakeFirst();
        return row
          ? camelCaseEmbeds(row, ['createdByUser', 'updatedByUser'])
          : undefined;
      }
    );

    if (throwOnNotFound && !environment) {
      throwServiceError(HttpStatus.NOT_FOUND, ErrorCode.ENVIRONMENT_NOT_FOUND, {
        environmentId,
      });
    }

    return environment;
  }

  public async getByIds(
    environmentIds: string[]
  ): Promise<EnvironmentEntity[]> {
    if (environmentIds.length === 0) return [];
    return await this.db.reader
      .selectFrom('environments')
      .selectAll('environments')
      .where('environmentId', 'in', environmentIds)
      .execute();
  }

  public async create(
    workspaceId: string,
    payload: CreateEnvironmentDto,
    user: UserEntity
  ): Promise<EnvironmentEntity> {
    return await this.db.writer
      .insertInto('environments')
      .values({
        ...payload,
        workspaceId,
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  public async update(
    workspaceId: string,
    environmentId: string,
    payload: UpdateEnvironmentDto,
    user: UserEntity
  ): Promise<EnvironmentEntity> {
    const environment = await this.db.writer
      .updateTable('environments')
      .set({
        ...payload,
        updatedBy: user.id,
        updatedAt: new Date(),
      })
      .where('workspaceId', '=', workspaceId)
      .where('environmentId', '=', environmentId)
      .returningAll()
      .executeTakeFirstOrThrow();

    await this.cache.mdel([
      this.getEnvironmentCacheKey(workspaceId, environmentId, true),
      this.getEnvironmentCacheKey(workspaceId, environmentId, false),
    ]);

    return environment;
  }

  public async delete(
    workspaceId: string,
    environmentId: string
  ): Promise<void> {
    await this.db.writer
      .deleteFrom('environments')
      .where('workspaceId', '=', workspaceId)
      .where('environmentId', '=', environmentId)
      .execute();

    await this.cache.mdel([
      this.getEnvironmentCacheKey(workspaceId, environmentId, true),
      this.getEnvironmentCacheKey(workspaceId, environmentId, false),
    ]);
  }

  private getEnvironmentCacheKey(
    workspaceId: string,
    environmentId: string,
    includesUser: boolean
  ) {
    return `environment:${workspaceId}:${environmentId}${
      includesUser ? ':includesUser' : ''
    }`;
  }
}
