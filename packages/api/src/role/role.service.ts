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
import { UnassignRoleDto } from './dto/unassign-role.dto';
import { RoleDto } from './dto/role-dto';
import { UserRoleDto } from './dto/user-role.dto';
import { jsonArrayFrom } from 'kysely/helpers/postgres';
import { camelCaseEmbeds } from '../storage/embed-case';

@Injectable()
export class RoleService {
  constructor(
    private readonly db: DatabaseService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache
  ) {}

  /**
   * Compile a role-policy pattern (action or resource) into an anchored
   * regular expression. `*` is the only wildcard character — it expands
   * to `.*`. Every other regex metacharacter is escaped so it matches
   * literally, and the result is anchored with `^`/`$` so a pattern like
   * `workspace:prod` does not accidentally match `workspace:production`.
   *
   * Exposed as `static` so the bug-fix is unit-testable in isolation
   * without standing up a full `RoleService` instance.
   */
  public static compilePattern(pattern: string): RegExp {
    // Escape every regex metacharacter except `*`, which is the
    // intentional wildcard. The placeholder (a NUL byte) is replaced
    // with `.*` after escaping so that the `.` inside `.*` is not
    // itself escaped.
    const WILDCARD_PLACEHOLDER = '\x00';
    const escaped = pattern
      .replace(/\*/g, WILDCARD_PLACEHOLDER)
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .split(WILDCARD_PLACEHOLDER)
      .join('.*');
    return new RegExp(`^${escaped}$`);
  }

  public async validate(
    userId: string,
    action: string,
    resource: string
  ): Promise<void> {
    const userRoles = await this.getRolesByUserId(userId);
    for (const userRole of userRoles) {
      const role = await this.getById(userRole.roleId, false, false);
      for (const statement of role.policy.statements) {
        for (const statementAction of statement.actions) {
          const regex = RoleService.compilePattern(statementAction);
          if (regex.test(action)) {
            for (const statementResource of statement.resources) {
              const regex = RoleService.compilePattern(statementResource);
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

  public async getAll(includesUsers: boolean): Promise<RoleDto[]> {
    const rows = await this.db.reader
      .selectFrom('roles')
      .selectAll('roles')
      .leftJoin('userRoles', 'roles.roleId', 'userRoles.roleId')
      .select((eb) =>
        eb.fn.count<number>('userRoles.userId').as('membersCount')
      )
      .$if(includesUsers, this.db.includeEntityControlUsers('roles'))
      .groupBy('roles.roleId')
      .execute();
    return rows.map((row) =>
      camelCaseEmbeds(row, ['createdByUser', 'updatedByUser'])
    );
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

  public async getRoleMembers(roleId: string): Promise<UserRoleDto[]> {
    const rows = await this.db.reader
      .selectFrom('userRoles')
      .selectAll('userRoles')
      .select((eb) => [
        this.db
          .withUser(eb.ref('userRoles.userId'), 'user')
          .$notNull()
          .as('user'),
        this.db
          .withUser(eb.ref('userRoles.assignedBy'), 'assignedByUser')
          .$notNull()
          .as('assignedByUser'),
      ])
      .where('roleId', '=', roleId)
      .execute();
    return rows.map((row) => camelCaseEmbeds(row, ['user', 'assignedByUser']));
  }

  public async getById(
    roleId: string,
    includesUser: boolean,
    includesMembers: boolean
  ): Promise<RoleEntity>;

  public async getById<T extends false>(
    roleId: string,
    includesUser: boolean,
    includesMembers: boolean,
    throwOnNotFound: T
  ): Promise<RoleEntity | undefined>;

  public async getById<T extends true>(
    roleId: string,
    includesUser: boolean,
    includesMembers: boolean,
    throwOnNotFound: T
  ): Promise<RoleEntity>;

  public async getById(
    roleId: string,
    includesUser: boolean,
    includesMembers: boolean,
    throwOnNotFound = true
  ): Promise<RoleEntity | undefined> {
    const role = await this.cache.wrap(
      this.getRoleCacheKey(roleId, includesUser, includesMembers),
      async () => {
        const row = await this.db.reader
          .selectFrom('roles')
          .selectAll('roles')
          .$if(includesUser, this.db.includeEntityControlUsers('roles'))
          .$if(includesMembers, (qb) =>
            qb.select((eb) => [
              jsonArrayFrom(
                eb
                  .selectFrom('userRoles')
                  .selectAll('userRoles')
                  .select((eb) => [
                    this.db
                      .withUser(eb.ref('userRoles.userId'), 'user')
                      .$notNull()
                      .as('user'),
                    this.db
                      .withUser(
                        eb.ref('userRoles.assignedBy'),
                        'assignedByUser'
                      )
                      .$notNull()
                      .as('assignedByUser'),
                  ])
                  .where('roleId', '=', roleId)
                  .orderBy('assignedAt', 'asc')
              ).as('members'),
            ])
          )
          .where('roleId', '=', roleId)
          .executeTakeFirst();
        return row
          ? camelCaseEmbeds(row, ['createdByUser', 'updatedByUser', 'members'])
          : undefined;
      }
    );

    if (throwOnNotFound && !role) {
      throwServiceError(HttpStatus.NOT_FOUND, ErrorCode.ROLE_NOT_FOUND, {
        roleId,
      });
    }

    return role;
  }

  public async getByName(name: string): Promise<RoleEntity | undefined> {
    return await this.db.reader
      .selectFrom('roles')
      .selectAll('roles')
      .where('name', '=', name)
      .executeTakeFirst();
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
      this.getRoleCacheKey(roleId, true, false),
      this.getRoleCacheKey(roleId, false, false),
      this.getRoleCacheKey(roleId, true, true),
      this.getRoleCacheKey(roleId, false, true),
    ]);

    return role;
  }

  public async assignUsersToRole(
    roleId: string,
    payload: AssignRoleDto,
    user: UserEntity
  ): Promise<void> {
    await this.db.writer
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
      .onConflict((oc) => oc.doNothing())
      .execute();

    await this.cache.mdel([
      ...payload.userIds.map((userId) => this.getUserRoleCacheKey(userId)),
      this.getRoleCacheKey(roleId, true, false),
      this.getRoleCacheKey(roleId, false, false),
      this.getRoleCacheKey(roleId, true, true),
      this.getRoleCacheKey(roleId, false, true),
    ]);
  }

  public async unassignUsersFromRole(
    roleId: string,
    payload: UnassignRoleDto
  ): Promise<void> {
    await this.db.writer
      .deleteFrom('userRoles')
      .where('roleId', '=', roleId)
      .where('userId', 'in', payload.userIds)
      .execute();

    await this.cache.mdel([
      ...payload.userIds.map((userId) => this.getUserRoleCacheKey(userId)),
      this.getRoleCacheKey(roleId, true, false),
      this.getRoleCacheKey(roleId, false, false),
      this.getRoleCacheKey(roleId, true, true),
      this.getRoleCacheKey(roleId, false, true),
    ]);
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
      this.getRoleCacheKey(roleId, true, false),
      this.getRoleCacheKey(roleId, false, false),
      this.getRoleCacheKey(roleId, true, true),
      this.getRoleCacheKey(roleId, false, true),
      ...userRoles.map(({ userId }) => this.getUserRoleCacheKey(userId)),
    ]);
  }

  private getRoleCacheKey(
    roleId: string,
    includesUser: boolean,
    includesMembers: boolean
  ) {
    return `role:${roleId}${includesUser ? ':includesUser' : ''}${
      includesMembers ? ':includesMembers' : ''
    }`;
  }

  private getUserRoleCacheKey(userId: string) {
    return `userRole:${userId}`;
  }
}
