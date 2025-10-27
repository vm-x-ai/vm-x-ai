import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../storage/database.service';
import { KyselyAdapter } from './oidc.adapter';
import { ConfigService } from '@nestjs/config';
import { AdapterFactory, Configuration } from 'oidc-provider';
import { Provider } from 'oidc-provider';
import { UsersService } from '../../users/users.service';

@Injectable()
export class OidcProviderService {
  public readonly provider: Provider;

  constructor(
    private readonly db: DatabaseService,
    private readonly usersService: UsersService,
    private readonly configService: ConfigService
  ) {
    this.provider = new Provider(
      this.configService.getOrThrow<string>('OIDC_PROVIDER_ISSUER'),
      this.getOidcConfiguration()
    );

    this.provider.on('server_error', (ctx, error) => {
      console.error('OIDC Provider Server Error:', error);
    });

    this.provider.on('authorization.error', (ctx, error) => {
      console.error('OIDC Provider Authorization Error:', error);
    });
  }

  private getOidcConfiguration(): Configuration {
    const jwksBase64 =
      this.configService.getOrThrow<string>('OIDC_PROVIDER_JWKS');
    const jwks = JSON.parse(
      Buffer.from(jwksBase64, 'base64').toString('utf-8')
    );
    const cookieKeysBase64 = this.configService.getOrThrow<string>(
      'OIDC_PROVIDER_COOKIE_KEYS'
    );
    const cookiesKeys = JSON.parse(
      Buffer.from(cookieKeysBase64, 'base64').toString('utf-8')
    );

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
          redirect_uris: ['http://localhost:3000/callback', 'https://oauth.pstmn.io/v1/callback'],
          grant_types: ['refresh_token', 'authorization_code'],
          scope: 'openid profile email offline_access',
        },
        {
          client_id: 'postman',
          client_name: 'postman',
          response_types: ['code'],
          token_endpoint_auth_method: 'none',
          application_type: 'web',
          redirect_uris: ['https://oauth.pstmn.io/v1/callback'],
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
          defaultResource: () => 'https://vm-x.ai',
          getResourceServerInfo: () => ({
            scope: 'openid profile email offline_access',
            audience: 'https://vm-x.ai',
            accessTokenFormat: 'jwt',
            jwt: {
              sign: {
                alg: 'RS256',
              },
            },
          }),
          useGrantedResource: () => true,
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
