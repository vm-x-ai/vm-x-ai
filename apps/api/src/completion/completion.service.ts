import { HttpStatus, Injectable } from '@nestjs/common';
import { AIConnectionService } from '../ai-connection/ai-connection.service';
import { AIProviderService } from '../ai-provider/ai-provider.service';
import { AIResourceService } from '../ai-resource/ai-resource.service';
import { throwServiceError } from '../error';
import { ErrorCode } from '../error-code';
import { CompletionUsageService } from './usage/usage.service';
import { CompletionMetricsService } from './metrics/metrics.service';
import { CompletionAuditService } from './audit/audit.service';
import {
  CompletionNonStreamingRequestDto,
  CompletionRequestDto,
  CompletionStreamingRequestDto,
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
import { PublicCompletionAuditType } from '../storage/entities.generated';
import {
  CompletionAuditEventEntity,
  CompletionAuditEventType,
} from './audit/entities/audit.entity';
import { CompletionError } from './completion.types';
import { AIResourceModelConfigEntity } from '../ai-resource/common/model.entity';
import { CompletionUsage } from 'openai/resources/completions.js';
import {
  CompletionHeaders,
  CompletionNonStreamingResponse,
  CompletionResponse,
  CompletionResponseData,
  CompletionStreamingResponse,
} from '../ai-provider/ai-provider.types';
import { isAsyncIterable } from '../utils/async';
import { ChatCompletionChunk } from 'openai/resources/index.js';
import { AIConnectionEntity } from '../ai-connection/entities/ai-connection.entity';
import { CapacityPeriod } from '../capacity/capacity.entity';
import os from 'os';
import { CompletionBatchEntity } from './batch/entity/batch.entity';
import merge from 'lodash.merge';

@Injectable()
export class CompletionService {
  constructor(
    private readonly logger: PinoLogger,
    private readonly aiProviderService: AIProviderService,
    private readonly aiConnectionService: AIConnectionService,
    private readonly aiResourceService: AIResourceService,
    private readonly resourceRoutingService: ResourceRoutingService,
    private readonly gateService: GateService,
    private readonly completionUsageService: CompletionUsageService,
    private readonly completionMetricsService: CompletionMetricsService,
    private readonly completionAuditService: CompletionAuditService,
    private readonly tokenService: TokenService
  ) {}

  public async completion(
    workspaceId: string,
    environmentId: string,
    resource: string,
    payload: CompletionNonStreamingRequestDto,
    apiKey?: ApiKeyEntity,
    request?: FastifyRequest,
    batch?: CompletionBatchEntity
  ): Promise<CompletionNonStreamingResponse>;

  public async completion(
    workspaceId: string,
    environmentId: string,
    resource: string,
    payload: CompletionStreamingRequestDto,
    apiKey?: ApiKeyEntity,
    request?: FastifyRequest,
    batch?: CompletionBatchEntity
  ): Promise<CompletionStreamingResponse>;

  public async completion(
    workspaceId: string,
    environmentId: string,
    resource: string,
    payload: CompletionRequestDto,
    apiKey?: ApiKeyEntity,
    request?: FastifyRequest,
    batch?: CompletionBatchEntity
  ): Promise<CompletionResponse>;

  public async completion(
    workspaceId: string,
    environmentId: string,
    resource: string,
    payload: CompletionRequestDto,
    apiKey?: ApiKeyEntity,
    request?: FastifyRequest,
    batch?: CompletionBatchEntity
  ): Promise<CompletionResponse> {
    const sourceIp = request ? getSourceIpFromRequest(request) : os.hostname();
    let modelConfig: AIResourceModelConfigEntity | null = null;
    let requestAt: Date = new Date();
    let routingDuration: number | null = null;
    let gateDuration: number | null = null;
    const providerDuration: number | null = null;
    let providerStartAt: number | null = null;
    let timeToFirstToken: number | null = null;
    const tokensPerSecond: number | null = null;
    let messageId: string | null = null;
    const auditEvents: CompletionAuditEventEntity[] = [];
    const requestId = uuidv4();

    try {
      const aiResource = await this.getAIResource(
        workspaceId,
        environmentId,
        resource,
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

      const requestTokens = this.tokenService.getRequestTokens(payload);

      const shouldRoute = usePrimaryModel && aiResource.routing?.enabled;
      if (shouldRoute) {
        const routingStartAt = Date.now();
        try {
          const routingResult =
            await this.resourceRoutingService.evaluateRoutingConditions(
              workspaceId,
              environmentId,
              payload,
              requestTokens,
              aiResource
            );
          if (routingResult) {
            auditEvents.push({
              timestamp: new Date(),
              type: CompletionAuditEventType.ROUTING,
              data: {
                originalModel: modelConfig,
                routedModel: routingResult.model,
                matchedRoute: routingResult.matchedRoute,
              },
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

        const baseProps = {
          workspaceId,
          environmentId,
          resource,
          model: modelConfig.model,
          timestamp: requestAt,
          requestId,
          sourceIp,
          apiKeyId: apiKey?.apiKeyId,
          correlationId: payload.vmx?.correlationId,
          connectionId: modelConfig.connectionId,
        };

        try {
          const aiConnection = await this.aiConnectionService.getById({
            workspaceId,
            environmentId,
            connectionId: modelConfig.connectionId,
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

          const { vmx, ...rawPayload } = payload;
          providerStartAt = Date.now();
          let completionUsage: CompletionUsage | undefined = undefined;
          const providerResponse = await provider.completion(
            rawPayload,
            aiConnection,
            modelConfig
          );

          const responseData: CompletionResponseData[] = [];

          if (isAsyncIterable(providerResponse.data)) {
            async function* createDataStream(
              this: CompletionService,
              data: AsyncIterable<ChatCompletionChunk>,
              providerStartAt: number,
              modelConfig: AIResourceModelConfigEntity
            ) {
              for await (const chunk of data) {
                responseData.push(chunk);
                messageId = chunk.id;

                if (payload.stream && !timeToFirstToken && providerStartAt) {
                  timeToFirstToken = Date.now() - providerStartAt;
                }

                if (chunk.usage && !completionUsage) {
                  completionUsage = chunk.usage;
                }

                yield {
                  ...chunk,
                  vmx: {
                    events: auditEvents,
                    metrics: {
                      gateDurationMs: gateDuration ?? null,
                      routingDurationMs: routingDuration ?? null,
                      timeToFirstTokenMs: timeToFirstToken ?? null,
                      tokensPerSecond: tokensPerSecond ?? null,
                    },
                  },
                };
              }

              await this.postCompletion(
                requestAt,
                providerStartAt,
                payload,
                baseProps,
                aiConnection,
                evaluatedCapacities,
                modelConfig,
                messageId,
                gateDuration,
                routingDuration,
                timeToFirstToken,
                tokensPerSecond,
                completionUsage,
                auditEvents,
                responseData,
                providerResponse.headers
              );
            }

            return {
              data: createDataStream.bind(this)(
                providerResponse.data,
                providerStartAt,
                modelConfig
              ),
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
            completionUsage = providerResponse.data.usage;
            messageId = providerResponse.data.id;

            await this.postCompletion(
              requestAt,
              providerStartAt,
              payload,
              baseProps,
              aiConnection,
              evaluatedCapacities,
              modelConfig,
              messageId,
              gateDuration,
              routingDuration,
              timeToFirstToken,
              tokensPerSecond,
              completionUsage,
              auditEvents,
              providerResponse.data,
              providerResponse.headers
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
                  tokensPerSecond: tokensPerSecond ?? null,
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

          auditEvents.push({
            timestamp: new Date(),
            type: CompletionAuditEventType.FALLBACK,
            data: {
              model: modelConfig,
              failureReason,
              statusCode,
              errorMessage,
              headers,
            },
          });

          this.completionUsageService.push({
            ...baseProps,
            statusCode,
            provider: modelConfig.provider,
            messageId,
            gateDuration,
            routingDuration,
            timeToFirstToken,
            tokensPerSecond,
            requestDuration: Date.now() - requestAt.getTime(),
            error: true,
            failureReason,
          });
          this.completionMetricsService.push({
            ...baseProps,
            statusCode,
          });
        }
      }
    } catch (err) {
      const { failureReason, statusCode, errorMessage, headers } =
        this.parseProviderError(err);

      const baseProps = {
        workspaceId,
        environmentId,
        resource,
        model: modelConfig?.model,
        timestamp: requestAt,
        requestId,
        sourceIp,
        apiKeyId: apiKey?.apiKeyId,
        correlationId: payload.vmx?.correlationId,
        connectionId: modelConfig?.connectionId,
      };
      const requestDuration = Date.now() - requestAt.getTime();

      this.completionUsageService.push({
        ...baseProps,
        failureReason,
        statusCode,
        provider: modelConfig?.provider,
        messageId,
        gateDuration,
        providerDuration,
        routingDuration,
        timeToFirstToken,
        tokensPerSecond,
        requestDuration,
        error: true,
      });
      if (modelConfig) {
        this.completionMetricsService.push({
          ...baseProps,
          connectionId: modelConfig.connectionId,
          model: modelConfig.model,
          statusCode,
        });
      }
      this.completionAuditService.push({
        ...baseProps,
        statusCode,
        type: PublicCompletionAuditType.COMPLETION,
        events: auditEvents,
        requestPayload: payload,
        responseData: null,
        responseHeaders: headers,
        duration: requestDuration,
        errorMessage,
        failureReason,
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
    payload: CompletionRequestDto,
    gateDuration: number,
    routingDuration: number | null,
    auditEvents: CompletionAuditEventEntity[]
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
    vmxHeaders['x-vmx-connection-id'] = modelConfig.connectionId;

    if (auditEvents.length > 0) {
      vmxHeaders['x-vmx-event-count'] = auditEvents.length.toString();

      for (let i = 0; i < auditEvents.length; i++) {
        const event = auditEvents[i];
        vmxHeaders[`x-vmx-event-${i}-type`] = event.type;
        vmxHeaders[`x-vmx-event-${i}-timestamp`] =
          event.timestamp.toISOString();

        switch (event.type) {
          case CompletionAuditEventType.FALLBACK:
            vmxHeaders[`x-vmx-event-${i}-fallback-failed-model`] =
              event.data.model.model;
            vmxHeaders[`x-vmx-event-${i}-fallback-failure-reason`] =
              event.data.errorMessage;
            break;
          case CompletionAuditEventType.ROUTING:
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
    requestPayload: CompletionRequestDto,
    baseEventProps: {
      workspaceId: string;
      environmentId: string;
      resource: string;
      model: string;
      timestamp: Date;
      requestId: string;
      sourceIp: string;
      apiKeyId?: string;
      correlationId?: string | null;
      connectionId: string;
    },
    aiConnection: AIConnectionEntity,
    evaluatedCapacities: EvaluatedCapacity[],
    modelConfig: AIResourceModelConfigEntity,
    messageId: string | null,
    gateDuration: number | null,
    routingDuration: number | null,
    timeToFirstToken: number | null,
    tokensPerSecond: number | null,
    completionUsage: CompletionUsage | undefined,
    auditEvents: CompletionAuditEventEntity[],
    responseData: CompletionResponseData[] | CompletionResponseData | null,
    responseHeaders: CompletionHeaders | null
  ) {
    const requestDuration = Date.now() - requestAt.getTime();
    const providerDuration = Date.now() - providerStartAt;
    if (completionUsage) {
      tokensPerSecond =
        completionUsage.total_tokens / ((Date.now() - providerStartAt) / 1000);
    }

    if (completionUsage) {
      await this.gateService.increaseTokenResponseUsage(
        evaluatedCapacities,
        completionUsage
      );
    }
    this.completionUsageService.push({
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
      completionTokens: completionUsage?.completion_tokens,
      promptTokens: completionUsage?.prompt_tokens,
      totalTokens: completionUsage?.total_tokens,
    });
    this.completionMetricsService.push({
      ...baseEventProps,
      statusCode: HttpStatus.OK,
    });
    this.completionAuditService.push({
      ...baseEventProps,
      statusCode: HttpStatus.OK,
      type: PublicCompletionAuditType.COMPLETION,
      events: auditEvents,
      requestPayload,
      responseData: Array.isArray(responseData)
        ? responseData
        : responseData
        ? [responseData]
        : null,
      responseHeaders,
      duration: requestDuration,
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

  private async getAIResource(
    workspaceId: string,
    environmentId: string,
    resource: string,
    resourceConfigOverrides?: PartialAIResourceDto | null
  ): Promise<AIResourceEntity> {
    const aiResourceEntity = await this.aiResourceService.getById(
      {
        workspaceId,
        environmentId,
        resource,
        includesUsers: false,
      },
      /**
       * If the resource config overrides provides the minimum,
       * we don't need to throw an error if the resource is not found.
       */
      !resourceConfigOverrides?.model
    );

    return merge(
      aiResourceEntity || {},
      resourceConfigOverrides || {}
    ) as AIResourceEntity;
  }
}
