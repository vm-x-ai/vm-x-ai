import { Module } from '@nestjs/common';
import { AWSTimestreamMigrationsService } from './migrations.service';

@Module({
  imports: [],
  providers: [AWSTimestreamMigrationsService],
  exports: [AWSTimestreamMigrationsService],
})
export class AWSTimestreamMigrationsModule {}
