import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
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
import { Cache, CACHE_MANAGER } from '@nestjs/cache-manager';
import dedent from 'string-dedent';

@Injectable()
export class OidcProviderService implements OnModuleInit {
  public provider: Provider;
  public configuration: Configuration;

  constructor(
    private readonly logger: PinoLogger,
    private readonly db: DatabaseService,
    private readonly usersService: UsersService,
    private readonly configService: ConfigService,
    private readonly secretService: SecretService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache
  ) {}

  async onModuleInit() {
    this.configuration = await this.getOidcConfiguration();
    this.provider = new Provider(this.issuerUrl, this.configuration);

    this.provider.on('server_error', (ctx, error) => {
      this.logger.error(error, 'OIDC Provider Server Error:');
    });

    this.provider.on('authorization.error', (ctx, error) => {
      this.logger.error(error, 'OIDC Provider Authorization Error:');
    });

    this.provider.on('userinfo.error', (ctx, error) => {
      this.logger.error(error, 'OIDC Provider Userinfo Error:');
    });
  }

  get issuerUrl(): string {
    return `${this.configService.getOrThrow<string>('OIDC_PROVIDER_ISSUER')}`;
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

    const uiBaseUrl = this.configService.getOrThrow<string>('UI_BASE_URL');

    return {
      adapter: this.createAdapterFactory(),
      findAccount: async (ctx, id) => {
        const user = await this.usersService.getById(id);
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
          client_name: 'VM-X Console UI',
          client_secret: 'ui',
          response_types: ['code'],
          token_endpoint_auth_method: 'client_secret_basic',
          application_type: 'web',
          redirect_uris: [`${uiBaseUrl}/api/auth/callback/vm-x-ai`],
          grant_types: ['refresh_token', 'authorization_code'],
          scope: 'openid profile email offline_access',
          post_logout_redirect_uris: [uiBaseUrl],
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
        rpInitiatedLogout: {
          enabled: true,
          logoutSource: async (ctx, form) => {
            // `form` is a string of HTML for the default logout form
            ctx.type = 'html';
            ctx.body = dedent`
            <!DOCTYPE html>
            <html>
              <head>
                <meta charset="utf-8" />
                <title>Logout</title>
              </head>
              <body>
                ${form}
                <script>
                  // grab the auto-generated form
                  var form = document.forms[0];
            
                  // tell oidc-provider "yes, log me out"
                  var input = document.createElement('input');
                  input.type = 'hidden';
                  input.name = 'logout';
                  input.value = 'yes';
                  form.appendChild(input);
            
                  // auto-submit on load
                  form.submit();
                </script>
              </body>
            </html>
            `;
          },
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
    return (modelName: string) =>
      new KyselyAdapter(modelName, this.db, this.cache);
  }
}
