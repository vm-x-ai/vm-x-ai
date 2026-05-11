import { ApiKeyEntity } from '../../../api-key/entities/api-key.entity';
import { CompletionBatchEntity } from '../entity/batch.entity';

export type QueueItem<T> = {
  payload: T;
  metadata: QueueItemMetadata;
  context: {
    batch: CompletionBatchEntity;
    apiKey?: ApiKeyEntity;
  };
};

export type QueueItemMetadata = {
  retryCount: number;
  createdAt: number;
};
