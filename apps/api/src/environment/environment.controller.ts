import {
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { EnvironmentService } from './environment.service';
import {
  ApiInternalServerErrorResponse,
  ApiOkResponse,
  ApiOperation,
} from '@nestjs/swagger';
import { EnvironmentEntity } from './entities/environment.entity';
import { CreateEnvironmentDto } from './dto/create-environment.dto';
import { AuthenticatedUser } from '../auth/auth.guard';
import { UserEntity } from '../users/entities/user.entity';
import { UpdateEnvironmentDto } from './dto/update-environment.dto';
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
import {
  ENVIRONMENT_BASE_RESOURCE,
  EnvironmentActions,
  ENVIRONMENT_RESOURCE_ITEM,
} from './permissions/actions';

@UseGuards(WorkspaceMemberGuard())
@Controller('environment')
@ApiInternalServerErrorResponse({
  type: ServiceError,
  description: 'Server Error',
})
export class EnvironmentController {
  constructor(private readonly environmentService: EnvironmentService) {}

  @Get(':workspaceId')
  @UseGuards(RoleGuard(EnvironmentActions.LIST, ENVIRONMENT_BASE_RESOURCE))
  @ApiOkResponse({
    type: EnvironmentEntity,
    isArray: true,
    description: 'List all environments that the user is a member of',
  })
  @ApiWorkspaceIdParam()
  @ApiIncludesUsersQuery()
  @ApiOperation({
    operationId: 'getEnvironments',
    summary: 'List all user environments',
    description:
      'Returns a list of all environments that the authenticated user is a member of. Optionally includes user details in each environment if `includesUsers` is set to true (default).',
  })
  public async getAll(
    @WorkspaceIdParam() workspaceId: string,
    @IncludesUsersQuery()
    includesUsers: boolean
  ): Promise<EnvironmentEntity[]> {
    return this.environmentService.getAll({
      workspaceId,
      includesUsers,
    });
  }

  @Get(':workspaceId/:environmentId')
  @UseGuards(RoleGuard(EnvironmentActions.GET, ENVIRONMENT_RESOURCE_ITEM))
  @ApiOkResponse({
    type: EnvironmentEntity,
    description: 'Get an environment by ID',
  })
  @ApiOperation({
    operationId: 'getEnvironmentById',
    summary: 'Get an environment by ID',
    description:
      'Returns an environment by its ID. Optionally includes user details in the environment if `includesUsers` is set to true (default).',
  })
  @ApiWorkspaceIdParam()
  @ApiEnvironmentIdParam()
  @ApiIncludesUsersQuery()
  public async getById(
    @WorkspaceIdParam() workspaceId: string,
    @EnvironmentIdParam() environmentId: string,
    @IncludesUsersQuery()
    includesUsers: boolean
  ): Promise<EnvironmentEntity> {
    return this.environmentService.getById({
      workspaceId,
      environmentId,
      includesUsers,
    });
  }

  @Post(':workspaceId')
  @UseGuards(RoleGuard(EnvironmentActions.CREATE, ENVIRONMENT_BASE_RESOURCE))
  @ApiOkResponse({
    type: EnvironmentEntity,
    description: 'Create a new environment',
  })
  @ApiWorkspaceIdParam()
  @ApiOperation({
    operationId: 'createEnvironment',
    summary: 'Create a new environment',
    description:
      'Creates a new environment. You must be a member of the workspace to create an environment.',
  })
  public async create(
    @WorkspaceIdParam() workspaceId: string,
    @Body() payload: CreateEnvironmentDto,
    @AuthenticatedUser() user: UserEntity
  ): Promise<EnvironmentEntity> {
    return this.environmentService.create(workspaceId, payload, user);
  }

  @Put(':workspaceId/:environmentId')
  @UseGuards(RoleGuard(EnvironmentActions.UPDATE, ENVIRONMENT_RESOURCE_ITEM))
  @ApiWorkspaceIdParam()
  @ApiEnvironmentIdParam()
  @ApiOkResponse({
    type: EnvironmentEntity,
    description: 'Update an environment',
  })
  @ApiOperation({
    operationId: 'updateEnvironment',
    summary: 'Update an environment',
    description:
      'Updates an environment by its ID. You must be a member of the workspace to update an environment.',
  })
  public async update(
    @WorkspaceIdParam() workspaceId: string,
    @EnvironmentIdParam() environmentId: string,
    @Body() payload: UpdateEnvironmentDto,
    @AuthenticatedUser() user: UserEntity
  ): Promise<EnvironmentEntity> {
    return this.environmentService.update(
      workspaceId,
      environmentId,
      payload,
      user
    );
  }

  @Delete(':workspaceId/:environmentId')
  @UseGuards(RoleGuard(EnvironmentActions.DELETE, ENVIRONMENT_RESOURCE_ITEM))
  @ApiWorkspaceIdParam()
  @ApiOkResponse({
    description: 'Delete an environment',
  })
  @ApiOperation({
    operationId: 'deleteEnvironment',
    summary: 'Delete an environment',
    description:
      'Deletes an environment by its ID. You must be a member of the workspace to delete an environment.',
  })
  public async delete(
    @WorkspaceIdParam() workspaceId: string,
    @EnvironmentIdParam() environmentId: string
  ): Promise<void> {
    await this.environmentService.delete(workspaceId, environmentId);
  }
}
