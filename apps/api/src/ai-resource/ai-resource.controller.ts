import {
  applyDecorators,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AIResourceService } from './ai-resource.service';
import {
  ApiExtraModels,
  ApiInternalServerErrorResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { AIResourceEntity } from './entities/ai-resource.entity';
import { CreateAIResourceDto } from './dto/create-ai-resource.dto';
import { AuthenticatedUser } from '../auth/auth.guard';
import { UserEntity } from '../users/entities/user.entity';
import { UpdateAIResourceDto } from './dto/update-ai-resource.dto';
import {
  ApiEnvironmentIdParam,
  ApiIncludesUsersQuery,
  ApiWorkspaceIdParam,
  EnvironmentIdParam,
  IncludesUsersQuery,
  WorkspaceIdParam,
} from '../common/api.decorators';
import { WorkspaceMemberGuard } from '../workspace/workspace.guard';
import { AIResourceRoutingCondition } from './common/routing.entity';
import { DiscoveredCapacityEntry } from '../capacity/capacity.entity';
import { ServiceError } from '../types';
import { RoleGuard } from '../role/role.guard';
import {
  AIResourceActions,
  AI_RESOURCE_BASE_RESOURCE,
  AI_RESOURCE_RESOURCE_ITEM,
} from './permissions/actions';

export function ApiAIResourceIdParam() {
  return applyDecorators(
    ApiParam({
      name: 'resourceId',
      type: String,
      required: true,
      format: 'uuid',
      description: 'The unique identifier of the AI resource',
    })
  );
}

export function AIResourceIdParam() {
  return Param('resourceId', new ParseUUIDPipe({ version: '4' }));
}

@UseGuards(WorkspaceMemberGuard())
@ApiExtraModels(AIResourceRoutingCondition, DiscoveredCapacityEntry)
@Controller('ai-resource')
@ApiTags('AI Resource')
@ApiInternalServerErrorResponse({
  type: ServiceError,
  description: 'Server Error',
})
export class AIResourceController {
  constructor(private readonly aiResourceService: AIResourceService) {}

  @Get(':workspaceId/:environmentId')
  @UseGuards(RoleGuard(AIResourceActions.LIST, AI_RESOURCE_BASE_RESOURCE))
  @ApiOkResponse({
    type: AIResourceEntity,
    isArray: true,
    description: 'List all AI resources associated with an environment',
  })
  @ApiWorkspaceIdParam()
  @ApiEnvironmentIdParam()
  @ApiIncludesUsersQuery()
  @ApiQuery({
    name: 'connectionId',
    type: String,
    format: 'uuid',
    required: false,
    description: 'The connection ID to list AI resources for',
  })
  @ApiOperation({
    operationId: 'getAIResources',
    summary: 'List all AI resources associated with an environment',
    description:
      'Returns a list of all AI resources associated with an environment. Optionally includes user details in each AI resource if `includesUsers` is set to true (default).',
  })
  public async getAll(
    @WorkspaceIdParam() workspaceId: string,
    @EnvironmentIdParam() environmentId: string,
    @IncludesUsersQuery()
    includesUsers: boolean,
    @Query('connectionId') connectionId?: string
  ): Promise<AIResourceEntity[]> {
    return this.aiResourceService.getAll({
      workspaceId,
      environmentId,
      includesUsers,
      connectionId,
    });
  }

  @Get(':workspaceId/:environmentId/:resourceId')
  @UseGuards(RoleGuard(AIResourceActions.GET, AI_RESOURCE_RESOURCE_ITEM))
  @ApiOkResponse({
    type: AIResourceEntity,
    description: 'Get an AI resource by ID',
  })
  @ApiOperation({
    operationId: 'getAIResourceById',
    summary: 'Get an AI resource by ID',
    description:
      'Returns an AI resource by its ID. Optionally includes user details in the AI resource if `includesUsers` is set to true (default).',
  })
  @ApiWorkspaceIdParam()
  @ApiEnvironmentIdParam()
  @ApiAIResourceIdParam()
  @ApiIncludesUsersQuery()
  public async getById(
    @WorkspaceIdParam() workspaceId: string,
    @EnvironmentIdParam() environmentId: string,
    @AIResourceIdParam() resourceId: string,
    @IncludesUsersQuery()
    includesUsers: boolean
  ): Promise<AIResourceEntity> {
    return this.aiResourceService.getById({
      workspaceId,
      environmentId,
      resourceId,
      includesUsers,
    });
  }

  @Post(':workspaceId/:environmentId')
  @UseGuards(RoleGuard(AIResourceActions.CREATE, AI_RESOURCE_BASE_RESOURCE))
  @ApiOkResponse({
    type: AIResourceEntity,
    description: 'Create a new AI resource',
  })
  @ApiWorkspaceIdParam()
  @ApiEnvironmentIdParam()
  @ApiOperation({
    operationId: 'createAIResource',
    summary: 'Create a new AI resource',
    description:
      'Creates a new AI resource. You must be a member of the workspace to create an AI resource.',
  })
  public async create(
    @WorkspaceIdParam() workspaceId: string,
    @EnvironmentIdParam() environmentId: string,
    @AuthenticatedUser() user: UserEntity,
    @Body() payload: CreateAIResourceDto
  ): Promise<AIResourceEntity> {
    return this.aiResourceService.create(
      workspaceId,
      environmentId,
      payload,
      user
    );
  }

  @Put(':workspaceId/:environmentId/:resourceId')
  @UseGuards(RoleGuard(AIResourceActions.UPDATE, AI_RESOURCE_RESOURCE_ITEM))
  @ApiWorkspaceIdParam()
  @ApiEnvironmentIdParam()
  @ApiOkResponse({
    type: AIResourceEntity,
    description: 'Update an AI resource',
  })
  @ApiOperation({
    operationId: 'updateAIResource',
    summary: 'Update an AI resource',
    description:
      'Updates an AI resource by its ID. You must be a member of the workspace to update an AI resource.',
  })
  public async update(
    @WorkspaceIdParam() workspaceId: string,
    @EnvironmentIdParam() environmentId: string,
    @AIResourceIdParam() resourceId: string,
    @Body() payload: UpdateAIResourceDto,
    @AuthenticatedUser() user: UserEntity
  ): Promise<AIResourceEntity> {
    return this.aiResourceService.update(
      workspaceId,
      environmentId,
      resourceId,
      payload,
      user
    );
  }

  @Delete(':workspaceId/:environmentId/:resourceId')
  @UseGuards(RoleGuard(AIResourceActions.DELETE, AI_RESOURCE_RESOURCE_ITEM))
  @ApiWorkspaceIdParam()
  @ApiOkResponse({
    description: 'Delete an AI resource',
  })
  @ApiOperation({
    operationId: 'deleteAIResource',
    summary: 'Delete an AI resource',
    description:
      'Deletes an AI resource by its ID. You must be a member of the workspace to delete an AI resource.',
  })
  public async delete(
    @WorkspaceIdParam() workspaceId: string,
    @EnvironmentIdParam() environmentId: string,
    @AIResourceIdParam() resourceId: string,
    @AuthenticatedUser() user: UserEntity
  ): Promise<void> {
    await this.aiResourceService.delete(
      workspaceId,
      environmentId,
      resourceId,
      user
    );
  }
}
