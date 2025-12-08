import {
  Driver,
  DatabaseIntrospector,
  Dialect,
  DialectAdapter,
  QueryCompiler,
} from 'kysely';
import { AWSTimestreamIntrospector } from './introspector';
import { AWSTimestreamDialectAdapter } from './adapter';
import { TimestreamDialectConfig } from './config';
import { AWSTimestreamDriver } from './driver';
import { AWSTimestreamQueryCompiler } from './query-compiler';

export class AWSTimestreamDialect implements Dialect {
  constructor(private readonly config: TimestreamDialectConfig) {}

  createDriver(): Driver {
    return new AWSTimestreamDriver(this.config);
  }
  createQueryCompiler(): QueryCompiler {
    return new AWSTimestreamQueryCompiler();
  }
  createAdapter(): DialectAdapter {
    return new AWSTimestreamDialectAdapter();
  }
  createIntrospector(): DatabaseIntrospector {
    return new AWSTimestreamIntrospector();
  }
}
