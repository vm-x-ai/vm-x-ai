export const ROLE_MODULE_NAME = 'role';

export enum RoleActions {
  LIST = `${ROLE_MODULE_NAME}:list`,
  GET = `${ROLE_MODULE_NAME}:get`,
  CREATE = `${ROLE_MODULE_NAME}:create`,
  UPDATE = `${ROLE_MODULE_NAME}:update`,
  DELETE = `${ROLE_MODULE_NAME}:delete`,
  ASSIGN = `${ROLE_MODULE_NAME}:assign`,
}

export const ROLE_BASE_RESOURCE = 'role'
export const ROLE_RESOURCE_ITEM = `${ROLE_BASE_RESOURCE}:\${role.name}`
