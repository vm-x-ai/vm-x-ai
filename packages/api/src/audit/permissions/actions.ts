export const REQUEST_AUDIT_MODULE_NAME = 'request-audit';

export enum RequestAuditActions {
  LIST = `${REQUEST_AUDIT_MODULE_NAME}:list`,
}

export const REQUEST_AUDIT_BASE_RESOURCE =
  'workspace:${workspace.name}:environment:${environment.name}:request-audit';
export const REQUEST_AUDIT_RESOURCE_ITEM = `${REQUEST_AUDIT_BASE_RESOURCE}:\${requestAudit.id}`;
