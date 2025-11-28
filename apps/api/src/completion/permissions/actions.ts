export const COMPLETION_MODULE_NAME = 'completion';

export enum CompletionActions {
  EXECUTE = `${COMPLETION_MODULE_NAME}:execute`,
}

export const COMPLETION_BASE_RESOURCE = 'workspace:${workspace.name}:environment:${environment.name}:completion';
export const COMPLETION_RESOURCE_ITEM = `${COMPLETION_BASE_RESOURCE}:\${completion.id}`;
