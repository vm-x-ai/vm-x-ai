export const COMPLETION_AUDIT_MODULE_NAME = 'completion-audit';

export enum CompletionAuditActions {
  LIST = `${COMPLETION_AUDIT_MODULE_NAME}:list`,
}

export const COMPLETION_AUDIT_BASE_RESOURCE = 'workspace:${workspace.name}:environment:${environment.name}:completion-audit';
export const COMPLETION_AUDIT_RESOURCE_ITEM = `${COMPLETION_AUDIT_BASE_RESOURCE}:\${completionAudit.id}`;
