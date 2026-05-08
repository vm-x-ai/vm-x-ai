import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { apiReference } from '@scalar/nestjs-api-reference';
import { ConfigService } from '@nestjs/config';

export function setupOpenAPIDocumentation(app: INestApplication) {
  const configService = app.get(ConfigService);
  const baseUrl = configService.getOrThrow<string>('BASE_URL');
  const basePath = configService.getOrThrow<string>('BASE_PATH');

  const oauthScopes = {
    openid: 'OpenID',
    profile: 'Profile',
    email: 'Email',
    offline_access: 'Offline Access',
  };
  const authorizationUrl = `${baseUrl}${basePath}/oauth2/authorize`;
  const tokenUrl = `${baseUrl}${basePath}/oauth2/token`;
  const refreshUrl = tokenUrl;
  const oauthRedirectUri = `${baseUrl}${basePath}/docs/oauth2-redirect.html`;

  const apiDescription = [
    'VM-X AI is a routing and management layer for AI workloads. The API',
    'exposes three completion endpoints (Chat Completions, Anthropic',
    'Messages, Responses) that front seven providers — OpenAI, Anthropic,',
    'Google Gemini, Groq, Perplexity, AWS Bedrock (Converse), and AWS',
    'Bedrock-Invoke. Pick whichever endpoint matches your client SDK; the',
    "gateway converts request and response shapes when the upstream doesn't",
    "match natively, with passthrough on the provider's native shape.",
    '',
    '### Authentication',
    '',
    'All endpoints under `/v1/**` are protected by OIDC. Click **Authorize**',
    'in the top right to walk through the authorization-code + PKCE flow.',
    'The Scalar test panel will inject the resulting bearer token into',
    '`Authorization: Bearer …` for every request.',
    '',
    'Completion endpoints accept either an OIDC bearer token or an API key',
    'scoped to a workspace + environment (`Authorization: Bearer vmx_…`).',
    '',
    '### Selected features',
    '',
    '- `vmx.providerArgs` — caller-side escape hatch to pass provider-only',
    '  fields (e.g. Anthropic `cache_control`, Groq `service_tier`) without',
    '  giving up routing/fallback.',
    '- `vmx.secondaryModelIndex` — multi-answer fan-out across ranked',
    '  secondary models on a single request.',
    '- Per-model `maxRetries` and `timeoutMs` on AI Resources for fine',
    '  control over the chattier fallback paths.',
    '- Comprehensive request audit + time-series usage metrics, exportable',
    '  through OpenTelemetry to any compatible backend.',
    '',
    'See the public docs at https://vm-x-ai.github.io/ for endpoint',
    'examples, provider deep-dives, and deployment guides.',
  ].join('\n');

  const config = new DocumentBuilder()
    .setTitle('VM-X AI API')
    .setDescription(apiDescription)
    .setVersion('1.0')
    .addOAuth2(
      {
        type: 'oauth2',
        description: 'OIDC Authentication',
        flows: {
          authorizationCode: {
            authorizationUrl,
            tokenUrl,
            refreshUrl,
            scopes: oauthScopes,
          },
        },
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
    document.paths[`${basePath}/oauth2/authorize`] = {
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

    document.paths[`${basePath}/oauth2/token`] = {
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

    document.paths[`${basePath}/oauth2/userinfo`] = {
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

    document.paths[`${basePath}/oauth2/revoke`] = {
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

    document.paths[`${basePath}/oauth2/.well-known/openid-configuration`] = {
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

  // Build the OpenAPI document once and serve:
  //   - JSON spec at <basePath>/docs-json (consumed by SDK generation tooling
  //     and by the Scalar UI mounted below)
  //   - Scalar API reference UI at <basePath>/docs (replaces Swagger UI)
  const document = documentFactory();
  const httpAdapter = app.getHttpAdapter();
  httpAdapter.get(`${basePath}/docs-json`, (_req, res) => {
    res.header('Content-Type', 'application/json').send(document);
  });

  app.use(
    `${basePath}/docs`,
    apiReference({
      // The app uses Fastify; without this flag Scalar tries to call
      // Express-style `res.send()` which Fastify's adapter doesn't expose
      // at the middleware layer, surfacing as "res.send is not a function".
      withFastify: true,
      content: document,
      metaData: {
        title: 'VM-X AI API',
      },
      authentication: {
        preferredSecurityScheme: 'oidc',
        securitySchemes: {
          oidc: {
            type: 'oauth2',
            flows: {
              authorizationCode: {
                'x-scalar-client-id': 'swagger',
                'x-scalar-redirect-uri': oauthRedirectUri,
                'x-usePkce': 'SHA-256',
                // Force the OIDC provider to surface the login + consent
                // screens so the API-explorer flow is always interactive.
                // Without `prompt=login` an existing session would silently
                // mint a token; without `prompt=consent` the consent step
                // is skipped on subsequent requests.
                'x-scalar-security-query': {
                  prompt: 'login consent',
                },
                selectedScopes: [
                  'openid',
                  'profile',
                  'email',
                  'offline_access',
                ],
              },
            },
          },
        },
      },
      servers: [
        // Document paths already include the global prefix (e.g. /api/v1/...),
        // so the server URL must NOT repeat it — otherwise Scalar resolves to
        // /api/api/v1/... See packages/api/src/main.ts setGlobalPrefix.
        { url: baseUrl },
      ],
    })
  );
}
