import {
  Body,
  Controller,
  HttpException,
  HttpStatus,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { CompletionService } from './completion.service';
import {
  ApiEnvironmentIdParam,
  ApiWorkspaceIdParam,
  EnvironmentIdParam,
  WorkspaceIdParam,
} from '../common/api.decorators';
import {
  AppGuard,
  AuthenticatedUser,
  IgnoreGlobalGuard,
} from '../auth/auth.guard';
import { UserEntity } from '../users/entities/user.entity';
import {
  AIResourceIdParam,
  ApiAIResourceIdParam,
} from '../ai-resource/ai-resource.controller';
import type { FastifyReply } from 'fastify';
import { firstValueFrom } from 'rxjs';
import { ApiOperation } from '@nestjs/swagger';
import * as resources from 'openai/resources/index.js';
import { CompletionError } from './completion.types';
import { ServiceError } from '../types';
import { CompletionHeaders } from '../ai-provider/ai-provider.types';
import { ApiKeyGuard } from '../api-key/api-key.guard';
import { OrGuard } from '@nest-lab/or-guard';

@Controller('completions')
@IgnoreGlobalGuard()
@UseGuards(
  OrGuard([AppGuard, ApiKeyGuard], {
    throwLastError: true,
  })
)
export class CompletionController {
  constructor(private readonly completionService: CompletionService) {}

  @ApiOperation({
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
  @ApiWorkspaceIdParam()
  @ApiEnvironmentIdParam()
  @ApiAIResourceIdParam()
  @Post(':workspaceId/:environmentId/:resource')
  public async completion(
    @WorkspaceIdParam() workspaceId: string,
    @EnvironmentIdParam() environmentId: string,
    @AIResourceIdParam() resource: string,
    @Body() payload: resources.ChatCompletionCreateParams,
    @Res() res: FastifyReply,
    @AuthenticatedUser() user?: UserEntity
  ) {
    const observable = this.completionService.completion(
      workspaceId,
      environmentId,
      resource,
      payload,
      user
    );

    let index = 0;
    let sseStarted = false;
    if (payload.stream) {
      observable.subscribe({
        next: ({ data: chunk, headers }) => {
          if (index === 0) {
            res.raw.writeHead(200, {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              Connection: 'keep-alive',
              ...headers,
            });
            sseStarted = true;
          }

          index++;
          res.raw.write(`data: ${JSON.stringify(chunk)}\n\n`);
        },
        complete: () => {
          res.raw.write('data: [DONE]\n\n');
          res.raw.end();
        },
        error: (err) => {
          this.handleError(err, sseStarted, res);
        },
      });
    } else {
      try {
        const result = await firstValueFrom(observable);
        res.status(200).headers(result.headers).send(result.data);
      } catch (err) {
        this.handleError(err, sseStarted, res);
      }
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
