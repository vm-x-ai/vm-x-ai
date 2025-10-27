import { Injectable } from '@nestjs/common';
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
import { migration as migration02 } from './2-create-oidc-state';
import { migration as migration03 } from './3-create-oidc-provider';
import { PasswordService } from '../auth/password.service';

class ListMigrationProvider implements MigrationProvider {
  constructor(private migrations: Record<string, Migration>) {}

  async getMigrations(): Promise<Record<string, Migration>> {
    return this.migrations;
  }
}

@Injectable()
export class MigrationsService {
  private migrator: Migrator;

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
    const db = new Kysely({
      dialect,
      plugins: [new CamelCasePlugin()],
    }).withSchema(SERVICE_NAME.toLowerCase());

    this.migrator = new Migrator({
      db,
      provider: new ListMigrationProvider({
        '01': migration01(this.passwordService),
        '02': migration02,
        '03': migration03,
      }),
    });
  }

  async migrate() {
    this.logger.debug('Starting database migration');
    const { error, results } = await this.migrator.migrateToLatest();

    if (error) {
      this.logger.error('Failed to migrate', error);
      throw error;
    }

    this.logger.log('Migration completed successfully', { results });
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

    this.logger.log('Migration up completed successfully', { results });
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

    this.logger.log('Migration down completed successfully', { results });
    return results;
  }

  async resetMigrations() {
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
    await this.migrator.migrateTo(NO_MIGRATIONS);
    this.logger.log('Rollback completed successfully');
  }
}
