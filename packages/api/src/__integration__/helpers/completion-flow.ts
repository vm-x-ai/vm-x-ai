import { vi } from 'vitest';
import type { Counter, Histogram } from '@opentelemetry/api';
import type { PinoLogger } from 'nestjs-pino';
import type { MetricService } from 'nestjs-otel';
import type {
  ChatCompletion,
  ChatCompletionChunk,
} from 'openai/resources/index.js';
import type {
  CompletionProvider,
  CompletionResponse,
  CompletionRequestOptions,
} from '../../ai-provider/ai-provider.types';
import type { AIConnectionEntity } from '../../ai-connection/entities/ai-connection.entity';
import type { AIResourceEntity } from '../../ai-resource/entities/ai-resource.entity';
import type { AIResourceModelConfigEntity } from '../../ai-resource/common/model.entity';
import { AIConnectionService } from '../../ai-connection/ai-connection.service';
import { AIProviderService } from '../../ai-provider/ai-provider.service';
import { AIResourceService } from '../../ai-resource/ai-resource.service';
import { ResourceRoutingService } from '../../gateway/routing.service';
import { GateService } from '../../gateway/gate.service';
import { RequestUsageService } from '../../usage/usage.service';
import { CompletionMetricsService } from '../../gateway/metrics/metrics.service';
import { RequestAuditService } from '../../audit/audit.service';
import { TokenService } from '../../token/token.service';
import { CostService } from '../../gateway/cost/cost.service';
import { GatewayOrchestratorService } from '../../gateway/gateway-orchestrator.service';
import type {
  CanonicalRequestDto,
  CompletionRequestDto,
} from '../../gateway/dto/completion-request.dto';
import {
  chatCompletionStreamToResponseStream,
  chatCompletionToResponse,
} from '../../gateway/responses/responses-converter';
import { openAIResponseToAnthropic } from '../../gateway/anthropic/anthropic-converter';
import { chatCompletionsToResponsesRequest } from '../../gateway/responses/from-chat-completions';
import { anthropicToResponsesRequest } from '../../gateway/responses/from-anthropic';
import { v4 as uuidv4 } from 'uuid';

/**
 * Test scaffolding for {@link GatewayOrchestratorService} end-to-end tests.
 *
 * The full request flow has many collaborators (resource lookup,
 * routing, gate, provider dispatch, audit, cost). Wiring those up by
 * hand in every spec is noisy and obscures the actual assertion. This
 * helper builds a `GatewayOrchestratorService` instance with realistic mocks
 * for every collaborator + a configurable mock provider, and exposes
 * the spies as a flat `harness` object so each test can pre-program
 * the response and inspect what the service did.
 *
 * The mocks are NOT a formal NestJS test module — they're typed stubs
 * that satisfy the constructor signatures. We deliberately bypass the
 * NestJS DI container so the tests stay fast and cache-friendly.
 */

export type FlowHarnessOptions = {
  /** Resource returned by `AIResourceService.getByName`. */
  resource?: AIResourceEntity;
  /** Connection returned by `AIConnectionService.getById`. */
  connection?: AIConnectionEntity;
  /** Provider response — non-streaming ChatCompletion. */
  providerResponse?: Partial<ChatCompletion>;
  /** Streaming chunks (yielded in order) — when set, returned shape
   *  is `AsyncIterable<ChatCompletionChunk>` instead of `ChatCompletion`. */
  providerStream?: ChatCompletionChunk[];
  /**
   * Make the provider throw when called. Used to test error paths +
   * the fallback loop. The error is the value thrown.
   */
  providerThrows?: unknown;
  /** Headers returned by the provider. */
  providerHeaders?: Record<string, string>;
};

export type FlowHarness = {
  /**
   * The harness `service` exposes the orchestrator's surface that flow
   * specs actually use: `completion()` (with a widened payload type so
   * specs can pass a Chat-Completions-shape body — the runtime wrapper
   * auto-canonicalizes) and a test-only `complete({format, body})`
   * shim that mirrors the deleted Phase-E entrypoint. Other class
   * methods are intentionally not surfaced — spec files don't reach
   * for them.
   */
  service: {
    completion: (
      workspaceId: string,
      environmentId: string,
      payload: CanonicalRequestDto | CompletionRequestDto,
      ...rest: unknown[]
    ) => Promise<CompletionResponse>;
    complete: (
      workspaceId: string,
      environmentId: string,
      request:
        | { format: 'chat-completions'; body: unknown }
        | { format: 'responses'; body: unknown }
        | { format: 'anthropic'; body: unknown },
      ...rest: unknown[]
    ) => Promise<{
      format: 'chat-completions' | 'responses' | 'anthropic';
      data: unknown;
      headers: Record<string, string | undefined>;
    }>;
  };
  /**
   * The mocked `AIConnectionService` collaborator. Exposed so tests
   * can program the per-name lookup behind
   * `vmx.resourceConfigOverrides.model.connectionName` — the resolver
   * calls `getByName` on this service before merging the override
   * into the resource entity.
   */
  aiConnectionService: AIConnectionService;
  spies: {
    gateRequest: ReturnType<typeof vi.fn>;
    auditPush: ReturnType<typeof vi.fn>;
    usagePush: ReturnType<typeof vi.fn>;
    metricsPush: ReturnType<typeof vi.fn>;
    routingEvaluate: ReturnType<typeof vi.fn>;
    providerComplete: ReturnType<typeof vi.fn>;
    providerCompletion: ReturnType<typeof vi.fn>;
    costCalculate: ReturnType<typeof vi.fn>;
    pricingByProviderModel: ReturnType<typeof vi.fn>;
    connectionGetById: ReturnType<typeof vi.fn>;
    resourceGetByName: ReturnType<typeof vi.fn>;
    aiProviderGet: ReturnType<typeof vi.fn>;
  };
};

const defaultResource = (
  overrides: Partial<AIResourceEntity> = {}
): AIResourceEntity =>
  ({
    resourceId: 'res-1',
    workspaceId: 'ws-1',
    environmentId: 'env-1',
    name: 'default',
    description: null,
    model: { provider: 'openai', model: 'gpt-4o-mini', connectionId: 'conn-1' },
    fallbackModels: [],
    secondaryModels: [],
    routing: null,
    capacity: [],
    useFallback: false,
    enforceCapacity: false,
    ...overrides,
  } as unknown as AIResourceEntity);

const defaultConnection = (
  overrides: Partial<AIConnectionEntity> = {}
): AIConnectionEntity =>
  ({
    connectionId: 'conn-1',
    workspaceId: 'ws-1',
    environmentId: 'env-1',
    name: 'openai-default',
    provider: 'openai',
    description: null,
    config: { apiKey: 'sk-test' },
    capacity: [],
    discoveredCapacity: null,
    allowedModels: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: 'test',
    updatedBy: 'test',
    ...overrides,
  } as unknown as AIConnectionEntity);

const defaultChatCompletion = (
  overrides: Partial<ChatCompletion> = {}
): ChatCompletion =>
  ({
    id: 'cmpl_test',
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: 'gpt-4o-mini',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: 'pong',
          refusal: null,
        },
        finish_reason: 'stop',
        logprobs: null,
      },
    ],
    usage: {
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
    },
    ...overrides,
  } as unknown as ChatCompletion);

/**
 * Build a stub OpenTelemetry `MetricService` whose Counter/Histogram
 * helpers all return no-op singletons. The service constructor reads
 * a dozen counters and histograms; faking them lets us boot without a
 * real OTEL pipeline.
 */
function makeMetricService(): MetricService {
  const noopCounter = { add: vi.fn() } as unknown as Counter;
  const noopHistogram = { record: vi.fn() } as unknown as Histogram;
  return {
    getCounter: () => noopCounter,
    getHistogram: () => noopHistogram,
  } as unknown as MetricService;
}

function makeLogger(): PinoLogger {
  const noop = () => undefined;
  return {
    info: noop,
    debug: noop,
    warn: noop,
    error: noop,
    fatal: noop,
    trace: noop,
    setContext: noop,
  } as unknown as PinoLogger;
}

export function buildCompletionFlowHarness(
  opts: FlowHarnessOptions = {}
): FlowHarness {
  const resource = opts.resource ?? defaultResource();
  const connection = opts.connection ?? defaultConnection();
  const providerHeaders = opts.providerHeaders ?? {};

  const providerCompletion = vi.fn(
    async (
      _request: unknown,
      _connection: AIConnectionEntity,
      _model: AIResourceModelConfigEntity,
      _options?: CompletionRequestOptions
    ): Promise<CompletionResponse> => {
      if (opts.providerThrows) throw opts.providerThrows;
      if (opts.providerStream) {
        const chunks = opts.providerStream;
        async function* gen() {
          for (const chunk of chunks) yield chunk;
        }
        return {
          data: gen() as never,
          headers: providerHeaders,
          providerRequestPayload: _request,
        };
      }
      return {
        data: defaultChatCompletion(opts.providerResponse) as never,
        headers: providerHeaders,
        providerRequestPayload: _request,
      };
    }
  );

  // Pure observation spy. The new harness wrappers below call this
  // alongside `providerCompletion` so legacy assertions written
  // against `provider.complete()` still see the dispatched
  // GatewayRequest envelope. It does NOT chain into providerCompletion
  // — chaining would double-count the dispatch.
  const providerComplete = vi.fn();

  // The 3-method interface — each method routes through the same
  // underlying fake (`providerCompletion`) and ALSO records the call
  // on `providerComplete` with a synthetic GatewayRequest envelope so
  // legacy assertions written against the old `complete({format,body})`
  // API still observe the right dispatch. Phase E will split these
  // paths into per-format gateway services and the harness will gain
  // a per-format spy (one per service).
  const providerOpenAICompletion = vi.fn(
    async (
      request: unknown,
      connection: AIConnectionEntity,
      model: AIResourceModelConfigEntity,
      options?: CompletionRequestOptions
    ) => {
      providerComplete(
        { format: 'chat-completions', body: request },
        connection,
        model,
        options
      );
      return providerCompletion(request, connection, model, options);
    }
  );
  // The native Responses path through the dispatch helpers (and
  // future native passthrough) returns native `Response` /
  // `ResponseStreamEvent` shapes — not ChatCompletion. The harness
  // mirrors that by converting the underlying ChatCompletion fake's
  // output before handing it back, so flow tests that exercise the
  // full orchestrator see the same shape production sees.
  const providerOpenAIResponse = vi.fn(
    async (
      request: unknown,
      connection: AIConnectionEntity,
      model: AIResourceModelConfigEntity,
      options?: CompletionRequestOptions
    ) => {
      providerComplete(
        { format: 'responses', body: request },
        connection,
        model,
        options
      );
      const inner = await providerCompletion(
        request,
        connection,
        model,
        options
      );
      const responseId = `resp_${uuidv4()}`;
      const createdAt = Math.floor(Date.now() / 1000);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const isIter = (v: any): v is AsyncIterable<any> =>
        v != null && typeof v[Symbol.asyncIterator] === 'function';
      if (isIter(inner.data)) {
        return {
          data: chatCompletionStreamToResponseStream(
            inner.data as never,
            responseId,
            createdAt,
            model.model
          ) as never,
          headers: inner.headers,
          providerRequestPayload: inner.providerRequestPayload,
        };
      }
      return {
        data: chatCompletionToResponse(
          inner.data as never,
          responseId,
          createdAt,
          model.model,
          // Echo client-provided Responses-API fields (instructions,
          // metadata, tools, etc.) on the response — production
          // does this via the dispatch helper passing `request`.
          request as never
        ) as never,
        headers: inner.headers,
        providerRequestPayload: inner.providerRequestPayload,
      };
    }
  );
  // Likewise, anthropicMessages on most providers either returns
  // native Anthropic `Message` (passthrough) or runs the
  // ChatCompletion → Anthropic converter (cross-format providers).
  // Mirror the converter path here so the orchestrator sees what
  // production would.
  const providerAnthropicMessages = vi.fn(
    async (
      request: unknown,
      connection: AIConnectionEntity,
      model: AIResourceModelConfigEntity,
      options?: CompletionRequestOptions
    ) => {
      providerComplete(
        { format: 'anthropic', body: request },
        connection,
        model,
        options
      );
      const inner = await providerCompletion(
        request,
        connection,
        model,
        options
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const isIter = (v: any): v is AsyncIterable<any> =>
        v != null && typeof v[Symbol.asyncIterator] === 'function';
      if (isIter(inner.data)) {
        // Anthropic streaming output via converter is the Phase C
        // follow-up. For now flow tests on the streaming Anthropic
        // path forward the underlying ChatCompletionChunk stream
        // verbatim (parity with the pre-rewrite behaviour).
        return inner;
      }
      return {
        data: openAIResponseToAnthropic(
          inner.data as never,
          model.model
        ) as never,
        headers: inner.headers,
        providerRequestPayload: inner.providerRequestPayload,
      };
    }
  );
  const provider: CompletionProvider = {
    provider: { id: 'openai' } as never,
    openAICompletion: providerOpenAICompletion as never,
    openAIResponse: providerOpenAIResponse as never,
    anthropicMessages: providerAnthropicMessages as never,
  };

  const aiProviderGet = vi.fn().mockReturnValue(provider);
  const aiProviderService = {
    get: aiProviderGet,
  } as unknown as AIProviderService;

  const connectionGetById = vi.fn().mockResolvedValue(connection);
  const aiConnectionService = {
    getById: connectionGetById,
    getByName: vi.fn().mockResolvedValue(null),
  } as unknown as AIConnectionService;

  const resourceGetByName = vi.fn().mockResolvedValue(resource);
  const aiResourceService = {
    getByName: resourceGetByName,
  } as unknown as AIResourceService;

  const routingEvaluate = vi.fn().mockResolvedValue(null);
  const resourceRoutingService = {
    evaluateRoutingConditions: routingEvaluate,
  } as unknown as ResourceRoutingService;

  const gateRequest = vi.fn().mockResolvedValue([]);
  const gateService = {
    requestGate: gateRequest,
    increaseTokenResponseUsage: vi.fn().mockResolvedValue(undefined),
  } as unknown as GateService;

  const usagePush = vi.fn();
  const requestUsageService = {
    push: usagePush,
  } as unknown as RequestUsageService;

  const metricsPush = vi.fn();
  const completionMetricsService = {
    push: metricsPush,
    getErrorRate: vi.fn().mockResolvedValue({ errorRate: 0 }),
  } as unknown as CompletionMetricsService;

  const auditPush = vi.fn();
  const requestAuditService = {
    push: auditPush,
  } as unknown as RequestAuditService;

  // Use the real TokenService — token estimation is deterministic and
  // its own collaborator graph (none) is trivial.
  const tokenService = new TokenService(makeLogger());

  const pricingByProviderModel = vi.fn().mockResolvedValue({
    inputCostPerToken: 0.000003,
    outputCostPerToken: 0.000015,
    cachedInputCostPerToken: 0.0000003,
    reasoningCostPerToken: 0,
  });
  const costCalculate = vi.fn(
    async (input: { promptTokens?: number; outputTokens?: number }) => {
      const inputCost = (input.promptTokens ?? 0) * 0.000003;
      const outputCost = (input.outputTokens ?? 0) * 0.000015;
      return {
        inputCost,
        outputCost,
        cachedCost: 0,
        reasoningCost: 0,
        cacheCreationCost: 0,
        totalCost: inputCost + outputCost,
        currency: 'USD',
      };
    }
  );
  const costService = { calculate: costCalculate } as unknown as CostService;

  const innerService = new GatewayOrchestratorService(
    makeLogger(),
    aiProviderService,
    aiConnectionService,
    aiResourceService,
    resourceRoutingService,
    gateService,
    requestUsageService,
    completionMetricsService,
    requestAuditService,
    tokenService,
    makeMetricService(),
    costService
  );

  // Auto-canonicalize wrapper around `completion()` — flow specs
  // historically pass a Chat-Completions-shape body straight in.
  // Post-canonical-flip the orchestrator expects Responses canonical;
  // detect the CC shape (presence of top-level `messages`) and run the
  // same chat-completions → responses normalization the public
  // controller does, threading the original CC body via
  // `originalGatewayRequest`. Tests written against the new canonical
  // shape (no `messages` field, has `input` / `instructions`) flow
  // through unchanged.
  const innerCompletion = innerService.completion.bind(innerService);
  innerService.completion = (async (
    workspaceId: string,
    environmentId: string,
    payload: unknown,
    apiKey?: unknown,
    request?: unknown,
    batch?: unknown,
    user?: unknown,
    abortSignal?: unknown,
    originalRequestForAudit?: unknown,
    originalGatewayRequest?: unknown
  ) => {
    const looksLikeCC =
      payload != null &&
      typeof payload === 'object' &&
      Array.isArray((payload as { messages?: unknown }).messages);
    if (looksLikeCC && originalGatewayRequest === undefined) {
      const ccBody = payload as Parameters<
        typeof chatCompletionsToResponsesRequest
      >[0];
      const canonical = chatCompletionsToResponsesRequest(ccBody);
      return innerCompletion(
        workspaceId,
        environmentId,
        canonical as never,
        apiKey as never,
        request as never,
        batch as never,
        user as never,
        abortSignal as never,
        originalRequestForAudit ?? ccBody,
        { format: 'chat-completions', body: ccBody } as never
      );
    }
    return innerCompletion(
      workspaceId,
      environmentId,
      payload as never,
      apiKey as never,
      request as never,
      batch as never,
      user as never,
      abortSignal as never,
      originalRequestForAudit,
      originalGatewayRequest as never
    );
  }) as never;

  // Widen the harness's `completion()` parameter type so existing flow
  // specs can pass a Chat-Completions-shape body directly — the runtime
  // wrapper above auto-canonicalizes anything that looks like CC. The
  // wrapped signature accepts the union of canonical + the legacy
  // CC-shape DTOs so static type-check passes for the historical test
  // call style.
  type WidenedCompletion = (
    workspaceId: string,
    environmentId: string,
    payload: CanonicalRequestDto | CompletionRequestDto,
    ...rest: unknown[]
  ) => Promise<CompletionResponse>;

  type TestHarnessService = GatewayOrchestratorService & {
    completion: WidenedCompletion;
    complete: (
      workspaceId: string,
      environmentId: string,
      request:
        | { format: 'chat-completions'; body: unknown }
        | { format: 'responses'; body: unknown }
        | { format: 'anthropic'; body: unknown },
      ...rest: unknown[]
    ) => Promise<{
      format: 'chat-completions' | 'responses' | 'anthropic';
      data: unknown;
      headers: Record<string, string | undefined>;
    }>;
  };

  // Test-side `complete()` shim that mirrors the old gateway entrypoint
  // (deleted in Phase E) so existing flow specs keep their concise
  // `service.complete({format,body})` calls. Internally builds the
  // canonical Responses-shape body via the same converters the per-format
  // services (`ResponsesService`, `AnthropicMessagesService`) use, then
  // calls `completion()` with the dispatched-format envelope. Returns
  // `{format, data, headers}` matching the old shape.
  const service = innerService as unknown as TestHarnessService;
  service.complete = async (workspaceId, environmentId, request) => {
    // Mirror what each public-endpoint controller does: convert the
    // inbound wire body to canonical Responses shape, thread the
    // original wire body through `originalGatewayRequest` so dispatch
    // emits in the right wire format.
    let canonical: unknown;
    if (request.format === 'responses') {
      canonical = request.body;
    } else if (request.format === 'anthropic') {
      canonical = anthropicToResponsesRequest(
        request.body as Parameters<typeof anthropicToResponsesRequest>[0]
      );
    } else {
      canonical = chatCompletionsToResponsesRequest(
        request.body as Parameters<typeof chatCompletionsToResponsesRequest>[0]
      );
    }
    const result = await innerService.completion(
      workspaceId,
      environmentId,
      canonical as never,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      request.body,
      request as never
    );
    return {
      format: request.format,
      data: result.data,
      headers: result.headers,
    };
  };

  return {
    service,
    // Exposed so tests can program the connection-name lookup behind
    // `vmx.resourceConfigOverrides.model.connectionName`. The
    // resolver calls `getByName` on this service before merging the
    // override into the resource entity.
    aiConnectionService,
    spies: {
      gateRequest,
      auditPush,
      usagePush,
      metricsPush,
      routingEvaluate,
      providerComplete,
      providerCompletion,
      costCalculate,
      pricingByProviderModel,
      connectionGetById,
      resourceGetByName,
      aiProviderGet,
    },
  };
}

/** Build a streaming-shape ChatCompletionChunk for tests. */
export function makeChunk(
  overrides: Partial<ChatCompletionChunk> = {}
): ChatCompletionChunk {
  return {
    id: 'chunk_test',
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: 'gpt-4o-mini',
    choices: [
      {
        index: 0,
        delta: { role: 'assistant', content: 'tok' },
        finish_reason: null,
        logprobs: null,
      },
    ],
    ...overrides,
  } as unknown as ChatCompletionChunk;
}

export function makeFinalChunk(): ChatCompletionChunk {
  return {
    id: 'chunk_final',
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: 'gpt-4o-mini',
    choices: [
      {
        index: 0,
        delta: {},
        finish_reason: 'stop',
        logprobs: null,
      },
    ],
    usage: {
      prompt_tokens: 8,
      completion_tokens: 4,
      total_tokens: 12,
    },
  } as unknown as ChatCompletionChunk;
}
