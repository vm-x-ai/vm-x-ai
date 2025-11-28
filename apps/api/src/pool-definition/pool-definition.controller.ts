import { Body, Controller, Delete, Get, Post, UseGuards } from '@nestjs/common';
import { PoolDefinitionService } from './pool-definition.service';
import {
  ApiInternalServerErrorResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { PoolDefinitionEntity } from './entities/pool-definition.entity';
import { UpsertPoolDefinitionDto } from './dto/upsert-pool-definition.dto';
import { AuthenticatedUser } from '../auth/auth.guard';
import { UserEntity } from '../users/entities/user.entity';
import {
  ApiEnvironmentIdParam,
  ApiIncludesUsersQuery,
  ApiWorkspaceIdParam,
  EnvironmentIdParam,
  IncludesUsersQuery,
  WorkspaceIdParam,
} from '../common/api.decorators';
import { WorkspaceMemberGuard } from '../workspace/workspace.guard';
import { ServiceError } from '../types';
import { RoleGuard } from '../role/role.guard';
import { POOL_DEFINITION_BASE_RESOURCE, PoolDefinitionActions } from './permissions/actions';

@UseGuards(WorkspaceMemberGuard())
@Controller('pool-definition')
@ApiTags('Pool Definition')
@ApiInternalServerErrorResponse({
  type: ServiceError,
  description: 'Server Error',
})
export class PoolDefinitionController {
  constructor(private readonly poolDefinitionService: PoolDefinitionService) {}

  @Get(':workspaceId/:environmentId')
  @UseGuards(RoleGuard(PoolDefinitionActions.GET, POOL_DEFINITION_BASE_RESOURCE))
  @ApiOkResponse({
    type: PoolDefinitionEntity,
    description: 'Get a pool definition by workspace and environment',
  })
  @ApiOperation({
    operationId: 'getPoolDefinition',
    summary: 'Get a pool definition by workspace and environment',
    description:
      'Returns a pool definition by its workspace and environment. Optionally includes user details in the pool definition if `includesUsers` is set to true (default).',
  })
  @ApiWorkspaceIdParam()
  @ApiEnvironmentIdParam()
  @ApiIncludesUsersQuery()
  public async getById(
    @WorkspaceIdParam() workspaceId: string,
    @EnvironmentIdParam() environmentId: string,
    @IncludesUsersQuery()
    includesUsers: boolean
  ): Promise<PoolDefinitionEntity> {
    return this.poolDefinitionService.getById({
      workspaceId,
      environmentId,
      includesUsers,
    });
  }

  @Post(':workspaceId/:environmentId')
  @UseGuards(RoleGuard(PoolDefinitionActions.UPDATE, POOL_DEFINITION_BASE_RESOURCE))
  @ApiOkResponse({
    type: PoolDefinitionEntity,
    description: 'Created/updated a pool definition',
  })
  @ApiWorkspaceIdParam()
  @ApiEnvironmentIdParam()
  @ApiOperation({
    operationId: 'updatePoolDefinition',
    summary: 'Created/updated a pool definition',
    description:
      'Created/updated a pool definition. You must be a member of the workspace to create/update a pool definition.',
  })
  public async upsert(
    @WorkspaceIdParam() workspaceId: string,
    @EnvironmentIdParam() environmentId: string,
    @AuthenticatedUser() user: UserEntity,
    @Body() payload: UpsertPoolDefinitionDto
  ): Promise<PoolDefinitionEntity> {
    return this.poolDefinitionService.upsert(
      workspaceId,
      environmentId,
      payload,
      user
    );
  }

  @Delete(':workspaceId/:environmentId')
  @UseGuards(RoleGuard(PoolDefinitionActions.DELETE, POOL_DEFINITION_BASE_RESOURCE))
  @ApiWorkspaceIdParam()
  @ApiOkResponse({
    description: 'Delete a pool definition',
  })
  @ApiOperation({
    operationId: 'deletePoolDefinition',
    summary: 'Delete a pool definition',
    description:
      'Deletes a pool definition by its workspace and environment. You must be a member of the workspace to delete a pool definition.',
  })
  public async delete(
    @WorkspaceIdParam() workspaceId: string,
    @EnvironmentIdParam() environmentId: string
  ): Promise<void> {
    await this.poolDefinitionService.delete(workspaceId, environmentId);
  }
}
