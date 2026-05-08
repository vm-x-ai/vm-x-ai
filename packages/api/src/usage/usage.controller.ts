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
} from '../common/api.decorators';
import { RequestUsageService } from './usage.service';
import {
  RequestDimensions,
  RequestUsageDimensionFilterDto,
  RequestUsageDimensionOperator,
  RequestUsageQueryDto,
} from './dto/request-query.dto';
import { WorkspaceMemberGuard } from '../workspace/workspace.guard';
import { RequestUsageQueryResultDto } from './dto/request-query-result.dto';
import { ServiceError } from '../types';
import {
  REQUEST_USAGE_BASE_RESOURCE,
  RequestUsageActions,
} from './permissions/actions';
import { RoleGuard } from '../role/role.guard';

@Controller('request-usage')
@UseGuards(WorkspaceMemberGuard())
@ApiExtraModels(RequestUsageDimensionFilterDto)
@ApiTags('Usage')
@ApiInternalServerErrorResponse({
  type: ServiceError,
  description: 'Server Error',
})
export class RequestUsageController {
  constructor(private readonly requestUsageService: RequestUsageService) {}

  @Post(':workspaceId/:environmentId')
  @UseGuards(RoleGuard(RequestUsageActions.QUERY, REQUEST_USAGE_BASE_RESOURCE))
  @ApiOkResponse({
    type: RequestUsageQueryResultDto,
    isArray: true,
    description: 'List all completion usage records',
  })
  @ApiWorkspaceIdParam()
  @ApiEnvironmentIdParam()
  @ApiOperation({
    operationId: 'getRequestUsage',
    summary: 'Query completion usage records',
    description:
      'Returns a list of completion usage records based on the query parameters',
  })
  public async getAll(
    @WorkspaceIdParam() workspaceId: string,
    @EnvironmentIdParam() environmentId: string,
    @Body() query: RequestUsageQueryDto
  ): Promise<RequestUsageQueryResultDto[]> {
    query.filter.fields = query.filter.fields ?? {};
    query.filter.fields[RequestDimensions.WORKSPACE_ID] = {
      operator: RequestUsageDimensionOperator.EQ,
      value: workspaceId,
    };
    query.filter.fields[RequestDimensions.ENVIRONMENT_ID] = {
      operator: RequestUsageDimensionOperator.EQ,
      value: environmentId,
    };

    return await this.requestUsageService.query(query);
  }
}
