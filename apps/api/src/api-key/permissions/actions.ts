export const API_KEY_MODULE_NAME = 'api-key';

export enum APIKeyActions {
  LIST = `${API_KEY_MODULE_NAME}:list`,
  GET = `${API_KEY_MODULE_NAME}:get`,
  CREATE = `${API_KEY_MODULE_NAME}:create`,
  UPDATE = `${API_KEY_MODULE_NAME}:update`,
  DELETE = `${API_KEY_MODULE_NAME}:delete`,
}

export const API_KEY_BASE_RESOURCE = 'workspace:${workspace.name}:environment:${environment.name}:api-key'
export const API_KEY_RESOURCE_ITEM = `${API_KEY_BASE_RESOURCE}:\${apiKey.name}`
