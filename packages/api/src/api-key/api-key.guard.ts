import {
  Injectable,
  CanActivate,
  ExecutionContext,
  createParamDecorator,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { AIResourceService } from '../ai-resource/ai-resource.service';
import { ApiKeyService } from './api-key.service';

export const ApiKey = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return request.apiKey;
  }
);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly apiKeyService: ApiKeyService,
    // The resource lookup is opt-in (only fired when the route lacks
    // a `:resource` path segment). Resolved lazily through ModuleRef
    // to avoid a hard ApiKeyModule → AIResourceModule dependency
    // — same pattern as `RoleGuard`.
    private readonly moduleRef: ModuleRef
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const workspaceId = request.params?.workspaceId as string | undefined;
    const environmentId = request.params?.environmentId as string | undefined;
    if (!workspaceId || !environmentId) {
      return false;
    }

    const apiKeyHeader =
      request.headers['x-api-key'] ||
      (request.headers['authorization']?.replace('Bearer ', '') ?? '');

    if (!apiKeyHeader) {
      return false;
    }
    const apiKey = Array.isArray(apiKeyHeader) ? apiKeyHeader[0] : apiKeyHeader;

    // Resource resolution: prefer the URL's `:resource` segment when
    // the route declares one (legacy controllers); otherwise fall
    // back to the request body's `model` field, which is how the
    // public completion endpoints (`/chat/completions`,
    // `/anthropic/messages`, `/responses`) carry the AI Resource
    // name. Without this fallback, every API-key-authenticated
    // completion call would 401 (the routes don't have
    // `:resource`).
    let resourceIdentifier =
      (request.params?.resource as string | undefined) ??
      (typeof request.body?.model === 'string'
        ? (request.body.model as string)
        : undefined);

    if (!resourceIdentifier) {
      return false;
    }

    // The API key's allow-list (`entity.resources`) holds resource
    // UUIDs. The body's `model` is a resource NAME — translate via
    // AIResourceService.getByName when needed.
    if (!UUID_RE.test(resourceIdentifier)) {
      const resourceService = this.moduleRef.get(AIResourceService, {
        strict: false,
      });
      const resourceEntity = await resourceService.getByName(
        workspaceId,
        environmentId,
        resourceIdentifier,
        false
      );
      if (!resourceEntity) {
        return false;
      }
      resourceIdentifier = resourceEntity.resourceId;
    }

    const apiKeyEntity = await this.apiKeyService.verify(
      apiKey,
      workspaceId,
      environmentId,
      resourceIdentifier
    );
    if (!apiKeyEntity) {
      return false;
    }

    request.apiKey = apiKeyEntity;
    return true;
  }
}
