import { Body, Controller, Post, Res } from '@nestjs/common';
import { CompletionService } from './completion.service';
import {
  ApiEnvironmentIdParam,
  ApiWorkspaceIdParam,
  EnvironmentIdParam,
  WorkspaceIdParam,
} from '../common/api.decorators';
import { AuthenticatedUser } from '../auth/auth.guard';
import { UserEntity } from '../users/entities/user.entity';
import {
  AIResourceIdParam,
  ApiAIResourceIdParam,
} from '../ai-resource/ai-resource.controller';
import type { FastifyReply } from 'fastify';
import { firstValueFrom } from 'rxjs';
import { ApiOperation } from '@nestjs/swagger';
import * as resources from 'openai/resources/index.js';

@Controller('completions')
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
    @AuthenticatedUser() user: UserEntity,
    @Body() payload: resources.ChatCompletionCreateParams,
    @Res() res: FastifyReply
  ) {
    const observable = this.completionService.completion(
      workspaceId,
      environmentId,
      resource,
      user,
      payload
    );

    let index = 0;
    let sseStarted = false;
    if (payload.stream) {
      observable.subscribe({
        next: (chunk) => {
          if (index === 0) {
            res.raw.writeHead(200, {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              Connection: 'keep-alive',
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
        console.log('result', result);
        res.status(200).send(result);
      } catch (err) {
        this.handleError(err, sseStarted, res);
      }
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handleError(err: any, sseStarted: boolean, res: FastifyReply) {
    const errorResponse = {
      error: {
        message: err.details,
      },
    };
    if (sseStarted) {
      res.raw.write(`data: ${JSON.stringify(errorResponse)}\n\n`);
      res.raw.write('data: [ERROR]\n\n');
      res.raw.end();
    } else {
      res.status(500).send(errorResponse);
    }
  }
}
