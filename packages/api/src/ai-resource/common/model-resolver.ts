import { HttpStatus } from '@nestjs/common';
import { AIConnectionService } from '../../ai-connection/ai-connection.service';
import { ErrorCode } from '../../error-code';
import { throwServiceError } from '../../error';
import { AIResourceModelConfigEntity } from './model.entity';
import {
  AIResourceModelRoutingEntity,
  AIRoutingConditionGroup,
  AIResourceRoutingCondition,
  RoutingItemType,
} from './routing.entity';

/**
 * Identifies a model config in error messages so operators know which
 * leg of an AI Resource (primary / fallback / secondary / routing
 * `then`) failed to resolve.
 */
type ResolveContext = string;

/**
 * Resolve a single model config: if `connectionName` is set and
 * `connectionId` is not, look the connection up by name and fill in
 * `connectionId`. Returns a copy so callers can pass entities without
 * fearing mutation. Throws `AI_CONNECTION_NOT_FOUND` (400) when both
 * are missing or when the named connection does not exist.
 *
 * Designed for two call sites:
 *   - `AIResourceService.create / update`: normalise once before
 *     persisting so the DB only ever stores resolved UUIDs.
 *   - `CompletionService.getAIResource`: normalise the per-request
 *     `vmx.resourceConfigOverrides` payload before merging — callers
 *     can send `connectionName` without knowing the UUID.
 */
export async function resolveModelConfig<
  T extends Partial<AIResourceModelConfigEntity>
>(
  config: T,
  workspaceId: string,
  environmentId: string,
  aiConnectionService: AIConnectionService,
  context: ResolveContext = 'model'
): Promise<T & Partial<AIResourceModelConfigEntity>> {
  if (config.connectionId) {
    // Already resolved — `connectionId` wins when both are set so the
    // operator's intent is unambiguous (the UUID can't drift even if
    // the named connection is later renamed).
    return config;
  }
  if (!config.connectionName) {
    // First arg fills the message template (`${connectionId}`); the
    // second is the detail object surfaced on the response body.
    throwServiceError(
      HttpStatus.BAD_REQUEST,
      ErrorCode.AI_CONNECTION_NOT_FOUND,
      { connectionId: '<missing>' },
      {
        context,
        reason:
          'Model config must specify either `connectionId` or `connectionName`',
      }
    );
  }
  const connection = await aiConnectionService.getByName(
    workspaceId,
    environmentId,
    config.connectionName,
    false
  );
  if (!connection) {
    throwServiceError(
      HttpStatus.BAD_REQUEST,
      ErrorCode.AI_CONNECTION_NOT_FOUND,
      { connectionId: config.connectionName },
      {
        context,
        connectionName: config.connectionName,
      }
    );
  }
  return { ...config, connectionId: connection.connectionId };
}

/**
 * Walk every model-config slot reachable from an AI Resource shape
 * (primary `model`, every `fallbackModels[*]`, every `secondaryModels[*]`,
 * every routing `routes[*].then`) and resolve `connectionName` →
 * `connectionId` in place on a copy. The returned object is safe to
 * persist or merge — every model config it carries has a resolved
 * `connectionId`.
 *
 * Skips slots that are absent. A partial input (e.g. an override that
 * only sets `model`) returns a partial output with only that slot
 * resolved.
 */
type ModelHolder = {
  model?: Partial<AIResourceModelConfigEntity> | null;
  fallbackModels?: Array<Partial<AIResourceModelConfigEntity>> | null;
  secondaryModels?: Array<Partial<AIResourceModelConfigEntity>> | null;
  routing?: Partial<AIResourceModelRoutingEntity> | null;
};

export async function resolveAllModelConnections<T extends ModelHolder>(
  resource: T,
  workspaceId: string,
  environmentId: string,
  aiConnectionService: AIConnectionService
): Promise<T & ModelHolder> {
  const out: T = { ...resource };

  if (resource.model) {
    out.model = await resolveModelConfig(
      resource.model,
      workspaceId,
      environmentId,
      aiConnectionService,
      'model'
    );
  }

  if (resource.fallbackModels && resource.fallbackModels.length > 0) {
    out.fallbackModels = await Promise.all(
      resource.fallbackModels.map((m, i) =>
        resolveModelConfig(
          m,
          workspaceId,
          environmentId,
          aiConnectionService,
          `fallbackModels[${i}]`
        )
      )
    );
  }

  if (resource.secondaryModels && resource.secondaryModels.length > 0) {
    out.secondaryModels = await Promise.all(
      resource.secondaryModels.map((m, i) =>
        resolveModelConfig(
          m,
          workspaceId,
          environmentId,
          aiConnectionService,
          `secondaryModels[${i}]`
        )
      )
    );
  }

  if (resource.routing) {
    out.routing = await resolveRoutingModelConnections(
      resource.routing,
      workspaceId,
      environmentId,
      aiConnectionService
    );
  }

  return out;
}

/**
 * Walk a routing tree and resolve every `then.connectionName` it
 * carries. Mirrors the routing entity's `routes[]` + nested
 * `conditions[]` shape so a `routing` object with deeply nested
 * groups works without per-call traversal logic in the caller.
 */
async function resolveRoutingModelConnections(
  routing: Partial<AIResourceModelRoutingEntity>,
  workspaceId: string,
  environmentId: string,
  aiConnectionService: AIConnectionService
): Promise<Partial<AIResourceModelRoutingEntity>> {
  if (!routing.conditions || routing.conditions.length === 0) return routing;
  const resolved = await Promise.all(
    routing.conditions.map((g, i) =>
      resolveConditionGroupModels(
        g,
        workspaceId,
        environmentId,
        aiConnectionService,
        `routing.conditions[${i}]`
      )
    )
  );
  return { ...routing, conditions: resolved };
}

async function resolveConditionGroupModels(
  group: AIRoutingConditionGroup,
  workspaceId: string,
  environmentId: string,
  aiConnectionService: AIConnectionService,
  context: ResolveContext
): Promise<AIRoutingConditionGroup> {
  const out: AIRoutingConditionGroup = { ...group };
  if (group.then) {
    out.then = (await resolveModelConfig(
      group.then,
      workspaceId,
      environmentId,
      aiConnectionService,
      `${context}.then`
    )) as typeof group.then;
  }
  if (group.conditions && group.conditions.length > 0) {
    out.conditions = await Promise.all(
      group.conditions.map(async (c, i) => {
        if (c.type === RoutingItemType.GROUP) {
          return resolveConditionGroupModels(
            c as AIRoutingConditionGroup,
            workspaceId,
            environmentId,
            aiConnectionService,
            `${context}.conditions[${i}]`
          );
        }
        return c as AIResourceRoutingCondition;
      })
    );
  }
  return out;
}
