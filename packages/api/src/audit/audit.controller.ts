import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiExtraModels,
  ApiInternalServerErrorResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { RequestAuditService } from './audit.service';
import {
  RequestAuditFallbackEventEntity,
  RequestAuditRoutingEventEntity,
} from './entities/audit.entity';
import {
  ApiEnvironmentIdParam,
  ApiWorkspaceIdParam,
  EnvironmentIdParam,
  WorkspaceIdParam,
} from '../common/api.decorators';
import { UserEntity } from '../users/entities/user.entity';
import { AuthenticatedUser } from '../auth/auth.guard';
import { ListAuditQueryDto, ListAuditResponseDto } from './dto/list-audit.dto';
import { WorkspaceMemberGuard } from '../workspace/workspace.guard';
import { ServiceError } from '../types';
import { RoleGuard } from '../role/role.guard';
import {
  REQUEST_AUDIT_BASE_RESOURCE,
  RequestAuditActions,
} from './permissions/actions';

@Controller('request-audit')
@UseGuards(WorkspaceMemberGuard())
@ApiTags('Audit')
@ApiExtraModels(RequestAuditFallbackEventEntity, RequestAuditRoutingEventEntity)
@ApiInternalServerErrorResponse({
  type: ServiceError,
  description: 'Server Error',
})
export class RequestAuditController {
  constructor(private readonly requestAuditService: RequestAuditService) {}

  @Get(':workspaceId/:environmentId')
  @UseGuards(RoleGuard(RequestAuditActions.LIST, REQUEST_AUDIT_BASE_RESOURCE))
  @ApiOkResponse({
    type: ListAuditResponseDto,
    description: 'List all completion audits associated with an environment',
  })
  @ApiWorkspaceIdParam()
  @ApiEnvironmentIdParam()
  @ApiOperation({
    operationId: 'getRequestAudit',
    summary: 'List all completion audits associated with an environment',
    description:
      'Returns a list of all completion audits associated with an environment.',
  })
  public async getAll(
    @WorkspaceIdParam() workspaceId: string,
    @EnvironmentIdParam() environmentId: string,
    @Query(
      new ValidationPipe({
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      })
    )
    query: ListAuditQueryDto,
    @AuthenticatedUser() user: UserEntity
  ): Promise<ListAuditResponseDto> {
    return this.requestAuditService.get(
      workspaceId,
      environmentId,
      query,
      user
    );
  }

  @Get(':workspaceId/:environmentId/metadata-keys')
  @UseGuards(RoleGuard(RequestAuditActions.LIST, REQUEST_AUDIT_BASE_RESOURCE))
  @ApiOkResponse({
    type: [String],
    description:
      'Distinct metadata keys observed on completion audits in the last 30 days',
  })
  @ApiWorkspaceIdParam()
  @ApiEnvironmentIdParam()
  @ApiOperation({
    operationId: 'getRequestAuditMetadataKeys',
    summary: 'List distinct metadata keys',
    description:
      'Returns the set of distinct metadata keys observed on completion audits in the last 30 days. Used by the audit UI to populate the metadata-filter selector.',
  })
  public async getMetadataKeys(
    @WorkspaceIdParam() workspaceId: string,
    @EnvironmentIdParam() environmentId: string,
    @AuthenticatedUser() user: UserEntity
  ): Promise<string[]> {
    return this.requestAuditService.getMetadataKeys(
      workspaceId,
      environmentId,
      user
    );
  }

  @Get(':workspaceId/:environmentId/metadata-values/:key')
  @UseGuards(RoleGuard(RequestAuditActions.LIST, REQUEST_AUDIT_BASE_RESOURCE))
  @ApiOkResponse({
    type: [String],
    description:
      'Distinct metadata values observed for the given key in the last 30 days, capped at 1000',
  })
  @ApiWorkspaceIdParam()
  @ApiEnvironmentIdParam()
  @ApiParam({ name: 'key', required: true, type: String })
  @ApiOperation({
    operationId: 'getRequestAuditMetadataValues',
    summary: 'List distinct metadata values for a key',
    description:
      'Returns the set of distinct values observed for the given metadata key on completion audits in the last 30 days, sorted lexicographically. Used by the audit + usage UIs to autocomplete metadata-filter values.',
  })
  public async getMetadataValues(
    @WorkspaceIdParam() workspaceId: string,
    @EnvironmentIdParam() environmentId: string,
    @Param('key') key: string,
    @AuthenticatedUser() user: UserEntity
  ): Promise<string[]> {
    return this.requestAuditService.getMetadataValues(
      workspaceId,
      environmentId,
      key,
      user
    );
  }
}
