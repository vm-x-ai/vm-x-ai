import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { DatabaseService } from '../storage/database.service';
import { Cache, CACHE_MANAGER } from '@nestjs/cache-manager';
import { RoleEntity, RolePolicyEffect } from './entities/role.entity';
import { throwServiceError } from '../error';
import { ErrorCode } from '../error-code';
import { CreateRoleDto } from './dto/create-role.dto';
import { UserEntity } from '../users/entities/user.entity';
import { UpdateRoleDto } from './dto/update-role.dto';
import { UserRoleEntity } from './entities/user-role.entity';
import { AssignRoleDto } from './dto/assign-role.dto';
import { modules } from './modules';
import { PermissionsDto } from './dto/permissions.dto';

@Injectable()
export class RoleService {
  constructor(
    private readonly db: DatabaseService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache
  ) {}

  public async validate(
    userId: string,
    action: string,
    resource: string
  ): Promise<void> {
    const userRoles = await this.getRolesByUserId(userId);
    for (const userRole of userRoles) {
      const role = await this.getById(userRole.roleId, false);
      for (const statement of role.policy.statements) {
        for (const statementAction of statement.actions) {
          const regex = new RegExp(
            statementAction.replace(/\*/g, '.*').replace(/\?/g, '.')
          );
          if (regex.test(action)) {
            for (const statementResource of statement.resources) {
              const regex = new RegExp(
                statementResource.replace(/\*/g, '.*').replace(/\?/g, '.')
              );
              if (regex.test(resource)) {
                // If the statement effect is DENY, throw an error
                if (statement.effect === RolePolicyEffect.DENY) {
                  throwServiceError(
                    HttpStatus.FORBIDDEN,
                    ErrorCode.NOT_AUTHORIZED,
                    {
                      action,
                      resource,
                    }
                  );
                }

                return;
              }
            }
          }
        }
      }
    }

    throwServiceError(HttpStatus.FORBIDDEN, ErrorCode.NOT_AUTHORIZED, {
      action,
      resource,
    });
  }

  public getModulePermissions(): PermissionsDto {
    return {
      modules,
    };
  }

  public async getAll(includesUsers: boolean): Promise<RoleEntity[]> {
    return await this.db.reader
      .selectFrom('roles')
      .selectAll('roles')
      .$if(includesUsers, this.db.includeEntityControlUsers('roles'))
      .execute();
  }

  public async getRolesByUserId(userId: string): Promise<UserRoleEntity[]> {
    return await this.cache.wrap(this.getUserRoleCacheKey(userId), () =>
      this.db.reader
        .selectFrom('userRoles')
        .selectAll('userRoles')
        .where('userId', '=', userId)
        .execute()
    );
  }

  public async getById(
    roleId: string,
    includesUser: boolean
  ): Promise<RoleEntity>;

  public async getById<T extends false>(
    roleId: string,
    includesUser: boolean,
    throwOnNotFound: T
  ): Promise<RoleEntity | undefined>;

  public async getById<T extends true>(
    roleId: string,
    includesUser: boolean,
    throwOnNotFound: T
  ): Promise<RoleEntity>;

  public async getById(
    roleId: string,
    includesUser: boolean,
    throwOnNotFound = true
  ): Promise<RoleEntity | undefined> {
    const role = await this.cache.wrap(
      this.getRoleCacheKey(roleId, includesUser),
      () =>
        this.db.reader
          .selectFrom('roles')
          .selectAll('roles')
          .$if(includesUser, this.db.includeEntityControlUsers('roles'))
          .where('roleId', '=', roleId)
          .executeTakeFirst()
    );

    if (throwOnNotFound && !role) {
      throwServiceError(HttpStatus.NOT_FOUND, ErrorCode.ROLE_NOT_FOUND, {
        roleId,
      });
    }

    return role;
  }

  public async create(
    payload: CreateRoleDto,
    user: UserEntity
  ): Promise<RoleEntity> {
    const role = await this.db.writer
      .insertInto('roles')
      .values({
        ...payload,
        policy: JSON.stringify(payload.policy),
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    return role;
  }

  public async update(
    roleId: string,
    payload: UpdateRoleDto,
    user: UserEntity
  ): Promise<RoleEntity> {
    const role = await this.db.writer
      .updateTable('roles')
      .set({
        ...payload,
        policy: JSON.stringify(payload.policy),
        updatedBy: user.id,
        updatedAt: new Date(),
      })
      .where('roleId', '=', roleId)
      .returningAll()
      .executeTakeFirstOrThrow();

    await this.cache.mdel([
      this.getRoleCacheKey(roleId, true),
      this.getRoleCacheKey(roleId, false),
    ]);

    return role;
  }

  public async assignRoleToUser(
    roleId: string,
    payload: AssignRoleDto,
    user: UserEntity
  ): Promise<UserRoleEntity> {
    const userRole = await this.db.writer
      .insertInto('userRoles')
      .values(
        payload.userIds.map((userId) => ({
          roleId,
          userId,
          assignedBy: user.id,
          assignedAt: new Date(),
        }))
      )
      .returningAll()
      .executeTakeFirstOrThrow();

    await this.cache.mdel(
      payload.userIds.map((userId) => this.getUserRoleCacheKey(userId))
    );

    return userRole;
  }

  public async delete(roleId: string): Promise<void> {
    const userRoles = await this.db.reader
      .selectFrom('userRoles')
      .select(['userId'])
      .distinctOn(['userId'])
      .where('roleId', '=', roleId)
      .execute();

    await this.db.writer
      .deleteFrom('roles')
      .where('roleId', '=', roleId)
      .execute();

    await this.cache.mdel([
      this.getRoleCacheKey(roleId, true),
      this.getRoleCacheKey(roleId, false),
      ...userRoles.map(({ userId }) => this.getUserRoleCacheKey(userId)),
    ]);
  }

  private getRoleCacheKey(roleId: string, includesUser: boolean) {
    return `role:${roleId}${includesUser ? ':includesUser' : ''}`;
  }

  private getUserRoleCacheKey(userId: string) {
    return `userRole:${userId}`;
  }
}
