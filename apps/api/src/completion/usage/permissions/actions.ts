export const COMPLETION_USAGE_MODULE_NAME = 'completion-usage';

export enum CompletionUsageActions {
  QUERY = `${COMPLETION_USAGE_MODULE_NAME}:query`,
}

export const COMPLETION_USAGE_BASE_RESOURCE = 'workspace:${workspace.name}:environment:${environment.name}:completion-usage';
export const COMPLETION_USAGE_RESOURCE_ITEM = `${COMPLETION_USAGE_BASE_RESOURCE}:\${completionUsage.id}`;
