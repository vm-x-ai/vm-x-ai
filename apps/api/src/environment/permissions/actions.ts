export const ENVIRONMENT_MODULE_NAME = 'environment';

export enum EnvironmentActions {
  LIST = `${ENVIRONMENT_MODULE_NAME}:list`,
  GET = `${ENVIRONMENT_MODULE_NAME}:get`,
  CREATE = `${ENVIRONMENT_MODULE_NAME}:create`,
  UPDATE = `${ENVIRONMENT_MODULE_NAME}:update`,
  DELETE = `${ENVIRONMENT_MODULE_NAME}:delete`,
}

export const ENVIRONMENT_BASE_RESOURCE = 'workspace:${workspace.name}:environment';
export const ENVIRONMENT_RESOURCE_ITEM = `${ENVIRONMENT_BASE_RESOURCE}:\${environment.name}`;
