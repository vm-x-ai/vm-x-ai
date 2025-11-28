import {
  Controller,
  Get,
  ParseIntPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CompletionMetricsService } from './metrics.service';
import {
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
import {
  AIResourceIdParam,
  ApiAIResourceIdParam,
} from '../../ai-resource/ai-resource.controller';
import { MetricDto } from './dto/metric.dto';
import { ServiceError } from '../../types';
import { RoleGuard } from '../../role/role.guard';
import { COMPLETION_METRICS_BASE_RESOURCE, CompletionMetricsActions } from './permissions/actions';

@Controller('completion-metric')
@ApiTags('Completion Metric')
@ApiInternalServerErrorResponse({
  type: ServiceError,
  description: 'Server Error',
})
export class CompletionMetricsController {
  constructor(
    private readonly completionMetricsService: CompletionMetricsService
  ) {}

  @Get('/:workspaceId/:environmentId/:resourceId/error-rate')
  @UseGuards(RoleGuard(CompletionMetricsActions.GET_ERROR_RATE, COMPLETION_METRICS_BASE_RESOURCE))
  @ApiOkResponse({
    type: MetricDto,
    description: 'Get the error rate for an AI resource',
  })
  @ApiWorkspaceIdParam()
  @ApiEnvironmentIdParam()
  @ApiAIResourceIdParam()
  @ApiOperation({
    operationId: 'getCompletionErrorRate',
    summary: 'Get the error rate for an AI resource',
    description:
      'Returns the error rate for an AI resource in the requested window',
  })
  async getErrorRate(
    @WorkspaceIdParam() workspaceId: string,
    @EnvironmentIdParam() environmentId: string,
    @AIResourceIdParam() resourceId: string,
    @Query('aiConnectionId') aiConnectionId?: string,
    @Query('model') model?: string,
    @Query('window', ParseIntPipe) window = 10,
    @Query('statusCode') statusCode: 'any' | number = 'any'
  ) {
    return await this.completionMetricsService.getErrorRate(
      workspaceId,
      environmentId,
      resourceId,
      aiConnectionId,
      model,
      window,
      statusCode
    );
  }
}
