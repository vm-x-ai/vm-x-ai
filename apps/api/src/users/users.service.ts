import { HttpStatus, Injectable } from '@nestjs/common';
import { DatabaseService } from '../storage/database.service';
import { FullUserEntity, UserEntity } from './user.entity';
import * as oidcClient from 'openid-client';
import { OperandExpression, SqlBool } from 'kysely';
import { ErrorCode } from '../types';
import { throwServiceError } from '../error';
import { PublicProviderType } from '../storage/entities.generated';

@Injectable()
export class UsersService {
  constructor(private readonly db: DatabaseService) {}

  public async getAll(): Promise<UserEntity[]> {
    const users = await this.db.reader
      .selectFrom('users')
      .selectAll()
      .orderBy('createdAt', 'asc')
      .execute();

    return users.map(({ passwordHash, ...user }) => user);
  }

  public async get(id: string): Promise<FullUserEntity | undefined> {
    const user = await this.db.reader
      .selectFrom('users')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    return user;
  }

  public async getByUsername(
    usernameOrEmail: string
  ): Promise<FullUserEntity | undefined> {
    const user = await this.db.reader
      .selectFrom('users')
      .selectAll()
      .where((eb) =>
        eb.or([
          eb(eb.fn('lower', ['username']), '=', usernameOrEmail.toLowerCase()),
          eb(eb.fn('lower', ['email']), '=', usernameOrEmail.toLowerCase()),
        ])
      )
      .executeTakeFirst();

    return user;
  }

  public async createOidcUser(claims: oidcClient.IDToken): Promise<UserEntity> {
    return await this.db.writer.transaction().execute(async (tx) => {
      const email = claims.email as string | undefined;
      if (!email) {
        throwServiceError(
          HttpStatus.BAD_REQUEST,
          ErrorCode.OIDC_RESPONSE_ERROR,
          'Email not available in the ID token'
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
          ErrorCode.OIDC_RESPONSE_ERROR,
          'Email mismatch between the ID token and the user'
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
          ErrorCode.OIDC_RESPONSE_ERROR,
          'Provider ID mismatch between the ID token and the user'
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
}
