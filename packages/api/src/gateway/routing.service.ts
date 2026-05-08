import { HttpStatus, Injectable } from '@nestjs/common';
import ejs from 'ejs';
import objectAccessor from 'lodash.get';
import type {
  ResponseCreateParams,
  ResponseInputItem,
} from 'openai/resources/responses/responses.js';
import { AIResourceEntity } from '../ai-resource/entities/ai-resource.entity';
import { AIResourceModelConfigEntity } from '../ai-resource/common/model.entity';
import {
  AIResourceRoutingCondition,
  AIResourceRoutingConditionValue,
  AIRoutingConditionGroup,
  RoutingAction,
  RoutingComparator,
  RoutingConditionType,
  RoutingMode,
  RoutingOperator,
} from '../ai-resource/common/routing.entity';
import { PinoLogger } from 'nestjs-pino';
import { CompletionError } from './completion.types';
import { CompletionMetricsService } from './metrics/metrics.service';
import type { RoutingContext } from './routing.context';

@Injectable()
export class ResourceRoutingService {
  constructor(
    private readonly logger: PinoLogger,
    private readonly completionMetricsService: CompletionMetricsService
  ) {}

  /**
   * Evaluate the resource's routing rules against the canonical
   * Responses-shape request. Returns the matched route (model + group)
   * or null when no rule fires.
   *
   * Templates expose the Responses body directly via the spread `request`
   * variable plus a small set of derived convenience variables for
   * common patterns (first/last message text, tool count, etc.).
   */
  public async evaluateRoutingConditions(
    workspaceId: string,
    environmentId: string,
    context: RoutingContext,
    requestTokens: number,
    resourceConfig: AIResourceEntity
  ): Promise<{
    model: AIResourceModelConfigEntity;
    matchedRoute: AIRoutingConditionGroup;
  } | null> {
    const request = context.responses;
    const startTime = Date.now();

    this.logger.info(
      {
        resourceId: resourceConfig.resourceId,
      },
      `Evaluating routing conditions for resource`
    );
    for (const conditionGroup of resourceConfig.routing?.conditions ?? []) {
      if (conditionGroup.enabled === false) {
        continue;
      }

      const view = deriveMessageView(request);
      const variables: Record<string, unknown> = {
        resource: resourceConfig,
        request: {
          ...request,
          // Derived convenience variables for common template patterns.
          // Defaulted to `undefined` (rather than the out-of-bounds
          // `messages[-1]` access that would otherwise blow up template
          // evaluation) when the request arrives empty.
          messages: view.messages,
          firstMessage: view.firstMessage,
          lastMessage: view.lastMessage,
          allMessagesContent: view.allMessagesContent,
          messagesCount: view.messages.length,
          toolsCount: request.tools?.length ?? 0,
          // Advanced surface — `format` lets templates branch on the
          // input shape the client sent, `nativeBody` exposes fields
          // the Responses canonical conversion drops (Anthropic
          // `cache_control`, Bedrock-Converse-only configs, etc.).
          format: context.format,
          nativeBody: context.native,
        },
        tokens: {
          input: requestTokens,
        },
        errorRate: async (
          window = 10,
          statusCode: 'any' | number = 'any',
          aiConnectionId?: string,
          model?: string
        ) => {
          const { errorRate } =
            await this.completionMetricsService.getErrorRate(
              workspaceId,
              environmentId,
              resourceConfig.resourceId,
              aiConnectionId || resourceConfig.model.connectionId || undefined,
              model || resourceConfig.model.model,
              window,
              statusCode
            );

          return errorRate;
        },
      };

      const match =
        conditionGroup.mode === RoutingMode.ADVANCED
          ? ejs.render(conditionGroup.expression ?? '', variables)
          : await this.recursiveEvaluateRoutingConditions(
              conditionGroup,
              variables
            );

      if (match) {
        this.logger.info(
          {
            conditionGroup,
            duration: Date.now() - startTime,
          },
          `Routing condition matched`
        );
        if (conditionGroup.action === RoutingAction.BLOCK) {
          throw new CompletionError({
            rate: false,
            message: `Request blocked by routing condition: ${conditionGroup.description}`,
            statusCode: HttpStatus.BAD_REQUEST,
            retryable: false,
            failureReason: 'Blocked by routing condition',
            openAICompatibleError: {
              code: 'blocked_by_routing_condition',
            },
          });
        }

        if (!conditionGroup.then.traffic) {
          return { model: conditionGroup.then, matchedRoute: conditionGroup };
        }

        if (Math.random() < conditionGroup.then.traffic / 100) {
          this.logger.info(
            {
              conditionGroup,
              duration: Date.now() - startTime,
            },
            `Routing condition traffic matched`
          );
          return { model: conditionGroup.then, matchedRoute: conditionGroup };
        }
      }
    }

    this.logger.info(
      {
        duration: Date.now() - startTime,
      },
      `No routing condition matched`
    );
    return null;
  }

  private async recursiveEvaluateRoutingConditions(
    group: Omit<AIRoutingConditionGroup, 'then' | 'action' | 'expression'>,
    variables: Record<string, unknown>
  ): Promise<boolean> {
    if (group.operator === RoutingOperator.AND) {
      for (const condition of group.conditions) {
        if ('conditions' in condition) {
          if (condition.enabled === false) {
            continue;
          }

          const match = await this.recursiveEvaluateRoutingConditions(
            condition,
            variables
          );
          if (!match) {
            return false;
          }
        } else {
          const match = await this.matchCondition(condition, variables);
          if (!match) {
            return false;
          }
        }
      }

      return true;
    } else if (group.operator === RoutingOperator.OR) {
      for (const condition of group.conditions) {
        if ('conditions' in condition) {
          if (condition.enabled === false) {
            continue;
          }

          const match = await this.recursiveEvaluateRoutingConditions(
            condition,
            variables
          );
          if (match) {
            return true;
          }
        } else {
          const match = await this.matchCondition(condition, variables);
          if (match) {
            return true;
          }
        }
      }
    }

    return false;
  }

  private async matchCondition(
    condition: AIResourceRoutingCondition,
    variables: Record<string, unknown>
  ): Promise<boolean> {
    const expressionValue = condition.expression.includes('<%')
      ? await ejs.render(condition.expression, variables, { async: true })
      : `${objectAccessor(variables, condition.expression)}`;

    const resolvedValue =
      condition.value.expression && condition.expression.includes('<%')
        ? await ejs.render(condition.value.expression, variables, {
            async: true,
          })
        : condition.value.expression;

    if (!resolvedValue) {
      return false;
    }

    const parsedValue = this.parseRoutingValue(condition.value, resolvedValue);
    if (condition.comparator === RoutingComparator.EQUAL) {
      return expressionValue === resolvedValue;
    } else if (condition.comparator === RoutingComparator.NOT_EQUAL) {
      return expressionValue !== resolvedValue;
    } else if (condition.comparator === RoutingComparator.CONTAINS) {
      return expressionValue.includes(resolvedValue);
    } else if (condition.comparator === RoutingComparator.NOT_CONTAINS) {
      return !expressionValue.includes(resolvedValue);
    } else if (condition.comparator === RoutingComparator.STARTS_WITH) {
      return expressionValue.startsWith(resolvedValue);
    } else if (condition.comparator === RoutingComparator.ENDS_WITH) {
      return expressionValue.endsWith(resolvedValue);
    } else if (condition.comparator === RoutingComparator.PATTERN) {
      return new RegExp(resolvedValue).test(expressionValue);
    } else if (condition.comparator === RoutingComparator.IN) {
      if (this.isStringArray(parsedValue)) {
        return parsedValue.includes(expressionValue);
      } else if (this.isObjectArray(parsedValue)) {
        return parsedValue.some(
          (value) => JSON.stringify(value) === expressionValue
        );
      }
      return false;
    } else if (condition.comparator === RoutingComparator.NOT_IN) {
      if (this.isStringArray(parsedValue)) {
        return !parsedValue.includes(expressionValue);
      } else if (this.isObjectArray(parsedValue)) {
        return !parsedValue.some(
          (value) => JSON.stringify(value) === expressionValue
        );
      }
    } else if (condition.comparator === RoutingComparator.GREATER_THAN) {
      if (this.isNumber(parsedValue)) {
        return parseFloat(expressionValue) > parsedValue;
      }

      return expressionValue > resolvedValue;
    } else if (
      condition.comparator === RoutingComparator.GREATER_THAN_OR_EQUAL
    ) {
      if (this.isNumber(parsedValue)) {
        return parseFloat(expressionValue) >= parsedValue;
      }

      return expressionValue >= resolvedValue;
    } else if (condition.comparator === RoutingComparator.LESS_THAN) {
      if (this.isNumber(parsedValue)) {
        return parseFloat(expressionValue) < parsedValue;
      }

      return expressionValue < resolvedValue;
    } else if (condition.comparator === RoutingComparator.LESS_THAN_OR_EQUAL) {
      if (this.isNumber(parsedValue)) {
        return parseFloat(expressionValue) <= parsedValue;
      }

      return expressionValue <= resolvedValue;
    } else if (condition.comparator === RoutingComparator.EXISTS) {
      return !!expressionValue;
    }

    return false;
  }

  private isStringArray(
    matchValue:
      | string
      | number
      | boolean
      | Record<string, unknown>
      | string[]
      | Record<string, unknown>[]
  ): matchValue is string[] {
    return Array.isArray(matchValue) && typeof matchValue[0] === 'string';
  }

  private isObjectArray(
    matchValue:
      | string
      | number
      | boolean
      | Record<string, unknown>
      | string[]
      | Record<string, unknown>[]
  ): matchValue is Record<string, unknown>[] {
    return Array.isArray(matchValue) && typeof matchValue[0] === 'object';
  }

  private isNumber(
    value:
      | string
      | number
      | boolean
      | Record<string, unknown>
      | string[]
      | Record<string, unknown>[]
  ): value is number {
    return typeof value === 'number';
  }

  private parseRoutingValue(
    value: AIResourceRoutingConditionValue,
    resolvedValue: string
  ):
    | number
    | string
    | boolean
    | Record<string, unknown>
    | string[]
    | Record<string, unknown>[] {
    if (value.type === RoutingConditionType.NUMBER) {
      return parseFloat(resolvedValue);
    } else if (value.type === RoutingConditionType.BOOLEAN) {
      return resolvedValue === 'true';
    } else if (value.type === RoutingConditionType.JSON_OBJECT) {
      return JSON.parse(resolvedValue);
    } else if (value.type === RoutingConditionType.JSON_ARRAY) {
      return JSON.parse(resolvedValue);
    } else if (value.type === RoutingConditionType.COMMA_DELIMITED_LIST) {
      return resolvedValue.split(',');
    }

    return resolvedValue;
  }
}

// ─── Template-variable derivation ────────────────────────────────────

type DerivedView = {
  /**
   * Chat-Completions-style messages array derived from
   * `instructions` + `input` so existing template patterns
   * (`request.messages[length-1].content`) keep working without each
   * template-author having to know the Responses input shape.
   */
  messages: Array<{ role: string; content: string }>;
  firstMessage: { role: string; content: string } | undefined;
  lastMessage: { role: string; content: string } | undefined;
  allMessagesContent: string;
};

/**
 * Build a derived chat-completions-shape view of the canonical
 * Responses request for use in routing-template variables. Exposes
 * what user templates typically look at: role + flattened text
 * content per message.
 *
 * Function calls and tool results don't contribute to the derived
 * `messages` view — templates that need them should branch on
 * `request.input` directly (the spread Responses body).
 */
function deriveMessageView(request: ResponseCreateParams): DerivedView {
  const messages: Array<{ role: string; content: string }> = [];

  if (typeof request.instructions === 'string' && request.instructions) {
    messages.push({ role: 'system', content: request.instructions });
  }

  const items: ResponseInputItem[] = Array.isArray(request.input)
    ? request.input
    : typeof request.input === 'string'
    ? [
        {
          type: 'message',
          role: 'user',
          content: request.input,
        } as ResponseInputItem,
      ]
    : [];

  for (const item of items) {
    const type = (item as { type?: string }).type;
    // Only `message` items contribute to the derived view. Function
    // calls, function-call outputs, and reasoning items are visible to
    // advanced templates via `request.input` directly.
    if (type !== 'message' && type !== undefined) continue;
    const msg = item as Extract<
      ResponseInputItem,
      { type?: 'message'; role: 'user' | 'system' | 'developer' | 'assistant' }
    >;
    const role = msg.role;
    const content = flattenContent(msg.content);
    if (role === 'developer') {
      messages.push({ role: 'system', content });
    } else {
      messages.push({ role, content });
    }
  }

  const allMessagesContent = messages
    .map((m) => m.content)
    .filter(Boolean)
    .join(' ');

  return {
    messages,
    firstMessage: messages.length > 0 ? messages[0] : undefined,
    lastMessage:
      messages.length > 0 ? messages[messages.length - 1] : undefined,
    allMessagesContent,
  };
}

function flattenContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      const t = (part as { type?: string }).type;
      if (
        t === 'input_text' ||
        t === 'output_text' ||
        t === 'text' ||
        t === undefined
      ) {
        return (part as { text?: string }).text ?? '';
      }
      return '';
    })
    .filter(Boolean)
    .join('\n');
}
