export const COMPLETION_METRICS_MODULE_NAME = 'completion-metrics';

export enum CompletionMetricsActions {
  GET_ERROR_RATE = `${COMPLETION_METRICS_MODULE_NAME}:get-error-rate`,
}

export const COMPLETION_METRICS_BASE_RESOURCE = 'workspace:${workspace.name}:environment:${environment.name}:completion-metrics';
export const COMPLETION_METRICS_RESOURCE_ITEM = `${COMPLETION_METRICS_BASE_RESOURCE}:\${resource.id}`;
