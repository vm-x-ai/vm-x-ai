import {
  applyDecorators,
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  HttpStatus,
  Param,
  ParseBoolPipe,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  AppGuard,
  AuthContext,
  IgnoreGlobalGuard,
} from '../../auth/auth.guard';
import { OrGuard } from '@nest-lab/or-guard';
import { ApiKeyGuard } from '../../api-key/api-key.guard';
import { WorkspaceMemberGuard } from '../../workspace/workspace.guard';
import { CompletionBatchService } from './batch-service';
import {
  ApiExtraModels,
  ApiInternalServerErrorResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import {
  ApiEnvironmentIdParam,
  ApiIncludesUsersQuery,
  ApiWorkspaceIdParam,
  EnvironmentIdParam,
  IncludesUsersQuery,
  WorkspaceIdParam,
} from '../../common/api.decorators';
import { CompletionBatchDto } from './dto/batch.dto';
import {
  CreateCompletionBatchDto,
  CreateCompletionCallbackBatchDto,
} from './dto/create-batch.dto';
import { throwServiceError } from '../../error';
import { ErrorCode } from '../../error-code';
import { CompletionBatchQueueService } from './batch-queue.service';
import { PublicCompletionBatchRequestType } from '../../storage/entities.generated';
import type { FastifyReply } from 'fastify';
import { CompletionBatchItemEntity } from './entity/batch-item.entity';
import { CompletionBatchItemService } from './batch-item-service';
import { CapacityPeriod } from '../../capacity/capacity.entity';
import { ServiceError } from '../../types';
import { RoleGuard } from '../../role/role.guard';
import { COMPLETION_BATCH_BASE_RESOURCE, CompletionBatchActions } from './permissions/actions';

export function ApiBatchIdParam() {
  return applyDecorators(
    ApiParam({
      name: 'batchId',
      type: 'uuid',
      required: true,
      description: 'The ID of the batch',
    })
  );
}

export function BatchIdParam() {
  return Param('batchId', new ParseUUIDPipe({ version: '4' }));
}

@Controller('completion-batch')
@ApiTags('Completion Batch')
@ApiExtraModels(CreateCompletionBatchDto, CreateCompletionCallbackBatchDto)
@IgnoreGlobalGuard()
@UseGuards(
  OrGuard([AppGuard, ApiKeyGuard], {
    throwLastError: true,
  }),
  WorkspaceMemberGuard()
)
@ApiInternalServerErrorResponse({
  type: ServiceError,
  description: 'Server Error',
})
export class CompletionBatchController {
  constructor(
    private readonly completionBatchService: CompletionBatchService,
    private readonly completionBatchItemService: CompletionBatchItemService,
    private readonly completionBatchQueueService: CompletionBatchQueueService
  ) {}

  @ApiOperation({
    operationId: 'getCompletionBatch',
    summary: 'Get a completion batch',
    description: 'Get a completion batch by its ID',
  })
  @UseGuards(
    RoleGuard(
      CompletionBatchActions.GET,
      COMPLETION_BATCH_BASE_RESOURCE
    )
  )
  @ApiOkResponse({
    type: CompletionBatchDto,
    description: 'Get a completion batch by its ID',
  })
  @ApiWorkspaceIdParam()
  @ApiEnvironmentIdParam()
  @ApiBatchIdParam()
  @ApiIncludesUsersQuery()
  @ApiQuery({
    name: 'includesItems',
    type: Boolean,
    required: false,
    description: 'Whether to include items in the response',
  })
  @Get(':workspaceId/:environmentId/:batchId')
  public async getCompletionBatch(
    @WorkspaceIdParam() workspaceId: string,
    @EnvironmentIdParam() environmentId: string,
    @BatchIdParam() batchId: string,
    @IncludesUsersQuery()
    includesUsers: boolean,
    @Query(
      'includesItems',
      new DefaultValuePipe(true),
      new ParseBoolPipe({ optional: true })
    )
    includesItems: boolean
  ): Promise<CompletionBatchDto> {
    return await this.completionBatchService.getById({
      workspaceId,
      environmentId,
      batchId,
      includesUsers,
      includesItems,
    });
  }

  @ApiOperation({
    operationId: 'getCompletionBatchItem',
    summary: 'Get a completion batch item',
    description: 'Get a completion batch item by its ID',
  })
  @UseGuards(
    RoleGuard(
      CompletionBatchActions.GET,
      COMPLETION_BATCH_BASE_RESOURCE
    )
  )
  @ApiOkResponse({
    type: CompletionBatchItemEntity,
    description: 'Get a completion batch item by its ID',
  })
  @ApiWorkspaceIdParam()
  @ApiEnvironmentIdParam()
  @ApiBatchIdParam()
  @ApiParam({
    name: 'itemId',
    type: 'uuid',
    required: true,
    description: 'The ID of the batch item',
  })
  @Get(':workspaceId/:environmentId/:batchId/:itemId')
  public async getCompletionBatchItem(
    @WorkspaceIdParam() workspaceId: string,
    @EnvironmentIdParam() environmentId: string,
    @BatchIdParam() batchId: string,
    @Param('batchId', new ParseUUIDPipe({ version: '4' })) itemId: string
  ): Promise<CompletionBatchItemEntity> {
    return await this.completionBatchItemService.getById({
      workspaceId,
      environmentId,
      batchId,
      itemId,
    });
  }

  @ApiOperation({
    operationId: 'createCompletionBatch',
    summary: 'Create a completion batch',
    description: 'Create a completion batch',
    requestBody: {
      content: {
        'application/json': {
          schema: {
            oneOf: [
              {
                $ref: getSchemaPath(CreateCompletionBatchDto),
              },
              {
                $ref: getSchemaPath(CreateCompletionCallbackBatchDto),
              },
            ],
          },
          examples: {
            'Completion Batch Example': {
              summary: 'Completion Batch Example',
              description: 'A completion batch request',
              value: {
                type: PublicCompletionBatchRequestType.SYNC,
                capacity: [
                  {
                    period: CapacityPeriod.MINUTE,
                    requests: 100,
                    tokens: 1000,
                    enabled: true,
                  },
                ],
                items: [
                  {
                    resource: 'openai',
                    request: {
                      messages: [
                        {
                          role: 'user',
                          content: 'Tell me a joke.',
                        },
                      ],
                    },
                  },
                  {
                    resource: 'openai',
                    request: {
                      messages: [
                        {
                          role: 'user',
                          content: 'Tell me a fun fact about the moon.',
                        },
                      ],
                    },
                  },
                ],
              },
            },
          },
        },
      },
    },
  })
  @UseGuards(
    RoleGuard(
      CompletionBatchActions.CREATE,
      COMPLETION_BATCH_BASE_RESOURCE
    )
  )
  @ApiOkResponse({
    type: CompletionBatchDto,
    description: 'Create a completion batch',
  })
  @ApiWorkspaceIdParam()
  @ApiEnvironmentIdParam()
  @Post(':workspaceId/:environmentId')
  public async createCompletionBatch(
    @WorkspaceIdParam() workspaceId: string,
    @EnvironmentIdParam() environmentId: string,
    @Body()
    payload: CreateCompletionBatchDto | CreateCompletionCallbackBatchDto,
    @AuthContext() authContext: AuthContext,
    @Res() res: FastifyReply
  ) {
    if (authContext.apiKey) {
      const unauthorizedResources = payload.items.filter(
        (item) => !authContext.apiKey?.resources.includes(item.resourceId)
      );

      if (unauthorizedResources.length > 0) {
        throwServiceError(
          HttpStatus.FORBIDDEN,
          ErrorCode.API_KEY_RESOURCE_NOT_AUTHORIZED,
          {
            resource: unauthorizedResources
              .map((item) => item.resourceId)
              .join(', '),
          }
        );
      }
    }

    const batch = await this.completionBatchService.create(
      workspaceId,
      environmentId,
      payload,
      authContext
    );

    if (payload.type === PublicCompletionBatchRequestType.SYNC) {
      res.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      try {
        for await (const event of this.completionBatchQueueService.listenToBatchEvents(
          workspaceId,
          environmentId,
          batch.batchId
        )) {
          res.raw.write(`data: ${JSON.stringify(event)}\n\n`);
        }

        res.raw.write('data: [DONE]\n\n');
      } catch (error) {
        res.raw.write(`data: ${JSON.stringify({ error })}\n\n`);
        res.raw.write('data: [ERROR]\n\n');
      } finally {
        res.raw.end();
      }
    } else {
      res.send(batch).status(200);
    }
  }

  @ApiOperation({
    operationId: 'cancelCompletionBatch',
    summary: 'Cancel a completion batch',
    description: 'Cancel a completion batch by its ID',
  })
  @UseGuards(
    RoleGuard(
      CompletionBatchActions.CANCEL,
      COMPLETION_BATCH_BASE_RESOURCE
    )
  )
  @ApiOkResponse({
    type: Object,
    description: 'Cancel a completion batch by its ID',
  })
  @ApiWorkspaceIdParam()
  @ApiEnvironmentIdParam()
  @ApiBatchIdParam()
  @Post(':workspaceId/:environmentId/:batchId/cancel')
  public async cancelCompletionBatch(
    @WorkspaceIdParam() workspaceId: string,
    @EnvironmentIdParam() environmentId: string,
    @BatchIdParam() batchId: string
  ): Promise<void> {
    await this.completionBatchService.cancel(
      workspaceId,
      environmentId,
      batchId
    );
  }
}
