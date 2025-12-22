import {
  Injectable,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CamelCasePlugin,
  Expression,
  Kysely,
  PostgresDialect,
  SelectQueryBuilder,
} from 'kysely';
import { Pool } from 'pg';
import { MigrationsService } from '../migrations/migrations.service';
import { DB } from './entities.generated';
import { jsonObjectFrom } from 'kysely/helpers/postgres';

@Injectable()
export class DatabaseService implements OnModuleInit, OnApplicationShutdown {
  private writerInstance: Kysely<DB>;
  private readerInstance: Kysely<DB>;
  private rawWriterInstance: Kysely<DB>;
  private rawReaderInstance: Kysely<DB>;

  constructor(
    private readonly configService: ConfigService,
    private readonly migrationsService: MigrationsService
  ) {
    const databaseSSL =
      this.configService.get<boolean>('DATABASE_SSL') ?? false;
    const sslConfig = databaseSSL
      ? {
          rejectUnauthorized: false, // AWS RDS uses self-signed certificates
        }
      : undefined;

    const writerDialect = new PostgresDialect({
      pool: new Pool({
        host: this.configService.getOrThrow<string>('DATABASE_HOST'),
        port: this.configService.getOrThrow<number>('DATABASE_PORT'),
        user: this.configService.getOrThrow<string>('DATABASE_USER'),
        password: this.configService.getOrThrow<string>('DATABASE_PASSWORD'),
        database: this.configService.getOrThrow<string>('DATABASE_DB_NAME'),
        connectionTimeoutMillis: 10_000,
        max: this.configService.get('DATABASE_WRITER_POOL_MAX'),
        ssl: sslConfig,
      }),
    });

    const camelCasePlugin = new CamelCasePlugin();
    const schema = this.configService.getOrThrow<string>('DATABASE_SCHEMA');

    this.writerInstance = new Kysely<DB>({
      dialect: writerDialect,
      plugins: [camelCasePlugin],
    }).withSchema(schema);

    this.rawWriterInstance = new Kysely<DB>({
      dialect: writerDialect,
    }).withSchema(schema);

    const readerDialect = new PostgresDialect({
      pool: new Pool({
        host: this.configService.getOrThrow<string>('DATABASE_RO_HOST'),
        port: this.configService.getOrThrow<number>('DATABASE_PORT'),
        user: this.configService.getOrThrow<string>('DATABASE_USER'),
        password: this.configService.getOrThrow<string>('DATABASE_PASSWORD'),
        database: this.configService.getOrThrow<string>('DATABASE_DB_NAME'),
        connectionTimeoutMillis: 10_000,
        max: this.configService.get('DATABASE_READER_POOL_MAX'),
        ssl: sslConfig,
      }),
    });

    this.readerInstance = new Kysely<DB>({
      dialect: readerDialect,
      plugins: [camelCasePlugin],
    }).withSchema(schema);

    this.rawReaderInstance = new Kysely<DB>({
      dialect: readerDialect,
    }).withSchema(schema);
  }

  get writer() {
    return this.writerInstance;
  }

  get reader() {
    return this.readerInstance;
  }

  get rawWriter() {
    return this.rawWriterInstance;
  }

  get rawReader() {
    return this.rawReaderInstance;
  }

  async onApplicationShutdown() {
    await this.writerInstance.destroy();
    await this.readerInstance.destroy();
    await this.rawWriterInstance.destroy();
    await this.rawReaderInstance.destroy();
  }

  async onModuleInit() {
    await this.migrationsService.migrate();
  }

  public includeEntityControlUsers<
    D extends DB,
    T extends keyof D,
    O extends {
      createdBy: string;
      updatedBy: string;
    }
  >(table: T) {
    return (qb: SelectQueryBuilder<D, T, O>) =>
      qb.select(
        (eb) =>
          [
            this.withUser(
              eb.ref(`${table as string}.createdBy` as never),
              'createdBy'
            )
              .$notNull()
              .as('createdByUser'),
            this.withUser(
              eb.ref(`${table as string}.updatedBy` as never),
              'updatedBy'
            )
              .$notNull()
              .as('updatedByUser'),
          ] as const
      );
  }

  public withUser(userId: Expression<string | null>, alias: string) {
    return jsonObjectFrom(
      this.reader
        .selectFrom(`users as ${alias}`)
        .select([
          'id',
          'name',
          'firstName',
          'lastName',
          'username',
          'email',
          'emailVerified',
          'pictureUrl',
          'state',
          'providerType',
          'providerId',
          'providerMetadata',
          'createdAt',
          'updatedAt',
        ])
        .where(`${alias}.id`, '=', userId)
    );
  }

  public withApiKey(
    workspaceId: Expression<string>,
    environmentId: Expression<string>,
    apiKeyId: Expression<string | null>,
    alias: string
  ) {
    return jsonObjectFrom(
      this.reader
        .selectFrom(`apiKeys as ${alias}`)
        .select([
          'workspaceId',
          'environmentId',
          'apiKeyId',
          'name',
          'description',
          'enabled',
          'resources',
          'maskedKey',
          'enforceCapacity',
          'capacity',
          'labels',
          'createdAt',
          'createdBy',
          'updatedAt',
          'updatedBy',
        ])
        .where(`${alias}.workspaceId`, '=', workspaceId)
        .where(`${alias}.environmentId`, '=', environmentId)
        .where(`${alias}.apiKeyId`, '=', apiKeyId)
    );
  }
}
