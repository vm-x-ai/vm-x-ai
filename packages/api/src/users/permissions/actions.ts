export const USER_MODULE_NAME = 'user';

export enum UserActions {
  LIST = `${USER_MODULE_NAME}:list`,
  GET = `${USER_MODULE_NAME}:get`,
  CREATE = `${USER_MODULE_NAME}:create`,
  UPDATE = `${USER_MODULE_NAME}:update`,
  DELETE = `${USER_MODULE_NAME}:delete`,
}

export const USER_BASE_RESOURCE = 'user';
export const USER_RESOURCE_ITEM = `${USER_BASE_RESOURCE}:\${user.email}`;
