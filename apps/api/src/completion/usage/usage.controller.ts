import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import {
  ApiExtraModels,
  ApiInternalServerErrorResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  ApiEnvironmentIdParam,
  ApiWorkspaceIdParam,
  EnvironmentIdParam,
  WorkspaceIdParam,
} from '../../common/api.decorators';
import { CompletionUsageService } from './usage.service';
import {
  CompletionDimensions,
  CompletionUsageDimensionFilterDto,
  CompletionUsageDimensionOperator,
  CompletionUsageQueryDto,
} from './dto/completion-query.dto';
import { WorkspaceMemberGuard } from '../../workspace/workspace.guard';
import { CompletionUsageQueryResultDto } from './dto/completion-query-result.dto';
import { ServiceError } from '../../types';
import {
  COMPLETION_USAGE_BASE_RESOURCE,
  CompletionUsageActions,
} from './permissions/actions';
import { RoleGuard } from '../../role/role.guard';

@Controller('completion-usage')
@UseGuards(WorkspaceMemberGuard())
@ApiExtraModels(CompletionUsageDimensionFilterDto)
@ApiTags('Completion Usage')
@ApiInternalServerErrorResponse({
  type: ServiceError,
  description: 'Server Error',
})
export class CompletionUsageController {
  constructor(
    private readonly completionUsageService: CompletionUsageService
  ) {}

  @Post(':workspaceId/:environmentId')
  @UseGuards(
    RoleGuard(CompletionUsageActions.QUERY, COMPLETION_USAGE_BASE_RESOURCE)
  )
  @ApiOkResponse({
    type: CompletionUsageQueryResultDto,
    isArray: true,
    description: 'List all completion usage records',
  })
  @ApiWorkspaceIdParam()
  @ApiEnvironmentIdParam()
  @ApiOperation({
    operationId: 'getCompletionUsage',
    summary: 'Query completion usage records',
    description:
      'Returns a list of completion usage records based on the query parameters',
  })
  public async getAll(
    @WorkspaceIdParam() workspaceId: string,
    @EnvironmentIdParam() environmentId: string,
    @Body() query: CompletionUsageQueryDto
  ): Promise<CompletionUsageQueryResultDto[]> {
    query.filter.fields = query.filter.fields ?? {};
    query.filter.fields[CompletionDimensions.WORKSPACE_ID] = {
      operator: CompletionUsageDimensionOperator.EQ,
      value: workspaceId,
    };
    query.filter.fields[CompletionDimensions.ENVIRONMENT_ID] = {
      operator: CompletionUsageDimensionOperator.EQ,
      value: environmentId,
    };

    return await this.completionUsageService.query(query);
  }
}
