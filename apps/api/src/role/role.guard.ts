import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Type,
} from '@nestjs/common';
import { PassportResult } from '../auth/strategies/oidc.strategy';
import { RoleService } from './role.service';
import { FastifyRequest } from 'fastify';
import { ModuleRef } from '@nestjs/core';
import { WorkspaceService } from '../workspace/workspace.service';
import _ from 'lodash';
import { EnvironmentService } from '../environment/environment.service';
import { AIConnectionService } from '../ai-connection/ai-connection.service';
import { AIResourceService } from '../ai-resource/ai-resource.service';
import { ApiKeyService } from '../api-key/api-key.service';

export const RoleGuard = (
  action: string,
  resource: string
): Type<CanActivate> => {
  @Injectable()
  class MixinRoleGuard implements CanActivate {
    constructor(
      private readonly roleService: RoleService,
      private readonly moduleRef: ModuleRef
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
      const request = context.switchToHttp().getRequest();
      const user = request.user as PassportResult;
      const apiKey = request.apiKey;
      if (!user && !apiKey) {
        return false;
      }

      const params = (request as FastifyRequest).params as Record<
        string,
        string
      >;
      const variables: Record<string, unknown> = {};
      if (params.workspaceId) {
        const workspaceService = this.moduleRef.get(WorkspaceService, {
          strict: false,
        });
        variables.workspace = await workspaceService.getById(
          params.workspaceId,
          false
        );

        if (params.environmentId) {
          const environmentService = this.moduleRef.get(EnvironmentService, {
            strict: false,
          });
          variables.environment = await environmentService.getById(
            {
              workspaceId: params.workspaceId,
              environmentId: params.environmentId,
              includesUsers: false,
            },
            false
          );

          if (params.connectionId) {
            const connectionService = this.moduleRef.get(AIConnectionService, {
              strict: false,
            });
            variables.connection = await connectionService.getById(
              {
                workspaceId: params.workspaceId,
                environmentId: params.environmentId,
                connectionId: params.connectionId,
                includesUsers: false,
              },
              false
            );
          }

          if (params.resourceId) {
            const resourceService = this.moduleRef.get(AIResourceService, {
              strict: false,
            });
            variables.resource = await resourceService.getById(
              {
                workspaceId: params.workspaceId,
                environmentId: params.environmentId,
                resourceId: params.resourceId,
                includesUsers: false,
              },
              false
            );
          }

          if (params.apiKeyId) {
            const apiKeyService = this.moduleRef.get(ApiKeyService, {
              strict: false,
            });
            variables.apiKey = await apiKeyService.getById(
              {
                workspaceId: params.workspaceId,
                environmentId: params.environmentId,
                apiKeyId: params.apiKeyId,
                includesUsers: false,
              },
              false
            );
          }
        }
      }

      if (params.roleId) {
        variables.role = await this.roleService.getById(
          params.roleId,
          false,
          false
        );
      }

      resource = _.template(resource)(variables);

      await this.roleService.validate(user.user.id, action, resource);
      return true;
    }
  }
  return MixinRoleGuard;
};
