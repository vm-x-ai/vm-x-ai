import {
  Kysely,
  Migration,
  MigrationProvider,
  Migrator,
  NO_MIGRATIONS,
} from 'kysely';
import { DB } from '../storage/entities.generated';
import { PinoLogger } from 'nestjs-pino';
import { ConfigService } from '@nestjs/config';
import { SERVICE_NAME } from '../consts';

export class ListMigrationProvider implements MigrationProvider {
  constructor(private migrations: Record<string, Migration>) {}

  async getMigrations(): Promise<Record<string, Migration>> {
    return this.migrations;
  }
}

export abstract class BaseMigrationsService {
  protected migrator: Migrator;
  protected db: Kysely<DB>;

  constructor(
    protected readonly logger: PinoLogger,
    protected readonly configService: ConfigService,
    protected readonly migrationUrlConfigKey: string,
    protected readonly service: string
  ) {}

  async migrate() {
    await this.db.schema
      .createSchema(SERVICE_NAME.toLowerCase())
      .ifNotExists()
      .execute();

    this.logger.debug(`${this.service}: Starting database migration`);
    const { error, results } = await this.migrator.migrateToLatest();

    if (error) {
      this.logger.error(`${this.service}: Failed to migrate`, error);
      throw error;
    }

    this.logger.info(
      { results },
      `${this.service}: Migration completed successfully`
    );
    return results;
  }

  /**
   * Run a single migration step up (forward)
   */
  async up() {
    this.logger.debug(`${this.service}: Running single migration up`);
    const { error, results } = await this.migrator.migrateUp();

    if (error) {
      this.logger.error(`${this.service}: Failed to migrate up`, error);
      throw error;
    }

    this.logger.info(
      { results },
      `${this.service}: Migration up completed successfully`
    );
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
      .getOrThrow<string>(this.migrationUrlConfigKey)
      .includes('localhost');

    if (!isLocalOrTest || !databaseContainsLocalhost) {
      throw new Error(
        `${this.service}: Migration rollback is only allowed in local or test environment`
      );
    }

    this.logger.debug(`${this.service}: Running single migration down`);
    const { error, results } = await this.migrator.migrateDown();

    if (error) {
      this.logger.error(`${this.service}: Failed to migrate down`, error);
      throw error;
    }

    this.logger.info(
      { results },
      `${this.service}: Migration down completed successfully`
    );
    return results;
  }

  async resetMigrations(targetMigration?: string) {
    const isLocalOrTest =
      this.configService.getOrThrow<string>('NODE_ENV') === 'local' ||
      this.configService.getOrThrow<string>('NODE_ENV') === 'test';

    const databaseContainsLocalhost = this.configService
      .getOrThrow<string>(this.migrationUrlConfigKey)
      .includes('localhost');

    if (!isLocalOrTest || !databaseContainsLocalhost) {
      throw new Error(
        `${this.service}: Resetting migrations is only allowed in local or test environment`
      );
    }

    this.logger.debug(`${this.service}: Starting database rollback`);
    await this.migrator.migrateTo(targetMigration ?? NO_MIGRATIONS);
    this.logger.info(`${this.service}: Rollback completed successfully`);
  }
}
