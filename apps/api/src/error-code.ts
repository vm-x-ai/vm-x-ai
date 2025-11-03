export enum ErrorCode {
  INTERNAL_SERVER_ERROR = 'INTERNAL_SERVER_ERROR',
  // OIDC errors
  OIDC_NOT_CONFIGURED = 'OIDC_NOT_CONFIGURED',
  OIDC_RESPONSE_ERROR = 'OIDC_RESPONSE_ERROR',
  OIDC_CLAIMS_NOT_AVAILABLE = 'OIDC_CLAIMS_NOT_AVAILABLE',
  OIDC_EMAIL_NOT_AVAILABLE = 'OIDC_EMAIL_NOT_AVAILABLE',
  OIDC_EMAIL_MISMATCH = 'OIDC_EMAIL_MISMATCH',
  OIDC_PROVIDER_ID_MISMATCH = 'OIDC_PROVIDER_ID_MISMATCH',

  // Workspace errors
  WORKSPACE_NOT_MEMBER = 'WORKSPACE_NOT_MEMBER',
  WORKSPACE_NOT_FOUND = 'WORKSPACE_NOT_FOUND',
  WORKSPACE_ACTION_NOT_ALLOWED = 'WORKSPACE_ACTION_NOT_ALLOWED',
  WORKSPACE_INSUFFICIENT_PERMISSIONS = 'WORKSPACE_INSUFFICIENT_PERMISSIONS',

  // Environment errors
  ENVIRONMENT_NOT_MEMBER = 'ENVIRONMENT_NOT_MEMBER',
  ENVIRONMENT_NOT_FOUND = 'ENVIRONMENT_NOT_FOUND',

  // AI Connection errors
  AI_CONNECTION_NOT_FOUND = 'AI_CONNECTION_NOT_FOUND',
  AI_CONNECTION_CONFIG_INVALID = 'AI_CONNECTION_CONFIG_INVALID',

  // AI Resource errors
  AI_RESOURCE_NOT_FOUND = 'AI_RESOURCE_NOT_FOUND',
  AI_RESOURCE_ALREADY_EXISTS = 'AI_RESOURCE_ALREADY_EXISTS',

  // Pool Definition errors
  POOL_DEFINITION_NOT_FOUND = 'POOL_DEFINITION_NOT_FOUND',

  // AI Provider
  AI_PROVIDER_NOT_FOUND = 'AI_PROVIDER_NOT_FOUND',
}

export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  [ErrorCode.INTERNAL_SERVER_ERROR]: 'Internal Server Error',

  // OIDC errors
  [ErrorCode.OIDC_NOT_CONFIGURED]: 'OIDC is not configured',
  [ErrorCode.OIDC_RESPONSE_ERROR]: 'OIDC response error: ${error}',
  [ErrorCode.OIDC_CLAIMS_NOT_AVAILABLE]: 'OIDC claims are not available',
  [ErrorCode.OIDC_EMAIL_NOT_AVAILABLE]: 'Email not available in the ID token',
  [ErrorCode.OIDC_EMAIL_MISMATCH]:
    'Email mismatch between the ID token and the user',
  [ErrorCode.OIDC_PROVIDER_ID_MISMATCH]:
    'Provider ID mismatch between the ID token and the user',

  // Workspace errors
  [ErrorCode.WORKSPACE_NOT_MEMBER]: 'User is not a member of the workspace',
  [ErrorCode.WORKSPACE_NOT_FOUND]: 'Workspace ${workspaceId} not found',
  [ErrorCode.WORKSPACE_ACTION_NOT_ALLOWED]: 'You are not allowed to perform ${action} on workspace ${workspaceId}',
  [ErrorCode.WORKSPACE_INSUFFICIENT_PERMISSIONS]: 'You are a ${role} of workspace ${workspaceId} and this action requires ${requiredRole}',

  // Environment errors
  [ErrorCode.ENVIRONMENT_NOT_MEMBER]: 'User is not a member of the environment',
  [ErrorCode.ENVIRONMENT_NOT_FOUND]: 'Environment ${environmentId} not found',

  // AI Connection errors
  [ErrorCode.AI_CONNECTION_NOT_FOUND]: 'AI Connection ${connectionId} not found',
  [ErrorCode.AI_CONNECTION_CONFIG_INVALID]: 'AI Connection config is invalid: ${error}',

  // AI Resource errors
  [ErrorCode.AI_RESOURCE_NOT_FOUND]: 'AI Resource ${resource} not found',
  [ErrorCode.AI_RESOURCE_ALREADY_EXISTS]: 'AI Resource ${resource} already exists',

  // Pool Definition errors
  [ErrorCode.POOL_DEFINITION_NOT_FOUND]: 'Pool Definition for workspace ${workspaceId} and environment ${environmentId} not found',

  // AI Provider errors
  [ErrorCode.AI_PROVIDER_NOT_FOUND]: 'AI Provider ${id} not found',

};
