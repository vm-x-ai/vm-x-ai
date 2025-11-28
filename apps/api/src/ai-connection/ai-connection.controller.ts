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
  UseGuards,
} from '@nestjs/common';
import { AIConnectionService } from './ai-connection.service';
import {
  ApiInternalServerErrorResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { AIConnectionEntity } from './entities/ai-connection.entity';
import { CreateAIConnectionDto } from './dto/create-ai-connection.dto';
import { AuthenticatedUser } from '../auth/auth.guard';
import { UserEntity } from '../users/entities/user.entity';
import { UpdateAIConnectionDto } from './dto/update-ai-connection.dto';
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
  AIConnectionActions,
  AI_CONNECTION_BASE_RESOURCE,
  AI_CONNECTION_RESOURCE_ITEM,
} from './permissions/actions';

export function ApiAIConnectionIdParam() {
  return applyDecorators(
    ApiParam({
      name: 'connectionId',
      type: String,
      required: true,
      description: 'The ID of the AI connection',
    })
  );
}

export function AIConnectionIdParam() {
  return Param('connectionId', new ParseUUIDPipe({ version: '4' }));
}

@UseGuards(WorkspaceMemberGuard())
@Controller('ai-connection')
@ApiTags('AI Connection')
@ApiInternalServerErrorResponse({
  type: ServiceError,
  description: 'Server Error',
})
export class AIConnectionController {
  constructor(private readonly aiConnectionService: AIConnectionService) {}

  @Get(':workspaceId/:environmentId')
  @UseGuards(RoleGuard(AIConnectionActions.LIST, AI_CONNECTION_BASE_RESOURCE))
  @ApiOkResponse({
    type: AIConnectionEntity,
    isArray: true,
    description: 'List all AI connections associated with an environment',
  })
  @ApiWorkspaceIdParam()
  @ApiEnvironmentIdParam()
  @ApiIncludesUsersQuery()
  @ApiOperation({
    operationId: 'getAIConnections',
    summary: 'List all AI connections associated with an environment',
    description:
      'Returns a list of all AI connections associated with an environment. Optionally includes user details in each AI connection if `includesUsers` is set to true (default).',
  })
  public async getAll(
    @WorkspaceIdParam() workspaceId: string,
    @EnvironmentIdParam() environmentId: string,
    @IncludesUsersQuery()
    includesUsers: boolean
  ): Promise<AIConnectionEntity[]> {
    return this.aiConnectionService.getAll({
      workspaceId,
      environmentId,
      includesUsers,
    });
  }

  @Get(':workspaceId/:environmentId/:connectionId')
  @UseGuards(RoleGuard(AIConnectionActions.GET, AI_CONNECTION_RESOURCE_ITEM))
  @ApiOkResponse({
    type: AIConnectionEntity,
    description: 'Get an AI connection by ID',
  })
  @ApiOperation({
    operationId: 'getAIConnectionById',
    summary: 'Get an AI connection by ID',
    description:
      'Returns an AI connection by its ID. Optionally includes user details in the AI connection if `includesUsers` is set to true (default).',
  })
  @ApiWorkspaceIdParam()
  @ApiEnvironmentIdParam()
  @ApiAIConnectionIdParam()
  @ApiIncludesUsersQuery()
  public async getById(
    @WorkspaceIdParam() workspaceId: string,
    @EnvironmentIdParam() environmentId: string,
    @AIConnectionIdParam() connectionId: string,
    @IncludesUsersQuery()
    includesUsers: boolean
  ): Promise<AIConnectionEntity> {
    return this.aiConnectionService.getById({
      workspaceId,
      environmentId,
      connectionId,
      includesUsers,
      decrypt: false,
      hideSecretFields: true,
    });
  }

  @Post(':workspaceId/:environmentId')
  @UseGuards(RoleGuard(AIConnectionActions.CREATE, AI_CONNECTION_BASE_RESOURCE))
  @ApiOkResponse({
    type: AIConnectionEntity,
    description: 'Create a new AI connection',
  })
  @ApiWorkspaceIdParam()
  @ApiEnvironmentIdParam()
  @ApiOperation({
    operationId: 'createAIConnection',
    summary: 'Create a new AI connection',
    description:
      'Creates a new AI connection. You must be a member of the workspace to create an AI connection.',
  })
  public async create(
    @WorkspaceIdParam() workspaceId: string,
    @EnvironmentIdParam() environmentId: string,
    @AuthenticatedUser() user: UserEntity,
    @Body() payload: CreateAIConnectionDto
  ): Promise<AIConnectionEntity> {
    return this.aiConnectionService.create(
      workspaceId,
      environmentId,
      payload,
      user
    );
  }

  @Put(':workspaceId/:environmentId/:connectionId')
  @UseGuards(RoleGuard(AIConnectionActions.UPDATE, AI_CONNECTION_RESOURCE_ITEM))
  @ApiWorkspaceIdParam()
  @ApiEnvironmentIdParam()
  @ApiOkResponse({
    type: AIConnectionEntity,
    description: 'Update an AI connection',
  })
  @ApiOperation({
    operationId: 'updateAIConnection',
    summary: 'Update an AI connection',
    description:
      'Updates an AI connection by its ID. You must be a member of the workspace to update an AI connection.',
  })
  public async update(
    @WorkspaceIdParam() workspaceId: string,
    @EnvironmentIdParam() environmentId: string,
    @AIConnectionIdParam() connectionId: string,
    @Body() payload: UpdateAIConnectionDto,
    @AuthenticatedUser() user: UserEntity
  ): Promise<AIConnectionEntity> {
    return this.aiConnectionService.update(
      workspaceId,
      environmentId,
      connectionId,
      payload,
      user
    );
  }

  @Delete(':workspaceId/:environmentId/:connectionId')
  @UseGuards(RoleGuard(AIConnectionActions.DELETE, AI_CONNECTION_RESOURCE_ITEM))
  @ApiWorkspaceIdParam()
  @ApiOkResponse({
    description: 'Delete an AI connection',
  })
  @ApiOperation({
    operationId: 'deleteAIConnection',
    summary: 'Delete an AI connection',
    description:
      'Deletes an AI connection by its ID. You must be a member of the workspace to delete an AI connection.',
  })
  public async delete(
    @WorkspaceIdParam() workspaceId: string,
    @EnvironmentIdParam() environmentId: string,
    @AIConnectionIdParam() connectionId: string
  ): Promise<void> {
    await this.aiConnectionService.delete(
      workspaceId,
      environmentId,
      connectionId
    );
  }
}
