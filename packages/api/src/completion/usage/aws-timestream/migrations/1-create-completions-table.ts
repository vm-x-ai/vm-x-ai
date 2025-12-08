import { Migration } from 'kysely';
import {
  CreateTableCommand,
  DeleteTableCommand,
  PartitionKeyEnforcementLevel,
  PartitionKeyType,
  TimestreamWriteClient,
} from '@aws-sdk/client-timestream-write';

export const migration = (
  databaseName: string,
  writeClient: TimestreamWriteClient
): Migration => ({
  async up(): Promise<void> {
    await writeClient.send(
      new CreateTableCommand({
        DatabaseName: databaseName,
        TableName: 'completions',
        RetentionProperties: {
          MemoryStoreRetentionPeriodInHours: 24, // Data kept in memory for 1 day
          MagneticStoreRetentionPeriodInDays: 365 * 5, // Data kept in magnetic store for 5 years
        },
        Schema: {
          CompositePartitionKey: [
            {
              Name: 'workspaceId',
              Type: PartitionKeyType.DIMENSION,
              EnforcementInRecord: PartitionKeyEnforcementLevel.OPTIONAL,
            },
          ],
        },
      })
    );
  },

  async down(): Promise<void> {
    await writeClient.send(
      new DeleteTableCommand({
        DatabaseName: databaseName,
        TableName: 'completions',
      })
    );
  },
});
