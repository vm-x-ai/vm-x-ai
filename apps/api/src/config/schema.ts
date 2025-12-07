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

  // Database
  DATABASE_URL: Joi.string().uri().required(),
  DATABASE_RO_URL: Joi.string().uri().required(),
  DATABASE_MIGRATION_URL: Joi.string().uri().required(),
  DATABASE_WRITER_USER: Joi.string().default(SERVICE_NAME.toLowerCase()),
  DATABASE_WRITER_POOL_MAX: Joi.number().default(25),
  DATABASE_READER_POOL_MAX: Joi.number().default(50),
  DATABASE_SCHEMA: Joi.string().default(SERVICE_NAME.toLowerCase()),

  // Redis
  REDIS_HOST: Joi.string().required(),
  REDIS_PORT: Joi.number().port().required(),

  // OIDC Provider
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
  VAULT_ENCRYPTION_SERVICE: Joi.string()
    .valid('hashcorp', 'aws-kms')
    .default('hashcorp'),

  // Hashcorp Vault
  VAULT_HASHCORP_ADDR: Joi.string().uri().when('VAULT_ENCRYPTION_SERVICE', {
    is: 'hashcorp',
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  VAULT_HASHCORP_APPROLE_ROLE_ID: Joi.string().when('VAULT_ENCRYPTION_SERVICE', {
    is: 'hashcorp',
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  VAULT_HASHCORP_APPROLE_SECRET_ID: Joi.string().when('VAULT_ENCRYPTION_SERVICE', {
    is: 'hashcorp',
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),

  // AWS KMS
  VAULT_AWS_KMS_KEY_ID: Joi.string().when('VAULT_ENCRYPTION_SERVICE', {
    is: 'aws-kms',
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),

  // TimeseriesDB
  QUESTDB_URL: Joi.string().uri().required(),
  QUESTDB_MIGRATION_URL: Joi.string().uri().required(),

  // Batch Queue
  BATCH_QUEUE_VISIBILITY_TIMEOUT: Joi.number().default(1000 * 120), // 2 minutes

  // UI
  UI_BASE_URL: Joi.string().uri().required(),
});
