import {
  Controller,
  Get,
  Query,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiExtraModels,
  ApiInternalServerErrorResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CompletionAuditService } from './audit.service';
import {
  CompletionAuditFallbackEventEntity,
  CompletionAuditRoutingEventEntity,
} from './entities/audit.entity';
import {
  ApiEnvironmentIdParam,
  ApiWorkspaceIdParam,
  EnvironmentIdParam,
  WorkspaceIdParam,
} from '../../common/api.decorators';
import { UserEntity } from '../../users/entities/user.entity';
import { AuthenticatedUser } from '../../auth/auth.guard';
import { ListAuditQueryDto, ListAuditResponseDto } from './dto/list-audit.dto';
import { WorkspaceMemberGuard } from '../../workspace/workspace.guard';
import { ServiceError } from '../../types';
import { RoleGuard } from '../../role/role.guard';
import { COMPLETION_AUDIT_BASE_RESOURCE, CompletionAuditActions } from './permissions/actions';

@Controller('completion-audit')
@UseGuards(WorkspaceMemberGuard())
@ApiTags('Completion Audit')
@ApiExtraModels(
  CompletionAuditFallbackEventEntity,
  CompletionAuditRoutingEventEntity
)
@ApiInternalServerErrorResponse({
  type: ServiceError,
  description: 'Server Error',
})
export class CompletionAuditController {
  constructor(
    private readonly completionAuditService: CompletionAuditService
  ) {}

  @Get(':workspaceId/:environmentId')
  @UseGuards(RoleGuard(CompletionAuditActions.LIST, COMPLETION_AUDIT_BASE_RESOURCE))
  @ApiOkResponse({
    type: ListAuditResponseDto,
    description: 'List all completion audits associated with an environment',
  })
  @ApiWorkspaceIdParam()
  @ApiEnvironmentIdParam()
  @ApiOperation({
    operationId: 'getCompletionAudit',
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
    return this.completionAuditService.get(
      workspaceId,
      environmentId,
      query,
      user
    );
  }
}
