export const WORKSPACE_MODULE_NAME = 'workspace';

export enum WorkspaceActions {
  LIST = `${WORKSPACE_MODULE_NAME}:list`,
  GET = `${WORKSPACE_MODULE_NAME}:get`,
  CREATE = `${WORKSPACE_MODULE_NAME}:create`,
  UPDATE = `${WORKSPACE_MODULE_NAME}:update`,
  DELETE = `${WORKSPACE_MODULE_NAME}:delete`,
}

export const WORKSPACE_BASE_RESOURCE = 'workspace'
export const WORKSPACE_RESOURCE_ITEM = `${WORKSPACE_BASE_RESOURCE}:\${workspace.name}`
