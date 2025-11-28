import {
  ArgumentMetadata,
  Body,
  Controller,
  HttpException,
  HttpStatus,
  PipeTransform,
  Post,
  Req,
  Res,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { CompletionService } from './completion.service';
import {
  ApiEnvironmentIdParam,
  ApiWorkspaceIdParam,
  EnvironmentIdParam,
  WorkspaceIdParam,
} from '../common/api.decorators';
import { AppGuard, IgnoreGlobalGuard } from '../auth/auth.guard';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ApiOperation } from '@nestjs/swagger';
import { CompletionError } from './completion.types';
import { ServiceError } from '../types';
import { CompletionHeaders } from '../ai-provider/ai-provider.types';
import { ApiKey, ApiKeyGuard } from '../api-key/api-key.guard';
import { OrGuard } from '@nest-lab/or-guard';
import {
  CompletionRequestPayloadDto,
  type CompletionRequestDto,
} from './dto/completion-request.dto';
import { ApiKeyEntity } from '../api-key/entities/api-key.entity';
import { WorkspaceMemberGuard } from '../workspace/workspace.guard';
import { isAsyncIterable } from '../utils/async';
import { RoleGuard } from '../role/role.guard';
import { COMPLETION_BASE_RESOURCE, CompletionActions } from './permissions/actions';

const transformPipe = new ValidationPipe({
  transform: true,
});

@Controller('completion')
@IgnoreGlobalGuard()
@UseGuards(
  OrGuard([AppGuard, ApiKeyGuard], {
    throwLastError: true,
  }),
  WorkspaceMemberGuard()
)
export class CompletionController {
  constructor(private readonly completionService: CompletionService) {}

  @ApiOperation({
    operationId: 'completion',
    summary: 'LLM Completion',
    description: 'Performs a completion request to the LLM API.',
    requestBody: {
      content: {
        'application/json': {
          schema: {
            type: 'object',
          },
          examples: {
            'openai-hello-world': {
              summary: 'OpenAI Chat Completion Example',
              description:
                'This payload expects the same payload request as the Node.js OpenAI SDK.',
              value: {
                messages: [
                  {
                    role: 'user',
                    content:
                      'Write a one-sentence bedtime story about a unicorn.',
                  },
                ],
              },
            },
          },
        },
      },
    },
  })
  @UseGuards(RoleGuard(CompletionActions.EXECUTE, COMPLETION_BASE_RESOURCE))
  @ApiWorkspaceIdParam()
  @ApiEnvironmentIdParam()
  @Post(':workspaceId/:environmentId/chat/completions')
  public async completion(
    @WorkspaceIdParam() workspaceId: string,
    @EnvironmentIdParam() environmentId: string,
    @Body(
      new (class implements PipeTransform {
        async transform(value: unknown, metadata: ArgumentMetadata) {
          await transformPipe.transform(value, {
            ...metadata,
            metatype: CompletionRequestPayloadDto,
          });
          return value;
        }
      })()
    )
    payload: CompletionRequestDto,
    @Req() request: FastifyRequest,
    @Res() res: FastifyReply,
    @ApiKey() apiKey?: ApiKeyEntity
  ) {
    let sseStarted = false;
    try {
      const response = await this.completionService.completion(
        workspaceId,
        environmentId,
        payload,
        apiKey,
        request
      );

      if (isAsyncIterable(response.data)) {
        res.raw.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          ...response.headers,
        });
        sseStarted = true;
        for await (const chunk of response.data) {
          res.raw.write(`data: ${JSON.stringify(chunk)}\n\n`);
        }

        res.raw.write('data: [DONE]\n\n');
        res.raw.end();
      } else {
        res.status(200).headers(response.headers).send(response.data);
      }
    } catch (err) {
      return this.handleError(err, sseStarted, res);
    }
  }

  private handleError(err: unknown, sseStarted: boolean, res: FastifyReply) {
    let errorResponse: Record<string, unknown> = {};
    let statusCode: HttpStatus = 500;
    let headers: CompletionHeaders = {};

    if (err instanceof CompletionError) {
      statusCode = err.data.statusCode;
      errorResponse = {
        error: {
          message: err.message,
          ...err.data.openAICompatibleError,
        },
      };
      headers = err.data.headers ?? {};
    } else if (err instanceof HttpException) {
      statusCode = err.getStatus();
      const errorData = err.getResponse();

      if (errorData instanceof ServiceError) {
        errorResponse = {
          error: {
            message: errorData.errorMessage,
            code: errorData.errorCode,
          },
        };
      } else {
        errorResponse = {
          error: {
            message: err.message,
          },
        };
      }
    } else if (err instanceof Error) {
      statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
      errorResponse = {
        error: {
          message: err.message,
          code: 'unknown_error',
        },
      };
    } else {
      statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
      errorResponse = {
        error: {
          message: 'Unknown error',
          code: 'unknown_error',
        },
      };
    }

    if (sseStarted) {
      res.raw.write(`data: ${JSON.stringify(errorResponse)}\n\n`);
      res.raw.write('data: [ERROR]\n\n');
      res.raw.end();
    } else {
      res.status(statusCode).headers(headers).send(errorResponse);
    }
  }
}
