export const ROLE_MODULE_NAME = 'role';

export enum RoleActions {
  LIST = `${ROLE_MODULE_NAME}:list`,
  GET = `${ROLE_MODULE_NAME}:get`,
  GET_MEMBERS = `${ROLE_MODULE_NAME}:get-members`,
  CREATE = `${ROLE_MODULE_NAME}:create`,
  UPDATE = `${ROLE_MODULE_NAME}:update`,
  DELETE = `${ROLE_MODULE_NAME}:delete`,
  ASSIGN = `${ROLE_MODULE_NAME}:assign`,
  UNASSIGN = `${ROLE_MODULE_NAME}:unassign`,
}

export const ROLE_BASE_RESOURCE = 'role';
export const ROLE_RESOURCE_ITEM = `${ROLE_BASE_RESOURCE}:\${role.name}`;
