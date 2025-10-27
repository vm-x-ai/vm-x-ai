import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { OidcProviderService } from './auth/provider/oidc-provider.service';
import { ConfigService } from '@nestjs/config';

export function setupOpenAPIDocumentation(app: INestApplication) {
  const oidcProvider = app.get(OidcProviderService);
  const configService = app.get(ConfigService);

  const config = new DocumentBuilder()
    .setTitle('VM-X AI API')
    .setDescription('VM-X AI API')
    .setVersion('1.0')
    .addOAuth2(
      {
        type: 'openIdConnect',
        flows: {
          authorizationCode: {
            scopes: {
              openid: 'OpenID',
              profile: 'Profile',
              email: 'Email',
              offline_access: 'Offline Access',
            },
          },
        },
        openIdConnectUrl: `${oidcProvider.issuerUrl}/.well-known/openid-configuration`,
        name: 'OIDC',
        description: 'OIDC Authentication',
        in: 'header',
        bearerFormat: 'JWT',
      },
      'oidc'
    )
    .addSecurityRequirements({
      oidc: ['openid', 'profile', 'email', 'offline_access'],
    })
    .build();

  const documentFactory = () => {
    const document = SwaggerModule.createDocument(app, config);

    // Manually add OIDC provider endpoints
    document.paths['/oauth2/authorize'] = {
      get: {
        security: [],
        summary: 'OIDC Authorization Endpoint',
        description:
          'The authorization endpoint initiates the OAuth2/OpenID Connect flow',
        tags: ['OIDC Provider'],
        parameters: [
          {
            name: 'client_id',
            in: 'query',
            required: true,
            schema: { type: 'string' },
            description: 'The client ID',
          },
          {
            name: 'response_type',
            in: 'query',
            required: true,
            schema: { type: 'string' },
            description: 'The response type (usually "code")',
          },
          {
            name: 'redirect_uri',
            in: 'query',
            required: true,
            schema: { type: 'string' },
            description: 'The redirect URI',
          },
          {
            name: 'scope',
            in: 'query',
            required: false,
            schema: { type: 'string' },
            description: 'The requested scopes (e.g., "openid profile email")',
          },
          {
            name: 'state',
            in: 'query',
            required: false,
            schema: { type: 'string' },
            description:
              'Opaque state value to maintain state between the request and callback',
          },
          {
            name: 'code_challenge',
            in: 'query',
            required: false,
            schema: { type: 'string' },
            description: 'Code challenge for PKCE',
          },
          {
            name: 'code_challenge_method',
            in: 'query',
            required: false,
            schema: { type: 'string' },
            description: 'Code challenge method (usually "S256")',
          },
        ],
        responses: {
          '302': {
            description: 'Redirects to the authentication UI or callback',
          },
        },
      },
    };

    document.paths['/oauth2/token'] = {
      post: {
        security: [],
        summary: 'OIDC Token Endpoint',
        description: 'Exchanges authorization codes for access tokens',
        tags: ['OIDC Provider'],
        requestBody: {
          content: {
            'application/x-www-form-urlencoded': {
              schema: {
                type: 'object',
                properties: {
                  grant_type: {
                    type: 'string',
                    enum: [
                      'authorization_code',
                      'refresh_token',
                      'client_credentials',
                    ],
                    description: 'The grant type',
                  },
                  code: { type: 'string', description: 'Authorization code' },
                  redirect_uri: { type: 'string', description: 'Redirect URI' },
                  client_id: { type: 'string', description: 'Client ID' },
                  refresh_token: {
                    type: 'string',
                    description: 'Refresh token',
                  },
                  code_verifier: {
                    type: 'string',
                    description: 'PKCE code verifier',
                  },
                  client_secret: {
                    type: 'string',
                    description: 'Client secret (for machine-to-machine)',
                  },
                },
                required: ['grant_type'],
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Token response',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    access_token: { type: 'string' },
                    token_type: { type: 'string', example: 'Bearer' },
                    expires_in: { type: 'number' },
                    refresh_token: { type: 'string' },
                    id_token: { type: 'string' },
                    scope: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    };

    document.paths['/oauth2/userinfo'] = {
      get: {
        description: 'Returns claims about the authenticated end-user',
        tags: ['OIDC Provider'],
        responses: {
          '200': {
            description: 'User claims',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    sub: { type: 'string' },
                    email: { type: 'string' },
                    email_verified: { type: 'boolean' },
                    name: { type: 'string' },
                    username: { type: 'string' },
                    picture: { type: 'string' },
                    firstName: { type: 'string' },
                    lastName: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    };

    document.paths['/oauth2/revoke'] = {
      post: {
        security: [],
        summary: 'Token Revocation Endpoint',
        description: 'Revokes access or refresh tokens',
        tags: ['OIDC Provider'],
        requestBody: {
          content: {
            'application/x-www-form-urlencoded': {
              schema: {
                type: 'object',
                properties: {
                  token: { type: 'string', description: 'The token to revoke' },
                  token_type_hint: {
                    type: 'string',
                    enum: ['access_token', 'refresh_token'],
                    description: 'Hint about the token type',
                  },
                },
                required: ['token'],
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Token revoked successfully',
          },
        },
      },
    };

    document.paths['/oauth2/.well-known/openid-configuration'] = {
      get: {
        security: [],
        summary: 'OpenID Connect Discovery',
        description: 'Returns the OpenID Connect configuration document',
        tags: ['OIDC Provider'],
        responses: {
          '200': {
            description: 'OpenID Connect configuration',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  description: 'OpenID Connect Discovery document',
                },
              },
            },
          },
        },
      },
    };

    return document;
  };
  SwaggerModule.setup('docs', app, documentFactory, {
    swaggerOptions: {
      persistAuthorization: true,
      oauth2RedirectUrl: `${configService.getOrThrow<string>(
        'BASE_URL'
      )}/docs/oauth2-redirect.html`,
      initOAuth: {
        clientId: 'swagger',
        scopes: ['openid', 'profile', 'email', 'offline_access'],
        usePkceWithAuthorizationCodeGrant: true,
      },
    },
  });
}
