import { AiResourceEntity } from '@/clients/api';

export type AiResourceStore = {
  aiResource?: {
    changes?: Record<string, Partial<AiResourceEntity>>;
  };
};

export type AiResourceActions = {
  setAiResourceChanges: (
    resourceId: string,
    changes: Partial<AiResourceEntity>
  ) => void;
};

export const aiResourceActions = <T extends AiResourceStore>(
  set: (state: Partial<T>) => void,
  get: () => T
) => {
  return {
    setAiResourceChanges: (
      resourceId: string,
      changes: Partial<AiResourceEntity>
    ) => {
      set({
        ...get(),
        aiResource: {
          ...get().aiResource,
          changes: { ...get().aiResource?.changes, [resourceId]: changes },
        },
      });
    },
  };
};
