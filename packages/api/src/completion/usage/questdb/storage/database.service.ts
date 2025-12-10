import {
  Injectable,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CamelCasePlugin, Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { DB } from './entities';
import { QuestDBMigrationsService } from '../migrations/migrations.service';

@Injectable()
export class QuestDBDatabaseService
  implements OnApplicationShutdown, OnModuleInit
{
  public instance: Kysely<DB>;

  constructor(
    private readonly configService: ConfigService,
    private readonly migrationsService: QuestDBMigrationsService
  ) {
    const dialect = new PostgresDialect({
      pool: new Pool({
        connectionString: this.configService.getOrThrow('QUESTDB_URL'),
        connectionTimeoutMillis: 10_000,
        max: this.configService.get('DATABASE_WRITER_POOL_MAX'),
      }),
    });

    const camelCasePlugin = new CamelCasePlugin();

    this.instance = new Kysely<DB>({
      dialect,
      plugins: [camelCasePlugin],
    });
  }

  async onApplicationShutdown() {
    await this.instance.destroy();
  }

  async onModuleInit() {
    await this.migrationsService.migrate();
  }
}
