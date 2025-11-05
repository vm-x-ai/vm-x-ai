import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CamelCasePlugin,
  Kysely,
  Migration,
  MigrationProvider,
  Migrator,
  NO_MIGRATIONS,
  PostgresDialect,
} from 'kysely';
import { Pool } from 'pg';
import { SERVICE_NAME } from '../consts';
import { Logger } from 'nestjs-pino';
import { migration as migration01 } from './1-create-users';
import { migration as migration02 } from './2-create-oidc-provider';
import { migration as migration03 } from './3-workspace-table';
import { migration as migration04 } from './4-workspace-user-table';
import { migration as migration05 } from './5-environment-table';
import { migration as migration06 } from './6-ai-connection-table';
import { migration as migration07 } from './7-ai-resource-table';
import { migration as migration08 } from './8-pool-definition-table';
import { migration as migration09 } from './9-api-key-table';
import { PasswordService } from '../auth/password.service';
import { DB } from '../storage/entities.generated';

class ListMigrationProvider implements MigrationProvider {
  constructor(private migrations: Record<string, Migration>) {}

  async getMigrations(): Promise<Record<string, Migration>> {
    return this.migrations;
  }
}

@Injectable()
export class MigrationsService implements OnModuleInit {
  private migrator: Migrator;
  private readonly db: Kysely<DB>;

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: Logger,
    private readonly passwordService: PasswordService
  ) {
    const dialect = new PostgresDialect({
      pool: new Pool({
        connectionString: this.configService.getOrThrow(
          'DATABASE_MIGRATION_URL'
        ),
        connectionTimeoutMillis: 10_000,
      }),
    });

    this.db = new Kysely({
      dialect,
      plugins: [new CamelCasePlugin()],
    });

    this.migrator = new Migrator({
      db: this.db.withSchema(SERVICE_NAME.toLowerCase()),
      provider: new ListMigrationProvider({
        '01': migration01(this.passwordService),
        '02': migration02,
        '03': migration03,
        '04': migration04,
        '05': migration05,
        '06': migration06,
        '07': migration07,
        '08': migration08,
        '09': migration09,
      }),
    });
  }
  async onModuleInit() {
    await this.db.schema
      .createSchema(SERVICE_NAME.toLowerCase())
      .ifNotExists()
      .execute();
  }

  async migrate() {
    this.logger.debug('Starting database migration');
    const { error, results } = await this.migrator.migrateToLatest();

    if (error) {
      this.logger.error('Failed to migrate', error);
      throw error;
    }

    this.logger.log({ results }, 'Migration completed successfully');
    return results;
  }

  /**
   * Run a single migration step up (forward)
   */
  async up() {
    this.logger.debug('Running single migration up');
    const { error, results } = await this.migrator.migrateUp();

    if (error) {
      this.logger.error('Failed to migrate up', error);
      throw error;
    }

    this.logger.log({ results }, 'Migration up completed successfully');
    return results;
  }

  /**
   * Rollback a single migration step down (backward)
   */
  async down() {
    const isLocalOrTest =
      this.configService.getOrThrow<string>('NODE_ENV') === 'local' ||
      this.configService.getOrThrow<string>('NODE_ENV') === 'test';

    const databaseContainsLocalhost = this.configService
      .getOrThrow<string>('DATABASE_MIGRATION_URL')
      .includes('localhost');

    if (!isLocalOrTest || !databaseContainsLocalhost) {
      throw new Error(
        'Migration rollback is only allowed in local or test environment'
      );
    }

    this.logger.debug('Running single migration down');
    const { error, results } = await this.migrator.migrateDown();

    if (error) {
      this.logger.error('Failed to migrate down', error);
      throw error;
    }

    this.logger.log({ results }, 'Migration down completed successfully');
    return results;
  }

  async resetMigrations(targetMigration?: string) {
    const isLocalOrTest =
      this.configService.getOrThrow<string>('NODE_ENV') === 'local' ||
      this.configService.getOrThrow<string>('NODE_ENV') === 'test';

    const databaseContainsLocalhost = this.configService
      .getOrThrow<string>('DATABASE_MIGRATION_URL')
      .includes('localhost');

    if (!isLocalOrTest || !databaseContainsLocalhost) {
      throw new Error(
        'Resetting migrations is only allowed in local or test environment'
      );
    }

    this.logger.debug('Starting database rollback');
    await this.migrator.migrateTo(targetMigration ?? NO_MIGRATIONS);
    this.logger.log('Rollback completed successfully');
  }
}
