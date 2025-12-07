import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CamelCasePlugin, Kysely } from 'kysely';
import { DB } from './entities';
import { AWSTimestreamDialect } from './dialect';
import { TimestreamQueryClient } from '@aws-sdk/client-timestream-query';
import { TimestreamWriteClient } from '@aws-sdk/client-timestream-write';

@Injectable()
export class AWSTimestreamDatabaseService implements OnApplicationShutdown {
  public instance: Kysely<DB>;

  constructor(private readonly configService: ConfigService) {
    const dialect = new AWSTimestreamDialect({
      queryClient: new TimestreamQueryClient({}),
      writeClient: new TimestreamWriteClient({}),
      databaseName: this.configService.getOrThrow('AWS_TIMESTREAM_DATABASE_NAME'),
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
}
