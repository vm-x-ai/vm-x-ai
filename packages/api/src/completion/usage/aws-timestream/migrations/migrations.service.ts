import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DEFAULT_MIGRATION_LOCK_TABLE,
  DEFAULT_MIGRATION_TABLE,
  Migrator,
} from 'kysely';
import {
  BaseMigrationsService,
  ListMigrationProvider,
} from '../../../../migrations/base';
import { PinoLogger } from 'nestjs-pino';
import { migration as migration01 } from './1-create-completions-table';
import { TimestreamWriteClient } from '@aws-sdk/client-timestream-write';

@Injectable()
export class AWSTimestreamMigrationsService extends BaseMigrationsService {
  constructor(logger: PinoLogger, configService: ConfigService) {
    super(logger, configService, 'DATABASE_HOST', 'aws-timestream');

    const region = this.configService.getOrThrow<string>('AWS_REGION');
    const writeClient = new TimestreamWriteClient({ region });
    const databaseName = this.configService.getOrThrow(
      'AWS_TIMESTREAM_DATABASE_NAME'
    );

    const schema = this.configService.getOrThrow('DATABASE_SCHEMA');
    this.migrator = new Migrator({
      db: this.db.withSchema(schema),
      disableTransactions: true,
      migrationTableName: `aws_timestream_${DEFAULT_MIGRATION_TABLE}`,
      migrationLockTableName: `aws_timestream_${DEFAULT_MIGRATION_LOCK_TABLE}`,
      provider: new ListMigrationProvider({
        '01': migration01(databaseName, writeClient),
      }),
    });
  }
}
