import {
  WORKSPACE_BASE_RESOURCE,
  WORKSPACE_MODULE_NAME,
  WORKSPACE_RESOURCE_ITEM,
  WorkspaceActions,
} from '../workspace/permissions/actions';
import {
  ENVIRONMENT_BASE_RESOURCE,
  ENVIRONMENT_MODULE_NAME,
  EnvironmentActions,
  ENVIRONMENT_RESOURCE_ITEM,
} from '../environment/permissions/actions';
import {
  AI_CONNECTION_BASE_RESOURCE,
  AI_CONNECTION_MODULE_NAME,
  AIConnectionActions,
  AI_CONNECTION_RESOURCE_ITEM,
} from '../ai-connection/permissions/actions';
import {
  POOL_DEFINITION_BASE_RESOURCE,
  POOL_DEFINITION_MODULE_NAME,
  PoolDefinitionActions,
  POOL_DEFINITION_RESOURCE_ITEM,
} from '../pool-definition/permissions/actions';
import {
  API_KEY_BASE_RESOURCE,
  API_KEY_MODULE_NAME,
  APIKeyActions,
  API_KEY_RESOURCE_ITEM,
} from '../api-key/permissions/actions';
import {
  COMPLETION_BASE_RESOURCE,
  COMPLETION_MODULE_NAME,
  COMPLETION_RESOURCE_ITEM,
} from '../completion/permissions/actions';
import {
  COMPLETION_BATCH_BASE_RESOURCE,
  COMPLETION_BATCH_MODULE_NAME,
  COMPLETION_BATCH_RESOURCE_ITEM,
} from '../completion/batch/permissions/actions';
import { CompletionBatchActions } from '../completion/batch/permissions/actions';
import { CompletionActions } from '../completion/permissions/actions';
import {
  AI_RESOURCE_MODULE_NAME,
  AIResourceActions,
  AI_RESOURCE_RESOURCE_ITEM,
  AI_RESOURCE_BASE_RESOURCE,
} from '../ai-resource/permissions/actions';
import {
  COMPLETION_METRICS_BASE_RESOURCE,
  COMPLETION_METRICS_MODULE_NAME,
  COMPLETION_METRICS_RESOURCE_ITEM,
  CompletionMetricsActions,
} from '../completion/metrics/permissions/actions';
import {
  COMPLETION_AUDIT_BASE_RESOURCE,
  COMPLETION_AUDIT_MODULE_NAME,
  COMPLETION_AUDIT_RESOURCE_ITEM,
  CompletionAuditActions,
} from '../completion/audit/permissions/actions';
import {
  USER_BASE_RESOURCE,
  USER_MODULE_NAME,
  UserActions,
  USER_RESOURCE_ITEM,
} from '../users/permissions/actions';
import {
  ROLE_BASE_RESOURCE,
  ROLE_MODULE_NAME,
  RoleActions,
  ROLE_RESOURCE_ITEM,
} from './permissions/actions';
import {
  COMPLETION_USAGE_BASE_RESOURCE,
  COMPLETION_USAGE_MODULE_NAME,
  COMPLETION_USAGE_RESOURCE_ITEM,
  CompletionUsageActions,
} from '../completion/usage/permissions/actions';
import { StringKeyOf } from 'ts-enum-util/dist/types/types';

function getEnumValues<T extends Record<StringKeyOf<T>, string>>(
  enumObj: T
): T[StringKeyOf<T>][] {
  return Object.values(enumObj).filter(
    (_, index) => index % 2 === 0
  ) as T[StringKeyOf<T>][];
}

export const modules = {
  [WORKSPACE_MODULE_NAME]: {
    actions: getEnumValues(WorkspaceActions),
    baseResource: WORKSPACE_BASE_RESOURCE,
    itemResource: WORKSPACE_RESOURCE_ITEM,
  },
  [ENVIRONMENT_MODULE_NAME]: {
    actions: getEnumValues(EnvironmentActions),
    baseResource: ENVIRONMENT_BASE_RESOURCE,
    itemResource: ENVIRONMENT_RESOURCE_ITEM,
  },
  [AI_CONNECTION_MODULE_NAME]: {
    actions: getEnumValues(AIConnectionActions),
    baseResource: AI_CONNECTION_BASE_RESOURCE,
    itemResource: AI_CONNECTION_RESOURCE_ITEM,
  },
  [AI_RESOURCE_MODULE_NAME]: {
    actions: getEnumValues(AIResourceActions),
    baseResource: AI_RESOURCE_BASE_RESOURCE,
    itemResource: AI_RESOURCE_RESOURCE_ITEM,
  },
  [POOL_DEFINITION_MODULE_NAME]: {
    actions: getEnumValues(PoolDefinitionActions),
    baseResource: POOL_DEFINITION_BASE_RESOURCE,
    itemResource: POOL_DEFINITION_RESOURCE_ITEM,
  },
  [API_KEY_MODULE_NAME]: {
    actions: getEnumValues(APIKeyActions),
    baseResource: API_KEY_BASE_RESOURCE,
    itemResource: API_KEY_RESOURCE_ITEM,
  },
  [COMPLETION_MODULE_NAME]: {
    actions: getEnumValues(CompletionActions),
    baseResource: COMPLETION_BASE_RESOURCE,
    itemResource: COMPLETION_RESOURCE_ITEM,
  },
  [COMPLETION_BATCH_MODULE_NAME]: {
    actions: getEnumValues(CompletionBatchActions),
    baseResource: COMPLETION_BATCH_BASE_RESOURCE,
    itemResource: COMPLETION_BATCH_RESOURCE_ITEM,
  },
  [COMPLETION_METRICS_MODULE_NAME]: {
    actions: getEnumValues(CompletionMetricsActions),
    baseResource: COMPLETION_METRICS_BASE_RESOURCE,
    itemResource: COMPLETION_METRICS_RESOURCE_ITEM,
  },
  [COMPLETION_AUDIT_MODULE_NAME]: {
    actions: getEnumValues(CompletionAuditActions),
    baseResource: COMPLETION_AUDIT_BASE_RESOURCE,
    itemResource: COMPLETION_AUDIT_RESOURCE_ITEM,
  },
  [COMPLETION_USAGE_MODULE_NAME]: {
    actions: getEnumValues(CompletionUsageActions),
    baseResource: COMPLETION_USAGE_BASE_RESOURCE,
    itemResource: COMPLETION_USAGE_RESOURCE_ITEM,
  },

  [USER_MODULE_NAME]: {
    actions: getEnumValues(UserActions),
    baseResource: USER_BASE_RESOURCE,
    itemResource: USER_RESOURCE_ITEM,
  },
  [ROLE_MODULE_NAME]: {
    actions: getEnumValues(RoleActions),
    baseResource: ROLE_BASE_RESOURCE,
    itemResource: ROLE_RESOURCE_ITEM,
  },
} as const;

export type ModulePermissions = typeof modules;
