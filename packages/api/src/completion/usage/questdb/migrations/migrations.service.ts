import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CamelCasePlugin,
  DEFAULT_MIGRATION_LOCK_TABLE,
  DEFAULT_MIGRATION_TABLE,
  Kysely,
  Migrator,
  PostgresDialect,
} from 'kysely';
import { Pool } from 'pg';
import {
  BaseMigrationsService,
  ListMigrationProvider,
} from '../../../../migrations/base';
import { PinoLogger } from 'nestjs-pino';
import { migration as migration01 } from './1-create-completions-table';
import { DB } from '../storage/entities';

@Injectable()
export class QuestDBMigrationsService extends BaseMigrationsService {
  constructor(logger: PinoLogger, configService: ConfigService) {
    super(logger, configService, 'DATABASE_HOST', 'questdb');

    const questdb = new Kysely<DB>({
      dialect: new PostgresDialect({
        pool: new Pool({
          host: this.configService.getOrThrow<string>('QUESTDB_HOST'),
          port: this.configService.getOrThrow<number>('QUESTDB_PORT'),
          user: this.configService.getOrThrow<string>('QUESTDB_USER'),
          password: this.configService.getOrThrow<string>('QUESTDB_PASSWORD'),
          database: this.configService.getOrThrow<string>('QUESTDB_DB_NAME'),
          connectionTimeoutMillis: 10_000,
        }),
      }),
      plugins: [new CamelCasePlugin()],
    });

    const schema = this.configService.getOrThrow('DATABASE_SCHEMA');
    this.migrator = new Migrator({
      db: this.db.withSchema(schema),
      disableTransactions: true,
      migrationTableName: `questdb_${DEFAULT_MIGRATION_TABLE}`,
      migrationLockTableName: `questdb_${DEFAULT_MIGRATION_LOCK_TABLE}`,
      provider: new ListMigrationProvider({
        '01': migration01(questdb),
      }),
    });
  }
}
