import {
  Body,
  Controller,
  HttpException,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ApiOperation } from '@nestjs/swagger';
import { OrGuard } from '@nest-lab/or-guard';
import { AnthropicMessagesService } from './anthropic.service';
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
import {
  formatAnthropicErrorFrame,
  formatAnthropicPingFrame,
  formatAnthropicSseFrame,
} from './sse-frame';
import { RoleGuard } from '../../role/role.guard';
import {
  COMPLETION_BASE_RESOURCE,
  CompletionActions,
} from '../permissions/actions';
import type { AnthropicMessagesRequest } from './anthropic.types';
import { AnthropicMessagesRequestDto } from './anthropic-request.dto';

/**
 * Anthropic Messages API endpoint. Symmetric with `CompletionController`
 * (OpenAI Chat Completions) and `ResponsesController` (OpenAI Responses) —
 * each input format gets its own controller under `gateway/<format>/`.
 *
 * Currently delegates to the shared `CompletionService.complete()` with
 * a tagged GatewayRequest envelope; the per-format service split (an
 * `AnthropicMessagesService` that owns the dispatch end-to-end) is a
 * Phase E follow-up.
 */
@Controller('completion')
@IgnoreGlobalGuard()
@UseGuards(
  OrGuard([AppGuard, ApiKeyGuard], {
    throwLastError: true,
  }),
  WorkspaceMemberGuard()
)
export class AnthropicController {
  constructor(
    private readonly anthropicMessagesService: AnthropicMessagesService
  ) {}

  @ApiOperation({
    operationId: 'anthropicMessages',
    summary: 'Anthropic-compatible Messages',
    description:
      'Accepts Anthropic Messages API requests, runs through the same gateway as /chat/completions, and returns Anthropic-shaped responses.',
  })
  @UseGuards(RoleGuard(CompletionActions.EXECUTE, COMPLETION_BASE_RESOURCE))
  @ApiWorkspaceIdParam()
  @ApiEnvironmentIdParam()
  @Post(':workspaceId/:environmentId/anthropic/messages')
  public async anthropicMessages(
    @WorkspaceIdParam() workspaceId: string,
    @EnvironmentIdParam() environmentId: string,
    @Body(new ValidationPipe({ transform: true, whitelist: false }))
    validated: AnthropicMessagesRequestDto,
    @Req() request: FastifyRequest,
    @Res() res: FastifyReply,
    @ApiKey() apiKey?: ApiKeyEntity
  ) {
    // The DTO validates `model` / `max_tokens` / `messages` shape only;
    // deeper structural mapping lives in the converter. Re-cast to the
    // broader `AnthropicMessagesRequest` so the converter sees its
    // expected input type.
    const body = validated as unknown as AnthropicMessagesRequest;
    let sseStarted = false;
    let streamComplete = false;
    const abortController = new AbortController();
    const onClientClose = () => {
      if (!streamComplete) abortController.abort();
    };
    res.raw.on('close', onClientClose);

    try {
      const result = await this.anthropicMessagesService.send(
        workspaceId,
        environmentId,
        body,
        apiKey,
        request,
        undefined,
        abortController.signal
      );

      if (isAsyncIterable(result.data)) {
        // Anthropic SSE format: every typed event ships as
        // `event: <type>\ndata: <json>\n\n`. The Anthropic SDK's
        // `MessageStream` parser routes by `event:` line — without it
        // strict consumers misroute chunks even when the JSON content
        // is correct. We also interleave a synthetic `ping` between
        // content blocks so consumers don't time out waiting on long
        // tool calls. (T3)
        res.raw.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          ...result.headers,
        });
        sseStarted = true;
        let lastPingAt = Date.now();
        for await (const chunk of result.data) {
          res.raw.write(formatAnthropicSseFrame(chunk));
          // Heartbeat ping every ~10s of stream silence.
          if (Date.now() - lastPingAt > 10_000) {
            res.raw.write(formatAnthropicPingFrame());
            lastPingAt = Date.now();
          }
        }
        // No trailing `[DONE]` — Anthropic's SSE protocol ends
        // silently on `message_stop`. Add it only when no typed
        // `message_stop` was emitted (e.g. a non-Anthropic provider
        // forwarding through this path).
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

  // Alias for the Anthropic SDK, which auto-appends `/v1/messages` to
  // its configured `base_url`. Without this, callers pointing the SDK
  // at `…/anthropic` land on `…/anthropic/v1/messages` and miss the
  // primary route. Delegates to the same handler.
  @ApiOperation({
    operationId: 'anthropicMessagesV1Alias',
    summary: 'Anthropic Messages (SDK alias)',
    description:
      "Alias for the Anthropic SDK's auto-appended /v1/messages path. Behavior is identical to /anthropic/messages.",
  })
  @UseGuards(RoleGuard(CompletionActions.EXECUTE, COMPLETION_BASE_RESOURCE))
  @ApiWorkspaceIdParam()
  @ApiEnvironmentIdParam()
  @Post(':workspaceId/:environmentId/anthropic/v1/messages')
  public anthropicMessagesV1Alias(
    @WorkspaceIdParam() workspaceId: string,
    @EnvironmentIdParam() environmentId: string,
    @Body(new ValidationPipe({ transform: true, whitelist: false }))
    validated: AnthropicMessagesRequestDto,
    @Req() request: FastifyRequest,
    @Res() res: FastifyReply,
    @ApiKey() apiKey?: ApiKeyEntity
  ) {
    return this.anthropicMessages(
      workspaceId,
      environmentId,
      validated,
      request,
      res,
      apiKey
    );
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
      res.raw.write(formatAnthropicErrorFrame(errorResponse));
      res.raw.end();
    } else {
      res.status(statusCode).headers(headers).send(errorResponse);
    }
  }
}
