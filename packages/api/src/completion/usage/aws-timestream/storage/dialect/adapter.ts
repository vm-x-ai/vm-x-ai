import { DialectAdapterBase } from 'kysely';

export class AWSTimestreamDialectAdapter extends DialectAdapterBase {
  override get supportsCreateIfNotExists(): boolean {
    return false;
  }

  override get supportsReturning(): boolean {
    return false;
  }

  override get supportsTransactionalDdl(): boolean {
    return false;
  }

  override async acquireMigrationLock(): Promise<void> {
    this.#throwLocksError();
  }
  override async releaseMigrationLock() {
    this.#throwLocksError();
  }

  #throwLocksError() {
    throw new Error('Locks are not supported by the AWS Timestream dialect');
  }
}
