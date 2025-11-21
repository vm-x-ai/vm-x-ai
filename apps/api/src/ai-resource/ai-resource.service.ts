import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { DatabaseService } from '../storage/database.service';
import { Cache, CACHE_MANAGER } from '@nestjs/cache-manager';
import { AIResourceEntity } from './entities/ai-resource.entity';
import { throwServiceError } from '../error';
import { ErrorCode } from '../error-code';
import { CreateAIResourceDto } from './dto/create-ai-resource.dto';
import { UserEntity } from '../users/entities/user.entity';
import { UpdateAIResourceDto } from './dto/update-ai-resource.dto';
import { DatabaseError } from 'pg';
import { ListAIResourceDto } from './dto/list-ai-resource.dto';
import { GetAIResourceDto } from './dto/get-ai-resource.dto';
import { sql } from 'kysely';

@Injectable()
export class AIResourceService {
  constructor(
    private readonly db: DatabaseService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache
  ) {}

  public async getAll({
    workspaceId,
    environmentId,
    includesUsers = false,
    connectionId,
  }: ListAIResourceDto): Promise<AIResourceEntity[]> {
    return await this.db.reader
      .selectFrom('aiResources')
      .selectAll('aiResources')
      .$if(!!includesUsers, this.db.includeEntityControlUsers('aiResources'))
      .$if(!!workspaceId, (qb) =>
        qb.where('aiResources.workspaceId', '=', workspaceId as string)
      )
      .$if(!!environmentId, (qb) =>
        qb.where('aiResources.environmentId', '=', environmentId as string)
      )
      .$if(!!connectionId, (qb) =>
        qb.where((eb) =>
          eb.or([
            eb(sql`COALESCE(model::text, '')`, 'like', connectionId),
            eb(sql`COALESCE(fallback_models::text, '')`, 'like', connectionId),
            eb(sql`COALESCE(secondary_models::text, '')`, 'like', connectionId),
            eb(sql`COALESCE(routing::text, '')`, 'like', connectionId),
          ])
        )
      )
      .orderBy('createdAt', 'desc')
      .execute();
  }

  public async getById(payload: GetAIResourceDto): Promise<AIResourceEntity>;

  public async getById<T extends false>(
    payload: GetAIResourceDto,
    throwOnNotFound: T
  ): Promise<AIResourceEntity | undefined>;

  public async getById<T extends true>(
    payload: GetAIResourceDto,
    throwOnNotFound: T
  ): Promise<AIResourceEntity>;

  public async getById(
    payload: GetAIResourceDto,
    throwOnNotFound: boolean
  ): Promise<AIResourceEntity | undefined>;

  public async getById(
    { workspaceId, environmentId, resource, includesUsers }: GetAIResourceDto,
    throwOnNotFound = true
  ): Promise<AIResourceEntity | undefined> {
    const aiResource = await this.cache.wrap(
      this.getAIResourceCacheKey(
        workspaceId,
        environmentId,
        resource,
        !!includesUsers
      ),
      () =>
        this.db.reader
          .selectFrom('aiResources')
          .selectAll('aiResources')
          .$if(
            !!includesUsers,
            this.db.includeEntityControlUsers('aiResources')
          )
          .where('workspaceId', '=', workspaceId)
          .where('environmentId', '=', environmentId)
          .where('resource', '=', resource)
          .executeTakeFirst()
    );

    if (throwOnNotFound && !aiResource) {
      throwServiceError(HttpStatus.NOT_FOUND, ErrorCode.AI_RESOURCE_NOT_FOUND, {
        resource,
      });
    }

    return aiResource;
  }

  public async getByIds(
    workspaceId: string,
    environmentId: string,
    resourceIds: string[]
  ): Promise<AIResourceEntity[]> {
    return await this.db.reader
      .selectFrom('aiResources')
      .selectAll('aiResources')
      .where('workspaceId', '=', workspaceId)
      .where('environmentId', '=', environmentId)
      .where('resource', 'in', resourceIds)
      .execute();
  }

  public async create(
    workspaceId: string,
    environmentId: string,
    payload: CreateAIResourceDto,
    user: UserEntity
  ): Promise<AIResourceEntity> {
    try {
      return await this.db.writer
        .insertInto('aiResources')
        .values({
          ...payload,
          workspaceId,
          environmentId,
          model: JSON.stringify(payload.model),
          routing: payload.routing ? JSON.stringify(payload.routing) : null,
          secondaryModels: payload.secondaryModels
            ? JSON.stringify(payload.secondaryModels)
            : null,
          fallbackModels: payload.fallbackModels
            ? JSON.stringify(payload.fallbackModels)
            : null,
          capacity: payload.capacity ? JSON.stringify(payload.capacity) : null,
          enforceCapacity: payload.enforceCapacity,
          createdBy: user.id,
          updatedBy: user.id,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
    } catch (error) {
      if (error instanceof DatabaseError && error.code === '23505') {
        throwServiceError(
          HttpStatus.BAD_REQUEST,
          ErrorCode.AI_RESOURCE_ALREADY_EXISTS,
          {
            resource: payload.resource,
          }
        );
      }
      throw error;
    }
  }

  public async update(
    workspaceId: string,
    environmentId: string,
    resource: string,
    payload: UpdateAIResourceDto,
    user: UserEntity
  ): Promise<AIResourceEntity> {
    const aiResource = await this.db.writer
      .updateTable('aiResources')
      .set({
        ...payload,
        model: payload.model ? JSON.stringify(payload.model) : undefined,
        routing: payload.routing ? JSON.stringify(payload.routing) : undefined,
        secondaryModels: payload.secondaryModels
          ? JSON.stringify(payload.secondaryModels)
          : undefined,
        fallbackModels: payload.fallbackModels
          ? JSON.stringify(payload.fallbackModels)
          : undefined,
        capacity: payload.capacity
          ? JSON.stringify(payload.capacity)
          : undefined,
        updatedBy: user.id,
        updatedAt: new Date(),
      })
      .where('workspaceId', '=', workspaceId)
      .where('environmentId', '=', environmentId)
      .where('resource', '=', resource)
      .returningAll()
      .executeTakeFirstOrThrow();

    await this.cache.mdel([
      this.getAIResourceCacheKey(workspaceId, environmentId, resource, true),
      this.getAIResourceCacheKey(workspaceId, environmentId, resource, false),
    ]);

    return aiResource;
  }

  public async delete(
    workspaceId: string,
    environmentId: string,
    resource: string
  ): Promise<void> {
    await this.db.writer
      .deleteFrom('aiResources')
      .where('workspaceId', '=', workspaceId)
      .where('environmentId', '=', environmentId)
      .where('resource', '=', resource)
      .execute();

    await this.cache.mdel([
      this.getAIResourceCacheKey(workspaceId, environmentId, resource, true),
      this.getAIResourceCacheKey(workspaceId, environmentId, resource, false),
    ]);
  }

  private getAIResourceCacheKey(
    workspaceId: string,
    environmentId: string,
    resource: string,
    includesUser: boolean
  ) {
    return `ai-resource:${workspaceId}:${environmentId}:${resource}${
      includesUser ? ':includesUser' : ''
    }`;
  }
}
