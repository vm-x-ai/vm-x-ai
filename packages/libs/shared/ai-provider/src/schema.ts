import { Ajv } from 'ajv';
import ajvErrors from 'ajv-errors';

export const aiProviderConfigSchemaValidator = new Ajv({
  allErrors: true,
});

aiProviderConfigSchemaValidator.addKeyword({
  keyword: 'placeholder',
  type: 'string',
  schemaType: 'string',
  code: () => {
    // no-op
  },
});

aiProviderConfigSchemaValidator.addKeyword({
  keyword: 'order',
  type: 'number',
  schemaType: 'number',
  code: () => {
    // no-op
  },
});

ajvErrors.default(aiProviderConfigSchemaValidator);

aiProviderConfigSchemaValidator.addFormat('aws-region', {
  type: 'string',
  validate: /^[a-z]{2}-[a-z]+-[0-9]$/,
});
aiProviderConfigSchemaValidator.addFormat('aws-arn', {
  type: 'string',
  validate:
    /^(arn:(?:aws|aws-cn|aws-us-gov):[\w\d-]+:[\w\d-]*:\d{0,12}:[\w\d-]*\/?[\w\d-]*)(\/.*)?.*$/,
});
aiProviderConfigSchemaValidator.addFormat('secret', {
  type: 'string',
  validate: /(.*)/,
});
