import { DatabaseConnection, Driver } from 'kysely';
import { TimestreamDialectConfig } from './config';
import { AWSTimestreamConnection } from './connection';

export class AWSTimestreamDriver implements Driver {
  constructor(private readonly config: TimestreamDialectConfig) {}

  async acquireConnection(): Promise<DatabaseConnection> {
    return new AWSTimestreamConnection(this.config);
  }

  async beginTransaction(): Promise<void> {
    this.#throwTransactionError();
  }

  async commitTransaction(): Promise<void> {
    this.#throwTransactionError();
  }

  async rollbackTransaction(): Promise<void> {
    this.#throwTransactionError();
  }

  async savepoint?(): Promise<void> {
    this.#throwTransactionError();
  }

  async rollbackToSavepoint?(): Promise<void> {
    this.#throwTransactionError();
  }

  async releaseSavepoint?(): Promise<void> {
    this.#throwTransactionError();
  }

  async releaseConnection(): Promise<void> {
    // no-op
  }

  async destroy(): Promise<void> {
    // no-op
  }

  async init(): Promise<void> {
    // no-op
  }

  #throwTransactionError() {
    throw new Error(
      `Transactions are not supported by the AWS Timestream dialect`
    );
  }
}
