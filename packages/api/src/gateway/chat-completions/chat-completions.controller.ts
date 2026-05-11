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
import { ChatCompletionsService } from './chat-completions.service';
import {
  ApiEnvironmentIdParam,
  ApiWorkspaceIdParam,
  EnvironmentIdParam,
  WorkspaceIdParam,
} from '../../common/api.decorators';
import { AppGuard, IgnoreGlobalGuard } from '../../auth/auth.guard';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ApiOperation } from '@nestjs/swagger';
import { CompletionError } from '../completion.types';
import { ServiceError } from '../../types';
import { CompletionHeaders } from '../../ai-provider/ai-provider.types';
import { ApiKey, ApiKeyGuard } from '../../api-key/api-key.guard';
import { OrGuard } from '@nest-lab/or-guard';
import {
  CompletionRequestPayloadDto,
  type CompletionRequestDto,
} from '../dto/completion-request.dto';
import { ApiKeyEntity } from '../../api-key/entities/api-key.entity';
import { WorkspaceMemberGuard } from '../../workspace/workspace.guard';
import { isAsyncIterable } from '../../utils/async';
import { RoleGuard } from '../../role/role.guard';
import {
  COMPLETION_BASE_RESOURCE,
  CompletionActions,
} from '../permissions/actions';

const transformPipe = new ValidationPipe({
  transform: true,
});

/**
 * `/chat/completions` endpoint — OpenAI Chat Completions input format.
 *
 * Thin controller: validates the inbound body, hands it off to
 * `ChatCompletionsService`, then serializes the orchestrator's response
 * back to the wire (non-streaming JSON or `text/event-stream`). All
 * VM-X logic (routing, gating, fallback, audit, cost) lives behind the
 * shared `GatewayOrchestratorService` that the per-format service
 * delegates to — same pattern the `/responses` and `/anthropic/messages`
 * controllers follow.
 */
@Controller('completion')
@IgnoreGlobalGuard()
@UseGuards(
  OrGuard([AppGuard, ApiKeyGuard], {
    throwLastError: true,
  }),
  WorkspaceMemberGuard()
)
export class ChatCompletionsController {
  constructor(
    private readonly chatCompletionsService: ChatCompletionsService
  ) {}

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
    let streamComplete = false;
    // Bridge a client disconnect (page nav, browser close, fetch
    // AbortController on the BFF) into an AbortController so the
    // upstream provider call gets cancelled. The `streamComplete`
    // flag avoids self-aborting after we've finished writing —
    // Fastify's `res.raw` `close` event fires for both
    // client-disconnect AND server-finished, so we gate accordingly.
    const abortController = new AbortController();
    const onClientClose = () => {
      if (!streamComplete) abortController.abort();
    };
    res.raw.on('close', onClientClose);

    try {
      const result = await this.chatCompletionsService.complete(
        workspaceId,
        environmentId,
        payload,
        apiKey,
        request,
        undefined,
        abortController.signal
      );

      if (isAsyncIterable(result.data)) {
        res.raw.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          ...result.headers,
        });
        sseStarted = true;
        for await (const chunk of result.data) {
          res.raw.write(`data: ${JSON.stringify(chunk)}\n\n`);
        }

        res.raw.write('data: [DONE]\n\n');
        streamComplete = true;
        res.raw.end();
      } else {
        streamComplete = true;
        res.status(200).headers(result.headers).send(result.data);
      }
    } catch (err) {
      return this.handleError(err, sseStarted, res);
    } finally {
      res.raw.off('close', onClientClose);
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
