import { CompletionBatchItemEntity } from '../entity/batch-item.entity';
import { CompletionBatchEntity } from '../entity/batch.entity';

export type CompletionBatchStream =
  | {
      action: 'batch-created';
      payload: CompletionBatchEntity;
    }
  | {
      action: 'item-running' | 'item-completed' | 'item-failed';
      payload: CompletionBatchItemEntity;
    }
  | {
      action: 'batch-completed' | 'batch-failed';
      payload: CompletionBatchEntity;
    };
