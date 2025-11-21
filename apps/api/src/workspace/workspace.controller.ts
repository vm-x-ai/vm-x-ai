import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  ParseBoolPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { WorkspaceService } from './workspace.service';
import {
  ApiInternalServerErrorResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
} from '@nestjs/swagger';
import { WorkspaceEntity } from './entities/workspace.entity';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import { AuthenticatedUser } from '../auth/auth.guard';
import { UserEntity } from '../users/entities/user.entity';
import { UpdateWorkspaceDto } from './dto/update-workspace.dto';
import {
  ApiIncludesUsersQuery,
  ApiWorkspaceIdParam,
  IncludesUsersQuery,
  WorkspaceIdParam,
} from '../common/api.decorators';
import { WorkspaceMemberGuard } from './workspace.guard';
import { PublicWorkspaceUserRole } from '../storage/entities.generated';
import { ServiceError } from '../types';

@Controller('workspace')
@ApiInternalServerErrorResponse({
  type: ServiceError,
  description: 'Server Error',
})
export class WorkspaceController {
  constructor(private readonly workspaceService: WorkspaceService) {}

  @Get()
  @ApiOkResponse({
    type: WorkspaceEntity,
    isArray: true,
    description: 'List all workspaces that the user is a member of',
  })
  @ApiIncludesUsersQuery()
  @ApiQuery({
    name: 'includesEnvironments',
    type: Boolean,
    required: false,
    description: 'Whether to include environments in the response',
  })
  @ApiOperation({
    operationId: 'getWorkspaces',
    summary: 'List all user workspaces',
    description:
      'Returns a list of all workspaces that the authenticated user is a member of. Optionally includes user details in each workspace if `includesUsers` is set to true (default).',
  })
  public async getAll(
    @IncludesUsersQuery()
    includesUsers: boolean,
    @Query(
      'includesEnvironments',
      new DefaultValuePipe(false),
      new ParseBoolPipe({ optional: true })
    )
    includesEnvironments: boolean,
    @AuthenticatedUser() user: UserEntity
  ): Promise<WorkspaceEntity[]> {
    return this.workspaceService.getAll({
      userId: user.id,
      includesUsers,
      includesEnvironments,
    });
  }

  @Get(':workspaceId')
  @UseGuards(WorkspaceMemberGuard())
  @ApiOkResponse({
    type: WorkspaceEntity,
    description: 'Get a workspace by ID',
  })
  @ApiOperation({
    operationId: 'getWorkspaceById',
    summary: 'Get a workspace by ID',
    description:
      'Returns a workspace by its ID. Optionally includes user details in the workspace if `includesUsers` is set to true (default).',
  })
  @ApiWorkspaceIdParam()
  @ApiIncludesUsersQuery()
  public async getById(
    @WorkspaceIdParam() workspaceId: string,
    @IncludesUsersQuery()
    includesUsers: boolean
  ): Promise<WorkspaceEntity> {
    return this.workspaceService.getById(workspaceId, includesUsers);
  }

  @Post()
  @ApiOkResponse({
    type: WorkspaceEntity,
    description: 'Create a new workspace',
  })
  @ApiOperation({
    operationId: 'createWorkspace',
    summary: 'Create a new workspace',
    description:
      'Creates a new workspace. The authenticated user is automatically added as the owner of the workspace.',
  })
  public async create(
    @Body() payload: CreateWorkspaceDto,
    @AuthenticatedUser() user: UserEntity
  ): Promise<WorkspaceEntity> {
    return this.workspaceService.create(payload, user);
  }

  @Put(':workspaceId')
  @UseGuards(WorkspaceMemberGuard())
  @ApiWorkspaceIdParam()
  @ApiOkResponse({
    type: WorkspaceEntity,
    description: 'Update a workspace',
  })
  @ApiOperation({
    operationId: 'updateWorkspace',
    summary: 'Update a workspace',
    description:
      'Updates a workspace by its ID. The authenticated user must be a member of the workspace and have the owner role.',
  })
  public async update(
    @WorkspaceIdParam() workspaceId: string,
    @Body() payload: UpdateWorkspaceDto,
    @AuthenticatedUser() user: UserEntity
  ): Promise<WorkspaceEntity> {
    return this.workspaceService.update(workspaceId, payload, user);
  }

  @Delete(':workspaceId')
  @UseGuards(WorkspaceMemberGuard(PublicWorkspaceUserRole.OWNER))
  @ApiWorkspaceIdParam()
  @ApiOkResponse({
    description: 'Delete a workspace',
  })
  @ApiOperation({
    operationId: 'deleteWorkspace',
    summary: 'Delete a workspace',
    description:
      'Deletes a workspace by its ID. The authenticated user must be a member of the workspace and have the owner role.',
  })
  public async delete(@WorkspaceIdParam() workspaceId: string): Promise<void> {
    await this.workspaceService.delete(workspaceId);
  }
}
