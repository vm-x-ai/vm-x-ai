import {
  Driver,
  DatabaseIntrospector,
  Dialect,
  DialectAdapter,
  QueryCompiler,
  PostgresQueryCompiler,
} from 'kysely';
import { AWSTimestreamIntrospector } from './introspector';
import { AWSTimestreamDialectAdapter } from './adapter';
import { TimestreamDialectConfig } from './config';
import { AWSTimestreamDriver } from './driver';

export class AWSTimestreamDialect implements Dialect {
  constructor(private readonly config: TimestreamDialectConfig) {}

  createDriver(): Driver {
    return new AWSTimestreamDriver(this.config);
  }
  createQueryCompiler(): QueryCompiler {
    return new PostgresQueryCompiler();
  }
  createAdapter(): DialectAdapter {
    return new AWSTimestreamDialectAdapter();
  }
  createIntrospector(): DatabaseIntrospector {
    return new AWSTimestreamIntrospector();
  }
}
