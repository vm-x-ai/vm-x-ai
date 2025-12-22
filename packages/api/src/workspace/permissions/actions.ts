export const WORKSPACE_MODULE_NAME = 'workspace';

export enum WorkspaceActions {
  LIST = `${WORKSPACE_MODULE_NAME}:list`,
  GET = `${WORKSPACE_MODULE_NAME}:get`,
  GET_MEMBERS = `${WORKSPACE_MODULE_NAME}:get-members`,
  CREATE = `${WORKSPACE_MODULE_NAME}:create`,
  UPDATE = `${WORKSPACE_MODULE_NAME}:update`,
  UPDATE_MEMBER_ROLE = `${WORKSPACE_MODULE_NAME}:update-member-role`,
  DELETE = `${WORKSPACE_MODULE_NAME}:delete`,
  ASSIGN = `${WORKSPACE_MODULE_NAME}:assign`,
  UNASSIGN = `${WORKSPACE_MODULE_NAME}:unassign`,
}

export const WORKSPACE_BASE_RESOURCE = 'workspace';
export const WORKSPACE_RESOURCE_ITEM = `${WORKSPACE_BASE_RESOURCE}:\${workspace.name}`;
