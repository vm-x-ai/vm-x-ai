export const USER_MODULE_NAME = 'user';

export enum UserActions {
  LIST = `${USER_MODULE_NAME}:list`,
}

export const USER_BASE_RESOURCE = 'user'
export const USER_RESOURCE_ITEM = `${USER_BASE_RESOURCE}:\${user.email}`
