export const POOL_DEFINITION_MODULE_NAME = 'pool-definition';

export enum PoolDefinitionActions {
  GET = `${POOL_DEFINITION_MODULE_NAME}:get`,
  UPDATE = `${POOL_DEFINITION_MODULE_NAME}:update`,
  DELETE = `${POOL_DEFINITION_MODULE_NAME}:delete`,
}

export const POOL_DEFINITION_BASE_RESOURCE =
  'workspace:${workspace.name}:environment:${environment.name}:pool-definition';
export const POOL_DEFINITION_RESOURCE_ITEM = POOL_DEFINITION_BASE_RESOURCE;
