import { Injectable, OnModuleInit } from '@nestjs/common';
import { DatabaseService } from '../../storage/database.service';
import { KyselyAdapter } from './oidc.adapter';
import { ConfigService } from '@nestjs/config';
import { AdapterFactory, Configuration, JWKS } from 'oidc-provider';
import { Provider } from 'oidc-provider';
import { UsersService } from '../../users/users.service';
import {
  OIDC_PROVIDER_COOKIE_KEYS_SECRET_KEY,
  OIDC_PROVIDER_JWKS_SECRET_KEY,
  RESOURCE_INDICATOR,
} from './consts';
import { SecretService } from '../../vault/secrets.service';
import { PinoLogger } from 'nestjs-pino';
import { generateCookieKeys, generateJWKS } from '../../gen-jwks';

@Injectable()
export class OidcProviderService implements OnModuleInit {
  public provider: Provider;
  public configuration: Configuration;

  constructor(
    private readonly logger: PinoLogger,
    private readonly db: DatabaseService,
    private readonly usersService: UsersService,
    private readonly configService: ConfigService,
    private readonly secretService: SecretService
  ) {}

  async onModuleInit() {
    this.configuration = await this.getOidcConfiguration();
    this.provider = new Provider(this.issuerUrl, this.configuration);

    this.provider.on('server_error', (ctx, error) => {
      this.logger.error('OIDC Provider Server Error:', error);
    });

    this.provider.on('authorization.error', (ctx, error) => {
      this.logger.error('OIDC Provider Authorization Error:', error);
    });

    this.provider.on('userinfo.error', (ctx, error) => {
      this.logger.error('OIDC Provider Userinfo Error:', error);
    });
  }

  get issuerUrl(): string {
    return `${this.configService.getOrThrow<string>('BASE_URL')}/oauth2`;
  }

  private async getOidcConfiguration(): Promise<Configuration> {
    const jwks = await this.secretService.upsertSecret<JWKS>(
      OIDC_PROVIDER_JWKS_SECRET_KEY,
      async () => await generateJWKS()
    );

    const { keys: cookiesKeys } = await this.secretService.upsertSecret<{
      keys: string[];
    }>(OIDC_PROVIDER_COOKIE_KEYS_SECRET_KEY, async () => ({
      keys: generateCookieKeys(),
    }));

    return {
      adapter: this.createAdapterFactory(),
      findAccount: async (ctx, id) => {
        const user = await this.usersService.get(id);
        if (!user) return undefined;

        return {
          accountId: user.id,
          claims() {
            return {
              sub: user.id,
              email: user.email,
              name: user.name,
              username: user.username,
              picture: user.pictureUrl,
              firstName: user.firstName,
              lastName: user.lastName,
            };
          },
        };
      },
      conformIdTokenClaims: false,
      ttl: {
        AccessToken: 1 * 60 * 60, // 1 hour
        IdToken: 1 * 60 * 60, // 1 hour
        RefreshToken: 30 * 24 * 60 * 60, // 30 day
        AuthorizationCode: 1 * 60 * 60, // 1 hour
        ClientCredentials: 1 * 60 * 60, // 1 hour
      },
      clients: [
        {
          client_id: 'ui',
          client_name: 'ui',
          response_types: ['code'],
          token_endpoint_auth_method: 'none',
          application_type: 'web',
          // TODO: Replace with the actual redirect URI
          redirect_uris: ['http://localhost:3000/callback'],
          grant_types: ['refresh_token', 'authorization_code'],
          scope: 'openid profile email offline_access',
        },
        {
          client_id: 'swagger',
          client_name: 'Swagger UI',
          response_types: ['code'],
          token_endpoint_auth_method: 'none',
          application_type: 'web',
          redirect_uris: [
            'https://oauth.pstmn.io/v1/callback',
            `${this.configService.getOrThrow<string>(
              'BASE_URL'
            )}/docs/oauth2-redirect.html`,
          ],
          grant_types: ['refresh_token', 'authorization_code'],
          scope: 'openid profile email offline_access',
        },
        {
          client_id: 'm2m',
          client_name: 'Machine to Machine',
          client_secret: 'm2m-secret',
          grant_types: ['client_credentials'],
          response_types: [],
          token_endpoint_auth_method: 'client_secret_post',
          redirect_uris: [],
          scope: 'openid profile email',
        },
      ],
      routes: {
        authorization: '/authorize',
        token: '/token',
        revocation: '/revoke',
        userinfo: '/userinfo',
      },
      pkce: {
        required: () => false,
      },
      scopes: ['openid', 'profile', 'email', 'offline_access'],
      claims: {
        openid: ['sub'],
        profile: ['name', 'username', 'firstName', 'lastName', 'picture'],
        email: ['email', 'email_verified'],
      },
      features: {
        clientCredentials: { enabled: true },
        introspection: { enabled: true },
        deviceFlow: { enabled: true },
        revocation: { enabled: true },
        devInteractions: {
          enabled: false,
        },
        resourceIndicators: {
          enabled: true,
          defaultResource: () => RESOURCE_INDICATOR,
          getResourceServerInfo: () => ({
            scope: 'openid profile email offline_access',
            audience: RESOURCE_INDICATOR,
            jwt: {
              sign: {
                alg: 'RS256',
              },
            },
          }),
        },
      },
      interactions: {
        url(_, interaction) {
          return `/interaction/${interaction.uid}`;
        },
      },
      cookies: {
        keys: cookiesKeys,
      },
      jwks,
    };
  }

  private createAdapterFactory(): AdapterFactory {
    return (modelName: string) => new KyselyAdapter(modelName, this.db);
  }
}
