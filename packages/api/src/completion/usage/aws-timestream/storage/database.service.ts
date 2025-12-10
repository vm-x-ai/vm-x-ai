import {
  Injectable,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kysely } from 'kysely';
import { DB } from './entities';
import { AWSTimestreamDialect } from './dialect';
import { TimestreamQueryClient } from '@aws-sdk/client-timestream-query';
import { TimestreamWriteClient } from '@aws-sdk/client-timestream-write';
import { AWSTimestreamMigrationsService } from '../migrations/migrations.service';

@Injectable()
export class AWSTimestreamDatabaseService
  implements OnApplicationShutdown, OnModuleInit
{
  public instance: Kysely<DB>;

  constructor(
    private readonly configService: ConfigService,
    private readonly migrationsService: AWSTimestreamMigrationsService
  ) {
    const databaseName = this.configService.getOrThrow(
      'AWS_TIMESTREAM_DATABASE_NAME'
    );
    const dialect = new AWSTimestreamDialect({
      queryClient: new TimestreamQueryClient({}),
      writeClient: new TimestreamWriteClient({}),
      databaseName,
    });

    this.instance = new Kysely<DB>({
      dialect,
    }).withSchema(databaseName);
  }

  async onApplicationShutdown() {
    await this.instance.destroy();
  }

  async onModuleInit() {
    await this.migrationsService.migrate();
  }
}
