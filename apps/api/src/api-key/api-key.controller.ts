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
} from '@nestjs/common';
import { ApiKeyService } from './api-key.service';
import { ApiOkResponse, ApiParam } from '@nestjs/swagger';
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

@Controller('api-keys')
export class ApiKeyController {
  constructor(private readonly apiKeyService: ApiKeyService) {}

  @Get(':workspaceId/:environmentId')
  @ApiOkResponse({
    type: ApiKeyEntity,
    isArray: true,
    description: 'List all API keys associated with an environment',
  })
  @ApiWorkspaceIdParam()
  @ApiEnvironmentIdParam()
  @ApiIncludesUsersQuery()
  @ApiOperation({
    summary: 'List all API keys associated with an environment',
    description:
      'Returns a list of all API keys associated with an environment. Optionally includes user details in each API key if `includesUsers` is set to true (default).',
  })
  public async getAll(
    @WorkspaceIdParam() workspaceId: string,
    @EnvironmentIdParam() environmentId: string,
    @IncludesUsersQuery()
    includesUsers: boolean,
    @AuthenticatedUser() user: UserEntity
  ): Promise<ApiKeyEntity[]> {
    return this.apiKeyService.getAllByMemberUserId(
      workspaceId,
      environmentId,
      user.id,
      includesUsers
    );
  }

  @Get(':workspaceId/:environmentId/:apiKeyId')
  @ApiOkResponse({
    type: ApiKeyEntity,
    description: 'Get an API key by ID',
  })
  @ApiOperation({
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
    includesUsers: boolean,
    @AuthenticatedUser() user: UserEntity
  ): Promise<ApiKeyEntity> {
    return this.apiKeyService.getByMemberUserId(
      workspaceId,
      environmentId,
      apiKeyId,
      user.id,
      includesUsers
    );
  }

  @Post(':workspaceId/:environmentId')
  @ApiOkResponse({
    type: CreatedApiKeyDto,
    description: 'Create a new API key',
  })
  @ApiWorkspaceIdParam()
  @ApiEnvironmentIdParam()
  @ApiOperation({
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
  @ApiWorkspaceIdParam()
  @ApiEnvironmentIdParam()
  @ApiOkResponse({
    type: ApiKeyEntity,
    description: 'Update an API key',
  })
  @ApiOperation({
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
  @ApiWorkspaceIdParam()
  @ApiOkResponse({
    description: 'Delete an API key',
  })
  @ApiOperation({
    summary: 'Delete an API key',
    description:
      'Deletes an API key by its ID. You must be a member of the workspace to delete an API key.',
  })
  public async delete(
    @WorkspaceIdParam() workspaceId: string,
    @EnvironmentIdParam() environmentId: string,
    @ApiKeyIdParam() apiKeyId: string,
    @AuthenticatedUser() user: UserEntity
  ): Promise<void> {
    await this.apiKeyService.delete(workspaceId, environmentId, apiKeyId, user);
  }
}
