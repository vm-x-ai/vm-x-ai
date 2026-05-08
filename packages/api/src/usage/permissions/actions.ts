export const REQUEST_USAGE_MODULE_NAME = 'request-usage';

export enum RequestUsageActions {
  QUERY = `${REQUEST_USAGE_MODULE_NAME}:query`,
}

export const REQUEST_USAGE_BASE_RESOURCE =
  'workspace:${workspace.name}:environment:${environment.name}:request-usage';
export const REQUEST_USAGE_RESOURCE_ITEM = `${REQUEST_USAGE_BASE_RESOURCE}:\${requestUsage.id}`;
