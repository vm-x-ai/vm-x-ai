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

  // API
  BASE_URL: Joi.string().uri().required(),
  BASE_PATH: Joi.string().default(''),

  // Database
  DATABASE_HOST: Joi.string().hostname().required(),
  DATABASE_RO_HOST: Joi.string().hostname().required(),
  DATABASE_PORT: Joi.number().port().required(),
  DATABASE_USER: Joi.string().required(),
  DATABASE_PASSWORD: Joi.string().required(),
  DATABASE_DB_NAME: Joi.string().required(),
  DATABASE_SCHEMA: Joi.string().default(SERVICE_NAME.toLowerCase()),
  DATABASE_SSL: Joi.boolean().default(false),

  DATABASE_WRITER_USER: Joi.string().default(SERVICE_NAME.toLowerCase()),
  DATABASE_WRITER_POOL_MAX: Joi.number().default(25),
  DATABASE_READER_POOL_MAX: Joi.number().default(50),

  // Redis
  REDIS_HOST: Joi.string().required(),
  REDIS_PORT: Joi.number().port().required(),
  REDIS_MODE: Joi.string().valid('single', 'cluster').default('single'),
  REDIS_TLS: Joi.boolean().default(false),

  // OIDC Provider
  OIDC_PROVIDER_ISSUER: Joi.string()
    .uri()
    .default((parent) => `${parent.BASE_URL}${parent.BASE_PATH}/oauth2`),
  OIDC_PROVIDER_AUTO_CONSENT_CLIENT_IDS: Joi.string().default('ui'),

  // OIDC Federated Login
  OIDC_FEDERATED_ISSUER: Joi.string().uri(),
  OIDC_FEDERATED_CLIENT_ID: Joi.string().when('OIDC_FEDERATED_ISSUER', {
    is: Joi.exist(),
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  OIDC_FEDERATED_CLIENT_SECRET: Joi.string().optional(),
  OIDC_FEDERATED_SCOPE: Joi.string().default('openid profile email'),
  OIDC_FEDERATED_DEFAULT_ROLE: Joi.string().default('power-user'),

  // Vault
  ENCRYPTION_PROVIDER: Joi.string()
    .valid('libsodium', 'aws-kms')
    .default('libsodium'),

  // Libsodium (default)
  LIBSODIUM_ENCRYPTION_KEY: Joi.string().when('ENCRYPTION_PROVIDER', {
    is: 'libsodium',
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),

  // AWS KMS
  AWS_KMS_KEY_ID: Joi.string().when('ENCRYPTION_PROVIDER', {
    is: 'aws-kms',
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),

  // AWS Region (required for AWS services)
  AWS_REGION: Joi.string().when('ENCRYPTION_PROVIDER', {
    is: 'aws-kms',
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),

  // Batch Queue
  BATCH_QUEUE_VISIBILITY_TIMEOUT: Joi.number().default(1000 * 120), // 2 minutes

  // Model Pricing Sync
  PRICING_SYNC_ENABLED: Joi.boolean().default(true),
  PRICING_SYNC_URL: Joi.string()
    .uri()
    .default(
      'https://raw.githubusercontent.com/vm-x-ai/vm-x-ai/main/model-pricing.json'
    ),
  PRICING_SYNC_CRON: Joi.string().default('0 3 * * *'),

  // UI
  UI_BASE_URL: Joi.string().uri().required(),
});
