import { TimestreamQueryClient } from '@aws-sdk/client-timestream-query';
import { TimestreamWriteClient } from '@aws-sdk/client-timestream-write';

export type TimestreamDialectConfig = {
  queryClient: TimestreamQueryClient;
  writeClient: TimestreamWriteClient;
  databaseName: string;
};
