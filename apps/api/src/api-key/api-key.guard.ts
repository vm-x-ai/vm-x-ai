import {
  Injectable,
  CanActivate,
  ExecutionContext,
  createParamDecorator,
} from '@nestjs/common';
import { ApiKeyService } from './api-key.service';

export const ApiKey = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return request.apiKey;
  }
);

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly apiKeyService: ApiKeyService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    if (
      !request.params?.workspaceId ||
      !request.params?.environmentId ||
      !request.params?.resource
    ) {
      return false;
    }

    const apiKeyHeader =
      request.headers['x-api-key'] ||
      (request.headers['authorization']?.replace('Bearer ', '') ?? '');

    if (!apiKeyHeader) {
      return false;
    }
    const apiKey = Array.isArray(apiKeyHeader) ? apiKeyHeader[0] : apiKeyHeader;
    const apiKeyEntity = await this.apiKeyService.verify(
      apiKey,
      request.params.workspaceId,
      request.params.environmentId,
      request.params.resource
    );
    if (!apiKeyEntity) {
      return false;
    }

    request.apiKey = apiKeyEntity;
    return true;
  }
}
