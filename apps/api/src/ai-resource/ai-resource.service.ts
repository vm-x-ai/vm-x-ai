import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { DatabaseService } from '../storage/database.service';
import { WorkspaceService } from '../workspace/workspace.service';
import { Cache, CACHE_MANAGER } from '@nestjs/cache-manager';
import { AIResourceEntity } from './entities/ai-resource.entity';
import { throwServiceError } from '../error';
import { ErrorCode } from '../error-code';
import { CreateAIResourceDto } from './dto/create-ai-resource.dto';
import { UserEntity } from '../users/entities/user.entity';
import { UpdateAIResourceDto } from './dto/update-ai-resource.dto';
import { DatabaseError } from 'pg';

@Injectable()
export class AIResourceService {
  constructor(
    private readonly db: DatabaseService,
    private readonly workspaceService: WorkspaceService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache
  ) {}

  public async getAll(includesUsers = false): Promise<AIResourceEntity[]> {
    return await this.db.reader
      .selectFrom('aiResources')
      .selectAll('aiResources')
      .$if(includesUsers, this.db.includeEntityControlUsers('aiResources'))
      .orderBy('createdAt', 'desc')
      .execute();
  }

  public async getById(
    workspaceId: string,
    environmentId: string,
    resource: string,
    includesUser: boolean
  ): Promise<AIResourceEntity>;

  public async getById<T extends false>(
    workspaceId: string,
    environmentId: string,
    resource: string,
    includesUser: boolean,
    throwOnNotFound: T
  ): Promise<AIResourceEntity | undefined>;

  public async getById<T extends true>(
    workspaceId: string,
    environmentId: string,
    resource: string,
    includesUser: boolean,
    throwOnNotFound: T
  ): Promise<AIResourceEntity>;

  public async getById(
    workspaceId: string,
    environmentId: string,
    resource: string,
    includesUser = false,
    throwOnNotFound = true
  ): Promise<AIResourceEntity | undefined> {
    const aiResource = await this.cache.wrap(
      this.getAIResourceCacheKey(
        workspaceId,
        environmentId,
        resource,
        includesUser
      ),
      () =>
        this.db.reader
          .selectFrom('aiResources')
          .selectAll('aiResources')
          .$if(includesUser, this.db.includeEntityControlUsers('aiResources'))
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

  public async getAllByMemberUserId(
    workspaceId: string,
    environmentId: string,
    userId: string,
    includesUser = false
  ): Promise<AIResourceEntity[]> {
    return await this.db.reader
      .selectFrom('aiResources')
      .selectAll('aiResources')
      .$if(includesUser, this.db.includeEntityControlUsers('aiResources'))
      .innerJoin(
        'workspaceUsers',
        'aiResources.workspaceId',
        'workspaceUsers.workspaceId'
      )
      .where('aiResources.workspaceId', '=', workspaceId)
      .where('aiResources.environmentId', '=', environmentId)
      .where('workspaceUsers.userId', '=', userId)
      .execute();
  }

  public async getByMemberUserId(
    workspaceId: string,
    environmentId: string,
    resource: string,
    userId: string,
    includesUser: boolean
  ): Promise<AIResourceEntity>;

  public async getByMemberUserId<T extends false>(
    workspaceId: string,
    environmentId: string,
    resource: string,
    userId: string,
    includesUser: boolean,
    throwOnNotFound: T
  ): Promise<AIResourceEntity | undefined>;

  public async getByMemberUserId<T extends true>(
    workspaceId: string,
    environmentId: string,
    resource: string,
    userId: string,
    includesUser: boolean,
    throwOnNotFound: T
  ): Promise<AIResourceEntity>;

  public async getByMemberUserId(
    workspaceId: string,
    environmentId: string,
    resource: string,
    userId: string,
    includesUser: boolean,
    throwOnNotFound = true
  ): Promise<AIResourceEntity | undefined> {
    const aiResource = await this.db.reader
      .selectFrom('aiResources')
      .selectAll('aiResources')
      .innerJoin(
        'workspaceUsers',
        'aiResources.workspaceId',
        'workspaceUsers.workspaceId'
      )
      .where('workspaceUsers.userId', '=', userId)
      .where('aiResources.workspaceId', '=', workspaceId)
      .where('aiResources.environmentId', '=', environmentId)
      .where('aiResources.resource', '=', resource)
      .$if(includesUser, this.db.includeEntityControlUsers('aiResources'))
      .executeTakeFirst();

    if (throwOnNotFound && !aiResource) {
      throwServiceError(HttpStatus.NOT_FOUND, ErrorCode.AI_RESOURCE_NOT_FOUND, {
        resource,
      });
    }

    return aiResource;
  }

  public async create(
    workspaceId: string,
    environmentId: string,
    payload: CreateAIResourceDto,
    user: UserEntity
  ): Promise<AIResourceEntity> {
    await this.workspaceService.throwIfNotWorkspaceMember(workspaceId, user.id);

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
    await this.workspaceService.throwIfNotWorkspaceMember(workspaceId, user.id);

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
    resource: string,
    user: UserEntity
  ): Promise<void> {
    await this.workspaceService.throwIfNotWorkspaceMember(workspaceId, user.id);
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
