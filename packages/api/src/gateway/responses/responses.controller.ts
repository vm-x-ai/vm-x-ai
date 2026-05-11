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
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ApiOperation } from '@nestjs/swagger';
import { OrGuard } from '@nest-lab/or-guard';
import {
  ApiEnvironmentIdParam,
  ApiWorkspaceIdParam,
  EnvironmentIdParam,
  WorkspaceIdParam,
} from '../../common/api.decorators';
import { AppGuard, IgnoreGlobalGuard } from '../../auth/auth.guard';
import { CompletionError } from '../completion.types';
import { ServiceError } from '../../types';
import { CompletionHeaders } from '../../ai-provider/ai-provider.types';
import { ApiKey, ApiKeyGuard } from '../../api-key/api-key.guard';
import { ApiKeyEntity } from '../../api-key/entities/api-key.entity';
import { WorkspaceMemberGuard } from '../../workspace/workspace.guard';
import { isAsyncIterable } from '../../utils/async';
import { RoleGuard } from '../../role/role.guard';
import {
  COMPLETION_BASE_RESOURCE,
  CompletionActions,
} from '../permissions/actions';
import { ResponsesService } from './responses.service';
import { ResponsesRequestDto } from './dto/responses-request.dto';

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
export class ResponsesController {
  constructor(private readonly responsesService: ResponsesService) {}

  @ApiOperation({
    operationId: 'responses',
    summary: 'OpenAI Responses API',
    description:
      "Performs a Responses-API request against the routed AI Resource. Mirrors OpenAI's POST /v1/responses surface; streamed responses are emitted as Server-Sent Events using Responses-API event types (response.output_text.delta, response.function_call_arguments.delta, response.completed, etc).",
  })
  @UseGuards(RoleGuard(CompletionActions.EXECUTE, COMPLETION_BASE_RESOURCE))
  @ApiWorkspaceIdParam()
  @ApiEnvironmentIdParam()
  @Post(':workspaceId/:environmentId/responses')
  public async responses(
    @WorkspaceIdParam() workspaceId: string,
    @EnvironmentIdParam() environmentId: string,
    @Body(
      new (class implements PipeTransform {
        async transform(value: unknown, metadata: ArgumentMetadata) {
          await transformPipe.transform(value, {
            ...metadata,
            metatype: ResponsesRequestDto,
          });
          return value;
        }
      })()
    )
    payload: ResponsesRequestDto,
    @Req() request: FastifyRequest,
    @Res() res: FastifyReply,
    @ApiKey() apiKey?: ApiKeyEntity
  ) {
    let sseStarted = false;
    let streamComplete = false;
    // Bridge a client disconnect into an AbortController so the
    // upstream provider call gets cancelled (instead of churning out
    // tokens nobody's listening to). Fastify's `res.raw` (Node
    // ServerResponse) emits `close` when the underlying socket
    // terminates — for both client-disconnect AND server-finished, so
    // we gate the abort on the `streamComplete` flag set right
    // before our `res.raw.end()`.
    const abortController = new AbortController();
    const onClientClose = () => {
      if (!streamComplete) abortController.abort();
    };
    res.raw.on('close', onClientClose);

    try {
      const result = await this.responsesService.respond(
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
        for await (const event of result.data) {
          // Responses API emits typed SSE events: include `event:` line so
          // clients that subscribe by event name (EventSource etc.) see them.
          // Sanitize the event name — even though it's emitted by our own
          // converter, defense-in-depth strips any CR/LF that would let
          // a malformed/malicious type field inject extra SSE frames or
          // headers into the response stream.
          const rawType = (event as { type?: string }).type ?? 'message';
          const eventType = rawType.replace(/[\r\n]/g, '');
          res.raw.write(`event: ${eventType}\n`);
          res.raw.write(`data: ${JSON.stringify(event)}\n\n`);
        }
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
      res.raw.write(`event: error\n`);
      res.raw.write(`data: ${JSON.stringify(errorResponse)}\n\n`);
      res.raw.end();
    } else {
      res.status(statusCode).headers(headers).send(errorResponse);
    }
  }
}
