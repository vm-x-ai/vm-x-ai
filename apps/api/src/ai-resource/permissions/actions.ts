export const AI_RESOURCE_MODULE_NAME = 'ai-resource';

export enum AIResourceActions {
  LIST = `${AI_RESOURCE_MODULE_NAME}:list`,
  GET = `${AI_RESOURCE_MODULE_NAME}:get`,
  CREATE = `${AI_RESOURCE_MODULE_NAME}:create`,
  UPDATE = `${AI_RESOURCE_MODULE_NAME}:update`,
  DELETE = `${AI_RESOURCE_MODULE_NAME}:delete`,
}

export const AI_RESOURCE_BASE_RESOURCE = 'workspace:${workspace.name}:environment:${environment.name}:ai-resource';
export const AI_RESOURCE_RESOURCE_ITEM = `${AI_RESOURCE_BASE_RESOURCE}:\${resource.name}`;
