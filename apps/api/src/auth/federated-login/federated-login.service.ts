import {
  Injectable,
  OnModuleInit,
  BadRequestException,
  HttpStatus,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import * as oidcClient from 'openid-client';
import { DatabaseService } from '../../storage/database.service';
import { FastifyRequest } from 'fastify';
import { ErrorCode } from '../../types';
import { throwServiceError } from '../../error';
import { UsersService } from '../../users/users.service';
import { UserEntity } from '../../users/user.entity';

@Injectable()
export class FederatedLoginService implements OnModuleInit {
  private issuer: oidcClient.Configuration | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: PinoLogger,
    private readonly db: DatabaseService,
    private readonly usersService: UsersService
  ) {}

  async onModuleInit() {
    const issuerUrl = this.configService.get<string>('OIDC_FEDERATED_ISSUER');
    const clientId = this.configService.get<string>('OIDC_FEDERATED_CLIENT_ID');
    const redirectUri = this.configService.get<string>('OIDC_FEDERATED_REDIRECT_URI');
    if (!issuerUrl || !clientId || !redirectUri) {
      this.logger.warn('OIDC is not configured, skipping OIDC authentication');
      return;
    }

    this.issuer = await oidcClient.discovery(new URL(issuerUrl), clientId, {
      client_secret: this.configService.get<string>('OIDC_FEDERATED_CLIENT_SECRET'),
    });
  }

  get enabled() {
    return this.issuer !== null;
  }

  async getAuthorizationUrl(interactionId: string) {
    if (!this.issuer) {
      throwServiceError(
        HttpStatus.BAD_REQUEST,
        ErrorCode.OIDC_NOT_CONFIGURED,
        'OIDC is not configured'
      );
    }
    const codeVerifier = await oidcClient.randomPKCECodeVerifier();
    const codeChallenge = await oidcClient.calculatePKCECodeChallenge(
      codeVerifier
    );

    const state = interactionId;
    const parameters: Record<string, string> = {
      redirect_uri: this.configService.getOrThrow<string>('OIDC_FEDERATED_REDIRECT_URI'),
      scope: this.configService.getOrThrow<string>('OIDC_FEDERATED_SCOPE'),
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
    };

    await this.db.writer
      .insertInto('authOidcState')
      .values({
        state,
        codeVerifier: codeVerifier,
        redirectUri: this.configService.getOrThrow<string>('OIDC_FEDERATED_REDIRECT_URI'),
      })
      .execute();

    return oidcClient.buildAuthorizationUrl(this.issuer, parameters);
  }

  async callback(
    request: FastifyRequest<{ Querystring: { state: string | undefined } }>
  ): Promise<UserEntity> {
    if (!this.issuer) {
      throw new BadRequestException('OIDC is not configured');
    }

    const state = request.query?.state;
    if (!state) {
      throw new BadRequestException('State is required');
    }

    const serverState = await this.db.reader
      .selectFrom('authOidcState')
      .select('codeVerifier')
      .where('state', '=', state)
      .executeTakeFirst();

    const redirectUri =
      this.configService.getOrThrow<string>('OIDC_FEDERATED_REDIRECT_URI');
    const query = new URLSearchParams(request.query as Record<string, string>);

    const currentUrl = new URL(`${redirectUri}?${query.toString()}`);

    try {
      const tokens = await oidcClient.authorizationCodeGrant(
        this.issuer,
        currentUrl,
        {
          expectedState: state,
          pkceCodeVerifier: serverState?.codeVerifier,
        }
      );

      const claims = tokens.claims();

      await this.db.writer
        .deleteFrom('authOidcState')
        .where('state', '=', state)
        .execute();

      if (!claims) {
        throwServiceError(
          HttpStatus.BAD_REQUEST,
          ErrorCode.OIDC_RESPONSE_ERROR,
          'OIDC claims are not available'
        );
      }

      return await this.usersService.createOidcUser(claims);
    } catch (error) {
      if (error instanceof oidcClient.ResponseBodyError) {
        throwServiceError(
          HttpStatus.BAD_REQUEST,
          ErrorCode.OIDC_RESPONSE_ERROR,
          `OIDC response error: ${error.error}`
        );
      }
      throw error;
    }
  }
}
