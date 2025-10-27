import Joi from 'joi';
import { SERVICE_NAME } from '../consts';

export const configSchema = Joi.object({
  LOG_LEVEL: Joi.string()
    .valid('fatal', 'error', 'warn', 'info', 'debug', 'trace')
    .default('trace'),
  PORT: Joi.number().port().default(3000),
  NODE_ENV: Joi.string()
    .valid('production', 'development', 'local', 'test')
    .default('local'),
  VERSION: Joi.string().default('0.0.0'),
  // Database
  DATABASE_URL: Joi.string().uri().required(),
  DATABASE_RO_URL: Joi.string().uri().required(),
  DATABASE_MIGRATION_URL: Joi.string().uri().required(),
  DATABASE_WRITER_USER: Joi.string().default(SERVICE_NAME.toLowerCase()),
  DATABASE_WRITER_POOL_MAX: Joi.number().default(25),
  DATABASE_READER_POOL_MAX: Joi.number().default(50),

  // Redis
  REDIS_HOST: Joi.string().required(),
  REDIS_PORT: Joi.number().port().required(),

  // JWT
  JWT_SECRET: Joi.string().required(),

  // OIDC Provider
  OIDC_PROVIDER_ISSUER: Joi.string().uri(),
  OIDC_PROVIDER_JWKS: Joi.string().base64().required(),
  OIDC_PROVIDER_COOKIE_KEYS: Joi.string().base64().required(),
  OIDC_PROVIDER_AUTO_CONSENT_CLIENT_IDS: Joi.string().default('ui'),

  // OIDC
  OIDC_FEDERATED_ISSUER: Joi.string().uri(),
  OIDC_FEDERATED_CLIENT_ID: Joi.string().when('OIDC_FEDERATED_ISSUER', {
    is: Joi.exist(),
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  OIDC_FEDERATED_CLIENT_SECRET: Joi.string().optional(),
  OIDC_FEDERATED_REDIRECT_URI: Joi.string().uri().when('OIDC_FEDERATED_ISSUER', {
    is: Joi.exist(),
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  OIDC_FEDERATED_SCOPE: Joi.string().default('openid profile email'),
});
