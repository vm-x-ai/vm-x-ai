export const COMPLETION_BATCH_MODULE_NAME = 'completion-batch';

export enum CompletionBatchActions {
  LIST = `${COMPLETION_BATCH_MODULE_NAME}:list`,
  GET = `${COMPLETION_BATCH_MODULE_NAME}:get`,
  CREATE = `${COMPLETION_BATCH_MODULE_NAME}:create`,
  CANCEL = `${COMPLETION_BATCH_MODULE_NAME}:cancel`,
}

export const COMPLETION_BATCH_BASE_RESOURCE = 'workspace:${workspace.name}:environment:${environment.name}:completion-batch';
export const COMPLETION_BATCH_RESOURCE_ITEM = `${COMPLETION_BATCH_BASE_RESOURCE}:\${batch.id}`;
