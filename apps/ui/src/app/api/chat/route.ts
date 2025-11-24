import { streamText, convertToModelMessages, smoothStream } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { AiResourceEntity } from '@/clients/api';
import { auth } from '@/auth';
import { ReadonlyHeaders } from 'next/dist/server/web/spec-extension/adapters/headers';
import { headers } from 'next/headers';
import { ChatMessage } from '@/components/Chat/types';

export type ChatRequest = {
  workspaceId: string;
  environmentId: string;
  resourceConfigOverrides: Partial<AiResourceEntity>;
  messages: ChatMessage[];
};

// Allow streaming responses up to 120 seconds
export const maxDuration = 120;

export async function POST(req: Request) {
  const {
    workspaceId,
    environmentId,
    resourceConfigOverrides,
    messages,
  }: ChatRequest = await req.json();

  const baseURL = `${process.env.API_BASE_URL}/v1/completion/${workspaceId}/${environmentId}/${resourceConfigOverrides.resource}`;
  const actionHeaders = await headers();
  const responseMetadata: ResponseMetadata = {};

  const result = streamText({
    model: await getLanguageModel(
      baseURL,
      actionHeaders,
      resourceConfigOverrides,
      responseMetadata
    ),
    messages: convertToModelMessages(messages),
    experimental_transform: smoothStream({
      delayInMs: 20,
    }),
  });

  return result.toUIMessageStreamResponse({
    originalMessages: messages,
    messageMetadata: () => {
      return {
        model: responseMetadata.model ?? '',
        provider: responseMetadata.provider ?? '',
        connectionId: responseMetadata.connectionId ?? '',
      };
    },
  });
}

type FallbackEvent = {
  type: 'fallback';
  timestamp: string;
  failedModel: string;
  failureReason: string;
};

type RoutingEvent = {
  type: 'routing';
  timestamp: string;
  originalProvider: string;
  originalModel: string;
  routedProvider: string;
  routedModel: string;
};

type ResponseMetadata = {
  model?: string | null;
  provider?: string | null;
  connectionId?: string | null;
  events?: Array<FallbackEvent | RoutingEvent>;
};

async function getLanguageModel(
  baseURL: string,
  actionHeaders: ReadonlyHeaders,
  resourceConfigOverrides: Partial<AiResourceEntity>,
  responseMetadata: ResponseMetadata
) {
  const session = await auth();
  if (!session) {
    throw new Error('Unauthorized');
  }

  return createOpenAI({
    apiKey: session.accessToken,
    baseURL,
    fetch: async (...args) => {
      const sourceIp = actionHeaders.get('x-forwarded-for');
      if (args[1] && sourceIp) {
        args[1].headers = {
          ...(args[1]?.headers ?? {}),
          'x-forwarded-for': sourceIp,
        };
      }

      if (args[1]?.body && resourceConfigOverrides) {
        args[1].body = JSON.stringify({
          ...JSON.parse(args[1].body as string),
          vmx: {
            resourceConfigOverrides,
          },
        });
      }

      const resp = await fetch(...args);

      responseMetadata.model = resp.headers.get('x-vmx-model');
      responseMetadata.provider = resp.headers.get('x-vmx-provider');
      responseMetadata.connectionId = resp.headers.get('x-vmx-connection-id');

      const eventCount = parseInt(
        resp.headers.get('x-vmx-event-count') ?? '0',
        10
      );

      if (eventCount > 0) {
        for (let i = 0; i < eventCount; i++) {
          const eventPath = `x-vmx-event-${i}`;
          const eventType = resp.headers.get(`${eventPath}-type`) ?? '';
          const eventTimestamp =
            resp.headers.get(`${eventPath}-timestamp`) ?? '';

          if (eventType === 'fallback') {
            responseMetadata.events?.push({
              type: eventType,
              timestamp: eventTimestamp,
              failedModel:
                resp.headers.get(`${eventPath}-fallback-failed-model`) ?? '',
              failureReason:
                resp.headers.get(`${eventPath}-fallback-failure-reason`) ?? '',
            });
          } else if (eventType === 'routing') {
            responseMetadata.events?.push({
              type: eventType,
              timestamp: eventTimestamp,
              originalProvider:
                resp.headers.get(`${eventPath}-routing-original-provider`) ??
                '',
              originalModel:
                resp.headers.get(`${eventPath}-routing-original-model`) ?? '',
              routedProvider:
                resp.headers.get(`${eventPath}-routing-routed-provider`) ?? '',
              routedModel:
                resp.headers.get(`${eventPath}-routing-routed-model`) ?? '',
            });
          }
        }
      }
      return resp;
    },
  }).chat('gpt-4o');
}
