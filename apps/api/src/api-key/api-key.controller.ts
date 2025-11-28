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
import { ApiKeyService } from './api-key.service';
import {
  ApiInternalServerErrorResponse,
  ApiOkResponse,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import {
  ApiEnvironmentIdParam,
  ApiWorkspaceIdParam,
} from '../common/api.decorators';
import { ApiIncludesUsersQuery } from '../common/api.decorators';
import { ApiOperation } from '@nestjs/swagger';
import { WorkspaceIdParam } from '../common/api.decorators';
import { EnvironmentIdParam } from '../common/api.decorators';
import { IncludesUsersQuery } from '../common/api.decorators';
import { AuthenticatedUser } from '../auth/auth.guard';
import { UserEntity } from '../users/entities/user.entity';
import { ApiKeyEntity } from './entities/api-key.entity';
import { CreateApiKeyDto } from './dto/create-api-key.dto';
import { UpdateApiKeyDto } from './dto/update-api-key.dto';
import { CreatedApiKeyDto } from './dto/created-api-key.dto';
import { WorkspaceMemberGuard } from '../workspace/workspace.guard';
import { ServiceError } from '../types';
import { RoleGuard } from '../role/role.guard';
import {
  APIKeyActions,
  API_KEY_BASE_RESOURCE,
  API_KEY_RESOURCE_ITEM,
} from './permissions/actions';

export function ApiApiKeyIdParam() {
  return applyDecorators(
    ApiParam({
      name: 'apiKeyId',
      type: String,
      required: true,
      description: 'The unique identifier of the API key',
    })
  );
}

export function ApiKeyIdParam() {
  return Param('apiKeyId', new ParseUUIDPipe({ version: '4' }));
}

@UseGuards(WorkspaceMemberGuard())
@Controller('api-key')
@ApiTags('API Key')
@ApiInternalServerErrorResponse({
  type: ServiceError,
  description: 'Server Error',
})
export class ApiKeyController {
  constructor(private readonly apiKeyService: ApiKeyService) {}

  @Get(':workspaceId/:environmentId')
  @UseGuards(RoleGuard(APIKeyActions.LIST, API_KEY_BASE_RESOURCE))
  @ApiOkResponse({
    type: ApiKeyEntity,
    isArray: true,
    description: 'List all API keys associated with an environment',
  })
  @ApiWorkspaceIdParam()
  @ApiEnvironmentIdParam()
  @ApiIncludesUsersQuery()
  @ApiOperation({
    operationId: 'getAPIKeys',
    summary: 'List all API keys associated with an environment',
    description:
      'Returns a list of all API keys associated with an environment. Optionally includes user details in each API key if `includesUsers` is set to true (default).',
  })
  public async getAll(
    @WorkspaceIdParam() workspaceId: string,
    @EnvironmentIdParam() environmentId: string,
    @IncludesUsersQuery()
    includesUsers: boolean
  ): Promise<ApiKeyEntity[]> {
    return this.apiKeyService.getAll({
      workspaceId,
      environmentId,
      includesUsers,
    });
  }

  @Get(':workspaceId/:environmentId/:apiKeyId')
  @UseGuards(RoleGuard(APIKeyActions.GET, API_KEY_RESOURCE_ITEM))
  @ApiOkResponse({
    type: ApiKeyEntity,
    description: 'Get an API key by ID',
  })
  @ApiOperation({
    operationId: 'getAPIKeyById',
    summary: 'Get an API key by ID',
    description:
      'Returns an API key by its ID. Optionally includes user details in the API key if `includesUsers` is set to true (default).',
  })
  @ApiWorkspaceIdParam()
  @ApiEnvironmentIdParam()
  @ApiApiKeyIdParam()
  @ApiIncludesUsersQuery()
  public async getById(
    @WorkspaceIdParam() workspaceId: string,
    @EnvironmentIdParam() environmentId: string,
    @ApiKeyIdParam() apiKeyId: string,
    @IncludesUsersQuery()
    includesUsers: boolean
  ): Promise<ApiKeyEntity> {
    return this.apiKeyService.getById({
      workspaceId,
      environmentId,
      apiKeyId,
      includesUsers,
    });
  }

  @Post(':workspaceId/:environmentId')
  @UseGuards(RoleGuard(APIKeyActions.CREATE, API_KEY_BASE_RESOURCE))
  @ApiOkResponse({
    type: CreatedApiKeyDto,
    description: 'Create a new API key',
  })
  @ApiWorkspaceIdParam()
  @ApiEnvironmentIdParam()
  @ApiOperation({
    operationId: 'createAPIKey',
    summary: 'Create a new API key',
    description:
      'Creates a new API key. You must be a member of the workspace to create an API key.',
  })
  public async create(
    @WorkspaceIdParam() workspaceId: string,
    @EnvironmentIdParam() environmentId: string,
    @AuthenticatedUser() user: UserEntity,
    @Body() payload: CreateApiKeyDto
  ): Promise<CreatedApiKeyDto> {
    return this.apiKeyService.create(workspaceId, environmentId, payload, user);
  }

  @Put(':workspaceId/:environmentId/:apiKeyId')
  @UseGuards(RoleGuard(APIKeyActions.UPDATE, API_KEY_RESOURCE_ITEM))
  @ApiWorkspaceIdParam()
  @ApiEnvironmentIdParam()
  @ApiOkResponse({
    type: ApiKeyEntity,
    description: 'Update an API key',
  })
  @ApiOperation({
    operationId: 'updateAPIKey',
    summary: 'Update an API key',
    description:
      'Updates an API key by its ID. You must be a member of the workspace to update an API key.',
  })
  public async update(
    @WorkspaceIdParam() workspaceId: string,
    @EnvironmentIdParam() environmentId: string,
    @ApiKeyIdParam() apiKeyId: string,
    @Body() payload: UpdateApiKeyDto,
    @AuthenticatedUser() user: UserEntity
  ): Promise<ApiKeyEntity> {
    return this.apiKeyService.update(
      workspaceId,
      environmentId,
      apiKeyId,
      payload,
      user
    );
  }

  @Delete(':workspaceId/:environmentId/:apiKeyId')
  @UseGuards(RoleGuard(APIKeyActions.DELETE, API_KEY_RESOURCE_ITEM))
  @ApiWorkspaceIdParam()
  @ApiOkResponse({
    description: 'Delete an API key',
  })
  @ApiOperation({
    operationId: 'deleteAPIKey',
    summary: 'Delete an API key',
    description:
      'Deletes an API key by its ID. You must be a member of the workspace to delete an API key.',
  })
  public async delete(
    @WorkspaceIdParam() workspaceId: string,
    @EnvironmentIdParam() environmentId: string,
    @ApiKeyIdParam() apiKeyId: string
  ): Promise<void> {
    await this.apiKeyService.delete(workspaceId, environmentId, apiKeyId);
  }
}
