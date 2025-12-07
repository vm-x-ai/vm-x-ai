import {
  DatabaseIntrospector,
  DatabaseMetadata,
  SchemaMetadata,
  TableMetadata,
} from 'kysely';

export class AWSTimestreamIntrospector implements DatabaseIntrospector {
  async getSchemas(): Promise<SchemaMetadata[]> {
    this.#throwIntrospectionError();
  }
  async getTables(): Promise<TableMetadata[]> {
    this.#throwIntrospectionError();
  }
  async getMetadata(): Promise<DatabaseMetadata> {
    this.#throwIntrospectionError();
  }

  #throwIntrospectionError(): never {
    throw new Error(
      'Introspection is not supported by the AWS Timestream dialect'
    );
  }
}
