export const AI_CONNECTION_MODULE_NAME = 'ai-connection';

export enum AIConnectionActions {
  LIST = `${AI_CONNECTION_MODULE_NAME}:list`,
  GET = `${AI_CONNECTION_MODULE_NAME}:get`,
  CREATE = `${AI_CONNECTION_MODULE_NAME}:create`,
  UPDATE = `${AI_CONNECTION_MODULE_NAME}:update`,
  DELETE = `${AI_CONNECTION_MODULE_NAME}:delete`,
}

export const AI_CONNECTION_BASE_RESOURCE = 'workspace:${workspace.name}:environment:${environment.name}:ai-connection';
export const AI_CONNECTION_RESOURCE_ITEM = `${AI_CONNECTION_BASE_RESOURCE}:\${connection.name}`;
