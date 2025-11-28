import { type Config } from 'kysely-codegen';

export default {
  outFile: 'src/storage/entities.generated.ts',
  camelCase: true,
  runtimeEnums: true,
  defaultSchemas: ['vmxai'],
  singularize: true,
  includePattern: 'vmxai.*',
  customImports: {
    CapacityEntity: '../common/capacity.entity#CapacityEntity',
  },
  typeOnlyImports: true,
  overrides: {
    columns: {
      // AI Connections
      'ai_connections.allowed_models': 'ColumnType<string[] | null, string | null, string | null>',
      // add real types once this issue: https://github.com/RobinBlomberg/kysely-codegen/issues/287 is fixed and released.
      'ai_connections.capacity': 'ColumnType<any[] | null, string | null, string | null>',
      'ai_connections.discovered_capacity': 'ColumnType<any | null, string | null, string | null>',
      'ai_connections.config': 'ColumnType<any | null, string | null, string | null>',

      // AI Resources
      'ai_resources.model': 'ColumnType<any, string, string | null>',
      'ai_resources.routing': 'ColumnType<any | null, string | null, string | null>',
      'ai_resources.secondary_models': 'ColumnType<any[] | null, string | null, string | null>',
      'ai_resources.fallback_models': 'ColumnType<any[] | null, string | null, string | null>',
      'ai_resources.capacity': 'ColumnType<any[] | null, string | null, string | null>',

      // Pool Definitions
      'pool_definitions.definition': 'ColumnType<any[], string, string | null>',

      // API Keys
      'api_keys.resources': 'ColumnType<any[], string, string | null>',
      'api_keys.labels': 'ColumnType<any[] | null, string | null, string | null>',
      'api_keys.capacity': 'ColumnType<any[] | null, string | null, string | null>',

      // Completion Audit
      'completion_audit.events': 'ColumnType<any[] | null, string | null, string | null>',
      'completion_audit.request_payload': 'ColumnType<any | null, string | null, string | null>',
      'completion_audit.response_data': 'ColumnType<any | null, string | null, string | null>',
      'completion_audit.response_headers': 'ColumnType<any | null, string | null, string | null>',

      // Completion Batch
      'completion_batch.callback_options': 'ColumnType<any | null, string | null, string | null>',
      'completion_batch.capacity': 'ColumnType<any[] | null, string | null, string | null>',

      // Completion Batch Items
      'completion_batch_items.request': 'ColumnType<any | null, string | null, string | null>',
      'completion_batch_items.response': 'ColumnType<any | null, string | null, string | null>',

      // Roles
      'roles.policy': 'ColumnType<any | null, string | null, string | null>',
    },
  },
} satisfies Config;
