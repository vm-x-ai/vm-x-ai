import { describe, expect, it, vi } from 'vitest';
import { ResourceRoutingService } from '../../gateway/routing.service';
import {
  RoutingMode,
  RoutingAction,
} from '../../ai-resource/common/routing.entity';
import type { CompletionMetricsService } from '../../gateway/metrics/metrics.service';
import type { PinoLogger } from 'nestjs-pino';
import type { AIResourceEntity } from '../../ai-resource/entities/ai-resource.entity';

/**
 * `RoutingContext` regression: routing rules can branch on
 * `request.format` and read `request.nativeBody` for fields the
 * canonical Responses-shape conversion drops. Existing templates that
 * read `request.messages` keep working — the variable is derived from
 * `request.input` + `request.instructions`.
 */

const stubLogger = {
  info: () => undefined,
  debug: () => undefined,
  warn: () => undefined,
  error: () => undefined,
} as unknown as PinoLogger;

const stubMetrics = {
  getErrorRate: vi.fn().mockResolvedValue({ errorRate: 0 }),
} as unknown as CompletionMetricsService;

const makeResource = (
  expression: string,
  thenModel = 'routed-model'
): AIResourceEntity =>
  ({
    resourceId: 'res-1',
    workspaceId: 'ws',
    environmentId: 'env',
    name: 'r',
    description: null,
    model: { provider: 'openai', model: 'default-model', connectionId: 'c' },
    fallbackModels: [],
    secondaryModels: [],
    routing: {
      enabled: true,
      conditions: [
        {
          enabled: true,
          mode: RoutingMode.ADVANCED,
          expression,
          action: RoutingAction.CALL_MODEL,
          description: 'test',
          then: {
            provider: 'anthropic',
            model: thenModel,
            connectionId: 'c',
          },
        } as never,
      ],
    } as never,
    capacity: [],
    useFallback: false,
    enforceCapacity: false,
  } as unknown as AIResourceEntity);

describe('RoutingContext: format + nativeBody surface', () => {
  const service = new ResourceRoutingService(stubLogger, stubMetrics);

  it('exposes `request.format` so templates can branch on input format', async () => {
    const result = await service.evaluateRoutingConditions(
      'ws',
      'env',
      {
        format: 'anthropic',
        responses: {
          model: 'm',
          input: 'hi',
        } as never,
        native: {
          model: 'claude',
          max_tokens: 16,
          messages: [{ role: 'user', content: 'hi' }],
          thinking: { type: 'enabled', budget_tokens: 1024 },
        } as never,
      },
      10,
      makeResource("<%= request.format === 'anthropic' ? 'true' : '' %>")
    );
    expect(result?.model.model).toBe('routed-model');
  });

  it('exposes `request.nativeBody` so templates can read fields canonical conversion drops', async () => {
    // Anthropic `thinking` budget rides on `__vmx_passthrough.anthropic`
    // after canonical conversion; templates that want fine-grained
    // control can still read the original via `request.nativeBody`.
    const result = await service.evaluateRoutingConditions(
      'ws',
      'env',
      {
        format: 'anthropic',
        responses: {
          model: 'm',
          input: 'hi',
        } as never,
        native: {
          model: 'claude',
          max_tokens: 16,
          messages: [{ role: 'user', content: 'hi' }],
          thinking: { type: 'enabled', budget_tokens: 4096 },
        } as never,
      },
      10,
      makeResource(
        "<%= request.nativeBody.thinking?.budget_tokens > 2000 ? 'true' : '' %>"
      )
    );
    expect(result?.model.model).toBe('routed-model');
  });

  it('derives `request.messages` from Responses `instructions` + `input`', async () => {
    const result = await service.evaluateRoutingConditions(
      'ws',
      'env',
      {
        format: 'responses',
        responses: {
          model: 'm',
          input: 'route me',
        } as never,
        native: {
          model: 'm',
          input: 'route me',
        } as never,
      },
      10,
      makeResource(
        "<%= request.messages[0].content === 'route me' ? 'true' : '' %>"
      )
    );
    expect(result?.model.model).toBe('routed-model');
  });

  it('derived `request.firstMessage`, `request.lastMessage`, `request.messagesCount` work for multi-turn input', async () => {
    const result = await service.evaluateRoutingConditions(
      'ws',
      'env',
      {
        format: 'responses',
        responses: {
          model: 'm',
          instructions: 'be terse',
          input: [
            {
              type: 'message',
              role: 'user',
              content: [{ type: 'input_text', text: 'first' }],
            },
            {
              type: 'message',
              role: 'assistant',
              content: [{ type: 'output_text', text: 'middle' }],
            },
            {
              type: 'message',
              role: 'user',
              content: [{ type: 'input_text', text: 'last' }],
            },
          ],
        } as never,
        native: {} as never,
      },
      10,
      makeResource(
        "<%= request.firstMessage.role === 'system' && request.lastMessage.content === 'last' && request.messagesCount === 4 ? 'true' : '' %>"
      )
    );
    expect(result?.model.model).toBe('routed-model');
  });
});
