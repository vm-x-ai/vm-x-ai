'use server';

import {
  AiConnectionEntity,
  AiResourceEntity,
  createAiConnection,
  createAiResource,
  ErrorCode,
  getAiProviders,
} from '@/clients/api';
import { ApiResponse } from '@/clients/types';
import { DEFAULT_CAPACITY } from '@/components/Capacity/consts';
import type { FormAction } from '@/components/AIConnection/Form/Create';
import { type FormSchema } from '@/components/AIConnection/Form/Create';

export async function submitForm(
  prevState: FormAction,
  data: FormSchema
): Promise<FormAction> {
  if (data.formType === 'quick') {
    const filledProviders = data.providers.filter((provider) => {
      for (const key in provider.config) {
        if (provider.config[key]) return true;
      }

      return false;
    });

    if (filledProviders.length === 0) {
      return {
        ...prevState,
        success: false,
        message: 'At least one provider should be filled',
        data,
      };
    }

    const [providers, ...connections] = await Promise.all([
      getAiProviders(),
      ...filledProviders.map((provider) =>
        createAiConnection({
          path: {
            workspaceId: data.workspaceId,
            environmentId: data.environmentId,
          },
          body: {
            name: data.name
              ? `${data.name}-${provider.provider}`
              : provider.provider,
            description: '',
            capacity: DEFAULT_CAPACITY,
            provider: provider.provider,
            config: provider.config,
          },
        })
      ),
    ]);

    if (!connections.some((connection) => connection.data)) {
      return {
        ...prevState,
        success: false,
        message: 'Failed to create all AI Connections',
        data,
      };
    }

    const connectionResult = connections.map(
      ({ response, ...responseData }, index) => ({
        request: {
          name: data.name
            ? `${data.name}-${filledProviders[index].provider}`
            : filledProviders[index].provider,
          provider: filledProviders[index].provider,
        },
        response: responseData,
      })
    );

    if (providers.data) {
      const resources = await Promise.all(
        connections.map<
          Promise<{
            connection?: AiConnectionEntity;
            resource: ApiResponse<AiResourceEntity>;
          }>
        >(async (connection) => {
          if (!connection.data) {
            return {
              resource: {
                data: undefined,
                error: connection.error,
              },
            };
          }

          const model = providers.data.find(
            (provider) => provider.id === connection.data.provider
          )?.defaultModel;

          if (model) {
            const { response, ...resource } = await createAiResource({
              path: {
                workspaceId: data.workspaceId,
                environmentId: data.environmentId,
              },
              body: {
                name: `${connection.data.name}-default`,
                description: `${connection.data.name} default resource`,
                useFallback: false,
                enforceCapacity: false,
                assignApiKeys: data.assignApiKeys,
                model: {
                  connectionId: connection.data.connectionId,
                  model,
                  provider: connection.data.provider,
                },
              },
            });

            return { connection: connection.data, resource };
          }

          return {
            connection: connection.data,
            resource: {
              data: undefined,
              error: {
                errorCode: ErrorCode.AI_PROVIDER_NOT_FOUND,
                errorMessage: `Cannot find default model for provider ${connection.data.provider}`,
              },
            } as ApiResponse<AiResourceEntity>,
          };
        })
      );

      return {
        success: true,
        message: 'AI Connections created successfully',
        response: {
          connections: connectionResult,
          resources: resources.map(({ connection, resource }) => ({
            request: { name: connection ? `${connection.name}-default` : '' },
            response: resource,
          })),
        },
        data,
      };
    }

    return {
      ...prevState,
      success: true,
      message: 'AI Connection created successfully',
      response: {
        connections: connectionResult,
      },
      data,
    };
  } else if (data.formType === 'advanced') {
    const {
      workspaceId,
      environmentId,
      assignApiKeys,
      providersMap,
      formType,
      ...payload
    } = data;

    const [{ response, ...connection }, providers] = await Promise.all([
      createAiConnection({
        path: {
          workspaceId,
          environmentId,
        },
        body: {
          ...payload,
          capacity: DEFAULT_CAPACITY,
        },
      }),
      getAiProviders(),
    ]);

    if (connection.data && providers.data) {
      const model = providers.data.find(
        (provider) => provider.id === connection.data.provider
      )?.defaultModel;

      if (model) {
        const resourceName = `${payload.name}-default`;
        const { response, ...resource } = await createAiResource({
          path: {
            workspaceId,
            environmentId,
          },
          body: {
            name: resourceName,
            description: `${payload.name} default resource`,
            useFallback: false,
            enforceCapacity: false,
            assignApiKeys,
            model: {
              connectionId: connection.data.connectionId,
              model,
              provider: connection.data.provider,
            },
          },
        });

        return {
          ...prevState,
          success: true,
          message: 'AI Connection created successfully',
          response: {
            connections: [
              {
                request: {
                  name: connection.data.name,
                  provider: connection.data.provider,
                },
                response: connection,
              },
            ],
            resources: [
              {
                request: {
                  name: resourceName,
                },
                response: resource,
              },
            ],
          },
          data,
        };
      }
    }

    return {
      ...prevState,
      success: !!connection.data,
      message: connection.data
        ? 'AI Connection created successfully'
        : connection.error?.errorMessage,
      response: connection.data
        ? {
            connections: [
              {
                request: { name: payload.name, provider: payload.provider },
                response: connection,
              },
            ],
          }
        : undefined,
      data,
    };
  }

  throw new Error(`Invalid form type`);
}
