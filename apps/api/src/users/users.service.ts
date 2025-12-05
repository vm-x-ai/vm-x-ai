import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { DatabaseService } from '../storage/database.service';
import { FullUserEntity, UserEntity } from './entities/user.entity';
import * as oidcClient from 'openid-client';
import { OperandExpression, sql, SqlBool, UpdateObject } from 'kysely';
import { throwServiceError } from '../error';
import { DB, PublicProviderType } from '../storage/entities.generated';
import { ErrorCode } from '../error-code';
import { Cache, CACHE_MANAGER } from '@nestjs/cache-manager';
import { CreateUserDto } from './dto/create-user.dto';
import { PasswordService } from '../auth/password.service';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersService {
  constructor(
    private readonly db: DatabaseService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly passwordService: PasswordService
  ) {}

  public async getAll(): Promise<UserEntity[]> {
    const users = await this.db.reader
      .selectFrom('users')
      .selectAll()
      .orderBy('createdAt', 'asc')
      .execute();

    return users.map(({ passwordHash, ...user }) => user);
  }

  public async getById(id: string): Promise<FullUserEntity | undefined>;

  public async getById<T extends false>(
    id: string,
    throwOnNotFound: T
  ): Promise<FullUserEntity | undefined>;

  public async getById<T extends true>(
    id: string,
    throwOnNotFound: T
  ): Promise<FullUserEntity>;

  public async getById(
    id: string,
    throwOnNotFound = false
  ): Promise<FullUserEntity | undefined> {
    const user = await this.cache.wrap(this.getUserCacheKey(id), () =>
      this.db.reader
        .selectFrom('users')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst()
    );

    if (throwOnNotFound && !user) {
      throwServiceError(HttpStatus.NOT_FOUND, ErrorCode.USER_NOT_FOUND, {
        userId: id,
      });
    }

    return user;
  }

  public async getByIds(ids: string[]): Promise<FullUserEntity[]> {
    if (ids.length === 0) return [];
    const users = await this.db.reader
      .selectFrom('users')
      .selectAll()
      .where('id', 'in', ids)
      .execute();
    return users.map(({ passwordHash, ...user }) => user);
  }

  public async getByUsername(
    usernameOrEmail: string
  ): Promise<FullUserEntity | undefined> {
    const user = await this.cache.wrap(
      this.getUserCacheKeyByUsername(usernameOrEmail),
      () =>
        this.db.reader
          .selectFrom('users')
          .selectAll()
          .where((eb) =>
            eb.or([
              eb(
                eb.fn('lower', ['username']),
                '=',
                usernameOrEmail.toLowerCase()
              ),
              eb(eb.fn('lower', ['email']), '=', usernameOrEmail.toLowerCase()),
            ])
          )
          .executeTakeFirst()
    );

    return user;
  }

  public async create(
    { password, ...payload }: CreateUserDto,
    user: UserEntity
  ): Promise<UserEntity> {
    const { passwordHash, ...result } = await this.db.writer
      .insertInto('users')
      .values({
        ...payload,
        createdBy: user.id,
        updatedBy: user.id,
        providerId: 'local',
        providerType: PublicProviderType.LOCAL,
        emailVerified: false,
        passwordHash: await this.passwordService.hash(password),
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    return result;
  }

  public async update(
    userId: string,
    { password, ...payload }: UpdateUserDto,
    user: UserEntity
  ): Promise<UserEntity> {
    const updatePayload: UpdateObject<DB, 'users'> = {
      ...payload,
      updatedBy: user.id,
      updatedAt: sql`NOW()`,
    };
    if (password) {
      updatePayload.passwordHash = await this.passwordService.hash(password);
    }

    const oldUser = await this.getById(userId, true);
    const result = await this.db.writer.transaction().execute(async (tx) => {
      if (payload.email) {
        const existingUser = await tx
          .selectFrom('users')
          .select('id')
          .where('email', '=', payload.email)
          .where('id', '!=', userId)
          .executeTakeFirst();

        if (existingUser) {
          throwServiceError(
            HttpStatus.BAD_REQUEST,
            ErrorCode.USER_EMAIL_IN_USE,
            {
              email: payload.email,
            }
          );
        }
      }

      if (payload.username) {
        const existingUser = await tx
          .selectFrom('users')
          .select('id')
          .where('username', '=', payload.username)
          .where('id', '!=', userId)
          .executeTakeFirst();

        if (existingUser) {
          throwServiceError(
            HttpStatus.BAD_REQUEST,
            ErrorCode.USER_USERNAME_IN_USE,
            {
              username: payload.username,
            }
          );
        }
      }

      const { passwordHash, ...result } = await tx
        .updateTable('users')
        .set({
          ...updatePayload,
        })
        .where('id', '=', userId)
        .returningAll()
        .executeTakeFirstOrThrow();

      return result;
    });

    await this.cache.mdel([
      this.getUserCacheKey(userId),
      this.getUserCacheKeyByUsername(oldUser.username),
    ]);

    return result;
  }

  public async createOidcUser(claims: oidcClient.IDToken): Promise<UserEntity> {
    return await this.db.writer.transaction().execute(async (tx) => {
      const email = claims.email as string | undefined;
      if (!email) {
        throwServiceError(
          HttpStatus.BAD_REQUEST,
          ErrorCode.OIDC_EMAIL_NOT_AVAILABLE
        );
      }

      const givenName = (claims.given_name ||
        claims.first_name ||
        '') as string;
      const familyName = (claims.family_name ||
        claims.last_name ||
        '') as string;
      const name = (claims.name || `${givenName} ${familyName}`) as string;
      const picture = (claims.picture || claims.picture_url) as
        | string
        | undefined;
      const providerId = claims.sub;

      const user = await tx
        .selectFrom('users')
        .selectAll()
        .where((eb) => {
          const conditions: OperandExpression<SqlBool>[] = [
            eb('providerId', '=', providerId),
          ];
          if (email) {
            conditions.push(eb('email', '=', email));
          }
          return eb.and(conditions);
        })
        .executeTakeFirst();

      if (!user) {
        return await tx
          .insertInto('users')
          .values({
            name,
            firstName: givenName,
            lastName: familyName,
            username: email,
            email,
            pictureUrl: picture,
            providerId,
            providerType: PublicProviderType.OIDC,
            providerMetadata: claims,
            emailVerified: true,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
      } else if (user.email !== email) {
        throwServiceError(
          HttpStatus.BAD_REQUEST,
          ErrorCode.OIDC_EMAIL_MISMATCH
        );
      } else if (!user.providerId) {
        return await tx
          .updateTable('users')
          .set({
            providerId,
            providerType: PublicProviderType.OIDC,
            providerMetadata: claims,
            emailVerified: true,
          })
          .where('id', '=', user.id)
          .returningAll()
          .executeTakeFirstOrThrow();
      } else if (user.providerId !== providerId) {
        throwServiceError(
          HttpStatus.BAD_REQUEST,
          ErrorCode.OIDC_PROVIDER_ID_MISMATCH
        );
      } else if (!user.providerMetadata) {
        return await tx
          .updateTable('users')
          .set({
            providerMetadata: claims,
          })
          .where('id', '=', user.id)
          .returningAll()
          .executeTakeFirstOrThrow();
      }

      return user;
    });
  }

  public async delete(userId: string): Promise<void> {
    const user = await this.getById(userId, true);
    await this.db.writer.deleteFrom('users').where('id', '=', userId).execute();

    await this.cache.mdel([
      this.getUserCacheKey(userId),
      this.getUserCacheKeyByUsername(user.username),
    ]);
  }

  private getUserCacheKey(id: string) {
    return `user:${id}`;
  }

  private getUserCacheKeyByUsername(username: string) {
    return `user:username:${username}`;
  }
}
