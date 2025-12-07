import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { DatabaseService } from '../storage/database.service';
import { WorkspaceEntity } from './entities/workspace.entity';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import { UserEntity } from '../users/entities/user.entity';
import { PublicWorkspaceUserRole } from '../storage/entities.generated';
import { UpdateWorkspaceDto } from './dto/update-workspace.dto';
import { throwServiceError } from '../error';
import { ErrorCode } from '../error-code';
import { Cache, CACHE_MANAGER } from '@nestjs/cache-manager';
import { ListWorkspaceDto } from './dto/list-workspace.dto';
import { Expression } from 'kysely';
import { jsonArrayFrom } from 'kysely/helpers/postgres';
import { AssignWorkspaceUsersDto } from './dto/assign-user.dto';
import { UnassignWorkspaceUsersDto } from './dto/unassign-user.dto';

@Injectable()
export class WorkspaceService {
  constructor(
    private readonly db: DatabaseService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache
  ) {}

  public async throwIfNotWorkspaceMember(
    workspaceId: string,
    userId: string,
    role?: PublicWorkspaceUserRole
  ): Promise<void | never> {
    const workspaceUser = await this.cache.wrap(
      this.getWorkspaceMemberCacheKey(workspaceId, userId),
      () =>
        this.db.reader
          .selectFrom('workspaceUsers')
          .select('role')
          .where('workspaceId', '=', workspaceId)
          .where('userId', '=', userId)
          .executeTakeFirst()
    );
    if (!workspaceUser) {
      throwServiceError(HttpStatus.BAD_REQUEST, ErrorCode.WORKSPACE_NOT_MEMBER);
    }

    if (role && workspaceUser.role !== role) {
      throwServiceError(
        HttpStatus.BAD_REQUEST,
        ErrorCode.WORKSPACE_INSUFFICIENT_PERMISSIONS,
        { workspaceId, role: workspaceUser.role, requiredRole: role }
      );
    }
  }

  public async getAll({
    userId,
    includesUsers,
    includesEnvironments,
  }: ListWorkspaceDto): Promise<WorkspaceEntity[]> {
    return await this.db.reader
      .selectFrom('workspaces')
      .selectAll('workspaces')
      .$if(!!includesUsers, this.db.includeEntityControlUsers('workspaces'))
      .$if(!!userId, (qb) =>
        qb
          .innerJoin(
            'workspaceUsers',
            'workspaces.workspaceId',
            'workspaceUsers.workspaceId'
          )
          .where('workspaceUsers.userId', '=', userId as string)
      )
      .$if(!!includesEnvironments, (qb) =>
        qb.select((eb) => [
          this.withEnvironments(
            eb.ref('workspaces.workspaceId'),
            !!includesUsers
          ).as('environments'),
        ])
      )
      .orderBy('createdAt', 'desc')
      .execute();
  }

  public async getById(
    workspaceId: string,
    includesUser: boolean
  ): Promise<WorkspaceEntity>;

  public async getById<T extends false>(
    workspaceId: string,
    includesUser: boolean,
    throwOnNotFound: T
  ): Promise<WorkspaceEntity | undefined>;

  public async getById<T extends true>(
    workspaceId: string,
    includesUser: boolean,
    throwOnNotFound: T
  ): Promise<WorkspaceEntity>;

  public async getById(
    workspaceId: string,
    includesUser = false,
    throwOnNotFound = true
  ): Promise<WorkspaceEntity | undefined> {
    const workspace = await this.cache.wrap(
      this.getWorkspaceCacheKey(workspaceId, includesUser),
      () =>
        this.db.reader
          .selectFrom('workspaces')
          .selectAll('workspaces')
          .$if(includesUser, this.db.includeEntityControlUsers('workspaces'))
          .where('workspaceId', '=', workspaceId)
          .executeTakeFirst()
    );

    if (throwOnNotFound && !workspace) {
      throwServiceError(HttpStatus.NOT_FOUND, ErrorCode.WORKSPACE_NOT_FOUND, {
        workspaceId,
      });
    }

    return workspace;
  }

  public async getByIds(workspaceIds: string[]): Promise<WorkspaceEntity[]> {
    if (workspaceIds.length === 0) return [];
    return await this.db.reader
      .selectFrom('workspaces')
      .selectAll('workspaces')
      .where('workspaceId', 'in', workspaceIds)
      .execute();
  }

  public async create(
    payload: CreateWorkspaceDto,
    user: UserEntity
  ): Promise<WorkspaceEntity> {
    return this.db.writer.transaction().execute(async (tx) => {
      const workspace = await tx
        .insertInto('workspaces')
        .values({ ...payload, createdBy: user.id, updatedBy: user.id })
        .returningAll()
        .executeTakeFirstOrThrow();

      await tx
        .insertInto('workspaceUsers')
        .values({
          workspaceId: workspace.workspaceId,
          userId: user.id,
          addedBy: user.id,
          role: PublicWorkspaceUserRole.OWNER,
        })
        .execute();

      return workspace;
    });
  }

  public async assignUsers(
    workspaceId: string,
    payload: AssignWorkspaceUsersDto,
    user: UserEntity
  ): Promise<void> {
    await this.db.writer
      .insertInto('workspaceUsers')
      .values(
        payload.userIds.map((userId) => ({
          workspaceId,
          userId,
          addedBy: user.id,
          role: payload.role,
        }))
      )
      .execute();
  }

  public async unassignUsers(
    workspaceId: string,
    payload: UnassignWorkspaceUsersDto
  ): Promise<void> {
    await this.db.writer
      .deleteFrom('workspaceUsers')
      .where('workspaceId', '=', workspaceId)
      .where('userId', 'in', payload.userIds)
      .execute();

    await this.cache.mdel(
      payload.userIds.map((userId) =>
        this.getWorkspaceMemberCacheKey(workspaceId, userId)
      )
    );
  }

  public async update(
    workspaceId: string,
    payload: UpdateWorkspaceDto,
    user: UserEntity
  ): Promise<WorkspaceEntity> {
    const workspace = await this.db.writer
      .updateTable('workspaces')
      .set({
        ...payload,
        updatedBy: user.id,
        updatedAt: new Date(),
      })
      .where('workspaceId', '=', workspaceId)
      .returningAll()
      .executeTakeFirstOrThrow();

    await this.cache.mdel([
      this.getWorkspaceCacheKey(workspace.workspaceId, true),
      this.getWorkspaceCacheKey(workspace.workspaceId, false),
    ]);

    return workspace;
  }

  public async delete(workspaceId: string): Promise<void> {
    await this.db.writer
      .deleteFrom('workspaces')
      .where('workspaceId', '=', workspaceId)
      .execute();

    await this.cache.mdel([
      this.getWorkspaceCacheKey(workspaceId, true),
      this.getWorkspaceCacheKey(workspaceId, false),
    ]);
  }

  private getWorkspaceCacheKey(workspaceId: string, includesUser: boolean) {
    return `workspace:${workspaceId}${includesUser ? ':includesUser' : ''}`;
  }

  private getWorkspaceMemberCacheKey(workspaceId: string, userId: string) {
    return `workspace-member:${workspaceId}:${userId}`;
  }

  private withEnvironments(
    workspaceId: Expression<string>,
    includesUsers: boolean
  ) {
    return jsonArrayFrom(
      this.db.reader
        .selectFrom('environments')
        .selectAll('environments')
        .$if(!!includesUsers, this.db.includeEntityControlUsers('environments'))
        .where('workspaceId', '=', workspaceId)
        .orderBy('name')
    );
  }
}
