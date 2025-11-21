'use server';

import { DEFAULT_CAPACITY } from '@/components/AIConnection/consts';
import type { FormAction } from '@/components/AIConnection/Form/Create';
import { type FormSchema } from '@/components/AIConnection/Form/Create';

export async function submitForm(prevState: FormAction, data: FormSchema): Promise<FormAction> {
  if (data.formType === 'quick') {
    const filledProviders = data.providers.filter((provider) => {
      for (const key in provider.config) {
        if (provider.config[key]) return true;
      }

      return false;
    });

    if (filledProviders.length === 0) {
      return {
        success: false,
        message: 'At least one provider should be filled',
        data,
      };
    }

    const [providers, ...connections] = await Promise.all([
      api.aiProvider.get(),
      ...filledProviders.map((provider) =>
        api.aiConnection.add(data.workspaceId, data.environmentId, {
          name: data.name ? `${data.name}-${provider.provider}` : provider.provider,
          description: '',
          capacity: DEFAULT_CAPACITY,
          provider: provider.provider,
          config: provider.config,
        }),
      ),
    ]);

    if (!connections.some((connection) => connection.success)) {
      return {
        success: false,
        message: 'Failed to create all AI Connections',
        data,
      };
    }

    const connectionResult = connections.map((response, index) => ({
      request: {
        name: data.name ? `${data.name}-${filledProviders[index].provider}` : filledProviders[index].provider,
        provider: filledProviders[index].provider,
      },
      response,
    }));

    if (providers.success) {
      const resources = await Promise.all(
        connections.map(async (connection) => {
          if (!connection.success) {
            return {
              resource: {
                success: false,
                data: {
                  message: 'Connection failed to be created',
                },
              } as ApiResponse<Resource>,
            };
          }

          const model = providers.data.find((provider) => provider.id === connection.data.provider)?.config.models[0]
            .value;

          if (model) {
            const resource = await api.resource.add(data.workspaceId, data.environmentId, {
              resource: `${connection.data.name}-default`,
              description: `${connection.data.name} default resource`,
              useFallback: false,
              enforceCapacity: false,
              assignApiKeys: data.assignApiKeys,
              model: {
                connectionId: connection.data.connectionId,
                model,
                provider: connection.data.provider,
              },
            });

            return { connection: connection.data, resource };
          }

          return {
            connection: connection.data,
            resource: {
              success: false,
              data: {
                message: 'Model not found',
              },
            } as ApiResponse<Resource>,
          };
        }),
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
      success: true,
      message: 'AI Connection created successfully',
      response: {
        connections: connectionResult,
      },
      data,
    };
  } else if (data.formType === 'advanced') {
    const { workspaceId, environmentId, environmentManagedBy, assignApiKeys, ...payload } = data;

    const [connection, providers] = await Promise.all([
      api.aiConnection.add(workspaceId, environmentId, {
        ...payload,
        capacity: DEFAULT_CAPACITY,
      }),
      api.aiProvider.get(),
    ]);

    if (connection.success && providers.success) {
      const model = providers.data.find((provider) => provider.id === connection.data.provider)?.config.models[0].value;
      if (model) {
        const resourceName = `${payload.name}-default`;
        const resource = await api.resource.add(workspaceId, environmentId, {
          resource: resourceName,
          description: `${payload.name} default resource`,
          useFallback: false,
          enforceCapacity: false,
          assignApiKeys,
          model: {
            connectionId: connection.data.connectionId,
            model,
            provider: connection.data.provider,
          },
        });

        return {
          success: true,
          message: 'AI Connection created successfully',
          response: {
            connections: [
              { request: { name: connection.data.name, provider: connection.data.provider }, response: connection },
            ],
            resources: [{ request: { name: resourceName }, response: resource }],
          },
          data,
        };
      }
    }

    return {
      success: connection.success,
      message: connection.success ? 'AI Connection created successfully' : connection.data.message,
      response: connection.success
        ? { connections: [{ request: { name: payload.name, provider: payload.provider }, response: connection }] }
        : undefined,
      data,
    };
  }

  throw new Error(`Invalid form type`);
}
