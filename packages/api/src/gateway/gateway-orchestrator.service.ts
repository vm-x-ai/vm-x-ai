import { HttpStatus, Injectable } from '@nestjs/common';
import { AIConnectionService } from '../ai-connection/ai-connection.service';
import { AIProviderService } from '../ai-provider/ai-provider.service';
import { AIResourceService } from '../ai-resource/ai-resource.service';
import { throwServiceError } from '../error';
import { ErrorCode } from '../error-code';
import { RequestUsageService } from '../usage/usage.service';
import { CompletionMetricsService } from './metrics/metrics.service';
import { RequestAuditService } from '../audit/audit.service';
import {
  CanonicalRequestDto,
  CompletionRequestDto,
  PartialAIResourceDto,
} from './dto/completion-request.dto';
import { AIResourceEntity } from '../ai-resource/entities/ai-resource.entity';
import { ApiKeyEntity } from '../api-key/entities/api-key.entity';
import { ResourceRoutingService } from './routing.service';
import { TokenService } from '../token/token.service';
import { PinoLogger } from 'nestjs-pino';
import { EvaluatedCapacity, GateService } from './gate.service';
import { FastifyRequest } from 'fastify';
import { getSourceIpFromRequest } from '../utils/http';
import { v4 as uuidv4 } from 'uuid';
import { PublicRequestAuditType } from '../storage/entities.generated';
import {
  RequestAuditEventEntity,
  RequestAuditEventType,
} from '../audit/entities/audit.entity';
import { CompletionError } from './completion.types';
import { AIResourceModelConfigEntity } from '../ai-resource/common/model.entity';
import { CompletionUsage } from 'openai/resources/completions.js';
import {
  CompletionHeaders,
  CompletionResponse,
} from '../ai-provider/ai-provider.types';
import { extractCallerForwardHeaders } from '../ai-provider/forward-headers';
import { isAsyncIterable } from '../utils/async';
import {
  ChatCompletionChunk,
  ChatCompletionCreateParams,
} from 'openai/resources/index.js';
import { AIConnectionEntity } from '../ai-connection/entities/ai-connection.entity';
import { CapacityPeriod } from '../capacity/capacity.entity';
import os from 'os';
import { CompletionBatchEntity } from './batch/entity/batch.entity';
import merge from 'lodash.merge';
import { UserEntity } from '../users/entities/user.entity';
import { MetricService } from 'nestjs-otel';
import { resolveAllModelConnections } from '../ai-resource/common/model-resolver';
import { Attributes, Counter, Histogram, ValueType } from '@opentelemetry/api';
import { CostService } from './cost/cost.service';
import {
  StreamUsageAccumulator,
  detectStreamChunkShape,
  extractUsageFromResponse,
} from '../ai-provider/response-shape.helpers';
import type { ResponseCreateParams } from 'openai/resources/responses/responses';
import type { AnthropicMessagesRequest } from './anthropic/anthropic.types';
import type { RoutingContext } from './routing.context';

/**
 * Per-format dispatch envelope passed by every per-format gateway
 * service (`ChatCompletionsService` / `ResponsesService` /
 * `AnthropicMessagesService`). Tells `completion()` which
 * `provider.openAIResponse(...)` / `provider.anthropicMessages(...)` /
 * `provider.openAICompletion(...)` method to dispatch through and
 * carries the *wire-shape* body the upstream sees verbatim.
 *
 * Routing / gating / audit operate on the canonical Responses-shape
 * `payload` regardless of envelope format.
 */
type DispatchedFormat =
  | { format: 'chat-completions'; body: ChatCompletionCreateParams }
  | { format: 'responses'; body: ResponseCreateParams }
  | { format: 'anthropic'; body: AnthropicMessagesRequest };

/**
 * Shared VM-X orchestrator. Owns routing, gating, fallback loop,
 * audit, cost, and stream usage accumulation. Per-format services
 * (`ChatCompletionsService`, `ResponsesService`,
 * `AnthropicMessagesService`) are thin wrappers around this class —
 * they normalize their inbound wire body to canonical Responses shape
 * and call `completion()` with a `DispatchedFormat` envelope.
 */
@Injectable()
export class GatewayOrchestratorService {
  private errorCounter: Counter;
  private successCounter: Counter;
  private requestTokensHistogram: Histogram;
  private responseTokensHistogram: Histogram;
  private totalTokensHistogram: Histogram;
  private cacheTokensHistogram: Histogram;
  private cacheCreationTokensHistogram: Histogram;
  private reasoningTokensHistogram: Histogram;
  private costHistogram: Histogram;
  private tokensPerSecondHistogram: Histogram;
  private timeToFirstTokenHistogram: Histogram;
  private requestDurationHistogram: Histogram;
  private providerDurationHistogram: Histogram;
  private gateDurationHistogram: Histogram;
  private routingDurationHistogram: Histogram;

  constructor(
    private readonly logger: PinoLogger,
    private readonly aiProviderService: AIProviderService,
    private readonly aiConnectionService: AIConnectionService,
    private readonly aiResourceService: AIResourceService,
    private readonly resourceRoutingService: ResourceRoutingService,
    private readonly gateService: GateService,
    private readonly requestUsageService: RequestUsageService,
    private readonly completionMetricsService: CompletionMetricsService,
    private readonly requestAuditService: RequestAuditService,
    private readonly tokenService: TokenService,
    private readonly metricService: MetricService,
    private readonly costService: CostService
  ) {
    // Metric prefix is operator-configurable so VM-X metrics can be
    // namespaced separately when shipped to a shared OTel backend.
    // Empty / unset → `vmx`, the default. Trailing dots stripped so
    // `METRICS_PREFIX=vmx.` doesn't produce `vmx..gateway.*`.
    const rawPrefix = process.env.METRICS_PREFIX?.trim();
    const prefix = (rawPrefix && rawPrefix.replace(/\.+$/, '')) || 'vmx';
    const name = (suffix: string) => `${prefix}.gateway.${suffix}`;

    this.errorCounter = this.metricService.getCounter(name('error.count'), {
      description: 'Number of gateway errors',
      valueType: ValueType.INT,
    });
    this.successCounter = this.metricService.getCounter(name('success.count'), {
      description: 'Number of successful gateway completions',
      valueType: ValueType.INT,
    });
    this.requestTokensHistogram = this.metricService.getHistogram(
      name('request.tokens'),
      {
        description: 'Number of request (prompt) tokens',
        valueType: ValueType.INT,
      }
    );
    this.responseTokensHistogram = this.metricService.getHistogram(
      name('response.tokens'),
      {
        description: 'Number of response (output) tokens',
        valueType: ValueType.INT,
      }
    );
    this.totalTokensHistogram = this.metricService.getHistogram(
      name('total.tokens'),
      {
        description: 'Total tokens (request + response)',
        valueType: ValueType.INT,
      }
    );
    this.cacheTokensHistogram = this.metricService.getHistogram(
      name('cache.tokens'),
      {
        description:
          'Cached input tokens served from prompt cache (read). ' +
          'From `prompt_tokens_details.cached_tokens`.',
        valueType: ValueType.INT,
      }
    );
    this.cacheCreationTokensHistogram = this.metricService.getHistogram(
      name('cache.creation.tokens'),
      {
        description:
          'Input tokens written to prompt cache (write). From ' +
          '`prompt_tokens_details.cache_creation_input_tokens` (Anthropic / ' +
          'Bedrock-Invoke).',
        valueType: ValueType.INT,
      }
    );
    this.reasoningTokensHistogram = this.metricService.getHistogram(
      name('reasoning.tokens'),
      {
        description:
          'Reasoning tokens (o-series, extended thinking, etc.). From ' +
          '`completion_tokens_details.reasoning_tokens`.',
        valueType: ValueType.INT,
      }
    );
    this.costHistogram = this.metricService.getHistogram(name('cost'), {
      description:
        'Computed request cost in USD (input + output + cache read + cache ' +
        'write + reasoning, per model-pricing table).',
      valueType: ValueType.DOUBLE,
      unit: 'USD',
    });
    this.tokensPerSecondHistogram = this.metricService.getHistogram(
      name('tokens.per.second'),
      {
        description: 'Tokens per second',
        valueType: ValueType.DOUBLE,
      }
    );
    this.timeToFirstTokenHistogram = this.metricService.getHistogram(
      name('time.to.first.token'),
      {
        description: 'Time to first token',
        valueType: ValueType.INT,
        unit: 'ms',
      }
    );
    this.requestDurationHistogram = this.metricService.getHistogram(
      name('request.duration'),
      {
        description: 'End-to-end request duration through the gateway',
        valueType: ValueType.INT,
        unit: 'ms',
      }
    );
    this.providerDurationHistogram = this.metricService.getHistogram(
      name('provider.duration'),
      {
        description: 'Upstream provider call duration',
        valueType: ValueType.INT,
        unit: 'ms',
      }
    );
    this.gateDurationHistogram = this.metricService.getHistogram(
      name('gate.duration'),
      {
        description: 'Capacity + prioritization gate evaluation duration',
        valueType: ValueType.INT,
        unit: 'ms',
      }
    );
    this.routingDurationHistogram = this.metricService.getHistogram(
      name('routing.duration'),
      {
        description: 'Routing rule evaluation duration',
        valueType: ValueType.INT,
        unit: 'ms',
      }
    );
  }

  public async completion(
    workspaceId: string,
    environmentId: string,
    payload: CanonicalRequestDto,
    apiKey?: ApiKeyEntity,
    request?: FastifyRequest,
    batch?: CompletionBatchEntity,
    user?: UserEntity,
    abortSignal?: AbortSignal,
    originalRequestForAudit?: unknown,
    originalGatewayRequest?: DispatchedFormat
  ): Promise<CompletionResponse>;

  public async completion(
    workspaceId: string,
    environmentId: string,
    payload: CanonicalRequestDto,
    apiKey?: ApiKeyEntity,
    request?: FastifyRequest,
    batch?: CompletionBatchEntity,
    user?: UserEntity,
    abortSignal?: AbortSignal,
    /**
     * When `complete()` invokes this method after format-converting
     * (e.g. Anthropic→OpenAI), it passes the original received body
     * here so the audit row's `requestPayload` reflects what the
     * client actually sent rather than the converted OpenAI shape.
     * Defaults to the OpenAI `payload` for direct chat-completions
     * callers.
     */
    originalRequestForAudit?: unknown,
    /**
     * When set, the provider call site dispatches via
     * `provider.complete(originalGatewayRequest)` instead of the
     * legacy `provider.completion(openaiBody)` path. This is the hook
     * that lets format-aware providers (Anthropic-on-Bedrock-Invoke,
     * Anthropic-on-Anthropic, etc.) skip the OpenAI round-trip and
     * use the wire body verbatim. Direct chat-completions callers
     * leave this undefined for backwards compatibility.
     */
    originalGatewayRequest?: DispatchedFormat
  ): Promise<CompletionResponse> {
    const sourceIp = request ? getSourceIpFromRequest(request) : os.hostname();
    let modelConfig: AIResourceModelConfigEntity | null = null;
    let aiResource: AIResourceEntity | null = null;
    let requestAt: Date = new Date();
    let routingDuration: number | null = null;
    let gateDuration: number | null = null;
    let providerStartAt: number | null = null;
    let timeToFirstToken: number | null = null;

    let messageId: string | null = null;
    const auditEvents: RequestAuditEventEntity[] = [];
    const requestId = uuidv4();

    // The controller-supplied `abortSignal` is purely a client-
    // disconnect signal (Fastify's request `aborted` event). Caller
    // and per-model timeouts are handed to the provider SDK as
    // `options.timeoutMs` below so the SDK can apply its native
    // per-request `timeout` primitive (OpenAI / Anthropic) and surface
    // a typed timeout error. SDKs whose only cancellation primitive
    // is a signal (Bedrock, Google GenAI) synthesize their own
    // `AbortSignal.timeout` from `timeoutMs` via `composeAbortSignal`.
    //
    // Caller-supplied `vmx.timeoutMs` is clamped to 10 minutes so a
    // misbehaving client can't pin a worker.
    const TEN_MINUTES_MS = 10 * 60 * 1000;
    const callerTimeoutMs =
      payload.vmx?.timeoutMs != null && payload.vmx.timeoutMs > 0
        ? Math.min(payload.vmx.timeoutMs, TEN_MINUTES_MS)
        : undefined;

    try {
      aiResource = await this.getAIResource(
        workspaceId,
        environmentId,
        payload.model as string,
        payload.vmx?.resourceConfigOverrides
      );

      const usePrimaryModel =
        payload.vmx?.secondaryModelIndex == undefined ||
        payload.vmx?.secondaryModelIndex === null;
      const useSecondaryModel =
        payload.vmx?.secondaryModelIndex !== undefined ||
        payload.vmx?.secondaryModelIndex !== null;

      modelConfig = usePrimaryModel
        ? aiResource.model
        : useSecondaryModel &&
          payload.vmx?.secondaryModelIndex &&
          aiResource.secondaryModels?.[payload.vmx?.secondaryModelIndex]
        ? aiResource.secondaryModels?.[payload.vmx?.secondaryModelIndex]
        : throwServiceError(
            HttpStatus.BAD_REQUEST,
            ErrorCode.COMPLETION_SECONDARY_MODEL_NOT_FOUND,
            {
              secondaryModelIndex: payload.vmx?.secondaryModelIndex,
            }
          );

      const baseMetricsAttributes: Attributes = {
        workspaceId,
        environmentId,
        resourceId: aiResource?.resourceId,
        // Wire-shape format the request landed on — one of
        // `chat-completions`, `responses`, `anthropic`. Defaults to
        // `responses` when no envelope is threaded (matches the
        // `dispatchedRequest` fallback below).
        format: originalGatewayRequest?.format ?? 'responses',
      };

      if (payload.vmx?.metadata) {
        for (const [key, value] of Object.entries(payload.vmx.metadata)) {
          if (value !== null && value !== undefined && value !== '') {
            baseMetricsAttributes[`vmx.metadata.${key}`] = String(value);
          }
        }
      }

      const requestTokens = this.tokenService.getRequestTokens(payload);

      const shouldRoute = usePrimaryModel && aiResource.routing?.enabled;
      if (shouldRoute) {
        const routingStartAt = Date.now();
        try {
          // Build the canonical Responses-shape `RoutingContext` that
          // routing/gating templates evaluate against. Per-format
          // services thread `originalGatewayRequest` through so we can
          // pick the cheapest path:
          //   - 'responses'         → use the original Responses body verbatim
          //   - 'anthropic'         → convert via anthropicToResponsesRequest
          //   - 'chat-completions'  → convert via chatCompletionsToResponsesRequest
          //                           (also the default when no format envelope was
          //                           supplied — payload is OpenAI Chat Completions).
          const routingInput = buildRoutingContext(
            payload,
            originalGatewayRequest
          );
          const routingResult =
            await this.resourceRoutingService.evaluateRoutingConditions(
              workspaceId,
              environmentId,
              routingInput,
              requestTokens,
              aiResource
            );
          if (routingResult) {
            auditEvents.push({
              timestamp: new Date(),
              type: RequestAuditEventType.ROUTING,
              data: {
                originalModel: modelConfig,
                routedModel: routingResult.model,
                matchedRoute: routingResult.matchedRoute,
              },
            });
            this.routingDurationHistogram.record(Date.now() - routingStartAt, {
              ...baseMetricsAttributes,
              routedModel: routingResult.model.model,
              routedProvider: routingResult.model.provider,
              originalModel: modelConfig.model,
              originalProvider: modelConfig.provider,
            });

            modelConfig = routingResult.model;
          }
        } finally {
          routingDuration = Date.now() - routingStartAt;
        }
      }

      const models = [modelConfig, ...(aiResource.fallbackModels ?? [])];
      for (let i = 0; i < models.length; i++) {
        modelConfig = models[i];
        if (i > 0) {
          requestAt = new Date();
          this.logger.info(
            `Fallback to ${modelConfig.provider} - ${modelConfig.model} provider, attempt ${i}`
          );
        }

        // `getAIResource` guarantees every returned model config has
        // `connectionId` set (the DB never stores name-only configs;
        // the `vmx.resourceConfigOverrides` resolver fills the field
        // before merging). Pin the narrowed type once per loop
        // iteration so the downstream reads don't need `!`.
        const connectionId = modelConfig.connectionId as string;

        const baseProps = {
          workspaceId,
          environmentId,
          resourceId: aiResource.resourceId,
          model: modelConfig.model,
          timestamp: requestAt,
          requestId,
          sourceIp,
          apiKeyId: apiKey?.apiKeyId,
          correlationId: payload.vmx?.correlationId,
          // Canonical-side metadata for the audit row. `payload.vmx`
          // here already reflects header-derived fields applied by
          // `applyVmxHeadersToCanonical` upstream, so this captures
          // both body-supplied and header-supplied metadata. The
          // original wire body (`requestPayload`) never sees header
          // fields, so we surface metadata here instead of reading
          // it off `requestPayload` inside `postCompletion`.
          metadata: payload.vmx?.metadata ?? null,
          connectionId,
          userId: user?.id,
        };

        const metricsAttributes = {
          ...baseMetricsAttributes,
          provider: modelConfig.provider,
          model: modelConfig.model,
          connectionId,
        };

        try {
          const aiConnection = await this.aiConnectionService.getById({
            workspaceId,
            environmentId,
            connectionId,
            decrypt: true,
          });

          const provider = this.aiProviderService.get(aiConnection.provider);
          if (!provider) {
            throwServiceError(
              HttpStatus.BAD_REQUEST,
              ErrorCode.AI_PROVIDER_NOT_FOUND,
              {
                id: aiConnection.provider,
              }
            );
          }

          const gateStartAt = Date.now();
          let evaluatedCapacities: EvaluatedCapacity[] = [];
          try {
            evaluatedCapacities = await this.gateService.requestGate(
              requestAt,
              requestTokens,
              workspaceId,
              environmentId,
              aiResource,
              modelConfig,
              aiConnection,
              apiKey,
              request,
              batch
            );
          } catch (error) {
            this.logger.error(
              { error },
              `Error requesting gate for provider ${modelConfig.provider}`
            );
            throw error;
          } finally {
            gateDuration = Date.now() - gateStartAt;
          }

          this.gateDurationHistogram.record(gateDuration, metricsAttributes);

          const { vmx } = payload;
          // Default the dispatch envelope to a `'responses'` envelope
          // pointing at `payload` itself when no per-format service
          // threaded one. After the canonical-shape flip every
          // public-endpoint controller threads an envelope, so this
          // branch covers the bare `/responses` path and any internal
          // caller that already holds a Responses body.
          const envelope: DispatchedFormat =
            originalGatewayRequest ??
            ({
              format: 'responses' as const,
              body: payload,
            } as DispatchedFormat);

          // Merge order (lowest precedence to highest) on the *wire-shape*
          // body:
          //   1. resource defaultArgs (operator-set baseline)
          //   2. native request body, with `vmx` lifted off (envelope field
          //      stripped before going to the upstream)
          //   3. vmx.providerArgs (escape hatch for provider-native fields
          //      the standard request shape can't express — Perplexity
          //      `search_recency_filter`, Anthropic `top_k`, etc.)
          // Each later layer overrides earlier ones, even for structured
          // fields like `messages` and `tools` — that's the whole point of
          // `providerArgs`: the user's unconditional override.
          //
          // Reading `vmx` from the wire body falls back when callers
          // routed through a converter that didn't preserve it on the
          // canonical body (the anthropic→responses adapter, for
          // example, lifts vmx onto the canonical but the wire body is
          // still the original anthropic body).
          const wireBody = envelope.body as Record<string, unknown>;
          const { vmx: wireVmx, ...wireBodyNoVmx } = wireBody as {
            vmx?: { providerArgs?: Record<string, unknown> | null };
            [k: string]: unknown;
          };
          const providerArgs =
            vmx?.providerArgs ?? wireVmx?.providerArgs ?? null;

          // `defaultArgs` are operator-configured at the resource
          // level. The shape that makes sense to merge is whichever
          // wire format dispatch will use — i.e. the envelope.format
          // shape. A free-form JSON object that targets a specific
          // wire format is the user's responsibility; we just spread it
          // verbatim onto the wire body.
          const mergedNative = providerArgs
            ? {
                ...(aiResource.defaultArgs ?? {}),
                ...wireBodyNoVmx,
                ...providerArgs,
              }
            : { ...(aiResource.defaultArgs ?? {}), ...wireBodyNoVmx };

          providerStartAt = Date.now();
          let requestUsage: CompletionUsage | undefined = undefined;
          // Format-aware dispatch — providers' three method branches
          // (`openAICompletion` / `openAIResponse` / `anthropicMessages`)
          // each receive the wire body verbatim. The provider decides
          // passthrough vs. convert internally; the orchestrator
          // doesn't care which native shape comes back (the
          // `extractUsageFromResponse` helper normalises usage across
          // ChatCompletion / Response / Anthropic Message wire shapes).
          const dispatchedRequest = {
            ...envelope,
            body: mergedNative,
          } as DispatchedFormat;

          // Compose the per-attempt deadline. Caller's `vmx.timeoutMs`
          // (resolved once at request level) and this model's
          // `timeoutMs` both contribute — whichever is shorter wins,
          // so a tight per-model deadline can't be silently widened
          // by a generous caller (and vice-versa). Clamped to 10
          // minutes. The number is handed to the provider SDK as
          // `options.timeoutMs` so the SDK's native per-request
          // timeout primitive (OpenAI / Anthropic) does the work.
          const modelTimeoutMs =
            modelConfig.timeoutMs != null && modelConfig.timeoutMs > 0
              ? Math.min(modelConfig.timeoutMs, TEN_MINUTES_MS)
              : undefined;
          const effectiveTimeoutMs =
            callerTimeoutMs != null && modelTimeoutMs != null
              ? Math.min(callerTimeoutMs, modelTimeoutMs)
              : callerTimeoutMs ?? modelTimeoutMs;

          // Forward whitelisted inbound headers to the upstream
          // provider. The key one is `anthropic-beta` — Anthropic
          // gates body fields like `context_management` /
          // `output_config.effort` behind those beta opt-ins, and
          // rejects the body with "Extra inputs are not permitted"
          // if the header is missing. The allowlist excludes
          // `Authorization` so callers can't override the gateway's
          // own connection-level upstream key.
          const callerForwardHeaders = extractCallerForwardHeaders(
            request?.headers
          );
          const requestOptions = {
            // External cancellation only — fires when the HTTP client
            // disconnects mid-request. Timeouts come through
            // `timeoutMs` below, not folded into this signal.
            signal: abortSignal,
            timeoutMs: effectiveTimeoutMs,
            // `maxRetries` lets a provider's underlying SDK retry
            // transient failures internally before the gateway falls
            // through. `0` (default) preserves the prior behaviour:
            // first transient failure rolls straight to the next
            // fallback model.
            maxRetries: modelConfig.maxRetries ?? 0,
            ...(Object.keys(callerForwardHeaders).length
              ? { forwardHeaders: callerForwardHeaders }
              : {}),
          };
          // The 3-method `CompletionProvider` interface dispatches by
          // input format. Each provider's `openAIResponse` /
          // `anthropicMessages` either passes the body through to a
          // native upstream (OpenAI Responses, Anthropic, Bedrock-Invoke)
          // or runs a direct converter (Bedrock-Converse, etc.).
          // `extractUsageFromResponse` normalises usage across the three
          // wire shapes (ChatCompletion / Response / Message) so audit /
          // cost stay shape-agnostic.
          let providerResponse: CompletionResponse;
          switch (dispatchedRequest.format) {
            case 'anthropic':
              providerResponse = (await provider.anthropicMessages(
                dispatchedRequest.body as Parameters<
                  typeof provider.anthropicMessages
                >[0],
                aiConnection,
                modelConfig,
                requestOptions
              )) as unknown as CompletionResponse;
              break;
            case 'responses':
              providerResponse = (await provider.openAIResponse(
                dispatchedRequest.body as Parameters<
                  typeof provider.openAIResponse
                >[0],
                aiConnection,
                modelConfig,
                requestOptions
              )) as unknown as CompletionResponse;
              break;
            case 'chat-completions':
              providerResponse = (await provider.openAICompletion(
                dispatchedRequest.body as Parameters<
                  typeof provider.openAICompletion
                >[0],
                aiConnection,
                modelConfig,
                requestOptions
              )) as unknown as CompletionResponse;
              break;
            default: {
              // Exhaustiveness check — TS narrows to `never` once every
              // discriminator is handled. If a new format lands and
              // misses this switch, the build fails here.
              const _exhaustive: never = dispatchedRequest;
              throw new Error(
                `Unhandled dispatch format: ${
                  (_exhaustive as DispatchedFormat).format
                }`
              );
            }
          }

          // Audit `responseData` accepts any wire shape — OpenAI
          // ChatCompletion chunks, native Anthropic SSE events, native
          // Responses events. Typed as `unknown[]` (JSONB downstream)
          // so per-format providers don't have to lie about the shape.
          const responseData: unknown[] = [];

          if (isAsyncIterable(providerResponse.data)) {
            async function* createDataStream(
              this: GatewayOrchestratorService,
              data: AsyncIterable<unknown>,
              providerStartAt: number,
              modelConfig: AIResourceModelConfigEntity
            ) {
              const usageAccumulator = new StreamUsageAccumulator();
              for await (const chunk of data) {
                responseData.push(chunk);
                const chunkId = (chunk as { id?: string }).id;
                if (chunkId) messageId = chunkId;

                if (payload.stream && !timeToFirstToken && providerStartAt) {
                  timeToFirstToken = Date.now() - providerStartAt;
                  this.timeToFirstTokenHistogram.record(
                    timeToFirstToken,
                    metricsAttributes
                  );
                }

                usageAccumulator.update(chunk);
                const accumulated = usageAccumulator.snapshot();
                if (accumulated && !requestUsage) {
                  requestUsage = accumulated;
                }

                // Per D9: only OpenAI Chat Completion chunks get the
                // `vmx` per-chunk decoration; native Anthropic /
                // Responses event schemas are strict and reject
                // unknown top-level fields. Non-ChatCompletion shapes
                // forward verbatim — vmx telemetry is surfaced via
                // response headers + audit row instead.
                const shape = detectStreamChunkShape(chunk);
                if (shape === 'openai-chat-completion-chunk') {
                  yield {
                    ...(chunk as ChatCompletionChunk),
                    vmx: {
                      events: auditEvents,
                      metrics: {
                        gateDurationMs: gateDuration ?? null,
                        routingDurationMs: routingDuration ?? null,
                        timeToFirstTokenMs: timeToFirstToken ?? null,
                      },
                    },
                  };
                } else {
                  yield chunk;
                }
              }

              // Sub-millisecond responses (mocks, tests, cached
              // streams) would yield `Infinity`/`NaN` here; floor the
              // elapsed window to 1ms so the histogram never records a
              // non-finite value.
              const elapsedMs = Math.max(1, Date.now() - providerStartAt);
              const computedTps = requestUsage
                ? requestUsage.total_tokens / (elapsedMs / 1000)
                : null;
              const tokensPerSecond =
                computedTps != null && Number.isFinite(computedTps)
                  ? computedTps
                  : null;

              await this.postCompletion(
                requestAt,
                providerStartAt,
                originalRequestForAudit ?? payload,
                baseProps,
                aiConnection,
                evaluatedCapacities,
                modelConfig,
                messageId,
                gateDuration,
                routingDuration,
                timeToFirstToken,
                tokensPerSecond,
                requestUsage,
                auditEvents,
                responseData,
                providerResponse.headers,
                metricsAttributes,
                providerResponse.providerRequestPayload
              );
            }

            return {
              // The stream may carry any of the three native shapes
              // (ChatCompletionChunk, ResponseStreamEvent,
              // RawMessageStreamEvent). The legacy `CompletionResponse`
              // typing narrows to ChatCompletionChunk; cast through
              // unknown to widen for cross-format streams.
              data: createDataStream.bind(this)(
                providerResponse.data,
                providerStartAt,
                modelConfig
              ) as never,
              headers: this.appendVmxHeaders(
                modelConfig,
                providerResponse,
                requestId,
                payload,
                gateDuration,
                routingDuration,
                auditEvents
              ),
            };
          } else {
            // Per-shape usage extraction. Provider methods may return
            // ChatCompletion (most cells today via dispatch helpers),
            // native `Response` (OpenAI Responses dispatch helper), or
            // native Anthropic `Message` (anthropic / bedrock-invoke
            // passthrough). Each carries usage under different field
            // names; the helper normalises to OpenAI `CompletionUsage`
            // so the downstream audit / cost paths stay shape-agnostic.
            requestUsage = extractUsageFromResponse(providerResponse.data);
            messageId = (providerResponse.data as { id?: string }).id ?? null;

            await this.postCompletion(
              requestAt,
              providerStartAt,
              originalRequestForAudit ?? payload,
              baseProps,
              aiConnection,
              evaluatedCapacities,
              modelConfig,
              messageId,
              gateDuration,
              routingDuration,
              timeToFirstToken,
              null,
              requestUsage,
              auditEvents,
              providerResponse.data,
              providerResponse.headers,
              metricsAttributes,
              providerResponse.providerRequestPayload
            );
          }

          return {
            data: {
              ...providerResponse.data,
              vmx: {
                events: auditEvents,
                metrics: {
                  gateDurationMs: gateDuration ?? null,
                  routingDurationMs: routingDuration ?? null,
                  timeToFirstTokenMs: timeToFirstToken ?? null,
                  tokensPerSecond: null,
                },
              },
            },
            headers: this.appendVmxHeaders(
              modelConfig,
              providerResponse,
              requestId,
              payload,
              gateDuration,
              routingDuration,
              auditEvents
            ),
          };
        } catch (error) {
          this.logger.error(
            `Error execution completion for provider ${modelConfig.provider}`,
            error
          );

          if (i === models.length - 1) {
            this.logger.error('All providers failed to execute completion');
            throw error;
          }

          const { failureReason, statusCode, errorMessage, headers } =
            this.parseProviderError(error);

          this.errorCounter.add(1, {
            ...metricsAttributes,
            failureReason,
          });

          auditEvents.push({
            timestamp: new Date(),
            type: RequestAuditEventType.FALLBACK,
            data: {
              model: modelConfig,
              failureReason,
              statusCode,
              errorMessage,
              headers,
            },
          });

          this.requestUsageService.push({
            ...baseProps,
            statusCode,
            provider: modelConfig.provider,
            messageId,
            gateDuration,
            routingDuration,
            timeToFirstToken,
            requestDuration: Date.now() - requestAt.getTime(),
            error: true,
            failureReason,
          });
          if (baseProps.resourceId !== 'ephemeral') {
            this.completionMetricsService.push({
              ...baseProps,
              statusCode,
            });
          }
        }
      }
    } catch (err) {
      const { failureReason, statusCode, errorMessage, headers } =
        this.parseProviderError(err);

      const baseProps = {
        workspaceId,
        environmentId,
        resourceId: aiResource?.resourceId,
        model: modelConfig?.model,
        timestamp: requestAt,
        requestId,
        sourceIp,
        apiKeyId: apiKey?.apiKeyId,
        correlationId: payload.vmx?.correlationId,
        connectionId: modelConfig?.connectionId ?? undefined,
      };
      const requestDuration = Date.now() - requestAt.getTime();

      this.requestUsageService.push({
        ...baseProps,
        failureReason,
        statusCode,
        provider: modelConfig?.provider,
        messageId,
        gateDuration,
        routingDuration,
        timeToFirstToken,
        requestDuration,
        error: true,
      });
      // Metrics buckets are keyed by `resourceId`; ephemeral
      // playground requests have no real resource to roll up under,
      // so skip metrics for them rather than feeding the literal
      // `'ephemeral'` string into the redis key.
      if (modelConfig && aiResource && aiResource.resourceId !== 'ephemeral') {
        this.completionMetricsService.push({
          ...baseProps,
          // Same resolver guarantee as the loop: a non-ephemeral
          // `aiResource` always carries a resolved `connectionId`.
          connectionId: modelConfig.connectionId as string,
          resourceId: aiResource.resourceId,
          model: modelConfig.model,
          statusCode,
        });
      }
      this.requestAuditService.push({
        ...baseProps,
        resourceId: this.auditResourceId(aiResource),
        statusCode,
        type: PublicRequestAuditType.COMPLETION,
        events: auditEvents,
        requestPayload: (originalRequestForAudit ??
          payload) as unknown as CompletionRequestDto,
        // The provider attaches the body its SDK saw on the wire to
        // `CompletionError.data.providerRequestPayload`. Surface it on
        // the audit row so debugging a parsing failure doesn't require
        // re-running the request.
        providerRequestPayload:
          err instanceof CompletionError
            ? err.data.providerRequestPayload
            : undefined,
        responseData: null,
        responseHeaders: headers,
        duration: requestDuration,
        errorMessage,
        failureReason,
        provider: modelConfig?.provider,
        messageId,
        timeToFirstToken,
        gateDuration,
        routingDuration,
        requestDuration,
        errorCount: 1,
        successCount: 0,
        metadata: payload.vmx?.metadata ?? null,
      });

      throw err;
    }

    // This should never happen
    throw new CompletionError({
      openAICompatibleError: {
        code: 'no_completion_response',
      },
      message: 'No completion response',
      rate: false,
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      retryable: false,
      failureReason: 'No completion response',
    });
  }

  private appendVmxHeaders(
    modelConfig: AIResourceModelConfigEntity,
    providerResponse: CompletionResponse,
    requestId: string,
    payload: CanonicalRequestDto,
    gateDuration: number,
    routingDuration: number | null,
    auditEvents: RequestAuditEventEntity[]
  ): CompletionHeaders {
    const vmxHeaders: Record<string, string> = {
      'x-vmx-request-id': requestId,
      'x-vmx-gate-duration-ms': gateDuration.toString(),
    };
    if (payload.vmx?.correlationId) {
      vmxHeaders['x-vmx-correlation-id'] = payload.vmx.correlationId;
    }
    if (routingDuration) {
      vmxHeaders['x-vmx-routing-duration-ms'] = routingDuration.toString();
    }

    vmxHeaders['x-vmx-model'] = modelConfig.model;
    vmxHeaders['x-vmx-provider'] = modelConfig.provider;
    // Same resolver invariant — every modelConfig that reaches the
    // header-emit step has its connectionId filled in.
    vmxHeaders['x-vmx-connection-id'] = modelConfig.connectionId as string;

    if (payload.vmx?.metadata) {
      for (const [key, value] of Object.entries(payload.vmx.metadata)) {
        if (value !== null && value !== undefined && value !== '') {
          // Strip CR/LF/NUL from both the header name and value — user-
          // supplied metadata flows directly into HTTP response headers,
          // and a payload like `{"foo": "bar\r\nX-Injected: hi"}` would
          // otherwise inject arbitrary headers into the gateway response.
          // NUL is intentionally stripped to defeat header smuggling.
          // eslint-disable-next-line no-control-regex
          const HEADER_UNSAFE = new RegExp('[\\r\\n\\x00]', 'g');
          const safeKey = key.toLowerCase().replace(HEADER_UNSAFE, '');
          const safeValue = String(value).replace(HEADER_UNSAFE, '');
          vmxHeaders[`x-vmx-metadata-${safeKey}`] = safeValue;
        }
      }
    }

    if (auditEvents.length > 0) {
      vmxHeaders['x-vmx-event-count'] = auditEvents.length.toString();

      for (let i = 0; i < auditEvents.length; i++) {
        const event = auditEvents[i];
        vmxHeaders[`x-vmx-event-${i}-type`] = event.type;
        vmxHeaders[`x-vmx-event-${i}-timestamp`] =
          event.timestamp.toISOString();

        switch (event.type) {
          case RequestAuditEventType.FALLBACK:
            vmxHeaders[`x-vmx-event-${i}-fallback-failed-model`] =
              event.data.model.model;
            vmxHeaders[`x-vmx-event-${i}-fallback-failure-reason`] =
              event.data.errorMessage;
            break;
          case RequestAuditEventType.ROUTING:
            vmxHeaders[`x-vmx-event-${i}-routing-original-provider`] =
              event.data.originalModel.provider;
            vmxHeaders[`x-vmx-event-${i}-routing-original-model`] =
              event.data.originalModel.model;
            vmxHeaders[`x-vmx-event-${i}-routing-routed-provider`] =
              event.data.routedModel.provider;
            vmxHeaders[`x-vmx-event-${i}-routing-routed-model`] =
              event.data.routedModel.model;
            break;
        }
      }
    }

    return {
      ...providerResponse.headers,
      ...vmxHeaders,
    };
  }

  private async postCompletion(
    requestAt: Date,
    providerStartAt: number,
    /**
     * The client's original wire-shape body (Chat Completions /
     * Responses / Anthropic Messages). Stored verbatim on the audit
     * row. Typed as `unknown` because the audit pipeline only reads
     * `vmx?.metadata` off it for first-class metadata indexing — the
     * rest is JSONB serialized and rendered shape-aware in the UI.
     */
    requestPayload: unknown,
    baseEventProps: {
      workspaceId: string;
      environmentId: string;
      resourceId: string;
      model: string;
      timestamp: Date;
      requestId: string;
      sourceIp: string;
      apiKeyId?: string;
      correlationId?: string | null;
      metadata?: Record<string, string> | null;
      connectionId: string;
      userId?: string;
    },
    aiConnection: AIConnectionEntity,
    evaluatedCapacities: EvaluatedCapacity[],
    modelConfig: AIResourceModelConfigEntity,
    messageId: string | null,
    gateDuration: number | null,
    routingDuration: number | null,
    timeToFirstToken: number | null,
    tokensPerSecond: number | null,
    requestUsage: CompletionUsage | undefined,
    auditEvents: RequestAuditEventEntity[],
    responseData: unknown[] | unknown | null,
    responseHeaders: CompletionHeaders | null,
    metricsAttributes: Attributes,
    /**
     * The body the provider's SDK saw on the wire (post-conversion or
     * verbatim on passthrough). Captured by the provider class on the
     * `CompletionResponse.providerRequestPayload` field, threaded
     * through here so the audit push can store it alongside the
     * received `requestPayload`.
     */
    providerRequestPayload?: unknown
  ) {
    const requestDuration = Date.now() - requestAt.getTime();
    const providerDuration = Date.now() - providerStartAt;
    if (requestUsage) {
      // Floor elapsed window to 1ms so sub-millisecond responses don't
      // produce `Infinity` / `NaN` values that pollute the histogram.
      const elapsedMs = Math.max(1, Date.now() - providerStartAt);
      const computedTps = requestUsage.total_tokens / (elapsedMs / 1000);
      tokensPerSecond = Number.isFinite(computedTps) ? computedTps : null;

      this.requestTokensHistogram.record(
        requestUsage.prompt_tokens,
        metricsAttributes
      );
      this.responseTokensHistogram.record(
        requestUsage.completion_tokens,
        metricsAttributes
      );
      this.totalTokensHistogram.record(
        requestUsage.total_tokens,
        metricsAttributes
      );
      if (tokensPerSecond != null && Number.isFinite(tokensPerSecond)) {
        this.tokensPerSecondHistogram.record(
          tokensPerSecond,
          metricsAttributes
        );
      }
    }

    this.requestDurationHistogram.record(requestDuration, metricsAttributes);
    this.providerDurationHistogram.record(providerDuration, metricsAttributes);
    this.successCounter.add(1, metricsAttributes);

    if (requestUsage) {
      await this.gateService.increaseTokenResponseUsage(
        evaluatedCapacities,
        requestUsage
      );
    }
    this.requestUsageService.push({
      ...baseEventProps,
      statusCode: HttpStatus.OK,
      provider: modelConfig.provider,
      messageId,
      gateDuration,
      providerDuration,
      routingDuration,
      timeToFirstToken,
      tokensPerSecond,
      requestDuration,
      // The OpenAI SDK's `usage` object keeps the legacy field name
      // `completion_tokens` on the wire. We rename to `outputTokens`
      // on our internal/audit shape to match the new column.
      outputTokens: requestUsage?.completion_tokens,
      promptTokens: requestUsage?.prompt_tokens,
      totalTokens: requestUsage?.total_tokens,
    });
    if (baseEventProps.resourceId !== 'ephemeral') {
      this.completionMetricsService.push({
        ...baseEventProps,
        statusCode: HttpStatus.OK,
      });
    }
    const cachedTokens =
      requestUsage?.prompt_tokens_details?.cached_tokens ?? null;
    const reasoningTokens =
      requestUsage?.completion_tokens_details?.reasoning_tokens ?? null;
    // Extended-usage fields surfaced by Anthropic / Bedrock-Invoke
    // providers as OpenAI-extension fields on `prompt_tokens_details`
    // / `usage` (see `aws-bedrock-invoke.provider.ts.convertResponse`).
    // Strict OpenAI consumers don't set these — extracted as `null`
    // when absent so the audit row distinguishes "feature
    // unavailable" from "zero tokens".
    const ptdExt = requestUsage?.prompt_tokens_details as
      | (typeof requestUsage extends undefined
          ? undefined
          : Record<string, unknown>)
      | undefined;
    const ctdExt = requestUsage?.completion_tokens_details as
      | (typeof requestUsage extends undefined
          ? undefined
          : Record<string, unknown>)
      | undefined;
    const cacheCreationInputTokens =
      (ptdExt?.cache_creation_input_tokens as number | undefined) ?? null;
    const cacheCreationBreakdown = ptdExt?.cache_creation as
      | {
          ephemeral_5m_input_tokens?: number;
          ephemeral_1h_input_tokens?: number;
        }
      | undefined;
    const cacheCreationEphemeral5mTokens =
      cacheCreationBreakdown?.ephemeral_5m_input_tokens ?? null;
    const cacheCreationEphemeral1hTokens =
      cacheCreationBreakdown?.ephemeral_1h_input_tokens ?? null;
    const serverToolUse = (requestUsage as Record<string, unknown> | undefined)
      ?.server_tool_use as
      | { web_search_requests?: number; code_execution_requests?: number }
      | undefined;
    const serverToolUseWebSearchRequests =
      serverToolUse?.web_search_requests ?? null;
    const serverToolUseCodeExecutionRequests =
      serverToolUse?.code_execution_requests ?? null;
    const audioTokens =
      (ctdExt?.audio_tokens as number | undefined) ??
      (ptdExt?.audio_tokens as number | undefined) ??
      null;
    const acceptedPredictionTokens =
      (ctdExt?.accepted_prediction_tokens as number | undefined) ?? null;
    const rejectedPredictionTokens =
      (ctdExt?.rejected_prediction_tokens as number | undefined) ?? null;
    // Normalise empty strings to null. Some upstreams return
    // `system_fingerprint: ""` on error paths; we want the audit
    // column to mean "feature reported" — empty values become null.
    const rawSystemFingerprint = (
      responseData as { system_fingerprint?: string } | null
    )?.system_fingerprint;
    const systemFingerprint =
      typeof rawSystemFingerprint === 'string' &&
      rawSystemFingerprint.length > 0
        ? rawSystemFingerprint
        : null;
    const rawServiceTier = (responseData as { service_tier?: string } | null)
      ?.service_tier;
    const serviceTier =
      typeof rawServiceTier === 'string' && rawServiceTier.length > 0
        ? rawServiceTier
        : null;

    const cost = requestUsage
      ? await this.costService.calculate({
          provider: modelConfig.provider,
          model: modelConfig.model,
          promptTokens: requestUsage.prompt_tokens,
          // OpenAI SDK still names this `completion_tokens` on the
          // wire — our internal `outputTokens` follows the renamed
          // column.
          outputTokens: requestUsage.completion_tokens,
          cachedTokens,
          reasoningTokens,
          cacheCreationInputTokens,
          cacheCreationEphemeral5mTokens,
          cacheCreationEphemeral1hTokens,
        })
      : null;

    // Record the extended-usage and cost histograms only when the
    // upstream actually reported the value — recording `0` would
    // skew the distribution toward zero for providers that don't
    // surface the field at all (e.g. OpenAI never reports
    // `cache_creation_input_tokens`).
    if (cachedTokens != null) {
      this.cacheTokensHistogram.record(cachedTokens, metricsAttributes);
    }
    if (cacheCreationInputTokens != null) {
      this.cacheCreationTokensHistogram.record(
        cacheCreationInputTokens,
        metricsAttributes
      );
    }
    if (reasoningTokens != null) {
      this.reasoningTokensHistogram.record(reasoningTokens, metricsAttributes);
    }
    if (cost?.totalCost != null && Number.isFinite(cost.totalCost)) {
      this.costHistogram.record(cost.totalCost, metricsAttributes);
    }

    this.requestAuditService.push({
      ...baseEventProps,
      resourceId:
        baseEventProps.resourceId === 'ephemeral'
          ? null
          : baseEventProps.resourceId,
      statusCode: HttpStatus.OK,
      type: PublicRequestAuditType.COMPLETION,
      events: auditEvents,
      requestPayload: requestPayload as CompletionRequestDto,
      providerRequestPayload,
      responseData: Array.isArray(responseData)
        ? responseData
        : responseData
        ? [responseData]
        : null,
      responseHeaders,
      duration: requestDuration,
      provider: modelConfig.provider,
      messageId,
      promptTokens: requestUsage?.prompt_tokens ?? null,
      outputTokens: requestUsage?.completion_tokens ?? null,
      totalTokens: requestUsage?.total_tokens ?? null,
      cachedTokens,
      reasoningTokens,
      cacheCreationInputTokens,
      cacheCreationEphemeral5mTokens,
      cacheCreationEphemeral1hTokens,
      serverToolUseWebSearchRequests,
      serverToolUseCodeExecutionRequests,
      audioTokens,
      acceptedPredictionTokens,
      rejectedPredictionTokens,
      systemFingerprint,
      serviceTier,
      tokensPerSecond,
      timeToFirstToken,
      requestDuration,
      providerDuration,
      gateDuration,
      routingDuration,
      errorCount: 0,
      successCount: 1,
      // Sourced via `baseEventProps.metadata` (computed at the
      // caller, where `payload.vmx?.metadata` already reflects
      // header-derived fields applied by `applyVmxHeadersToCanonical`).
      // Reading off `requestPayload` here would silently drop
      // header-supplied metadata, since the original wire body
      // never carries the merged-in header fields.
      metadata: baseEventProps.metadata ?? null,
      cost,
    });

    const requestLimit = responseHeaders?.['x-ratelimit-limit-requests'];
    const tokensLimit = responseHeaders?.['x-ratelimit-limit-tokens'];

    if (requestLimit && tokensLimit) {
      const discoveredCapacity =
        aiConnection.discoveredCapacity?.models[modelConfig.model];

      const capacityIndex = discoveredCapacity?.capacity?.findIndex(
        (c) => c.period === CapacityPeriod.MINUTE
      );
      const capacity =
        capacityIndex !== undefined && capacityIndex !== -1
          ? discoveredCapacity?.capacity?.[capacityIndex]
          : undefined;

      if (
        capacity?.tokens !== parseInt(tokensLimit) ||
        capacity?.requests !== parseInt(requestLimit)
      ) {
        const newCapacity = [...(discoveredCapacity?.capacity ?? [])];
        if (capacity) {
          capacity.requests = parseInt(requestLimit);
          capacity.tokens = parseInt(tokensLimit);
        } else {
          newCapacity.push({
            period: CapacityPeriod.MINUTE,
            enabled: true,
            requests: parseInt(requestLimit),
            tokens: parseInt(tokensLimit),
          });
        }

        this.logger.info(
          {
            workspaceId: baseEventProps.workspaceId,
            environmentId: baseEventProps.environmentId,
            connectionId: aiConnection.connectionId,
            model: modelConfig.model,
            capacity,
            newCapacity,
          },
          'Updating discovered capacity'
        );
        await this.aiConnectionService.updateDiscoveredCapacity(
          baseEventProps.workspaceId,
          baseEventProps.environmentId,
          aiConnection.connectionId,
          {
            models: {
              ...(aiConnection.discoveredCapacity?.models ?? {}),
              [modelConfig.model]: {
                capacity: newCapacity,
                updatedAt: new Date().toISOString(),
              },
            },
          }
        );
      }
    }
  }

  private parseProviderError(err: unknown) {
    let failureReason = 'Internal server error';
    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let errorMessage = 'Internal server error';
    let headers: CompletionHeaders | null = null;
    if (err instanceof CompletionError) {
      statusCode = err.data.statusCode;
      failureReason = err.data.failureReason ?? failureReason;
      errorMessage = err.data.message;
      headers = err.data.headers ?? null;
    } else if (err instanceof Error) {
      errorMessage = err.message;
    }

    return { failureReason, statusCode, errorMessage, headers };
  }

  /**
   * Maps the in-memory `'ephemeral'` sentinel back to `null` for
   * downstream sinks whose `resourceId` column is a real UUID
   * (`request_audit.resource_id`, `completion_metrics.resource_id`).
   * Persisting `'ephemeral'` would 22P02 the entire batch insert and
   * — because the audit flush bundles up to 25 rows in one
   * transaction — silently drop unrelated audit rows that happened
   * to share the flush window. The connection/provider/model fields
   * still capture which model was hit, so no information is lost.
   */
  private auditResourceId(
    resource: AIResourceEntity | null | undefined
  ): string | null {
    const id = resource?.resourceId;
    if (!id || id === 'ephemeral') return null;
    return id;
  }

  private async getAIResource(
    workspaceId: string,
    environmentId: string,
    resourceName: string,
    resourceConfigOverrides?: PartialAIResourceDto | null
  ): Promise<AIResourceEntity> {
    if (resourceName !== 'default' && resourceName.includes('/')) {
      const [connectionName, ...modelParts] = resourceName.split('/');
      const modelName = modelParts.join('/');
      if (connectionName && modelName) {
        const connection = await this.aiConnectionService.getByName(
          workspaceId,
          environmentId,
          connectionName,
          false
        );
        if (connection) {
          return {
            resourceId: 'ephemeral',
            workspaceId,
            environmentId,
            name: resourceName,
            description: null,
            model: {
              provider: connection.provider,
              model: modelName,
              connectionId: connection.connectionId,
            },
            fallbackModels: [],
            secondaryModels: [],
            routing: null,
            capacity: [],
            useFallback: false,
            enforceCapacity: false,
          } as unknown as AIResourceEntity;
        }
      }
    }

    const aiResourceEntity = await this.aiResourceService.getByName(
      workspaceId,
      environmentId,
      resourceName === 'default' ? 'default' : resourceName,
      /**
       * If the resource config overrides provides the minimum,
       * we don't need to throw an error if the resource is not found.
       */
      !resourceConfigOverrides?.model
    );

    // Resolve any `connectionName` references on the per-request override
    // BEFORE merging — callers can send name-only model configs and the
    // gateway looks them up here so the merged entity always carries a
    // resolved `connectionId` UUID.
    const normalizedOverrides = resourceConfigOverrides
      ? await resolveAllModelConnections(
          resourceConfigOverrides,
          workspaceId,
          environmentId,
          this.aiConnectionService
        )
      : null;

    // Deep-clone the resource before merge — `lodash.merge` mutates
    // its first argument, and `aiResourceEntity` is a cache hit on
    // hot paths. Without the clone, every override would persist into
    // the cached row and bleed into subsequent requests for the same
    // resource. (Surfaced by the connection-name override spec when
    // two tests shared the same `baseResource` object.)
    const mergedResource = merge(
      aiResourceEntity ? structuredClone(aiResourceEntity) : {},
      normalizedOverrides || {}
    ) as AIResourceEntity;

    if (!aiResourceEntity) {
      mergedResource.resourceId = 'ephemeral';
    }

    return mergedResource;
  }
}

/**
 * Build the canonical-Responses-shape `RoutingContext` the routing /
 * gating engine evaluates against. After the canonical-shape flip
 * `payload` is *already* Responses canonical — every public-endpoint
 * controller normalizes its inbound body before calling the
 * orchestrator. The envelope still carries the original wire body so
 * advanced templates can branch on `request.format` and read fields
 * the canonical Responses conversion drops.
 */
export function buildRoutingContext(
  payload: CanonicalRequestDto,
  envelope: DispatchedFormat | undefined
): RoutingContext {
  return {
    format: envelope?.format ?? 'responses',
    responses: payload,
    native: (envelope?.body ?? payload) as RoutingContext['native'],
  };
}
